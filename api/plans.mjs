import { query } from './db.mjs'

/**
 * Два продукта: Старт (конструктор V1) и Про (конструктор V2).
 * Ссылки без пакета и без сверхпакетной цены — прайс за продукт, не за объём.
 */
export const PLANS = [
  {
    id: 'start',
    name: 'Старт',
    price: 11900,
    constructor: 'v1',
  },
  {
    id: 'pro',
    name: 'Про',
    price: 29900,
    constructor: 'v2',
  },
]

export const DEFAULT_PLAN = 'start'

/** Старые уровни по объёму → Про. */
const LEGACY_PLAN_IDS = {
  flow: 'pro',
  max: 'pro',
}

const PLAN_BY_ID = new Map(PLANS.map((plan) => [plan.id, plan]))

export function normalizePlanId(id) {
  const raw = typeof id === 'string' ? id.trim() : ''
  if (PLAN_BY_ID.has(raw)) return raw
  return LEGACY_PLAN_IDS[raw] ?? DEFAULT_PLAN
}

export function planById(id) {
  return PLAN_BY_ID.get(normalizePlanId(id)) ?? PLAN_BY_ID.get(DEFAULT_PLAN)
}

export function isPlanUpgrade(fromId, toId) {
  return planById(toId).price > planById(fromId).price
}

export function addMonths(date, count) {
  const day = date.getUTCDate()
  const shifted = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + count,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
  const daysInMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate()
  shifted.setUTCDate(Math.min(day, daysInMonth))
  return shifted
}

/** Расчётный период привязан ко дню подключения, а не к первому числу месяца. */
export function currentPeriod(anchorInput, nowInput) {
  const anchor = new Date(anchorInput)
  const now = nowInput ? new Date(nowInput) : new Date()
  if (Number.isNaN(anchor.getTime())) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { start, end: addMonths(start, 1) }
  }

  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth())
  if (months < 0) months = 0
  while (months > 0 && addMonths(anchor, months) > now) months -= 1
  while (addMonths(anchor, months + 1) <= now) months += 1

  return { start: addMonths(anchor, months), end: addMonths(anchor, months + 1) }
}

/** Счётчик ссылок за период — для статистики; на сумму не влияет. */
export function usageSummary(planId, used) {
  const plan = planById(planId)
  const links = Math.max(0, Number(used) || 0)
  return {
    links,
    unlimited: true,
    included: null,
    remaining: null,
    overage: 0,
    overageCost: 0,
    base: plan.price,
    total: plan.price,
    share: 0,
  }
}

export function planColumns(prefix = '') {
  const p = prefix ? `${prefix}.` : ''
  return `${p}plan, ${p}plan_period_start, ${p}pending_plan, ${p}pending_effective_at`
}

/**
 * Понижения включаются с конца оплаченного периода. Расписания нет,
 * поэтому наступившие переходы применяем при любом чтении проектов.
 */
export async function applyDuePlanChanges() {
  await query(
    `UPDATE projects
     SET plan = pending_plan,
         pending_plan = NULL,
         pending_effective_at = NULL,
         updated_at = now()
     WHERE pending_plan IS NOT NULL AND pending_effective_at <= now()`,
  )
}

async function planRow(projectId) {
  const { rows } = await query(
    `SELECT id, ${planColumns()} FROM projects WHERE id = $1`,
    [projectId],
  )
  return rows[0] ?? null
}

export async function periodLinkCount(projectId, period) {
  const { rows } = await query(
    `SELECT count(*)::int AS links
     FROM links
     WHERE project_id = $1 AND created_at >= $2 AND created_at < $3`,
    [projectId, period.start.toISOString(), period.end.toISOString()],
  )
  return Number(rows[0]?.links ?? 0)
}

/** Расход за текущий период сразу по нескольким проектам — без запроса на каждый. */
export async function periodLinkCounts(rows) {
  const usable = rows.filter((row) => row?.id && row.plan_period_start)
  if (!usable.length) return new Map()

  const ids = []
  const starts = []
  const ends = []
  for (const row of usable) {
    const period = currentPeriod(row.plan_period_start)
    ids.push(row.id)
    starts.push(period.start.toISOString())
    ends.push(period.end.toISOString())
  }

  const { rows: counts } = await query(
    `SELECT l.project_id, count(*)::int AS links
     FROM links l
     JOIN unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[]) AS r(pid, starts_at, ends_at)
       ON r.pid = l.project_id
     WHERE l.created_at >= r.starts_at AND l.created_at < r.ends_at
     GROUP BY l.project_id`,
    [ids, starts, ends],
  )

  const byProject = new Map(counts.map((row) => [row.project_id, Number(row.links)]))
  return new Map(usable.map((row) => [row.id, byProject.get(row.id) ?? 0]))
}

