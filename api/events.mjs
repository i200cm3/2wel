import { query } from './db.mjs'

export const EVENT_TYPES = ['open', 'autoplay', 'menu', 'whatsapp', 'topic', 'contact']
const CONTACT_CHANNELS = ['whatsapp', 'telegram', 'max', 'tel', 'sms', 'site', 'other']
const CONTACT_LABEL = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  max: 'MAX',
  tel: 'Звонок',
  sms: 'SMS',
  site: 'Сайт',
  other: 'Ссылка',
}
const MOSCOW = 'Europe/Moscow'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 366
const DEFAULT_RANGE_DAYS = 14
const TOPIC_RE = /^[a-zA-Z0-9_-]{1,64}$/
const CONTACT_SET = new Set(CONTACT_CHANNELS)

export function parseTopic(value) {
  const s = String(value ?? '').trim()
  return TOPIC_RE.test(s) ? s : null
}

export function parseContactChannel(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return CONTACT_SET.has(s) ? s : null
}

function putLabel(labels, id, label) {
  const key = parseTopic(id)
  const text = typeof label === 'string' ? label.trim() : ''
  if (!key || !text) return
  labels[key] = text
}

/** id последовательности → подпись из меню (то, что нажимает гость) или из блока. */
export function topicLabelsFromConfig(config) {
  const labels = {}
  if (!config || typeof config !== 'object') return labels
  const sequences = config.sequences
  if (sequences && typeof sequences === 'object') {
    for (const [id, seq] of Object.entries(sequences)) {
      putLabel(labels, id, seq && typeof seq === 'object' ? seq.label : '')
    }
  }
  const takeBranches = (branches) => {
    if (!Array.isArray(branches)) return
    for (const branch of branches) {
      if (!branch || typeof branch !== 'object') continue
      putLabel(labels, branch.sequenceId, branch.label)
    }
  }
  takeBranches(config.branches)
  const menus = config.menus
  if (menus && typeof menus === 'object') {
    for (const menu of Object.values(menus)) {
      if (menu && typeof menu === 'object') takeBranches(menu.branches)
    }
  }
  return labels
}

export function deviceFromUa(ua) {
  const s = String(ua ?? '').toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(s) || (/android/.test(s) && !/mobile/.test(s))) return 'tablet'
  if (/mobi|iphone|ipod|android|webos|blackberry|opera mini|iemobile/.test(s)) return 'phone'
  return 'desktop'
}

export function userAgentOf(req) {
  const raw = req.headers?.['user-agent']
  const value = Array.isArray(raw) ? raw[0] : raw
  return String(value ?? '').slice(0, 300)
}

