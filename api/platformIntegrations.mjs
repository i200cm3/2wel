import { query } from './db.js'
import { loadEnv } from './env.js'

export const SETTING_KEYS = {
  geminiApiKey: 'integrations.gemini.api_key',
  elevenlabsApiKey: 'integrations.elevenlabs.api_key',
  yandexApiKey: 'integrations.yandex.api_key',
  yandexFolderId: 'integrations.yandex.folder_id',
  transcribeProvider: 'capabilities.transcribe.provider',
  assemblyProvider: 'capabilities.assembly.provider',
}

export const TRANSCRIBE_PROVIDERS = [{ id: 'gigaam', label: 'GigaAM', available: true }]

export const ASSEMBLY_PROVIDERS = [
  { id: 'gemini', label: 'Gemini', available: true },
  { id: 'yandex', label: 'YandexGPT', available: true },
]

const INTEGRATION_DEFS = [
  {
    id: 'gemini',
    label: 'Gemini',
    settingKey: SETTING_KEYS.geminiApiKey,
    envKey: 'GEMINI_API_KEY',
    comingSoon: false,
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    settingKey: SETTING_KEYS.elevenlabsApiKey,
    envKey: 'ELEVENLABS_API_KEY',
    comingSoon: false,
  },
  {
    id: 'yandex',
    label: 'Яндекс',
    settingKey: SETTING_KEYS.yandexApiKey,
    envKey: 'YANDEX_SPEECHKIT_API_KEY',
    comingSoon: false,
  },
]

const CACHE_TTL_MS = 15_000
let settingsCache = null
let settingsCacheAt = 0

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

export function invalidatePlatformSettingsCache() {
  settingsCache = null
  settingsCacheAt = 0
}

/** Синхронный peek: только уже загруженный кэш (без запроса в БД). */
export function peekCachedSetting(key) {
  if (!settingsCache) return ''
  return String(settingsCache[key] ?? '').trim()
}

export async function warmPlatformSettingsCache() {
  await loadSettingsMap()
}

export function maskApiKey(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.length <= 8) return '••••••••'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

export function normalizeTranscribeProvider(_value) {
  return 'gigaam'
}

export function normalizeAssemblyProvider(value) {
  const id = String(value ?? '').trim().toLowerCase()
  if (id === 'yandex') return 'yandex'
  return 'gemini'
}

async function loadSettingsMap({ force = false } = {}) {
  if (!force && settingsCache && Date.now() - settingsCacheAt < CACHE_TTL_MS) {
    return settingsCache
  }
  const { rows } = await query('SELECT key, value FROM platform_settings')
  const map = Object.create(null)
  for (const row of rows) {
    map[row.key] = String(row.value ?? '')
  }
  settingsCache = map
  settingsCacheAt = Date.now()
  return map
}

export async function getPlatformSetting(key) {
  const map = await loadSettingsMap()
  return String(map[key] ?? '').trim()
}

