import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function loadEnvFile(filePath, into, { override = false } = {}) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1)
    }
    if (!key) continue
    if (!override && into[key] != null && String(into[key]).length > 0) continue
    into[key] = val
  }
}

let loaded = false

/** Подмешивает корневой .env в process.env, не перезаписывая уже заданные переменные. */
export function loadEnv() {
  if (loaded) return process.env
  loadEnvFile(path.join(ROOT, '.env'), process.env)
  loadEnvFile(path.join(ROOT, 'web', '.env'), process.env)
  loaded = true
  return process.env
}

export function publicDir() {
  loadEnv()
  return path.resolve(process.env.PUBLIC_DIR || path.join(ROOT, 'web/public'))
}
