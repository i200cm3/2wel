import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadEnv } from './env.js'
import { fetchWithTimeout } from './fetchTimeout.mjs'
import { resolveYandexApiKey } from './platformIntegrations.mjs'

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
  aac: 'audio/aac',
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const DEFAULT_GIGAAM_TIMEOUT_MS = 180_000
const DEFAULT_YANDEX_TIMEOUT_MS = 180_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
/** Sync STT v1: ≤30 с и ~1 МБ. Режем с запасом. */
const YANDEX_SYNC_MAX_SEC = 28
const YANDEX_SYNC_MAX_BYTES = 900 * 1024
const YANDEX_CHUNK_SEC = 25
/** Для стерео без VAD — мелкие окна хуже, чем речь по silencedetect. */
const YANDEX_STEREO_FALLBACK_CHUNK_SEC = 8
const YANDEX_MAX_STEREO_TURNS = 200
const YANDEX_MIN_SPEECH_SEC = 0.5
/** Короткие клипы сильно портят качество sync STT — склеиваем паузы. */
const YANDEX_MERGE_GAP_SEC = 1.25
const YANDEX_SLICE_PAD_SEC = 0.3
const YANDEX_OPUS_BITRATE = '64k'
/** Телефонный диапазон + выравнивание громкости перед STT. */
const YANDEX_AUDIO_AF = 'highpass=f=80,lowpass=f=3800,dynaudnorm=f=150:g=15'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function env(key, fallback = '') {
  loadEnv()
  return String(process.env[key] ?? fallback).trim()
}

function proxyErrorMessage(payload, status) {
  const detail = String(payload?.detail ?? '').trim()
  const error = String(payload?.error ?? '').trim()
  if (detail && error && !detail.includes(error)) return `${error}: ${detail}`
  return detail || error || `Прокси транскрибации HTTP ${status}`
}

async function transcribeViaGigaam(audioUrl, options = {}) {
  const proxyBase = env('GIGAAM_TRANSCRIBE_URL')
  if (!proxyBase) {
    return { ok: false, status: 503, error: 'Не задан GIGAAM_TRANSCRIBE_URL' }
  }

  const downloadTimeoutMs =
    options.downloadTimeoutMs ??
    Number(env('DOWNLOAD_TIMEOUT_MS', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)))
  const gigaamTimeoutMs =
    options.gigaamTimeoutMs ?? Number(env('GIGAAM_TIMEOUT_MS', String(DEFAULT_GIGAAM_TIMEOUT_MS)))
  const timeoutMs = downloadTimeoutMs + gigaamTimeoutMs
  const secret = env('GIGAAM_TRANSCRIBE_SECRET')
  const headers = { 'Content-Type': 'application/json' }
  if (secret) headers.Authorization = `Bearer ${secret}`

  const started = Date.now()
  try {
    const res = await fetchWithTimeout(
      `${proxyBase.replace(/\/$/, '')}/v1/transcribe`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: audioUrl }),
      },
      timeoutMs,
    )

    const raw = await res.text()
    let payload = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = { detail: raw.slice(0, 800) }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status >= 500 ? 502 : res.status,
        error: proxyErrorMessage(payload, res.status),
        detail: String(payload?.detail ?? '').trim() || undefined,
      }
    }

    const text = String(payload?.text ?? '').trim()
    if (!text) {
      return {
        ok: false,
        status: 502,
        error: 'GigaAM не вернул текст транскрибации',
        detail: raw.slice(0, 800),
      }
    }

    console.info(
      'transcribe gigaam',
      JSON.stringify({
        ms: Date.now() - started,
        model: String(payload?.model ?? '').trim() || null,
        bytes: Number(payload?.bytes) || null,
        stereo: payload?.stereo ?? null,
        textLen: text.length,
      }),
    )

    return {
      ok: true,
      text,
      model: String(payload?.model ?? '').trim() || 'v3_e2e_rnnt',
      mimeType: String(payload?.mimeType ?? '').trim() || undefined,
      bytes: Number(payload?.bytes) || undefined,
      provider: 'gigaam',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'GigaAM не ответил' : 'GigaAM недоступен',
      detail: message,
    }
  }
}

