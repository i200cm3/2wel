/** Нормализация телефонов amo/Sipuni: 8XXXXXXXXXX и 10 цифр → 7XXXXXXXXXX. */
export function normalizeAmoPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`
  if (digits.length === 10) return `7${digits}`
  if (digits.length === 11 && digits.startsWith('7')) return digits
  if (digits.length >= 10 && digits.length <= 15) return digits
  return ''
}

export function uniqueAmoPhones(values) {
  const out = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : [values]) {
    const phone = normalizeAmoPhone(value)
    if (!phone || seen.has(phone)) continue
    seen.add(phone)
    out.push(phone)
  }
  return out
}

export function amoPhoneQueryVariants(normalized) {
  const phone = normalizeAmoPhone(normalized)
  if (!phone) return []
  const out = new Set([phone])
  if (phone.length === 11 && phone.startsWith('7')) {
    out.add(`8${phone.slice(1)}`)
    out.add(phone.slice(1))
    out.add(`+${phone}`)
  }
  return [...out]
}

export function phonesFromAmoContact(contact) {
  const fields = Array.isArray(contact?.custom_fields_values) ? contact.custom_fields_values : []
  const raw = []
  for (const field of fields) {
    const code = String(field?.field_code ?? field?.code ?? '').toUpperCase()
    const name = String(field?.field_name ?? field?.name ?? '').toLowerCase()
    if (code !== 'PHONE' && !name.includes('телефон') && !name.includes('phone')) continue
    const values = Array.isArray(field?.values) ? field.values : []
    for (const item of values) raw.push(item?.value ?? item)
  }
  return uniqueAmoPhones(raw)
}

const PHONE_IN_TEXT_RE = /(?:\+?7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g

export function phonesFromAmoNoteParams(params, text = '') {
  const record = params && typeof params === 'object' && !Array.isArray(params) ? params : {}
  const fromParams = uniqueAmoPhones([
    record.phone,
    record.PHONE,
    record.number,
    record.from,
    record.to,
  ])
  const fromText = []
  const blob = String(text ?? '')
  for (const match of blob.matchAll(PHONE_IN_TEXT_RE)) {
    const phone = normalizeAmoPhone(match[0])
    if (phone) fromText.push(phone)
  }
  return uniqueAmoPhones([...fromParams, ...fromText])
}
