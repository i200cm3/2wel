/** Правила адреса `{code}.2wel.ru`. Зеркало api/projectCode.mjs. */
const PROJECT_CODE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

const CYR_SLUG: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export const RESERVED_PROJECT_CODES = new Set([
  'www', 'app', 'api', 'mail', 'ftp', 'admin', 'account', 'login', 'register',
  'editor', 'media', 'static', 'assets', 'cdn', 'edge', 'ns', 'mx', 'email',
  'support', 'help', 'status', 'welcome', 'guest', '2wel', 'pclip', 'promo', 'test',
  'dev', 'staging',
])

export function slugifyProjectCode(raw: string): string {
  let out = ''
  for (const ch of String(raw ?? '').trim().toLowerCase()) {
    out += Object.hasOwn(CYR_SLUG, ch) ? CYR_SLUG[ch] : ch
  }
  return out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export type ProjectCodeCheck = { ok: true; code: string } | { ok: false; error: string }

export function validateProjectCode(raw: string): ProjectCodeCheck {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return { ok: false, error: 'Укажите адрес: латиница, цифры и дефис. Например plaza' }
  if (value.includes('.')) return { ok: false, error: 'Без точек — это только первая часть адреса' }
  if (/[^a-z0-9-]/.test(value)) {
    return { ok: false, error: 'Только латиница, цифры и дефис. Например plaza' }
  }
  if (!PROJECT_CODE_RE.test(value)) {
    return { ok: false, error: 'Начните и закончите буквой или цифрой, без двух дефисов подряд' }
  }
  if (RESERVED_PROJECT_CODES.has(value)) {
    return { ok: false, error: 'Этот адрес занят системой. Выберите другой, например plaza' }
  }
  return { ok: true, code: value }
}