async function upsertPlatformSetting(key, value) {
  const next = String(value ?? '')
  await query(
    `INSERT INTO platform_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
    [key, next],
  )
  invalidatePlatformSettingsCache()
}

async function deletePlatformSetting(key) {
  await query('DELETE FROM platform_settings WHERE key = $1', [key])
  invalidatePlatformSettingsCache()
}

export async function resolveGeminiApiKey() {
  const fromDb = await getPlatformSetting(SETTING_KEYS.geminiApiKey)
  if (fromDb) return fromDb
  return env('GEMINI_API_KEY')
}

export async function resolveElevenlabsApiKey() {
  const fromDb = await getPlatformSetting(SETTING_KEYS.elevenlabsApiKey)
  if (fromDb) return fromDb
  return env('ELEVENLABS_API_KEY')
}

export async function resolveYandexApiKey() {
  const fromDb = await getPlatformSetting(SETTING_KEYS.yandexApiKey)
  if (fromDb) return fromDb
  return env('YANDEX_SPEECHKIT_API_KEY')
}

export async function resolveYandexFolderId() {
  const fromDb = await getPlatformSetting(SETTING_KEYS.yandexFolderId)
  if (fromDb) return fromDb
  return env('YANDEX_FOLDER_ID') || env('YC_FOLDER_ID')
}

export async function resolveTranscribeProvider() {
  return 'gigaam'
}

export async function resolveAssemblyProvider() {
  const raw = await getPlatformSetting(SETTING_KEYS.assemblyProvider)
  return normalizeAssemblyProvider(raw || 'gemini')
}

/** Транскрибация звонков — только локальный GigaAM. */
export async function isTranscribeConfigured() {
  return Boolean(env('GIGAAM_TRANSCRIBE_URL'))
}

export async function isGeminiTextConfigured() {
  if (env('GEMINI_TRANSCRIBE_URL')) return true
  return Boolean(await resolveGeminiApiKey())
}

/** LLM для сводки/сборки (Gemini или YandexGPT). */
export async function isAssemblyTextConfigured() {
  const provider = await resolveAssemblyProvider()
  if (provider === 'yandex') {
    return Boolean((await resolveYandexApiKey()) && (await resolveYandexFolderId()))
  }
  return isGeminiTextConfigured()
}

/** Почему extract нельзя запустить — для UI/логов. */
export async function assemblyTextConfigError() {
  const provider = await resolveAssemblyProvider()
  if (provider === 'yandex') {
    if (!(await resolveYandexApiKey())) {
      return 'Не задан API key Яндекса (Админ → API)'
    }
    if (!(await resolveYandexFolderId())) {
      return 'Не задан Folder ID каталога Яндекса (Админ → API → Яндекс)'
    }
    return null
  }
  if (await isGeminiTextConfigured()) return null
  return 'Не задан Gemini (ключ или GEMINI_TRANSCRIBE_URL)'
}

function integrationPublicView(def, map) {
  const fromDb = String(map[def.settingKey] ?? '').trim()
  const fromEnv = env(def.envKey)
  const hasKey = Boolean(fromDb || fromEnv)
  let source = 'none'
  if (fromDb) source = 'database'
  else if (fromEnv) source = 'env'
  const view = {
    id: def.id,
    label: def.label,
    comingSoon: Boolean(def.comingSoon),
    hasKey,
    keyHint: fromDb ? maskApiKey(fromDb) : null,
    source,
  }
  if (def.id === 'yandex') {
    const folderFromDb = String(map[SETTING_KEYS.yandexFolderId] ?? '').trim()
    const folderFromEnv = env('YANDEX_FOLDER_ID') || env('YC_FOLDER_ID')
    view.folderId = folderFromDb || null
    view.hasFolderId = Boolean(folderFromDb || folderFromEnv)
    view.folderIdSource = folderFromDb ? 'database' : folderFromEnv ? 'env' : 'none'
  }
  return view
}

export async function getAdminIntegrationsOverview() {
  const map = await loadSettingsMap({ force: true })
  const assemblyProvider = normalizeAssemblyProvider(map[SETTING_KEYS.assemblyProvider] || 'gemini')
  return {
    transcribeProvider: 'gigaam',
    transcribeProviders: TRANSCRIBE_PROVIDERS.map((item) => ({ ...item })),
    assemblyProvider,
    assemblyProviders: ASSEMBLY_PROVIDERS.map((item) => ({ ...item })),
    integrations: INTEGRATION_DEFS.map((def) => integrationPublicView(def, map)),
  }
}

/**
 * @param {{
 *   transcribeProvider?: string
 *   assemblyProvider?: string
 *   secrets?: Record<string, string | null | undefined>
 *   configs?: { yandexFolderId?: string | null }
 * }} payload
 */
export async function updateAdminIntegrations(payload = {}) {
  const secrets = payload?.secrets && typeof payload.secrets === 'object' ? payload.secrets : {}
  const configs = payload?.configs && typeof payload.configs === 'object' ? payload.configs : {}

  if (payload.assemblyProvider !== undefined) {
    const next = normalizeAssemblyProvider(payload.assemblyProvider)
    const meta = ASSEMBLY_PROVIDERS.find((item) => item.id === next)
    if (meta && !meta.available) {
      return {
        ok: false,
        status: 400,
        error: `${meta.label} пока не подключён — выберите другой сервис`,
      }
    }
    await upsertPlatformSetting(SETTING_KEYS.assemblyProvider, next)
  }

  if (Object.prototype.hasOwnProperty.call(configs, 'yandexFolderId')) {
    const value = String(configs.yandexFolderId ?? '').trim()
    if (!value) await deletePlatformSetting(SETTING_KEYS.yandexFolderId)
    else await upsertPlatformSetting(SETTING_KEYS.yandexFolderId, value)
  }

  for (const def of INTEGRATION_DEFS) {
    if (!Object.prototype.hasOwnProperty.call(secrets, def.id)) continue
    if (def.comingSoon) {
      return {
        ok: false,
        status: 400,
        error: `${def.label} пока нельзя настроить`,
      }
    }
    const raw = secrets[def.id]
    if (raw === null || raw === undefined) continue
    const value = String(raw).trim()
    if (!value) {
      await deletePlatformSetting(def.settingKey)
    } else {
      await upsertPlatformSetting(def.settingKey, value)
    }
  }

  const overview = await getAdminIntegrationsOverview()
  return { ok: true, ...overview }
}