function mimeFromUrl(url) {
  const path = String(url).split('?')[0].split('#')[0]
  const ext = path.includes('.') ? path.split('.').pop()?.toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? null
}

function normalizeMimeType(value, url = '') {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return mimeFromUrl(url) ?? 'audio/mpeg'
  if (raw.startsWith('audio/')) return raw
  if (raw === 'application/octet-stream') return mimeFromUrl(url) ?? 'audio/mpeg'
  return MIME_BY_EXT[raw.replace(/^\./, '')] ?? mimeFromUrl(url) ?? 'audio/mpeg'
}

function yandexFormatFromMime(mimeType) {
  const raw = String(mimeType ?? '').trim().toLowerCase()
  if (raw === 'audio/ogg' || raw === 'audio/opus' || raw.includes('ogg')) return 'oggopus'
  // Sync API v1 не принимает mp3/wav/flac — конвертируем в oggopus.
  return null
}

function runFfmpeg(args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { timeout: timeoutMs })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => resolve({ ok: false, error: err.message || 'ffmpeg failed', stderr }))
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, stderr })
      else resolve({ ok: false, error: stderr.trim().slice(0, 400) || `ffmpeg exit ${code}`, stderr })
    })
  })
}

/** Речь = промежутки между silence_start/silence_end из ffmpeg silencedetect. */
export function speechRegionsFromSilenceLog(stderr, durationSec, { minSpeechSec = YANDEX_MIN_SPEECH_SEC } = {}) {
  const starts = []
  const ends = []
  for (const line of String(stderr ?? '').split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (s) starts.push(Number(s[1]))
    const e = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (e) ends.push(Number(e[1]))
  }
  const events = [
    ...starts.map((t) => ({ t, kind: 's' })),
    ...ends.map((t) => ({ t, kind: 'e' })),
  ].sort((a, b) => a.t - b.t || (a.kind === 'e' ? -1 : 1))

  const silenceRanges = []
  let open = null
  for (const ev of events) {
    if (ev.kind === 's' && open == null) open = ev.t
    else if (ev.kind === 'e' && open != null) {
      silenceRanges.push([open, ev.t])
      open = null
    }
  }

  const dur = Number(durationSec)
  const total = Number.isFinite(dur) && dur > 0 ? dur : silenceRanges.at(-1)?.[1] || 0
  const speech = []
  let pos = 0
  for (const [s, e] of silenceRanges) {
    if (s > pos + minSpeechSec) speech.push({ start: pos, end: s })
    pos = Math.max(pos, e)
  }
  if (total > pos + minSpeechSec) speech.push({ start: pos, end: total })
  return speech
}

function splitLongSpeechRegion(region, maxSec = YANDEX_SYNC_MAX_SEC) {
  const out = []
  let t = region.start
  while (t < region.end - 0.15) {
    const end = Math.min(region.end, t + maxSec)
    out.push({ start: t, end })
    t = end
  }
  return out.length ? out : [region]
}

function mergeCloseSameChannel(regions, maxGapSec = YANDEX_MERGE_GAP_SEC) {
  const sorted = regions
    .slice()
    .sort((a, b) => a.channel.localeCompare(b.channel) || a.start - b.start)
  const out = []
  for (const r of sorted) {
    const prev = out[out.length - 1]
    if (prev && prev.channel === r.channel && r.start - prev.end <= maxGapSec) {
      prev.end = Math.max(prev.end, r.end)
    } else {
      out.push({ channel: r.channel, start: r.start, end: r.end })
    }
  }
  return out.sort((a, b) => a.start - b.start || a.channel.localeCompare(b.channel))
}

