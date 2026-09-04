#!/usr/bin/env node
/**
 * Генерация MP3-демо для voice-demo.json.
 *
 * На VDS (рядом с .env):
 *   node generate-demos.mjs --output demo-output
 *
 * Внутри контейнера прокси (исходящий fetch к ElevenLabs может не работать):
 *   node generate-demos.mjs --output /tmp/demos --via-proxy http://127.0.0.1:3099
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')

function argValue(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : ''
}

const outFromFlag = argValue('--output')
const positional = argv.find((a) => !a.startsWith('-') && a !== '--force')
const OUT_DIR = path.resolve(outFromFlag || positional || path.join(__dirname, 'demo-output'))
const PROXY_URL = argValue('--via-proxy')
const TIMEOUT_MS = 60_000

function loadEnv() {
  for (const envPath of [path.join(__dirname, '.env'), path.resolve(__dirname, '..', '.env')]) {
    if (!fs.existsSync(envPath)) continue
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const eq = line.indexOf('=')
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  }
}

function errDetail(err) {
  if (!(err instanceof Error)) return String(err)
  const parts = [err.message]
  if (err.cause instanceof Error && err.cause.message) parts.push(err.cause.message)
  return parts.join(' · ')
}

async function synthesizeDirect(apiKey, voiceId, spec) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: spec.text,
          model_id: spec.modelId,
          voice_settings: spec.voiceSettings,
        }),
        signal: ctrl.signal,
      },
    )
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    }
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    return { ok: false, error: errDetail(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function synthesizeViaProxy(proxyBase, secret, voiceId, spec) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${proxyBase.replace(/\/$/, '')}/v1/synthesize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: spec.text,
        voice: voiceId,
        modelId: spec.modelId,
        voiceSettings: spec.voiceSettings,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = ''
      try {
        const payload = await res.json()
        detail = String(payload?.detail ?? payload?.error ?? '')
      } catch {
        detail = (await res.text().catch(() => '')).slice(0, 200)
      }
      return { ok: false, error: `proxy HTTP ${res.status}${detail ? `: ${detail}` : ''}` }
    }
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    return { ok: false, error: errDetail(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function synthesize(voiceId, spec, { apiKey, proxyUrl, proxySecret }) {
  if (proxyUrl && proxySecret) {
    return synthesizeViaProxy(proxyUrl, proxySecret, voiceId, spec)
  }
  if (apiKey) {
    return synthesizeDirect(apiKey, voiceId, spec)
  }
  return { ok: false, error: 'нет ELEVENLABS_API_KEY и не задан --via-proxy + SECRET' }
}

async function main() {
  loadEnv()
  const apiKey = process.env.ELEVENLABS_API_KEY || ''
  const proxyUrl = PROXY_URL || process.env.ELEVENLABS_PROXY_URL || ''
  const proxySecret = process.env.ELEVENLABS_PROXY_SECRET || ''

  if (!apiKey && !(proxyUrl && proxySecret)) {
    console.error('Нужен ELEVENLABS_API_KEY или --via-proxy + ELEVENLABS_PROXY_SECRET')
    process.exit(1)
  }

  const specPath = path.join(__dirname, 'voice-demo.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const creds = { apiKey, proxyUrl, proxySecret }
  const mode = proxyUrl && proxySecret ? `proxy ${proxyUrl}` : 'direct API'

  console.log(`Фраза: ${spec.text}`)
  console.log(`Вывод: ${OUT_DIR}`)
  console.log(`Режим: ${mode}`)
  console.log('')

  let ok = 0
  let skipped = 0
  const errors = []
  for (const voice of spec.voices) {
    const filePath = path.join(OUT_DIR, `${voice.id}.mp3`)
    if (!FORCE && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      console.log(`⏭  ${voice.name}`)
      skipped += 1
      continue
    }
    process.stdout.write(`… ${voice.name}`)
    const result = await synthesize(voice.id, spec, creds)
    if (!result.ok) {
      console.log(` ✗ ${result.error}`)
      errors.push({ id: voice.id, name: voice.name, error: result.error })
      continue
    }
    await fs.promises.writeFile(filePath, result.buffer, { mode: 0o644 })
    console.log(` ✓ ${result.buffer.byteLength} bytes`)
    ok += 1
  }

  const files = Object.fromEntries(
    spec.voices
      .map((v) => {
        const p = path.join(OUT_DIR, `${v.id}.mp3`)
        if (!fs.existsSync(p) || fs.statSync(p).size <= 0) return null
        return [v.id, { name: v.name, bytes: fs.statSync(p).size }]
      })
      .filter(Boolean),
  )

  const manifest = {
    ...spec,
    generatedAt: new Date().toISOString(),
    outputDir: OUT_DIR,
    mode,
    files,
    ...(errors.length ? { errors } : {}),
  }
  await fs.promises.writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const fileCount = Object.keys(files).length
  console.log(`\nГотово: ${ok} новых, ${skipped} пропущено, ${errors.length} ошибок, ${fileCount} mp3`)
  if (fileCount === 0) {
    console.error('Нет ни одного MP3')
    process.exit(1)
  }
  if (errors.length) {
    console.error('Часть голосов не сгенерировалась (часто 402 на library). Удавшиеся MP3 сохранены.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
