export type BlockLogicOption = {
  value: string
  label: string
  hint: string
}

export type BlockLogicGroup = {
  value: string
  label: string
  items: BlockLogicOption[]
}

function option(prefix: string, slug: string, label: string, hint: string): BlockLogicOption {
  return { value: `${prefix}.${slug}`, label, hint }
}

function group(value: string, label: string, prefix: string, entries: [string, string, string][]): BlockLogicGroup {
  return {
    value,
    label,
    items: entries.map(([slug, itemLabel, hint]) => option(prefix, slug, itemLabel, hint)),
  }
}

export const BLOCK_LOGIC_GROUPS: BlockLogicGroup[] = [
  group('intro', 'Вступление', 'intro', [
    ['generic', 'Универсальное intro', 'Мало данных о госте — безопасный старт'],
    ['by-dates', 'Intro по датам', 'Известны даты или месяц поездки'],
    ['after-call', 'После звонка', 'Недавний звонок, есть summary'],
    ['after-chat', 'После чата', 'Диалог в мессенджере без звонка'],
    ['repeat-guest', 'Повторный гость', 'Повторное обращение или заезд'],
    ['by-purpose', 'Intro по цели', 'Понятна цель: лечение / отдых / семья / восстановление'],
  ]),
  group('about', 'Об объекте', 'about', [
    ['positioning', 'Позиционирование', 'Коротко задать рамку объекта'],
    ['why-this-place', 'Почему здесь', 'Гость сравнивает несколько объектов'],
    ['health-rest-balance', 'Лечение и отдых', 'Показать сочетание лечения и отдыха'],
    ['premium-calm', 'Premium и спокойствие', 'Аудитория чувствительна к уровню и тишине'],
    ['safe-default', 'Универсальный about', 'Мало данных — безопасный блок'],
  ]),
  group('rooms', 'Номера', 'rooms', [
    ['standard', 'Стандарт', 'Базовое размещение / чувствительность к цене'],
    ['superior', 'Superior', 'Повышенный комфорт без люкса'],
    ['deluxe', 'Deluxe', 'Обсуждали улучшенную категорию'],
    ['luxury', 'Люкс', 'Высокий чек / premium-запрос'],
    ['single', 'Одноместный', 'Гость едет один'],
    ['double', 'Двухместный', 'Пара / двое взрослых'],
    ['family', 'Семейный', 'Есть дети / семейный запрос'],
    ['quiet', 'Тихий номер', 'Важны тишина, сон, спокойствие'],
    ['view', 'С видом', 'Важны вид, эстетика, атмосфера'],
    ['near-medical', 'Близко к лечебной базе', 'Важна близость к процедурам'],
    ['comfort', 'Комфорт проживания', 'Общий запрос на удобство и быт'],
  ]),
  group('treatment', 'Лечение', 'treatment', [
    ['start', 'С чего начинается лечение', 'Почти всегда при medical interest'],
    ['diagnostics', 'Диагностика', 'Гость хочет понять, с чего всё начинается'],
    ['profile-musculoskeletal', 'Профиль: ОДА', 'Суставы / спина / опорно-двигательный'],
    ['profile-cardio', 'Профиль: сердце и сосуды', 'Сердечно-сосудистый профиль'],
    ['profile-neuro', 'Профиль: нервная система', 'Стресс, нервная система, восстановление'],
    ['profile-breathing', 'Профиль: дыхание', 'Дыхание / ЛОР / восстановление'],
    ['profile-digestive', 'Профиль: ЖКТ', 'ЖКТ / обмен веществ'],
    ['balneology', 'Бальнеология', 'Сильный wellness/санаторный профиль'],
    ['physio', 'Физиотерапия', 'Важны процедуры и аппаратная часть'],
    ['massage', 'Массаж', 'Восстановление и снятие напряжения'],
    ['inhalation', 'Ингаляции', 'Релевантно профилю гостя'],
    ['drinking-cure', 'Питьевое лечение', 'Часть ценности объекта'],
    ['individual-plan', 'Индивидуальный план', 'Сомнение «подойдёт ли мне»'],
    ['day-rhythm', 'Ритм дня лечения', 'Снять страх перегруза процедурами'],
  ]),
  group('food', 'Питание', 'food', [
    ['buffet', 'Шведский стол', 'Питание шведский стол — сильная сторона'],
    ['set-menu', 'Меню / рацион', 'Более регламентированное питание'],
    ['diet', 'Диетическое питание', 'Запрос на лечебное/диетическое питание'],
    ['family', 'Питание для семьи', 'Едут с детьми'],
    ['healthy', 'Здоровое питание', 'Wellness, режим, качество еды'],
    ['what-included', 'Что входит в питание', 'Вопрос «что входит»'],
    ['daily-routine', 'Режим питания', 'Важен комфорт режима дня'],
    ['restaurant-space', 'Ресторан и атмосфера', 'Показать атмосферу и уровень'],
  ]),
  group('territory', 'Территория', 'territory', [
    ['park', 'Парк', 'Сильна природная составляющая'],
    ['walks', 'Прогулки', 'Важны прогулки и воздух'],
    ['views', 'Виды', 'Визуальное впечатление важно'],
    ['quiet', 'Тихая территория', 'Гость ищет покой и восстановление'],
    ['season-summer', 'Летний сезон', 'Летний заезд'],
    ['season-autumn', 'Осенний сезон', 'Осенний заезд'],
    ['season-winter', 'Зимний сезон', 'Зимний заезд'],
    ['season-spring', 'Весенний сезон', 'Весенний заезд'],
    ['between-procedures', 'Между процедурами', 'Ритм дня между лечением'],
  ]),
  group('wellness', 'Wellness', 'wellness', [
    ['pool', 'Бассейн', 'Бассейн часто спрашивают или это магнит'],
    ['spa', 'SPA', 'Wellness / relax запрос'],
    ['sauna', 'Сауна / баня', 'Термальная зона важна'],
    ['relax', 'Релакс', 'Поездка больше про восстановление, чем лечение'],
    ['sleep-recovery', 'Сон и восстановление', 'Усталость, выгорание, перезагрузка'],
  ]),
  group('leisure', 'Досуг', 'leisure', [
    ['calm', 'Спокойный досуг', 'Спокойный взрослый отдых'],
    ['active', 'Активный досуг', 'Нужен более живой досуг'],
    ['excursions', 'Экскурсии', 'Интерес к региону и поездкам'],
    ['evening', 'Вечерняя программа', 'День не заканчивается процедурами'],
    ['culture', 'Культура региона', 'Аудитория ценит культурное окружение'],
  ]),
  group('family', 'Семья', 'family', [
    ['with-kids', 'С детьми', 'Есть дети'],
    ['family-room', 'Семейный номер', 'Нужен семейный формат проживания'],
    ['food', 'Питание для детей', 'Важен вопрос детского питания'],
    ['safety', 'Безопасность и спокойствие', 'Тревога за удобство семьи'],
    ['routine', 'Режим дня семьи', 'Важна логистика дня'],
    ['activities', 'Занятия для детей', 'Чем занять ребёнка'],
  ]),
  group('couple', 'Пара', 'couple', [
    ['quiet-rest', 'Спокойный отдых пары', 'Пара, спокойный отдых'],
    ['wellness', 'Wellness для пары', 'Пара + wellness сценарий'],
    ['walks-views', 'Прогулки и виды', 'Важны прогулки и атмосфера'],
    ['comfort-room', 'Комфортный номер', 'Номер как часть впечатления'],
  ]),
  group('senior', 'Старшие гости', 'senior', [
    ['accessibility', 'Доступность', 'Возрастная аудитория / удобство'],
    ['calm-rhythm', 'Спокойный темп', 'Важен спокойный ритм'],
    ['medical-confidence', 'Медицинская надёжность', 'Упор на понятность и надёжность'],
    ['support', 'Поддержка на месте', 'Сигнал «не останетесь без помощи»'],
  ]),
  group('location', 'Локация', 'location', [
    ['where-is-it', 'Где находится', 'Нужно сориентировать на карте'],
    ['transfer', 'Трансфер', 'Объект помогает с дорогой'],
    ['from-airport', 'Из аэропорта', 'Гости часто прилетают'],
    ['from-station', 'Из вокзала', 'Релевантен поезд'],
    ['by-car', 'На машине', 'Гость на автомобиле'],
    ['parking', 'Парковка', 'Вопрос про авто'],
    ['nearby', 'Что рядом', 'Важно окружение'],
    ['not-too-far', 'Не слишком далеко', 'Возражение по distance'],
    ['easy-arrival', 'Простой приезд', 'Тревога про сложность дороги'],
  ]),
  group('price_value', 'Цена и ценность', 'price', [
    ['what-included', 'Что входит в цену', 'Не понимает наполнение'],
    ['why-worth-it', 'Почему стоит своих денег', 'Мягкое возражение по цене'],
    ['compare-value', 'Сравнение по ценности', 'Сравнивает с другим объектом'],
    ['by-comfort', 'Ценность через комфорт', 'Продаём комфорт проживания'],
    ['by-treatment', 'Ценность через лечение', 'Продаём медицинскую ценность'],
    ['by-all-in-one', 'Всё в одном месте', 'Важно показать комплексность'],
    ['flex-options', 'Гибкие варианты', 'Мягкий заход под разный бюджет'],
  ]),
  group('trust', 'Доверие', 'trust', [
    ['doctors', 'Врачи', 'Сомнение в уровне лечения'],
    ['service', 'Сервис', 'Тревога за сервис'],
    ['cleanliness', 'Чистота и уход', 'Чувствительность к порядку'],
    ['first-day', 'Первый день', 'Снять тревогу перед приездом'],
    ['process-clear', 'Понятный процесс', 'Любит структуру и ясность'],
    ['repeat-guests', 'Повторные гости', 'Мягкая социальная валидация'],
  ]),
  group('objections', 'Возражения', 'objection', [
    ['price', 'Возражение: цена', 'Явное или скрытое сомнение по цене'],
    ['distance', 'Возражение: дорога', 'Сомнение по удалённости'],
    ['treatment-fit', 'Подойдёт ли лечение', '«А мне это подойдёт?»'],
    ['room-fit', 'Подойдёт ли номер', 'Сомнение в размещении'],
    ['food-fit', 'Подойдёт ли питание', 'Сомнение в питании'],
    ['family-fit', 'Удобно ли с семьёй', 'Едут с детьми, непонятно удобно ли'],
    ['uncertainty', 'Неопределённость', '«Думает», но не формулирует причину'],
    ['compare-competitor', 'Сравнение с конкурентом', 'Сравнивают с другим санаторием'],
    ['dates-not-fixed', 'Даты не определены', 'Решение стопорится из-за дат'],
  ]),
  group('purpose', 'Цель поездки', 'purpose', [
    ['health-recovery', 'Лечение и восстановление', 'Цель — лечение/восстановление'],
    ['rest-reset', 'Отдых и перезагрузка', 'Нужен отдых и reset'],
    ['mix', 'Лечение + отдых', 'Баланс без перекоса'],
    ['long-stay', 'Длинный курс', 'Длинный заезд'],
    ['short-stay', 'Короткий заезд', 'Короткий заезд — максимум пользы быстро'],
  ]),
  group('next_step', 'Следующий шаг', 'next-step', [
    ['ask-price', 'Запросить расчёт', 'Близок к расчёту'],
    ['pick-room', 'Выбор номера', 'Главный вопрос — проживание'],
    ['pick-treatment', 'Выбор лечения', 'Главный вопрос — лечение'],
    ['confirm-dates', 'Подтвердить даты', 'Есть интерес, даты плавают'],
    ['family-consult', 'Семейная консультация', 'Семья, нужно согласование'],
    ['manager-chat', 'Чат с менеджером', 'Проще довести в переписке'],
  ]),
  group('cta', 'Призыв к действию', 'cta', [
    ['whatsapp', 'WhatsApp', 'Основной быстрый канал'],
    ['whatsapp-generic', 'WhatsApp без имени', 'CTA связи, если имени гостя нет'],
    ['call', 'Звонок', 'Аудитория лучше конвертится в звонок'],
    ['book', 'Бронирование', 'Горячий лид'],
    ['get-plan', 'Получить план лечения', 'Продаём программу лечения'],
    ['get-options', 'Получить варианты', 'Человек пока выбирает'],
  ]),
]

