import {
  defaultBlockMeta,
  isBlockEnabled,
  listMenus,
  sequenceDuration,
  type AssemblyFillRemaining,
  type PropertyConfig,
} from '../types/story.ts'
import {
  guestSummaryFieldLabel,
  missingRequiredGuestFields,
  normalizeGuestSummaryFieldKey,
} from './guestSummaryFields.ts'

export type GuestSummary = {
  guestName: string
  dates: string
  partyType: string
  topics: string
  objections: string
  confidence: string
  room: string
  /** Дожим непокрытых тем в оставшийся бюджет autoplay (параметр выдачи / mock). */
  fillRemaining?: AssemblyFillRemaining
  customFields?: Record<string, string>
}

export type AssemblyPlacement = 'flow' | 'menu' | 'none'

export type AssemblyEntry = {
  id: string
  label: string
  included: boolean
  score: number
  reason: string
  durationSec: number
  placement: AssemblyPlacement
}

type ScoredAssemblyEntry = AssemblyEntry & {
  group: string
  subgroup: string
  topicHits: string[]
  objectionHits: string[]
  audienceHit: boolean
  /** Блок размечен под конкретную аудиторию (family/couple/…) — не для cold-start. */
  hasAudienceTags: boolean
  priority: number
}

type AssemblySlot = {
  limit: number
  predicate: (entry: ScoredAssemblyEntry) => boolean
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function placementForId(config: PropertyConfig, sequenceId: string): AssemblyPlacement {
  if (config.flow.includes(sequenceId)) return 'flow'
  for (const menu of listMenus(config)) {
    if (menu.branches.some((branch) => branch.sequenceId === sequenceId)) return 'menu'
  }
  return 'none'
}

export function normalizeGuestSummary(input: Partial<GuestSummary> & { guestName?: string }): GuestSummary {
  const customFields =
    input.customFields && typeof input.customFields === 'object'
      ? Object.fromEntries(
          Object.entries(input.customFields)
            .map(([key, value]) => [normalizeGuestSummaryFieldKey(key), String(value ?? '').trim()] as const)
            .filter(([, value]) => value.length > 0),
        )
      : undefined
  const fillRaw = String(input.fillRemaining ?? '')
    .trim()
    .toLowerCase()
  const fillRemaining: AssemblyFillRemaining =
    fillRaw === 'soft' || fillRaw === 'aggressive' ? fillRaw : 'off'
  return {
    guestName: String(input.guestName ?? '').trim(),
    dates: String(input.dates ?? '').trim(),
    partyType: String(input.partyType ?? '').trim().toLowerCase(),
    topics: String(input.topics ?? '').trim(),
    objections: String(input.objections ?? '').trim(),
    confidence: String(input.confidence ?? '0.8').trim() || '0.8',
    room: String(input.room ?? '').trim(),
    fillRemaining,
    ...(customFields && Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function isAdaptiveAssemblyEnabled(config: PropertyConfig): boolean {
  const rules = config.constructorV2?.assembly
  const mode = rules?.mode ?? config.constructorV2?.mode ?? 'fixed'
  return rules?.enabled === true && mode === 'adaptive'
}

export function simulateAssembly(config: PropertyConfig, summary: GuestSummary): AssemblyEntry[] {
  const metaById = config.constructorV2?.sequenceMetaById ?? {}
  const mode = config.constructorV2?.assembly.mode ?? config.constructorV2?.mode ?? 'fixed'
  const rules = config.constructorV2?.assembly
  const topics = parseCsv(summary.topics)
  const objections = parseCsv(summary.objections)
  const confidence = Math.min(1, Math.max(0, Number(summary.confidence) || 0))
  const partyType = summary.partyType.trim().toLowerCase()
  const entries = Object.values(config.sequences).map((sequence) => {
    const meta = metaById[sequence.id] ?? defaultBlockMeta()
    const placement = placementForId(config, sequence.id)
    let score = meta.priority
    const reasons: string[] = []
    const topicHits = meta.topicTags.filter((tag) => topics.includes(tag.toLowerCase()))
    const objectionHits = meta.objectionTags.filter((tag) => objections.includes(tag.toLowerCase()))
    const audienceHit = partyType && meta.audienceTags.some((tag) => tag.toLowerCase() === partyType)
    if (topicHits.length) {
      score += topicHits.length * 3
      reasons.push(`темы: ${topicHits.join(', ')}`)
    }
    if (objectionHits.length) {
      score += objectionHits.length * 4
      reasons.push(`возражения: ${objectionHits.join(', ')}`)
    }
    if (audienceHit) {
      score += 2
      reasons.push(`аудитория: ${partyType}`)
    }
    if (meta.menuOnly) {
      score -= 99
      reasons.push('menu-only')
    }
    if (meta.enabled === false) {
      score -= 999
      reasons.push('выключен')
    }
    if (!meta.autoplayEligible) {
      score -= 50
      reasons.push('autoplay выключен')
    }
    const missingFields = missingRequiredGuestFields(summary, meta.requiresFields)
    if (missingFields.length) {
      score -= 999
      reasons.push(`нет параметров: ${missingFields.map(guestSummaryFieldLabel).join(', ')}`)
    }
    if (confidence < 0.45 && rules?.lowConfidenceBehavior === 'exclude') {
      score -= 20
      reasons.push('низкая уверенность')
    }
    if (confidence < 0.45 && rules?.lowConfidenceBehavior === 'menu') {
      score -= 8
      reasons.push('в меню при низкой уверенности')
    }
    return {
      id: sequence.id,
      label: sequence.label,
      durationSec: sequenceDuration(sequence),
      score,
      reason: reasons.join(' · '),
      placement,
      included: false,
      group: meta.group.trim().toLowerCase(),
      subgroup: String(meta.subgroup ?? '').trim().toLowerCase(),
      topicHits,
      objectionHits,
      audienceHit: Boolean(audienceHit),
      hasAudienceTags: meta.audienceTags.length > 0,
      priority: meta.priority,
    }
  })

  if (!rules?.enabled || mode === 'fixed') {
    const flowSet = new Set(config.flow)
    return entries
      .map((entry) => ({
        ...entry,
        included: flowSet.has(entry.id) && isBlockEnabled(config, entry.id),
        reason: !isBlockEnabled(config, entry.id)
          ? 'блок выключен'
          : flowSet.has(entry.id)
            ? 'фиксированный flow шаблона'
            : 'вне фиксированного flow',
      }))
      .sort((a, b) => Number(b.included) - Number(a.included) || config.flow.indexOf(a.id) - config.flow.indexOf(b.id))
  }

  const ordered = deriveAdaptiveFlowIds(config, entries, rules, {
    topics,
    objections,
    partyType,
    fillRemaining: summary.fillRemaining ?? 'off',
  })
  return entries
    .map((entry) => ({
      ...entry,
      included: ordered.includes(entry.id),
      reason: ordered.includes(entry.id)
        ? entry.reason
          ? `вошёл в autoplay · ${entry.reason}`
          : ''
        : entry.reason,
    }))
    .sort((a, b) => {
      const ai = ordered.indexOf(a.id)
      const bi = ordered.indexOf(b.id)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      return b.score - a.score || a.label.localeCompare(b.label, 'ru')
    })
}

function alwaysEndFamilyKey(entry: ScoredAssemblyEntry): string {
  const group = entry.group.trim().toLowerCase()
  if (group === 'cta') return 'cta'
  if (entry.id.startsWith('cta_') || /(^|_)cta($|_)/.test(entry.id)) return 'cta'
  return group || entry.id
}

/**
 * Взаимоисключающие opening-intro: intro_* / intro ↔ by-dates.
 * greeting_* и прочие alwaysStart не схлопываем, даже если group=intro.
 */
function alwaysStartFamilyKey(entry: ScoredAssemblyEntry): string {
  const id = entry.id
  const subgroup = entry.subgroup.trim().toLowerCase()
  if (
    subgroup === 'by-dates' ||
    id === 'intro' ||
    id.startsWith('intro_') ||
    id.includes('by_dates') ||
    id.includes('by-dates')
  ) {
    return 'intro-opening'
  }
  return id
}

/** alwaysStart: score>0; для intro — не больше одного opening (с датами / без). */
function pickAlwaysStartIds(
  alwaysStartIds: string[],
  findEntry: (id: string) => ScoredAssemblyEntry | undefined,
): string[] {
  const eligible = alwaysStartIds
    .map((id) => findEntry(id))
    .filter((entry): entry is ScoredAssemblyEntry => Boolean(entry && entry.score > 0))
    .sort(compareAssemblyEntries)
  const bestByFamily = new Map<string, string>()
  for (const entry of eligible) {
    const key = alwaysStartFamilyKey(entry)
    if (!bestByFamily.has(key)) bestByFamily.set(key, entry.id)
  }
  const chosen = new Set(bestByFamily.values())
  return alwaysStartIds.filter((id) => chosen.has(id))
}

/** alwaysEnd: score>0 и не больше одного блока на «семью» (cta с именем / без имени). */
function pickAlwaysEndIds(
  alwaysEndIds: string[],
  findEntry: (id: string) => ScoredAssemblyEntry | undefined,
): string[] {
  const eligible = alwaysEndIds
    .map((id) => findEntry(id))
    .filter((entry): entry is ScoredAssemblyEntry => Boolean(entry && entry.score > 0))
    .sort(compareAssemblyEntries)
  const bestByFamily = new Map<string, string>()
  for (const entry of eligible) {
    const key = alwaysEndFamilyKey(entry)
    if (!bestByFamily.has(key)) bestByFamily.set(key, entry.id)
  }
  const chosen = new Set(bestByFamily.values())
  return alwaysEndIds.filter((id) => chosen.has(id))
}

function deriveAdaptiveFlowIds(
  config: PropertyConfig,
  entries: ScoredAssemblyEntry[],
  rules: NonNullable<PropertyConfig['constructorV2']>['assembly'],
  summary: {
    topics: string[]
    objections: string[]
    partyType: string
    fillRemaining: AssemblyFillRemaining
  },
): string[] {
  const maxSec = rules.maxAutoplaySec
  const maxBlocks = rules.maxBlocks
  const alwaysStartListed = rules.alwaysStartIds.filter((id) => config.sequences[id] && isBlockEnabled(config, id))
  const findEntry = (id: string) => entries.find((item) => item.id === id)
  const alwaysStart = pickAlwaysStartIds(alwaysStartListed, findEntry)
  const alwaysEnd = rules.alwaysEndIds.filter(
    (id) => config.sequences[id] && isBlockEnabled(config, id) && !alwaysStart.includes(id),
  )
  const ordered: string[] = []
  let usedSec = 0

  const alwaysEndEligible = pickAlwaysEndIds(alwaysEnd, findEntry)
  const alwaysEndSec = alwaysEndEligible.reduce((sum, id) => sum + (findEntry(id)?.durationSec ?? 0), 0)

  const hasTopicInput = summary.topics.length > 0
  const hasObjectionInput = summary.objections.length > 0
  const hasAudienceInput = summary.partyType.length > 0
  const wantNextStep = hasTopicInput || hasObjectionInput
  /** Reserve next-step until it is placed so body/fill never land between next-step and CTA. */
  let nextStepPending = wantNextStep

  const bestNextStep = () =>
    entries
      .filter(
        (entry) =>
          entry.group === 'next-step' &&
          entry.score > 0 &&
          !alwaysStart.includes(entry.id) &&
          !alwaysEnd.includes(entry.id) &&
          !ordered.includes(entry.id),
      )
      .sort(compareAssemblyEntries)[0]

  const tailPendingCount = (forEntry?: { group?: string }) => {
    let count = alwaysEndEligible.filter((id) => !ordered.includes(id)).length
    if (nextStepPending && forEntry?.group !== 'next-step' && bestNextStep()) count += 1
    return count
  }
  const tailPendingSec = (forEntry?: { group?: string }) => {
    let sec = alwaysEndSec
    if (nextStepPending && forEntry?.group !== 'next-step') {
      sec += bestNextStep()?.durationSec ?? 0
    }
    return sec
  }

  const canFit = (entry: { id: string; durationSec: number; group?: string }, reserveTail = false) => {
    if (ordered.includes(entry.id)) return false
    if (!isBlockEnabled(config, entry.id)) return false
    const reservedCount = reserveTail ? tailPendingCount(entry) : 0
    if (ordered.length + reservedCount >= maxBlocks) return false
    const reservedSec = reserveTail ? tailPendingSec(entry) : 0
    if (usedSec + entry.durationSec + reservedSec > maxSec && ordered.length > 0) return false
    return true
  }
  const pushIfFits = (id: string, reserveTail = false) => {
    const entry = findEntry(id)
    if (!entry || !canFit(entry, reserveTail)) return false
    ordered.push(id)
    usedSec += entry.durationSec
    return true
  }

  alwaysStart.forEach((id) => {
    const entry = findEntry(id)
    if (entry && entry.score > 0) pushIfFits(id)
  })

  const candidates = entries
    .filter((entry) => !alwaysStart.includes(entry.id) && !alwaysEnd.includes(entry.id))
    .filter((entry) => entry.score > 0)
    .sort(compareAssemblyEntries)
  const selectedGroups = new Set<string>()
  const selectedSubgroups = new Set<string>()

  const pushCandidate = (entry: ScoredAssemblyEntry) => {
    if (!pushIfFits(entry.id, true)) return false
    if (entry.group) selectedGroups.add(entry.group)
    if (entry.subgroup) selectedSubgroups.add(`${entry.group}.${entry.subgroup}`)
    if (entry.group === 'next-step') nextStepPending = false
    return true
  }

  const selectSlot = (slot: AssemblySlot) => {
    let used = 0
    for (const entry of candidates) {
      if (used >= slot.limit) return
      if (ordered.includes(entry.id)) continue
      if (!slot.predicate(entry)) continue
      if (pushCandidate(entry)) used += 1
    }
  }

  const isColdStart = !hasTopicInput && !hasAudienceInput && !hasObjectionInput
  const primaryTopicLimit = hasTopicInput ? (hasAudienceInput && hasObjectionInput ? 1 : 2) : 1
  const objectionLimit = hasObjectionInput ? (maxBlocks <= 7 ? 1 : 2) : 0
  const isPrimaryTopicBlock = (entry: ScoredAssemblyEntry) =>
    entry.topicHits.some((tag) => !['intro', 'cta', 'next-step'].includes(tag)) &&
    !['intro', 'objection', 'objections', 'purpose', 'next-step', 'cta'].includes(entry.group)

  const selectPrimaryTopics = () => {
    let used = 0
    const orderedTopics = summary.topics.filter((tag) => !['intro', 'cta', 'next-step'].includes(tag))
    for (const topic of orderedTopics) {
      if (used >= primaryTopicLimit) return
      const entry = candidates
        .filter(
          (item) =>
            !ordered.includes(item.id) &&
            isPrimaryTopicBlock(item) &&
            item.topicHits.includes(topic) &&
            !selectedGroups.has(item.group),
        )
        .sort((a, b) => comparePrimaryTopicEntries(topic, a, b))[0]
      if (entry && pushCandidate(entry)) used += 1
    }
    if (used < primaryTopicLimit) {
      selectSlot({
        limit: primaryTopicLimit - used,
        predicate: (entry) => isPrimaryTopicBlock(entry) && !selectedGroups.has(entry.group),
      })
    }
  }

  if (isColdStart) {
    selectColdStartOverview({
      candidates,
      ordered,
      selectedGroups,
      selectedSubgroups,
      pushCandidate,
      maxBlocks,
      alwaysEndPending: () => tailPendingCount(),
    })
  } else {
    const openingSlots: AssemblySlot[] = [
      {
        limit: hasAudienceInput ? 1 : 0,
        predicate: (entry) =>
          entry.audienceHit && !['next-step', 'cta', 'objection', 'objections'].includes(entry.group),
      },
      {
        limit: hasTopicInput ? 1 : 0,
        predicate: (entry) => entry.group === 'purpose' && entry.topicHits.includes('purpose'),
      },
    ]

    /** Body closing only — next-step is selected after fill so CTA stays adjacent. */
    const bodyClosingSlots: AssemblySlot[] = [
      {
        limit: objectionLimit,
        predicate: (entry) =>
          entry.objectionHits.length > 0 && ['objection', 'objections'].includes(entry.group),
      },
      {
        limit: 1,
        predicate: (entry) =>
          (entry.topicHits.length > 0 || entry.audienceHit || entry.objectionHits.length > 0) &&
          !selectedGroups.has(entry.group) &&
          !['intro', 'purpose', 'next-step', 'cta'].includes(entry.group),
      },
    ]

    openingSlots.forEach(selectSlot)
    selectPrimaryTopics()
    bodyClosingSlots.forEach(selectSlot)

    for (const entry of candidates) {
      if (ordered.length + tailPendingCount(entry) >= maxBlocks) break
      if (ordered.includes(entry.id)) continue
      if (['intro', 'purpose', 'next-step', 'cta'].includes(entry.group)) continue
      if (!entry.topicHits.length && !entry.objectionHits.length && !entry.audienceHit) {
        continue
      }
      if (selectedGroups.has(entry.group)) continue
      if (selectedSubgroups.has(`${entry.group}.${entry.subgroup}`)) continue
      pushCandidate(entry)
    }
  }

  fillUncoveredGroups({
    mode: summary.fillRemaining ?? 'off',
    candidates: isColdStart ? candidates.filter(isColdStartEligibleBlock) : candidates,
    ordered,
    selectedGroups,
    selectedSubgroups,
    pushCandidate,
    maxBlocks,
    alwaysEndPending: () => tailPendingCount(),
  })

  if (wantNextStep) {
    selectSlot({
      limit: 1,
      predicate: (entry) => entry.group === 'next-step',
    })
    nextStepPending = false
  }

  alwaysEndEligible.forEach((id) => pushIfFits(id))
  return ordered
}

/** Группы, которыми безопасно дожимать autoplay, если про них ещё не говорили. */
const FILL_GROUP_ORDER = [
  'treatment',
  'food',
  'wellness',
  'leisure',
  'territory',
  'location',
  'about',
  'trust',
  'price',
  'price_value',
] as const

const FILL_GROUP_RANK: Map<string, number> = new Map(
  FILL_GROUP_ORDER.map((group, index) => [group, index]),
)

/** Обзорная витрина, когда о госте почти ничего не известно (только имя / пустые сигналы). */
const COLD_START_GROUP_ORDER = [
  'about',
  'territory',
  'treatment',
  'food',
  'rooms',
  'wellness',
  'leisure',
  'location',
  'trust',
  'price',
  'price_value',
] as const

const COLD_START_GROUP_RANK: Map<string, number> = new Map(
  COLD_START_GROUP_ORDER.map((group, index) => [group, index]),
)

const COLD_START_EXCLUDED_GROUPS = new Set([
  'intro',
  'purpose',
  'objection',
  'objections',
  'next-step',
  'cta',
  'family',
  'couple',
  'senior',
])

const SOFT_FILL_MAX_EXTRA = 3

function isFillEligibleGroup(group: string): boolean {
  return FILL_GROUP_RANK.has(group)
}

function isNicheColdStartSubgroup(subgroup: string): boolean {
  const value = subgroup.trim().toLowerCase()
  if (!value) return false
  return value.startsWith('profile-') || value.startsWith('season-') || value === 'family'
}

function isColdStartEligibleBlock(entry: ScoredAssemblyEntry): boolean {
  if (entry.score <= 0) return false
  if (entry.hasAudienceTags) return false
  if (COLD_START_EXCLUDED_GROUPS.has(entry.group)) return false
  if (!COLD_START_GROUP_RANK.has(entry.group)) return false
  if (isNicheColdStartSubgroup(entry.subgroup)) return false
  return true
}

/** Тело autoplay при пустых partyType/topics/objections — нейтральный обзор места. */
function selectColdStartOverview(args: {
  candidates: ScoredAssemblyEntry[]
  ordered: string[]
  selectedGroups: Set<string>
  selectedSubgroups: Set<string>
  pushCandidate: (entry: ScoredAssemblyEntry) => boolean
  maxBlocks: number
  alwaysEndPending: () => number
}): void {
  const { candidates, ordered, selectedGroups, selectedSubgroups, pushCandidate, maxBlocks, alwaysEndPending } =
    args

  for (const group of COLD_START_GROUP_ORDER) {
    if (ordered.length + alwaysEndPending() >= maxBlocks) return
    if (selectedGroups.has(group)) continue
    const entry = candidates
      .filter(
        (item) =>
          item.group === group &&
          isColdStartEligibleBlock(item) &&
          !ordered.includes(item.id) &&
          !selectedSubgroups.has(`${item.group}.${item.subgroup}`),
      )
      .sort(compareAssemblyEntries)[0]
    if (!entry) continue
    if (pushCandidate(entry)) {
      entry.reason = entry.reason ? `${entry.reason} · обзор` : 'обзор при пустых параметрах'
    }
  }
}

function fillUncoveredGroups(args: {
  mode: 'off' | 'soft' | 'aggressive'
  candidates: ScoredAssemblyEntry[]
  ordered: string[]
  selectedGroups: Set<string>
  selectedSubgroups: Set<string>
  pushCandidate: (entry: ScoredAssemblyEntry) => boolean
  maxBlocks: number
  alwaysEndPending: () => number
}): void {
  const { mode, candidates, ordered, selectedGroups, selectedSubgroups, pushCandidate, maxBlocks, alwaysEndPending } =
    args
  if (mode === 'off') return

  const maxExtra = mode === 'soft' ? SOFT_FILL_MAX_EXTRA : Number.POSITIVE_INFINITY
  let filled = 0

  const fillCandidates = candidates
    .filter(
      (entry) =>
        !ordered.includes(entry.id) &&
        isFillEligibleGroup(entry.group) &&
        !selectedGroups.has(entry.group) &&
        !selectedSubgroups.has(`${entry.group}.${entry.subgroup}`) &&
        entry.score > 0,
    )
    .sort((a, b) => {
      const rankDiff = (FILL_GROUP_RANK.get(a.group) ?? 99) - (FILL_GROUP_RANK.get(b.group) ?? 99)
      if (rankDiff) return rankDiff
      return compareAssemblyEntries(a, b)
    })

  for (const entry of fillCandidates) {
    if (filled >= maxExtra) break
    if (ordered.length + alwaysEndPending() >= maxBlocks) break
    if (selectedGroups.has(entry.group)) continue
    if (pushCandidate(entry)) {
      entry.reason = entry.reason ? `${entry.reason} · дожим` : 'дожим непокрытой темы'
      filled += 1
    }
  }
}

function compareAssemblyEntries(a: ScoredAssemblyEntry, b: ScoredAssemblyEntry): number {
  const scoreDiff = b.score - a.score
  if (scoreDiff) return scoreDiff
  const hitDiff =
    b.objectionHits.length - a.objectionHits.length ||
    Number(b.audienceHit) - Number(a.audienceHit) ||
    b.topicHits.length - a.topicHits.length
  if (hitDiff) return hitDiff
  const priorityDiff = b.priority - a.priority
  if (priorityDiff) return priorityDiff
  return a.id.localeCompare(b.id, 'ru')
}

function comparePrimaryTopicEntries(topic: string, a: ScoredAssemblyEntry, b: ScoredAssemblyEntry): number {
  const exactTopicDiff = Number(b.group === topic || b.subgroup === topic) - Number(a.group === topic || a.subgroup === topic)
  if (exactTopicDiff) return exactTopicDiff
  const audienceDiff = Number(b.audienceHit) - Number(a.audienceHit)
  if (audienceDiff) return audienceDiff
  const priorityDiff = b.priority - a.priority
  if (priorityDiff) return priorityDiff
  return compareAssemblyEntries(a, b)
}

export function deriveFlowIds(config: PropertyConfig, summary: GuestSummary): string[] {
  const enabledFlow = () => config.flow.filter((id) => config.sequences[id] && isBlockEnabled(config, id))
  if (!isAdaptiveAssemblyEnabled(config)) {
    return enabledFlow()
  }
  const simulation = simulateAssembly(config, summary)
  const derived = simulation.filter((entry) => entry.included).map((entry) => entry.id)
  return derived.length ? derived : enabledFlow()
}

export function applyDerivedFlow(config: PropertyConfig, flowIds: string[]): PropertyConfig {
  const flow = flowIds.filter((id) => config.sequences[id])
  if (!flow.length) return config
  return { ...config, flow }
}