export async function recordLinkEvent({ linkId, projectId, type, userAgent, device, topic }) {
  if (!EVENT_TYPES.includes(type)) return
  let topicId = null
  if (type === 'topic') {
    topicId = parseTopic(topic)
    if (!topicId) return
  } else if (type === 'contact') {
    topicId = parseContactChannel(topic)
    if (!topicId) return
  }
  const ua = String(userAgent ?? '').slice(0, 300)
  const kind = device === 'phone' || device === 'tablet' || device === 'desktop' ? device : deviceFromUa(ua)
  await query(
    `INSERT INTO link_events (link_id, project_id, type, device, user_agent, topic)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [linkId, projectId, type, kind, ua || null, topicId],
  )
}

export function parseDay(value) {
  const s = String(value ?? '').slice(0, 10)
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return s
}

export function addCalendarDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function todayInZone(timeZone = MOSCOW, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function dayCount(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1
}

export function daysInRange(from, to) {
  const days = []
  let cur = from
  while (cur <= to) {
    days.push(cur)
    cur = addCalendarDays(cur, 1)
    if (days.length > MAX_RANGE_DAYS) break
  }
  return days
}

export function resolveStatsRange({ from, to } = {}, now = new Date()) {
  const today = todayInZone(MOSCOW, now)
  let start = parseDay(from)
  let end = parseDay(to)
  if (!start && !end) {
    end = today
    start = addCalendarDays(today, -(DEFAULT_RANGE_DAYS - 1))
  } else if (start && !end) {
    end = start
  } else if (!start && end) {
    start = addCalendarDays(end, -(DEFAULT_RANGE_DAYS - 1))
  }
  if (start > end) {
    const tmp = start
    start = end
    end = tmp
  }
  if (end > today) end = today
  if (start > end) start = end
  if (dayCount(start, end) > MAX_RANGE_DAYS) {
    start = addCalendarDays(end, -(MAX_RANGE_DAYS - 1))
  }
  return { from: start, to: end }
}

function emptyFunnel() {
  return { open: 0, autoplay: 0, menu: 0, whatsapp: 0, contact: 0 }
}

/** Старые клики WhatsApp без type=contact — считаем как связь. */
function applyContactLegacy(funnel) {
  if ((funnel.contact ?? 0) === 0 && (funnel.whatsapp ?? 0) > 0) {
    funnel.contact = funnel.whatsapp
  }
  return funnel
}

const RANGE_SQL = `created_at >= ($3::date)::timestamp AT TIME ZONE $2
       AND created_at < ($4::date + 1)::timestamp AT TIME ZONE $2`

export async function projectEventStats(projectId, rangeInput) {
  const range = resolveStatsRange(rangeInput)
  const params = [projectId, MOSCOW, range.from, range.to]

  const { rows: totals } = await query(
    `SELECT type, count(*)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND ${RANGE_SQL}
     GROUP BY type`,
    params,
  )
  const funnel = emptyFunnel()
  for (const row of totals) {
    if (row.type in funnel) funnel[row.type] = Number(row.n)
  }
  applyContactLegacy(funnel)

  const { rows: byDay } = await query(
    `SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
            type,
            count(*)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND ${RANGE_SQL}
     GROUP BY 1, 2`,
    params,
  )
  const dayMap = new Map()
  for (const row of byDay) {
    const day = String(row.day ?? '').slice(0, 10)
    if (!DAY_RE.test(day)) continue
    const cur = dayMap.get(day) ?? emptyFunnel()
    if (row.type in cur) cur[row.type] = Number(row.n)
    dayMap.set(day, cur)
  }
  const series = daysInRange(range.from, range.to).map((date) => {
    const day = applyContactLegacy({ ...(dayMap.get(date) ?? emptyFunnel()) })
    return { date, ...day }
  })

  const { rows: devices } = await query(
    `SELECT device, count(*)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND type = 'open'
       AND ${RANGE_SQL}
     GROUP BY device`,
    params,
  )
  const deviceCounts = { phone: 0, tablet: 0, desktop: 0 }
  for (const row of devices) {
    if (row.device in deviceCounts) deviceCounts[row.device] = Number(row.n)
  }

  const { rows: hours } = await query(
    `SELECT extract(hour from created_at AT TIME ZONE $2)::int AS hour,
            count(*)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND type = 'open'
       AND ${RANGE_SQL}
     GROUP BY 1
     ORDER BY 1`,
    params,
  )
  const hourMap = new Map(hours.map((row) => [Number(row.hour), Number(row.n)]))
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, opens: hourMap.get(hour) ?? 0 }))

  const { rows: recent } = await query(
    `SELECT e.created_at, e.type, e.device, e.topic, l.guest_name, l.public_id
     FROM link_events e
     JOIN links l ON l.id = e.link_id
     WHERE e.project_id = $1
       AND e.created_at >= ($3::date)::timestamp AT TIME ZONE $2
       AND e.created_at < ($4::date + 1)::timestamp AT TIME ZONE $2
     ORDER BY e.created_at DESC
     LIMIT 200`,
    params,
  )

  const { rows: topicRows } = await query(
    `SELECT topic,
            count(*)::int AS opens,
            count(DISTINCT link_id)::int AS guests
     FROM link_events
     WHERE project_id = $1
       AND type = 'topic'
       AND topic IS NOT NULL
       AND ${RANGE_SQL}
     GROUP BY topic
     ORDER BY guests DESC, opens DESC, topic ASC`,
    params,
  )

  const { rows: openGuestRows } = await query(
    `SELECT count(DISTINCT link_id)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND type = 'open'
       AND ${RANGE_SQL}`,
    params,
  )
  const openedGuests = Number(openGuestRows[0]?.n ?? 0)

  const { rows: templateRows } = await query(
    `SELECT config FROM templates WHERE project_id = $1`,
    [projectId],
  )
  const topicLabels = {}
  for (const row of templateRows) {
    Object.assign(topicLabels, topicLabelsFromConfig(row.config))
  }

  const topics = topicRows.map((row) => {
    const id = String(row.topic ?? '')
    const guests = Number(row.guests)
    return {
      id,
      label: topicLabels[id] || id,
      opens: Number(row.opens),
      guests,
      share: openedGuests ? guests / openedGuests : 0,
    }
  })

  const { rows: contactRows } = await query(
    `SELECT topic AS channel, count(*)::int AS n
     FROM link_events
     WHERE project_id = $1
       AND type = 'contact'
       AND topic IS NOT NULL
       AND ${RANGE_SQL}
     GROUP BY topic`,
    params,
  )
  const channelCounts = Object.fromEntries(CONTACT_CHANNELS.map((id) => [id, 0]))
  for (const row of contactRows) {
    const id = parseContactChannel(row.channel)
    if (id) channelCounts[id] = Number(row.n)
  }
  // Старые клики WhatsApp без type=contact — учитываем в каналах.
  if (channelCounts.whatsapp === 0 && funnel.whatsapp > 0) {
    channelCounts.whatsapp = funnel.whatsapp
  }
  const channels = CONTACT_CHANNELS.filter((id) => channelCounts[id] > 0).map((id) => ({
    id,
    clicks: channelCounts[id],
  }))

  const { rows: issuedRows } = await query(
    `SELECT count(*)::int AS issued,
            count(*) FILTER (WHERE first_opened_at IS NOT NULL)::int AS opened
     FROM links
     WHERE project_id = $1
       AND created_at >= ($2::date)::timestamp AT TIME ZONE $4
       AND created_at < ($3::date + 1)::timestamp AT TIME ZONE $4`,
    [projectId, range.from, range.to, MOSCOW],
  )
  const openRate = {
    opened: Number(issuedRows[0]?.opened ?? 0),
    issued: Number(issuedRows[0]?.issued ?? 0),
  }

  const { rows: unopenedRows } = await query(
    `SELECT guest_name, public_id, created_at
     FROM links
     WHERE project_id = $1
       AND first_opened_at IS NULL
       AND created_at >= ($2::date)::timestamp AT TIME ZONE $4
       AND created_at < ($3::date + 1)::timestamp AT TIME ZONE $4
     ORDER BY created_at DESC
     LIMIT 100`,
    [projectId, range.from, range.to, MOSCOW],
  )
  const unopened = unopenedRows.map((row) => ({
    at: row.created_at,
    guestName: row.guest_name,
    publicId: row.public_id,
  }))

  const CRM_RANGE_SQL = `e.created_at >= ($3::date)::timestamp AT TIME ZONE $2
       AND e.created_at < ($4::date + 1)::timestamp AT TIME ZONE $2`

  const { rows: crmAfterRows } = await query(
    `SELECT e.last_event_type AS type, count(*)::int AS n
     FROM link_crm_events e
     JOIN links l ON l.id = e.link_id
     WHERE l.project_id = $1
       AND e.last_event_type IS NOT NULL
       AND ${CRM_RANGE_SQL}
     GROUP BY e.last_event_type`,
    params,
  )
  const crmAfterCounts = Object.fromEntries(EVENT_TYPES.map((id) => [id, 0]))
  let crmAfterNone = 0
  for (const row of crmAfterRows) {
    const type = String(row.type ?? '')
    if (type in crmAfterCounts) crmAfterCounts[type] = Number(row.n)
  }
  const { rows: crmNoneRows } = await query(
    `SELECT count(*)::int AS n
     FROM link_crm_events e
     JOIN links l ON l.id = e.link_id
     WHERE l.project_id = $1
       AND e.last_event_type IS NULL
       AND ${CRM_RANGE_SQL}`,
    params,
  )
  crmAfterNone = Number(crmNoneRows[0]?.n ?? 0)
  const crmAfter = [
    ...EVENT_TYPES.filter((id) => crmAfterCounts[id] > 0).map((id) => ({
      eventType: id,
      count: crmAfterCounts[id],
    })),
    ...(crmAfterNone > 0 ? [{ eventType: 'none', count: crmAfterNone }] : []),
  ]

  const { rows: crmRecentRows } = await query(
    `SELECT e.created_at, e.status_id, e.pipeline_id, e.last_event_type, e.last_event_at,
            e.prior_types, l.guest_name, l.public_id, m.label AS status_label
     FROM link_crm_events e
     JOIN links l ON l.id = e.link_id
     LEFT JOIN amo_status_maps m
       ON m.project_id = l.project_id AND m.status_id = e.status_id
     WHERE l.project_id = $1
       AND ${CRM_RANGE_SQL}
     ORDER BY e.created_at DESC
     LIMIT 30`,
    params,
  )
  const crmRecent = crmRecentRows.map((row) => {
    const prior = Array.isArray(row.prior_types) ? row.prior_types.map(String) : []
    return {
      at: row.created_at,
      statusId: String(row.status_id ?? ''),
      statusLabel: row.status_label ? String(row.status_label) : null,
      pipelineId: row.pipeline_id != null ? String(row.pipeline_id) : null,
      lastEventType: row.last_event_type ? String(row.last_event_type) : null,
      lastEventAt: row.last_event_at ?? null,
      priorTypes: prior,
      guestName: row.guest_name,
      publicId: row.public_id,
    }
  })

  return {
    range,
    funnel,
    series,
    devices: deviceCounts,
    hours: byHour,
    topics,
    channels,
    openRate,
    crmAfter,
    crmRecent,
    unopened,
    recent: recent.map((row) => {
      const topic = row.topic ? String(row.topic) : null
      const topicLabel =
        row.type === 'contact'
          ? CONTACT_LABEL[topic] || topic
          : topic
            ? topicLabels[topic] || topic
            : null
      return {
        at: row.created_at,
        type: row.type,
        device: row.device,
        guestName: row.guest_name,
        publicId: row.public_id,
        topic,
        topicLabel,
      }
    }),
  }
}

export function resolveLinkStatsRange(linkCreatedAt, rangeInput, now = new Date()) {
  const today = todayInZone(MOSCOW, now)
  const fromParam = parseDay(rangeInput?.from)
  const toParam = parseDay(rangeInput?.to)
  if (fromParam || toParam) {
    const range = resolveStatsRange(rangeInput, now)
    const linkDay = linkCreatedAt ? parseDay(String(linkCreatedAt).slice(0, 10)) : null
    if (linkDay && linkDay > range.from) range.from = linkDay
    return range
  }
  const linkDay =
    linkCreatedAt && parseDay(String(linkCreatedAt).slice(0, 10))
      ? parseDay(String(linkCreatedAt).slice(0, 10))
      : addCalendarDays(today, -(DEFAULT_RANGE_DAYS - 1))
  const from = linkDay > today ? today : linkDay
  return { from, to: today }
}

function mapRecentEvent(row, topicLabels) {
  const topic = row.topic ? String(row.topic) : null
  const topicLabel =
    row.type === 'contact'
      ? CONTACT_LABEL[topic] || topic
      : topic
        ? topicLabels[topic] || topic
        : null
  return {
    at: row.created_at,
    type: row.type,
    device: row.device,
    guestName: row.guest_name,
    publicId: row.public_id,
    topic,
    topicLabel,
  }
}

export async function linkEventStats(linkId, projectId, rangeInput, linkCreatedAt, templateConfig) {
  const range = resolveLinkStatsRange(linkCreatedAt, rangeInput)
  const params = [linkId, projectId, MOSCOW, range.from, range.to]
  const WHERE = `link_id = $1
       AND project_id = $2
       AND created_at >= ($4::date)::timestamp AT TIME ZONE $3
       AND created_at < ($5::date + 1)::timestamp AT TIME ZONE $3`

  const { rows: totals } = await query(
    `SELECT type, count(*)::int AS n
     FROM link_events
     WHERE ${WHERE}
     GROUP BY type`,
    params,
  )
  const funnel = emptyFunnel()
  for (const row of totals) {
    if (row.type in funnel) funnel[row.type] = Number(row.n)
  }
  applyContactLegacy(funnel)

  const { rows: byDay } = await query(
    `SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
            type,
            count(*)::int AS n
     FROM link_events
     WHERE ${WHERE}
     GROUP BY 1, 2`,
    params,
  )
  const dayMap = new Map()
  for (const row of byDay) {
    const day = String(row.day ?? '').slice(0, 10)
    if (!DAY_RE.test(day)) continue
    const cur = dayMap.get(day) ?? emptyFunnel()
    if (row.type in cur) cur[row.type] = Number(row.n)
    dayMap.set(day, cur)
  }
  const series = daysInRange(range.from, range.to).map((date) => {
    const day = applyContactLegacy({ ...(dayMap.get(date) ?? emptyFunnel()) })
    return { date, ...day }
  })

  const { rows: devices } = await query(
    `SELECT device, count(*)::int AS n
     FROM link_events
     WHERE ${WHERE}
       AND type = 'open'
     GROUP BY device`,
    params,
  )
  const deviceCounts = { phone: 0, tablet: 0, desktop: 0 }
  for (const row of devices) {
    if (row.device in deviceCounts) deviceCounts[row.device] = Number(row.n)
  }

  const { rows: hours } = await query(
    `SELECT extract(hour from created_at AT TIME ZONE $3)::int AS hour,
            count(*)::int AS n
     FROM link_events
     WHERE ${WHERE}
       AND type = 'open'
     GROUP BY 1
     ORDER BY 1`,
    params,
  )
  const hourMap = new Map(hours.map((row) => [Number(row.hour), Number(row.n)]))
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, opens: hourMap.get(hour) ?? 0 }))

  const topicLabels = topicLabelsFromConfig(templateConfig)

  const { rows: topicRows } = await query(
    `SELECT topic, count(*)::int AS opens
     FROM link_events
     WHERE ${WHERE}
       AND type = 'topic'
       AND topic IS NOT NULL
     GROUP BY topic
     ORDER BY opens DESC, topic ASC`,
    params,
  )
  const openCount = funnel.open
  const topics = topicRows.map((row) => {
    const id = String(row.topic ?? '')
    const opens = Number(row.opens)
    return {
      id,
      label: topicLabels[id] || id,
      opens,
      guests: opens > 0 ? 1 : 0,
      share: openCount ? Math.min(1, opens / openCount) : 0,
    }
  })

  const { rows: contactRows } = await query(
    `SELECT topic AS channel, count(*)::int AS n
     FROM link_events
     WHERE ${WHERE}
       AND type = 'contact'
       AND topic IS NOT NULL
     GROUP BY topic`,
    params,
  )
  const channelCounts = Object.fromEntries(CONTACT_CHANNELS.map((id) => [id, 0]))
  for (const row of contactRows) {
    const id = parseContactChannel(row.channel)
    if (id) channelCounts[id] = Number(row.n)
  }
  if (channelCounts.whatsapp === 0 && funnel.whatsapp > 0) {
    channelCounts.whatsapp = funnel.whatsapp
  }
  const channels = CONTACT_CHANNELS.filter((id) => channelCounts[id] > 0).map((id) => ({
    id,
    clicks: channelCounts[id],
  }))

  const { rows: recent } = await query(
    `SELECT e.created_at, e.type, e.device, e.topic, l.guest_name, l.public_id
     FROM link_events e
     JOIN links l ON l.id = e.link_id
     WHERE e.link_id = $1
       AND e.project_id = $2
       AND e.created_at >= ($4::date)::timestamp AT TIME ZONE $3
       AND e.created_at < ($5::date + 1)::timestamp AT TIME ZONE $3
     ORDER BY e.created_at DESC
     LIMIT 50`,
    params,
  )

  return {
    range,
    funnel,
    series,
    devices: deviceCounts,
    hours: byHour,
    topics,
    channels,
    recent: recent.map((row) => mapRecentEvent(row, topicLabels)),
  }
}
