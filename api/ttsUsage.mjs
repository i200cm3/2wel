import { query } from './db.mjs'
import { fetchWithTimeout } from './fetchTimeout.mjs'

function envPick(key, fallback = '') {
  return String(process.env[key] ?? fallback).trim()
}

/** Записать расход после реальной генерации (не кэш). */
export async function recordTtsUsage({ projectId, provider, characters, voice = '' }) {
  const chars = Math.floor(Number(characters) || 0)
  if (!projectId || chars <= 0) return
  const providerValue = provider === 'sber' ? 'sber' : 'elevenlabs'
  try {
    await query(
      `INSERT INTO tts_usage (user_id, project_id, provider, characters, voice)
       SELECT user_id, id, $2, $3, $4 FROM projects WHERE id = $1`,
      [projectId, providerValue, chars, String(voice ?? '').slice(0, 120)],
    )
  } catch (err) {
    console.error('tts_usage insert failed', err instanceof Error ? err.message : err)
  }
}

function mapUsageRow(row) {
  return {
    id: row.id,
    login: row.login,
    name: row.name || '',
    email: row.email || null,
    characters: Number(row.characters) || 0,
    generations: Number(row.generations) || 0,
    lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
  }
}

/** Сводка по пользователям: сколько символов ушло на ElevenLabs TTS. */
export async function listTtsUsageByUser({ provider = 'elevenlabs', days = 0 } = {}) {
  const providerValue = provider === 'sber' ? 'sber' : 'elevenlabs'
  const dayWindow = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)))
  const params = [providerValue]
  let sinceSql = ''
  if (dayWindow > 0) {
    params.push(dayWindow)
    sinceSql = `AND t.created_at >= now() - ($2::int * interval '1 day')`
  }

  const { rows } = await query(
    `SELECT u.id, u.login, u.name, u.email,
            COALESCE(SUM(t.characters), 0)::int AS characters,
            COUNT(t.id)::int AS generations,
            MAX(t.created_at) AS last_at
     FROM tts_usage t
     JOIN users u ON u.id = t.user_id
     WHERE t.provider = $1
       ${sinceSql}
     GROUP BY u.id, u.login, u.name, u.email
     ORDER BY characters DESC, generations DESC, u.login ASC`,
    params,
  )

  const users = rows.map(mapUsageRow)
  const totals = users.reduce(
    (acc, item) => {
      acc.characters += item.characters
      acc.generations += item.generations
      return acc
    },
    { characters: 0, generations: 0 },
  )

  return { users, totals, days: dayWindow, provider: providerValue }
}

async function fetchSubscriptionViaProxy(proxyBase) {
  const secret = envPick('ELEVENLABS_PROXY_SECRET')
  if (!secret) {
    return { ok: false, error: 'ELEVENLABS_PROXY_SECRET не задан' }
  }
  const base = proxyBase.replace(/\/+$/, '')
  try {
    const res = await fetchWithTimeout(
      `${base}/v1/subscription`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
      },
      15_000,
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error || `proxy HTTP ${res.status}`,
        detail: body?.detail || '',
      }
    }
    return { ok: true, ...normalizeSubscription(body) }
  } catch (err) {
    return {
      ok: false,
      error: 'Не удалось связаться с ElevenLabs proxy',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

async function fetchSubscriptionDirect() {
  const apiKey = envPick('ELEVENLABS_API_KEY')
  if (!apiKey) {
    return { ok: false, error: 'ElevenLabs не настроен' }
  }
  try {
    const res = await fetchWithTimeout(
      'https://api.elevenlabs.io/v1/user/subscription',
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
      },
      15_000,
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        error: `ElevenLabs HTTP ${res.status}`,
        detail: typeof body?.detail === 'string' ? body.detail : JSON.stringify(body).slice(0, 400),
      }
    }
    return { ok: true, ...normalizeSubscription(body) }
  } catch (err) {
    return {
      ok: false,
      error: 'ElevenLabs недоступен',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

function normalizeSubscription(raw) {
  const characterCount = Number(raw?.character_count ?? raw?.characterCount) || 0
  const characterLimit = Number(raw?.character_limit ?? raw?.characterLimit) || 0
  const remaining = Math.max(0, characterLimit - characterCount)
  const resetUnix = Number(raw?.next_character_count_reset_unix ?? raw?.nextResetUnix) || 0
  return {
    tier: String(raw?.tier ?? ''),
    status: String(raw?.status ?? ''),
    characterCount,
    characterLimit,
    charactersRemaining: remaining,
    nextResetAt: resetUnix > 0 ? new Date(resetUnix * 1000).toISOString() : null,
  }
}

/** Баланс символов ElevenLabs (через proxy или напрямую). */
export async function fetchElevenlabsBalance() {
  const proxyUrl = envPick('ELEVENLABS_PROXY_URL')
  if (proxyUrl) return fetchSubscriptionViaProxy(proxyUrl)
  return fetchSubscriptionDirect()
}

export async function getAdminTtsUsageOverview({ days = 0 } = {}) {
  const usage = await listTtsUsageByUser({ provider: 'elevenlabs', days })
  const elevenlabs = await fetchElevenlabsBalance()
  return { ...usage, elevenlabs }
}