function coalesceSpeechRegions(regions, maxTurns) {
  const list = regions.slice().sort((a, b) => a.start - b.start || a.channel.localeCompare(b.channel))
  if (list.length <= maxTurns) return list
  // Склеиваем соседние куски одного канала, пока не уложимся в лимит.
  while (list.length > maxTurns) {
    let best = -1
    let bestGap = Infinity
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].channel !== list[i + 1].channel) continue
      const gap = list[i + 1].start - list[i].end
      if (gap < bestGap) {
        bestGap = gap
        best = i
      }
    }
    if (best < 0) break
    list[best] = {
      channel: list[best].channel,
      start: list[best].start,
      end: list[best + 1].end,
    }
    list.splice(best + 1, 1)
  }
  return list
}

async function detectSpeechRegions(oggPath, durationSec) {
  const probed = await runFfmpeg([
    '-hide_banner',
    '-nostats',
    '-i',
    oggPath,
    '-af',
    'silencedetect=noise=-32dB:d=0.45',
    '-f',
    'null',
    '-',
  ])
  return speechRegionsFromSilenceLog(probed.stderr, durationSec)
}

async function extractOggSlice(inputPath, start, end, outputPath, durationSec = null) {
  const pad = YANDEX_SLICE_PAD_SEC
  const slicedStart = Math.max(0, start - pad)
  const slicedEnd = durationSec != null ? Math.min(durationSec, end + pad) : end + pad
  const dur = Math.max(0.35, slicedEnd - slicedStart)
  return runFfmpeg([
    '-v',
    'error',
    '-y',
    '-ss',
    String(slicedStart),
    '-t',
    String(dur),
    '-i',
    inputPath,
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-b:a',
    YANDEX_OPUS_BITRATE,
    outputPath,
  ])
}

function probeDurationSec(filePath) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 15_000 },
    )
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const sec = Number.parseFloat(stdout.trim())
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null)
    })
  })
}

function probeChannelCount(filePath) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=channels',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { timeout: 15_000 },
    )
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.on('error', () => resolve(1))
    child.on('close', () => {
      const n = Number.parseInt(String(stdout).trim().split('\n')[0] || '', 10)
      resolve(Number.isFinite(n) && n > 0 ? n : 1)
    })
  })
}

