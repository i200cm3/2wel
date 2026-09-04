#!/usr/bin/env node
/**
 * Профиль sync звонков amo для одной ссылки.
 *
 * Usage:
 *   node scripts/profile-amo-sync.mjs [projectCode] [publicId|leadId]
 *
 * Без аргументов берёт первую ссылку с external_id у проекта с amo_connection.
 */
import { amoRedirectUri } from '../api/amoAuth.mjs'
import { syncAmoCallsToLink } from '../api/amoCalls.mjs'
import { getAmoConnection } from '../api/amoConnections.mjs'
import { query, getPool } from '../api/db.mjs'
import { loadEnv } from '../api/env.mjs'

loadEnv()

async function resolveTarget(projectCode, idOrPublic) {
  if (projectCode && idOrPublic) {
    const byPublic = await query(
      `SELECT l.id, l.public_id, l.external_id, l.project_id, p.code AS project_code
       FROM links l
       JOIN projects p ON p.id = l.project_id
       WHERE p.code = $1 AND (l.public_id = $2 OR l.external_id = $2)
       LIMIT 1`,
      [projectCode, idOrPublic],
    )
    if (byPublic.rows[0]) return byPublic.rows[0]
  }

  const { rows } = await query(
    `SELECT l.id, l.public_id, l.external_id, l.project_id, p.code AS project_code
     FROM links l
     JOIN projects p ON p.id = l.project_id
     JOIN amo_connections c ON c.project_id = p.id
     WHERE l.external_id IS NOT NULL AND btrim(l.external_id) <> ''
     ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
     LIMIT 1`,
  )
  return rows[0] ?? null
}

function printReport(target, result) {
  const t = result.timings || {}
  console.log('\n=== amo sync profile ===')
  console.log(`project=${target.project_code} publicId=${target.public_id} leadId=${target.external_id}`)
  console.log(
    `found=${result.found} withRecording=${result.withRecording} matched=${result.matched} inserted=${result.inserted?.length ?? 0} unavailable=${result.recordingUnavailable}`,
  )
  if (result.error) console.log(`error=${result.error}`)
  console.log(`\ntotalMs=${t.totalMs}`)
  console.log(`  pruneMs=${t.pruneMs}`)
  console.log(`  fetchMs=${t.fetchMs}`)
  console.log(`  probeMs=${t.probeMs}`)
  console.log(`  insertMs=${t.insertMs}`)
  console.log(`  amoRequests=${t.amoRequests} amoMs(sum)=${t.amoMs}`)
  if (Array.isArray(t.phases)) {
    console.log('\nphases:')
    for (const phase of t.phases) console.log(`  ${JSON.stringify(phase)}`)
  }
  if (Array.isArray(t.amoSlowest) && t.amoSlowest.length) {
    console.log('\nslowest amo requests:')
    for (const req of t.amoSlowest) {
      console.log(`  ${req.ms}ms ${req.method} ${req.path} status=${req.status} ok=${req.ok}`)
    }
  }
  console.log('')
}

async function main() {
  const projectCode = process.argv[2] || ''
  const idOrPublic = process.argv[3] || ''
  const target = await resolveTarget(projectCode, idOrPublic)
  if (!target?.external_id) {
    console.error('Не найдена ссылка с external_id и amo_connection')
    process.exit(1)
  }

  const connection = await getAmoConnection(target.project_id)
  if (!connection) {
    console.error('AmoCRM не подключена для проекта', target.project_code)
    process.exit(1)
  }

  console.log('sync start…', {
    project: target.project_code,
    publicId: target.public_id,
    leadId: target.external_id,
    domain: connection.baseDomain,
  })

  const result = await syncAmoCallsToLink({
    connection: { ...connection, projectId: target.project_id, amoTimings: [] },
    redirectUri: amoRedirectUri(),
    linkId: target.id,
    leadId: target.external_id,
    prune: false,
    requireLive: false,
  })

  printReport(target, result)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      await getPool().end()
    } catch {
      // ignore
    }
  })
