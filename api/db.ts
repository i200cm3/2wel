import pg from 'pg'
import type { QueryResult, QueryResultRow } from 'pg'
import { loadEnv } from './env.js'

loadEnv()

const { Pool } = pg

let pool: pg.Pool | undefined

export function databaseUrl(): string {
  const url = String(process.env.DATABASE_URL ?? '').trim()
  if (!url) {
    throw new Error('DATABASE_URL не задан. Добавьте его в .env (см. .env.example).')
  }
  return url
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
    })
  }
  return pool
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params)
}

export async function waitForDb({
  attempts = 40,
  delayMs = 500,
}: { attempts?: number; delayMs?: number } = {}): Promise<void> {
  let last: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await query('SELECT 1')
      return
    } catch (err) {
      last = err
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw last instanceof Error ? last : new Error('Не удалось подключиться к Postgres')
}

export async function closePool(): Promise<void> {
  if (!pool) return
  await pool.end()
  pool = undefined
}
