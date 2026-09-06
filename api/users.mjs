import { query } from './db.js'
import { hashPassword, verifyPassword } from './password.js'
import { removeProjectMedia } from './projectMedia.mjs'
import {
  applyDuePlanChanges,
  periodLinkCounts,
  planColumns,
  planSummary,
} from './plans.mjs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD_LENGTH = 8

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isEmail(value) {
  const email = normalizeEmail(value)
  return email.length <= 254 && EMAIL_RE.test(email)
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, login, email, name, is_admin, is_blocked, created_at
     FROM users WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function loginUser(email, password) {
  const identity = String(email ?? '').trim()
  if (!identity) {
    return { ok: false, error: 'Неверная почта или пароль' }
  }
  const { rows } = await query(
    `SELECT id, login, email, name, is_admin, is_blocked, email_verified, password_hash
     FROM users
     WHERE lower(email) = lower($1) OR lower(login) = lower($1)`,
    [identity],
  )
  const user = rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { ok: false, error: 'Неверная почта или пароль' }
  }
  if (user.is_blocked) {
    return { ok: false, error: 'Аккаунт заблокирован' }
  }
  return {
    ok: true,
    user: {
      id: user.id,
      login: user.login,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      is_blocked: user.is_blocked,
      email_verified: user.email_verified !== false,
    },
  }
}

export async function findUserByEmail(email) {
  const identity = String(email ?? '').trim()
  if (!identity) return null
  const { rows } = await query(
    `SELECT id, login, email, name, email_verified
     FROM users
     WHERE lower(email) = lower($1) OR lower(login) = lower($1)`,
    [identity],
  )
  return rows[0] ?? null
}

export async function setUserPassword(userId, password) {
  const passwordValue = String(password ?? '')
  if (passwordValue.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, status: 400, error: `Пароль не короче ${MIN_PASSWORD_LENGTH} символов` }
  }
  await query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, hashPassword(passwordValue)],
  )
  return { ok: true }
}

export async function changeUserPassword(userId, currentPassword, nextPassword) {
  const { rows } = await query(
    `SELECT id, password_hash FROM users WHERE id = $1`,
    [userId],
  )
  const user = rows[0]
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return { ok: false, status: 400, error: 'Неверный текущий пароль' }
  }
  return setUserPassword(userId, nextPassword)
}

export async function markEmailVerified(userId) {
  await query(`UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1`, [userId])
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    login: user.login,
    email: user.email ?? null,
    name: user.name ?? '',
    isAdmin: Boolean(user.is_admin ?? user.isAdmin),
    isBlocked: Boolean(user.is_blocked ?? user.isBlocked),
  }
}

export function isAdminUser(user) {
  return Boolean(user && (user.is_admin ?? user.isAdmin))
}

export function isBlockedUser(user) {
  return Boolean(user && (user.is_blocked ?? user.isBlocked))
}

