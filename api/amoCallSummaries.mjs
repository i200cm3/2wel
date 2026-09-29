import { query } from './db.js'
import { rewriteClientAsGuest } from './guestWording.mjs'

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    callNoteId: row.call_note_id,
    recordingUrl: row.recording_url || null,
    transcript: row.transcript || null,
    summaryOutcome: rewriteClientAsGuest(row.summary_outcome) || null,
    summaryNextStep: rewriteClientAsGuest(row.summary_next_step) || null,
    summaryNoteId: row.summary_note_id || null,
    operatorReviewMiss: rewriteClientAsGuest(row.operator_review_miss) || null,
    operatorReviewDetail: rewriteClientAsGuest(row.operator_review_detail) || null,
    operatorReviewNoteId: row.operator_review_note_id || null,
    insightsIntent: row.insights_intent || null,
    insightsDeclineReason: row.insights_decline_reason || null,
    insightsTopics: row.insights_topics ?? null,
    insightsFacts: row.insights_facts ?? null,
    insightsNeedsFollowUp:
      row.insights_needs_follow_up == null ? null : Boolean(row.insights_needs_follow_up),
    insightsAt: row.insights_at || null,
    followUpStatus: row.follow_up_status || null,
    followUpDueAt: row.follow_up_due_at || null,
    followUpDoneAt: row.follow_up_done_at || null,
    status: row.status,
    skipReason: row.skip_reason || null,
    error: row.error || null,
    pipelineId: row.pipeline_id || null,
    statusId: row.status_id || null,
    durationSec: row.duration_sec != null ? Number(row.duration_sec) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Создать или вернуть существующую запись. */
export async function claimAmoCallSummary({
  projectId,
  leadId,
  callNoteId,
  recordingUrl = null,
  pipelineId = null,
  statusId = null,
  durationSec = null,
}) {
  const { rows } = await query(
    `INSERT INTO amo_call_summaries (
       project_id, lead_id, call_note_id, recording_url,
       pipeline_id, status_id, duration_sec, status, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', now())
     ON CONFLICT (project_id, call_note_id) DO UPDATE
       SET lead_id = COALESCE(NULLIF(EXCLUDED.lead_id, ''), amo_call_summaries.lead_id),
           recording_url = COALESCE(EXCLUDED.recording_url, amo_call_summaries.recording_url),
           pipeline_id = COALESCE(EXCLUDED.pipeline_id, amo_call_summaries.pipeline_id),
           status_id = COALESCE(EXCLUDED.status_id, amo_call_summaries.status_id),
           duration_sec = COALESCE(EXCLUDED.duration_sec, amo_call_summaries.duration_sec),
           updated_at = now()
     RETURNING *`,
    [
      projectId,
      String(leadId ?? '').trim(),
      String(callNoteId ?? '').trim(),
      recordingUrl ? String(recordingUrl).trim() : null,
      pipelineId ? String(pipelineId).trim() : null,
      statusId ? String(statusId).trim() : null,
      Number.isFinite(durationSec) && durationSec > 0 ? Math.floor(durationSec) : null,
    ],
  )
  return mapRow(rows[0])
}

export async function getAmoCallSummary(projectId, callNoteId) {
  const { rows } = await query(
    `SELECT * FROM amo_call_summaries
     WHERE project_id = $1 AND call_note_id = $2`,
    [projectId, String(callNoteId ?? '').trim()],
  )
  return mapRow(rows[0])
}

/**
 * Атомарно взять в работу: pending / failed, либо skipped из‑за
 * no_lead / no_recording_url / recording_unavailable (Sipuni дописывает запись с задержкой).
 */
export async function markAmoCallSummaryRunning(projectId, callNoteId) {
  const { rows } = await query(
    `UPDATE amo_call_summaries
     SET status = 'running', error = NULL, skip_reason = NULL, updated_at = now()
     WHERE project_id = $1
       AND call_note_id = $2
       AND (
         status IN ('pending', 'failed')
         OR (
           status = 'skipped'
           AND skip_reason IN ('no_lead', 'no_recording_url', 'recording_unavailable')
         )
       )
     RETURNING *`,
    [projectId, String(callNoteId ?? '').trim()],
  )
  return mapRow(rows[0])
}

