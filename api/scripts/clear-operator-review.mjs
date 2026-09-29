/**
 * Снять ложный разбор оператора по звонку: открепить и переписать заметку в amo, очистить поля в БД.
 *   node --import tsx scripts/clear-operator-review.mjs <callNoteId> [--close-follow-up] [--reason "..."]
 * amo API не умеет удалять примечания — текст заметки заменяется пометкой о снятии.
 */
import { getAmoConnection } from '../amoConnections.mjs'
import { amoApi } from '../amoAuth.mjs'
import { query } from '../db.js'
import { patchAmoCallSummary } from '../amoCallSummaries.mjs'

const args = process.argv.slice(2)
const callNoteId = String(args.find((a) => !a.startsWith('--')) || '').trim()
const closeFollowUp = args.includes('--close-follow-up')
const reasonIdx = args.indexOf('--reason')
const reason =
  reasonIdx >= 0 && args[reasonIdx + 1]
    ? String(args[reasonIdx + 1]).trim()
    : 'звонок по уже оформленной брони'

if (!callNoteId) {
  console.error(
    'usage: node --import tsx scripts/clear-operator-review.mjs <callNoteId> [--close-follow-up] [--reason "..."]',
  )
  process.exit(1)
}

const redirectUri = process.env.AMO_REDIRECT_URI || 'https://2wel.ru/api/v1/amocrm/oauth/callback'

const { rows } = await query(
  `SELECT project_id, lead_id, call_note_id, operator_review_miss, operator_review_detail,
          operator_review_note_id, follow_up_status
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

console.log('before', {
  callNoteId,
  leadId: row.lead_id,
  miss: row.operator_review_miss,
  detail: row.operator_review_detail,
  noteId: row.operator_review_note_id,
  followUp: row.follow_up_status,
})

const noteId = String(row.operator_review_note_id || '').trim()
if (noteId) {
  const connection = await getAmoConnection(row.project_id)
  if (!connection) {
    console.error('no amo connection')
    process.exit(1)
  }
  const conn = { ...connection, projectId: row.project_id }
  try {
    await amoApi(conn, `/api/v4/leads/notes/${encodeURIComponent(noteId)}/unpin`, {
      method: 'POST',
      redirectUri,
    })
    console.log('unpinned', noteId)
  } catch (err) {
    console.warn('unpin_fail', noteId, err?.message || String(err))
  }
  try {
    await amoApi(
      conn,
      `/api/v4/leads/${encodeURIComponent(row.lead_id)}/notes/${encodeURIComponent(noteId)}`,
      {
        method: 'PATCH',
        redirectUri,
        body: {
          note_type: 'common',
          params: { text: `Разбор оператора снят: ${reason}.` },
        },
      },
    )
    console.log('note_rewritten', noteId)
  } catch (err) {
    console.warn('note_rewrite_fail', noteId, err?.message || String(err))
  }
}

await patchAmoCallSummary(row.project_id, callNoteId, {
  operatorReviewMiss: null,
  operatorReviewDetail: null,
  ...(closeFollowUp ? { followUpStatus: 'done' } : {}),
})

console.log('done', { callNoteId, closeFollowUp })
process.exit(0)
