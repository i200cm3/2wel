import pg from 'pg'
import { loadEnv } from './env.mjs'

loadEnv()

const { Pool } = pg

let pool

export function databaseUrl() {
  const url = String(process.env.DATABASE_URL ?? '').trim()
  if (!url) {
    throw new Error('DATABASE_URL не задан. Добавьте его в .env (см. .env.example).')
  }
  return url
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
    })
  }
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}

export async function waitForDb({ attempts = 40, delayMs = 500 } = {}) {
  let last
  for (let i = 0; i < attempts; i += 1) {
    try {
      await query('SELECT 1')
      return
    } catch (err) {
      last = err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw last instanceof Error ? last : new Error('Не удалось подключиться к Postgres')
}

export async function closePool() {
  if (!pool) return
  await pool.end()
  pool = undefined
}