export async function patchAmoCallSummary(projectId, callNoteId, patch = {}) {
  const fields = []
  const values = [projectId, String(callNoteId ?? '').trim()]
  const add = (column, value) => {
    values.push(value)
    fields.push(`${column} = $${values.length}`)
  }

  if ('status' in patch) add('status', patch.status)
  if ('skipReason' in patch) add('skip_reason', patch.skipReason)
  if ('error' in patch) add('error', patch.error)
  if ('recordingUrl' in patch) add('recording_url', patch.recordingUrl)
  if ('transcript' in patch) add('transcript', patch.transcript)
  if ('summaryOutcome' in patch) add('summary_outcome', patch.summaryOutcome)
  if ('summaryNextStep' in patch) add('summary_next_step', patch.summaryNextStep)
  if ('summaryNoteId' in patch) add('summary_note_id', patch.summaryNoteId)
  if ('operatorReviewMiss' in patch) add('operator_review_miss', patch.operatorReviewMiss)
  if ('operatorReviewDetail' in patch) add('operator_review_detail', patch.operatorReviewDetail)
  if ('operatorReviewNoteId' in patch) add('operator_review_note_id', patch.operatorReviewNoteId)
  if ('insights' in patch) {
    const insights = patch.insights
    if (insights == null) {
      add('insights_intent', null)
      add('insights_decline_reason', null)
      add('insights_topics', null)
      add('insights_facts', null)
      add('insights_needs_follow_up', null)
      add('insights_at', null)
    } else {
      add('insights_intent', insights.intent ?? null)
      add('insights_decline_reason', insights.declineReason ?? null)
      values.push(JSON.stringify(insights.topics ?? []))
      fields.push(`insights_topics = $${values.length}::jsonb`)
      values.push(JSON.stringify(insights.facts ?? {}))
      fields.push(`insights_facts = $${values.length}::jsonb`)
      add('insights_needs_follow_up', Boolean(insights.needsFollowUp))
      add('insights_at', new Date().toISOString())
      if (insights.needsFollowUp) {
        // Не переоткрываем уже закрытые; срок — +1 сутки, если ещё не задан.
        fields.push(`follow_up_status = CASE WHEN follow_up_status = 'done' THEN 'done' ELSE 'open' END`)
        fields.push(
          `follow_up_due_at = CASE WHEN follow_up_status = 'done' THEN follow_up_due_at ELSE COALESCE(follow_up_due_at, now() + interval '1 day') END`,
        )
      }
    }
  }
  if ('followUpStatus' in patch) {
    const status = String(patch.followUpStatus ?? '').trim()
    if (status === 'open') {
      add('follow_up_status', 'open')
      add('follow_up_done_at', null)
      if ('followUpDueAt' in patch) {
        add('follow_up_due_at', patch.followUpDueAt)
      } else {
        fields.push(`follow_up_due_at = COALESCE(follow_up_due_at, now() + interval '1 day')`)
      }
    } else if (status === 'done') {
      add('follow_up_status', 'done')
      add('follow_up_done_at', new Date().toISOString())
    } else if (status === '' || status === 'none' || status === 'null') {
      add('follow_up_status', null)
      add('follow_up_due_at', null)
      add('follow_up_done_at', null)
    }
  }
  if ('followUpDueAt' in patch && !('followUpStatus' in patch)) {
    add('follow_up_due_at', patch.followUpDueAt)
  }
  if ('pipelineId' in patch) add('pipeline_id', patch.pipelineId)
  if ('statusId' in patch) add('status_id', patch.statusId)
  if ('durationSec' in patch) add('duration_sec', patch.durationSec)
  if ('leadId' in patch) add('lead_id', patch.leadId)

  if (!fields.length) return getAmoCallSummary(projectId, callNoteId)

  fields.push('updated_at = now()')
  const { rows } = await query(
    `UPDATE amo_call_summaries
     SET ${fields.join(', ')}
     WHERE project_id = $1 AND call_note_id = $2
     RETURNING *`,
    values,
  )
  return mapRow(rows[0])
}

