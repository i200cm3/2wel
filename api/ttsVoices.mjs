import { query } from './db.js'
import { loadEnv } from './env.js'
import { elevenDemoAvailable, elevenDemoSrc } from './ttsVoiceDemo.mjs'

export const TTS_PROVIDERS = ['sber', 'elevenlabs']

/** Коды голосовых моделей SaluteSpeech: developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices */
const SBER_VOICE_NAMES = [
  ['Nec', 'Наталья'],
  ['Bys', 'Борис'],
  ['May', 'Марфа'],
  ['Tur', 'Тарас'],
  ['Ost', 'Александра'],
  ['Pon', 'Сергей'],
  ['Kin', 'Kira (английский)'],
]

/** 8 кГц — телефонное качество, оставлено ради полноты каталога Сбера. */
const SBER_RATES = [24000, 8000]

/**
 * Официальные примеры 24 кГц с developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices
 * — для предпрослушивания в кабинете без вызова API.
 */
const SBER_DEMO_24K = {
  Nec_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/e84dc7e6_natasha-hq.mp3',
  Bys_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/58c10867_boris-hq.mp3',
  May_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/a79aeba1_marfa-hq.mp3',
  Tur_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/68545373_taras-hq.mp3',
  Ost_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/33057718_sasha-hq.mp3',
  Pon_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/1df46a9c_sergey-hq.mp3',
  Kin_24000: 'https://cdn-app.sberdevices.ru/misc/0.0.0/assets/bsm-docs/b075fea4_kira-hq.mp3',
}

export function sberDemoSrc(voiceId) {
  return SBER_DEMO_24K[voiceId] ?? ''
}

export const SBER_VOICES = SBER_VOICE_NAMES.flatMap(([code, name]) =>
  SBER_RATES.map((rate) => ({
    id: `${code}_${rate}`,
    name,
    label: `${name} · ${rate / 1000} кГц`,
    sampleRate: rate,
    demoSrc: SBER_DEMO_24K[`${code}_${rate}`] ?? '',
  })),
)

const SBER_FALLBACK_VOICE = 'Nec_24000'

/** Формат voice_id ElevenLabs — только латиница и цифры. */
export const ELEVEN_VOICE_ID_RE = /^[a-zA-Z0-9]{8,64}$/

export function isElevenVoiceId(voice) {
  return ELEVEN_VOICE_ID_RE.test(String(voice ?? '').trim())
}

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

export function sberConfigured() {
  return Boolean(env('SALUTE_SPEECH_AUTH_KEY') || (env('SALUTE_SPEECH_CLIENT_ID') && env('SALUTE_SPEECH_CLIENT_SECRET')))
}

export function elevenConfigured() {
  return Boolean(env('ELEVENLABS_API_KEY') || env('ELEVENLABS_PROXY_URL'))
}

/** Пол голоса из подписи «Имя (…, женский)». */
export function voiceGenderRank(label) {
  const text = String(label ?? '').toLowerCase()
  if (text.includes('женский')) return 0
  if (text.includes('мужской')) return 1
  return 2
}

/** Имя для сортировки — часть до «(». */
export function voiceSortName(label) {
  const raw = String(label ?? '').trim()
  const paren = raw.indexOf('(')
  return (paren > 0 ? raw.slice(0, paren) : raw).trim()
}

/** Доступен в кабинете: есть готовое демо для прослушивания. */
export function voiceCabinetAvailable(voice) {
  return Boolean(voice?.demoSrc)
}

/** Сначала доступные, затем женские/мужские, затем по имени. */
export function sortCabinetVoices(voices) {
  return [...voices]
    .map((voice) => ({
      ...voice,
      available: voiceCabinetAvailable(voice),
    }))
    .sort((a, b) => {
      const aAvail = a.available ? 0 : 1
      const bAvail = b.available ? 0 : 1
      if (aAvail !== bAvail) return aAvail - bAvail

      const aGender = voiceGenderRank(a.label ?? a.name)
      const bGender = voiceGenderRank(b.label ?? b.name)
      if (aGender !== bGender) return aGender - bGender

      return voiceSortName(a.name).localeCompare(voiceSortName(b.name), 'ru')
    })
}

function mapCabinetVoices(voices) {
  return sortCabinetVoices(
    voices.map(({ id, name, label, demoSrc }) => ({
      id,
      name,
      label,
      ...(demoSrc ? { demoSrc } : {}),
    })),
  )
}
function sberDefaultVoice() {
  const wanted = env('SALUTE_SPEECH_VOICE', SBER_FALLBACK_VOICE)
  return SBER_VOICES.some((voice) => voice.id === wanted) ? wanted : SBER_FALLBACK_VOICE
}