export async function searchUsers(queryText, { limit = 30 } = {}) {
  const q = String(queryText ?? '').trim()
  const take = Math.min(100, Math.max(1, Number(limit) || 30))
  if (!q) {
    const { rows } = await query(
      `SELECT
         u.id, u.login, u.email, u.name, u.is_admin, u.is_blocked, u.created_at,
         (SELECT count(*)::int
          FROM templates t
          JOIN projects p ON p.id = t.project_id
          WHERE p.user_id = u.id) AS template_count
       FROM users u
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [take],
    )
    return rows.map(mapAdminUser)
  }
  const like = `%${q.replace(/[%_]/g, '')}%`
  const { rows } = await query(
    `SELECT
       u.id, u.login, u.email, u.name, u.is_admin, u.is_blocked, u.created_at,
       (SELECT count(*)::int
        FROM templates t
        JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = u.id) AS template_count
     FROM users u
     WHERE u.email ILIKE $1
        OR u.login ILIKE $1
        OR u.name ILIKE $1
     ORDER BY
       CASE
         WHEN lower(u.email) = lower($2) OR lower(u.login) = lower($2) THEN 0
         WHEN u.email ILIKE $3 OR u.login ILIKE $3 THEN 1
         ELSE 2
       END,
       u.created_at DESC
     LIMIT $4`,
    [like, q, `${q.replace(/[%_]/g, '')}%`, take],
  )
  return rows.map(mapAdminUser)
}

function mapAdminUser(row) {
  return {
    ...publicUser(row),
    createdAt: row.created_at,
    templateCount: Number(row.template_count ?? 0),
  }
}

export async function getUserWorkspace(userId) {
  const user = await findUserById(userId)
  if (!user) return null

  await applyDuePlanChanges()
  const { rows: projects } = await query(
    `SELECT
       p.id, p.code, p.name, p.type, p.status, p.created_at, p.updated_at, ${planColumns('p')},
       (SELECT count(*) FROM templates t WHERE t.project_id = p.id)::int AS templates,
       (SELECT count(*) FROM links l WHERE l.project_id = p.id)::int AS links,
       (SELECT coalesce(sum(l.open_count), 0) FROM links l WHERE l.project_id = p.id)::int AS opens
     FROM projects p
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId],
  )

  const projectIds = projects.map((p) => p.id)
  /** @type {Map<string, object[]>} */
  const templatesByProject = new Map()
  if (projectIds.length) {
    const { rows: templates } = await query(
      `SELECT id, project_id, code, name, is_default, status, created_at, updated_at,
              (draft_config IS NOT NULL) AS has_draft
       FROM templates
       WHERE project_id = ANY($1::uuid[])
       ORDER BY is_default DESC, created_at ASC`,
      [projectIds],
    )
    for (const row of templates) {
      const list = templatesByProject.get(row.project_id) ?? []
      list.push({
        id: row.id,
        code: row.code,
        name: row.name,
        isDefault: Boolean(row.is_default),
        status: row.status,
        hasDraft: Boolean(row.has_draft),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      templatesByProject.set(row.project_id, list)
    }
  }

  const templateCount = projects.reduce((sum, row) => sum + Number(row.templates ?? 0), 0)
  const periodLinks = await periodLinkCounts(projects)
  return {
    user: mapAdminUser({ ...user, template_count: templateCount }),
    projects: projects.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stats: {
        templates: Number(row.templates ?? 0),
        links: Number(row.links ?? 0),
        opens: Number(row.opens ?? 0),
      },
      plan: planSummary(row, periodLinks.get(row.id) ?? 0),
      templates: templatesByProject.get(row.id) ?? [],
    })),
  }
}

async function assertAdminTarget(actorId, targetId) {
  if (!targetId || targetId === actorId) {
    return { ok: false, status: 400, error: 'Нельзя применить к своему аккаунту' }
  }
  const target = await findUserById(targetId)
  if (!target) return { ok: false, status: 404, error: 'Пользователь не найден' }
  if (isAdminUser(target)) {
    return { ok: false, status: 403, error: 'Нельзя менять аккаунт администратора' }
  }
  return { ok: true, target }
}

export async function setUserBlocked(actorId, targetId, blocked) {
  const checked = await assertAdminTarget(actorId, targetId)
  if (!checked.ok) return checked
  const { rows } = await query(
    `UPDATE users
     SET is_blocked = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, login, email, name, is_admin, is_blocked, created_at,
       (SELECT count(*)::int
        FROM templates t
        JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = users.id) AS template_count`,
    [targetId, Boolean(blocked)],
  )
  if (!rows[0]) return { ok: false, status: 404, error: 'Пользователь не найден' }
  return { ok: true, user: mapAdminUser(rows[0]) }
}

export async function deleteUserAccount(actorId, targetId) {
  const checked = await assertAdminTarget(actorId, targetId)
  if (!checked.ok) return checked
  const { rows } = await query(`SELECT code FROM projects WHERE user_id = $1`, [targetId])
  await query(`DELETE FROM users WHERE id = $1`, [targetId])
  for (const row of rows) {
    try {
      await removeProjectMedia(row.code)
    } catch (err) {
      console.error('removeProjectMedia failed', row.code, err)
    }
  }
  return { ok: true }
}

export async function registerUser({ email, login, password, name }) {
  const emailValue = normalizeEmail(email ?? login)
  const passwordValue = String(password ?? '')
  const nameValue = String(name ?? '').trim() || emailValue
  if (!isEmail(emailValue)) {
    return { ok: false, status: 400, error: 'Укажите корректный email' }
  }
  if (passwordValue.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, status: 400, error: `Пароль не короче ${MIN_PASSWORD_LENGTH} символов` }
  }
  try {
    const { rows } = await query(
      `INSERT INTO users (login, email, password_hash, name, email_verified)
       VALUES ($1, $1, $2, $3, false)
       RETURNING id, login, email, name, is_admin`,
      [emailValue, hashPassword(passwordValue), nameValue.slice(0, 80)],
    )
    return { ok: true, user: publicUser(rows[0]) }
  } catch (err) {
    if (err && err.code === '23505') {
      return { ok: false, status: 409, error: 'Такой email уже есть' }
    }
    throw err
  }
}
