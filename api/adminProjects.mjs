import { serviceEventStats } from './events.mjs'
import {
  applyDuePlanChanges,
  periodLinkCounts,
  planColumns,
  planSummary,
} from './plans.mjs'
import { query } from './db.js'

const LIST_LIMIT = 300

/**
 * Все проекты сервиса для админ-панели (с владельцем и счётчиками).
 * @param {string} [q]
 */
export async function listAdminProjects(q = '') {
  await applyDuePlanChanges()
  const needle = String(q ?? '').trim()
  const like = `%${needle.replace(/[%_]/g, '')}%`

  const { rows } = needle
    ? await query(
        `SELECT
           p.id, p.code, p.name, p.type, p.status, p.created_at, p.updated_at, ${planColumns('p')},
           u.id AS owner_id, u.login AS owner_login, u.name AS owner_name, u.email AS owner_email,
           (SELECT count(*) FROM templates t WHERE t.project_id = p.id)::int AS templates,
           (SELECT count(*) FROM links l WHERE l.project_id = p.id)::int AS links,
           (SELECT coalesce(sum(l.open_count), 0) FROM links l WHERE l.project_id = p.id)::int AS opens
         FROM projects p
         JOIN users u ON u.id = p.user_id
         WHERE p.name ILIKE $1
            OR p.code ILIKE $1
            OR u.login ILIKE $1
            OR u.name ILIKE $1
            OR COALESCE(u.email, '') ILIKE $1
         ORDER BY
           CASE
             WHEN lower(p.code) = lower($2) OR lower(u.login) = lower($2) THEN 0
             WHEN p.code ILIKE $3 OR u.login ILIKE $3 THEN 1
             ELSE 2
           END,
           p.created_at DESC
         LIMIT $4`,
        [like, needle, `${needle.replace(/[%_]/g, '')}%`, LIST_LIMIT],
      )
    : await query(
        `SELECT
           p.id, p.code, p.name, p.type, p.status, p.created_at, p.updated_at, ${planColumns('p')},
           u.id AS owner_id, u.login AS owner_login, u.name AS owner_name, u.email AS owner_email,
           (SELECT count(*) FROM templates t WHERE t.project_id = p.id)::int AS templates,
           (SELECT count(*) FROM links l WHERE l.project_id = p.id)::int AS links,
           (SELECT coalesce(sum(l.open_count), 0) FROM links l WHERE l.project_id = p.id)::int AS opens
         FROM projects p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC
         LIMIT $1`,
        [LIST_LIMIT],
      )

  const periodLinks = await periodLinkCounts(rows)
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owner: {
      id: row.owner_id,
      login: row.owner_login,
      name: row.owner_name || row.owner_login,
      email: row.owner_email ?? null,
    },
    stats: {
      templates: Number(row.templates ?? 0),
      links: Number(row.links ?? 0),
      opens: Number(row.opens ?? 0),
    },
    plan: planSummary(row, periodLinks.get(row.id) ?? 0),
  }))
}

/**
 * Сводка + событийная аналитика по всему сервису.
 * @param {{ from?: string, to?: string }} rangeInput
 */
export async function getAdminServiceStats(rangeInput) {
  const events = await serviceEventStats(rangeInput)
  const range = events.range

  const { rows: counts } = await query(
    `SELECT
       (SELECT count(*)::int FROM projects) AS projects,
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM templates) AS templates,
       (SELECT count(*)::int FROM links) AS links,
       (SELECT coalesce(sum(open_count), 0)::int FROM links) AS opens,
       (SELECT count(*)::int FROM links WHERE first_opened_at IS NOT NULL) AS opened_links`,
  )
  const c = counts[0] ?? {}

  const { rows: activeRows } = await query(
    `SELECT count(DISTINCT project_id)::int AS n
     FROM link_events
     WHERE created_at >= ($2::date)::timestamp AT TIME ZONE $1
       AND created_at < ($3::date + 1)::timestamp AT TIME ZONE $1`,
    ['Europe/Moscow', range.from, range.to],
  )

  return {
    templates: Number(c.templates ?? 0),
    links: Number(c.links ?? 0),
    opens: Number(c.opens ?? 0),
    openedLinks: Number(c.opened_links ?? 0),
    range: events.range,
    funnel: events.funnel,
    series: events.series,
    devices: events.devices,
    hours: events.hours,
    topics: events.topics,
    channels: events.channels,
    openRate: events.openRate,
    crmAfter: events.crmAfter,
    crmRecent: events.crmRecent,
    recent: events.recent,
    unopened: events.unopened,
    summary: {
      projects: Number(c.projects ?? 0),
      users: Number(c.users ?? 0),
      activeProjects: Number(activeRows[0]?.n ?? 0),
    },
  }
}