function mapListRow(row) {
  const full = mapRow(row)
  if (!full) return null
  const { transcript, ...rest } = full
  return {
    ...rest,
    hasTranscript: Boolean(transcript && String(transcript).trim()),
    transcriptPreview: transcript ? String(transcript).trim().slice(0, 160) : null,
  }
}

/**
 * Сделки «тёплые без брони»: ≥3 звонка, тёплый intent, бронь не закрыта.
 * Возвращает SELECT lead_id (без WITH) — для IN (…) и CTE.
 * `scopeWhere` — условие по amo_call_summaries с плейсхолдерами $1… (обычно project + days).
 */
function warmLeadIdsSql(scopeWhere) {
  return `SELECT lead_id
   FROM (
     SELECT
       lead_id,
       count(*)::int AS call_count,
       count(*) FILTER (
         WHERE insights_intent IN ('booking', 'pricing', 'treatment', 'returning')
       )::int AS warm_n,
       count(*) FILTER (WHERE follow_up_status = 'open')::int AS open_fu,
       bool_or(insights_needs_follow_up IS TRUE) AS any_follow,
       (array_agg(insights_decline_reason ORDER BY created_at DESC))[1] AS last_decline
     FROM amo_call_summaries
     WHERE ${scopeWhere}
       AND NULLIF(btrim(COALESCE(lead_id, '')), '') IS NOT NULL
       AND lead_id <> '0'
     GROUP BY lead_id
   ) lead_agg
   WHERE call_count >= 3
     AND warm_n >= 1
     AND (
       open_fu > 0
       OR any_follow IS TRUE
       OR last_decline IS NULL
       OR last_decline IN ('think', 'voucher', 'family', 'other')
     )
     AND NOT (
       last_decline = 'comparing'
       AND open_fu = 0
       AND any_follow IS NOT TRUE
     )`
}