async function withTempDir(prefix, fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function readOggChunks(dir, prefix) {
  const re = new RegExp(`^${prefix}-\\d+\\.ogg$`)
  const names = (await fs.promises.readdir(dir)).filter((name) => re.test(name)).sort()
  const chunks = []
  for (const name of names) {
    const part = await fs.promises.readFile(path.join(dir, name))
    if (part.length) chunks.push({ buffer: part, bytes: part.length })
  }
  return chunks
}

async function segmentOggToChunks(oggPath, dir, prefix, chunkSec = YANDEX_CHUNK_SEC) {
  const pattern = path.join(dir, `${prefix}-%03d.ogg`)
  const split = await runFfmpeg([
    '-v',
    'error',
    '-y',
    '-i',
    oggPath,
    '-f',
    'segment',
    '-segment_time',
    String(chunkSec),
    '-reset_timestamps',
    '1',
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-b:a',
    YANDEX_OPUS_BITRATE,
    pattern,
  ])
  if (!split.ok) {
    return { ok: false, error: split.error }
  }
  const chunks = await readOggChunks(dir, prefix)
  if (!chunks.length) return { ok: false, error: 'ffmpeg не создал сегменты аудио' }
  return { ok: true, chunks }
}

async function oggChunksFromFile(oggPath, dir, prefix, durationSec, options = {}) {
  const chunkSec = Number(options.chunkSec) > 0 ? Number(options.chunkSec) : YANDEX_CHUNK_SEC
  const forceSplit = options.forceSplit === true
  const oggStat = await fs.promises.stat(oggPath)
  const needsSplit =
    forceSplit ||
    (durationSec != null && durationSec > YANDEX_SYNC_MAX_SEC) ||
    oggStat.size > YANDEX_SYNC_MAX_BYTES
  if (!needsSplit) {
    const out = await fs.promises.readFile(oggPath)
    return { ok: true, chunks: [{ buffer: out, bytes: out.length }] }
  }
  if (!forceSplit && durationSec != null && durationSec <= chunkSec && oggStat.size <= YANDEX_SYNC_MAX_BYTES) {
    const out = await fs.promises.readFile(oggPath)
    return { ok: true, chunks: [{ buffer: out, bytes: out.length }] }
  }
  return segmentOggToChunks(oggPath, dir, prefix, chunkSec)
}

/**
 * Подписи стереоканалов: left,right.
 * По умолчанию L=Клиент, R=Оператор (типичная раскладка Sipuni/АТС).
 */
function yandexSpeakerLabels() {
  const raw = env('YANDEX_SPEECHKIT_SPEAKER_LABELS', 'Клиент,Оператор')
  const parts = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (parts.length >= 2) return [parts[0], parts[1]]
  return ['Клиент', 'Оператор']
}

/** Fallback: склейка по фиксированным окнам (L затем R внутри окна). */
export function mergeYandexStereoTranscript(segmentPairs, labels = yandexSpeakerLabels()) {
  const [labelA, labelB] = labels
  const lines = []
  for (const pair of segmentPairs) {
    const a = String(pair?.a ?? '').trim()
    const b = String(pair?.b ?? '').trim()
    if (a) lines.push(`${labelA}: ${a}`)
    if (b) lines.push(`${labelB}: ${b}`)
  }
  return lines.join('\n').trim()
}

/** Хронологические реплики; соседние одной роли склеиваются. */
export function mergeYandexStereoTurns(turns, labels = yandexSpeakerLabels()) {
  const [labelLeft, labelRight] = labels
  const labelFor = (channel) => (channel === 'right' ? labelRight : labelLeft)
  const lines = []
  for (const turn of turns || []) {
    const text = String(turn?.text ?? '').trim()
    if (!text) continue
    const speaker = labelFor(turn.channel)
    const prev = lines[lines.length - 1]
    if (prev && prev.startsWith(`${speaker}:`)) {
      lines[lines.length - 1] = `${prev} ${text}`
    } else {
      lines.push(`${speaker}: ${text}`)
    }
  }
  return lines.join('\n').trim()
}

/** Sync SpeechKit v1: mp3→oggopus; стерео → два канала с подписями говорящих. */
export async function prepareYandexSyncAudio(buffer, mimeType) {
  const alreadyOgg = yandexFormatFromMime(mimeType) === 'oggopus'
  return withTempDir('yandex-stt-', async (dir) => {
    const inputPath = path.join(dir, alreadyOgg ? 'input.ogg' : 'input.bin')
    await fs.promises.writeFile(inputPath, buffer)

    const channels = await probeChannelCount(inputPath)
    const stereo = channels >= 2
    const durationSec = await probeDurationSec(inputPath)

    if (!stereo) {
      const oggPath = path.join(dir, 'mono.ogg')
      const converted = await runFfmpeg([
        '-v',
        'error',
        '-y',
        '-i',
        inputPath,
        '-ac',
        '1',
        '-c:a',
        'libopus',
        '-b:a',
        YANDEX_OPUS_BITRATE,
        '-af',
        YANDEX_AUDIO_AF,
        oggPath,
      ])
      if (!converted.ok) {
        return {
          ok: false,
          status: 500,
          error: 'Не удалось конвертировать аудио в OggOpus для Яндекса',
          detail: converted.error,
        }
      }
      const chunked = await oggChunksFromFile(oggPath, dir, 'mono', durationSec)
      if (!chunked.ok) {
        return { ok: false, status: 500, error: 'Не удалось нарезать аудио для Яндекса', detail: chunked.error }
      }
      return {
        ok: true,
        stereo: false,
        chunks: chunked.chunks,
        format: 'oggopus',
        mimeType: 'audio/ogg',
        durationSec,
        channels: 1,
      }
    }

    const leftPath = path.join(dir, 'left.ogg')
    const rightPath = path.join(dir, 'right.ogg')
    const splitChannels = await runFfmpeg([
      '-v',
      'error',
      '-y',
      '-i',
      inputPath,
      '-filter_complex',
      `channelsplit=channel_layout=stereo[L][R];[L]${YANDEX_AUDIO_AF}[Lout];[R]${YANDEX_AUDIO_AF}[Rout]`,
      '-map',
      '[Lout]',
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      YANDEX_OPUS_BITRATE,
      leftPath,
      '-map',
      '[Rout]',
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      YANDEX_OPUS_BITRATE,
      rightPath,
    ])
    if (!splitChannels.ok) {
      return {
        ok: false,
        status: 500,
        error: 'Не удалось разделить стереоканалы для Яндекса',
        detail: splitChannels.error,
      }
    }

    const labels = yandexSpeakerLabels()
    const leftSpeech = await detectSpeechRegions(leftPath, durationSec)
    const rightSpeech = await detectSpeechRegions(rightPath, durationSec)
    let regions = [
      ...leftSpeech.flatMap((r) => splitLongSpeechRegion(r).map((x) => ({ ...x, channel: 'left' }))),
      ...rightSpeech.flatMap((r) => splitLongSpeechRegion(r).map((x) => ({ ...x, channel: 'right' }))),
    ]
    regions = mergeCloseSameChannel(regions, YANDEX_MERGE_GAP_SEC)
    regions = coalesceSpeechRegions(regions, YANDEX_MAX_STEREO_TURNS)
    regions = regions.flatMap((r) =>
      splitLongSpeechRegion(r).map((x) => ({ ...x, channel: r.channel })),
    )

    // Если VAD почти ничего не нашёл или слишком много реплик — fallback на мелкие окна.
    if (regions.length < 2 || regions.length > YANDEX_MAX_STEREO_TURNS) {
      const leftChunks = await oggChunksFromFile(leftPath, dir, 'left', durationSec, {
        chunkSec: YANDEX_STEREO_FALLBACK_CHUNK_SEC,
        forceSplit: true,
      })
      const rightChunks = await oggChunksFromFile(rightPath, dir, 'right', durationSec, {
        chunkSec: YANDEX_STEREO_FALLBACK_CHUNK_SEC,
        forceSplit: true,
      })
      if (!leftChunks.ok || !rightChunks.ok) {
        return {
          ok: false,
          status: 500,
          error: 'Не удалось нарезать стереоканалы для Яндекса',
          detail: leftChunks.error || rightChunks.error,
        }
      }
      return {
        ok: true,
        stereo: true,
        mode: 'chunks',
        leftChunks: leftChunks.chunks,
        rightChunks: rightChunks.chunks,
        format: 'oggopus',
        mimeType: 'audio/ogg',
        durationSec,
        channels,
        labels,
      }
    }

    const turns = []
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i]
      const src = region.channel === 'right' ? rightPath : leftPath
      const slicePath = path.join(dir, `turn-${String(i).padStart(3, '0')}-${region.channel}.ogg`)
      const sliced = await extractOggSlice(src, region.start, region.end, slicePath, durationSec)
      if (!sliced.ok) {
        return {
          ok: false,
          status: 500,
          error: 'Не удалось вырезать реплику для Яндекса',
          detail: sliced.error,
        }
      }
      const buf = await fs.promises.readFile(slicePath)
      turns.push({
        channel: region.channel,
        start: region.start,
        end: region.end,
        buffer: buf,
        bytes: buf.length,
      })
    }
    turns.sort((a, b) => a.start - b.start || (a.channel === 'left' ? -1 : 1))

    return {
      ok: true,
      stereo: true,
      mode: 'turns',
      turns,
      format: 'oggopus',
      mimeType: 'audio/ogg',
      durationSec,
      channels,
      labels,
    }
  })
}

