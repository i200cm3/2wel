import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, EllipsisVertical, GripVertical, Play, Plus, Settings } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { downloadPropertyJson, isPropertyConfig, readPropertyJsonFile } from '@/hooks/usePropertyConfig'
import {
  applyDerivedFlow,
  deriveFlowIds,
  isAdaptiveAssemblyEnabled,
  normalizeGuestSummary,
  simulateAssembly,
  type GuestSummary,
} from '@/lib/assembly'
import { downloadTemplateArchive, importTemplateArchive } from '@/lib/api'
import { AiGenerationParamsPanel } from './editor/AiGenerationParamsPanel'
import { MenuInspector } from './editor/MenuInspector'
import { Presentation } from './Presentation'
import { TimelineEditor } from './TimelineEditor'
import { BlockLogicGroupCombobox } from './BlockLogicGroupCombobox'
import { SingleTagCombobox, TagsCombobox } from './TagsCombobox'
import {
  blockLibraryGroupSortIndex,
  blockLogicKeyFromMeta,
  blockLogicLabelFromMeta,
  blockMetaFromLogicKey,
} from '@/lib/blockLogicGroups'
import {
  AUDIENCE_TAG_OPTIONS,
  OBJECTION_TAG_OPTIONS,
  ROOM_TAG_OPTIONS,
  TOPIC_TAG_OPTIONS,
  tagOptionsFromValues,
} from '@/lib/blockMetaTags'
import {
  GUEST_ASSEMBLY_FIELDS_HINT,
  GUEST_SUBSTITUTION_PLACEHOLDERS,
  GUEST_SUMMARY_FIELD_OPTIONS,
  placeholdersInSequence,
  syncRequiresFieldsInConfig,
} from '@/lib/guestSummaryFields'
import { useTtsLibrary } from '@/hooks/useTtsLibrary'
import {
  defaultBlockMeta,
  getDefaultMenuId,
  isMenuOnlyBlock,
  listMenus,
  menuOnlyBlockPatch,
  newSequenceId,
  normalizeMenuTheme,
  normalizeProperty,
  normalizeTheme,
  resolveMenu,
  sequenceDuration,
  updateMenu,
  withMenus,
  type BlockMeta,
  type ConstructorV2Mode,
  type PropertyBranch,
  type PropertyConfig,
  type StorySequence,
} from '@/types/story'
import './TimelineEditor.css'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type Props = {
  config: PropertyConfig
  onChange: (next: PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)) => void
  onReset: () => void
  hasDraft?: boolean
  /** false, если шаблон ещё ни разу не публиковали */
  published?: boolean
  saveState?: SaveState
  publishState?: SaveState
  saveError?: string | null
  publishError?: string | null
  draftError?: string | null
  projectCode: string
  templateCode: string
  /** Отображаемое имя шаблона (не brand объекта). */
  templateName?: string
  isAdmin?: boolean
  onSave?: () => void
  onPublish?: () => void
  onRetryDraft?: () => void
}

type Placement = 'flow' | 'menu' | 'none'

function preferredEditorSeqId(config: PropertyConfig): string {
  const sequences = config.sequences ?? {}
  for (const id of config.flow ?? []) {
    if (sequences[id]) return id
  }
  if (sequences.greeting) return 'greeting'
  if (sequences.intro) return 'intro'
  return Object.keys(sequences)[0] ?? ''
}

function mapMenuBranches(
  config: PropertyConfig,
  mapFn: (branches: PropertyBranch[]) => PropertyBranch[],
): PropertyConfig {
  const source =
    config.menus && Object.keys(config.menus).length > 0
      ? config.menus
      : Object.fromEntries(listMenus(config).map((m) => [m.id, m]))
  const menus = Object.fromEntries(
    Object.entries(source).map(([id, menu]) => [id, { ...menu, branches: mapFn(menu.branches) }]),
  )
  return withMenus(config, menus, config.defaultMenuId)
}

function placementForId(config: PropertyConfig, sequenceId: string): Placement {
  if (config.flow.includes(sequenceId)) return 'flow'
  for (const menu of listMenus(config)) {
    if (menu.branches.some((branch) => branch.sequenceId === sequenceId)) return 'menu'
  }
  return 'none'
}

function blockLibraryHaystack(config: PropertyConfig, id: string): string {
  const seq = config.sequences[id]
  if (!seq) return ''
  const meta = config.constructorV2?.sequenceMetaById?.[id] ?? defaultBlockMeta()
  const placement = placementForId(config, id)
  const placementLabel = placement === 'flow' ? 'автопоказ' : placement === 'menu' ? 'меню' : ''
  const durationLabels: Record<BlockMeta['durationClass'], string> = {
    short: 'короткий',
    medium: 'средний',
    long: 'длинный',
  }
  return [
    id,
    seq.label,
    seq.title ?? '',
    blockLogicKeyFromMeta(meta),
    blockLogicLabelFromMeta(meta),
    meta.group,
    meta.subgroup ?? '',
    meta.durationClass,
    durationLabels[meta.durationClass],
    placementLabel,
    isMenuOnlyBlock(meta) ? 'только меню через меню' : '',
    meta.enabled === false ? 'выключен отключён' : 'включён',
    ...meta.audienceTags,
    ...meta.topicTags,
    ...meta.objectionTags,
  ]
    .join(' ')
    .toLowerCase()
}

function parseSummaryCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function csvFromUnknown(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ')
  }
  if (value == null) return ''
  return String(value).trim()
}

function parseGuestSummaryImport(
  raw: string,
): { ok: true; summary: GuestSummary } | { ok: false; error: string } {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'Вставьте JSON summary' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Невалидный JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ожидается JSON-объект' }
  }
  const data = parsed as Record<string, unknown>
  return {
    ok: true,
    summary: normalizeGuestSummary({
      guestName: String(data.guestName ?? data.name ?? ''),
      dates: String(data.dates ?? ''),
      partyType: String(data.partyType ?? ''),
      room: String(data.room ?? ''),
      topics: csvFromUnknown(data.topics),
      objections: csvFromUnknown(data.objections),
      confidence: String(data.confidence ?? '0.8'),
      fillRemaining: data.fillRemaining as GuestSummary['fillRemaining'],
    }),
  }
}

function guestSummaryToImportJson(summary: GuestSummary): string {
  return JSON.stringify(
    {
      guestName: summary.guestName,
      dates: summary.dates,
      partyType: summary.partyType,
      room: summary.room,
      topics: summary.topics,
      objections: summary.objections,
      confidence: summary.confidence,
      fillRemaining: summary.fillRemaining ?? 'off',
    },
    null,
    2,
  )
}

function updateBlockMeta(
  config: PropertyConfig,
  sequenceId: string,
  patch: Partial<BlockMeta>,
): PropertyConfig {
  const current = config.constructorV2?.sequenceMetaById?.[sequenceId] ?? defaultBlockMeta()
  return {
    ...config,
    constructorV2: {
      ...(config.constructorV2 ?? {
        mode: 'fixed' as ConstructorV2Mode,
        sequenceMetaById: {},
        assembly: {
          enabled: false,
          mode: 'fixed' as ConstructorV2Mode,
          maxAutoplaySec: 90,
          maxBlocks: 5,
          alwaysStartIds: [],
          alwaysEndIds: [],
          coldStartIds: [],
          lowConfidenceBehavior: 'menu' as const,
        },
      }),
      sequenceMetaById: {
        ...(config.constructorV2?.sequenceMetaById ?? {}),
        [sequenceId]: {
          ...current,
          ...patch,
        },
      },
    },
  }
}

function ruPlural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function blockLibraryStats(seq: StorySequence) {
  const clips = seq.clips.length
  const cues = seq.cues?.length ?? 0
  const parts = [
    `${sequenceDuration(seq).toFixed(1)} с`,
    `${clips} ${ruPlural(clips, 'кадр', 'кадра', 'кадров')}`,
  ]
  if (cues > 0) {
    parts.push(`${cues} ${ruPlural(cues, 'титр', 'титра', 'титров')}`)
  }
  return parts.join(' · ')
}

function libraryTagBadgeProps(kind: 'audience' | 'topic' | 'objection') {
  if (kind === 'objection') {
    return { variant: 'destructive' as const }
  }
  if (kind === 'topic') {
    return {
      variant: 'outline' as const,
      className:
        'border-green-600/30 bg-green-500/10 text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400',
    }
  }
  return { variant: 'outline' as const }
}

function blockLibraryTagBadges(meta: BlockMeta) {
  type TagKind = 'audience' | 'topic' | 'objection'
  const items: Array<{ value: string; label: string; kind: TagKind }> = [
    ...tagOptionsFromValues(meta.audienceTags, AUDIENCE_TAG_OPTIONS).map((item) => ({
      ...item,
      kind: 'audience' as const,
    })),
    ...tagOptionsFromValues(meta.topicTags, TOPIC_TAG_OPTIONS).map((item) => ({
      ...item,
      kind: 'topic' as const,
    })),
    ...tagOptionsFromValues(meta.objectionTags, OBJECTION_TAG_OPTIONS).map((item) => ({
      ...item,
      kind: 'objection' as const,
    })),
  ]

  if (!items.length) return null

  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={`${item.kind}:${item.value}`} {...libraryTagBadgeProps(item.kind)}>
          {item.label}
        </Badge>
      ))}
    </div>
  )
}