/** Список звонков проекта (без полного транскрипта). Короткие <30 сек не показываем. */
export async function listAmoCallSummaries(
  projectId,
  {
    limit = 50,
    offset = 0,
    status = '',
    leadId = '',
    intent = '',
    declineReason = '',
    needsFollowUp = '',
    hasOperatorReview = '',
    followUpStatus = '',
    warmLeads = '',
    days = '',
    orderBy = '',
    orderDir = '',
    pipelineId = '',
    statusId = '',
  } = {},
) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50))
  const off = Math.max(0, Number(offset) || 0)
  const statusFilter = String(status ?? '').trim()
  const leadIdFilter = String(leadId ?? '').trim()
  const pipelineIdFilter = String(pipelineId ?? '').trim()
  const statusIdFilter = String(statusId ?? '').trim()
  const intentFilter = String(intent ?? '').trim().toLowerCase()
  const declineFilter = String(declineReason ?? '').trim().toLowerCase()
  const followFilter = String(needsFollowUp ?? '').trim().toLowerCase()
  const reviewFilter = String(hasOperatorReview ?? '').trim().toLowerCase()
  const followUpStatusFilter = String(followUpStatus ?? '').trim().toLowerCase()
  const warmFilter = String(warmLeads ?? '').trim().toLowerCase()
  const wantWarm = warmFilter === '1' || warmFilter === 'true' || warmFilter === 'yes'
  const periodDays = Math.min(365, Math.max(0, Number(days) || 0))
  const SORT_COLUMNS = {
    created_at: 'created_at',
    duration_sec: 'duration_sec',
    lead_id: 'lead_id',
    insights_intent: 'insights_intent',
    summary_outcome: 'summary_outcome',
    status_id: 'status_id',
    follow_up_due: 'follow_up_due_at',
  }
  const sortCol = SORT_COLUMNS[String(orderBy ?? '').trim()] || ''
  const sortAsc = String(orderDir ?? '').trim().toLowerCase() === 'asc'
  const params = [projectId]
  let where = `project_id = $1
    AND COALESCE(skip_reason, '') <> 'short_call'
    AND (duration_sec IS NULL OR duration_sec >= 30)`
  if (statusFilter) {
    params.push(statusFilter)
    where += ` AND status = $${params.length}`
  } else if (followUpStatusFilter !== 'open' && followUpStatusFilter !== 'done') {
    // Очередь/обработка — внутреннее ожидание Sipuni; в таблице не шумим.
    where += ` AND status NOT IN ('pending', 'running')`
  } else {
    where += ` AND status NOT IN ('pending', 'running')`
  }
  if (periodDays > 0) {
    params.push(periodDays)
    where += ` AND created_at >= now() - ($${params.length}::int * interval '1 day')`
  }
  if (leadIdFilter) {
    params.push(leadIdFilter)
    where += ` AND lead_id = $${params.length}`
  }
  if (pipelineIdFilter) {
    params.push(pipelineIdFilter)
    where += ` AND pipeline_id = $${params.length}`
  }
  if (statusIdFilter) {
    params.push(statusIdFilter)
    where += ` AND status_id = $${params.length}`
  }
  if (intentFilter === 'none') {
    where += ` AND insights_intent IS NULL`
  } else if (intentFilter) {
    params.push(intentFilter)
    where += ` AND insights_intent = $${params.length}`
  }
  if (declineFilter === 'none') {
    where += ` AND insights_decline_reason IS NULL`
  } else if (declineFilter) {
    params.push(declineFilter)
    where += ` AND insights_decline_reason = $${params.length}`
  }
  if (followFilter === '1' || followFilter === 'true' || followFilter === 'yes') {
    where += ` AND insights_needs_follow_up IS TRUE`
  } else if (followFilter === '0' || followFilter === 'false' || followFilter === 'no') {
    where += ` AND (insights_needs_follow_up IS NOT TRUE)`
  }
  if (followUpStatusFilter === 'open' || followUpStatusFilter === 'done') {
    params.push(followUpStatusFilter)
    where += ` AND follow_up_status = $${params.length}`
  }
  if (reviewFilter === '1' || reviewFilter === 'true' || reviewFilter === 'yes') {
    where += ` AND (
      NULLIF(btrim(COALESCE(operator_review_miss, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(operator_review_detail, '')), '') IS NOT NULL
    )`
  }
  if (wantWarm) {
    // Тёплые сделки считаем по done + период (как в аналитике), в список — все звонки этих сделок.
    const warmParams = [projectId]
    let warmScope = `project_id = $1
      AND status = 'done'
      AND COALESCE(skip_reason, '') <> 'short_call'
      AND (duration_sec IS NULL OR duration_sec >= 30)`
    if (periodDays > 0) {
      warmParams.push(periodDays)
      warmScope += ` AND created_at >= now() - ($2::int * interval '1 day')`
    }
    const warmRes = await query(warmLeadIdsSql(warmScope), warmParams)
    const ids = warmRes.rows.map((row) => String(row.lead_id)).filter(Boolean)
    if (ids.length === 0) {
      return { total: 0, calls: [] }
    }
    params.push(ids)
    where += ` AND lead_id = ANY($${params.length}::text[])`
  }
  let orderSql = `ORDER BY created_at DESC`
  if (sortCol) {
    const dir = sortAsc ? 'ASC' : 'DESC'
    const nulls = sortAsc ? 'NULLS FIRST' : 'NULLS LAST'
    orderSql =
      sortCol === 'follow_up_due_at'
        ? `ORDER BY follow_up_due_at ${dir} NULLS LAST, created_at DESC`
        : `ORDER BY ${sortCol} ${dir} ${nulls}, created_at DESC`
  } else if (followUpStatusFilter === 'open') {
    orderSql = `ORDER BY follow_up_due_at ASC NULLS LAST, created_at DESC`
  }
  const countRes = await query(`SELECT count(*)::int AS n FROM amo_call_summaries WHERE ${where}`, params)
  params.push(lim, off)
  const { rows } = await query(
    `SELECT id, project_id, lead_id, call_note_id, recording_url,
            left(transcript, 200) AS transcript,
            summary_outcome, summary_next_step, summary_note_id,
            operator_review_miss, operator_review_detail, operator_review_note_id,
            insights_intent, insights_decline_reason, insights_topics, insights_facts,
            insights_needs_follow_up, insights_at,
            follow_up_status, follow_up_due_at, follow_up_done_at,
            status, skip_reason, error, pipeline_id, status_id, duration_sec,
            created_at, updated_at
     FROM amo_call_summaries
     WHERE ${where}
     ${orderSql}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return {
    total: Number(countRes.rows[0]?.n || 0),
    calls: rows.map(mapListRow).filter(Boolean),
  }
}

const WARM_INTENTS = new Set(['booking', 'pricing', 'treatment', 'returning'])
const HARD_EXIT_DECLINES = new Set(['comparing'])

/** Сколько уже проанализированных звонков по сделке (включая текущий note, если есть). */
export async function countDoneCallsForLead(projectId, leadId, { excludeCallNoteId = '' } = {}) {
  const lid = String(leadId ?? '').trim()
  if (!lid || lid === '0') return 0
  const params = [projectId, lid]
  let where = `project_id = $1
    AND lead_id = $2
    AND status = 'done'
    AND COALESCE(skip_reason, '') <> 'short_call'
    AND (duration_sec IS NULL OR duration_sec >= 30)`
  const excl = String(excludeCallNoteId ?? '').trim()
  if (excl) {
    params.push(excl)
    where += ` AND call_note_id <> $${params.length}`
  }
  const { rows } = await query(`SELECT count(*)::int AS n FROM amo_call_summaries WHERE ${where}`, params)
  return Number(rows[0]?.n || 0)
}

/**
 * Сигнал «тёплый повторный контакт без брони».
 * callCount — всего звонков по сделке после текущего (caller передаёт уже с +1).
 */
export function buildWarmRepeatSignal({
  callCount = 0,
  intent = null,
  declineReason = null,
  needsFollowUp = false,
  priorWarm = false,
} = {}) {
  const n = Math.max(0, Number(callCount) || 0)
  if (n < 3) return null
  const warmNow = WARM_INTENTS.has(String(intent || ''))
  if (!warmNow && !priorWarm && !needsFollowUp) return null
  if (HARD_EXIT_DECLINES.has(String(declineReason || '')) && !needsFollowUp) return null
  return `гость звонил ${n} ${pluralCalls(n)}, интерес тёплый, бронь не закрыта`
}

function pluralCalls(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'раз'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'раза'
  return 'раз'
}

/** Сводка insights за период (для шапки страницы Звонки). */
export async function summarizeAmoCallInsights(projectId, { days = 30 } = {}) {
  const periodDays = Math.min(365, Math.max(1, Number(days) || 30))
  const baseWhere = `project_id = $1
    AND status = 'done'
    AND COALESCE(skip_reason, '') <> 'short_call'
    AND (duration_sec IS NULL OR duration_sec >= 30)
    AND created_at >= now() - ($2::int * interval '1 day')`

  const [totals, intents, declines, topics, otherTopicLabels, declineWeeks, warmLeads] =
    await Promise.all([
    query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (
           WHERE NULLIF(btrim(COALESCE(operator_review_miss, '')), '') IS NOT NULL
              OR NULLIF(btrim(COALESCE(operator_review_detail, '')), '') IS NOT NULL
         )::int AS with_review,
         count(*) FILTER (WHERE insights_needs_follow_up IS TRUE)::int AS needs_follow_up,
         count(*) FILTER (WHERE insights_intent IS NOT NULL)::int AS with_insights,
         count(*) FILTER (WHERE follow_up_status = 'open')::int AS follow_up_open,
         count(*) FILTER (
           WHERE follow_up_status = 'open'
             AND follow_up_due_at IS NOT NULL
             AND follow_up_due_at < now()
         )::int AS follow_up_overdue
       FROM amo_call_summaries
       WHERE ${baseWhere}`,
      [projectId, periodDays],
    ),
    query(
      `SELECT COALESCE(insights_intent, 'none') AS key, count(*)::int AS n
       FROM amo_call_summaries
       WHERE ${baseWhere}
       GROUP BY 1
       ORDER BY n DESC`,
      [projectId, periodDays],
    ),
    query(
      `SELECT insights_decline_reason AS key, count(*)::int AS n
       FROM amo_call_summaries
       WHERE ${baseWhere}
         AND insights_decline_reason IS NOT NULL
       GROUP BY 1
       ORDER BY n DESC`,
      [projectId, periodDays],
    ),
    query(
      `SELECT
         elem->>'topic' AS topic,
         count(*)::int AS n,
         count(*) FILTER (
           WHERE lower(COALESCE(elem->>'addressed', 'false')) IN ('true', '1', 'yes')
         )::int AS addressed
       FROM amo_call_summaries s
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(COALESCE(s.insights_topics, '[]'::jsonb)) = 'array'
           THEN COALESCE(s.insights_topics, '[]'::jsonb)
           ELSE '[]'::jsonb
         END
       ) AS elem
       WHERE ${baseWhere}
         AND NULLIF(btrim(COALESCE(elem->>'topic', '')), '') IS NOT NULL
       GROUP BY 1
       ORDER BY n DESC`,
      [projectId, periodDays],
    ),
    query(
      `SELECT
         lower(btrim(elem->>'label')) AS label,
         min(btrim(elem->>'label')) AS label_display,
         count(*)::int AS n,
         count(*) FILTER (
           WHERE lower(COALESCE(elem->>'addressed', 'false')) IN ('true', '1', 'yes')
         )::int AS addressed
       FROM amo_call_summaries s
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(COALESCE(s.insights_topics, '[]'::jsonb)) = 'array'
           THEN COALESCE(s.insights_topics, '[]'::jsonb)
           ELSE '[]'::jsonb
         END
       ) AS elem
       WHERE ${baseWhere}
         AND elem->>'topic' = 'other'
         AND NULLIF(btrim(COALESCE(elem->>'label', '')), '') IS NOT NULL
       GROUP BY 1
       ORDER BY n DESC
       LIMIT 20`,
      [projectId, periodDays],
    ),
    query(
      `SELECT
         date_trunc('week', created_at)::date AS week_start,
         insights_decline_reason AS key,
         count(*)::int AS n
       FROM amo_call_summaries
       WHERE ${baseWhere}
         AND insights_decline_reason IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 1 ASC, n DESC`,
      [projectId, periodDays],
    ),
    query(
      `WITH lead_agg AS (
         SELECT
           lead_id,
           count(*)::int AS call_count,
           max(created_at) AS last_at,
           count(*) FILTER (
             WHERE insights_intent IN ('booking', 'pricing', 'treatment', 'returning')
           )::int AS warm_n,
           count(*) FILTER (WHERE follow_up_status = 'open')::int AS open_fu,
           bool_or(insights_needs_follow_up IS TRUE) AS any_follow,
           (array_agg(insights_decline_reason ORDER BY created_at DESC))[1] AS last_decline,
           (array_agg(insights_intent ORDER BY created_at DESC))[1] AS last_intent
         FROM amo_call_summaries
         WHERE ${baseWhere}
           AND NULLIF(btrim(COALESCE(lead_id, '')), '') IS NOT NULL
           AND lead_id <> '0'
         GROUP BY lead_id
       )
       SELECT *
       FROM lead_agg
       WHERE call_count >= 3
         AND warm_n >= 1
         AND (
           open_fu > 0
           OR any_follow IS TRUE
           OR last_decline IS NULL
           OR last_decline IN ('think', 'voucher', 'family', 'other')
         )
         AND NOT (
           last_decline = 'comparing'
           AND open_fu = 0
           AND any_follow IS NOT TRUE
         )
       ORDER BY call_count DESC, last_at DESC
       LIMIT 40`,
      [projectId, periodDays],
    ),
  ])

  const t = totals.rows[0] || {}
  const declinesByWeekMap = new Map()
  for (const row of declineWeeks.rows) {
    const week = row.week_start
      ? new Date(row.week_start).toISOString().slice(0, 10)
      : null
    if (!week || !row.key) continue
    if (!declinesByWeekMap.has(week)) {
      declinesByWeekMap.set(week, { weekStart: week, total: 0, byReason: {} })
    }
    const bucket = declinesByWeekMap.get(week)
    const n = Number(row.n || 0)
    bucket.byReason[row.key] = n
    bucket.total += n
  }

  return {
    days: periodDays,
    total: Number(t.total || 0),
    withInsights: Number(t.with_insights || 0),
    withReview: Number(t.with_review || 0),
    needsFollowUp: Number(t.needs_follow_up || 0),
    followUpOpen: Number(t.follow_up_open || 0),
    followUpOverdue: Number(t.follow_up_overdue || 0),
    byIntent: Object.fromEntries(intents.rows.map((row) => [row.key, Number(row.n || 0)])),
    byDecline: Object.fromEntries(declines.rows.map((row) => [row.key, Number(row.n || 0)])),
    byTopic: topics.rows.map((row) => {
      const count = Number(row.n || 0)
      const addressed = Number(row.addressed || 0)
      return {
        topic: row.topic,
        count,
        addressed,
        addressedRate: count > 0 ? Math.round((addressed / count) * 100) : 0,
      }
    }),
    otherTopicLabels: otherTopicLabels.rows.map((row) => {
      const count = Number(row.n || 0)
      const addressed = Number(row.addressed || 0)
      return {
        label: row.label_display || row.label,
        count,
        addressed,
        addressedRate: count > 0 ? Math.round((addressed / count) * 100) : 0,
      }
    }),
    declinesByWeek: [...declinesByWeekMap.values()],
    warmLeads: warmLeads.rows.map((row) => ({
      leadId: String(row.lead_id),
      callCount: Number(row.call_count || 0),
      lastAt: row.last_at,
      lastIntent: row.last_intent || null,
      lastDecline: row.last_decline || null,
      openFollowUp: Number(row.open_fu || 0) > 0,
      signal: buildWarmRepeatSignal({
        callCount: Number(row.call_count || 0),
        intent: row.last_intent,
        declineReason: row.last_decline,
        needsFollowUp: Boolean(row.any_follow) || Number(row.open_fu || 0) > 0,
        priorWarm: Number(row.warm_n || 0) > 0,
      }),
    })),
  }
}

