#!/usr/bin/env node
/**
 * Сжимает картинки медиатек проектов: длинная сторона ≤ 1920, вес целимся ≤ ~400 КБ.
 * Пути обычно сохраняются; PNG без альфы может стать .jpg — тогда патчим JSON-ссылки.
 *
 * Usage:
 *   node api/optimize-library.mjs              # все проекты
 *   node api/optimize-library.mjs djinal       # один код
 *   node api/optimize-library.mjs --force      # без skipIfOk
 */
import fs from 'node:fs'
import path from 'node:path'
import { publicDir } from './env.mjs'
import { optimizeImagesInDir } from './imageOptimize.mjs'
import { rebuildLibraryManifest } from './templateArchive.mjs'

const args = process.argv.slice(2).filter((a) => a !== '--force')
const force = process.argv.includes('--force')
const onlyCode = args[0] || null

const root = publicDir()
const projectsRoot = path.resolve(root, 'media/projects')
if (!fs.existsSync(projectsRoot)) {
  console.error(`нет каталога ${projectsRoot}`)
  process.exit(1)
}

const codes = onlyCode
  ? [onlyCode]
  : fs
      .readdirSync(projectsRoot)
      .filter((name) => fs.statSync(path.join(projectsRoot, name)).isDirectory())
      .sort()

/** @type {Map<string, string>} */
const renames = new Map()

function rewriteJsonTree(value, map) {
  if (typeof value === 'string') {
    return map.get(value) ?? value
  }
  if (Array.isArray(value)) return value.map((item) => rewriteJsonTree(item, map))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewriteJsonTree(v, map)
    return out
  }
  return value
}

function patchJsonFiles(dir, map) {
  if (!fs.existsSync(dir) || map.size === 0) return 0
  let n = 0
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const full = path.join(dir, name)
    const raw = fs.readFileSync(full, 'utf8')
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    const next = rewriteJsonTree(data, map)
    const before = JSON.stringify(data)
    const after = JSON.stringify(next)
    if (after !== before) {
      fs.writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      n += 1
    }
  }
  return n
}

let grandBefore = 0
let grandAfter = 0
let grandChanged = 0

for (const code of codes) {
  const library = path.join(projectsRoot, code, 'library')
  if (!fs.existsSync(library)) {
    console.log(`[${code}] нет library — skip`)
    continue
  }
  console.log(`\n=== ${code} ===`)
  const summary = await optimizeImagesInDir(library, {
    skipIfOk: !force,
    onFile(file, result) {
      if (!result.changed) return
      const rel = path.relative(library, result.toPath || file)
      const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`
      const renameNote =
        result.toPath && result.fromPath && result.toPath !== result.fromPath
          ? `  [rename ${path.basename(result.fromPath)} → ${path.basename(result.toPath)}]`
          : ''
      console.log(
        `  ${rel}: ${mb(result.bytesBefore)} → ${mb(result.bytesAfter)} (−${Math.round((1 - result.bytesAfter / result.bytesBefore) * 100)}%)${renameNote}`,
      )
      if (result.toPath && result.fromPath && result.toPath !== result.fromPath) {
        const fromSrc = `/media/projects/${code}/library/${path.relative(library, result.fromPath).replace(/\\/g, '/')}`
        const toSrc = `/media/projects/${code}/library/${path.relative(library, result.toPath).replace(/\\/g, '/')}`
        renames.set(fromSrc, toSrc)
      }
    },
  })
  rebuildLibraryManifest(code)
  grandBefore += summary.bytesBefore
  grandAfter += summary.bytesAfter
  grandChanged += summary.changed
  console.log(
    `[${code}] files=${summary.total} changed=${summary.changed} skipped=${summary.skipped} errors=${summary.errors.length}`,
  )
  console.log(
    `[${code}] ${(summary.bytesBefore / 1024 / 1024).toFixed(1)}MB → ${(summary.bytesAfter / 1024 / 1024).toFixed(1)}MB`,
  )
  for (const err of summary.errors.slice(0, 5)) {
    console.error(`  ERR ${err.file}: ${err.error}`)
  }
}

if (renames.size) {
  console.log(`\nПереименований: ${renames.size}`)
  const props = patchJsonFiles(path.join(root, 'properties'), renames)
  const links = patchJsonFiles(path.join(root, 's'), renames)
  console.log(`Патч JSON: properties=${props}, s=${links}`)
  try {
    const { query } = await import('./db.mjs')
    for (const [fromSrc, toSrc] of renames) {
      const r1 = await query(
        `UPDATE templates
         SET config = replace(config::text, $1, $2)::jsonb,
             draft_config = CASE
               WHEN draft_config IS NULL THEN NULL
               ELSE replace(draft_config::text, $1, $2)::jsonb
             END,
             updated_at = now()
         WHERE config::text LIKE $3 OR coalesce(draft_config::text, '') LIKE $3`,
        [fromSrc, toSrc, `%${fromSrc}%`],
      )
      console.log(`  DB templates ${path.basename(fromSrc)} → ${path.basename(toSrc)}: ${r1.rowCount ?? '?'}`)
    }
  } catch (err) {
    console.warn(`DB patch skipped: ${err?.message || err}`)
  }
}

console.log(
  `\nDONE changed=${grandChanged} ${(grandBefore / 1024 / 1024).toFixed(1)}MB → ${(grandAfter / 1024 / 1024).toFixed(1)}MB`,
)
