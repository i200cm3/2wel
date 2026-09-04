import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { projectForUser } from './cabinet.mjs'
import { publicDir } from './env.mjs'
import { fetchWithTimeout } from './fetchTimeout.mjs'
import { ensureProjectMedia, mapConfigTtsSrcs } from './projectMedia.mjs'
import { consumeRateLimit } from './rateLimit.mjs'
import { synthesizeSber } from './ttsSber.mjs'
import { signTtsToken, verifyTtsToken } from './ttsToken.mjs'
import {
  loadProjectVoice,
  projectElevenlabsEnabled,
  resolveGenerationVoice,
  saveProjectVoice,
  voiceCatalog,
  voiceLabel,
} from './ttsVoices.mjs'
import { recordTtsUsage } from './ttsUsage.mjs'

const TTS_EXTS = new Set(['.wav', '.mp3', '.ogg', '.m4a'])
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}
const PUBLIC_FILE_MODE = 0o644
/** `+` — из старых файлов Джинала вида `2-1+.mp3`. */
const FILE_NAME_RE = /^[a-z0-9_+.-]{1,120}$/i
/** Синтез идёт дольше обычного запроса, но зависать бесконечно всё равно не должен. */
const ELEVENLABS_TIMEOUT_MS = 60_000
/** Озвучка титра, а не аудиокнига: длинный текст режем на входе. */
const MAX_TEXT_CHARS = 1200
/** Защита от использования кабинета как бесплатной студии синтеза. */
const GENERATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 200 }
/** Гостю отдаём с коротким кэшем, кабинету — без записи на диск браузера. */
const GUEST_CACHE_SEC = 3600

function envPick(env, key, fallback = '') {
  return String(env[key] ?? process.env[key] ?? fallback).trim()
}

/** Хеш кэша озвучки: сервис + id голоса (+ настройки ElevenLabs) + текст. */
export function ttsCacheKey(parts) {
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex')
}

/** Части ключа кэша — смена голоса даёт другой hash при том же тексте. */
export function ttsCacheKeyParts(text, selection, eleven = null) {
  const textValue = String(text ?? '')
  if (selection.provider === 'elevenlabs' && eleven) {
    return [
      'elevenlabs',
      selection.voice,
      eleven.modelId,
      eleven.stability.toFixed(3),
      eleven.similarityBoost.toFixed(3),
      eleven.style.toFixed(3),
      eleven.useSpeakerBoost ? '1' : '0',
      textValue,
    ]
  }
  return [selection.provider || 'sber', selection.voice, textValue]
}

export function ttsSrcPrefix(code) {
  return `/media/projects/${code}/tts/`
}

export function ttsDir(code) {
  return path.resolve(publicDir(), 'media/projects', code, 'tts')
}

/** Путь к файлу озвучки внутри папки проекта — без выхода наружу по `..`. */
function ttsFilePath(code, fileName) {
  if (!code || /[^a-z0-9-]/.test(code)) return ''
  if (!FILE_NAME_RE.test(fileName) || !TTS_EXTS.has(path.extname(fileName).toLowerCase())) return ''
  const dir = ttsDir(code)
  const full = path.resolve(dir, fileName)
  if (path.dirname(full) !== dir) return ''
  return full
}

async function writePublicFile(filePath, buf) {
  await fs.promises.writeFile(filePath, buf, { mode: PUBLIC_FILE_MODE })
  await fs.promises.chmod(filePath, PUBLIC_FILE_MODE)
}

function estimateDuration(byteLength) {
  if (byteLength > 0) {
    const sec = (byteLength * 8) / 128_000
    if (Number.isFinite(sec) && sec > 0) return Number(sec.toFixed(3))
  }
  return null
}

function probeDurationSec(filePath, byteLength) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 5000 },
    )
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.on('error', () => resolve(estimateDuration(byteLength)))
    child.on('close', () => {
      const sec = Number.parseFloat(stdout.trim())
      if (Number.isFinite(sec) && sec > 0) {
        resolve(Number(sec.toFixed(3)))
        return
      }
      resolve(estimateDuration(byteLength))
    })
  })
}

