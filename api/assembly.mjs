function normalizeFieldKey(field) {
  const key = String(field ?? '')
    .trim()
    .toLowerCase()
  if (key === 'name' || key === 'guestname') return 'name'
  if (key === 'partytype') return 'partyType'
  return key
}

function guestFieldValue(summary, field) {
  const key = normalizeFieldKey(field)
  if (key === 'name') return String(summary.guestName ?? '').trim()
  if (key === 'dates') return String(summary.dates ?? '').trim()
  if (key === 'partyType') return String(summary.partyType ?? '').trim()
  if (key === 'topics') return String(summary.topics ?? '').trim()
  if (key === 'objections') return String(summary.objections ?? '').trim()
  if (key === 'room') return String(summary.room ?? '').trim()
  return String(summary.customFields?.[key] ?? '').trim()
}

const FIELD_LABELS = {
  name: 'Имя ({name})',
  dates: 'Даты ({dates})',
  partyType: 'Тип компании',
  room: 'Номер / категория ({room})',
  topics: 'Темы интереса',
  objections: 'Возражения',
}

function fieldLabel(field) {
  const key = normalizeFieldKey(field)
  return FIELD_LABELS[key] ?? key
}

function missingRequiredFields(summary, requiresFields) {
  const list = Array.isArray(requiresFields) ? requiresFields : []
  const missing = []
  const seen = new Set()
  for (const field of list) {
    const key = normalizeFieldKey(field)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (!guestFieldValue(summary, key)) missing.push(key)
  }
  return missing
}

function listMenus(config) {
  const menus = config?.menus && typeof config.menus === 'object' ? Object.values(config.menus) : []
  if (menus.length) return menus
  if (Array.isArray(config?.branches)) return [{ branches: config.branches }]
  return []
}

function placementForId(config, sequenceId) {
  const flow = Array.isArray(config?.flow) ? config.flow : []
  if (flow.includes(sequenceId)) return 'flow'
  for (const menu of listMenus(config)) {
    const branches = Array.isArray(menu?.branches) ? menu.branches : []
    if (branches.some((branch) => branch?.sequenceId === sequenceId)) return 'menu'
  }
  return 'none'
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function clipHoldSec(clip) {
  return Math.max(0.8, Number(clip?.durationSec) || 0)
}

function sequenceDuration(seq) {
  const clips = Array.isArray(seq?.clips) ? seq.clips : []
  return clips.reduce((sum, clip) => sum + clipHoldSec(clip), 0)
}

function defaultBlockMeta() {
  return {
    group: '',
    enabled: true,
    autoplayEligible: true,
    menuOnly: false,
    priority: 3,
    durationClass: 'medium',
    audienceTags: [],
    topicTags: [],
    objectionTags: [],
    requiresFields: [],
    slotFields: [],
  }
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean)
}

function normalizeBlockMeta(value) {
  const meta = value && typeof value === 'object' ? value : {}
  const base = defaultBlockMeta()
  return {
    group: typeof meta.group === 'string' ? meta.group.trim().slice(0, 64) : '',
    subgroup: typeof meta.subgroup === 'string' ? meta.subgroup.trim().slice(0, 64) : '',
    enabled: meta.enabled !== false,
    autoplayEligible: meta.autoplayEligible !== false,
    menuOnly: meta.menuOnly === true,
    priority: Math.min(99, Math.max(1, Math.round(Number(meta.priority)) || base.priority)),
    durationClass:
      meta.durationClass === 'short' || meta.durationClass === 'medium' || meta.durationClass === 'long'
        ? meta.durationClass
        : base.durationClass,
    audienceTags: normalizeStringList(meta.audienceTags),
    topicTags: normalizeStringList(meta.topicTags),
    objectionTags: normalizeStringList(meta.objectionTags),
    requiresFields: normalizeStringList(meta.requiresFields),
    slotFields: normalizeStringList(meta.slotFields),
  }
}

export function normalizeGuestSummary(input = {}) {
  const fillRaw = String(input.fillRemaining ?? input.fill_remaining ?? '')
    .trim()
    .toLowerCase()
  const fillRemaining = fillRaw === 'soft' || fillRaw === 'aggressive' ? fillRaw : 'off'
  return {
    guestName: String(input.guestName ?? '').trim(),
    dates: String(input.dates ?? '').trim(),
    partyType: String(input.partyType ?? '').trim().toLowerCase(),
    topics: String(input.topics ?? '').trim(),
    objections: String(input.objections ?? '').trim(),
    confidence: String(input.confidence ?? '0.8').trim() || '0.8',
    room: String(input.room ?? '').trim(),
    fillRemaining,
  }
}