/** ELEVENLABS_VOICES=id|Имя,id2|Имя2 — запятые внутри имени допустимы. */
export function parseElevenVoicesEnv(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  return text
    .split(/,(?=[a-zA-Z0-9]{8,64}\|)/)
    .map((chunk) => {
      const pipe = chunk.indexOf('|')
      if (pipe <= 0) return null
      const id = chunk.slice(0, pipe).trim()
      const name = chunk.slice(pipe + 1).trim()
      if (!id || !isElevenVoiceId(id)) return null
      return { id, name }
    })
    .filter(Boolean)
}

/** ELEVENLABS_VOICES=id|Имя,id2|Имя2 — иначе только голос из ELEVENLABS_VOICE_ID. */
export function elevenVoices() {
  const out = []
  const seen = new Set()
  for (const { id: voiceId, name } of parseElevenVoicesEnv(env('ELEVENLABS_VOICES'))) {
    if (seen.has(voiceId)) continue
    seen.add(voiceId)
    const label = name || voiceId
    const demoSrc = elevenDemoAvailable(voiceId) ? elevenDemoSrc(voiceId) : ''
    out.push({ id: voiceId, name: label, label, ...(demoSrc ? { demoSrc } : {}) })
  }
  const fromEnv = env('ELEVENLABS_VOICE_ID')
  if (fromEnv && isElevenVoiceId(fromEnv) && !seen.has(fromEnv)) {
    const demoSrc = elevenDemoAvailable(fromEnv) ? elevenDemoSrc(fromEnv) : ''
    out.unshift({
      id: fromEnv,
      name: 'Голос из .env',
      label: `Голос из .env · ${fromEnv}`,
      ...(demoSrc ? { demoSrc } : {}),
    })
  }
  return out
}

function firstAvailableVoiceId(voices) {
  return voices.find((item) => item.available !== false)?.id ?? voices[0]?.id ?? ''
}

function elevenDefaultVoice() {
  return firstAvailableVoiceId(mapCabinetVoices(elevenVoices()))
}

/** ID ElevenLabs по id, подписи или имени из каталога. */
export function resolveElevenVoice(wantedVoice, voices = providerVoices('elevenlabs')) {
  const raw = String(wantedVoice ?? '').trim()
  if (!raw) return ''

  const byId = voices.find((item) => item.id === raw)
  if (byId) return byId.id

  const lower = raw.toLowerCase()
  const byLabel = voices.find((item) => {
    const name = String(item.name ?? '').trim().toLowerCase()
    const label = String(item.label ?? '').trim().toLowerCase()
    return name === lower || label === lower
  })
  if (byLabel) return byLabel.id

  if (isElevenVoiceId(raw)) return raw
  return ''
}

function selectionFallback(storedProvider) {
  if (String(storedProvider ?? '').trim().toLowerCase() === 'elevenlabs' && elevenConfigured()) {
    return { provider: 'elevenlabs', voice: elevenDefaultVoice() }
  }
  return defaultSelection()
}

export function providerVoices(provider) {
  return provider === 'elevenlabs' ? mapCabinetVoices(elevenVoices()) : mapCabinetVoices(SBER_VOICES)
}

export function providerDefaultVoice(provider) {
  return provider === 'elevenlabs' ? elevenDefaultVoice() : sberDefaultVoice()
}

/** Провайдер по умолчанию — Сбер; ElevenLabs остаётся доступным вариантом. */
export function defaultProvider() {
  const wanted = env('TTS_PROVIDER', 'sber').toLowerCase()
  return TTS_PROVIDERS.includes(wanted) ? wanted : 'sber'
}

export function defaultSelection() {
  const provider = defaultProvider()
  return { provider, voice: providerDefaultVoice(provider) }
}

export function normalizeSelection(provider, voice) {
  const wantedProvider = String(provider ?? '').trim().toLowerCase()
  if (!TTS_PROVIDERS.includes(wantedProvider)) {
    return { ok: false, error: 'Неизвестный сервис озвучки' }
  }
  const wantedVoice = String(voice ?? '').trim()
  const voices = providerVoices(wantedProvider)
  if (wantedProvider === 'elevenlabs' && !voices.length) {
    return { ok: false, error: 'Голоса ElevenLabs не настроены в .env' }
  }
  if (!wantedVoice) {
    return { ok: true, provider: wantedProvider, voice: providerDefaultVoice(wantedProvider) }
  }
  if (wantedProvider === 'elevenlabs') {
    const resolved = resolveElevenVoice(wantedVoice, voices)
    if (!resolved) {
      return { ok: false, error: 'Такого голоса нет в каталоге ElevenLabs' }
    }
    const picked = voices.find((item) => item.id === resolved)
    if (picked && picked.available === false) {
      return { ok: false, error: 'Этот голос пока недоступен для предпрослушивания' }
    }
    return { ok: true, provider: wantedProvider, voice: resolved }
  }
  if (wantedProvider === 'sber' && !voices.some((item) => item.id === wantedVoice)) {
    return { ok: false, error: 'Такого голоса нет в каталоге Сбера' }
  }
  return { ok: true, provider: wantedProvider, voice: wantedVoice }
}

