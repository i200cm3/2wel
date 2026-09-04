/** Ссылка на карточку сделки в amoCRM / Kommo. */
export function amoLeadUrl(baseDomain: string | null | undefined, leadId: string | null | undefined) {
  const domain = String(baseDomain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  const id = String(leadId ?? '').trim()
  if (!domain || !id) return null
  return `https://${domain}/leads/detail/${encodeURIComponent(id)}`
}