export function isAdaptiveAssemblyEnabled(config) {
  const rules = config?.constructorV2?.assembly
  const mode = rules?.mode ?? config?.constructorV2?.mode ?? 'fixed'
  return rules?.enabled === true && mode === 'adaptive'
}

function isBlockEnabled(config, id) {
  const meta = config?.constructorV2?.sequenceMetaById?.[id]
  return meta?.enabled !== false
}

function hideDisabledBlocks(config) {
  if (!config || typeof config !== 'object') return config
  const sequences = config.sequences ?? {}
  const enabledId = (id) => Boolean(sequences[id]) && isBlockEnabled(config, id)
  const flow = (Array.isArray(config.flow) ? config.flow : []).filter(enabledId)
  const menusSource = config.menus && typeof config.menus === 'object' ? config.menus : null
  if (!menusSource) return { ...config, flow }
  const menus = Object.fromEntries(
    Object.entries(menusSource).map(([id, menu]) => [
      id,
      {
        ...menu,
        branches: Array.isArray(menu?.branches)
          ? menu.branches.filter((branch) => enabledId(branch.sequenceId))
          : [],
      },
    ]),
  )
  const main = menus[config.defaultMenuId] ?? Object.values(menus)[0]
  return { ...config, flow, menus, branches: main?.branches ?? [] }
}

function compareAssemblyEntries(a, b) {
  const scoreDiff = b.score - a.score
  if (scoreDiff) return scoreDiff
  const hitDiff =
    b.objectionHits.length - a.objectionHits.length ||
    Number(b.audienceHit) - Number(a.audienceHit) ||
    b.topicHits.length - a.topicHits.length
  if (hitDiff) return hitDiff
  const priorityDiff = b.priority - a.priority
  if (priorityDiff) return priorityDiff
  return String(a.id).localeCompare(String(b.id), 'ru')
}

function comparePrimaryTopicEntries(topic, a, b) {
  const exactTopicDiff =
    Number(b.group === topic || b.subgroup === topic) - Number(a.group === topic || a.subgroup === topic)
  if (exactTopicDiff) return exactTopicDiff
  const audienceDiff = Number(b.audienceHit) - Number(a.audienceHit)
  if (audienceDiff) return audienceDiff
  const priorityDiff = b.priority - a.priority
  if (priorityDiff) return priorityDiff
  return compareAssemblyEntries(a, b)
}

function alwaysEndFamilyKey(entry) {
  const group = String(entry.group ?? '')
    .trim()
    .toLowerCase()
  if (group === 'cta') return 'cta'
  if (entry.id.startsWith('cta_') || /(^|_)cta($|_)/.test(entry.id)) return 'cta'
  return group || entry.id
}

/**
 * Взаимоисключающие opening-intro: intro_* / intro ↔ by-dates.
 * greeting_* и прочие alwaysStart не схлопываем, даже если group=intro.
 */
function alwaysStartFamilyKey(entry) {
  const id = String(entry.id ?? '')
  const subgroup = String(entry.subgroup ?? '')
    .trim()
    .toLowerCase()
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
function pickAlwaysStartIds(alwaysStartIds, findEntry) {
  const eligible = alwaysStartIds
    .map((id) => findEntry(id))
    .filter((entry) => entry && entry.score > 0)
    .sort(compareAssemblyEntries)
  const bestByFamily = new Map()
  for (const entry of eligible) {
    const key = alwaysStartFamilyKey(entry)
    if (!bestByFamily.has(key)) bestByFamily.set(key, entry.id)
  }
  const chosen = new Set(bestByFamily.values())
  return alwaysStartIds.filter((id) => chosen.has(id))
}

function pickAlwaysEndIds(alwaysEndIds, findEntry) {
  const eligible = alwaysEndIds
    .map((id) => findEntry(id))
    .filter((entry) => entry && entry.score > 0)
    .sort(compareAssemblyEntries)
  const bestByFamily = new Map()
  for (const entry of eligible) {
    const key = alwaysEndFamilyKey(entry)
    if (!bestByFamily.has(key)) bestByFamily.set(key, entry.id)
  }
  const chosen = new Set(bestByFamily.values())
  return alwaysEndIds.filter((id) => chosen.has(id))
}

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
]
const FILL_GROUP_RANK = new Map(FILL_GROUP_ORDER.map((group, index) => [group, index]))
const SOFT_FILL_MAX_EXTRA = 3