export const BLOCK_LOGIC_OPTIONS: BlockLogicOption[] = BLOCK_LOGIC_GROUPS.flatMap((g) => g.items)

export const BLOCK_LOGIC_OPTION_BY_VALUE = new Map(BLOCK_LOGIC_OPTIONS.map((item) => [item.value, item]))

export function blockLogicKeyFromMeta(meta: { group: string; subgroup?: string }): string {
  const group = meta.group.trim()
  if (!group) return ''
  const subgroup = meta.subgroup?.trim()
  if (subgroup) return `${group}.${subgroup}`
  return group
}

export function blockMetaFromLogicKey(key: string): { group: string; subgroup?: string } {
  const trimmed = key.trim()
  if (!trimmed) return { group: '', subgroup: undefined }
  const dot = trimmed.indexOf('.')
  if (dot === -1) return { group: trimmed.slice(0, 64), subgroup: undefined }
  return {
    group: trimmed.slice(0, dot).slice(0, 64),
    subgroup: trimmed.slice(dot + 1).slice(0, 64) || undefined,
  }
}

export function blockLogicLabelFromMeta(meta: { group: string; subgroup?: string }): string {
  const key = blockLogicKeyFromMeta(meta)
  if (!key) return ''
  return BLOCK_LOGIC_OPTION_BY_VALUE.get(key)?.label ?? key
}

export function blockLogicOptionFromMeta(meta: { group: string; subgroup?: string }): BlockLogicOption | null {
  const key = blockLogicKeyFromMeta(meta)
  if (!key) return null
  return BLOCK_LOGIC_OPTION_BY_VALUE.get(key) ?? { value: key, label: key, hint: 'Своё значение вне каталога' }
}

/** Порядок группы в библиотеке блоков (канонический порядок из BLOCK_LOGIC_GROUPS). */
export function blockLibraryGroupSortIndex(group: string): number {
  const g = group.trim().toLowerCase()
  if (!g) return BLOCK_LOGIC_GROUPS.length + 1
  const idx = BLOCK_LOGIC_GROUPS.findIndex(
    (item) =>
      item.value === g ||
      item.value.replace(/_/g, '-') === g ||
      item.items.some((opt) => opt.value === g || opt.value.startsWith(`${g}.`)),
  )
  return idx >= 0 ? idx : BLOCK_LOGIC_GROUPS.length
}