export async function getAmoCallSummaryById(projectId, id) {
  const { rows } = await query(
    `SELECT * FROM amo_call_summaries
     WHERE project_id = $1 AND id = $2`,
    [projectId, String(id ?? '').trim()],
  )
  return mapRow(rows[0])
}

export async function deleteAmoCallSummaryById(projectId, id) {
  const { rows } = await query(
    `DELETE FROM amo_call_summaries
     WHERE project_id = $1 AND id = $2
     RETURNING id`,
    [projectId, String(id ?? '').trim()],
  )
  return Boolean(rows[0]?.id)
}

/**
 * Звонки, ждущие ссылку/файл записи (для фонового sweep после задержки Sipuni).
 */
export async function listAmoCallSummariesNeedingRecordingRetry({
  minAgeMs = 45_000,
  maxAgeMs = 24 * 60 * 60 * 1000,
  limit = 25,
} = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 25))
  const minAge = Math.max(0, Number(minAgeMs) || 0)
  const maxAge = Math.max(minAge, Number(maxAgeMs) || minAge)
  const { rows } = await query(
    `SELECT s.*, p.code AS project_code
     FROM amo_call_summaries s
     JOIN projects p ON p.id = s.project_id
     WHERE (
         (s.status = 'pending' AND (s.transcript IS NULL OR btrim(s.transcript) = ''))
         OR (
           s.status = 'skipped'
           AND s.skip_reason IN ('no_recording_url', 'recording_unavailable', 'no_lead')
         )
       )
       AND s.updated_at <= now() - ($1::bigint * interval '1 millisecond')
       AND s.updated_at >= now() - ($2::bigint * interval '1 millisecond')
     ORDER BY s.updated_at ASC
     LIMIT $3`,
    [minAge, maxAge, lim],
  )
  return rows.map((row) => ({
    ...mapRow(row),
    projectCode: row.project_code || null,
  }))
}