function isFillEligibleGroup(group) {
  return FILL_GROUP_RANK.has(group)
}

/**
 * Тело autoplay при пустых partyType/topics/objections — только блоки из assembly.coldStartIds,
 * строго в порядке списка. Явный cold-start важнее menu-only / autoplay / score.
 */
function selectColdStartIds({
  coldStartIds,
  findEntry,
  pushCandidate,
  ordered,
  maxBlocks,
  alwaysEndPending,
  isEnabled,
}) {
  for (const id of coldStartIds) {
    if (ordered.length + alwaysEndPending() >= maxBlocks) return
    if (ordered.includes(id)) continue
    if (!isEnabled(id)) continue
    const entry = findEntry(id)
    if (!entry) continue
    if (pushCandidate(entry)) {
      entry.reason = entry.reason ? `${entry.reason} · cold-start` : 'cold-start'
    } else {
      entry.reason = entry.reason
        ? `${entry.reason} · cold-start: не влез в лимит`
        : 'cold-start: не влез в лимит'
    }
  }
}

function fillUncoveredGroups({
  mode,
  candidates,
  ordered,
  selectedGroups,
  selectedSubgroups,
  pushCandidate,
  maxBlocks,
  alwaysEndPending,
}) {
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

/** Slot-based adaptive flow — mirrors web/src/lib/assembly.ts (Constructor V2). */
function deriveAdaptiveFlowIds(config, entries, rules, summary) {
  const sequences = config?.sequences ?? {}
  const maxSec = Math.max(15, Number(rules?.maxAutoplaySec) || 90)
  const maxBlocks = Math.max(1, Number(rules?.maxBlocks) || 5)
  const alwaysStartListed = (Array.isArray(rules?.alwaysStartIds) ? rules.alwaysStartIds : []).filter(
    (id) => sequences[id] && isBlockEnabled(config, id),
  )
  const findEntry = (id) => entries.find((item) => item.id === id)
  const alwaysStart = pickAlwaysStartIds(alwaysStartListed, findEntry)
  const alwaysEnd = (Array.isArray(rules?.alwaysEndIds) ? rules.alwaysEndIds : []).filter(
    (id) => sequences[id] && isBlockEnabled(config, id) && !alwaysStart.includes(id),
  )
  const ordered = []
  let usedSec = 0

  const alwaysEndEligible = pickAlwaysEndIds(alwaysEnd, findEntry)
  const alwaysEndSec = alwaysEndEligible.reduce((sum, id) => sum + (findEntry(id)?.durationSec ?? 0), 0)

  const hasTopicInput = summary.topics.length > 0
  const hasObjectionInput = summary.objections.length > 0
  const hasAudienceInput = summary.partyType.length > 0
  const wantNextStep = hasTopicInput || hasObjectionInput
  /** Reserve next-step until placed so body/fill never land between next-step and CTA. */
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

  const tailPendingCount = (forEntry) => {
    let count = alwaysEndEligible.filter((id) => !ordered.includes(id)).length
    if (nextStepPending && forEntry?.group !== 'next-step' && bestNextStep()) count += 1
    return count
  }
  const tailPendingSec = (forEntry) => {
    let sec = alwaysEndSec
    if (nextStepPending && forEntry?.group !== 'next-step') {
      sec += bestNextStep()?.durationSec ?? 0
    }
    return sec
  }

  const canFit = (entry, reserveTail = false) => {
    if (ordered.includes(entry.id)) return false
    if (!isBlockEnabled(config, entry.id)) return false
    const reservedCount = reserveTail ? tailPendingCount(entry) : 0
    if (ordered.length + reservedCount >= maxBlocks) return false
    const reservedSec = reserveTail ? tailPendingSec(entry) : 0
    if (usedSec + entry.durationSec + reservedSec > maxSec && ordered.length > 0) return false
    return true
  }

  const pushIfFits = (id, reserveTail = false) => {
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

  const isColdStart = !hasTopicInput && !hasAudienceInput && !hasObjectionInput
  const candidates = entries
    .filter((entry) => !alwaysStart.includes(entry.id) && !alwaysEnd.includes(entry.id))
    .filter((entry) => entry.score > 0)
    .sort(compareAssemblyEntries)
  const selectedGroups = new Set()
  const selectedSubgroups = new Set()

  const pushCandidate = (entry) => {
    if (!pushIfFits(entry.id, true)) return false
    if (entry.group) selectedGroups.add(entry.group)
    if (entry.subgroup) selectedSubgroups.add(`${entry.group}.${entry.subgroup}`)
    if (entry.group === 'next-step') nextStepPending = false
    return true
  }

  const selectSlot = (slot) => {
    let used = 0
    for (const entry of candidates) {
      if (used >= slot.limit) return
      if (ordered.includes(entry.id)) continue
      if (!slot.predicate(entry)) continue
      if (pushCandidate(entry)) used += 1
    }
  }

  const primaryTopicLimit = hasTopicInput ? (hasAudienceInput && hasObjectionInput ? 1 : 2) : 1
  const objectionLimit = hasObjectionInput ? (maxBlocks <= 7 ? 1 : 2) : 0
  const isPrimaryTopicBlock = (entry) =>
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
    const coldStartIds = (Array.isArray(rules?.coldStartIds) ? rules.coldStartIds : []).filter(
      (id) => sequences[id] && isBlockEnabled(config, id) && !alwaysStart.includes(id) && !alwaysEnd.includes(id),
    )
    selectColdStartIds({
      coldStartIds,
      findEntry,
      pushCandidate,
      ordered,
      maxBlocks,
      alwaysEndPending: () => tailPendingCount(),
      isEnabled: (id) => isBlockEnabled(config, id),
    })
  } else {
    const openingSlots = [
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
    const bodyClosingSlots = [
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

  // Cold-start — только явный список; дожим чужих групп не делаем.
  if (!isColdStart) {
    fillUncoveredGroups({
      mode: summary.fillRemaining ?? 'off',
      candidates,
      ordered,
      selectedGroups,
      selectedSubgroups,
      pushCandidate,
      maxBlocks,
      alwaysEndPending: () => tailPendingCount(),
    })
  }

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

function scoreSequenceEntries(config, summary) {
  const sequences = config?.sequences ?? {}
  const metaById = config?.constructorV2?.sequenceMetaById ?? {}
  const rules = config?.constructorV2?.assembly ?? {}
  const topics = parseCsv(summary.topics)
  const objections = parseCsv(summary.objections)
  const confidence = Math.min(1, Math.max(0, Number(summary.confidence) || 0))
  const partyType = String(summary.partyType ?? '').trim().toLowerCase()

  return Object.values(sequences).map((sequence) => {
    const meta = normalizeBlockMeta(metaById[sequence.id])
    let score = meta.priority
    const reasons = []
    const topicHits = meta.topicTags.filter((tag) => topics.includes(tag))
    const objectionHits = meta.objectionTags.filter((tag) => objections.includes(tag))
    const audienceHit = partyType && meta.audienceTags.some((tag) => tag === partyType)
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
    const missing = missingRequiredFields(summary, meta.requiresFields)
    if (missing.length) {
      score -= 999
      reasons.push(`нет параметров: ${missing.map(fieldLabel).join(', ')}`)
    }
    if (confidence < 0.45 && rules.lowConfidenceBehavior === 'exclude') {
      score -= 20
      reasons.push('низкая уверенность')
    }
    if (confidence < 0.45 && rules.lowConfidenceBehavior === 'menu') {
      score -= 8
      reasons.push('в меню при низкой уверенности')
    }
    return {
      id: sequence.id,
      label: String(sequence.label ?? sequence.id),
      score,
      durationSec: sequenceDuration(sequence),
      group: String(meta.group ?? '').trim().toLowerCase(),
      subgroup: String(meta.subgroup ?? '').trim().toLowerCase(),
      topicHits,
      objectionHits,
      audienceHit: Boolean(audienceHit),
      hasAudienceTags: meta.audienceTags.length > 0,
      priority: meta.priority,
      reason: reasons.join(' · '),
      placement: placementForId(config, sequence.id),
    }
  })
}

function adaptiveSummaryContext(summary) {
  return {
    topics: parseCsv(summary.topics),
    objections: parseCsv(summary.objections),
    partyType: String(summary.partyType ?? '').trim().toLowerCase(),
    fillRemaining: summary.fillRemaining ?? 'off',
  }
}

export function deriveFlowIds(config, summary) {
  const sequences = config?.sequences ?? {}
  const flow = Array.isArray(config?.flow) ? config.flow : []
  const enabledFlow = () => flow.filter((id) => sequences[id] && isBlockEnabled(config, id))
  if (!isAdaptiveAssemblyEnabled(config)) {
    return enabledFlow()
  }

  const rules = config?.constructorV2?.assembly ?? {}
  const entries = scoreSequenceEntries(config, summary)
  const derived = deriveAdaptiveFlowIds(config, entries, rules, adaptiveSummaryContext(summary))
  return derived.length ? derived : enabledFlow()
}

/** Компактный audit trail: id, label, included, score, reason, placement. */
export function buildAssemblyTrace(config, summary) {
  const sequences = config?.sequences ?? {}
  const flow = Array.isArray(config?.flow) ? config.flow : []
  const entries = scoreSequenceEntries(config, summary)
  if (!isAdaptiveAssemblyEnabled(config)) {
    const flowSet = new Set(flow)
    return entries
      .map((entry) => {
        const enabled = isBlockEnabled(config, entry.id)
        const included = flowSet.has(entry.id) && enabled
        return {
          id: entry.id,
          label: entry.label,
          included,
          score: entry.score,
          reason: !enabled
            ? 'блок выключен'
            : included
              ? 'фиксированный flow шаблона'
              : 'вне фиксированного flow',
          placement: entry.placement,
        }
      })
      .sort(
        (a, b) =>
          Number(b.included) - Number(a.included) || flow.indexOf(a.id) - flow.indexOf(b.id),
      )
  }

  const rules = config?.constructorV2?.assembly ?? {}
  const ordered = deriveAdaptiveFlowIds(config, entries, rules, adaptiveSummaryContext(summary))
  const orderedSet = new Set(ordered)
  return entries
    .map((entry) => {
      const included = orderedSet.has(entry.id)
      return {
        id: entry.id,
        label: entry.label,
        included,
        score: entry.score,
        reason: included
          ? entry.reason
            ? `вошёл в autoplay · ${entry.reason}`
            : 'вошёл в autoplay'
          : entry.reason,
        placement: entry.placement,
      }
    })
    .sort((a, b) => {
      const ai = ordered.indexOf(a.id)
      const bi = ordered.indexOf(b.id)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
      return b.score - a.score || String(a.label).localeCompare(String(b.label), 'ru')
    })
    .filter((entry) => sequences[entry.id])
}

export function applyDerivedFlowToConfig(config, derivedFlow) {
  if (!config || typeof config !== 'object') return config
  let next = config
  if (Array.isArray(derivedFlow) && derivedFlow.length) {
    const sequences = config.sequences ?? {}
    const flow = derivedFlow.filter((id) => sequences[id])
    if (flow.length) next = { ...config, flow }
  }
  return hideDisabledBlocks(next)
}

/** Сводка как в Constructor V2 при «только имя» (cold start). */
export function nameOnlyGuestSummary(guestName = 'Гость') {
  const name = String(guestName ?? '').trim() || 'Гость'
  return normalizeGuestSummary({
    guestName: name,
    dates: '',
    partyType: '',
    room: '',
    topics: '',
    objections: '',
    confidence: '0.8',
    fillRemaining: 'off',
  })
}

/**
 * Про → Старт: зафиксировать autoplay как name-only adaptive-сборку и выключить adaptive.
 * Меню/блоки не удаляем — меняется только flow и флаги assembly.
 */
export function freezeAdaptiveConfigForStart(config, guestName) {
  if (!config || typeof config !== 'object') return config
  if (!isAdaptiveAssemblyEnabled(config)) return config

  const name =
    String(guestName ?? '').trim() ||
    String(config.defaultGuestName ?? '').trim() ||
    'Гость'
  const flow = deriveFlowIds(config, nameOnlyGuestSummary(name))
  const withFlow = applyDerivedFlowToConfig(config, flow)
  const prev = withFlow.constructorV2 && typeof withFlow.constructorV2 === 'object' ? withFlow.constructorV2 : {}
  const prevAssembly = prev.assembly && typeof prev.assembly === 'object' ? prev.assembly : {}
  return {
    ...withFlow,
    constructorV2: {
      ...prev,
      mode: 'fixed',
      assembly: {
        ...prevAssembly,
        enabled: false,
        mode: 'fixed',
      },
    },
  }
}

export function computeLinkAssembly(config, guestName, summaryInput = {}) {
  const guestSummary = normalizeGuestSummary({ guestName, ...summaryInput })
  const assemblyTrace = buildAssemblyTrace(config, guestSummary)
  if (!isAdaptiveAssemblyEnabled(config)) {
    return { guestSummary, derivedFlow: null, assemblyTrace }
  }
  const derivedFlow = deriveFlowIds(config, guestSummary)
  return { guestSummary, derivedFlow, assemblyTrace }
}