/** ElevenLabs доступен: ключ в .env или ручное включение у объекта. */
export function elevenlabsCatalogVisible({ elevenlabsEnabled = false } = {}) {
  return elevenlabsEnabled || elevenConfigured()
}

export function voiceCatalog({ elevenlabsEnabled = false } = {}) {
  const providers = []
  const showEleven = elevenlabsCatalogVisible({ elevenlabsEnabled })

  if (showEleven) {
    providers.push({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      note: 'Eleven v3 · русский и другие языки. Подходит для приветствий и титров.',
      configured: elevenConfigured(),
      defaultVoice: elevenDefaultVoice(),
      voices: providerVoices('elevenlabs'),
    })
  }
  // Сбер не показываем, если ElevenLabs уже настроен — иначе путает в кабинете.
  if (!elevenConfigured()) {
    providers.push({
      id: 'sber',
      name: 'SaluteSpeech (Сбер)',
      note: 'Русские голоса Сбера.',
      configured: sberConfigured(),
      defaultVoice: sberDefaultVoice(),
      voices: providerVoices('sber'),
    })
  }
  return providers
}

export async function projectElevenlabsEnabled(projectId) {
  const { rows } = await query(`SELECT tts_elevenlabs_enabled FROM projects WHERE id = $1`, [
    projectId,
  ])
  return Boolean(rows[0]?.tts_elevenlabs_enabled)
}

async function canUseElevenlabs(projectId) {
  if (await projectElevenlabsEnabled(projectId)) return true
  return elevenConfigured()
}

/** Если ElevenLabs настроен, старый выбор Сбера в БД не тащим в кабинет и генерацию. */
function coerceElevenSelection(selection) {
  if (!elevenConfigured() || selection.provider !== 'sber') return selection
  const resolved = resolveElevenVoice(selection.voice)
  if (resolved) {
    return { provider: 'elevenlabs', voice: resolved }
  }
  return { provider: 'elevenlabs', voice: elevenDefaultVoice() }
}

/** Голос для генерации. */
export async function resolveGenerationVoice(projectId) {
  const { rows } = await query(
    `SELECT tts_provider, tts_voice, tts_elevenlabs_enabled FROM projects WHERE id = $1`,
    [projectId],
  )
  const row = rows[0]
  let provider = row?.tts_provider ?? defaultProvider()
  let voice = row?.tts_voice ?? ''
  if (provider === 'elevenlabs' && !(await canUseElevenlabs(projectId))) {
    provider = sberConfigured() ? 'sber' : defaultProvider()
    voice = ''
  }
  let selection = normalizeSelection(provider, voice)
  selection = selection.ok ? selection : selectionFallback(provider)
  selection = coerceElevenSelection(selection)
  return selection
}

export async function loadProjectVoice(projectId) {
  const { rows } = await query(
    `SELECT tts_provider, tts_voice, tts_elevenlabs_enabled FROM projects WHERE id = $1`,
    [projectId],
  )
  const row = rows[0]
  const elevenlabsAvailable = (await canUseElevenlabs(projectId)) || elevenConfigured()
  const normalized = normalizeSelection(row?.tts_provider, row?.tts_voice)
  let selection = normalized.ok ? normalized : selectionFallback(row?.tts_provider)
  if (selection.provider === 'elevenlabs' && !elevenlabsAvailable) {
    selection = {
      provider: sberConfigured() ? 'sber' : defaultProvider(),
      voice: providerDefaultVoice(sberConfigured() ? 'sber' : defaultProvider()),
    }
  }
  selection = coerceElevenSelection(selection)
  if (
    !normalized.ok &&
    row?.tts_provider &&
    row?.tts_voice &&
    selection.provider &&
    selection.voice &&
    (selection.provider !== row.tts_provider || selection.voice !== row.tts_voice)
  ) {
    await query(
      `UPDATE projects SET tts_provider = $2, tts_voice = $3, updated_at = now() WHERE id = $1`,
      [projectId, selection.provider, selection.voice],
    )
  }
  return { ...selection, elevenlabsEnabled: elevenlabsAvailable }
}

export async function saveProjectVoice(projectId, provider, voice) {
  const normalized = normalizeSelection(provider, voice)
  if (!normalized.ok) return normalized
  if (normalized.provider === 'elevenlabs' && !(await canUseElevenlabs(projectId))) {
    return { ok: false, error: 'ElevenLabs недоступен для этого объекта' }
  }
  await query(
    `UPDATE projects SET tts_provider = $2, tts_voice = $3, updated_at = now() WHERE id = $1`,
    [projectId, normalized.provider, normalized.voice],
  )
  return normalized
}

export function voiceLabel(provider, voice) {
  const found = providerVoices(provider).find((item) => item.id === voice)
  return found?.label ?? voice
}
