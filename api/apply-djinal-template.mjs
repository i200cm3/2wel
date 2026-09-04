#!/usr/bin/env node
/**
 * Публикует properties/djinal.json (PUBLIC_DIR) в шаблон проекта djinal.
 * Seed сам конфиг не перезаписывает.
 *
 * Локально:  cd api && node apply-djinal-template.mjs
 * На сервере: docker compose exec api node apply-djinal-template.mjs
 *   (после sync + rebuild api, либо: docker cp api/apply-djinal-template.mjs promo-api:/app/)
 */
import fs from 'node:fs'
import path from 'node:path'
import { closePool, query, waitForDb } from './db.js'
import { publicDir } from './env.js'

const filePath = path.join(publicDir(), 'properties', 'djinal.json')

async function main() {
  if (!fs.existsSync(filePath)) throw new Error(`Нет файла: ${filePath}`)
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  await waitForDb()
  const { rows } = await query(
    `SELECT t.id, t.code
     FROM templates t
     JOIN projects p ON p.id = t.project_id
     WHERE p.code = 'djinal'`,
  )
  if (!rows.length) throw new Error('Проект/шаблон djinal не найден — сначала seed')
  for (const row of rows) {
    await query(
      `UPDATE templates
       SET config = $2::jsonb,
           draft_config = NULL,
           status = 'published',
           updated_at = now()
       WHERE id = $1`,
      [row.id, JSON.stringify(config)],
    )
    console.log(`apply-djinal: published ${row.code} (${row.id})`)
  }
}

main()
  .then(async () => {
    await closePool()
  })
  .catch(async (err) => {
    console.error(err)
    await closePool().catch(() => undefined)
    process.exit(1)
  })
