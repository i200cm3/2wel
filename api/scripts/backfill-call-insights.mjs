/**
 * Backfill call insights for existing done transcripts (writes DB only, not amo).
 * Run inside api container:
 *   node --import tsx scripts/backfill-call-insights.mjs
 *   node --import tsx scripts/backfill-call-insights.mjs --limit 30
 *   node --import tsx scripts/backfill-call-insights.mjs --force
 */
import { query } from '../db.js'
import { extractCallInsightsFromTranscript } from '../callSummaryExtract.mjs'
import { patchAmoCallSummary } from '../amoCallSummaries.mjs'

function parseArgs(argv) {
  let limit = 0
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--limit') {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n)
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    console.error(`unknown flag: ${arg}`)
    process.exit(1)
  }
  return { limit, force }
}

const { limit, force } = parseArgs(process.argv.slice(2))

const params = []
let sql = `
  SELECT s.id, s.project_id, s.call_note_id, s.lead_id, s.transcript,
         s.summary_outcome, s.summary_next_step, p.code AS project_code
  FROM amo_call_summaries s
  JOIN projects p ON p.id = s.project_id
  WHERE s.status = 'done'
    AND s.transcript IS NOT NULL
    AND length(btrim(s.transcript)) > 0
`
if (!force) {
  sql += ` AND s.insights_at IS NULL`
}
sql += ` ORDER BY s.created_at ASC`
if (limit > 0) {
  params.push(limit)
  sql += ` LIMIT $${params.length}`
}

const { rows } = await query(sql, params)
console.log('backfill insights start', { count: rows.length, force, limit: limit || null })

const results = []
for (const row of rows) {
  const item = {
    callNoteId: row.call_note_id,
    leadId: row.lead_id,
    project: row.project_code,
  }
  try {
    const extracted = await extractCallInsightsFromTranscript(row.transcript, {
      outcome: row.summary_outcome || '',
      nextStep: row.summary_next_step || '',
    })
    if (!extracted.ok) {
      results.push({ ...item, error: extracted.error })
      console.log('fail', JSON.stringify({ ...item, error: extracted.error }))
      continue
    }
    await patchAmoCallSummary(row.project_id, row.call_note_id, {
      insights: extracted.insights,
    })
    results.push({
      ...item,
      intent: extracted.insights?.intent || null,
      decline: extracted.insights?.declineReason || null,
      follow: extracted.insights?.needsFollowUp || false,
    })
    console.log(
      'ok',
      JSON.stringify({
        ...item,
        intent: extracted.insights?.intent || null,
        decline: extracted.insights?.declineReason || null,
      }),
    )
  } catch (err) {
    results.push({ ...item, error: err?.message || String(err) })
    console.error('err', JSON.stringify({ ...item, error: err?.message || String(err) }))
  }
}

const intents = {}
for (const row of results) {
  if (row.error) continue
  const key = row.intent || 'null'
  intents[key] = (intents[key] || 0) + 1
}
console.log(
  'DONE',
  JSON.stringify(
    {
      total: results.length,
      ok: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      intents,
    },
    null,
    2,
  ),
)
process.exit(0)
