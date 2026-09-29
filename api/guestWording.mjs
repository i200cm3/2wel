/**
 * Модель часто пишет «клиент»; в продукте звонящий — «гость» (как guests в БД).
 * «Гость» мужского рода: «Клиент уточнила» → «Гость уточнил».
 * Длинные формы клиент→гость раньше коротких.
 */

const CLIENT_TO_GUEST = [
  ['Клиентом', 'Гостем'],
  ['клиентом', 'гостем'],
  ['Клиенту', 'Гостю'],
  ['клиенту', 'гостю'],
  ['Клиента', 'Гостя'],
  ['клиента', 'гостя'],
  ['Клиенте', 'Госте'],
  ['клиенте', 'госте'],
  ['Клиентов', 'Гостей'],
  ['клиентов', 'гостей'],
  ['Клиентам', 'Гостям'],
  ['клиентам', 'гостям'],
  ['Клиентах', 'Гостях'],
  ['клиентах', 'гостях'],
  ['Клиенты', 'Гости'],
  ['клиенты', 'гости'],
  ['Клиент', 'Гость'],
  ['клиент', 'гость'],
]

/** Типичные глаголы звонящего в саммари — только их чиним по роду. */
const GUEST_FEM_PAST = new Set([
  'уточнила',
  'спросила',
  'хотела',
  'сообщила',
  'отказалась',
  'согласилась',
  'интересовалась',
  'забронировала',
  'звонила',
  'сказала',
  'просила',
  'подтвердила',
  'выбрала',
  'искала',
  'ждала',
  'перезвонила',
  'написала',
  'узнала',
  'оставила',
  'заказала',
  'оформила',
  'позвонила',
  'набрала',
  'подумала',
])

function toMasculinePast(word) {
  if (/лась$/i.test(word) && word.length > 4) return word.replace(/лась$/i, 'лся')
  if (/ла$/i.test(word) && word.length > 3) return word.replace(/ла$/i, 'л')
  return word
}

/**
 * «Клиентуточнил» → «Клиент уточнил» до падежной замены.
 * Окончания падежей ≤2 букв (а/у/ом/ов…), глагол — ≥3.
 */
function unglueClientSubject(text) {
  return String(text ?? '').replace(/(Клиент|клиент)(?=[а-яё]{3,})/g, '$1 ')
}

/**
 * «Гостьуточнил» → «Гость уточнил».
 * Склонения «гостя/гостю/…» без «ь» не матчятся; «гостья» оставляем.
 */
export function unglueGuestSubject(text) {
  return String(text ?? '').replace(/(Гость|гость)([А-Яа-яЁё]+)/g, (full, guest, rest) => {
    if (/^гость(я|ю|ей|и|е)$/i.test(`${guest}${rest}`)) return full
    return `${guest} ${rest}`
  })
}

/**
 * В предложениях с подлежащим «гость» женские глаголы звонящего → мужской род.
 * «дата была занята» не трогаем (не из списка).
 */
export function agreeGuestPastTense(text) {
  return String(text ?? '').replace(/(Гость|гость)([^.!?]*)/g, (full, guest, rest) => {
    const fixed = rest.replace(/[А-Яа-яЁё-]+/g, (word) => {
      if (!GUEST_FEM_PAST.has(word.toLowerCase())) return word
      return toMasculinePast(word)
    })
    return guest + fixed
  })
}

export function rewriteClientAsGuest(text) {
  let out = String(text ?? '')
  if (!out) return out
  out = unglueClientSubject(out)
  for (const [from, to] of CLIENT_TO_GUEST) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  out = unglueGuestSubject(out)
  return agreeGuestPastTense(out)
}
