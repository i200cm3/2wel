import { getPool, query } from './db.js'
import { loadEnv } from './env.js'

export const SETTING_KEYS = {
  elevenlabsApiKey: 'integrations.elevenlabs.api_key',
  yandexApiKey: 'integrations.yandex.api_key',
  yandexFolderId: 'integrations.yandex.folder_id',
  transcribeProvider: 'capabilities.transcribe.provider',
  assemblyProvider: 'capabilities.assembly.provider',
  extractModel: 'capabilities.extract.model',
}

export const TRANSCRIBE_PROVIDERS = [{ id: 'gigaam', label: 'GigaAM', available: true }]

export const ASSEMBLY_PROVIDERS = [
  { id: 'yandex', label: 'YandexGPT', available: true },
  { id: 'local', label: 'Qwen', available: true },
]

const INTEGRATION_DEFS = [
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
const ELEVENLABS_PROVIDER = 'elevenlabs'
let settingsCache = null
let settingsCacheAt = 0
/** @type {{ hasAny: boolean, activeKey: string, at: number } | null} */
let elevenlabsKeyCache = null

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

export function invalidatePlatformSettingsCache() {
  settingsCache = null
  settingsCacheAt = 0
  elevenlabsKeyCache = null
}

/** Синхронный peek: только уже загруженный кэш (без запроса в БД). */
export function peekCachedSetting(key) {
  if (!settingsCache) return ''
  return String(settingsCache[key] ?? '').trim()
}

/** Есть ли ключи ElevenLabs в таблице (после warm/CRUD). */
export function peekElevenlabsHasKeys() {
  return Boolean(elevenlabsKeyCache?.hasAny)
}

export async function warmPlatformSettingsCache() {
  await loadSettingsMap()
  await refreshElevenlabsKeyCache()
}

async function refreshElevenlabsKeyCache() {
  const { rows } = await query(
    `SELECT api_key, is_active
     FROM platform_api_keys
     WHERE provider = $1
     ORDER BY is_active DESC, created_at DESC`,
    [ELEVENLABS_PROVIDER],
  )
  const active = rows.find((row) => row.is_active)
  elevenlabsKeyCache = {
    hasAny: rows.length > 0,
    activeKey: String(active?.api_key ?? '').trim(),
    at: Date.now(),
  }
  return elevenlabsKeyCache
}

function mapElevenlabsKeyRow(row) {
  const apiKey = String(row.api_key ?? '').trim()
  const label = String(row.label ?? '').trim()
  return {
    id: String(row.id),
    label: label || maskApiKey(apiKey) || 'Ключ',
    keyHint: maskApiKey(apiKey),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

export async function listElevenlabsApiKeys() {
  const { rows } = await query(
    `SELECT id, label, api_key, is_active, created_at
     FROM platform_api_keys
     WHERE provider = $1
     ORDER BY is_active DESC, created_at DESC`,
    [ELEVENLABS_PROVIDER],
  )
  return rows.map(mapElevenlabsKeyRow)
}

async function activateElevenlabsApiKeyTx(client, id) {
  await client.query(
    `UPDATE platform_api_keys SET is_active = false, updated_at = now()
     WHERE provider = $1 AND is_active`,
    [ELEVENLABS_PROVIDER],
  )
  const { rowCount } = await client.query(
    `UPDATE platform_api_keys
     SET is_active = true, updated_at = now()
     WHERE id = $1 AND provider = $2`,
    [id, ELEVENLABS_PROVIDER],
  )
  return rowCount > 0
}

/**
 * Добавить ключ ElevenLabs. По умолчанию сразу делает его активным
 * (генерация и баланс идут через выбранный ключ).
 */
export async function addElevenlabsApiKey({ apiKey, label = '', activate = true } = {}) {
  const value = String(apiKey ?? '').trim()
  if (!value) {
    return { ok: false, status: 400, error: 'Пустой API key' }
  }
  const name = String(label ?? '').trim().slice(0, 80)
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO platform_api_keys (provider, label, api_key, is_active)
       VALUES ($1, $2, $3, false)
       RETURNING id`,
      [ELEVENLABS_PROVIDER, name, value],
    )
    const id = inserted.rows[0]?.id
    if (activate && id) {
      await activateElevenlabsApiKeyTx(client, id)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  invalidatePlatformSettingsCache()
  const overview = await getAdminIntegrationsOverview()
  return { ok: true, ...overview }
}

export async function selectElevenlabsApiKey(id) {
  const keyId = String(id ?? '').trim()
  if (!keyId) {
    return { ok: false, status: 400, error: 'Не указан ключ' }
  }
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ok = await activateElevenlabsApiKeyTx(client, keyId)
    if (!ok) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Ключ не найден' }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  invalidatePlatformSettingsCache()
  const overview = await getAdminIntegrationsOverview()
  return { ok: true, ...overview }
}

export async function deleteElevenlabsApiKey(id) {
  const keyId = String(id ?? '').trim()
  if (!keyId) {
    return { ok: false, status: 400, error: 'Не указан ключ' }
  }
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      `SELECT id, is_active FROM platform_api_keys
       WHERE id = $1 AND provider = $2
       FOR UPDATE`,
      [keyId, ELEVENLABS_PROVIDER],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Ключ не найден' }
    }
    const wasActive = Boolean(existing.rows[0].is_active)
    await client.query(`DELETE FROM platform_api_keys WHERE id = $1`, [keyId])
    if (wasActive) {
      const next = await client.query(
        `SELECT id FROM platform_api_keys
         WHERE provider = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [ELEVENLABS_PROVIDER],
      )
      if (next.rows[0]?.id) {
        await activateElevenlabsApiKeyTx(client, next.rows[0].id)
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  invalidatePlatformSettingsCache()
  const overview = await getAdminIntegrationsOverview()
  return { ok: true, ...overview }
}

export function maskApiKey(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.length <= 8) return '••••••••'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

/** Folder id каталога — не секрет, но в UI не светим целиком. */
export function maskFolderId(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (s.length <= 8) return '••••••••'
  return `${s.slice(0, 3)}…${s.slice(-3)}`
}

export function normalizeTranscribeProvider(_value) {
  return 'gigaam'
}

export function normalizeAssemblyProvider(value) {
  const id = String(value ?? '').trim().toLowerCase()
  if (id === 'local' || id === 'ollama' || id === 'qwen') return 'local'
  return 'yandex'
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

export async function resolveElevenlabsApiKey() {
  const cache =
    elevenlabsKeyCache && Date.now() - elevenlabsKeyCache.at < CACHE_TTL_MS
      ? elevenlabsKeyCache
      : await refreshElevenlabsKeyCache()
  if (cache.activeKey) return cache.activeKey
  // Legacy: одиночный ключ в platform_settings (до миграции / локально).
  const fromDb = await getPlatformSetting(SETTING_KEYS.elevenlabsApiKey)
  if (fromDb) return fromDb
  return env('ELEVENLABS_API_KEY')
}

/** Метаданные активного ключа для UI баланса (без секрета). */
export async function resolveElevenlabsActiveKeyMeta() {
  const { rows } = await query(
    `SELECT id, label, api_key
     FROM platform_api_keys
     WHERE provider = $1 AND is_active
     LIMIT 1`,
    [ELEVENLABS_PROVIDER],
  )
  const row = rows[0]
  if (!row) {
    const legacy = await resolveElevenlabsApiKey()
    if (!legacy) return null
    return {
      id: null,
      label: 'Ключ',
      keyHint: maskApiKey(legacy),
    }
  }
  const apiKey = String(row.api_key ?? '').trim()
  const label = String(row.label ?? '').trim()
  return {
    id: String(row.id),
    label: label || maskApiKey(apiKey) || 'Ключ',
    keyHint: maskApiKey(apiKey),
  }
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
  return normalizeAssemblyProvider(raw || 'yandex')
}

export async function resolveExtractModel() {
  const { defaultLocalLlmModel, normalizeLocalModelId } = await import('./localLlm.mjs')
  const fromDb = await getPlatformSetting(SETTING_KEYS.extractModel)
  return normalizeLocalModelId(fromDb, defaultLocalLlmModel()) || defaultLocalLlmModel()
}

export function isLocalLlmUrlConfigured() {
  return Boolean(env('LOCAL_LLM_URL'))
}

/** {hello} — только YandexGPT. Локальный LLM только для extract. */
export async function resolveHelloProvider() {
  return 'yandex'
}

export async function isHelloTextConfigured() {
  return Boolean((await resolveYandexApiKey()) && (await resolveYandexFolderId()))
}

/** Транскрибация звонков — только локальный GigaAM. */
export async function isTranscribeConfigured() {
  return Boolean(env('GIGAAM_TRANSCRIBE_URL'))
}

/** LLM для extract-сводки (YandexGPT или Qwen). */
export async function isAssemblyTextConfigured() {
  const provider = await resolveAssemblyProvider()
  if (provider === 'local') return isLocalLlmUrlConfigured()
  return Boolean((await resolveYandexApiKey()) && (await resolveYandexFolderId()))
}

/** Почему extract нельзя запустить — для UI/логов. */
export async function assemblyTextConfigError() {
  const provider = await resolveAssemblyProvider()
  if (provider === 'local') {
    return isLocalLlmUrlConfigured() ? null : 'Локальный LLM не подключён'
  }
  if (!(await resolveYandexApiKey())) {
    return 'Не задан API key Яндекса (Админ → API)'
  }
  if (!(await resolveYandexFolderId())) {
    return 'Не задан Folder ID каталога Яндекса (Админ → API → Яндекс)'
  }
  return null
}

function integrationPublicView(def, map, elevenlabsKeys = []) {
  const fromDb = String(map[def.settingKey] ?? '').trim()
  const fromEnv = env(def.envKey)
  const view = {
    id: def.id,
    label: def.label,
    comingSoon: Boolean(def.comingSoon),
    hasKey: false,
    keyHint: null,
    source: 'none',
  }

  if (def.id === 'elevenlabs') {
    const active = elevenlabsKeys.find((item) => item.isActive) || null
    const hasTableKeys = elevenlabsKeys.length > 0
    view.keys = elevenlabsKeys
    view.activeKeyId = active?.id ?? null
    view.hasKey = hasTableKeys || Boolean(fromDb || fromEnv || env('ELEVENLABS_PROXY_URL'))
    view.keyHint = active?.keyHint || (fromDb ? maskApiKey(fromDb) : null)
    if (hasTableKeys || fromDb) view.source = 'database'
    else if (fromEnv || env('ELEVENLABS_PROXY_URL')) view.source = 'env'
    return view
  }

  const hasKey = Boolean(fromDb || fromEnv)
  view.hasKey = hasKey
  view.keyHint = fromDb ? maskApiKey(fromDb) : null
  if (fromDb) view.source = 'database'
  else if (fromEnv) view.source = 'env'

  if (def.id === 'yandex') {
    const folderFromDb = String(map[SETTING_KEYS.yandexFolderId] ?? '').trim()
    const folderFromEnv = env('YANDEX_FOLDER_ID') || env('YC_FOLDER_ID')
    const folderRaw = folderFromDb || folderFromEnv
    view.folderId = null
    view.folderIdHint = folderRaw ? maskFolderId(folderRaw) : null
    view.hasFolderId = Boolean(folderRaw)
    view.folderIdSource = folderFromDb ? 'database' : folderFromEnv ? 'env' : 'none'
  }
  return view
}

export async function getAdminIntegrationsOverview() {
  const map = await loadSettingsMap({ force: true })
  await refreshElevenlabsKeyCache()
  const elevenlabsKeys = await listElevenlabsApiKeys()
  const assemblyProvider = normalizeAssemblyProvider(map[SETTING_KEYS.assemblyProvider] || 'yandex')
  const { defaultLocalLlmModel, listLocalLlmModels, normalizeLocalModelId } = await import('./localLlm.mjs')
  const listed = assemblyProvider === 'local' ? await listLocalLlmModels() : { ok: true, models: [], error: null }
  const extractModel =
    normalizeLocalModelId(map[SETTING_KEYS.extractModel], defaultLocalLlmModel()) || defaultLocalLlmModel()
  const localAvailable = isLocalLlmUrlConfigured()
  return {
    transcribeProvider: 'gigaam',
    transcribeProviders: TRANSCRIBE_PROVIDERS.map((item) => ({ ...item })),
    assemblyProvider,
    assemblyProviders: ASSEMBLY_PROVIDERS.map((item) => ({
      ...item,
      available: item.id !== 'local' || localAvailable,
    })),
    extractModel,
    extractModels: listed.models,
    localLlmConfigured: localAvailable,
    localLlmError: listed.error,
    integrations: INTEGRATION_DEFS.map((def) => integrationPublicView(def, map, elevenlabsKeys)),
  }
}

/**
 * @param {{
 *   transcribeProvider?: string
 *   assemblyProvider?: string
 *   extractModel?: string
 *   secrets?: Record<string, string | null | undefined>
 *   configs?: { yandexFolderId?: string | null }
 * }} payload
 */
export async function updateAdminIntegrations(payload = {}) {
  const secrets = payload?.secrets && typeof payload.secrets === 'object' ? payload.secrets : {}
  const configs = payload?.configs && typeof payload.configs === 'object' ? payload.configs : {}

  if (payload.assemblyProvider !== undefined) {
    const next = normalizeAssemblyProvider(payload.assemblyProvider)
    if (next === 'local' && !isLocalLlmUrlConfigured()) {
      return {
        ok: false,
        status: 400,
        error: 'Локальный LLM не подключён',
      }
    }
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

  if (payload.extractModel !== undefined) {
    const { defaultLocalLlmModel, normalizeLocalModelId } = await import('./localLlm.mjs')
    const next = normalizeLocalModelId(payload.extractModel, defaultLocalLlmModel()) || defaultLocalLlmModel()
    await upsertPlatformSetting(SETTING_KEYS.extractModel, next)
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
    // ElevenLabs: одиночный secrets.elevenlabs → добавить ключ и сделать активным.
    if (def.id === 'elevenlabs') {
      if (!value) continue
      return addElevenlabsApiKey({ apiKey: value, activate: true })
    }
    if (!value) {
      await deletePlatformSetting(def.settingKey)
    } else {
      await upsertPlatformSetting(def.settingKey, value)
    }
  }

  const overview = await getAdminIntegrationsOverview()
  return { ok: true, ...overview }
}

/**
 * Лёгкая проверка связи для админки API.
 * @param {string} provider `yandex` | `elevenlabs` | `local`
 */
export async function testAdminIntegration(provider) {
  const id = String(provider ?? '').trim().toLowerCase()

  if (id === 'local' || id === 'ollama' || id === 'qwen') {
    if (!isLocalLlmUrlConfigured()) {
      return { ok: false, status: 400, error: 'Локальный LLM не подключён' }
    }
    const { listLocalLlmModels } = await import('./localLlm.mjs')
    const listed = await listLocalLlmModels()
    if (!listed.ok) {
      return {
        ok: false,
        status: 502,
        error: listed.error || 'Локальный LLM недоступен',
      }
    }
    return {
      ok: true,
      message: `Локальный LLM отвечает · моделей: ${listed.models.length}`,
    }
  }

  if (id === 'elevenlabs') {
    const { fetchElevenlabsBalance } = await import('./ttsUsage.mjs')
    const bal = await fetchElevenlabsBalance()
    if (!bal.ok) {
      return {
        ok: false,
        status: 502,
        error: bal.error || 'ElevenLabs недоступен',
        detail: bal.detail || undefined,
      }
    }
    const rem = Number(bal.charactersRemaining)
    const remLabel = Number.isFinite(rem) ? ` · осталось ${rem} символов` : ''
    return { ok: true, message: `ElevenLabs отвечает${remLabel}` }
  }

  if (id === 'yandex') {
    if (!(await resolveYandexApiKey())) {
      return { ok: false, status: 400, error: 'Не задан API key Яндекса' }
    }
    if (!(await resolveYandexFolderId())) {
      return {
        ok: false,
        status: 400,
        error: 'Не задан Folder ID каталога Яндекса',
      }
    }
    const { generateTextWithYandex } = await import('./yandexGpt.mjs')
    const generated = await generateTextWithYandex('Ответь одним словом: ок', {
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 20_000,
    })
    if (!generated?.ok) {
      return {
        ok: false,
        status: generated?.status || 502,
        error: generated?.error || 'YandexGPT недоступен',
        detail: generated?.detail || undefined,
      }
    }
    return { ok: true, message: 'YandexGPT отвечает (ключ и folder id ок)' }
  }

  return { ok: false, status: 400, error: 'Неизвестный провайдер' }
}
