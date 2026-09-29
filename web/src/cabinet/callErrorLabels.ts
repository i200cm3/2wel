/** Пользовательские подписи ошибок/статусов звонка (без техжаргона). */

export function friendlyCallErrorLabel(error: string | null | undefined): string {
  const raw = String(error ?? '').trim()
  if (!raw) return 'Не удалось обработать звонок. Попробуйте «Саммари заново».'

  const key = raw.toLowerCase()
  if (
    key.includes('json') ||
    key.includes('extract') ||
    key === 'extract_failed' ||
    key === 'extract_parse_failed' ||
    key === 'extract_no_json' ||
    key === 'extract_invalid_json' ||
    key === 'extract_empty_fields' ||
    key === 'extract_wrong_language' ||
    key === 'ожидался json-объект' ||
    key.includes('разобрать') ||
    key.includes('невалидн') ||
    key.includes('нет json')
  ) {
    return 'Не удалось собрать саммари. Нажмите «Саммари заново».'
  }
  if (
    key.includes('transcribe') ||
    key.includes('stt') ||
    key === 'transcribe_failed' ||
    key === 'transcribe_not_configured'
  ) {
    return 'Не удалось распознать речь. Нажмите «Саммари заново».'
  }
  if (key.includes('recording') || key.includes('запись')) {
    return 'Запись недоступна. Попробуйте позже или «Саммари заново».'
  }
  if (key.includes('amo') || key.includes('note_failed')) {
    return 'Саммари готово, но не удалось записать заметку в amo.'
  }
  if (
    key.includes('timeout') ||
    key.includes('502') ||
    key.includes('503') ||
    key.includes('429') ||
    key.includes('fetch failed') ||
    key === 'econnreset' ||
    key === 'econnrefused'
  ) {
    return 'Сервис временно недоступен. Нажмите «Саммари заново».'
  }
  // Не показываем сырые технические сообщения / stack.
  if (/[{}\[\]]|Error:|TypeError|ECONN|ENOTFOUND|at\s+\w+/i.test(raw) || raw.length > 120) {
    return 'Не удалось обработать звонок. Нажмите «Саммари заново».'
  }
  return raw
}
