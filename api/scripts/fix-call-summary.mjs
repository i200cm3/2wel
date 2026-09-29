/**
 * Пересобрать outcome/nextStep (+ insights) для одного звонка по call_note_id.
 *   node --import tsx scripts/fix-call-summary.mjs <callNoteId> [--amo] [--no-llm]
 * --amo — переписать и заметку-саммари в amo (заголовок — из звонка, «Повторный контакт» сохраняется).
 * --no-llm — без модели: пересобрать заметку в amo из текущих полей БД.
 */
import { query } from '../db.js'
import { extractCallSummaryFromTranscript, extractCallInsightsFromTranscript } from '../callSummaryExtract.mjs'
import { patchAmoCallSummary } from '../amoCallSummaries.mjs'
import { getAmoConnection } from '../amoConnections.mjs'
import { amoApi } from '../amoAuth.mjs'
import { formatCallSummaryNoteText } from '../callSummaryPipeline.mjs'
import {
  callDirectionFromNoteType,
  callParamsMetaFromAmoNote,
  fetchAmoNote,
  parseCallNoteFromAmo,
} from '../amoCalls.mjs'

const args = process.argv.slice(2)
const callNoteId = String(args.find((a) => !a.startsWith('--')) || '').trim()
const noLlm = args.includes('--no-llm')
const updateAmo = args.includes('--amo') || noLlm
if (!callNoteId) {
  console.error('usage: node --import tsx scripts/fix-call-summary.mjs <callNoteId> [--amo] [--no-llm]')
  process.exit(1)
}

const redirectUri = process.env.AMO_REDIRECT_URI || 'https://2wel.ru/api/v1/amocrm/oauth/callback'

const { rows } = await query(
  `SELECT project_id, lead_id, call_note_id, transcript, summary_outcome, summary_next_step,
          summary_note_id, duration_sec, insights_facts
   FROM amo_call_summaries
   WHERE call_note_id = $1
   LIMIT 1`,
  [callNoteId],
)
const row = rows[0]
if (!row) {
  console.error('call not found', callNoteId)
  process.exit(1)
}
if (!String(row.transcript || '').trim()) {
  console.error('no transcript', callNoteId)
  process.exit(1)
}

console.log('before', {
  callNoteId,
  outcome: row.summary_outcome,
  nextStep: row.summary_next_step,
})

let extracted
let insightsRes
if (noLlm) {
  extracted = { outcome: row.summary_outcome, nextStep: row.summary_next_step }
  insightsRes = { ok: true, insights: { facts: row.insights_facts || null } }
} else {
  extracted = await extractCallSummaryFromTranscript(row.transcript)
  if (!extracted.ok) {
    console.error('extract failed', extracted.error || extracted)
    process.exit(1)
  }

  insightsRes = await extractCallInsightsFromTranscript(row.transcript, {
    outcome: extracted.outcome,
    nextStep: extracted.nextStep,
  })

  await patchAmoCallSummary(row.project_id, callNoteId, {
    summaryOutcome: extracted.outcome,
    summaryNextStep: extracted.nextStep,
    operatorReviewMiss: extracted.operatorReview?.miss || null,
    operatorReviewDetail: extracted.operatorReview?.detail || null,
    ...(insightsRes.ok ? { insights: insightsRes.insights } : {}),
    status: 'done',
    error: null,
    skipReason: null,
  })

  console.log('after', {
    callNoteId,
    outcome: extracted.outcome,
    nextStep: extracted.nextStep,
    reviewPass: extracted.reviewPass,
    facts: insightsRes.ok ? insightsRes.insights?.facts : null,
    insightsOk: insightsRes.ok,
    model: extracted.model,
  })
}

const summaryNoteId = String(row.summary_note_id || '').trim()
if (updateAmo && summaryNoteId) {
  const connection = await getAmoConnection(row.project_id)
  if (!connection) {
    console.error('no amo connection')
    process.exit(1)
  }
  const conn = { ...connection, projectId: row.project_id }
  const notePath = `/api/v4/leads/${encodeURIComponent(row.lead_id)}/notes/${encodeURIComponent(summaryNoteId)}`
  const current = await amoApi(conn, notePath, { redirectUri })
  const currentText = String(current?.params?.text || '')
  const signal = currentText.match(/⚠ Повторный контакт:\s*(.+)/)?.[1] || null
  const callNote = await fetchAmoNote(conn, callNoteId, redirectUri)
  const parsed = callNote ? parseCallNoteFromAmo(callNote) : null
  const text = formatCallSummaryNoteText({
    direction: callDirectionFromNoteType(callNote?.note_type),
    capturedAt:
      parsed?.capturedAt ||
      (callNote?.created_at ? new Date(callNote.created_at * 1000).toISOString() : null),
    durationSec: row.duration_sec ?? (callNote ? callParamsMetaFromAmoNote(callNote).durationSec : null),
    outcome: extracted.outcome,
    nextStep: extracted.nextStep,
    facts: insightsRes.ok ? insightsRes.insights?.facts : null,
    warmRepeatSignal: signal,
  })
  await amoApi(conn, notePath, {
    method: 'PATCH',
    redirectUri,
    body: { note_type: 'common', params: { text } },
  })
  console.log('amo_note_updated', summaryNoteId)
  console.log(text)
} else if (updateAmo) {
  console.warn('no summary_note_id — amo note not updated')
}

process.exit(0)