/** Компактная сводка для карточек проекта и баннера в кабинете. */
export function planSummary(row, used) {
  const plan = planById(row?.plan)
  const period = currentPeriod(row?.plan_period_start ?? row?.created_at ?? new Date())
  const usage = usageSummary(plan.id, used)
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    constructor: plan.constructor,
    unlimited: true,
    included: null,
    used: usage.links,
    remaining: null,
    overage: 0,
    overageCost: 0,
    total: usage.total,
    share: 0,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    pendingPlan: row?.pending_plan ? normalizePlanId(row.pending_plan) : null,
    pendingEffectiveAt: row?.pending_effective_at
      ? new Date(row.pending_effective_at).toISOString()
      : null,
  }
}

export async function listPlanChanges(projectId) {
  const { rows } = await query(
    `SELECT id, from_plan, to_plan, kind, effective_at, created_at
     FROM plan_changes
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [projectId],
  )
  return rows.map((row) => ({
    id: row.id,
    fromPlan: normalizePlanId(row.from_plan),
    toPlan: normalizePlanId(row.to_plan),
    fromName: planById(row.from_plan).name,
    toName: planById(row.to_plan).name,
    kind: row.kind,
    effectiveAt: new Date(row.effective_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }))
}

function catalogFor(currentPlanId) {
  return PLANS.map((plan) => ({
    ...plan,
    current: plan.id === currentPlanId,
  }))
}

export async function loadProjectPlan(projectId) {
  await applyDuePlanChanges()
  const row = await planRow(projectId)
  if (!row) return null

  const period = currentPeriod(row.plan_period_start)
  const used = await periodLinkCount(projectId, period)
  const plan = planById(row.plan)

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      constructor: plan.constructor,
    },
    plans: catalogFor(plan.id),
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    usage: usageSummary(plan.id, used),
    pending: row.pending_plan
      ? {
          plan: normalizePlanId(row.pending_plan),
          name: planById(row.pending_plan).name,
          effectiveAt: new Date(row.pending_effective_at).toISOString(),
        }
      : null,
    history: await listPlanChanges(projectId),
  }
}

/**
 * Переход инициирует клиент. Пока оплаты нет — смена тарифа только через
 * adminSetProjectPlan (панель пользователей). Этот путь оставлен на будущее.
 */
export async function changeProjectPlan(project, userId, requestedId) {
  return {
    error: 'Смена тарифа пока только через администратора 2wel',
    status: 403,
  }
}

/**
 * Админ включает Старт / Про сразу (пилот без оплаты).
 * В истории kind = upgrade|downgrade (constraint миграции 011).
 */
export async function adminSetProjectPlan(project, adminUserId, requestedId) {
  await applyDuePlanChanges()
  const row = await planRow(project.id)
  if (!row) return { error: 'project not found', status: 404 }

  const wanted = normalizePlanId(typeof requestedId === 'string' ? requestedId.trim() : '')
  if (!PLAN_BY_ID.has(wanted)) {
    return { error: 'unknown plan', status: 400 }
  }

  const current = planById(row.plan)
  const next = planById(wanted)

  if (next.id === current.id && !row.pending_plan) {
    return { error: 'plan already active', status: 400 }
  }

  const kind = next.id === current.id ? 'cancelled' : isPlanUpgrade(current.id, next.id) ? 'upgrade' : 'downgrade'

  await query(
    `UPDATE projects
     SET plan = $2,
         pending_plan = NULL,
         pending_effective_at = NULL,
         updated_at = now()
     WHERE id = $1`,
    [project.id, next.id],
  )
  await query(
    `INSERT INTO plan_changes (project_id, user_id, from_plan, to_plan, kind, effective_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [project.id, adminUserId ?? null, current.id, next.id, kind],
  )
  return { ok: true, plan: await loadProjectPlan(project.id) }
}

export function constructorForPlan(planId) {
  return planById(planId).constructor
}
