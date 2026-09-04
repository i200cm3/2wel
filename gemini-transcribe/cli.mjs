import { loadEnvFile, env } from './env.mjs'
import { transcribeFromUrl } from './lib.mjs'

loadEnvFile()

const url = process.argv[2]
if (!url) {
  console.error('Использование: node cli.mjs <url-аудио>')
  process.exit(1)
}

const apiKey = env('GEMINI_API_KEY')
if (!apiKey) {
  console.error('Задайте GEMINI_API_KEY в gemini-transcribe/.env')
  process.exit(1)
}

const result = await transcribeFromUrl(url, {
  apiKey,
  model: env('GEMINI_MODEL', 'gemini-3.6-flash'),
  prompt: env('GEMINI_TRANSCRIBE_PROMPT') || undefined,
  language: env('GEMINI_TRANSCRIBE_LANGUAGE') || undefined,
  maxBytes: Number(env('MAX_AUDIO_BYTES', String(20 * 1024 * 1024))),
  downloadTimeoutMs: Number(env('DOWNLOAD_TIMEOUT_MS', '120000')),
  geminiTimeoutMs: Number(env('GEMINI_TIMEOUT_MS', '180000')),
})

if (!result.ok) {
  console.error(result.error)
  if (result.detail) console.error(result.detail)
  process.exit(1)
}

console.log(result.text)
console.error(
  `\n--- ${result.bytes} байт, ${result.mimeType}, model ${result.model} ---`,
)
