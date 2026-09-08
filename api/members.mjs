import { query } from './db.js'
import { generatePublicId } from './links.mjs'
import { isEmail, normalizeEmail } from './users.mjs'

export const PROJECT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

export function canManageProject(project) {
  if (!project) return false
  const role = project.role || project.access_role
  return role !== 'member'
}

export function addMemberError({ ownerId, targetId, alreadyMember, blocked }) {
  if (!targetId) return 'Пользователь не найден'
  if (targetId === ownerId) return 'Этот человек уже владелец объекта'
  if (alreadyMember) return 'Уже в команде объекта'
  if (blocked) return 'Аккаунт заблокирован'
  return null
}

export function inviteEmailMismatch(inviteEmail, userEmail) {
  const expected = normalizeEmail(inviteEmail)
  if (!expected) return false
  return expected !== normalizeEmail(userEmail)
}

function mapMember(row) {
  return {
    id: row.id,
    email: row.email ?? null,
    name: row.name || row.login,
    login: row.login,
    role: row.role,
    joinedAt: row.joined_at,
  }
}

function mapInvite(row, extras = {}) {
  return {
    id: row.id,
    email: row.email ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? null,
    ...extras,
  }
}

export async function listProjectTeam(projectId) {
  const { rows: ownerRows } = await query(
    `SELECT u.id, u.email, u.name, u.login, 'owner'::text AS role, p.created_at AS joined_at
     FROM projects p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [projectId],
  )
  const { rows: memberRows } = await query(
    `SELECT u.id, u.email, u.name, u.login, m.role, m.created_at AS joined_at
     FROM project_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1
     ORDER BY m.created_at ASC`,
    [projectId],
  )
  const { rows: inviteRows } = await query(
    `SELECT id, email, created_at, expires_at, used_at
     FROM project_invites
     WHERE project_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 50`,
    [projectId],
  )
  return {
    members: [...ownerRows, ...memberRows].map(mapMember),
    invites: inviteRows.map((row) => mapInvite(row)),
  }
}

export async function addProjectMember({ projectId, ownerId, userId, invitedBy }) {
  const { rows: existing } = await query(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  const { rows: users } = await query(
    `SELECT id, login, email, name, is_blocked FROM users WHERE id = $1`,
    [userId],
  )
  const user = users[0]
  const error = addMemberError({
    ownerId,
    targetId: user?.id,
    alreadyMember: Boolean(existing[0]),
    blocked: Boolean(user?.is_blocked),
  })
  if (error) return { ok: false, status: error === 'Пользователь не найден' ? 404 : 400, error }
  await query(
    `INSERT INTO project_members (project_id, user_id, role, invited_by)
     VALUES ($1, $2, 'member', $3)`,
    [projectId, userId, invitedBy || null],
  )
  return {
    ok: true,
    member: mapMember({
      id: user.id,
      email: user.email,
      name: user.name,
      login: user.login,
      role: 'member',
      joined_at: new Date().toISOString(),
    }),
  }
}

export async function removeProjectMember({ projectId, ownerId, userId }) {
  if (!userId) return { ok: false, status: 400, error: 'Не указан пользователь' }
  if (userId === ownerId) return { ok: false, status: 400, error: 'Нельзя удалить владельца объекта' }
  const { rowCount } = await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  if (!Number(rowCount)) return { ok: false, status: 404, error: 'Участник не найден' }
  return { ok: true }
}

export async function leaveProject({ projectId, ownerId, userId }) {
  if (userId === ownerId) {
    return { ok: false, status: 400, error: 'Владелец не может покинуть объект' }
  }
  return removeProjectMember({ projectId, ownerId, userId })
}

export async function revokeProjectInvite({ projectId, inviteId }) {
  const id = String(inviteId ?? '').trim()
  if (!id) return { ok: false, status: 400, error: 'Не указано приглашение' }
  const { rowCount } = await query(
    `DELETE FROM project_invites
     WHERE id = $1 AND project_id = $2 AND used_at IS NULL`,
    [id, projectId],
  )
  if (!Number(rowCount)) return { ok: false, status: 404, error: 'Приглашение не найдено' }
  return { ok: true }
}

export async function createProjectInvite({ projectId, createdBy, email }) {
  const emailValue = normalizeEmail(email)
  if (!isEmail(emailValue)) {
    return { ok: false, status: 400, error: 'Укажите почту сотрудника' }
  }
  await query(
    `DELETE FROM project_invites
     WHERE project_id = $1 AND lower(email) = $2 AND used_at IS NULL`,
    [projectId, emailValue],
  )
  const token = generatePublicId(24)
  const expiresAt = new Date(Date.now() + PROJECT_INVITE_TTL_MS).toISOString()
  const { rows } = await query(
    `INSERT INTO project_invites (project_id, token, email, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, created_at, expires_at, used_at`,
    [projectId, token, emailValue, createdBy || null, expiresAt],
  )
  return { ok: true, invite: { ...mapInvite(rows[0]), token } }
}

async function findActiveUserByEmail(email) {
  const identity = normalizeEmail(email)
  if (!identity) return null
  const { rows } = await query(
    `SELECT id, login, email, name, is_blocked
     FROM users
     WHERE lower(email) = $1 OR lower(login) = $1`,
    [identity],
  )
  return rows[0] ?? null
}

export async function inviteOrAddMember({ project, actorId, email }) {
  const emailValue = normalizeEmail(email)
  if (!isEmail(emailValue)) {
    return { ok: false, status: 400, error: 'Укажите почту сотрудника' }
  }
  const existing = await findActiveUserByEmail(emailValue)
  if (existing) {
    const added = await addProjectMember({
      projectId: project.id,
      ownerId: project.user_id,
      userId: existing.id,
      invitedBy: actorId,
    })
    if (!added.ok) return added
    return { ok: true, added: true, member: added.member }
  }
  const created = await createProjectInvite({
    projectId: project.id,
    createdBy: actorId,
    email: emailValue,
  })
  if (!created.ok) return created
  return { ok: true, added: false, invite: created.invite }
}

export async function peekProjectInvite(token) {
  const value = String(token ?? '').trim()
  if (!value) return { ok: false, error: 'Нужно приглашение' }
  const { rows } = await query(
    `SELECT i.id, i.token, i.email, i.expires_at, i.used_at, i.project_id,
            p.code AS project_code, p.name AS project_name, p.user_id AS owner_id
     FROM project_invites i
     JOIN projects p ON p.id = i.project_id
     WHERE i.token = $1`,
    [value],
  )
  const row = rows[0]
  if (!row) return { ok: false, error: 'Приглашение недействительно' }
  if (row.used_at) return { ok: false, error: 'Приглашение уже использовано' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Срок приглашения истёк' }
  }
  const existing = row.email ? await findActiveUserByEmail(row.email) : null
  return {
    ok: true,
    id: row.id,
    email: row.email ?? null,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    ownerId: row.owner_id,
    existingUser: Boolean(existing),
    expiresAt: row.expires_at,
  }
}

export async function acceptProjectInvite({ token, userId, email }) {
  const peeked = await peekProjectInvite(token)
  if (!peeked.ok) return { ok: false, status: 400, error: peeked.error }
  if (inviteEmailMismatch(peeked.email, email)) {
    return { ok: false, status: 403, error: 'Приглашение выдано на другой email' }
  }
  const added = await addProjectMember({
    projectId: peeked.projectId,
    ownerId: peeked.ownerId,
    userId,
    invitedBy: null,
  })
  if (!added.ok && added.error !== 'Уже в команде объекта') {
    return added
  }
  await query(
    `UPDATE project_invites SET used_at = now(), used_by = $2 WHERE id = $1 AND used_at IS NULL`,
    [peeked.id, userId],
  )
  return {
    ok: true,
    alreadyMember: added.error === 'Уже в команде объекта',
    projectCode: peeked.projectCode,
    projectName: peeked.projectName,
    member: added.member ?? null,
  }
}
