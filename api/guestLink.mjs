/**
 * Правила выдачи гостевой ссылки без БД — чтобы тесты ловили идемпотентность
 * по externalId и отказ, пока шаблон не опубликован.
 */
function asLinkField(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value.trim()
  return ''
}

/** Имя человека, а не телефон / email / id из amo. */
export function looksLikePersonName(value) {
  const text = asLinkField(value)
  if (text.length < 2 || text.length > 40) return false
  if (/@/.test(text) || /https?:\/\//i.test(text)) return false
  const compact = text.replace(/[\s\-()+.]/g, '')
  if (/^\+?\d{5,}$/.test(compact)) return false
  const letters = (text.match(/[A-Za-zА-Яа-яЁё]/g) || []).length
  const digits = (text.match(/\d/g) || []).length
  return letters >= 2 && digits < 5
}

const NAME_TOKEN = '\u0000'

function capitalizeFirstLetter(text) {
  const chars = [...text]
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]
    if (!ch || /\s/.test(ch)) continue
    chars[i] = ch.toLocaleUpperCase('ru-RU')
    break
  }
  return chars.join('')
}

/** Убрать {name} из фразы, не оставляя «Здравствуйте, !». */
export function omitNamePlaceholder(template) {
  let s = String(template ?? '')
    .replace(/\{\s*name\s*\}/gi, NAME_TOKEN)
    .replace(/\[\s*name\s*\]/gi, NAME_TOKEN)
  const hadLeading = new RegExp(`^\\s*${NAME_TOKEN}`).test(s)
  s = s.replace(/меня зовут\s*\u0000[.!?…]*/gi, '')
  s = s.replace(new RegExp(`^${NAME_TOKEN}[,:;]?\\s*`), '')
  s = s.replace(new RegExp(`,\\s*${NAME_TOKEN}(?=[\\s.!?…,:;]|$)`, 'g'), '')
  s = s.replace(new RegExp(`\\s*${NAME_TOKEN}`, 'g'), '')
  s = s.replaceAll(NAME_TOKEN, '')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/[ \t]+([.!?,:;])/g, '$1')
  s = s.replace(/^[ \t]+/gm, '')
  if (hadLeading) s = capitalizeFirstLetter(s)
  return s.replace(/[ \t]+$/gm, '').replace(/[ \t]{2,}/g, ' ')
}

/** Первая буква заглавная: «виталий» → «Виталий». */
export function formatGuestName(value) {
  const text = asLinkField(value)
  if (!text) return ''
  const chars = [...text]
  chars[0] = chars[0].toLocaleUpperCase('ru-RU')
  return chars.join('').slice(0, 80)
}

/** Имя для титров/TTS: пусто, если это не похоже на человека. */
export function displayPersonName(value) {
  const text = asLinkField(value)
  if (!looksLikePersonName(text)) return ''
  return formatGuestName(text)
}

export function fillGuestNameTemplate(template, guestName) {
  const name = displayPersonName(guestName)
  if (!name) return omitNamePlaceholder(String(template ?? ''))
  return String(template ?? '')
    .replace(/\{\s*name\s*\}/gi, name)
    .replace(/\[\s*name\s*\]/gi, name)
}

export function parseGuestLinkBody(body) {
  const name = formatGuestName(body?.name)
  const category = asLinkField(body?.category)
  const externalId = asLinkField(body?.externalId ?? body?.external_id)
  const statusId = asLinkField(body?.statusId ?? body?.status_id)
  const summarySource =
    body?.summary && typeof body.summary === 'object' ? body.summary : body
  const summary = {
    dates: asLinkField(summarySource?.dates),
    partyType: asLinkField(summarySource?.partyType ?? summarySource?.party_type),
    topics: asLinkField(summarySource?.topics),
    objections: asLinkField(summarySource?.objections),
    confidence: asLinkField(summarySource?.confidence) || '0.8',
    room: asLinkField(summarySource?.room),
    fillRemaining: asLinkField(summarySource?.fillRemaining ?? summarySource?.fill_remaining) || 'off',
    hello: asLinkField(summarySource?.hello),
  }
  const amoSnapshot =
    body?.amoSnapshot && typeof body.amoSnapshot === 'object'
      ? body.amoSnapshot
      : body?.amo_snapshot && typeof body.amo_snapshot === 'object'
        ? body.amo_snapshot
        : null
  const summaryMeta =
    body?.summaryMeta && typeof body.summaryMeta === 'object'
      ? body.summaryMeta
      : body?.summary_meta && typeof body.summary_meta === 'object'
        ? body.summary_meta
        : null
  const rawSources = normalizeRawSourcesInput(body)
  return { name, category, externalId, statusId, summary, amoSnapshot, summaryMeta, rawSources }
}

function normalizeRawSourcesInput(body) {
  const out = []
  if (Array.isArray(body?.rawSources)) {
    for (const item of body.rawSources) out.push(item)
  } else if (Array.isArray(body?.raw_sources)) {
    for (const item of body.raw_sources) out.push(item)
  }
  const rawText = asLinkField(body?.rawText ?? body?.raw_text)
  if (rawText) {
    out.push({ kind: 'manual', title: 'Raw text', body: rawText })
  }
  return out
}

/**
 * Явный category → маппинг статуса → пусто (тогда default / keep).
 * @param {{
 *   category?: string,
 *   statusId?: string,
 *   statusMap?: Array<{ statusId?: string, templateCode?: string }>,
 * }} input
 */
export function resolveTemplateCode({ category, statusId, statusMap }) {
  const cat = asLinkField(category)
  if (cat) return cat
  const sid = asLinkField(statusId)
  if (!sid || !Array.isArray(statusMap)) return ''
  const hit = statusMap.find((item) => asLinkField(item?.statusId) === sid)
  return asLinkField(hit?.templateCode)
}

/**
 * @param {{
 *   name: string,
 *   externalId: string,
 *   existing: object | null,
 *   template: { status: string, hasPublishedConfig: boolean } | null,
 * }} input
 */
export function decideGuestLink({ name, externalId, existing, template }) {
  if (!name) return { ok: false, status: 400, error: 'Укажите имя' }
  if (externalId.length > 128) return { ok: false, status: 400, error: 'externalId слишком длинный' }
  if (externalId && existing) {
    return { ok: true, reused: true, link: existing }
  }
  if (!template) return { ok: false, status: 400, error: 'Неизвестный шаблон (category)' }
  if (template.status !== 'published' || !template.hasPublishedConfig) {
    return { ok: false, status: 400, error: 'Шаблон ещё не опубликован' }
  }
  return { ok: true, reused: false }
}
