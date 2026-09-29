export const INTENT_LABELS: Record<string, string> = {
  booking: 'Бронь',
  pricing: 'Цены',
  treatment: 'Лечение',
  paid_medical: 'Платные медуслуги',
  transfer: 'Трансфер',
  documents: 'Документы',
  complaint: 'Жалоба',
  returning: 'Повторный',
  queue: 'Информационный звонок',
  other: 'Другое',
  none: 'Без типа',
}

export const DECLINE_LABELS: Record<string, string> = {
  price: 'Дорого',
  dates_full: 'Нет мест',
  comparing: 'Другой объект',
  family: 'Семья',
  voucher: 'Путёвка',
  think: 'Подумает',
  other: 'Другой отказ',
  none: 'Не озвучили причину',
}

export const TOPIC_LABELS: Record<string, string> = {
  food: 'Питание',
  procedures: 'Процедуры',
  kids: 'Дети',
  pets: 'Животные',
  parking: 'Парковка',
  wifi: 'Wi‑Fi',
  location: 'Локация',
  pool: 'Бассейн',
  arrival: 'Заезд / прибытие',
  cancellation: 'Аннуляция',
  payment: 'Оплата',
  other: 'Другое',
}

export const SOURCE_LABELS: Record<string, string> = {
  referral: 'По рекомендации',
  site: 'Сайт',
  tour: 'Туроператор',
  other: 'Другое',
}

export function intentLabel(intent: string | null | undefined) {
  if (!intent) return null
  return INTENT_LABELS[intent] || intent
}

export function declineLabel(reason: string | null | undefined) {
  if (!reason) return null
  return DECLINE_LABELS[reason] || reason
}

export function sourceLabel(source: string | null | undefined) {
  if (!source) return null
  return SOURCE_LABELS[source] || source
}

export function topicLabel(topic: string | null | undefined) {
  if (!topic) return null
  return TOPIC_LABELS[topic] || topic
}
