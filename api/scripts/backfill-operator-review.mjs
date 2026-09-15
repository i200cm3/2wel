/**
 * One-off: backfill operatorReview for existing done call summaries.
 * Run inside api container: node --import tsx scripts/backfill-operator-review.mjs
 */
import { getAmoConnection } from '../amoConnections.mjs'
import { query } from '../db.js'
import { extractCallSummaryFromTranscript } from '../callSummaryExtract.mjs'
import {
  formatOperatorReviewNoteText,
  pinAmoLeadNote,
  writeAmoLeadCommonNote,
} from '../callSummaryPipeline.mjs'
import { patchAmoCallSummary } from '../amoCallSummaries.mjs'

const redirectUri = process.env.AMO_REDIRECT_URI || 'https://2wel.ru/api/v1/amocrm/oauth/callback'

const { rows } = await query(`
  SELECT s.id, s.project_id, s.lead_id, s.call_note_id, s.transcript,
         s.summary_outcome, s.operator_review_note_id, p.code AS project_code
  FROM amo_call_summaries s
  JOIN projects p ON p.id = s.project_id
  WHERE s.status = 'done'
    AND s.transcript IS NOT NULL
    AND length(btrim(s.transcript)) > 0
  ORDER BY s.created_at ASC
`)

console.log('backfill start', { count: rows.length })

const results = []
for (const row of rows) {
  const item = {
    callNoteId: row.call_note_id,
    leadId: row.lead_id,
    project: row.project_code,
    outcome: String(row.summary_outcome || '').slice(0, 120),
  }
  try {
    const extracted = await extractCallSummaryFromTranscript(row.transcript)
    if (!extracted.ok) {
      results.push({ ...item, review: null, error: extracted.error })
      console.log('extract_fail', JSON.stringify({ ...item, error: extracted.error }))
      continue
    }
    const review = extracted.operatorReview
    item.review = review
    if (!review) {
      await patchAmoCallSummary(row.project_id, row.call_note_id, {
        operatorReviewMiss: null,
        operatorReviewDetail: null,
      })
      results.push({ ...item, action: 'none' })
      console.log('no_review', JSON.stringify(item))
      continue
    }

    let noteId = row.operator_review_note_id || null
    if (!noteId) {
      const connection = await getAmoConnection(row.project_id)
      if (!connection) throw new Error('no amo connection')
      const conn = { ...connection, projectId: row.project_id }
      const written = await writeAmoLeadCommonNote(
        conn,
        row.lead_id,
        formatOperatorReviewNoteText(review),
        redirectUri,
      )
      if (!written.ok) throw new Error(written.error || 'note_failed')
      noteId = written.noteId || null
      if (noteId) {
        try {
          await pinAmoLeadNote(conn, noteId, redirectUri)
        } catch (e) {
          console.warn('pin_fail', noteId, e?.message || e)
        }
      }
    }

    await patchAmoCallSummary(row.project_id, row.call_note_id, {
      operatorReviewMiss: review.miss,
      operatorReviewDetail: review.detail,
      operatorReviewNoteId: noteId,
    })
    results.push({ ...item, action: 'saved', noteId })
    console.log('review', JSON.stringify({ ...item, noteId }))
  } catch (err) {
    results.push({ ...item, error: err?.message || String(err) })
    console.error('err', JSON.stringify({ ...item, error: err?.message || String(err) }))
  }
}

const withReview = results.filter((r) => r.review)
console.log(
  'DONE',
  JSON.stringify(
    {
      total: results.length,
      withReview: withReview.length,
      reviews: withReview.map((r) => ({
        callNoteId: r.callNoteId,
        leadId: r.leadId,
        miss: r.review?.miss,
        detail: r.review?.detail,
        noteId: r.noteId || null,
      })),
    },
    null,
    2,
  ),
)
process.exit(0)
