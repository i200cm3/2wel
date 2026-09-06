/** Idempotent ключ демо с лендинга: `demo:email@…` — не id сделки amo. */
export function isMarketingDemoExternalId(externalId: string | null | undefined) {
  return String(externalId ?? '')
    .trim()
    .toLowerCase()
    .startsWith('demo:')
}

/** Email из `demo:user@host`, иначе null. */
export function emailFromDemoExternalId(externalId: string | null | undefined) {
  const raw = String(externalId ?? '').trim()
  if (!isMarketingDemoExternalId(raw)) return null
  const email = raw.slice(raw.indexOf(':') + 1).trim()
  return email || null
}

/** Ссылка на карточку сделки в amoCRM / Kommo. */
export function amoLeadUrl(baseDomain: string | null | undefined, leadId: string | null | undefined) {
  const domain = String(baseDomain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  const id = String(leadId ?? '').trim()
  if (!domain || !id || isMarketingDemoExternalId(id)) return null
  return `https://${domain}/leads/detail/${encodeURIComponent(id)}`
}