/** Сбер отдаёт wav: для гостевых страниц он слишком тяжёлый. */
function transcodeToMp3(from, to) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', from, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', to],
      { timeout: 30_000 },
    )
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0 && fs.existsSync(to)))
  })
}

const DURATIONS_CACHE = '.durations.json'

async function readDurationsCache(dir) {
  try {
    const raw = await fs.promises.readFile(path.join(dir, DURATIONS_CACHE), 'utf8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

async function writeDurationsCache(dir, cache) {
  try {
    await fs.promises.writeFile(
      path.join(dir, DURATIONS_CACHE),
      `${JSON.stringify(cache, null, 2)}\n`,
      { mode: PUBLIC_FILE_MODE },
    )
  } catch {
    /* ignore cache write errors */
  }
}

/** Запомнить длительность после генерации — чтобы list не гонял ffprobe снова. */
export async function rememberTtsDuration(code, fileName, durationSec, st) {
  if (!fileName || !(durationSec > 0) || !st) return
  const dir = ttsDir(code)
  const cache = await readDurationsCache(dir)
  cache[fileName] = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    durationSec: Number(durationSec),
  }
  await writeDurationsCache(dir, cache)
}

/**
 * Список TTS + durationSec (из кэша по mtime/size, иначе ffprobe).
 * Клиент не должен скачивать аудио только ради длительности.
 */
export async function listProjectTts(code) {
  const dir = ttsDir(code)
  if (!fs.existsSync(dir)) return { files: [], items: [] }
  const prefix = ttsSrcPrefix(code)
  const names = fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith('.') && TTS_EXTS.has(path.extname(name).toLowerCase()))
    .sort()

  const cache = await readDurationsCache(dir)
  let dirty = false
  const items = []

  for (const name of names) {
    const full = path.join(dir, name)
    let st
    try {
      st = await fs.promises.stat(full)
    } catch {
      continue
    }
    const src = `${prefix}${name}`
    const hit = cache[name]
    let durationSec =
      hit &&
      hit.mtimeMs === st.mtimeMs &&
      hit.size === st.size &&
      typeof hit.durationSec === 'number' &&
      Number.isFinite(hit.durationSec) &&
      hit.durationSec > 0
        ? hit.durationSec
        : null
    if (durationSec == null) {
      durationSec = await probeDurationSec(full, st.size)
      if (durationSec != null) {
        cache[name] = { mtimeMs: st.mtimeMs, size: st.size, durationSec }
        dirty = true
      }
    }
    items.push({
      src,
      name,
      durationSec,
      bytes: st.size,
      mtime: Math.floor(st.mtimeMs / 1000),
    })
  }

  // Убрать из кэша удалённые файлы
  for (const key of Object.keys(cache)) {
    if (!names.includes(key)) {
      delete cache[key]
      dirty = true
    }
  }
  if (dirty) await writeDurationsCache(dir, cache)

  return { files: items.map((it) => it.src), items }
}

function cachedFileName(dir, base) {
  for (const ext of ['.mp3', '.wav']) {
    if (fs.existsSync(path.join(dir, `${base}${ext}`))) return `${base}${ext}`
  }
  return ''
}

export function elevenSettings() {
  const stability = Number(envPick(process.env, 'ELEVENLABS_STABILITY', '0.75'))
  const similarityBoost = Number(envPick(process.env, 'ELEVENLABS_SIMILARITY_BOOST', '0.7'))
  const style = Number(envPick(process.env, 'ELEVENLABS_STYLE', '1'))
  return {
    modelId: envPick(process.env, 'ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
    stability: Number.isFinite(stability) ? stability : 0.75,
    similarityBoost: Number.isFinite(similarityBoost) ? similarityBoost : 0.7,
    style: Number.isFinite(style) ? style : 1,
    useSpeakerBoost:
      envPick(process.env, 'ELEVENLABS_SPEAKER_BOOST', 'true').toLowerCase() !== 'false',
  }
}

async function synthesizeElevenViaProxy(proxyBase, text, voice, settings) {
  const secret = envPick(process.env, 'ELEVENLABS_PROXY_SECRET')
  if (!secret) {
    return { ok: false, status: 500, error: 'Не задан ELEVENLABS_PROXY_SECRET' }
  }

  const voiceSettings = {
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,
    style: settings.style,
    use_speaker_boost: settings.useSpeakerBoost,
  }

  let res
  try {
    res = await fetchWithTimeout(
      `${proxyBase.replace(/\/$/, '')}/v1/synthesize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice,
          modelId: settings.modelId,
          voiceSettings,
        }),
      },
      ELEVENLABS_TIMEOUT_MS,
    )
  } catch (err) {
    return {
      ok: false,
      status: 504,
      error: 'Прокси ElevenLabs не ответил',
      detail: err instanceof Error ? err.message : '',
    }
  }

  if (!res.ok) {
    let detail = ''
    try {
      const payload = await res.json()
      detail = String(payload?.detail ?? payload?.error ?? '')
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 800)
    }
    return {
      ok: false,
      status: 502,
      error: `Прокси ElevenLabs HTTP ${res.status}`,
      detail,
    }
  }

  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()), ext: 'mp3' }
}

async function synthesizeElevenDirect(text, voice, settings) {
  const apiKey = envPick(process.env, 'ELEVENLABS_API_KEY')
  if (!apiKey) return { ok: false, status: 500, error: 'Не задан ELEVENLABS_API_KEY' }
  if (!voice) return { ok: false, status: 500, error: 'Не задан голос ElevenLabs' }

  const voiceSettings = {
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,
    style: settings.style,
    use_speaker_boost: settings.useSpeakerBoost,
  }

  let res
  try {
    res = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: settings.modelId,
          voice_settings: voiceSettings,
        }),
      },
      ELEVENLABS_TIMEOUT_MS,
    )
  } catch (err) {
    return {
      ok: false,
      status: 504,
      error: 'ElevenLabs не ответил',
      detail: err instanceof Error ? err.message : '',
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: `ElevenLabs HTTP ${res.status}`,
      detail: (await res.text().catch(() => '')).slice(0, 800),
    }
  }
  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()), ext: 'mp3' }
}

export async function synthesizeEleven(text, voice, settings) {
  if (!voice) return { ok: false, status: 500, error: 'Не задан голос ElevenLabs' }
  const proxyUrl = envPick(process.env, 'ELEVENLABS_PROXY_URL')
  if (proxyUrl) return synthesizeElevenViaProxy(proxyUrl, text, voice, settings)
  return synthesizeElevenDirect(text, voice, settings)
}

async function storeAudio(dir, base, result) {
  if (result.ext === 'mp3') {
    const fileName = `${base}.mp3`
    await writePublicFile(path.join(dir, fileName), result.buffer)
    return fileName
  }

  const tmp = path.join(dir, `.${base}.${result.ext}`)
  await writePublicFile(tmp, result.buffer)
  const mp3 = path.join(dir, `${base}.mp3`)
  const converted = await transcodeToMp3(tmp, mp3)
  if (converted) {
    await fs.promises.rm(tmp, { force: true })
    await fs.promises.chmod(mp3, PUBLIC_FILE_MODE).catch(() => undefined)
    return `${base}.mp3`
  }
  const fallback = `${base}.${result.ext}`
  await fs.promises.rename(tmp, path.join(dir, fallback))
  return fallback
}

async function generateInProject(project, textValue, force) {
  const code = project.code
  const selection = await resolveGenerationVoice(project.id)
  const eleven = selection.provider === 'elevenlabs' ? elevenSettings() : null
  const hash = ttsCacheKey(ttsCacheKeyParts(textValue, selection, eleven))
  const prefix = selection.provider === 'elevenlabs' ? 'el_' : 'sb_'
  const base = `${prefix}${hash.slice(0, 12)}`
  const dir = ttsDir(code)
  await fs.promises.mkdir(dir, { recursive: true })

  const meta = { provider: selection.provider, voice: selection.voice, voiceId: selection.voice }
  if (eleven) meta.modelId = eleven.modelId

  if (!force) {
    const cached = cachedFileName(dir, base)
    if (cached) {
      const full = path.join(dir, cached)
      const st = await fs.promises.stat(full)
      const durationSec = await probeDurationSec(full, st.size)
      await rememberTtsDuration(code, cached, durationSec, st)
      const listed = await listProjectTts(code)
      return {
        status: 200,
        body: {
          ok: true,
          src: `${ttsSrcPrefix(code)}${cached}`,
          hash,
          cached: true,
          fileName: cached,
          files: listed.files,
          durationSec,
          version: st.mtimeMs,
          ...meta,
        },
      }
    }
  }

  const limited = consumeRateLimit(`tts:${code}`, GENERATE_LIMIT)
  if (!limited.ok) {
    return {
      status: 429,
      body: {
        error: 'Слишком много генераций озвучки за час. Подождите или напишите в поддержку.',
        retryAfterSec: limited.retryAfterSec,
        ...meta,
      },
    }
  }

  const result =
    selection.provider === 'elevenlabs'
      ? await synthesizeEleven(textValue, selection.voice, eleven)
      : await synthesizeSber(textValue, selection.voice)
  if (!result.ok) {
    return {
      status: result.status,
      body: { error: result.error, detail: result.detail ?? '', ...meta },
    }
  }

  const fileName = await storeAudio(dir, base, result)
  const full = path.join(dir, fileName)
  const st = await fs.promises.stat(full)
  const durationSec = await probeDurationSec(full, st.size)
  await rememberTtsDuration(code, fileName, durationSec, st)
  await recordTtsUsage({
    projectId: project.id,
    provider: selection.provider,
    characters: textValue.length,
    voice: selection.voice,
  })
  const listed = await listProjectTts(code)
  return {
    status: 200,
    body: {
      ok: true,
      src: `${ttsSrcPrefix(code)}${fileName}`,
      hash,
      cached: false,
      fileName,
      files: listed.files,
      durationSec,
      forced: force,
      version: Date.now(),
      ...meta,
    },
  }
}

/**
 * Синтез или кэш-хит в папке проекта.
 * Hash = sha256(provider + voiceId + … + text) — один текст с разными голосами не шарит файл.
 */
export async function ensureProjectTts(project, text, { force = false } = {}) {
  const textValue = typeof text === 'string' ? text.trim() : ''
  if (!textValue) {
    return { status: 400, body: { error: 'empty text' } }
  }
  if (textValue.length > MAX_TEXT_CHARS) {
    return {
      status: 400,
      body: { error: `Текст длиннее ${MAX_TEXT_CHARS} символов — разбейте на титры` },
    }
  }
  await ensureProjectMedia(project.code)
  return generateInProject(project, textValue, Boolean(force))
}

function parseRange(header, size) {
  const raw = Array.isArray(header) ? header[0] : header
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(raw ?? '').trim())
  if (!match) return null
  const [, fromRaw, toRaw] = match
  if (!fromRaw && !toRaw) return null
  let start = fromRaw ? Number(fromRaw) : size - Number(toRaw)
  let end = fromRaw ? (toRaw ? Number(toRaw) : size - 1) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, start)
  end = Math.min(size - 1, end)
  if (start > end) return null
  return { start, end }
}

/**
 * Файлы озвучки не отдаются как загрузка: только inline-поток, без имени файла
 * и без прямого пути в статике.
 */
function streamAudio(req, res, filePath, { maxAgeSec }) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const range = parseRange(req.headers.range, stat.size)
  res.setHeader('Content-Type', AUDIO_MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader(
    'Cache-Control',
    maxAgeSec > 0 ? `private, max-age=${maxAgeSec}` : 'private, no-store',
  )

  if (range) {
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
    res.setHeader('Content-Length', String(range.end - range.start + 1))
  } else {
    res.statusCode = 200
    res.setHeader('Content-Length', String(stat.size))
  }

  if ((req.method ?? 'GET') === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : {})
    .on('error', () => res.destroy())
    .pipe(res)
}

/** Ссылка для гостя: подписанный токен вместо пути к файлу. */
export function signTtsSrc(src, code) {
  if (typeof src !== 'string') return src
  const prefix = ttsSrcPrefix(code)
  if (!src.startsWith(prefix)) return src
  const token = signTtsToken(code, src.slice(prefix.length).split('?')[0])
  return token ? `/api/public/tts/${token}` : src
}

/** Конфиг гостя уходит с подписанными ссылками, а не с путями в /media. */
export function signConfigTts(config, code) {
  return mapConfigTtsSrcs(config, (src) => signTtsSrc(src, code))
}

export function handlePublicTts(req, res, token, json) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    json(res, 405, { error: 'method not allowed' })
    return
  }
  const parsed = verifyTtsToken(token)
  if (!parsed) {
    json(res, 404, { error: 'not found' })
    return
  }
  const filePath = ttsFilePath(parsed.code, parsed.fileName)
  if (!filePath) {
    json(res, 404, { error: 'not found' })
    return
  }
  streamAudio(req, res, filePath, { maxAgeSec: GUEST_CACHE_SEC })
}

export async function handleProjectTts(req, res, extras) {
  const { userId, projectCode, action, param, json, readBuffer, maxBytes } = extras
  const project = await projectForUser(userId, projectCode)
  if (!project) {
    json(res, 404, { error: 'project not found' })
    return
  }
  const code = project.code
  await ensureProjectMedia(code)
  const method = req.method ?? 'GET'

  if (!action) {
    if (method === 'GET' || method === 'HEAD') {
      json(res, 200, { ok: true, ...(await listProjectTts(code)) })
      return
    }
    json(res, 405, { error: 'method not allowed' })
    return
  }

  if (action === 'voices') {
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const selection = await loadProjectVoice(project.id)
    json(res, 200, {
      ok: true,
      ...selection,
      label: voiceLabel(selection.provider, selection.voice),
      providers: voiceCatalog({ elevenlabsEnabled: selection.elevenlabsEnabled }),
    })
    return
  }

  if (action === 'voice') {
    if (method !== 'POST' && method !== 'PUT') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const raw = await readBuffer(req, maxBytes)
    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      json(res, 400, { error: 'invalid json' })
      return
    }
    const saved = await saveProjectVoice(project.id, payload?.provider, payload?.voice)
    if (!saved.ok) {
      json(res, 400, { error: saved.error })
      return
    }
    const elevenlabsEnabled = await projectElevenlabsEnabled(project.id)
    json(res, 200, {
      ok: true,
      provider: saved.provider,
      voice: saved.voice,
      label: voiceLabel(saved.provider, saved.voice),
      elevenlabsEnabled,
      providers: voiceCatalog({ elevenlabsEnabled }),
    })
    return
  }

  if (action === 'file') {
    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const filePath = ttsFilePath(code, String(param ?? ''))
    if (!filePath) {
      json(res, 404, { error: 'not found' })
      return
    }
    streamAudio(req, res, filePath, { maxAgeSec: 0 })
    return
  }

  if (action === 'generate') {
    if (method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const raw = await readBuffer(req, maxBytes)
    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      json(res, 400, { error: 'invalid json' })
      return
    }
    const textValue = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!textValue) {
      json(res, 400, { error: 'empty text' })
      return
    }
    if (textValue.length > MAX_TEXT_CHARS) {
      json(res, 400, { error: `Текст длиннее ${MAX_TEXT_CHARS} символов — разбейте на титры` })
      return
    }
    const result = await ensureProjectTts(project, textValue, { force: Boolean(payload.force) })
    json(res, result.status, result.body)
    return
  }

  json(res, 404, { error: 'not found' })
}
