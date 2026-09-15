import { query } from './db.js'

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    callNoteId: row.call_note_id,
    recordingUrl: row.recording_url || null,
    transcript: row.transcript || null,
    summaryOutcome: row.summary_outcome || null,
    summaryNextStep: row.summary_next_step || null,
    summaryNoteId: row.summary_note_id || null,
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
 * no_lead / recording_unavailable (Sipuni часто отдаёт запись с задержкой).
 */
export async function markAmoCallSummaryRunning(projectId, callNoteId) {
  const { rows } = await query(
    `UPDATE amo_call_summaries
     SET status = 'running', error = NULL, skip_reason = NULL, updated_at = now()
     WHERE project_id = $1
       AND call_note_id = $2
       AND (
         status IN ('pending', 'failed')
         OR (status = 'skipped' AND skip_reason IN ('no_lead', 'recording_unavailable'))
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

/** Список звонков проекта (без полного транскрипта). Короткие <30 сек не показываем. */
export async function listAmoCallSummaries(
  projectId,
  { limit = 50, offset = 0, status = '' } = {},
) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50))
  const off = Math.max(0, Number(offset) || 0)
  const statusFilter = String(status ?? '').trim()
  const params = [projectId]
  let where = `project_id = $1
    AND COALESCE(skip_reason, '') <> 'short_call'
    AND (duration_sec IS NULL OR duration_sec >= 30)`
  if (statusFilter) {
    params.push(statusFilter)
    where += ` AND status = $${params.length}`
  }
  const countRes = await query(`SELECT count(*)::int AS n FROM amo_call_summaries WHERE ${where}`, params)
  params.push(lim, off)
  const { rows } = await query(
    `SELECT id, project_id, lead_id, call_note_id, recording_url,
            left(transcript, 200) AS transcript,
            summary_outcome, summary_next_step, summary_note_id,
            status, skip_reason, error, pipeline_id, status_id, duration_sec,
            created_at, updated_at
     FROM amo_call_summaries
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return {
    total: Number(countRes.rows[0]?.n || 0),
    calls: rows.map(mapListRow).filter(Boolean),
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
