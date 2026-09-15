/**
 * One-off: прогон нескольких звонков через текущий промпт без записи в amo/БД.
 * Запуск в контейнере api: node --import tsx scripts/check-operator-review-prompt.mjs [noteId...]
 */
import { query } from '../db.js'
import { extractCallSummaryFromTranscript } from '../callSummaryExtract.mjs'

const noteIds = process.argv.slice(2).filter(Boolean)
if (!noteIds.length) {
  console.error('usage: check-operator-review-prompt.mjs <callNoteId...>')
  process.exit(1)
}

const { rows } = await query(
  `SELECT call_note_id, lead_id, summary_outcome, summary_next_step,
          operator_review_miss, operator_review_detail, transcript
   FROM amo_call_summaries
   WHERE call_note_id = ANY($1::text[])`,
  [noteIds],
)

const out = []
for (const row of rows) {
  const extracted = await extractCallSummaryFromTranscript(row.transcript)
  out.push({
    callNoteId: row.call_note_id,
    leadId: row.lead_id,
    before: {
      outcome: row.summary_outcome,
      nextStep: row.summary_next_step,
      review: row.operator_review_miss
        ? { miss: row.operator_review_miss, detail: row.operator_review_detail }
        : null,
    },
    after: extracted.ok
      ? {
          outcome: extracted.outcome,
          nextStep: extracted.nextStep,
          review: extracted.operatorReview,
        }
      : { error: extracted.error },
  })
}

console.log(JSON.stringify(out, null, 2))
process.exit(0)
