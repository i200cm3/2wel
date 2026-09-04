const PROJECT_TTS_RE = /^\/media\/projects\/([a-z0-9-]+)\/tts\/([^/?#]+)(\?[^#]*)?$/

/**
 * Файлы озвучки закрыты в статике: кабинет играет их через API по сессии,
 * гость — по подписанной ссылке, которая уже приходит в конфиге.
 */
export function ttsPlaybackUrl(src: string): string {
  const value = src?.trim()
  if (!value) return value
  const match = PROJECT_TTS_RE.exec(value)
  if (!match) return value
  const [, code, fileName, search = ''] = match
  return `/api/projects/${encodeURIComponent(code!)}/tts/file/${encodeURIComponent(fileName!)}${search}`
}
