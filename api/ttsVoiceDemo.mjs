import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicDir } from './env.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VOICE_DEMO_JSON = path.join(ROOT, 'elevenlabs-proxy', 'voice-demo.json')

function loadVoiceDemoSpec() {
  if (fs.existsSync(VOICE_DEMO_JSON)) {
    return JSON.parse(fs.readFileSync(VOICE_DEMO_JSON, 'utf8'))
  }
  return {
    text: 'Здравствуйте! Мы подготовили для вас персональную презентацию.',
  }
}

/** Одна фраза для предпрослушивания всех голосов ElevenLabs (источник: elevenlabs-proxy/voice-demo.json). */
export const ELEVENLABS_VOICE_DEMO_TEXT = loadVoiceDemoSpec().text

const VOICE_ID_RE = /^[a-zA-Z0-9]{8,64}$/

export function elevenDemoRelPath(voiceId) {
  if (!VOICE_ID_RE.test(String(voiceId ?? ''))) return ''
  return `media/tts/demos/elevenlabs/${voiceId}.mp3`
}

export function elevenDemoSrc(voiceId) {
  const rel = elevenDemoRelPath(voiceId)
  return rel ? `/${rel}` : ''
}

export function elevenDemoDir() {
  return path.join(publicDir(), 'media/tts/demos/elevenlabs')
}

export function elevenDemoFilePath(voiceId) {
  const rel = elevenDemoRelPath(voiceId)
  return rel ? path.join(publicDir(), rel) : ''
}

export function elevenDemoManifestPath() {
  return path.join(elevenDemoDir(), 'manifest.json')
}

export function elevenDemoAvailable(voiceId) {
  const filePath = elevenDemoFilePath(voiceId)
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0)
}
