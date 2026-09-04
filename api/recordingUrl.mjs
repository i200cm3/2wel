/** URL записи звонка: в body (ещё не транскрибирован) или в meta после STT. */

export function isRecordingUrl(text) {
  return /^https?:\/\//i.test(String(text ?? '').trim())
}

export function recordingUrlFromSource(source) {
  const body = String(source?.body ?? '').trim()
  if (isRecordingUrl(body)) return body
  const fromMeta = String(source?.meta?.recordingUrl ?? '').trim()
  if (isRecordingUrl(fromMeta)) return fromMeta
  return null
}