async function readStreamWithLimit(body, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > maxBytes) {
      return { ok: false, error: `Файл слишком большой (лимит ${maxBytes} байт)` }
    }
    chunks.push(chunk)
  }
  return { ok: true, buffer: Buffer.concat(chunks), bytes: size }
}

export async function downloadAudio(url, options = {}) {
  const maxBytes = options.maxBytes ?? Number(env('MAX_AUDIO_BYTES', String(DEFAULT_MAX_BYTES)))
  const timeoutMs = options.timeoutMs ?? Number(env('DOWNLOAD_TIMEOUT_MS', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)))

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'audio/*,*/*' },
      },
      timeoutMs,
    )
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400)
      return {
        ok: false,
        status: 400,
        error: `Не удалось загрузить аудио: HTTP ${res.status}`,
        detail,
      }
    }
    if (!res.body) {
      return { ok: false, status: 400, error: 'Пустой ответ при загрузке аудио' }
    }
    const read = await readStreamWithLimit(res.body, maxBytes)
    if (!read.ok) {
      return { ok: false, status: 400, error: read.error }
    }
    const mimeType = normalizeMimeType(res.headers.get('content-type'), url)
    return { ok: true, buffer: read.buffer, mimeType, bytes: read.bytes }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 400,
      error: timeout ? 'Таймаут загрузки аудио' : 'Ошибка загрузки аудио',
      detail: message,
    }
  }
}