function toggleId(list: string[], id: string, on: boolean) {
  if (on) return list.includes(id) ? list : [...list, id]
  return list.filter((item) => item !== id)
}

const PRIORITY_HARD_MAX = 99

function PriorityPagination({
  value,
  maxPriority,
  onChange,
  className,
}: {
  value: number
  /** Текущий максимум среди блоков — в UI всегда есть max+1, чтобы поднять наверх. */
  maxPriority: number
  onChange: (priority: number) => void
  className?: string
}) {
  const current = Math.max(1, Math.min(PRIORITY_HARD_MAX, Math.round(value) || 3))
  const top = Math.min(
    PRIORITY_HARD_MAX,
    Math.max(1, Math.max(maxPriority, current) + 1),
  )
  const from = Math.max(1, current - 2)
  const to = Math.min(top, current + 2)
  const levels = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  return (
    <div
      className={`flex flex-wrap items-center justify-end gap-2 ${className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-muted-foreground text-xs">Приоритет</span>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          {levels.map((level) => {
            const isCurrent = current === level
            return (
              <PaginationItem key={level}>
                <PaginationLink
                  size="icon-sm"
                  isActive={isCurrent}
                  aria-label={
                    level === top && level > maxPriority
                      ? `Приоритет ${level} — наверх`
                      : `Приоритет ${level}`
                  }
                  title={
                    level === top && level > maxPriority
                      ? `Приоритет ${level} — поднять выше всех`
                      : `Приоритет ${level}`
                  }
                  className={
                    isCurrent
                      ? 'border-primary bg-primary/15 font-semibold text-primary shadow-sm'
                      : undefined
                  }
                  onClick={() => onChange(level)}
                >
                  {level}
                </PaginationLink>
              </PaginationItem>
            )
          })}
        </PaginationContent>
      </Pagination>
    </div>
  )
}

export function ConstructorV2({
  config,
  onChange: emitChange,
  onReset,
  hasDraft = false,
  published = true,
  saveState = 'idle',
  publishState = 'idle',
  saveError = null,
  publishError = null,
  draftError = null,
  projectCode,
  templateCode,
  templateName,
  isAdmin = false,
  onSave,
  onPublish,
  onRetryDraft,
}: Props) {
  const needsPublish = hasDraft || !published
  const setConfig = useCallback(
    (next: PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)) => {
      emitChange((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        return syncRequiresFieldsInConfig(resolved)
      })
    },
    [emitChange],
  )

  const [workspace, setWorkspace] = useState<'blocks' | 'assembly' | 'menus' | 'ai'>('blocks')
  useEffect(() => {
    if (!isAdmin && workspace === 'ai') setWorkspace('blocks')
  }, [isAdmin, workspace])
  const [blockTab, setBlockTab] = useState<'block' | 'params'>('block')
  const [seqId, setSeqId] = useState(() => preferredEditorSeqId(config))
  const [blockLibraryQuery, setBlockLibraryQuery] = useState('')
  const libraryScrollRef = useRef<HTMLDivElement>(null)
  const [summary, setSummary] = useState<GuestSummary>({
    guestName: config.defaultGuestName || 'Гость',
    dates: '',
    partyType: '',
    topics: '',
    objections: '',
    confidence: '0.8',
    room: '',
    fillRemaining: 'off',
  })
  const [summaryImportJson, setSummaryImportJson] = useState('')
  const [summaryImportError, setSummaryImportError] = useState<string | null>(null)
  const [developerJsonOpen, setDeveloperJsonOpen] = useState(false)
  const [dragFlowId, setDragFlowId] = useState<string | null>(null)
  const [dropFlowIndex, setDropFlowIndex] = useState<number | null>(null)
  const flowDragFromGrip = useRef(false)
  const [dragColdId, setDragColdId] = useState<string | null>(null)
  const [dropColdIndex, setDropColdIndex] = useState<number | null>(null)
  const coldDragFromGrip = useRef(false)
  const [dragMenuBranch, setDragMenuBranch] = useState<{ menuId: string; sequenceId: string } | null>(
    null,
  )
  const [dropMenuBranchIndex, setDropMenuBranchIndex] = useState<number | null>(null)
  const menuBranchDragFromGrip = useRef(false)
  const [previewMenuId, setPreviewMenuId] = useState(
    () => config.defaultMenuId ?? getDefaultMenuId(config),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const [archiveImporting, setArchiveImporting] = useState(false)
  const [archiveExporting, setArchiveExporting] = useState(false)
  const [archiveProgress, setArchiveProgress] = useState<{
    phase: 'uploading' | 'processing' | 'preparing' | 'downloading'
    percent: number
  } | null>(null)
  const [assemblyPreviewOpen, setAssemblyPreviewOpen] = useState(false)
  const [assemblyPreviewKey, setAssemblyPreviewKey] = useState(0)

  const menus = useMemo(() => listMenus(config), [config])
  const previewMenu = useMemo(() => {
    if (!menus.length) return null
    return menus.find((menu) => menu.id === previewMenuId) ?? menus[0] ?? null
  }, [menus, previewMenuId])
  const theme = useMemo(() => normalizeTheme(config.theme), [config.theme])
  const menuPreviewLandscape = theme.orientation === 'landscape'
  const ttsLibrary = useTtsLibrary(projectCode)
  const { files: ttsFiles, refresh: refreshTts } = ttsLibrary
  const selectedSequence = config.sequences[seqId] ?? Object.values(config.sequences)[0] ?? null
  const selectedMeta = selectedSequence
    ? config.constructorV2?.sequenceMetaById?.[selectedSequence.id] ?? defaultBlockMeta()
    : defaultBlockMeta()
  const detectedPlaceholders = useMemo(() => {
    if (!selectedSequence) return []
    return placeholdersInSequence(selectedSequence)
  }, [selectedSequence])
  const libraryBlockIds = useMemo(() => {
    const metaById = config.constructorV2?.sequenceMetaById ?? {}
    const isEnabled = (id: string) => metaById[id]?.enabled !== false
    return Object.keys(config.sequences).sort((a, b) => {
      const enabledDiff = Number(isEnabled(b)) - Number(isEnabled(a))
      if (enabledDiff !== 0) return enabledDiff
      const metaA = metaById[a] ?? defaultBlockMeta()
      const metaB = metaById[b] ?? defaultBlockMeta()
      const groupOrder = blockLibraryGroupSortIndex(metaA.group) - blockLibraryGroupSortIndex(metaB.group)
      if (groupOrder !== 0) return groupOrder
      const groupName = metaA.group.localeCompare(metaB.group, 'ru', { sensitivity: 'base' })
      if (groupName !== 0) return groupName
      return (config.sequences[a]?.label ?? a).localeCompare(config.sequences[b]?.label ?? b, 'ru', {
        sensitivity: 'base',
      })
    })
  }, [config.sequences, config.constructorV2?.sequenceMetaById])
  const maxBlockPriority = useMemo(() => {
    const metaById = config.constructorV2?.sequenceMetaById ?? {}
    let max = 1
    for (const id of Object.keys(config.sequences)) {
      const priority = Number(metaById[id]?.priority)
      if (Number.isFinite(priority) && priority > max) max = priority
    }
    return max
  }, [config.sequences, config.constructorV2?.sequenceMetaById])
  const anchorSequences = useMemo(() => {
    const sequences = config.sequences
    return Object.values(sequences).sort((a, b) =>
      (a.label?.trim() || a.id).localeCompare(b.label?.trim() || b.id, 'ru', { sensitivity: 'base' }),
    )
  }, [config.sequences])
  const filteredLibraryBlockIds = useMemo(() => {
    const q = blockLibraryQuery.trim().toLowerCase()
    if (!q) return libraryBlockIds
    const tokens = q.split(/\s+/).filter(Boolean)
    return libraryBlockIds.filter((id) => {
      const haystack = blockLibraryHaystack(config, id)
      return tokens.every((token) => haystack.includes(token))
    })
  }, [blockLibraryQuery, libraryBlockIds, config])
  const simulation = useMemo(() => simulateAssembly(config, summary), [config, summary])
  const derivedFlowIds = useMemo(() => deriveFlowIds(config, summary), [config, summary])
  const adaptiveEnabled = isAdaptiveAssemblyEnabled(config)
  const coldStartIds = config.constructorV2?.assembly.coldStartIds ?? []
  const isColdStartPreview =
    adaptiveEnabled &&
    !summary.partyType.trim() &&
    !summary.topics.trim() &&
    !summary.objections.trim()
  const includedSimulation = useMemo(() => simulation.filter((entry) => entry.included), [simulation])
  const excludedSimulation = useMemo(() => simulation.filter((entry) => !entry.included), [simulation])
  const assemblyPreviewConfig = useMemo(() => {
    if (!adaptiveEnabled) return config
    return applyDerivedFlow(config, derivedFlowIds)
  }, [adaptiveEnabled, config, derivedFlowIds])

  useEffect(() => {
    if (!assemblyPreviewOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAssemblyPreviewOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assemblyPreviewOpen])

  const selectBlock = (id: string) => {
    if (!config.sequences[id]) return
    setSeqId(id)
    setWorkspace('blocks')
    setBlockTab('block')
  }

  const openBlockParams = (id: string) => {
    if (!config.sequences[id]) return
    setSeqId(id)
    setWorkspace('blocks')
    setBlockTab('params')
  }

  const setBlockPriority = (id: string, priority: number) => {
    patchConstructorV2((prev) =>
      updateBlockMeta(prev, id, {
        priority: Math.max(1, Math.min(PRIORITY_HARD_MAX, Math.round(priority) || 1)),
      }),
    )
  }

  const onImportJson = async (file: File | undefined) => {
    if (!file) return
    try {
      const next = await readPropertyJsonFile(file)
      setConfig(next)
      setSeqId(preferredEditorSeqId(next))
      setSettingsOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось импортировать JSON')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const onImportArchive = async (file: File | undefined) => {
    if (!file) return
    setArchiveImporting(true)
    setArchiveProgress({ phase: 'uploading', percent: 0 })
    try {
      const imported = await importTemplateArchive(projectCode, templateCode, file, (progress) => {
        setArchiveProgress({ phase: progress.phase, percent: progress.percent })
      })
      if (!isPropertyConfig(imported.config)) {
        throw new Error('Сервер импортировал архив, но не вернул конфиг шаблона')
      }
      const next = normalizeProperty(imported.config)
      setConfig(next)
      setSeqId(preferredEditorSeqId(next))
      refreshTts()
      setSettingsOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось импортировать проект')
    } finally {
      setArchiveImporting(false)
      setArchiveProgress(null)
      if (archiveInputRef.current) archiveInputRef.current.value = ''
    }
  }

  const onExportArchive = async () => {
    setArchiveExporting(true)
    setArchiveProgress({ phase: 'preparing', percent: 0 })
    try {
      await downloadTemplateArchive(projectCode, templateCode, (progress) => {
        setArchiveProgress({ phase: progress.phase, percent: progress.percent })
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось экспортировать проект')
    } finally {
      setArchiveExporting(false)
      setArchiveProgress(null)
    }
  }

  useLayoutEffect(() => {
    if (workspace !== 'blocks') return
    if (blockTab !== 'block' && blockTab !== 'params') return
    if (!selectedSequence?.id || !filteredLibraryBlockIds.includes(selectedSequence.id)) return
    const row = libraryScrollRef.current?.querySelector(
      `[data-block-id="${selectedSequence.id}"]`,
    )
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [workspace, blockTab, seqId, selectedSequence?.id, filteredLibraryBlockIds])

  const patchConstructorV2 = (patcher: (current: PropertyConfig) => PropertyConfig) => {
    setConfig((prev) => patcher(prev))
  }

  const setMetaTagList = (
    field: keyof Pick<BlockMeta, 'audienceTags' | 'topicTags' | 'objectionTags' | 'requiresFields'>,
    tags: string[],
  ) => {
    if (!selectedSequence) return
    patchConstructorV2((prev) => updateBlockMeta(prev, selectedSequence.id, { [field]: tags }))
  }

  const toggleAssemblyAnchor = (
    field: 'alwaysStartIds' | 'alwaysEndIds' | 'coldStartIds',
    id: string,
    checked: boolean,
  ) => {
    patchConstructorV2((prev) => {
      const current = prev.constructorV2
      if (!current) return prev
      let next: PropertyConfig = {
        ...prev,
        constructorV2: {
          ...current,
          assembly: {
            ...current.assembly,
            coldStartIds: current.assembly.coldStartIds ?? [],
            [field]: toggleId(current.assembly[field] ?? [], id, checked),
          },
        },
      }
      // Cold = явно в autoplay при «только имя»: снять menu-only, иначе превью/выдача его отсекают.
      if (field === 'coldStartIds' && checked) {
        next = updateBlockMeta(next, id, menuOnlyBlockPatch(false))
      }
      return next
    })
  }

  const reorderColdStart = (fromId: string, toIndex: number) => {
    patchConstructorV2((prev) => {
      const current = prev.constructorV2
      if (!current) return prev
      const list = (current.assembly.coldStartIds ?? []).filter((id) => prev.sequences[id])
      const from = list.indexOf(fromId)
      if (from < 0) return prev
      let insertAt = Math.max(0, Math.min(toIndex, list.length))
      const next = [...list]
      const [item] = next.splice(from, 1)
      if (from < insertAt) insertAt -= 1
      next.splice(insertAt, 0, item)
      return {
        ...prev,
        constructorV2: {
          ...current,
          assembly: {
            ...current.assembly,
            coldStartIds: next,
          },
        },
      }
    })
  }

  const reorderFlow = (fromId: string, toIndex: number) => {
    setConfig((prev) => {
      const flow = prev.flow.filter((item) => prev.sequences[item])
      const from = flow.indexOf(fromId)
      if (from < 0) return prev
      let insertAt = Math.max(0, Math.min(toIndex, flow.length))
      const next = [...flow]
      const [item] = next.splice(from, 1)
      if (from < insertAt) insertAt -= 1
      next.splice(insertAt, 0, item)
      return { ...prev, flow: next }
    })
  }

  const setFlowIncludes = (id: string, include: boolean) => {
    if (!config.sequences[id]) return
    setConfig((prev) => {
      const without = prev.flow.filter((item) => item !== id && prev.sequences[item])
      return {
        ...prev,
        flow: include ? [...without, id] : without,
      }
    })
  }

  const reorderMenuBranches = (menuId: string, fromSequenceId: string, toIndex: number) => {
    setConfig((prev) => {
      const menu = resolveMenu(prev, menuId)
      const branches = [...menu.branches]
      const from = branches.findIndex((branch) => branch.sequenceId === fromSequenceId)
      if (from < 0) return prev
      let insertAt = Math.max(0, Math.min(toIndex, branches.length))
      const [item] = branches.splice(from, 1)
      if (from < insertAt) insertAt -= 1
      branches.splice(insertAt, 0, item)
      return updateMenu(prev, menuId, { branches })
    })
  }

  const addBlock = () => {
    const id = newSequenceId('block')
    const label = 'Новый блок'
    setConfig((prev) =>
      updateBlockMeta(
        {
          ...prev,
          sequences: { ...prev.sequences, [id]: { id, label, clips: [] } },
        },
        id,
        defaultBlockMeta(),
      ),
    )
    setSeqId(id)
    setWorkspace('blocks')
    setBlockTab('block')
  }

  const renameBlock = (id: string) => {
    const seq = config.sequences[id]
    if (!seq) return
    const nextLabel = window.prompt('Название блока', seq.label)?.trim()
    if (!nextLabel || nextLabel === seq.label) return
    setConfig((prev) => {
      const current = prev.sequences[id]
      if (!current) return prev
      return mapMenuBranches(
        {
          ...prev,
          sequences: { ...prev.sequences, [id]: { ...current, label: nextLabel } },
        },
        (branches) =>
          branches.map((branch) => (branch.sequenceId === id ? { ...branch, label: nextLabel } : branch)),
      )
    })
  }

  const deleteBlock = (id: string) => {
    const seq = config.sequences[id]
    if (!seq) return
    if (!window.confirm(`Удалить блок «${seq.label}»?`)) return
    setConfig((prev) => {
      const { [id]: _removed, ...rest } = prev.sequences
      void _removed
      const sequences = Object.fromEntries(
        Object.entries(rest).map(([sid, item]) => {
          const endButtons = item.endButtons?.filter(
            (button) => !(button.target.kind === 'sequence' && button.target.sequenceId === id),
          )
          return [sid, { ...item, endButtons: endButtons?.length ? endButtons : undefined }]
        }),
      )
      const { [id]: _meta, ...sequenceMetaById } = prev.constructorV2?.sequenceMetaById ?? {}
      void _meta
      let next: PropertyConfig = {
        ...mapMenuBranches({ ...prev, sequences }, (branches) =>
          branches.filter((branch) => branch.sequenceId !== id),
        ),
        flow: prev.flow.filter((item) => item !== id),
      }
      if (next.constructorV2) {
        next = {
          ...next,
          constructorV2: {
            ...next.constructorV2,
            sequenceMetaById,
            assembly: {
              ...next.constructorV2.assembly,
              alwaysStartIds: next.constructorV2.assembly.alwaysStartIds.filter((item) => item !== id),
              alwaysEndIds: next.constructorV2.assembly.alwaysEndIds.filter((item) => item !== id),
              coldStartIds: (next.constructorV2.assembly.coldStartIds ?? []).filter((item) => item !== id),
            },
          },
        }
      }
      return next
    })
    if (seqId === id) {
      const remaining = Object.keys(config.sequences).filter((item) => item !== id)
      setSeqId(remaining[0] ?? '')
    }
  }

  const setBlockEnabled = (id: string, enabled: boolean) => {
    patchConstructorV2((prev) => updateBlockMeta(prev, id, { enabled }))
  }

  const setBlockPlacement = (id: string, placement: Placement, menuId?: string) => {
    setConfig((prev) => {
      const seq = prev.sequences[id]
      if (!seq) return prev
      const flow = (prev.flow ?? []).filter((item) => item !== id)
      let next = mapMenuBranches(prev, (branches) => branches.filter((branch) => branch.sequenceId !== id))
      if (placement === 'none') {
        return { ...next, flow }
      }
      if (placement === 'flow') {
        return { ...next, flow: [...flow, id] }
      }
      const targetMenuId = menuId ?? prev.defaultMenuId ?? getDefaultMenuId(prev)
      const menu = resolveMenu(next, targetMenuId)
      return {
        ...updateMenu(next, targetMenuId, {
          branches: [
            ...menu.branches.filter((branch) => branch.sequenceId !== id),
            { id, label: seq.label, sequenceId: id },
          ],
        }),
        flow,
      }
    })
  }

  const selectedPlacement = selectedSequence ? placementForId(config, selectedSequence.id) : 'none'
  const selectedMenuIdForPlacement = useMemo(() => {
    if (!selectedSequence) return config.defaultMenuId ?? getDefaultMenuId(config)
    for (const menu of menus) {
      if (menu.branches.some((branch) => branch.sequenceId === selectedSequence.id)) return menu.id
    }
    return config.defaultMenuId ?? getDefaultMenuId(config)
  }, [config, menus, selectedSequence])

  if (!selectedSequence) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
        <p>В шаблоне пока нет блоков</p>
        <Button size="sm" onClick={addBlock}>
          <Plus />
          Добавить блок
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 max-[900px]:h-auto max-[900px]:min-h-full max-[900px]:overflow-visible">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium">
            {templateName?.trim() || templateCode}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {needsPublish ? <Badge variant="outline">Черновик</Badge> : <Badge variant="secondary">В эфире</Badge>}
          <Button variant="outline" size="sm" onClick={onReset}>
            Сбросить черновик
          </Button>
          {onRetryDraft && draftError ? (
            <Button variant="outline" size="sm" onClick={onRetryDraft}>
              Повторить draft
            </Button>
          ) : null}
          {onPublish ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPublish()}
              title="Создать тестовую гостевую ссылку с текущим шаблоном"
            >
              {publishState === 'saving' ? 'Тестовая ссылка…' : 'Тестовая ссылка'}
            </Button>
          ) : null}
          {onSave ? (
            <Button
              size="sm"
              variant={needsPublish ? 'default' : 'outline'}
              disabled={saveState === 'saving' || publishState === 'saving'}
              onClick={() => onSave()}
              title={
                needsPublish
                  ? 'Опубликовать шаблон — после этого можно выдавать ссылки гостям'
                  : 'Шаблон уже в эфире. Нажмите, чтобы опубликовать текущую версию ещё раз'
              }
            >
              {saveState === 'saving'
                ? 'Публикация…'
                : saveState === 'saved' && !needsPublish
                  ? 'Опубликовано'
                  : 'Опубликовать шаблон'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Настройки"
            title="Настройки"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden />
          </Button>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки</DialogTitle>
            <DialogDescription>
              JSON — только конфиг шаблона. Проект (ZIP) — конфиг вместе с медиа и TTS.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">Кнопка «Далее»</p>
              <p className="text-muted-foreground text-xs">
                Пропуск текущего блока в плеере. Выключите, если гостю лучше досмотреть до конца.
              </p>
            </div>
            <Switch
              checked={theme.showNextButton}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({
                  ...prev,
                  theme: {
                    ...normalizeTheme(prev.theme),
                    showNextButton: checked === true,
                  },
                }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archiveImporting || archiveExporting}
              onClick={() =>
                downloadPropertyJson(config, `${projectCode}-${templateCode}.json`)
              }
            >
              Экспорт JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archiveExporting || archiveImporting}
              onClick={() => void onExportArchive()}
            >
              {archiveExporting ? 'Экспорт…' : 'Экспорт проекта'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archiveImporting || archiveExporting}
              onClick={() => importInputRef.current?.click()}
            >
              Импорт JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archiveImporting || archiveExporting}
              onClick={() => archiveInputRef.current?.click()}
            >
              {archiveImporting ? 'Импорт…' : 'Импорт проекта'}
            </Button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void onImportJson(e.target.files?.[0])}
          />
          <input
            ref={archiveInputRef}
            type="file"
            accept="application/zip,.zip"
            hidden
            onChange={(e) => void onImportArchive(e.target.files?.[0])}
          />
          {archiveProgress ? (
            <div className="rounded-lg border bg-muted/40 p-2">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {archiveProgress.phase === 'uploading'
                    ? 'Загрузка ZIP'
                    : archiveProgress.phase === 'processing'
                      ? 'Распаковка и проверка файлов'
                      : archiveProgress.phase === 'preparing'
                        ? 'Сборка архива'
                        : 'Скачивание ZIP'}
                </span>
                <span>{archiveProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${archiveProgress.percent}%` }}
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {saveError ? <p className="text-destructive text-sm">{saveError}</p> : null}
      {publishError ? <p className="text-destructive text-sm">{publishError}</p> : null}
      {draftError ? <p className="text-destructive text-sm">{draftError}</p> : null}

      <Tabs
        value={workspace}
        onValueChange={(value) => value && setWorkspace(value as typeof workspace)}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden max-[900px]:overflow-visible"
      >
        <TabsList>
          <TabsTrigger value="blocks">Блоки</TabsTrigger>
          <TabsTrigger value="assembly">Сборка</TabsTrigger>
          <TabsTrigger value="menus">Меню</TabsTrigger>
          {isAdmin ? <TabsTrigger value="ai">Параметры генерации</TabsTrigger> : null}
        </TabsList>

        <TabsContent
          value="blocks"
          className="grid min-h-0 flex-1 items-stretch gap-4 max-[900px]:flex-none max-[900px]:min-h-0 max-[900px]:grid-cols-1 min-[901px]:grid-cols-[300px_minmax(0,1fr)]"
        >
        <Card className="min-h-0 overflow-hidden max-[900px]:overflow-visible">
          <CardHeader className="space-y-3">
            <CardTitle>Библиотека блоков</CardTitle>
            <Input
              value={blockLibraryQuery}
              onChange={(e) => setBlockLibraryQuery(e.target.value)}
              placeholder="Поиск по названию, тегам, группе…"
              aria-label="Поиск блоков"
            />
            <Button size="sm" variant="outline" className="w-full" onClick={addBlock}>
              <Plus />
              Добавить блок
            </Button>
          </CardHeader>
          <CardContent ref={libraryScrollRef} className="min-h-0 overflow-y-auto">
            <div className="space-y-2">
              {filteredLibraryBlockIds.map((id) => {
                const seq = config.sequences[id]
                if (!seq) return null
                const meta = config.constructorV2?.sequenceMetaById?.[id] ?? defaultBlockMeta()
                const placement = placementForId(config, id)
                const placementLabel =
                  placement === 'flow' ? 'автопоказ' : placement === 'menu' ? 'меню' : null
                const enabled = meta.enabled !== false
                const selected = id === selectedSequence?.id
                const logicLabel = blockLogicLabelFromMeta(meta)
                return (
                  <div
                    key={id}
                    data-block-id={id}
                    aria-disabled={!enabled}
                    className={`flex items-stretch gap-0.5 rounded-lg border transition ${
                      selected
                        ? enabled
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-muted-foreground/40 bg-muted/40 ring-2 ring-muted-foreground/15'
                        : enabled
                          ? 'border-border'
                          : 'border-dashed border-muted-foreground/35 bg-muted/30'
                    }`}
                  >
                    <button
                      type="button"
                      className={`min-w-0 flex-1 px-3 py-2.5 text-left hover:bg-muted/70 ${
                        enabled ? '' : 'text-muted-foreground'
                      }`}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => selectBlock(id)}
                    >
                      <div className="flex flex-col gap-2">
                        <p
                          className={`text-sm leading-snug font-medium break-words ${
                            enabled ? '' : 'line-through decoration-muted-foreground/50'
                          }`}
                        >
                          {seq.label}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-muted-foreground text-[11px] leading-none tabular-nums whitespace-nowrap">
                            {blockLibraryStats(seq)}
                          </span>
                          {placementLabel ? (
                            <Badge variant="outline" className="text-muted-foreground shrink-0 font-normal">
                              {placementLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {!enabled ? (
                            <Badge variant="secondary" className="font-normal text-muted-foreground">
                              выключен
                            </Badge>
                          ) : isMenuOnlyBlock(meta) ? (
                            <Badge variant="outline" className="font-normal">
                              только меню
                            </Badge>
                          ) : null}
                          {logicLabel ? (
                            <Badge variant="secondary" className="max-w-full font-normal whitespace-normal">
                              {logicLabel}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal">
                              без типа
                            </Badge>
                          )}
                        </div>
                        {blockLibraryTagBadges(meta)}
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="my-auto mr-1 shrink-0 self-center"
                            aria-label={`Действия для «${seq.label}»`}
                          />
                        }
                      >
                        <EllipsisVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onClick={() => renameBlock(id)}>Переименовать</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setBlockEnabled(id, !enabled)}>
                          {enabled ? 'Выключить' : 'Включить'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => deleteBlock(id)}>
                          Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
              {libraryBlockIds.length === 0 ? (
                <p className="text-muted-foreground text-sm">Пока нет блоков.</p>
              ) : filteredLibraryBlockIds.length === 0 ? (
                <p className="text-muted-foreground text-sm">Ничего не найдено.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Tabs
          value={blockTab}
          onValueChange={(value) => value && setBlockTab(value as typeof blockTab)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-[900px]:overflow-visible"
        >
          <TabsList>
            <TabsTrigger value="block">Видео редактор</TabsTrigger>
            <TabsTrigger value="params">Параметры</TabsTrigger>
          </TabsList>

          <TabsContent value="block" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TimelineEditor
              blockPanel
              blockSeqId={selectedSequence.id}
              config={config}
              onChange={setConfig}
              projectCode={projectCode}
              templateCode={templateCode}
              ttsLibrary={ttsLibrary}
              isAdmin={isAdmin}
            />
          </TabsContent>

          <TabsContent value="params" className="min-h-0 overflow-y-auto pr-1">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Параметры блока</CardTitle>
                {selectedSequence ? (
                  <CardDescription>
                    <span className="text-foreground font-medium">{selectedSequence.label}</span>
                    {blockLogicLabelFromMeta(selectedMeta) ? (
                      <span>{` · ${blockLogicLabelFromMeta(selectedMeta)}`}</span>
                    ) : null}
                  </CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">Показывать блок</p>
                    <p className="text-muted-foreground text-xs">Выключенный блок остаётся в библиотеке, но не идёт гостю.</p>
                  </div>
                  <Switch
                    checked={selectedMeta.enabled !== false}
                    onCheckedChange={(checked) =>
                      patchConstructorV2((prev) => updateBlockMeta(prev, selectedSequence.id, { enabled: checked === true }))
                    }
                  />
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="font-medium">Размещение в сценарии</p>
                      <p className="text-muted-foreground text-xs">
                        Куда встроен блок: автопоказ, меню или пока ни туда (черновик в библиотеке).
              
                      </p>
                    </div>
                    <NativeSelect
                      value={selectedPlacement}
                      onChange={(e) =>
                        setBlockPlacement(
                          selectedSequence.id,
                          e.target.value as Placement,
                          selectedMenuIdForPlacement,
                        )
                      }
                      className="w-full sm:w-52"
                      aria-label="Размещение блока"
                    >
                      <NativeSelectOption value="none">Не в сценарии</NativeSelectOption>
                      <NativeSelectOption value="flow">Автопоказ</NativeSelectOption>
                      <NativeSelectOption value="menu">Меню</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  {selectedPlacement === 'menu' && menus.length > 1 ? (
                    <label className="mt-3 grid gap-1 text-sm">
                      <span className="text-muted-foreground">Экран меню</span>
                      <NativeSelect
                        value={selectedMenuIdForPlacement}
                        onChange={(e) => setBlockPlacement(selectedSequence.id, 'menu', e.target.value)}
                        className="w-full sm:max-w-xs"
                        aria-label="Экран меню для блока"
                      >
                        {menus.map((menu) => (
                          <NativeSelectOption key={menu.id} value={menu.id}>
                            {menu.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">Запускается только через меню</p>
                    <p className="text-muted-foreground text-xs">
                      Для adaptive-сборки: не кандидат в автопоказ. Не заменяет размещение выше.
                    </p>
                  </div>
                  <Switch
                    checked={isMenuOnlyBlock(selectedMeta)}
                    onCheckedChange={(checked) =>
                      patchConstructorV2((prev) => {
                        let next = updateBlockMeta(
                          prev,
                          selectedSequence.id,
                          menuOnlyBlockPatch(checked === true),
                        )
                        // Menu-only и cold противоречат: убрать из cold-start списка.
                        if (checked === true && next.constructorV2) {
                          next = {
                            ...next,
                            constructorV2: {
                              ...next.constructorV2,
                              assembly: {
                                ...next.constructorV2.assembly,
                                coldStartIds: (next.constructorV2.assembly.coldStartIds ?? []).filter(
                                  (item) => item !== selectedSequence.id,
                                ),
                              },
                            },
                          }
                        }
                        return next
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Тип блока</span>
                    <BlockLogicGroupCombobox
                      value={blockLogicKeyFromMeta(selectedMeta)}
                      onValueChange={(key) =>
                        patchConstructorV2((prev) =>
                          updateBlockMeta(prev, selectedSequence.id, blockMetaFromLogicKey(key)),
                        )
                      }
                      aria-label="Тип блока"
                    />
                  </label>
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Приоритет</span>
                    <Input
                      type="number"
                      min={1}
                      max={PRIORITY_HARD_MAX}
                      value={selectedMeta.priority}
                      onChange={(e) => setBlockPriority(selectedSequence.id, Number(e.target.value))}
                    />
                  </label>
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Длительность</span>
                    <NativeSelect
                      value={selectedMeta.durationClass}
                      disabled
                      aria-disabled
                      title="Пока не используется в сборке и воспроизведении"
                      onChange={(e) =>
                        patchConstructorV2((prev) =>
                          updateBlockMeta(prev, selectedSequence.id, {
                            durationClass: e.target.value as BlockMeta['durationClass'],
                          }),
                        )
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="short">короткий</NativeSelectOption>
                      <NativeSelectOption value="medium">средний</NativeSelectOption>
                      <NativeSelectOption value="long">длинный</NativeSelectOption>
                    </NativeSelect>
                    <p className="text-muted-foreground text-xs">
                      Метка для библиотеки блоков (короткий / средний / длинный). На таймлайн и адаптивную
                      сборку не влияет — там считается реальное время слайдов. Поле временно отключено.
                    </p>
                  </label>
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Аудитория</span>
                    <TagsCombobox
                      options={AUDIENCE_TAG_OPTIONS}
                      value={selectedMeta.audienceTags}
                      onValueChange={(tags) => setMetaTagList('audienceTags', tags)}
                      // placeholder="solo, couple…"
                      aria-label="Аудитория"
                    />
                  </label>
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Темы</span>
                    <TagsCombobox
                      options={TOPIC_TAG_OPTIONS}
                      value={selectedMeta.topicTags}
                      onValueChange={(tags) => setMetaTagList('topicTags', tags)}
                      // placeholder="room, treatment…"
                      aria-label="Темы"
                    />
                  </label>
                  <label className="grid w-full gap-1 self-start text-sm">
                    <span className="text-muted-foreground">Возражения</span>
                    <TagsCombobox
                      options={OBJECTION_TAG_OPTIONS}
                      value={selectedMeta.objectionTags}
                      onValueChange={(tags) => setMetaTagList('objectionTags', tags)}
                      // placeholder="price, distance…"
                      aria-label="Возражения"
                    />
                  </label>
                  <div className="grid w-full gap-1 self-start text-sm sm:col-span-2 lg:col-span-3">
                    <span className="text-muted-foreground">Обязательные параметры гостя</span>
                    <TagsCombobox
                      options={GUEST_SUMMARY_FIELD_OPTIONS}
                      value={selectedMeta.requiresFields}
                      onValueChange={(tags) => setMetaTagList('requiresFields', tags)}
                      emptyLabel="Не требуются"
                      placeholder="name, room, dates…"
                      aria-label="Обязательные параметры гостя"
                    />
                    <p className="text-muted-foreground text-xs">{GUEST_ASSEMBLY_FIELDS_HINT}</p>
                    <p className="text-muted-foreground text-xs">
                      Блок попадёт в autoplay только если amo передала все выбранные параметры. Поля из
                      {' '}
                      {GUEST_SUBSTITUTION_PLACEHOLDERS.join(', ')}
                      {' '}
                      в заголовке, титрах и TTS добавляются сюда автоматически.
                      {detectedPlaceholders.length
                        ? ` Сейчас в тексте: ${detectedPlaceholders.map((item) => `{${item}}`).join(', ')}.`
                        : ''}
                    </p>
                  </div>
                </div>
                
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </TabsContent>

        <TabsContent value="assembly" className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div
              className={`grid gap-4 ${
                adaptiveEnabled
                  ? 'xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(260px,300px)]'
                  : 'xl:grid-cols-[360px_minmax(0,1fr)]'
              }`}
            >
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Профиль сборки</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="font-medium">Адаптивная сборка</p>
                      <p className="text-muted-foreground text-sm">
                        {adaptiveEnabled
                          ? 'Порядок autoplay считается по параметрам гостя при выдаче ссылки.'
                          : 'Гость видит фиксированный flow шаблона без пересборки.'}
                      </p>
                    </div>
                    <Switch
                      checked={adaptiveEnabled}
                      onCheckedChange={(checked) => {
                        const mode: ConstructorV2Mode = checked ? 'adaptive' : 'fixed'
                        patchConstructorV2((prev) => ({
                          ...prev,
                          constructorV2: {
                            ...prev.constructorV2!,
                            mode,
                            assembly: {
                              ...prev.constructorV2!.assembly,
                              enabled: checked,
                              mode,
                            },
                          },
                        }))
                      }}
                    />
                  </div>
                  {adaptiveEnabled ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1 text-sm">
                          <span className="text-muted-foreground">Макс. секунд autoplay</span>
                          <Input
                            type="number"
                            min="15"
                            max="300"
                            value={config.constructorV2?.assembly.maxAutoplaySec ?? 90}
                            onChange={(e) =>
                              patchConstructorV2((prev) => ({
                                ...prev,
                                constructorV2: {
                                  ...prev.constructorV2!,
                                  assembly: {
                                    ...prev.constructorV2!.assembly,
                                    maxAutoplaySec: Math.max(15, Number(e.target.value) || 15),
                                  },
                                },
                              }))
                            }
                          />
                          <span className="text-muted-foreground text-xs">
                            Лимит длительности персональной сборки (из шаблона). Нужна публикация.
                          </span>
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="text-muted-foreground">Макс. блоков autoplay</span>
                          <Input
                            type="number"
                            min="1"
                            max="20"
                            value={config.constructorV2?.assembly.maxBlocks ?? 5}
                            onChange={(e) =>
                              patchConstructorV2((prev) => ({
                                ...prev,
                                constructorV2: {
                                  ...prev.constructorV2!,
                                  assembly: {
                                    ...prev.constructorV2!.assembly,
                                    maxBlocks: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                                  },
                                },
                              }))
                            }
                          />
                          <span className="text-muted-foreground text-xs">
                            Сколько блоков максимум в autoplay. CRM/пайплайн читают опубликованный шаблон.
                          </span>
                        </label>
                      </div>
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Поведение при низкой уверенности</span>
                        <NativeSelect
                          value={config.constructorV2?.assembly.lowConfidenceBehavior ?? 'menu'}
                          onChange={(e) =>
                            patchConstructorV2((prev) => ({
                              ...prev,
                              constructorV2: {
                                ...prev.constructorV2!,
                                assembly: {
                                  ...prev.constructorV2!.assembly,
                                  lowConfidenceBehavior: e.target.value as 'exclude' | 'menu' | 'tail',
                                },
                              },
                            }))
                          }
                          className="w-full"
                        >
                          <NativeSelectOption value="exclude">Исключить из autoplay</NativeSelectOption>
                          <NativeSelectOption value="menu">Оставить в меню</NativeSelectOption>
                          <NativeSelectOption value="tail">В конец autoplay</NativeSelectOption>
                        </NativeSelect>
                      </label>
                      <div className="rounded-lg border p-3">
                        <p className="font-medium">Anchors</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Список блоков — по алфавиту. Порядок Cold — перетаскиванием за grip в списке
                          ниже (не приоритетом). Новый чек Cold добавляется в конец.
                        </p>
                        <div className="mt-3 grid gap-2">
                          {anchorSequences.map((sequence) => {
                            const fullName = sequence.label?.trim() || sequence.id
                            const title = fullName === sequence.id ? sequence.id : `${fullName} · ${sequence.id}`
                            return (
                              <div
                                key={sequence.id}
                                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3"
                              >
                                <span className="truncate text-sm" title={title}>
                                  {fullName}
                                </span>
                                <label className="flex items-center gap-2 text-xs">
                                  <Checkbox
                                    checked={config.constructorV2?.assembly.alwaysStartIds.includes(sequence.id)}
                                    onCheckedChange={(checked) =>
                                      toggleAssemblyAnchor('alwaysStartIds', sequence.id, checked === true)
                                    }
                                  />
                                  <span>start</span>
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <Checkbox
                                    checked={(config.constructorV2?.assembly.coldStartIds ?? []).includes(
                                      sequence.id,
                                    )}
                                    onCheckedChange={(checked) =>
                                      toggleAssemblyAnchor('coldStartIds', sequence.id, checked === true)
                                    }
                                  />
                                  <span>cold</span>
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <Checkbox
                                    checked={config.constructorV2?.assembly.alwaysEndIds.includes(sequence.id)}
                                    onCheckedChange={(checked) =>
                                      toggleAssemblyAnchor('alwaysEndIds', sequence.id, checked === true)
                                    }
                                  />
                                  <span>end</span>
                                </label>
                              </div>
                            )
                          })}
                        </div>
                        {coldStartIds.length > 0 ? (
                          <div className="mt-3 space-y-1">
                            <p className="text-muted-foreground text-xs font-medium">Порядок Cold</p>
                            <div className="overflow-hidden rounded-lg border">
                              {coldStartIds.map((id, index) => {
                                const label = config.sequences[id]?.label?.trim() || id
                                const title = label === id ? id : `${label} · ${id}`
                                return (
                                  <div
                                    key={id}
                                    draggable={coldStartIds.length > 1}
                                    className={[
                                      'editor-seq-row',
                                      dragColdId === id ? 'is-dragging' : '',
                                      dragColdId && dropColdIndex === index ? 'is-drop-before' : '',
                                      dragColdId &&
                                      dropColdIndex === index + 1 &&
                                      index === coldStartIds.length - 1
                                        ? 'is-drop-after'
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    onDragStart={(e) => {
                                      if (!coldDragFromGrip.current || coldStartIds.length < 2) {
                                        e.preventDefault()
                                        return
                                      }
                                      setDragColdId(id)
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData('text/plain', `assembly-cold:${id}`)
                                    }}
                                    onDragEnd={() => {
                                      coldDragFromGrip.current = false
                                      setDragColdId(null)
                                      setDropColdIndex(null)
                                    }}
                                    onDragOver={(e) => {
                                      if (!dragColdId) return
                                      e.preventDefault()
                                      e.dataTransfer.dropEffect = 'move'
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      const before = e.clientY < rect.top + rect.height / 2
                                      setDropColdIndex(before ? index : index + 1)
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault()
                                      const raw = e.dataTransfer.getData('text/plain')
                                      const fromId = raw.startsWith('assembly-cold:')
                                        ? raw.slice('assembly-cold:'.length)
                                        : dragColdId
                                      const to = dropColdIndex ?? index
                                      if (fromId) reorderColdStart(fromId, to)
                                      setDragColdId(null)
                                      setDropColdIndex(null)
                                    }}
                                  >
                                    <div className="editor-seq h-auto min-h-10 justify-start whitespace-normal font-normal flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                                      {coldStartIds.length > 1 ? (
                                        <span
                                          className="editor-seq-grip"
                                          aria-hidden
                                          title="Перетащить"
                                          onClick={(e) => e.stopPropagation()}
                                          onPointerDown={() => {
                                            coldDragFromGrip.current = true
                                          }}
                                          onPointerUp={() => {
                                            coldDragFromGrip.current = false
                                          }}
                                          onPointerCancel={() => {
                                            coldDragFromGrip.current = false
                                          }}
                                        >
                                          <GripVertical />
                                        </span>
                                      ) : null}
                                      <span className="editor-seq-copy">
                                        <span title={title}>
                                          {index + 1}. {label}
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="text-amber-700 dark:text-amber-400 mt-3 text-xs">
                            Cold пока пуст — отметьте обзорные блоки (лечение, питание, досуг…), иначе при
                            «только имя» в autoplay останутся лишь start и end.
                          </p>
                        )}
                        {coldStartIds.length > 0 && !isColdStartPreview ? (
                          <p className="text-amber-700 dark:text-amber-400 mt-2 text-xs">
                            Сейчас cold не используется в превью: в «Профиль гостя» заданы тип компании /
                            темы / возражения. Очистите их, чтобы увидеть cold-start.
                          </p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <CardTitle>Результат макет-сборки</CardTitle>
                      <CardDescription>
                        {adaptiveEnabled
                          ? isColdStartPreview
                            ? 'Режим cold-start: только имя — тело из списка Cold.'
                            : 'Preview отбора по параметрам гостя. При выдаче ссылки гость получит этот порядок.'
                          : 'Порядок autoplay шаблона. Перетащите за grip — это и есть flow.'}
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={includedSimulation.length === 0}
                      title="Просмотр презентации с текущим порядком сборки"
                      onClick={() => {
                        setAssemblyPreviewKey((k) => k + 1)
                        setAssemblyPreviewOpen(true)
                      }}
                    >
                      <Play data-icon="inline-start" aria-hidden fill="currentColor" strokeWidth={0} />
                      Превью
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!adaptiveEnabled ? (
                    <div className="overflow-hidden rounded-lg border">
                      {includedSimulation.length === 0 ? (
                        <p className="text-muted-foreground px-3 py-4 text-sm">В autoplay пока нет блоков.</p>
                      ) : null}
                      {includedSimulation.map((entry, index) => (
                        <div
                          key={entry.id}
                          draggable={includedSimulation.length > 1}
                          className={[
                            'editor-seq-row has-draft-actions',
                            dragFlowId === entry.id ? 'is-dragging' : '',
                            dragFlowId && dropFlowIndex === index ? 'is-drop-before' : '',
                            dragFlowId &&
                            dropFlowIndex === index + 1 &&
                            index === includedSimulation.length - 1
                              ? 'is-drop-after'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onDragStart={(e) => {
                            if (!flowDragFromGrip.current || includedSimulation.length < 2) {
                              e.preventDefault()
                              return
                            }
                            setDragFlowId(entry.id)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', `assembly-flow:${entry.id}`)
                          }}
                          onDragEnd={() => {
                            flowDragFromGrip.current = false
                            setDragFlowId(null)
                            setDropFlowIndex(null)
                          }}
                          onDragOver={(e) => {
                            if (!dragFlowId) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            const rect = e.currentTarget.getBoundingClientRect()
                            const before = e.clientY < rect.top + rect.height / 2
                            setDropFlowIndex(before ? index : index + 1)
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            const raw = e.dataTransfer.getData('text/plain')
                            const fromId = raw.startsWith('assembly-flow:')
                              ? raw.slice('assembly-flow:'.length)
                              : dragFlowId
                            const to = dropFlowIndex ?? index
                            if (fromId) reorderFlow(fromId, to)
                            setDragFlowId(null)
                            setDropFlowIndex(null)
                          }}
                        >
                          <div className="editor-seq h-auto min-h-12 justify-start whitespace-normal font-normal flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                            {includedSimulation.length > 1 ? (
                              <span
                                className="editor-seq-grip"
                                aria-hidden
                                title="Перетащить"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={() => {
                                  flowDragFromGrip.current = true
                                }}
                                onPointerUp={() => {
                                  flowDragFromGrip.current = false
                                }}
                                onPointerCancel={() => {
                                  flowDragFromGrip.current = false
                                }}
                              >
                                <GripVertical />
                              </span>
                            ) : null}
                            <span className="editor-seq-copy">
                              <span>
                                {index + 1}. {entry.label}
                              </span>
                              <small>{entry.durationSec.toFixed(1)}с</small>
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="editor-seq-place"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectBlock(entry.id)
                            }}
                          >
                            Медиа
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="editor-seq-place"
                            onClick={(e) => {
                              e.stopPropagation()
                              openBlockParams(entry.id)
                            }}
                          >
                            Параметры
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="editor-seq-place is-danger"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFlowIncludes(entry.id, false)
                            }}
                          >
                            Убрать
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    includedSimulation.map((entry, index) => {
                      const priority =
                        config.constructorV2?.sequenceMetaById?.[entry.id]?.priority ?? 3
                      return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-primary/50 bg-primary/5 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge>{index + 1}</Badge>
                            <span className="truncate font-medium">{entry.label}</span>
                          </div>
                          <span className="text-muted-foreground text-xs">
                            {entry.durationSec.toFixed(1)}с · score {entry.score}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                          {entry.reason ? (
                            <p className="text-muted-foreground min-w-0 flex-1 text-sm">{entry.reason}</p>
                          ) : (
                            <span className="min-w-0 flex-1" />
                          )}
                          <PriorityPagination
                            value={priority}
                            maxPriority={maxBlockPriority}
                            onChange={(next) => setBlockPriority(entry.id, next)}
                            className="shrink-0"
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => selectBlock(entry.id)}
                          >
                            Медиа
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openBlockParams(entry.id)}
                          >
                            Параметры
                          </Button>
                        </div>
                      </div>
                      )
                    })
                  )}
                  {excludedSimulation.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        Вне autoplay
                      </p>
                      {excludedSimulation.map((entry) => {
                        const priority =
                          config.constructorV2?.sequenceMetaById?.[entry.id]?.priority ?? 3
                        return (
                        <div
                          key={entry.id}
                          className="rounded-lg border p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant="outline">out</Badge>
                              <span className="truncate font-medium">{entry.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">
                                {entry.durationSec.toFixed(1)}с · {entry.placement}
                                {adaptiveEnabled ? ` · score ${entry.score}` : null}
                              </span>
                              {!adaptiveEnabled ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setFlowIncludes(entry.id, true)
                                  }}
                                >
                                  В autoplay
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          {adaptiveEnabled ? (
                            <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                              {entry.reason ? (
                                <p className="text-muted-foreground min-w-0 flex-1 text-sm">{entry.reason}</p>
                              ) : (
                                <span className="min-w-0 flex-1" />
                              )}
                              <PriorityPagination
                                value={priority}
                                maxPriority={maxBlockPriority}
                                onChange={(next) => setBlockPriority(entry.id, next)}
                                className="shrink-0"
                              />
                            </div>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => selectBlock(entry.id)}
                            >
                              Медиа
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openBlockParams(entry.id)}
                            >
                              Параметры
                            </Button>
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-dashed p-3">
                    <p className="font-medium">Итог</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {adaptiveEnabled
                        ? 'При выдаче ссылки runtime возьмёт этот порядок из правил сборки.'
                        : 'Гость увидит блоки выше в этом порядке — без пересборки.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {adaptiveEnabled ? (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setConfig(applyDerivedFlow(config, derivedFlowIds))}
                        >
                          Записать этот порядок в шаблон
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {adaptiveEnabled ? (
                <Card className="overflow-hidden xl:col-start-3">
                  <CardHeader>
                    <CardTitle>Профиль гостя</CardTitle>
                    <CardDescription>
                      Как при выдаче ссылки. Превью сборки обновится сразу.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Имя гостя</span>
                      <Input
                        value={summary.guestName}
                        onChange={(e) => setSummary((prev) => ({ ...prev, guestName: e.target.value }))}
                        placeholder="Пусто — как будто amo не передала имя"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Тип компании</span>
                      <SingleTagCombobox
                        options={AUDIENCE_TAG_OPTIONS}
                        value={summary.partyType}
                        onValueChange={(partyType) => setSummary((prev) => ({ ...prev, partyType }))}
                        placeholder="Выберите аудиторию…"
                        aria-label="Тип компании"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Номер / категория</span>
                      <SingleTagCombobox
                        options={ROOM_TAG_OPTIONS}
                        value={summary.room}
                        onValueChange={(room) => setSummary((prev) => ({ ...prev, room }))}
                        placeholder="Выберите категорию…"
                        aria-label="Номер / категория"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Даты</span>
                      <Input
                        value={summary.dates}
                        onChange={(e) => setSummary((prev) => ({ ...prev, dates: e.target.value }))}
                        placeholder="с 19 сентября на 14 дней"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Темы</span>
                      <TagsCombobox
                        options={TOPIC_TAG_OPTIONS}
                        value={parseSummaryCsv(summary.topics)}
                        onValueChange={(topics) =>
                          setSummary((prev) => ({ ...prev, topics: topics.join(', ') }))
                        }
                        emptyLabel="Не выбрано"
                        placeholder="Добавить тему…"
                        aria-label="Темы"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Возражения</span>
                      <TagsCombobox
                        options={OBJECTION_TAG_OPTIONS}
                        value={parseSummaryCsv(summary.objections)}
                        onValueChange={(objections) =>
                          setSummary((prev) => ({ ...prev, objections: objections.join(', ') }))
                        }
                        emptyLabel="Не выбрано"
                        placeholder="Добавить возражение…"
                        aria-label="Возражения"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Дожим непокрытых тем</span>
                      <NativeSelect
                        value={summary.fillRemaining}
                        onChange={(e) =>
                          setSummary((prev) => ({
                            ...prev,
                            fillRemaining: e.target.value as GuestSummary['fillRemaining'],
                          }))
                        }
                        className="w-full"
                        title="Если после основной сборки осталось место — добавить блоки из групп, о которых ещё не говорили (лечение, питание, wellness…)"
                      >
                        <NativeSelectOption value="off">Выкл — только по параметрам гостя</NativeSelectOption>
                        <NativeSelectOption value="soft">Мягкий — до 3 блоков</NativeSelectOption>
                        <NativeSelectOption value="aggressive">До лимита блоков / секунд</NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">Уверенность</span>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={summary.confidence}
                        onChange={(e) =>
                          setSummary((prev) => ({ ...prev, confidence: e.target.value }))
                        }
                        placeholder="0.8"
                      />
                    </label>
                    <Collapsible
                      className="group/dev"
                      open={developerJsonOpen}
                      onOpenChange={(open) => {
                        setDeveloperJsonOpen(open)
                        if (open) {
                          setSummaryImportJson(guestSummaryToImportJson(summary))
                          setSummaryImportError(null)
                        }
                      }}
                    >
                      <CollapsibleTrigger className="text-muted-foreground flex w-full items-center justify-between gap-1 text-sm outline-none hover:text-foreground">
                        Для разработчиков
                        <ChevronDown className="size-3.5 transition-transform group-data-[open]/dev:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="overflow-hidden pt-2">
                        <div className="grid gap-2 rounded-lg border border-dashed p-3">
                          <label className="grid gap-1 text-sm">
                            <span className="text-muted-foreground">JSON профиля</span>
                            <Textarea
                              value={summaryImportJson}
                              onChange={(e) => {
                                setSummaryImportJson(e.target.value)
                                if (summaryImportError) setSummaryImportError(null)
                              }}
                              placeholder={`{\n  "guestName": "Иван",\n  "dates": "с 19 сентября",\n  "partyType": "solo",\n  "room": "single",\n  "topics": "room, food, price",\n  "objections": "dates-not-fixed, room-fit",\n  "confidence": "0.75",\n  "fillRemaining": "soft"\n}`}
                              className="min-h-[140px] font-mono text-xs"
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const result = parseGuestSummaryImport(summaryImportJson)
                                if (!result.ok) {
                                  setSummaryImportError(result.error)
                                  return
                                }
                                setSummary(result.summary)
                                setSummaryImportError(null)
                                setSummaryImportJson(guestSummaryToImportJson(result.summary))
                              }}
                            >
                              Импортировать
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSummaryImportJson(guestSummaryToImportJson(summary))
                                setSummaryImportError(null)
                              }}
                            >
                              Подставить текущий
                            </Button>
                          </div>
                          {summaryImportError ? (
                            <p className="text-destructive text-xs">{summaryImportError}</p>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              Лишние ключи (evidence, sources…) игнорируются. name → guestName, topics/objections можно массивом.
                            </p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
              ) : null}
            </div>
        </TabsContent>


        <TabsContent
          value="menus"
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-[900px]:overflow-y-auto"
        >
            <div className="grid min-h-0 flex-1 gap-4 max-[900px]:grid-cols-1 min-[901px]:min-h-0 min-[901px]:grid-cols-[300px_minmax(0,1fr)]">
              <div className="min-h-0 space-y-4 overflow-y-auto max-[900px]:overflow-visible">
                {menus.map((menu) => {
                  const selected = previewMenu?.id === menu.id
                  const inMenuIds = new Set(menu.branches.map((branch) => branch.sequenceId))
                  const addCandidates = libraryBlockIds.filter((id) => !inMenuIds.has(id))
                  return (
                    <Card
                      key={menu.id}
                      className={`overflow-hidden transition ${
                        selected ? 'border-primary ring-2 ring-primary/20' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setPreviewMenuId(menu.id)}
                      >
                        <CardHeader>
                          <CardTitle>{menu.label}</CardTitle>
                          <CardDescription>
                            Перетащите разделы · {menu.branches.length} в меню
                          </CardDescription>
                        </CardHeader>
                      </button>
                      <CardContent className="space-y-3">
                        <div className="overflow-hidden rounded-lg border">
                          {menu.branches.length === 0 ? (
                            <p className="text-muted-foreground px-3 py-4 text-sm">
                              Пока нет привязанных разделов.
                            </p>
                          ) : null}
                          {menu.branches.map((branch, index) => {
                            const seq = config.sequences[branch.sequenceId]
                            const label = seq?.label ?? branch.label
                            const dragging =
                              dragMenuBranch?.menuId === menu.id &&
                              dragMenuBranch.sequenceId === branch.sequenceId
                            return (
                              <div
                                key={branch.id}
                                draggable={menu.branches.length > 1}
                                className={[
                                  'editor-seq-row has-draft-actions',
                                  dragging ? 'is-dragging' : '',
                                  dragMenuBranch?.menuId === menu.id &&
                                  dropMenuBranchIndex === index
                                    ? 'is-drop-before'
                                    : '',
                                  dragMenuBranch?.menuId === menu.id &&
                                  dropMenuBranchIndex === index + 1 &&
                                  index === menu.branches.length - 1
                                    ? 'is-drop-after'
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                onDragStart={(e) => {
                                  if (!menuBranchDragFromGrip.current || menu.branches.length < 2) {
                                    e.preventDefault()
                                    return
                                  }
                                  setPreviewMenuId(menu.id)
                                  setDragMenuBranch({ menuId: menu.id, sequenceId: branch.sequenceId })
                                  e.dataTransfer.effectAllowed = 'move'
                                  e.dataTransfer.setData(
                                    'text/plain',
                                    `menu-branch:${menu.id}:${branch.sequenceId}`,
                                  )
                                }}
                                onDragEnd={() => {
                                  menuBranchDragFromGrip.current = false
                                  setDragMenuBranch(null)
                                  setDropMenuBranchIndex(null)
                                }}
                                onDragOver={(e) => {
                                  if (!dragMenuBranch || dragMenuBranch.menuId !== menu.id) return
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const before = e.clientY < rect.top + rect.height / 2
                                  setDropMenuBranchIndex(before ? index : index + 1)
                                }}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  const raw = e.dataTransfer.getData('text/plain')
                                  const prefix = `menu-branch:${menu.id}:`
                                  const fromId = raw.startsWith(prefix)
                                    ? raw.slice(prefix.length)
                                    : dragMenuBranch?.menuId === menu.id
                                      ? dragMenuBranch.sequenceId
                                      : null
                                  const to = dropMenuBranchIndex ?? index
                                  if (fromId) reorderMenuBranches(menu.id, fromId, to)
                                  setDragMenuBranch(null)
                                  setDropMenuBranchIndex(null)
                                }}
                              >
                                <div className="editor-seq flex h-auto min-h-12 min-w-0 flex-1 items-center gap-1.5 justify-start px-2.5 whitespace-normal font-normal">
                                  {menu.branches.length > 1 ? (
                                    <span
                                      className="editor-seq-grip"
                                      aria-hidden
                                      title="Перетащить"
                                      onPointerDown={() => {
                                        menuBranchDragFromGrip.current = true
                                      }}
                                      onPointerUp={() => {
                                        menuBranchDragFromGrip.current = false
                                      }}
                                      onPointerCancel={() => {
                                        menuBranchDragFromGrip.current = false
                                      }}
                                    >
                                      <GripVertical />
                                    </span>
                                  ) : null}
                                  <span className="editor-seq-copy">
                                    <span>
                                      {index + 1}. {label}
                                    </span>
                                    <small>
                                      {seq ? `${sequenceDuration(seq).toFixed(1)}с` : branch.sequenceId}
                                    </small>
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="editor-seq-place is-danger"
                                  onClick={() => setBlockPlacement(branch.sequenceId, 'none')}
                                >
                                  Убрать
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                        {addCandidates.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                              Добавить в меню
                            </p>
                            {addCandidates.map((id) => {
                              const seq = config.sequences[id]
                              if (!seq) return null
                              const placement = placementForId(config, id)
                              return (
                                <div
                                  key={id}
                                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{seq.label}</p>
                                    <p className="text-muted-foreground text-xs">
                                      {placement === 'flow'
                                        ? 'сейчас в автопоказе'
                                        : placement === 'menu'
                                          ? 'в другом меню'
                                          : 'не в сценарии'}
                                      {' · '}
                                      {sequenceDuration(seq).toFixed(1)}с
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    onClick={() => {
                                      setPreviewMenuId(menu.id)
                                      setBlockPlacement(id, 'menu', menu.id)
                                    }}
                                  >
                                    В меню
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  )
                })}
                {menus.length === 0 ? (
                  <p className="text-muted-foreground text-sm">В шаблоне пока нет экранов меню.</p>
                ) : null}
              </div>
              {previewMenu ? (
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-4 max-[900px]:h-auto max-[900px]:overflow-visible min-[901px]:h-full">
                  <div className="min-h-0 flex-1 max-[900px]:h-auto">
                  <MenuInspector
                    projectCode={projectCode}
                    menuId={previewMenu.id}
                    brand={config.brand}
                    guestName={config.defaultGuestName}
                    branches={previewMenu.branches}
                    menuCopy={previewMenu.menuCopy}
                    menuTheme={previewMenu.menuTheme}
                    menuLinks={previewMenu.menuLinks}
                    menuBgSrc={previewMenu.menuBgSrc}
                    menuTtsText={previewMenu.menuTtsText}
                    menuTtsSrc={previewMenu.menuTtsSrc}
                    menuTtsHash={previewMenu.menuTtsHash}
                    menuTtsFirstOnly={previewMenu.menuTtsFirstOnly}
                    ttsFiles={ttsFiles}
                    ttsVolume={theme.ttsVolume}
                    isLandscape={menuPreviewLandscape}
                    refreshTts={refreshTts}
                    onMenuCopyChange={(menuCopy) =>
                      setConfig((prev) => updateMenu(prev, previewMenu.id, { menuCopy }))
                    }
                    onBrandPatch={(patch) =>
                      setConfig((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } }))
                    }
                    onMenuBgChange={(menuBgSrc) =>
                      setConfig((prev) => updateMenu(prev, previewMenu.id, { menuBgSrc }))
                    }
                    onMenuThemePatch={(patch) =>
                      setConfig((prev) => {
                        const menu = resolveMenu(prev, previewMenu.id)
                        return updateMenu(prev, previewMenu.id, {
                          menuTheme: { ...normalizeMenuTheme(menu.menuTheme), ...patch },
                        })
                      })
                    }
                    onMenuLinksChange={(menuLinks) =>
                      setConfig((prev) => updateMenu(prev, previewMenu.id, { menuLinks }))
                    }
                    onMenuTtsPatch={(patch) =>
                      setConfig((prev) => updateMenu(prev, previewMenu.id, patch))
                    }
                    onMenuTtsFirstOnlyChange={(menuTtsFirstOnly) =>
                      setConfig((prev) => updateMenu(prev, previewMenu.id, { menuTtsFirstOnly }))
                    }
                  />
                  </div>
                </div>
              ) : (
                <Card className="overflow-hidden">
                  <CardContent className="py-6">
                    <p className="text-muted-foreground text-sm">Нет меню для превью и настройки.</p>
                  </CardContent>
                </Card>
              )}
            </div>
        </TabsContent>

        {isAdmin ? (
          <TabsContent
            value="ai"
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <Card className="overflow-hidden">
              <CardContent className="p-4 sm:p-6">
                <AiGenerationParamsPanel
                  brand={config.brand}
                  copyFacts={config.copyFacts}
                  onCopyFactsChange={(copyFacts) =>
                    setConfig((prev) => ({ ...prev, copyFacts }))
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

      </Tabs>

      {assemblyPreviewOpen ? (
        <div
          className="block-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Превью сборки"
          onClick={() => setAssemblyPreviewOpen(false)}
        >
          <div className="block-preview-full" onClick={(e) => e.stopPropagation()}>
            <div
              className={`block-preview-phone is-full-play${
                theme.orientation === 'landscape' ? ' is-landscape' : ''
              }`}
            >
              <Presentation
                key={`assembly-preview-${assemblyPreviewKey}-${theme.orientation}`}
                property={assemblyPreviewConfig}
                guestNameOverride={summary.guestName || config.defaultGuestName}
                embedded
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setAssemblyPreviewOpen(false)}>
              Закрыть предпросмотр
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
