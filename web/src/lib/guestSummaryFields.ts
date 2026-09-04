import { defaultBlockMeta, type PropertyConfig, type StorySequence } from '../types/story.ts'
import type { GuestSummary } from './assembly.ts'
import type { TagOption } from './blockMetaTags.ts'

/** Плейсхолдеры в title / титрах / TTS, которые приходят из amo. */
export const GUEST_SUBSTITUTION_PLACEHOLDERS = ['{name}', '{room}', '{dates}'] as const

/** Плейсхолдеры из карточки объекта — не требуют amo. */
export const BRAND_SUBSTITUTION_PLACEHOLDERS = ['{brand}', '{phone}', '{tel}', '{telegram}', '{max}'] as const

export const GUEST_SUBSTITUTION_HINT =
  'Подстановки из amo: {name}, {room}, {dates}. Из карточки объекта: {brand}, {phone}, {tel}, {telegram}, {max}.'

export const GUEST_ASSEMBLY_FIELDS_HINT =
  'Для сборки передайте: name, room, dates, partyType, topics, objections; опционально fillRemaining (off|soft|aggressive). В тексте блока: {name}, {room}, {dates}.'

/** Поля summary гостя, которые могут прийти из amo и участвуют в сборке. */
export const GUEST_SUMMARY_FIELD_OPTIONS: TagOption[] = [
  { value: 'name', label: 'Имя ({name})' },
  { value: 'dates', label: 'Даты ({dates})' },
  { value: 'partyType', label: 'Тип компании' },
  { value: 'room', label: 'Номер / категория ({room})' },
  { value: 'topics', label: 'Темы интереса' },
  { value: 'objections', label: 'Возражения' },
]

const PLACEHOLDER_TO_FIELD: Record<string, string> = {
  name: 'name',
  room: 'room',
  dates: 'dates',
}

export function normalizeGuestSummaryFieldKey(field: string): string {
  const key = field.trim().toLowerCase()
  if (key === 'name' || key === 'guestname') return 'name'
  if (key === 'partytype') return 'partyType'
  return key
}

export function guestSummaryFieldLabel(field: string): string {
  const key = normalizeGuestSummaryFieldKey(field)
  return GUEST_SUMMARY_FIELD_OPTIONS.find((item) => item.value === key)?.label ?? key
}

export function getGuestSummaryFieldValue(summary: GuestSummary, field: string): string {
  const key = normalizeGuestSummaryFieldKey(field)
  switch (key) {
    case 'name':
      return summary.guestName
    case 'dates':
      return summary.dates
    case 'partyType':
      return summary.partyType
    case 'topics':
      return summary.topics
    case 'objections':
      return summary.objections
    case 'room':
      return summary.room
    default:
      return summary.customFields?.[key] ?? ''
  }
}

export function isGuestSummaryFieldPresent(summary: GuestSummary, field: string): boolean {
  return getGuestSummaryFieldValue(summary, field).trim().length > 0
}

export function missingRequiredGuestFields(summary: GuestSummary, requiresFields: string[]): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const field of requiresFields) {
    const key = normalizeGuestSummaryFieldKey(field)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (!isGuestSummaryFieldPresent(summary, key)) missing.push(key)
  }
  return missing
}

export function placeholdersInSequence(sequence: StorySequence): string[] {
  const parts: string[] = []
  if (sequence.title) parts.push(sequence.title)
  for (const cue of sequence.cues ?? []) {
    if (cue.text) parts.push(cue.text)
    if (cue.ttsText) parts.push(cue.ttsText)
  }
  const keys = new Set<string>()
  for (const part of parts) {
    for (const match of part.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)) {
      keys.add(match[1].toLowerCase())
    }
  }
  return [...keys]
}

export function requiresFieldsFromPlaceholders(placeholders: string[]): string[] {
  const fields: string[] = []
  for (const placeholder of placeholders) {
    const mapped = PLACEHOLDER_TO_FIELD[placeholder]
    if (mapped) fields.push(mapped)
  }
  return [...new Set(fields)]
}

export function requiresFieldsFromSequence(sequence: StorySequence): string[] {
  return requiresFieldsFromPlaceholders(placeholdersInSequence(sequence))
}

const catalogFieldKeys = () =>
  new Set(GUEST_SUMMARY_FIELD_OPTIONS.map((item) => normalizeGuestSummaryFieldKey(item.value)))

/** Синхронизирует requiresFields: поля из текста блока + вручную добавленные вне текста. */
export function syncedRequiresFields(sequence: StorySequence, current: string[]): string[] {
  const fromText = requiresFieldsFromSequence(sequence).map(normalizeGuestSummaryFieldKey)
  const fromTextSet = new Set(fromText)
  const catalog = catalogFieldKeys()
  const manual = current
    .map(normalizeGuestSummaryFieldKey)
    .filter((key) => !catalog.has(key) || !fromTextSet.has(key))
  return [...new Set([...fromText, ...manual])]
}

export function syncRequiresFieldsInConfig(config: PropertyConfig): PropertyConfig {
  if (!config.constructorV2) return config
  const metaById = { ...config.constructorV2.sequenceMetaById }
  let changed = false
  for (const id of Object.keys(config.sequences)) {
    const sequence = config.sequences[id]
    if (!sequence) continue
    const meta = metaById[id] ?? defaultBlockMeta()
    const synced = syncedRequiresFields(sequence, meta.requiresFields)
    const prev = meta.requiresFields.map(normalizeGuestSummaryFieldKey).sort().join('|')
    const next = synced.map(normalizeGuestSummaryFieldKey).sort().join('|')
    if (prev !== next) {
      metaById[id] = { ...meta, requiresFields: synced }
      changed = true
    }
  }
  if (!changed) return config
  return {
    ...config,
    constructorV2: {
      ...config.constructorV2,
      sequenceMetaById: metaById,
    },
  }
}