async function recognizeYandexChunk({ apiKey, buffer, lang, topic, profanityFilter, timeoutMs }) {
  const qs = new URLSearchParams()
  qs.set('lang', lang)
  qs.set('topic', topic)
  qs.set('profanityFilter', profanityFilter ? 'true' : 'false')
  qs.set('format', 'oggopus')

  let res
  try {
    res = await fetchWithTimeout(
      `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${qs.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'audio/ogg',
        },
        body: buffer,
      },
      timeoutMs,
    )
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: timeout ? 504 : 502,
      error: timeout ? 'Yandex SpeechKit не ответил вовремя' : 'Yandex SpeechKit недоступен',
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  const raw = await res.text().catch(() => '')
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { detail: raw.slice(0, 800) }
  }
  if (!res.ok) {
    const detail =
      String(payload?.error_message ?? payload?.message ?? payload?.detail ?? '').trim() ||
      raw.slice(0, 800)
    return {
      ok: false,
      status: res.status >= 500 ? 502 : res.status,
      error: `Yandex SpeechKit HTTP ${res.status}`,
      detail,
    }
  }

  // Пустой result — норма для тишины на канале (стерео).
  return { ok: true, text: String(payload?.result ?? '').trim() }
}

async function transcribeWithYandexFromUrl(_audioUrl, _options = {}) {
  const apiKey = await resolveYandexApiKey()
  if (!apiKey) {
    return { ok: false, status: 503, error: 'YANDEX_SPEECHKIT_API_KEY не задан' }
  }

  const audioUrl = String(_audioUrl ?? '').trim()
  const options = _options ?? {}
  const download = await downloadAudio(audioUrl, options)
  if (!download.ok) return download

  const prepared = await prepareYandexSyncAudio(download.buffer, download.mimeType)
  if (!prepared.ok) return prepared

  const lang = String(options.language ?? env('YANDEX_SPEECHKIT_LANGUAGE', 'ru-RU')).trim() || 'ru-RU'
  const topic = String(options.yandexTopic ?? env('YANDEX_SPEECHKIT_TOPIC', 'general')).trim() || 'general'
  const profanityFilter =
    String(options.yandexProfanityFilter ?? env('YANDEX_SPEECHKIT_PROFANITY_FILTER', 'false')).trim() ===
    'true'
  const timeoutMs =
    options.yandexTimeoutMs ?? Number(env('YANDEX_SPEECHKIT_TIMEOUT_MS', String(DEFAULT_YANDEX_TIMEOUT_MS)))

  const recognizeOpts = { apiKey, lang, topic, profanityFilter, timeoutMs }

  if (prepared.stereo) {
    if (prepared.mode === 'turns' && Array.isArray(prepared.turns)) {
      const recognizedTurns = []
      for (let i = 0; i < prepared.turns.length; i++) {
        const turn = prepared.turns[i]
        const recognized = await recognizeYandexChunk({ ...recognizeOpts, buffer: turn.buffer })
        if (!recognized.ok) {
          return {
            ...recognized,
            detail: [
              `реплика ${i + 1}/${prepared.turns.length} (${turn.channel} ${turn.start?.toFixed?.(1) ?? '?'}s)`,
              recognized.detail,
            ]
              .filter(Boolean)
              .join(': '),
          }
        }
        recognizedTurns.push({
          channel: turn.channel,
          start: turn.start,
          text: recognized.text,
        })
      }
      const text = mergeYandexStereoTurns(recognizedTurns, prepared.labels)
      if (!text) {
        return { ok: false, status: 502, error: 'Yandex SpeechKit не вернул текст' }
      }
      return {
        ok: true,
        text,
        model: `yandex-speechkit-stt:stereo-turns×${prepared.turns.length}`,
        mimeType: download.mimeType,
        bytes: download.bytes,
        provider: 'yandex',
      }
    }

    const left = prepared.leftChunks || []
    const right = prepared.rightChunks || []
    const count = Math.max(left.length, right.length)
    const pairs = []
    for (let i = 0; i < count; i++) {
      let textA = ''
      let textB = ''
      if (left[i]) {
        const recognized = await recognizeYandexChunk({ ...recognizeOpts, buffer: left[i].buffer })
        if (!recognized.ok) {
          return {
            ...recognized,
            detail: [`канал L, сегмент ${i + 1}/${count}`, recognized.detail].filter(Boolean).join(': '),
          }
        }
        textA = recognized.text
      }
      if (right[i]) {
        const recognized = await recognizeYandexChunk({ ...recognizeOpts, buffer: right[i].buffer })
        if (!recognized.ok) {
          return {
            ...recognized,
            detail: [`канал R, сегмент ${i + 1}/${count}`, recognized.detail].filter(Boolean).join(': '),
          }
        }
        textB = recognized.text
      }
      pairs.push({ a: textA, b: textB })
    }

    const text = mergeYandexStereoTranscript(pairs, prepared.labels)
    if (!text) {
      return { ok: false, status: 502, error: 'Yandex SpeechKit не вернул текст' }
    }
    return {
      ok: true,
      text,
      model: `yandex-speechkit-stt:stereo-chunks×${count}`,
      mimeType: download.mimeType,
      bytes: download.bytes,
      provider: 'yandex',
    }
  }

  const parts = []
  for (let i = 0; i < prepared.chunks.length; i++) {
    const chunk = prepared.chunks[i]
    const recognized = await recognizeYandexChunk({
      ...recognizeOpts,
      buffer: chunk.buffer,
    })
    if (!recognized.ok) {
      return {
        ...recognized,
        detail: [
          prepared.chunks.length > 1 ? `сегмент ${i + 1}/${prepared.chunks.length}` : null,
          recognized.detail,
        ]
          .filter(Boolean)
          .join(': '),
      }
    }
    if (recognized.text) parts.push(recognized.text)
  }

  const text = parts.join('\n').trim()
  if (!text) {
    return { ok: false, status: 502, error: 'Yandex SpeechKit не вернул текст' }
  }

  return {
    ok: true,
    text,
    model:
      prepared.chunks.length > 1
        ? `yandex-speechkit-stt:recognize×${prepared.chunks.length}`
        : 'yandex-speechkit-stt:recognize',
    mimeType: download.mimeType,
    bytes: download.bytes,
    provider: 'yandex',
  }
}

export async function transcribeAudioFromUrl(url, options = {}) {
  const audioUrl = String(url ?? '').trim()
  if (!audioUrl) {
    return { ok: false, status: 400, error: 'Укажите URL аудио' }
  }
  try {
    new URL(audioUrl)
  } catch {
    return { ok: false, status: 400, error: 'Некорректный URL аудио' }
  }

  return transcribeViaGigaam(audioUrl, options)
}
