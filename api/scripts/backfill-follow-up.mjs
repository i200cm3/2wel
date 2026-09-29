/**
 * Backfill follow-up queue from existing done calls (no LLM).
 *
 *   node --import tsx scripts/backfill-follow-up.mjs
 *   node --import tsx scripts/backfill-follow-up.mjs --force
 */
import { query } from '../db.js'
import { deriveNeedsFollowUp } from '../callSummaryExtract.mjs'

const force = process.argv.includes('--force')

const { rows } = await query(`
  SELECT s.project_id, s.call_note_id, s.lead_id,
         s.transcript, s.summary_outcome, s.summary_next_step,
         s.insights_intent, s.insights_decline_reason, s.insights_needs_follow_up,
         s.follow_up_status, p.code AS project_code
  FROM amo_call_summaries s
  JOIN projects p ON p.id = s.project_id
  WHERE s.status = 'done'
  ORDER BY s.created_at ASC
`)

console.log('backfill follow-up start', { count: rows.length, force })

let opened = 0
let cleared = 0
let skippedDone = 0
let alreadyOpen = 0
let noNeed = 0

for (const row of rows) {
  if (!force && row.follow_up_status === 'done') {
    skippedDone += 1
    continue
  }

  // Старый false от жёсткой эвристики не блокирует переразметку очереди.
  const shouldOpen = deriveNeedsFollowUp(row.summary_next_step || '', null, {
    outcome: row.summary_outcome || '',
    transcript: row.transcript || '',
    declineReason: row.insights_decline_reason || null,
    intent: row.insights_intent || null,
  })

  if (!shouldOpen) {
    if (force && (row.follow_up_status === 'open' || row.insights_needs_follow_up === true)) {
      await query(
        `UPDATE amo_call_summaries
         SET insights_needs_follow_up = FALSE,
             follow_up_status = NULL,
             follow_up_due_at = NULL,
             follow_up_done_at = NULL,
             updated_at = now()
         WHERE project_id = $1 AND call_note_id = $2`,
        [row.project_id, row.call_note_id],
      )
      cleared += 1
      console.log('clear', row.call_note_id)
    } else {
      noNeed += 1
    }
    continue
  }

  if (!force && row.follow_up_status === 'open') {
    alreadyOpen += 1
    continue
  }

  await query(
    `UPDATE amo_call_summaries
     SET insights_needs_follow_up = TRUE,
         follow_up_status = 'open',
         follow_up_due_at = COALESCE(follow_up_due_at, now() + interval '1 day'),
         follow_up_done_at = NULL,
         updated_at = now()
     WHERE project_id = $1 AND call_note_id = $2`,
    [row.project_id, row.call_note_id],
  )
  opened += 1
  console.log(
    'open',
    JSON.stringify({
      callNoteId: row.call_note_id,
      leadId: row.lead_id,
      project: row.project_code,
      intent: row.insights_intent,
      decline: row.insights_decline_reason,
      nextStep: String(row.summary_next_step || '').slice(0, 80),
    }),
  )
}

console.log(
  'DONE',
  JSON.stringify({ opened, cleared, alreadyOpen, skippedDone, noNeed, total: rows.length }, null, 2),
)
process.exit(0)
