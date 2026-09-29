/**
 * Dry-run: прогон insights по готовым транскриптам без записи в БД/amo.
 *
 * В контейнере api:
 *   node --import tsx scripts/check-call-insights.mjs
 *   node --import tsx scripts/check-call-insights.mjs --limit 15
 *   node --import tsx scripts/check-call-insights.mjs --all --limit 30
 *   node --import tsx scripts/check-call-insights.mjs <callNoteId...>
 *
 * По умолчанию берёт целевые (коммерческие) done-звонки по outcome/nextStep.
 */
import { query } from '../db.js'
import {
  extractCallInsightsFromTranscript,
  isCallInsightsTargetCall,
} from '../callSummaryExtract.mjs'

function parseArgs(argv) {
  const noteIds = []
  let limit = 12
  let onlyTarget = true
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--limit') {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n)
      continue
    }
    if (arg === '--all') {
      onlyTarget = false
      continue
    }
    if (arg === '--target') {
      onlyTarget = true
      continue
    }
    if (arg.startsWith('-')) {
      console.error(`unknown flag: ${arg}`)
      process.exit(1)
    }
    noteIds.push(arg)
  }
  return { noteIds, limit, onlyTarget }
}

const { noteIds, limit, onlyTarget } = parseArgs(process.argv.slice(2))

let rows
if (noteIds.length) {
  const res = await query(
    `SELECT call_note_id, lead_id, summary_outcome, summary_next_step,
            operator_review_miss, duration_sec, transcript
     FROM amo_call_summaries
     WHERE call_note_id = ANY($1::text[])
       AND transcript IS NOT NULL
       AND length(btrim(transcript)) > 0`,
    [noteIds],
  )
  rows = res.rows
} else {
  // Берём с запасом, потом отфильтруем целевые в JS.
  const fetchLimit = onlyTarget ? Math.max(limit * 5, 50) : limit
  const res = await query(
    `SELECT call_note_id, lead_id, summary_outcome, summary_next_step,
            operator_review_miss, duration_sec, transcript
     FROM amo_call_summaries
     WHERE status = 'done'
       AND transcript IS NOT NULL
       AND length(btrim(transcript)) > 0
     ORDER BY created_at DESC
     LIMIT $1`,
    [fetchLimit],
  )
  rows = onlyTarget
    ? res.rows
        .filter((row) =>
          isCallInsightsTargetCall({
            outcome: row.summary_outcome || '',
            nextStep: row.summary_next_step || '',
            transcript: row.transcript || '',
          }),
        )
        .slice(0, limit)
    : res.rows.slice(0, limit)
}

if (!rows.length) {
  console.error(
    onlyTarget
      ? 'Нет целевых done-звонков с транскриптом (или не найдены noteId).'
      : 'Нет done-звонков с транскриптом.',
  )
  process.exit(1)
}

console.error(
  JSON.stringify(
    {
      mode: noteIds.length ? 'noteIds' : onlyTarget ? 'target' : 'all',
      selected: rows.length,
      limit,
    },
    null,
    2,
  ),
)

const out = []
for (const row of rows) {
  const item = {
    callNoteId: row.call_note_id,
    leadId: row.lead_id,
    durationSec: row.duration_sec,
    outcome: row.summary_outcome,
    nextStep: row.summary_next_step,
    reviewMiss: row.operator_review_miss || null,
    target: isCallInsightsTargetCall({
      outcome: row.summary_outcome || '',
      nextStep: row.summary_next_step || '',
      transcript: row.transcript || '',
    }),
  }
  const extracted = await extractCallInsightsFromTranscript(row.transcript, {
    outcome: row.summary_outcome || '',
    nextStep: row.summary_next_step || '',
  })
  if (!extracted.ok) {
    out.push({ ...item, ok: false, error: extracted.error })
    console.error('fail', row.call_note_id, extracted.error)
    continue
  }
  out.push({
    ...item,
    ok: true,
    insights: extracted.insights,
    model: extracted.model || null,
  })
  console.error(
    'ok',
    row.call_note_id,
    extracted.insights?.intent,
    extracted.insights?.declineReason,
  )
}

console.log(JSON.stringify(out, null, 2))

const intents = {}
const declines = {}
for (const row of out) {
  if (!row.ok) continue
  const intent = row.insights?.intent || 'null'
  const decline = row.insights?.declineReason || 'null'
  intents[intent] = (intents[intent] || 0) + 1
  declines[decline] = (declines[decline] || 0) + 1
}
console.error(JSON.stringify({ summary: { intents, declines, total: out.length } }, null, 2))
process.exit(0)
