/** Единый префикс логов amo — grep: `amo.` */
export function amoLog(event, data = {}) {
  console.info(`amo.${event}`, JSON.stringify(data))
}

export function amoWarn(event, data = {}) {
  console.warn(`amo.${event}`, JSON.stringify(data))
}

export function amoError(event, err, data = {}) {
  console.error(`amo.${event}`, JSON.stringify({ ...data, error: err?.message || String(err) }))
}

/** Короткая выборка id в лог, без сотен сделок. */
export function amoIdPreview(ids, max = 8) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? '').trim()).filter(Boolean))]
  return { count: list.length, sample: list.slice(0, max) }
}
