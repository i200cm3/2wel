const PROJECT_CODE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

const CYR_SLUG = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'j',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/** Поддомены, которые нельзя отдать отелю. */
export const RESERVED_PROJECT_CODES = new Set([
  'www',
  'app',
  'api',
  'mail',
  'ftp',
  'admin',
  'account',
  'login',
  'register',
  'editor',
  'media',
  'static',
  'assets',
  'cdn',
  'edge',
  'ns',
  'mx',
  'email',
  'support',
  'help',
  'status',
  'welcome',
  'guest',
  '2wel',
  'pclip',
  'promo',
  'test',
  'dev',
  'staging',
])

export function slugifyProjectCode(raw) {
  let out = ''
  for (const ch of String(raw ?? '').trim().toLowerCase()) {
    out += Object.hasOwn(CYR_SLUG, ch) ? CYR_SLUG[ch] : ch
  }
  out = out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return out
}

export function parseProjectCode(raw) {
  const code = slugifyProjectCode(raw)
  if (!code) return { ok: false, error: 'Укажите адрес объекта: латиница, цифры, дефис (plaza, djinal)' }
  if (!PROJECT_CODE_RE.test(code)) {
    return { ok: false, error: 'Адрес: латиница, цифры и дефис, без точки. Например plaza' }
  }
  if (RESERVED_PROJECT_CODES.has(code)) {
    return { ok: false, error: 'Этот адрес занят системой. Выберите другой, например plaza' }
  }
  return { ok: true, code }
}
