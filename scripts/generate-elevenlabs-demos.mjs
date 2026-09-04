#!/usr/bin/env node
/**
 * Генерирует MP3-демо для всех голосов из ELEVENLABS_VOICES.
 * Текст — ELEVENLABS_VOICE_DEMO_TEXT в api/ttsVoiceDemo.mjs.
 *
 *   node scripts/generate-elevenlabs-demos.mjs
 *   node scripts/generate-elevenlabs-demos.mjs --force
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, publicDir } from '../api/env.js'
import { synthesizeEleven, elevenSettings } from '../api/tts.mjs'
import {
  ELEVENLABS_VOICE_DEMO_TEXT,
  elevenDemoDir,
  elevenDemoFilePath,
  elevenDemoManifestPath,
} from '../api/ttsVoiceDemo.mjs'
import { elevenVoices } from '../api/ttsVoices.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FORCE = process.argv.includes('--force')

function loadEnvFile(filePath, into) {
  if (!fs.existsSync(filePath)) return
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1)
    }
    if (!key || into[key]) continue
    into[key] = val
  }
}

function ensureCredentials() {
  loadEnv()
  if (process.argv.includes('--direct')) {
    if (!process.env.ELEVENLABS_API_KEY) {
      loadEnvFile(path.join(ROOT, 'elevenlabs-proxy', '.env'), process.env)
    }
    delete process.env.ELEVENLABS_PROXY_URL
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error('Для --direct нужен ELEVENLABS_API_KEY.')
      process.exit(1)
    }
    return
  }
  if (process.env.ELEVENLABS_PROXY_URL && process.env.ELEVENLABS_PROXY_SECRET) {
    return
  }
  if (process.env.ELEVENLABS_API_KEY) {
    delete process.env.ELEVENLABS_PROXY_URL
    return
  }
  loadEnvFile(path.join(ROOT, 'elevenlabs-proxy', '.env'), process.env)
  if (process.env.ELEVENLABS_API_KEY) {
    delete process.env.ELEVENLABS_PROXY_URL
    return
  }
  console.error(
    'Нужны ELEVENLABS_PROXY_URL + SECRET в .env или ELEVENLABS_API_KEY (--direct).',
  )
  process.exit(1)
}

async function main() {
  ensureCredentials()
  const voices = elevenVoices()
  if (!voices.length) {
    console.error('ELEVENLABS_VOICES пуст — нечего генерировать.')
    process.exit(1)
  }

  const settings = elevenSettings()
  const outDir = elevenDemoDir()
  fs.mkdirSync(outDir, { recursive: true })

  const manifest = {
    text: ELEVENLABS_VOICE_DEMO_TEXT,
    source: path.join(ROOT, 'elevenlabs-proxy/voice-demo.json'),
    modelId: settings.modelId,
    voiceSettings: {
      stability: settings.stability,
      similarity_boost: settings.similarityBoost,
      style: settings.style,
      use_speaker_boost: settings.useSpeakerBoost,
    },
    generatedAt: new Date().toISOString(),
    publicDir: publicDir(),
    voices: {},
  }

  console.log(`Фраза: ${ELEVENLABS_VOICE_DEMO_TEXT}`)
  console.log(`Голосов: ${voices.length}`)
  console.log(`Папка: ${outDir}`)
  console.log('')

  let ok = 0
  let skipped = 0
  let failed = 0

  for (const voice of voices) {
    const filePath = elevenDemoFilePath(voice.id)
    if (!FORCE && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      console.log(`⏭  ${voice.name} (${voice.id}) — уже есть`)
      skipped += 1
      manifest.voices[voice.id] = {
        name: voice.name,
        file: path.basename(filePath),
        bytes: fs.statSync(filePath).size,
        skipped: true,
      }
      continue
    }

    process.stdout.write(`… ${voice.name} (${voice.id})`)
    const result = await synthesizeEleven(ELEVENLABS_VOICE_DEMO_TEXT, voice.id, settings)
    if (!result.ok) {
      console.log(` ✗ ${result.error}${result.detail ? `: ${result.detail}` : ''}`)
      failed += 1
      continue
    }

    await fs.promises.writeFile(filePath, result.buffer, { mode: 0o644 })
    console.log(` ✓ ${result.buffer.byteLength} bytes`)
    ok += 1
    manifest.voices[voice.id] = {
      name: voice.name,
      file: path.basename(filePath),
      bytes: result.buffer.byteLength,
    }
  }

  await fs.promises.writeFile(elevenDemoManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  })

  console.log('')
  console.log(`Готово: ${ok} новых, ${skipped} пропущено, ${failed} ошибок`)
  console.log(`Манифест: ${elevenDemoManifestPath()}`)
  const mp3Count = Object.keys(manifest.voices).length
  if (mp3Count === 0) {
    console.error('Нет ни одного MP3')
    process.exit(1)
  }
  if (failed > 0) {
    console.error('Часть голосов не сгенерировалась (часто 402 на library). Удавшиеся MP3 сохранены.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
