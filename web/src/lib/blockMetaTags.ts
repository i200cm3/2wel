export type TagOption = {
  value: string
  label: string
}

export const AUDIENCE_TAG_OPTIONS: TagOption[] = [
  { value: 'solo', label: 'Один' },
  { value: 'couple', label: 'Пара' },
  { value: 'family', label: 'Семья' },
  { value: 'senior', label: 'Старшие гости' },
]

/** Категории номера для mock summary / amo (`room`, `{room}`). */
export const ROOM_TAG_OPTIONS: TagOption[] = [
  { value: 'standard', label: 'Стандарт' },
  { value: 'superior', label: 'Superior' },
  { value: 'deluxe', label: 'Deluxe' },
  { value: 'luxury', label: 'Люкс' },
  { value: 'single', label: 'Одноместный' },
  { value: 'double', label: 'Двухместный' },
  { value: 'family', label: 'Семейный' },
  { value: 'quiet', label: 'Тихий номер' },
  { value: 'view', label: 'С видом' },
  { value: 'near-medical', label: 'Близко к лечебной базе' },
  { value: 'comfort', label: 'Комфорт проживания' },
]

export const TOPIC_TAG_OPTIONS: TagOption[] = [
  { value: 'intro', label: 'Вступление' },
  { value: 'about', label: 'Об объекте' },
  { value: 'room', label: 'Номера' },
  { value: 'treatment', label: 'Лечение' },
  { value: 'food', label: 'Питание' },
  { value: 'territory', label: 'Территория' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'leisure', label: 'Досуг' },
  { value: 'family', label: 'Семья' },
  { value: 'couple', label: 'Пара' },
  { value: 'senior', label: 'Старшие гости' },
  { value: 'location', label: 'Локация / дорога' },
  { value: 'price', label: 'Цена и ценность' },
  { value: 'trust', label: 'Доверие' },
  { value: 'purpose', label: 'Цель поездки' },
  { value: 'next-step', label: 'Следующий шаг' },
  { value: 'cta', label: 'Призыв к действию' },
]

export const OBJECTION_TAG_OPTIONS: TagOption[] = [
  { value: 'price', label: 'Цена' },
  { value: 'expensive', label: 'Дорого' },
  { value: 'distance', label: 'Дорога / удалённость' },
  { value: 'treatment-fit', label: 'Подойдёт ли лечение' },
  { value: 'room-fit', label: 'Подойдёт ли номер' },
  { value: 'food-fit', label: 'Подойдёт ли питание' },
  { value: 'family-fit', label: 'Удобно ли с семьёй' },
  { value: 'uncertainty', label: 'Неопределённость' },
  { value: 'compare-competitor', label: 'Сравнение с конкурентом' },
  { value: 'dates-not-fixed', label: 'Даты не определены' },
]

export function tagOptionsFromValues(values: string[], catalog: TagOption[]): TagOption[] {
  const byValue = new Map(catalog.map((item) => [item.value, item]))
  return values.map((value) => byValue.get(value) ?? { value, label: value })
}
