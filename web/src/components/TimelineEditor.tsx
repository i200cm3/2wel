import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  EllipsisVertical,
  GripVertical,
  Images,
  Mail,
  Play,
  Plus,
  Redo2,
  Settings,
  Undo2,
  X,
} from 'lucide-react'
import { fillName, fillNameOptional } from '../content'
import { useClipResize } from '../hooks/useClipResize'
import { useCueDrag } from '../hooks/useCueDrag'
import { useEditorHistory } from '../hooks/useEditorHistory'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { downloadPropertyJson, isPropertyConfig, readPropertyJsonFile } from '../hooks/usePropertyConfig'
import { useTtsLibrary, type TtsLibrary } from '../hooks/useTtsLibrary'
import { downloadTemplateArchive, importTemplateArchive } from '../lib/api'
import {
  DEFAULT_UPLOAD_FOLDER,
  dataTransferHasFiles,
  libraryFilesFromDataTransfer,
  isMediaFile,
  deleteMediaFile,
  probeVideoDuration,
  uploadMediaFiles,
} from '../lib/mediaUpload'
import {
  buildTtsTextFromCaption,
  generateTts,
  speakTextForTts,
} from '../lib/ttsGenerate'
import { ttsPlaybackUrl } from '../lib/ttsUrl'
import {
  DEFAULT_MOTION,
  DEFAULT_EASING,
  DEFAULT_TRANSITION,
  clipMediaKind,
  createMenuScreen,
  getDefaultMenuId,
  isVideoSrc,
  listMenus,
  newClipId,
  newCueId,
  newMenuId,
  newSequenceId,
  normalizeCue,
  normalizeProperty,
  migrateSequenceCues,
  pathFromPreset,
  resolveMenu,
  resolveReturnMenuId,
  sequenceDuration,
  withReturnMenu,
  type MenuScreenConfig,
  type MotionPath,
  type MotionPreset,
  type PropertyBranch,
  type PropertyConfig,
  type EmailPreviewConfig,
  type PropertyTheme,
  type StoryClip,
  type StoryCue,
  type StorySequence,
  captionBarStyle,
  normalizeMenuTheme,
  normalizeTheme,
  updateMenu,
  withMenus,
} from '../types/story'

function mapMenuBranches(
  config: PropertyConfig,
  mapFn: (branches: PropertyBranch[]) => PropertyBranch[],
): PropertyConfig {
  const source =
    config.menus && Object.keys(config.menus).length > 0
      ? config.menus
      : Object.fromEntries(listMenus(config).map((m) => [m.id, m]))
  const menus: Record<string, MenuScreenConfig> = {}
  for (const [id, menu] of Object.entries(source)) {
    menus[id] = { ...menu, branches: mapFn(menu.branches) }
  }
  return withMenus(config, menus, config.defaultMenuId)
}

/** Первый блок автопоказа — не Object.keys (у jsonb порядок алфавитный). */
function preferredEditorSeqId(config: PropertyConfig): string {
  const sequences = config.sequences ?? {}
  for (const id of config.flow ?? []) {
    if (sequences[id]) return id
  }
  if (sequences.greeting) return 'greeting'
  if (sequences.intro) return 'intro'
  return Object.keys(sequences)[0] ?? 'intro'
}
import { viewAspectFor } from '../lib/cropMath'
import { guestShareUrl } from '../lib/utils'
import {
  Badge,
} from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { EmailPreviewInspector } from './editor/EmailPreviewInspector'
import { MenuInspector } from './editor/MenuInspector'
import { AiGenerationParamsPanel } from './editor/AiGenerationParamsPanel'
import { Presentation } from './Presentation'
import { StoryPlayer } from './StoryPlayer'
import { ClipInspector } from './editor/ClipInspector'
import { CueInspector } from './editor/CueInspector'
import { LibrarySheet } from './editor/LibrarySheet'
import { TimelineTracks } from './editor/TimelineTracks'
import { TrackContextMenu } from './editor/TrackContextMenu'
import { projectAudioItems, type InspectorTab, type LibraryTab, type TrackContextMenuState } from './editor/editorTypes'
import {
  FRAME_SEC,
  PX_PER_SEC_DEFAULT,
  PX_PER_SEC_MAX,
  PX_PER_SEC_MIN,
  PX_PER_SEC_STEP,
  TIMELINE_LABEL_PX,
  clipAtTime,
  copyText,
  cueEndSec,
  fitTimelinePxPerSec,
  isModCode,
  isTypingTarget,
  packCuesLeftToRight,
  resolveCueOverlaps,
  sliderNumber,
  syncClipsToCues,
  timelineAddTailPx,
} from './editor/timelineMath'
import './TimelineEditor.css'

type Props = {
  config: PropertyConfig
  onChange: (next: PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)) => void
  onReset?: () => void
  /** Встроенный редактор одного блока (Constructor V2). */
  blockPanel?: boolean
  blockSeqId?: string
  isAdmin?: boolean
  hasDraft?: boolean
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
  publishState?: 'idle' | 'saving' | 'saved' | 'error'
  saveError?: string | null
  publishError?: string | null
  draftError?: string | null
  published?: boolean
  lastShareUrl?: string | null
  projectCode: string
  templateCode: string
  /** Отображаемое имя шаблона (не brand объекта). */
  templateName?: string
  /** Общая библиотека TTS с родителя — без повторной загрузки всех файлов. */
  ttsLibrary?: TtsLibrary
  onSave?: () => void
  onPublish?: () => void
  onRetryDraft?: () => void
}

function mediaSrcKey(src: string | undefined): string {
  const trimmed = src?.trim() ?? ''
  return trimmed.startsWith('/media/projects/') ? (trimmed.split(/[?#]/)[0] ?? trimmed) : trimmed
}

export function TimelineEditor({
  config,
  onChange: persistChange,
  onReset,
  blockPanel = false,
  blockSeqId,
  isAdmin = false,
  hasDraft = false,
  saveState = 'idle',
  publishState = 'idle',
  saveError = null,
  publishError = null,
  draftError = null,
  published = true,
  lastShareUrl = null,
  projectCode,
  templateCode,
  templateName,
  ttsLibrary: sharedTtsLibrary,
  onSave,
  onPublish,
  onRetryDraft,
}: Props) {
  const history = useEditorHistory(config, persistChange, `${projectCode}:${config.id}`)
  const onChange = history.commit
  const isBlockPanel = blockPanel === true
  const seqIds = useMemo(() => Object.keys(config.sequences), [config.sequences])
  const flowIds = useMemo(
    () => config.flow.filter((id) => config.sequences[id]),
    [config.flow, config.sequences],
  )
  useEffect(() => {
    if (!isBlockPanel || !blockSeqId) return
    setSeqId(blockSeqId)
    setSelectedMenuId(null)
    setPreviewSelected(false)
    setBlockPreviewId(null)
  }, [isBlockPanel, blockSeqId])

  const menusList = useMemo(() => listMenus(config), [config])
  const [seqId, setSeqId] = useState(() =>
    blockPanel && blockSeqId ? blockSeqId : preferredEditorSeqId(config),
  )
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null)
  const [sectionsMenuId, setSectionsMenuId] = useState(() => getDefaultMenuId(config))
  const menuSelected = selectedMenuId != null
  const selectedMenu = selectedMenuId ? resolveMenu(config, selectedMenuId) : null
  const selectedMenuIdRef = useRef(selectedMenuId)
  selectedMenuIdRef.current = selectedMenuId
  const sectionsMenu = useMemo(
    () => resolveMenu(config, sectionsMenuId),
    [config, sectionsMenuId],
  )
  const menuIds = useMemo(
    () => sectionsMenu.branches.map((b) => b.sequenceId).filter((id) => config.sequences[id]),
    [sectionsMenu.branches, config.sequences],
  )
  const allMenuSeqIds = useMemo(() => {
    const ids = new Set<string>()
    for (const menu of menusList) {
      for (const b of menu.branches) {
        if (config.sequences[b.sequenceId]) ids.add(b.sequenceId)
      }
    }
    return ids
  }, [menusList, config.sequences])
  const otherIds = useMemo(() => {
    const used = new Set([...flowIds, ...allMenuSeqIds])
    return seqIds.filter((id) => !used.has(id))
  }, [seqIds, flowIds, allMenuSeqIds])
  const [menuTtsArmed, setMenuTtsArmed] = useState(false)
  const [previewSelected, setPreviewSelected] = useState(false)
  const [awaitingPreviewPick, setAwaitingPreviewPick] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [slidePreview, setSlidePreview] = useState(false)
  const [slidePreviewKey, setSlidePreviewKey] = useState(0)
  const slidePreviewClipsRef = useRef<StoryClip[] | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminWorkspace, setAdminWorkspace] = useState<'editor' | 'ai'>('editor')
  const [blockPreviewId, setBlockPreviewId] = useState<string | null>(null)
  const [blockPreviewKey, setBlockPreviewKey] = useState(0)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [fullPreviewKey, setFullPreviewKey] = useState(0)
  const [libFolders, setLibFolders] = useState<string[]>([])
  const [libPhotoQuery, setLibPhotoQuery] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('photos')
  const [mediaUrlOpen, setMediaUrlOpen] = useState(false)
  const [mediaUrlDraft, setMediaUrlDraft] = useState('')
  const [mediaUrlError, setMediaUrlError] = useState<string | null>(null)
  const [libPreviewSrc, setLibPreviewSrc] = useState<string | null>(null)
  const [libDragSrc, setLibDragSrc] = useState<string | null>(null)
  const [libDropClipId, setLibDropClipId] = useState<string | null>(null)
  const [libDropOnPreview, setLibDropOnPreview] = useState(false)
  const [awaitingClipAdd, setAwaitingClipAdd] = useState(false)
  const [libFileHover, setLibFileHover] = useState(false)
  const [libUploading, setLibUploading] = useState(false)
  const [libUploadError, setLibUploadError] = useState<string | null>(null)
  const [libFocusSrcs, setLibFocusSrcs] = useState<string[]>([])
  const [trackCtx, setTrackCtx] = useState<TrackContextMenuState | null>(null)
  const reelScrollRef = useRef<HTMLDivElement>(null)
  const [pxPerSec, setPxPerSec] = useState(PX_PER_SEC_DEFAULT)
  const pxPerSecRef = useRef(PX_PER_SEC_DEFAULT)
  const zoomAnchorRef = useRef<{ sec: number; viewX: number } | null>(null)

  const applyTimelineZoom = useCallback((next: number, clientX?: number) => {
    const clamped = Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, Math.round(next)))
    const prev = pxPerSecRef.current
    if (clamped === prev) return
    const root = reelScrollRef.current
    if (root) {
      const rect = root.getBoundingClientRect()
      const viewX = clientX != null ? clientX - rect.left : root.clientWidth / 2
      const sec = Math.max(0, (root.scrollLeft + viewX - TIMELINE_LABEL_PX) / prev)
      zoomAnchorRef.current = { sec, viewX }
    }
    pxPerSecRef.current = clamped
    setPxPerSec(clamped)
  }, [])

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    const root = reelScrollRef.current
    if (!anchor || !root) return
    zoomAnchorRef.current = null
    root.scrollLeft = Math.max(0, anchor.sec * pxPerSec + TIMELINE_LABEL_PX - anchor.viewX)
  }, [pxPerSec])
  const skipNextLibPickRef = useRef(false)
  const libClickTimer = useRef<number | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const libFileInputRef = useRef<HTMLInputElement>(null)
  const libAudioRef = useRef<HTMLAudioElement | null>(null)
  const [libAudioSrc, setLibAudioSrc] = useState<string | null>(null)
  const [libAudioPlaying, setLibAudioPlaying] = useState(false)
  const [libAudioDurations, setLibAudioDurations] = useState<Record<string, number>>({})
  const [archiveImporting, setArchiveImporting] = useState(false)
  const [archiveProgress, setArchiveProgress] = useState<{
    phase: 'uploading' | 'processing' | 'preparing' | 'downloading'
    percent: number
  } | null>(null)
  const [archiveExporting, setArchiveExporting] = useState(false)
  const [ttsBatchBusy, setTtsBatchBusy] = useState(false)
  const [ttsBatchProgress, setTtsBatchProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const { manifest, error: libError, reload: reloadLibrary, setManifest } = useMediaLibrary(projectCode)
  const localTtsLibrary = useTtsLibrary(sharedTtsLibrary ? '' : projectCode)
  const {
    files: ttsFiles,
    durations: ttsDurations,
    error: ttsError,
    refresh: refreshTts,
    ensureFile: ensureTtsFile,
  } = sharedTtsLibrary ?? localTtsLibrary

  const blockPlacement: 'flow' | 'menu' | 'none' = flowIds.includes(seqId)
    ? 'flow'
    : allMenuSeqIds.has(seqId)
      ? 'menu'
      : 'none'

  const targetMenuIdForSections = selectedMenuId ?? sectionsMenuId

  const setBlockPlacement = (
    id: string,
    placement: 'flow' | 'menu',
    menuIdArg?: string,
  ) => {
    onChange((config) => {
      const seq = config.sequences[id]
      if (!seq) return config
      const flow = config.flow.filter((x) => x !== id)
      let next = mapMenuBranches(config, (branches) => branches.filter((b) => b.sequenceId !== id))
      if (placement === 'flow') {
        return { ...next, flow: [...flow, id] }
      }
      const menuId = menuIdArg ?? selectedMenuIdRef.current ?? sectionsMenuId
      const branches = [
        ...resolveMenu(next, menuId).branches.filter((b) => b.sequenceId !== id),
        { id, label: seq.label, sequenceId: id },
      ]
      return { ...updateMenu(next, menuId, { branches }), flow }
    })
  }

  /** Убрать блок из меню / автопоказа → «Без показа» (сам блок не удаляется). */
  const removeFromPlacement = (id: string) => {
    onChange((config) => ({
      ...mapMenuBranches(config, (branches) => branches.filter((b) => b.sequenceId !== id)),
      flow: config.flow.filter((x) => x !== id),
    }))
  }

  /** Полностью удалить блок из объекта. */
  const deleteBlock = (id: string) => {
    const seq = config.sequences[id]
    if (!seq) return
    if (
      !confirm(
        `Удалить блок «${seq.label}»? Можно вернуть через Cmd+Z.`,
      )
    ) {
      return
    }
    const { [id]: _removed, ...rest } = config.sequences
    void _removed
    const sequences = Object.fromEntries(
      Object.entries(rest).map(([sid, s]) => {
        const endButtons = s.endButtons?.filter(
          (b) => !(b.target.kind === 'sequence' && b.target.sequenceId === id),
        )
        return [
          sid,
          {
            ...s,
            endButtons: endButtons?.length ? endButtons : undefined,
          },
        ]
      }),
    )
    const remainingIds = Object.keys(sequences)
    onChange({
      ...mapMenuBranches(
        { ...config, sequences },
        (branches) => branches.filter((b) => b.sequenceId !== id),
      ),
      flow: config.flow.filter((x) => x !== id),
    })
    if (seqId === id) {
      setSeqId(remainingIds[0] ?? '')
      setSelectedId(null)
      setSelectedMenuId(null)
      setSlidePreview(false)
    }
    if (blockPreviewId === id) setBlockPreviewId(null)
  }

  const addBlock = (placement: 'flow' | 'menu') => {
    const id = newSequenceId(placement === 'menu' ? 'menu' : 'flow')
    const label = placement === 'menu' ? 'Новый раздел' : 'Новый блок'
    const menuId = targetMenuIdForSections
    let seq: StorySequence = { id, label, clips: [] }
    if (placement === 'menu') seq = withReturnMenu(seq, menuId)
    const flow = config.flow.filter((x) => x !== id)
    let next: PropertyConfig = {
      ...config,
      sequences: { ...config.sequences, [id]: seq },
      flow: placement === 'flow' ? [...flow, id] : flow,
    }
    next = mapMenuBranches(next, (branches) => branches.filter((b) => b.sequenceId !== id))
    if (placement === 'menu') {
      next = updateMenu(next, menuId, {
        branches: [...resolveMenu(next, menuId).branches, { id, label, sequenceId: id }],
      })
    }
    onChange(next)
    setSeqId(id)
    setSelectedId(null)
    setSlidePreview(false)
    setSelectedMenuId(null)
  }

  /** Добавить существующий черновик в меню / автопоказ. */
  const placeExisting = (id: string, placement: 'flow' | 'menu', menuId?: string) => {
    setBlockPlacement(id, placement, menuId)
    if (placement === 'menu' && menuId) setSectionsMenuId(menuId)
    setSeqId(id)
    setSelectedId(null)
    setSlidePreview(false)
    setSelectedMenuId(null)
  }

  const reorderInList = (list: 'flow' | 'menu', fromId: string, toIndex: number) => {
    if (list === 'flow') {
      const from = config.flow.indexOf(fromId)
      if (from < 0) return
      let insertAt = Math.max(0, Math.min(toIndex, config.flow.length))
      const flow = [...config.flow]
      const [item] = flow.splice(from, 1)
      if (from < insertAt) insertAt -= 1
      flow.splice(insertAt, 0, item)
      onChange({ ...config, flow })
      return
    }
    const menuId = sectionsMenuId
    const branches = [...resolveMenu(config, menuId).branches]
    const from = branches.findIndex((b) => b.sequenceId === fromId)
    if (from < 0) return
    let insertAt = Math.max(0, Math.min(toIndex, branches.length))
    const [item] = branches.splice(from, 1)
    if (from < insertAt) insertAt -= 1
    branches.splice(insertAt, 0, item)
    onChange(updateMenu(config, menuId, { branches }))
  }

  const addMenuScreen = () => {
    const id = newMenuId()
    const menu = createMenuScreen({ id, label: 'Новое меню' })
    onChange(withMenus(config, { ...config.menus, [id]: menu }, config.defaultMenuId))
    setSelectedMenuId(id)
    setSectionsMenuId(id)
    setSelectedId(null)
    setSelectedCueId(null)
    setSlidePreview(false)
    setBlockPreviewId(null)
  }

  const renameMenuScreen = (menuId: string) => {
    const menu = resolveMenu(config, menuId)
    const next = window.prompt('Название меню', menu.label)?.trim()
    if (!next || next === menu.label) return
    onChange(updateMenu(config, menuId, { label: next }))
  }

  const deleteMenuScreen = (menuId: string) => {
    const menus = { ...(config.menus ?? {}) }
    const ids = Object.keys(menus)
    if (ids.length <= 1) {
      alert('Нельзя удалить последнее меню.')
      return
    }
    const menu = menus[menuId]
    if (!menu) return
    if (!confirm(`Удалить меню «${menu.label}»? Разделы останутся в «Без показа».`)) return
    delete menus[menuId]
    const nextDefault =
      config.defaultMenuId === menuId || !menus[config.defaultMenuId ?? '']
        ? Object.keys(menus)[0]
        : config.defaultMenuId
    const sequences = Object.fromEntries(
      Object.entries(config.sequences).map(([sid, s]) => {
        const endButtons = s.endButtons?.map((b) => {
          if (b.target.kind === 'menu' && b.target.menuId === menuId) {
            return { ...b, target: { kind: 'menu' as const, menuId: nextDefault } }
          }
          return b
        })
        return [sid, endButtons ? { ...s, endButtons } : s]
      }),
    )
    onChange(withMenus({ ...config, sequences }, menus, nextDefault))
    if (selectedMenuId === menuId) setSelectedMenuId(null)
    if (sectionsMenuId === menuId) setSectionsMenuId(nextDefault!)
  }

  const onImportJson = async (file: File | undefined) => {
    if (!file) return
    try {
      const next = await readPropertyJsonFile(file)
      onChange(next)
      setSeqId(preferredEditorSeqId(next))
      setSelectedId(null)
      setSlidePreview(false)
      setBlockPreviewId(null)
      setLibPreviewSrc(null)
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
      onChange(next)
      setSeqId(preferredEditorSeqId(next))
      setSelectedId(null)
      setSlidePreview(false)
      setBlockPreviewId(null)
      setLibPreviewSrc(null)
      await reloadLibrary()
      refreshTts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось импортировать архив')
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
      alert(err instanceof Error ? err.message : 'Не удалось экспортировать архив')
    } finally {
      setArchiveExporting(false)
      setArchiveProgress(null)
    }
  }

  const onGenerateAllTtsFromCaptions = useCallback(async () => {
    if (ttsBatchBusy) return
    const jobs: { sequenceId: string; cueId: string; draft: string; label: string }[] = []
    for (const [sequenceId, seq] of Object.entries(config.sequences)) {
      const cues = seq.cues ?? []
      for (const cue of cues) {
        const clip = clipAtTime(seq.clips, cue.startSec)
        const showTitle = clip?.showTitle !== false
        const draft = buildTtsTextFromCaption({
          caption: cue.text,
          sequenceTitle: seq.title,
          showTitle,
        })
        if (!draft) continue
        jobs.push({
          sequenceId,
          cueId: cue.id,
          draft,
          label: `${seq.label || sequenceId} · ${cue.id}`,
        })
      }
    }
    if (!jobs.length) {
      alert('Нет титров с текстом для озвучки')
      return
    }
    if (
      !confirm(
        `Сгенерировать озвучку для ${jobs.length} титров?\nТекст возьмётся из титров (и заголовка, если он показан). Уже существующие TTS будут перезаписаны.`,
      )
    ) {
      return
    }

    setTtsBatchBusy(true)
    setTtsBatchProgress({ done: 0, total: jobs.length })
    const sequences: PropertyConfig['sequences'] = Object.fromEntries(
      Object.entries(config.sequences).map(([id, seq]) => [
        id,
        {
          ...seq,
          cues: seq.cues?.map((cue) => ({ ...cue })),
        },
      ]),
    )
    const guestName = config.defaultGuestName || 'гость'
    let ok = 0
    const errors: string[] = []

    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!
        setTtsBatchProgress({ done: i, total: jobs.length })
        try {
          const speak = speakTextForTts(job.draft, guestName)
          const result = await generateTts(speak, { force: true, projectCode })
          const ttsSec = await ensureTtsFile(result.src, result.durationSec)
          const seq = sequences[job.sequenceId]
          const cue = seq?.cues?.find((item) => item.id === job.cueId)
          if (!cue) continue
          const durationSec =
            ttsSec != null && ttsSec > 0
              ? Math.max(cue.durationSec, Number(ttsSec.toFixed(3)))
              : cue.durationSec
          Object.assign(
            cue,
            normalizeCue({
              ...cue,
              ttsText: job.draft,
              ttsSrc: result.src,
              ttsHash: result.hash,
              durationSec,
            }),
          )
          ok += 1
        } catch (err) {
          errors.push(
            `${job.label}: ${err instanceof Error ? err.message : 'ошибка генерации'}`,
          )
        }
        setTtsBatchProgress({ done: i + 1, total: jobs.length })
      }

      for (const seq of Object.values(sequences)) {
        if (!seq.cues?.length) continue
        seq.cues = packCuesLeftToRight(seq.cues.map((c) => normalizeCue(c)))
        seq.clips = syncClipsToCues(seq.clips, seq.cues)
      }

      onChange((prev) => ({ ...prev, sequences }))
      window.setTimeout(() => refreshTts(), 400)

      const fail = jobs.length - ok
      const failNote =
        errors.length > 0
          ? `\n\nОшибки (${errors.length}):\n${errors.slice(0, 8).join('\n')}${
              errors.length > 8 ? '\n…' : ''
            }`
          : ''
      alert(
        fail > 0
          ? `Сгенерировано ${ok} из ${jobs.length}.${failNote}`
          : `Готово: озвучка для ${ok} титров.`,
      )
    } finally {
      setTtsBatchBusy(false)
      setTtsBatchProgress(null)
    }
  }, [
    ttsBatchBusy,
    config.sequences,
    config.defaultGuestName,
    projectCode,
    ensureTtsFile,
    onChange,
    refreshTts,
  ])

  const usedInProject = useMemo(() => {
    const srcs = new Set<string>()
    for (const seq of Object.values(config.sequences)) {
      for (const clip of seq.clips) {
        const src = mediaSrcKey(clip.src)
        if (src) srcs.add(src)
      }
    }
    return srcs
  }, [config.sequences])
  const curated = useMemo(() => [...usedInProject], [usedInProject])
  const folders = useMemo(() => {
    const list = [...(manifest?.folders ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label, 'ru', { sensitivity: 'base' }),
    )
    return [
      { id: 'curated', label: 'В блоках сейчас', srcs: curated },
      ...list,
    ]
  }, [manifest, curated])

  const librarySrcs = useMemo(() => {
    if (!libFolders.length) {
      const full = manifest?.items.map((i) => i.src) ?? []
      return [...curated, ...full.filter((s) => !curated.includes(s))]
    }
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of libFolders) {
      const folder = folders.find((f) => f.id === id)
      if (!folder) continue
      for (const src of folder.srcs) {
        if (seen.has(src)) continue
        seen.add(src)
        out.push(src)
      }
    }
    return out
  }, [libFolders, folders, manifest, curated])

  const filteredLibrarySrcs = useMemo(() => {
    const q = libPhotoQuery.trim().toLowerCase()
    if (!q) return librarySrcs
    const tokens = q.split(/\s+/).filter(Boolean)
    return librarySrcs.filter((src) => {
      const item = manifest?.items.find((entry) => entry.src === src)
      const path = item
        ? `${item.folder}/${item.name}`
        : src.replace(/^\/media\/(?:projects\/[^/]+\/)?library\//, '')
      const labels = folders
        .filter((folder) => folder.srcs.includes(src))
        .map((folder) => folder.label)
        .join(' ')
      const haystack = `${path} ${labels}`.toLowerCase()
      return tokens.every((token) => haystack.includes(token))
    })
  }, [libPhotoQuery, librarySrcs, folders, manifest])

  const libraryThumbUrl = (src: string) => {
    const mtime = manifest?.items.find((item) => item.src === src)?.mtime
    return typeof mtime === 'number' ? `${src}?v=${mtime}` : src
  }

  const libraryFileName = (src: string) => {
    const item = manifest?.items.find((entry) => entry.src === src)
    if (item?.folder && item.name) return `${item.folder}/${item.name}`
    try {
      return decodeURIComponent(src.split('?')[0] ?? src).replace(
        /^\/media\/(?:projects\/[^/]+\/)?library\//,
        '',
      )
    } catch {
      return src.replace(/^\/media\/(?:projects\/[^/]+\/)?library\//, '')
    }
  }

  const folderOptions = useMemo(
    () => folders.map((f) => ({ id: f.id, label: f.label, count: f.srcs.length })),
    [folders],
  )

  const usedAudioItems = useMemo(() => projectAudioItems(config, projectCode), [config, projectCode])
  const usedTtsItems = useMemo(
    () => usedAudioItems.filter((item) => item.kind === 'tts'),
    [usedAudioItems],
  )
  const musicItem = usedAudioItems.find((item) => item.kind === 'music')

  const libraryUploadFolder =
    libFolders.find((id) => id !== 'curated') ?? DEFAULT_UPLOAD_FOLDER

  const importLibraryFiles = useCallback(
    async (files: File[]) => {
      const media = files.filter(isMediaFile)
      if (!media.length) {
        setLibUploading(false)
        setLibUploadError('Нужны файлы JPG, PNG, WebP, MP4 или WebM')
        return
      }
      setLibUploadError(null)
      setLibUploading(true)
      try {
        const { srcs, manifest: next } = await uploadMediaFiles(
          projectCode,
          media,
          libraryUploadFolder,
        )
        if (next) setManifest(next)
        else await reloadLibrary()
        if (libFolders.length && !libFolders.includes(libraryUploadFolder)) {
          setLibFolders((prev) => [...prev.filter((id) => id !== 'curated'), libraryUploadFolder])
        }
        if (srcs.length) {
          setLibraryTab('photos')
          setLibFocusSrcs(srcs)
        }
        if (srcs.length && media.length < files.length) {
          setLibUploadError(`Добавлено ${srcs.length}, остальные файлы пропущены`)
        }
      } catch (err) {
        setLibUploadError(err instanceof Error ? err.message : 'Не удалось загрузить файлы')
      } finally {
        setLibUploading(false)
        if (libFileInputRef.current) libFileInputRef.current.value = ''
      }
    },
    [libFolders, libraryUploadFolder, projectCode, reloadLibrary, setManifest],
  )

  useEffect(() => {
    if (!libFocusSrcs.length || !libraryOpen || libraryTab !== 'photos') return
    const focusSrc = libFocusSrcs[libFocusSrcs.length - 1]
    if (!focusSrc || !librarySrcs.includes(focusSrc)) return
    const frame = window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-lib-src="${CSS.escape(focusSrc)}"]`,
      )
      if (!el) return
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      el.focus({ preventScroll: true })
    })
    const clear = window.setTimeout(() => setLibFocusSrcs([]), 3500)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(clear)
    }
  }, [libFocusSrcs, libraryOpen, librarySrcs, libraryTab])

  const removeLibrarySrcsFromTimeline = useCallback(
    (srcs: string[]) => {
      const remove = new Set(srcs.map(mediaSrcKey).filter(Boolean))
      if (!remove.size) return

      onChange((current) => {
        let changed = false
        const sequences = Object.fromEntries(
          Object.entries(current.sequences).map(([id, seq]) => {
            const clips = seq.clips.filter((clip) => !remove.has(mediaSrcKey(clip.src)))
            if (clips.length === seq.clips.length) return [id, seq]
            changed = true
            return [id, { ...seq, clips }]
          }),
        )
        const previewSrc = mediaSrcKey(current.emailPreview?.src)
        const emailPreview =
          previewSrc && remove.has(previewSrc)
            ? { ...current.emailPreview, src: undefined }
            : current.emailPreview
        if (!changed && emailPreview === current.emailPreview) return current
        return { ...current, sequences, emailPreview }
      })
      setSelectedId(null)
      setSlidePreview(false)
    },
    [onChange],
  )

  const deleteLibrarySrc = useCallback(
    async (src: string) => {
      setLibUploadError(null)
      try {
        const { manifest: next } = await deleteMediaFile(projectCode, src)
        setManifest(next)
        if (libPreviewSrc === src) setLibPreviewSrc(null)
        removeLibrarySrcsFromTimeline([src])
      } catch (err) {
        setLibUploadError(err instanceof Error ? err.message : 'Не удалось удалить фото')
      }
    },
    [libPreviewSrc, projectCode, removeLibrarySrcsFromTimeline, setManifest],
  )

  const deleteLibrarySrcs = useCallback(
    async (srcs: string[]) => {
      const unique = [...new Set(srcs.filter(Boolean))]
      if (!unique.length) return
      setLibUploadError(null)
      setLibUploading(true)
      let lastManifest: Awaited<ReturnType<typeof deleteMediaFile>>['manifest'] | null = null
      const failed: string[] = []
      const deleted: string[] = []
      try {
        for (const src of unique) {
          try {
            const { manifest: next } = await deleteMediaFile(projectCode, src)
            lastManifest = next
            deleted.push(src)
            if (libPreviewSrc === src) setLibPreviewSrc(null)
          } catch {
            failed.push(src)
          }
        }
        if (lastManifest) setManifest(lastManifest)
        else if (failed.length === unique.length) await reloadLibrary()
        if (deleted.length) removeLibrarySrcsFromTimeline(deleted)
        if (failed.length) {
          setLibUploadError(
            failed.length === unique.length
              ? 'Не удалось удалить выбранные файлы'
              : `Удалено ${unique.length - failed.length} из ${unique.length}`,
          )
        }
      } finally {
        setLibUploading(false)
      }
    },
    [libPreviewSrc, projectCode, reloadLibrary, removeLibrarySrcsFromTimeline, setManifest],
  )

  useEffect(() => {
    if (!libraryOpen || libraryTab !== 'photos') {
      setLibFileHover(false)
      return
    }
    const hasOsFiles = (e: DragEvent) => dataTransferHasFiles(e.dataTransfer) && !libDragSrc
    const onOver = (e: DragEvent) => {
      if (!hasOsFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setLibFileHover(true)
    }
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget) return
      setLibFileHover(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasOsFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      e.stopPropagation()
      setLibFileHover(false)
      const dt = e.dataTransfer
      setLibUploading(true)
      void libraryFilesFromDataTransfer(dt)
        .then((files) => importLibraryFiles(files))
        .catch((err) => {
          setLibUploading(false)
          setLibUploadError(err instanceof Error ? err.message : 'Не удалось загрузить фото')
        })
    }
    window.addEventListener('dragover', onOver, true)
    window.addEventListener('dragleave', onLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onOver, true)
      window.removeEventListener('dragleave', onLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [importLibraryFiles, libDragSrc, libraryOpen, libraryTab])

  const sequence = config.sequences[seqId]

  const sequenceReturnMenuId = useMemo(() => {
    if (!sequence) return getDefaultMenuId(config)
    const fallback =
      blockPlacement === 'menu'
        ? (menusList.find((m) => m.branches.some((b) => b.sequenceId === seqId))?.id ??
          getDefaultMenuId(config))
        : getDefaultMenuId(config)
    return resolveReturnMenuId(sequence.endButtons, fallback)
  }, [sequence, blockPlacement, menusList, seqId, config])

  // Через updater от актуального ref в history — иначе правки раздела затирают меню.
  const patchSequence = useCallback(
    (updater: (seq: StorySequence) => StorySequence) => {
      onChange((current) => {
        const currentSeq = current.sequences[seqId]
        if (!currentSeq) return current
        return {
          ...current,
          sequences: { ...current.sequences, [seqId]: updater(currentSeq) },
        }
      })
    },
    [onChange, seqId],
  )

  const renameBlock = useCallback(
    (id: string, label: string) => {
      const seq = config.sequences[id]
      if (!seq) return
      const next = label.trim()
      if (!next || next === seq.label) return
      onChange(
        mapMenuBranches(
          {
            ...config,
            sequences: { ...config.sequences, [id]: { ...seq, label: next } },
          },
          (branches) =>
            branches.map((b) => (b.sequenceId === id ? { ...b, label: next } : b)),
        ),
      )
    },
    [config, onChange],
  )

  const cues = useMemo(
    () => (sequence ? (sequence.cues?.map((cue) => normalizeCue(cue)) ?? migrateSequenceCues(sequence)) : []),
    [sequence],
  )
  const selected = sequence?.clips.find((c) => c.id === selectedId) ?? null

  const updateClip = (clipId: string, patch: Partial<StoryClip>) => {
    patchSequence((seq) => ({
      ...seq,
      clips: seq.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }))
  }

  const probingVideoIdsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const clip of sequence?.clips ?? []) {
      const isVideoClip = clipMediaKind(clip) === 'video' || isVideoSrc(clip.src)
      if (!isVideoClip || clip.sourceDurationSec) continue
      if (probingVideoIdsRef.current.has(clip.id)) continue
      probingVideoIdsRef.current.add(clip.id)
      void probeVideoDuration(clip.src).then((sourceDurationSec) => {
        if (!sourceDurationSec) return
        const trimStartSec = Math.max(0, clip.trimStartSec ?? 0)
        const durationSec = Math.min(
          Math.max(0.8, clip.durationSec),
          Math.max(0.8, sourceDurationSec - trimStartSec),
        )
        updateClip(clip.id, { sourceDurationSec, trimStartSec, durationSec, animSec: durationSec })
      })
    }
  }, [sequence?.clips])

  const patchCues = useCallback(
    (updater: (prev: StoryCue[]) => StoryCue[]) => {
      patchSequence((seq) => {
        const next = updater(seq.cues?.map((cue) => normalizeCue(cue)) ?? migrateSequenceCues(seq))
          .map((cue) => normalizeCue(cue))
          .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
        return { ...seq, cues: next.length ? next : undefined }
      })
    },
    [patchSequence],
  )

  const patchCuesAndSyncClips = useCallback(
    (updater: (prev: StoryCue[]) => StoryCue[]) => {
      patchSequence((seq) => {
        const next = updater(seq.cues?.map((cue) => normalizeCue(cue)) ?? migrateSequenceCues(seq))
          .map((cue) => normalizeCue(cue))
          .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
        const clips = next.length ? syncClipsToCues(seq.clips, next) : seq.clips
        return { ...seq, cues: next.length ? next : undefined, clips }
      })
    },
    [patchSequence],
  )

  const addCue = useCallback(() => {
    const lastCueEnd = cues.reduce((max, cue) => Math.max(max, cueEndSec(cue)), 0)
    const startSec = Number(
      Math.max(sequence ? sequenceDuration(sequence) : 0, lastCueEnd).toFixed(3),
    )
    const cue = normalizeCue({
      id: newCueId(),
      startSec,
      durationSec: 2.5,
      text: 'Новый титр',
    })
    patchCues((prev) => resolveCueOverlaps([...prev, cue], cue.id))
    setSelectedId(null)
    setSelectedCueId(cue.id)
    setSlidePreview(false)
    setFocusCaptionTick((n) => n + 1)
  }, [patchCues, sequence, cues])

  const updateCue = useCallback(
    (cueId: string, patch: Partial<StoryCue>) => {
      const syncClips = patch.durationSec != null || patch.startSec != null
      const apply = syncClips ? patchCuesAndSyncClips : patchCues
      apply((prev) => {
        const next = prev.map((cue) =>
          cue.id === cueId ? normalizeCue({ ...cue, ...patch, id: cue.id }) : cue,
        )
        return resolveCueOverlaps(next, cueId)
      })
    },
    [patchCues, patchCuesAndSyncClips],
  )

  const removeCue = useCallback(
    (cueId: string) => {
      patchCues((prev) => prev.filter((cue) => cue.id !== cueId))
      setSelectedCueId((cur) => (cur === cueId ? null : cur))
      setSlidePreview(false)
    },
    [patchCues],
  )

  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dragCueId, setDragCueId] = useState<string | null>(null)
  const [dragClipResizeId, setDragClipResizeId] = useState<string | null>(null)
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null)
  const [dragSeq, setDragSeq] = useState<{ list: 'flow' | 'menu'; id: string } | null>(null)
  const [dropSeqIndex, setDropSeqIndex] = useState<number | null>(null)
  const seqDragFromGrip = useRef(false)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('frame')
  const inspectorRef = useRef<HTMLDivElement>(null)
  const captionInputRef = useRef<HTMLTextAreaElement>(null)
  const cueLaneRef = useRef<HTMLDivElement>(null)
  const [focusCaptionTick, setFocusCaptionTick] = useState(0)
  const [focusFirstClipTick, setFocusFirstClipTick] = useState(0)
  const selectedCue = cues.find((cue) => cue.id === selectedCueId) ?? null

  const reorderClip = (fromId: string, toIndex: number) => {
    patchSequence((seq) => {
      const from = seq.clips.findIndex((c) => c.id === fromId)
      if (from < 0) return seq
      let insertAt = Math.max(0, Math.min(toIndex, seq.clips.length))
      const clips = [...seq.clips]
      const [item] = clips.splice(from, 1)
      if (from < insertAt) insertAt -= 1
      clips.splice(insertAt, 0, item)
      // Титры не двигаем — дорожка T независима
      return { ...seq, clips }
    })
  }

  const moveClip = (clipId: string, dir: -1 | 1) => {
    patchSequence((seq) => {
      const idx = seq.clips.findIndex((c) => c.id === clipId)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= seq.clips.length) return seq
      const clips = [...seq.clips]
      ;[clips[idx], clips[next]] = [clips[next], clips[idx]]
      return { ...seq, clips }
    })
  }

  const removeClip = useCallback(
    (clipId: string) => {
      patchSequence((seq) => {
        const clips = seq.clips.filter((c) => c.id !== clipId)
        return { ...seq, clips }
      })
      setSelectedId((cur) => (cur === clipId ? null : cur))
      setSlidePreview(false)
    },
    [patchSequence],
  )

  const duplicateClip = useCallback(
    (clipId: string) => {
      const srcClip = sequence?.clips.find((c) => c.id === clipId)
      if (!srcClip) return
      const copy: StoryClip = {
        ...srcClip,
        id: newClipId(seqId),
        from: { ...srcClip.from },
        to: { ...srcClip.to },
      }
      patchSequence((seq) => {
        const idx = seq.clips.findIndex((c) => c.id === clipId)
        if (idx < 0) return seq
        const clips = [...seq.clips]
        clips.splice(idx + 1, 0, copy)
        return { ...seq, clips }
      })
      setSelectedId(copy.id)
      setSelectedCueId(null)
      setSlidePreview(false)
    },
    [patchSequence, seqId, sequence?.clips],
  )

  const duplicateCue = useCallback(
    (cueId: string) => {
      const src = cues.find((c) => c.id === cueId)
      if (!src) return
      const copy = normalizeCue({
        ...src,
        id: newCueId(),
        startSec: cueEndSec(src),
      })
      patchCues((prev) => resolveCueOverlaps([...prev, copy], copy.id))
      setSelectedCueId(copy.id)
      setSelectedId(null)
      setSlidePreview(false)
    },
    [cues, patchCues],
  )

  const nudgeClipDuration = useCallback(
    (clipId: string, dir: -1 | 1) => {
      const clip = sequence?.clips.find((c) => c.id === clipId)
      if (!clip) return
      const durationSec = Math.max(0.8, Number((clip.durationSec + dir * FRAME_SEC).toFixed(3)))
      updateClip(clipId, { durationSec, animSec: durationSec })
    },
    [sequence?.clips, updateClip],
  )

  const nudgeCueStart = useCallback(
    (cueId: string, dir: -1 | 1) => {
      const cue = cues.find((c) => c.id === cueId)
      if (!cue) return
      const startSec = Math.max(0, Number((cue.startSec + dir * FRAME_SEC).toFixed(3)))
      updateCue(cueId, { startSec })
    },
    [cues, updateCue],
  )

  const togglePreview = useCallback(() => {
    if (fullPreviewOpen) {
      setFullPreviewOpen(false)
      return
    }
    if (previewSelected) return
    if (menuSelected) {
      setMenuTtsArmed(true)
      return
    }
    if (blockPreviewId) {
      setBlockPreviewId(null)
      return
    }
    if (selected && !selectedCue) {
      if (slidePreview) {
        slidePreviewClipsRef.current = null
        setSlidePreview(false)
        return
      }
      slidePreviewClipsRef.current = [selected]
      setSlidePreviewKey((k) => k + 1)
      setSlidePreview(true)
      return
    }
    if (sequence?.clips.length) {
      setBlockPreviewKey((k) => k + 1)
      setBlockPreviewId(seqId)
    }
  }, [
    fullPreviewOpen,
    menuSelected,
    previewSelected,
    blockPreviewId,
    selected,
    selectedCue,
    slidePreview,
    sequence?.clips.length,
    seqId,
  ])

  const selectNeighbor = useCallback(
    (dir: -1 | 1) => {
      if (selectedCue && cues.length) {
        const idx = cues.findIndex((c) => c.id === selectedCue.id)
        const next = cues[idx + dir]
        if (next) {
          setSelectedCueId(next.id)
          setSelectedId(null)
          setSlidePreview(false)
        }
        return
      }
      const clips = sequence?.clips ?? []
      if (!clips.length) return
      const idx = selectedId ? clips.findIndex((c) => c.id === selectedId) : dir > 0 ? -1 : clips.length
      const next = clips[idx + dir]
      if (next) {
        setSelectedId(next.id)
        setSelectedCueId(null)
        setSlidePreview(false)
      }
    },
    [selectedCue, cues, sequence?.clips, selectedId],
  )

  const hotkeysRef = useRef({
    undo: history.undo,
    redo: history.redo,
    hasUndo: history.hasUndo,
    hasRedo: history.hasRedo,
    selectedCueId,
    selectedId,
    removeClip,
    removeCue,
    duplicateClip,
    duplicateCue,
    onSave,
    togglePreview,
    selectNeighbor,
    nudgeCueStart,
    nudgeClipDuration,
    menuSelected,
    previewSelected,
  })
  hotkeysRef.current = {
    undo: history.undo,
    redo: history.redo,
    hasUndo: history.hasUndo,
    hasRedo: history.hasRedo,
    selectedCueId,
    selectedId,
    removeClip,
    removeCue,
    duplicateClip,
    duplicateCue,
    onSave,
    togglePreview,
    selectNeighbor,
    nudgeCueStart,
    nudgeClipDuration,
    menuSelected,
    previewSelected,
  }

  useEffect(() => {
    const take = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const h = hotkeysRef.current
      const typing = isTypingTarget(e.target)

      if (isModCode(e, 'KeyZ')) {
        if (e.shiftKey) {
          if (!h.hasRedo() && typing) return
          take(e)
          h.redo()
          return
        }
        if (!h.hasUndo() && typing) return
        take(e)
        h.undo()
        return
      }
      if (isModCode(e, 'KeyY')) {
        if (!h.hasRedo() && typing) return
        take(e)
        h.redo()
        return
      }
      if (isModCode(e, 'KeyD')) {
        if (typing || h.menuSelected || h.previewSelected) return
        take(e)
        if (h.selectedCueId) h.duplicateCue(h.selectedCueId)
        else if (h.selectedId) h.duplicateClip(h.selectedId)
        return
      }
      if (isModCode(e, 'KeyS')) {
        if (typing) return
        take(e)
        h.onSave?.()
        return
      }

      if (typing) return

      if (e.key === ' ' || e.code === 'Space') {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'BUTTON' || tag === 'A') return
        e.preventDefault()
        h.togglePreview()
        return
      }
      if (h.menuSelected || h.previewSelected) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const dir: -1 | 1 = e.key === 'ArrowLeft' ? -1 : 1
        if (e.shiftKey) {
          if (h.selectedCueId) h.nudgeCueStart(h.selectedCueId, dir)
          else if (h.selectedId) h.nudgeClipDuration(h.selectedId, dir)
          return
        }
        h.selectNeighbor(dir)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      if (h.selectedCueId) {
        h.removeCue(h.selectedCueId)
        return
      }
      if (h.selectedId) h.removeClip(h.selectedId)
    }

    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent
      const h = hotkeysRef.current
      if (ie.inputType === 'historyUndo') {
        if (!h.hasUndo()) return
        take(ie)
        h.undo()
      } else if (ie.inputType === 'historyRedo') {
        if (!h.hasRedo()) return
        take(ie)
        h.redo()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('beforeinput', onBeforeInput, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('beforeinput', onBeforeInput, true)
    }
  }, [])

  const addClip = (src: string) => {
    const media = clipMediaKind({ src })
    const path = pathFromPreset('none')
    const clip: StoryClip = {
      id: newClipId(seqId),
      src,
      media,
      motion: media === 'video' ? 'none' : DEFAULT_MOTION,
      durationSec: media === 'video' ? 5 : 2.5,
      animSec: media === 'video' ? 5 : 2.5,
      from: path.from,
      to: path.to,
      easing: DEFAULT_EASING,
      transition: DEFAULT_TRANSITION,
    }
    patchSequence((seq) => ({
      ...seq,
      clips: [...seq.clips, clip],
    }))
    setSelectedId(clip.id)
    setSelectedCueId(null)
    setSlidePreview(false)
    setAwaitingClipAdd(false)
    if (media === 'video') {
      void probeVideoDuration(src).then((d) => {
        if (!d) return
        const durationSec = Math.max(0.8, d)
        updateClip(clip.id, {
          sourceDurationSec: d,
          trimStartSec: 0,
          durationSec,
          animSec: durationSec,
        })
      })
    }
  }

  const applyMediaSrc = (clipId: string, src: string) => {
    const media = clipMediaKind({ src })
    const patch: Partial<StoryClip> = { src, media }
    if (media === 'video') {
      patch.motion = 'none'
      patch.trimStartSec = 0
      patch.sourceDurationSec = undefined
      patch.durationSec = 5
      patch.animSec = 5
    }
    updateClip(clipId, patch)
    if (media === 'video') {
      void probeVideoDuration(src).then((d) => {
        if (!d) return
        const durationSec = Math.max(0.8, d)
        updateClip(clipId, {
          sourceDurationSec: d,
          trimStartSec: 0,
          durationSec,
          animSec: durationSec,
        })
      })
    }
  }

  const applyPreset = (clipId: string, motion: MotionPreset) => {
    if (motion === 'custom') {
      updateClip(clipId, { motion: 'custom' })
      return
    }
    if (motion === 'none') {
      // Сохраняем текущий кадр, A и B совпадают
      patchSequence((seq) => ({
        ...seq,
        clips: seq.clips.map((c) => {
          if (c.id !== clipId) return c
          const focus = { ...c.from }
          return { ...c, motion: 'none', from: focus, to: { ...focus } }
        }),
      }))
      return
    }
    const path = pathFromPreset(motion)
    updateClip(clipId, { motion, from: path.from, to: path.to })
  }

  /** Правка пути. При «без анимации» остаёмся на none и держим A=B. */
  const applyPath = (clipId: string, path: MotionPath) => {
    patchSequence((seq) => ({
      ...seq,
      clips: seq.clips.map((c) => {
        if (c.id !== clipId) return c
        if (c.motion === 'none') {
          const fromChanged =
            path.from.x !== c.from.x ||
            path.from.y !== c.from.y ||
            path.from.scale !== c.from.scale
          const focus = fromChanged ? path.from : path.to
          return { ...c, motion: 'none', from: { ...focus }, to: { ...focus } }
        }
        return { ...c, motion: 'custom', from: path.from, to: path.to }
      }),
    }))
  }

  const patchTheme = useCallback(
    (patch: Partial<PropertyTheme>) => {
      onChange({
        ...config,
        theme: {
          ...normalizeTheme(config.theme),
          ...patch,
        },
      })
    },
    [config, onChange],
  )

  const selectClip = (clipId: string) => {
    setSelectedMenuId(null)
    setSlidePreview(false)
    setSelectedId(clipId)
    setSelectedCueId(null)
  }

  const selectCue = (cueId: string, opts?: { editCaption?: boolean }) => {
    setSelectedMenuId(null)
    setSlidePreview(false)
    setSelectedCueId(cueId)
    setSelectedId(null)
    if (opts?.editCaption) setFocusCaptionTick((n) => n + 1)
  }

  const selectionScrollRef = useRef({ selectedId, selectedCueId })
  const timelineGestureRef = useRef(false)
  useEffect(() => {
    const prev = selectionScrollRef.current
    const selectionChanged =
      prev.selectedId !== selectedId || prev.selectedCueId !== selectedCueId
    selectionScrollRef.current = { selectedId, selectedCueId }
    if (!selectionChanged) return
    if (!selectedId && !selectedCueId) return
    // Ресайз / перетаскивание сами ставят selection — не уводим скролл из-под жеста.
    if (timelineGestureRef.current || dragClipResizeId || dragCueId) return
    const el = inspectorRef.current
    if (!el) return
    const reel = reelScrollRef.current
    const savedLeft = reel?.scrollLeft ?? 0
    const frame = window.requestAnimationFrame(() => {
      if (timelineGestureRef.current) return
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      // scrollIntoView иногда сбрасывает горизонтальный скролл шкалы — вернём.
      if (reel && Math.abs(reel.scrollLeft - savedLeft) > 1) {
        reel.scrollLeft = savedLeft
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedId, selectedCueId, dragClipResizeId, dragCueId])

  const cueDragMovedRef = useRef(false)
  const ttsDurationsRef = useRef(ttsDurations)
  ttsDurationsRef.current = ttsDurations
  const cuesRef = useRef(cues)
  cuesRef.current = cues

  // Когда подтянулась длительность WAV/MP3 — растянуть cue, раздвинуть соседей и клипы
  useEffect(() => {
    const needsExpand = cues.some((cue) => {
      if (!cue.ttsSrc) return false
      const tts = ttsDurations[cue.ttsSrc]
      return tts != null && tts > 0 && cue.durationSec < tts - 0.001
    })
    if (!needsExpand) return
    patchCuesAndSyncClips((prev) => {
      const next = prev.map((cue) => {
        if (!cue.ttsSrc) return cue
        const tts = ttsDurations[cue.ttsSrc]
        if (tts == null || tts <= 0 || cue.durationSec >= tts - 0.001) return cue
        return normalizeCue({ ...cue, durationSec: Number(tts.toFixed(3)) })
      })
      return packCuesLeftToRight(next)
    })
  }, [ttsDurations, cues, patchCuesAndSyncClips])

  const startClipResize = useClipResize({
    updateClip,
    clips: sequence?.clips,
    cuesRef,
    ttsDurationsRef,
    pxPerSecRef,
    setSelectedId,
    setSelectedCueId,
    setSlidePreview,
    setDragClipResizeId,
    setSnapGuideSec,
    timelineGestureRef,
  })

  const startCuePointerDrag = useCueDrag({
    patchCues,
    cuesRef,
    ttsDurationsRef,
    pxPerSecRef,
    cueDragMovedRef,
    setSelectedCueId,
    setSelectedId,
    setSlidePreview,
    setDragCueId,
    timelineGestureRef,
  })

  const selectBlock = (id: string) => {
    const firstClipId = config.sequences[id]?.clips[0]?.id ?? null
    for (const menu of menusList) {
      if (menu.branches.some((b) => b.sequenceId === id)) {
        setSectionsMenuId(menu.id)
        break
      }
    }
    setPreviewSelected(false)
    setAwaitingPreviewPick(false)
    setSelectedMenuId(null)
    setSeqId(id)
    setSelectedId(firstClipId)
    setSelectedCueId(null)
    setSlidePreview(false)
    setFocusFirstClipTick((n) => n + 1)
  }

  const selectMenu = (menuId: string) => {
    setPreviewSelected(false)
    setAwaitingPreviewPick(false)
    setSelectedMenuId(menuId)
    setSectionsMenuId(menuId)
    setSelectedId(null)
    setSelectedCueId(null)
    setSlidePreview(false)
    setBlockPreviewId(null)
  }

  const selectPreview = () => {
    setPreviewSelected(true)
    setSelectedMenuId(null)
    setSelectedId(null)
    setSelectedCueId(null)
    setSlidePreview(false)
    setBlockPreviewId(null)
  }

  useEffect(() => {
    if (selectedMenuId && !config.menus?.[selectedMenuId]) {
      setSelectedMenuId(null)
    }
    const defaultId = getDefaultMenuId(config)
    if (sectionsMenuId && !config.menus?.[sectionsMenuId]) {
      setSectionsMenuId(defaultId)
    }
  }, [config, selectedMenuId, sectionsMenuId])

  useEffect(() => {
    setSelectedCueId(null)
    setSlidePreview(false)
    setSelectedId((cur) => {
      const clips = config.sequences[seqId]?.clips ?? []
      if (cur && clips.some((c) => c.id === cur)) return cur
      return clips[0]?.id ?? null
    })
  }, [seqId])

  useEffect(() => {
    const clips = config.sequences[seqId]?.clips ?? []
    setSelectedId((cur) => {
      if (!cur) return null
      return clips.some((c) => c.id === cur) ? cur : (clips[0]?.id ?? null)
    })
  }, [seqId, config.sequences])

  useEffect(() => {
    if (selectedCueId && !cues.some((cue) => cue.id === selectedCueId)) {
      setSelectedCueId(null)
    }
  }, [cues, selectedCueId])

  useEffect(() => {
    if (!focusCaptionTick) return
    const id = window.setTimeout(() => {
      captionInputRef.current?.focus({ preventScroll: true })
      captionInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [focusCaptionTick, selectedCueId, selectedId])

  useEffect(() => {
    if (!focusFirstClipTick) return
    const id = window.setTimeout(() => {
      const root = reelScrollRef.current
      if (!root) return
      root.scrollTo({ left: 0, behavior: 'smooth' })
      const firstClip = root.querySelector<HTMLElement>('[data-clip-id]')
      firstClip?.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(id)
    // Только при явном выборе блока — не при смене selectedId (ресайз/клик по слайду).
  }, [focusFirstClipTick])

  useEffect(() => {
    const root = reelScrollRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = e.deltaY > 0 ? -PX_PER_SEC_STEP : PX_PER_SEC_STEP
      applyTimelineZoom(pxPerSecRef.current + step, e.clientX)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [applyTimelineZoom, seqId])

  const onLibraryPick = (src: string) => {
    if (libClickTimer.current) {
      window.clearTimeout(libClickTimer.current)
      libClickTimer.current = null
    }
    if (skipNextLibPickRef.current) {
      skipNextLibPickRef.current = false
      return
    }
    addClip(src)
    setLibPreviewSrc(null)
    setAwaitingClipAdd(false)
  }

  const replaceClipSrc = (clipId: string, src: string) => {
    applyMediaSrc(clipId, src)
    setSelectedId(clipId)
    setSelectedCueId(null)
    setSlidePreview(false)
    setLibPreviewSrc(null)
    setLibDropClipId(null)
    setLibDropOnPreview(false)
    setLibDragSrc(null)
  }

  const submitMediaUrl = () => {
    const raw = mediaUrlDraft.trim()
    if (!raw) {
      setMediaUrlError('Вставьте ссылку на файл')
      return
    }
    let src = raw
    try {
      const u = new URL(raw)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setMediaUrlError('Нужна ссылка http(s)')
        return
      }
      src = u.toString()
    } catch {
      setMediaUrlError('Некорректная ссылка')
      return
    }
    if (!isVideoSrc(src) && !/\.(jpe?g|png|webp)($|\?)/i.test(src)) {
      setMediaUrlError('Поддерживаются прямые ссылки на JPG/PNG/WebP/MP4/WebM')
      return
    }
    setMediaUrlError(null)
    addClip(src)
    setMediaUrlOpen(false)
    setMediaUrlDraft('')
    setLibPreviewSrc(null)
    setLibraryOpen(false)
    setAwaitingClipAdd(false)
  }

  const onLibraryClick = (src: string) => {
    if (libDragSrc) return
    if (libClickTimer.current) window.clearTimeout(libClickTimer.current)
    if (awaitingPreviewPick) {
      skipNextLibPickRef.current = true
      if (/\.(jpe?g|png|webp)($|\?)/i.test(src)) {
        onChange({
          ...config,
          emailPreview: { ...config.emailPreview, src },
        })
      }
      setLibPreviewSrc(null)
      setAwaitingPreviewPick(false)
      window.setTimeout(() => {
        skipNextLibPickRef.current = false
      }, 400)
      return
    }
    if (awaitingClipAdd) {
      skipNextLibPickRef.current = true
      addClip(src)
      setLibPreviewSrc(null)
      setAwaitingClipAdd(false)
      window.setTimeout(() => {
        skipNextLibPickRef.current = false
      }, 400)
      return
    }
    libClickTimer.current = window.setTimeout(() => {
      setLibPreviewSrc(src)
      libClickTimer.current = null
    }, 220)
  }

  const beginAddClip = () => {
    setAwaitingClipAdd(true)
    setLibraryTab('photos')
    setLibraryOpen(true)
  }

  useEffect(() => {
    return () => {
      if (libClickTimer.current) window.clearTimeout(libClickTimer.current)
    }
  }, [])

  const closeFullPreview = useCallback(() => setFullPreviewOpen(false), [])

  const openFullPreview = useCallback(() => {
    setBlockPreviewId(null)
    setSlidePreview(false)
    setFullPreviewKey((k) => k + 1)
    setFullPreviewOpen(true)
  }, [])

  useEffect(() => {
    if (!blockPreviewId && !libPreviewSrc && !awaitingClipAdd && !awaitingPreviewPick && !fullPreviewOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (fullPreviewOpen) closeFullPreview()
      else if (blockPreviewId) setBlockPreviewId(null)
      else if (libPreviewSrc) setLibPreviewSrc(null)
      else if (awaitingClipAdd) {
        setAwaitingClipAdd(false)
        setLibraryOpen(false)
      } else if (awaitingPreviewPick) {
        setAwaitingPreviewPick(false)
        setLibraryOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [awaitingClipAdd, awaitingPreviewPick, blockPreviewId, libPreviewSrc, fullPreviewOpen, closeFullPreview])

  const total = sequence ? sequenceDuration(sequence) : 0
  const selectedIndex =
    selected && sequence ? sequence.clips.findIndex((c) => c.id === selected.id) : -1
  const displayTitle = fillNameOptional(sequence?.title, config.defaultGuestName)
  const cuePreviewClip = selectedCue ? clipAtTime(sequence.clips, selectedCue.startSec) : null
  const filledSequenceCues = useMemo(
    () =>
      cues.map((cue) => ({
        ...cue,
        text: cue.text ? fillName(cue.text, config.defaultGuestName) : cue.text,
      })),
    [config.defaultGuestName, cues],
  )
  const rulerMarks = useMemo(() => {
    if (!total) return [0]
    const step = total > 20 ? 5 : total > 10 ? 2 : 1
    const marks: number[] = []
    for (let t = 0; t <= total + 0.001; t += step) marks.push(Number(t.toFixed(2)))
    if (marks[marks.length - 1] !== Number(total.toFixed(2))) {
      marks.push(Number(total.toFixed(2)))
    }
    return marks
  }, [total])
  const lastCueEndSec = useMemo(
    () => cues.reduce((max, cue) => Math.max(max, cueEndSec(cue)), 0),
    [cues],
  )
  const timelineWidth = useMemo(() => {
    const addTail = timelineAddTailPx()
    const clipsPx = total * pxPerSec
    const cuesPx = lastCueEndSec * pxPerSec
    return Math.max(240, Math.max(clipsPx, cuesPx) + addTail)
  }, [total, lastCueEndSec, pxPerSec])

  /** При открытии блока подогнать масштаб под длину контента (в пределах min/max). */
  useLayoutEffect(() => {
    const root = reelScrollRef.current
    if (!root) return

    const contentSec = Math.max(total, lastCueEndSec)
    const applyFit = () => {
      const width = root.clientWidth
      if (width < 40) return false
      const next =
        contentSec > 0 ? fitTimelinePxPerSec(contentSec, width) : PX_PER_SEC_DEFAULT
      zoomAnchorRef.current = null
      pxPerSecRef.current = next
      setPxPerSec(next)
      root.scrollLeft = 0
      return true
    }

    if (applyFit()) return
    const ro = new ResizeObserver(() => {
      if (applyFit()) ro.disconnect()
    })
    ro.observe(root)
    return () => ro.disconnect()
    // Только смена блока — не пересчитывать при правках длительности.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seqId open only
  }, [seqId])

  const blockPreviewSeq = blockPreviewId ? config.sequences[blockPreviewId] : null
  const filledBlockPreviewCues = useMemo(
    () =>
      (blockPreviewSeq?.cues ?? []).map((cue) => ({
        ...cue,
        text: cue.text ? fillName(cue.text, config.defaultGuestName) : cue.text,
      })),
    [blockPreviewSeq?.cues, config.defaultGuestName],
  )
  const theme = normalizeTheme(config.theme)
  const viewAspect = viewAspectFor(theme.orientation)
  const isLandscape = theme.orientation === 'landscape'

  const stopLibAudio = useCallback(() => {
    const audio = libAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    setLibAudioPlaying(false)
  }, [])

  const toggleLibAudio = useCallback(
    async (src: string, kind: 'music' | 'tts') => {
      const audio = libAudioRef.current
      if (!audio) return
      if (libAudioSrc === src && !audio.paused) {
        stopLibAudio()
        return
      }
      setLibAudioSrc(src)
      audio.src = kind === 'tts' ? ttsPlaybackUrl(src) : src
      audio.volume = Math.min(1, Math.max(0, kind === 'music' ? theme.musicVolume : theme.ttsVolume))
      audio.currentTime = 0
      try {
        await audio.play()
        setLibAudioPlaying(true)
      } catch {
        setLibAudioPlaying(false)
      }
    },
    [libAudioSrc, stopLibAudio, theme.musicVolume, theme.ttsVolume],
  )

  useEffect(() => {
    if (libraryOpen && libraryTab === 'audio') return
    stopLibAudio()
  }, [libraryOpen, libraryTab, stopLibAudio])

  if (!sequence) {
    return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4">Нет последовательностей</div>
  }

  const needsPublish = hasDraft || !published
  const showBlockTimeline = isBlockPanel || (!previewSelected && !menuSelected)

  const blockTimelineEditor = (
    <>
      <TimelineTracks
        sequence={sequence}
        cues={cues}
        selectedId={selectedId}
        selectedCueId={selectedCueId}
        pxPerSec={pxPerSec}
        timelineWidth={timelineWidth}
        snapGuideSec={snapGuideSec}
        rulerMarks={rulerMarks}
        lastCueEndSec={lastCueEndSec}
        total={total}
        blockPlacement={blockPlacement}
        blockPanel={isBlockPanel}
        onOpenLibrary={
          isBlockPanel
            ? () => {
                setLibraryTab('photos')
                setLibraryOpen(true)
              }
            : undefined
        }
        libraryCount={isBlockPanel ? librarySrcs.length : undefined}
        menus={menusList}
        defaultMenuId={getDefaultMenuId(config)}
        returnMenuId={sequenceReturnMenuId}
        onReturnMenuChange={(menuId) => {
          patchSequence((seq) => withReturnMenu(seq, menuId))
        }}
        seqId={seqId}
        dragId={dragId}
        dropIndex={dropIndex}
        dragCueId={dragCueId}
        dragClipResizeId={dragClipResizeId}
        timelineGestureRef={timelineGestureRef}
        libDragSrc={libDragSrc}
        libDropClipId={libDropClipId}
        awaitingClipAdd={awaitingClipAdd}
        ttsDurations={ttsDurations}
        reelScrollRef={reelScrollRef}
        cueLaneRef={cueLaneRef}
        cueDragMovedRef={cueDragMovedRef}
        applyTimelineZoom={applyTimelineZoom}
        renameBlock={renameBlock}
        removeFromPlacement={removeFromPlacement}
        deleteBlock={deleteBlock}
        setBlockPreviewId={setBlockPreviewId}
        setBlockPreviewKey={setBlockPreviewKey}
        selectClip={selectClip}
        selectCue={selectCue}
        setSelectedCueId={setSelectedCueId}
        setSlidePreview={setSlidePreview}
        setTrackCtx={setTrackCtx}
        setDragId={setDragId}
        setDropIndex={setDropIndex}
        setLibDropClipId={setLibDropClipId}
        setLibDragSrc={setLibDragSrc}
        setLibDropOnPreview={setLibDropOnPreview}
        replaceClipSrc={replaceClipSrc}
        reorderClip={reorderClip}
        addClip={addClip}
        beginAddClip={beginAddClip}
        addCue={addCue}
        startClipResize={startClipResize}
        startCuePointerDrag={startCuePointerDrag}
      />

      {selectedCue && !selected ? (
        <CueInspector
          projectCode={projectCode}
          selectedCue={selectedCue}
          sequence={sequence}
          filledCues={filledSequenceCues}
          displayTitle={displayTitle ?? ''}
          sequenceTitle={sequence?.title ?? ''}
          onSequenceTitleChange={(title) => {
            patchSequence((seq) => ({
              ...seq,
              title: title || undefined,
            }))
          }}
          theme={theme}
          isLandscape={isLandscape}
          guestName={config.defaultGuestName}
          inspectorRef={inspectorRef}
          captionInputRef={captionInputRef}
          ttsFiles={ttsFiles}
          ttsDurations={ttsDurations}
          ttsError={ttsError}
          ensureTtsFile={ensureTtsFile}
          refreshTts={refreshTts}
          updateCue={updateCue}
          updateClip={updateClip}
          removeCue={removeCue}
          patchTheme={patchTheme}
          cuePreviewClip={cuePreviewClip}
          isAdmin={isAdmin}
          brand={config.brand}
          copyFacts={config.copyFacts}
          blockMeta={
            sequence
              ? (config.constructorV2?.sequenceMetaById?.[sequence.id] ?? undefined)
              : undefined
          }
        />
      ) : null}

      {selected && selectedIndex >= 0 ? (
        <ClipInspector
          selected={selected}
          inspectorRef={inspectorRef}
          isLandscape={isLandscape}
          viewAspect={viewAspect}
          theme={theme}
          displayTitle={displayTitle ?? ''}
          slidePreview={slidePreview}
          slidePreviewKey={slidePreviewKey}
          slidePreviewClipsRef={slidePreviewClipsRef}
          inspectorTab={inspectorTab}
          setInspectorTab={setInspectorTab}
          libDragSrc={libDragSrc}
          libDropOnPreview={libDropOnPreview}
          setLibDropOnPreview={setLibDropOnPreview}
          replaceClipSrc={replaceClipSrc}
          applyPath={applyPath}
          applyPreset={applyPreset}
          updateClip={updateClip}
          moveClip={moveClip}
          removeClip={removeClip}
          setSlidePreview={setSlidePreview}
          setSlidePreviewKey={setSlidePreviewKey}
        />
      ) : null}
    </>
  )

  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${
        isBlockPanel ? '' : 'p-4 max-[900px]:h-auto max-[900px]:min-h-full max-[900px]:overflow-visible'
      }`}
    >
      {!isBlockPanel ? (
      <header className="mb-4 flex shrink-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium">
              {templateName?.trim() || templateCode}
            </h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            aria-label="Смотреть весь ролик"
            title="Смотреть весь ролик"
            onClick={openFullPreview}
          >
            <Play aria-hidden fill="currentColor" strokeWidth={0} />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {needsPublish ? (
            <Badge variant="outline" className="hidden sm:inline-flex">
              Черновик
            </Badge>
          ) : (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              В эфире
            </Badge>
          )}
          {onSave ? (
            <Button
              type="button"
              variant={needsPublish ? 'default' : 'outline'}
              size="sm"
              disabled={saveState === 'saving' || publishState === 'saving' || (!needsPublish && saveState === 'saved')}
              onClick={() => onSave()}
              title="Гости и CRM увидят эту версию"
            >
              {saveState === 'saving'
                ? 'Публикация…'
                : saveState === 'saved' && !hasDraft
                  ? 'Опубликовано'
                  : 'Опубликовать'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Отменить"
            title="Отменить · Cmd+Z"
            disabled={!history.canUndo}
            onClick={() => history.undo()}
          >
            <Undo2 aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Повторить"
            title="Повторить · Cmd+Shift+Z"
            disabled={!history.canRedo}
            onClick={() => history.redo()}
          >
            <Redo2 aria-hidden />
          </Button>
          <Button
            type="button"
            variant={awaitingClipAdd || awaitingPreviewPick ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLibraryOpen(true)}
          >
            <Images data-icon="inline-start" aria-hidden />
            Медиатека
            <span className="text-muted-foreground text-xs font-normal">
              {librarySrcs.length}
            </span>
          </Button>
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
      </header>
      ) : null}

      {!isBlockPanel && (draftError || saveError) ? (
        <div
          className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
          role="alert"
        >
          <p>
            {draftError
              ? `Черновик не сохранился: ${draftError}`
              : `Не удалось сохранить: ${saveError}`}
          </p>
          {draftError && onRetryDraft ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onRetryDraft()}>
              Повторить
            </Button>
          ) : null}
        </div>
      ) : null}

      {!isBlockPanel ? (
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки</DialogTitle>
            <DialogDescription>
              Ориентация, громкость, публикация и обмен ссылкой на объект.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Label className="text-muted-foreground font-normal">
              <Checkbox
                checked={isLandscape}
                onCheckedChange={(checked) =>
                  patchTheme({ orientation: checked === true ? 'landscape' : 'portrait' })
                }
              />
              Альбомная ориентация (16:9)
            </Label>
            <Field>
              <FieldLabel className="justify-between">
                Музыка
                <span className="text-muted-foreground font-normal">
                  {Math.round(theme.musicVolume * 100)}%
                </span>
              </FieldLabel>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[theme.musicVolume]}
                onValueChange={(v) => patchTheme({ musicVolume: sliderNumber(v) })}
              />
            </Field>
            <Field>
              <FieldLabel className="justify-between">
                TTS
                <span className="text-muted-foreground font-normal">
                  {Math.round(theme.ttsVolume * 100)}%
                </span>
              </FieldLabel>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[theme.ttsVolume]}
                onValueChange={(v) => patchTheme({ ttsVolume: sliderNumber(v) })}
              />
            </Field>
            <p className="text-muted-foreground text-sm">
              «Опубликовать» отправляет текущую версию гостям и CRM. «Новая ссылка» ещё и выдаёт URL с именем гостя по умолчанию.
            </p>
            {(lastShareUrl || config.shareId) && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Ссылка:</span>
                <a
                  className="text-primary break-all underline-offset-4 hover:underline"
                  href={guestShareUrl(projectCode, lastShareUrl ?? `/${config.shareId}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {guestShareUrl(projectCode, lastShareUrl ?? `/${config.shareId}`)}
                </a>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = guestShareUrl(projectCode, lastShareUrl ?? `/${config.shareId}`)
                    void copyText(url).then((ok) => {
                      if (!ok) {
                        window.prompt('Скопируйте ссылку:', url)
                        return
                      }
                      setShareCopied(true)
                      window.setTimeout(() => setShareCopied(false), 1600)
                    })
                  }}
                >
                  {shareCopied ? 'Скопировано' : 'Копировать'}
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {onSave ? (
                <Button
                  type="button"
                  variant={hasDraft || saveState !== 'saved' ? 'default' : 'outline'}
                  size="sm"
                  disabled={saveState === 'saving' || publishState === 'saving'}
                  onClick={() => onSave()}
                >
                  {saveState === 'saving'
                    ? 'Публикация…'
                    : saveState === 'saved'
                      ? 'Опубликовано'
                      : 'Опубликовать'}
                </Button>
              ) : null}
              {onPublish ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saveState === 'saving' || publishState === 'saving'}
                  onClick={() => onPublish()}
                  title="Создать новую короткую ссылку для гостя"
                >
                  {publishState === 'saving'
                    ? 'Публикация…'
                    : publishState === 'saved'
                      ? 'Ссылка создана'
                      : 'Новая ссылка'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="col-span-2"
                disabled={ttsBatchBusy || archiveImporting || archiveExporting}
                onClick={() => void onGenerateAllTtsFromCaptions()}
                title="Для каждого титра: текст озвучки из титра (и заголовка) → генерация TTS"
              >
                {ttsBatchBusy && ttsBatchProgress
                  ? `TTS… ${ttsBatchProgress.done}/${ttsBatchProgress.total}`
                  : 'Сгенерировать все TTS по титрам'}
              </Button>
              {isAdmin ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => downloadPropertyJson(config)}
                  >
                    Экспорт JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={archiveExporting}
                    onClick={() => void onExportArchive()}
                  >
                    {archiveExporting ? 'Экспорт…' : 'Экспорт ZIP'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importInputRef.current?.click()}
                  >
                    Импорт JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={archiveImporting}
                    onClick={() => archiveInputRef.current?.click()}
                  >
                    {archiveImporting ? 'Импорт…' : 'Импорт ZIP'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm('Сбросить правки этого объекта?')) onReset?.()
                    }}
                  >
                    Сброс
                  </Button>
                </>
              ) : null}
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
            {saveError ? <p className="text-destructive text-xs">{saveError}</p> : null}
            {publishError ? <p className="text-destructive text-xs">{publishError}</p> : null}
          </FieldGroup>
        </DialogContent>
      </Dialog>
      ) : null}

      <Dialog
        open={mediaUrlOpen}
        onOpenChange={(open) => {
          setMediaUrlOpen(open)
          if (!open) {
            setMediaUrlDraft('')
            setMediaUrlError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Медиа по ссылке</DialogTitle>
            <DialogDescription>
              Прямой URL на файл JPG, PNG, WebP, MP4 или WebM (не страница YouTube/Vimeo).
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="media-url-input">Ссылка</FieldLabel>
            <Input
              id="media-url-input"
              type="url"
              value={mediaUrlDraft}
              placeholder="https://…/clip.mp4"
              onChange={(e) => {
                setMediaUrlDraft(e.target.value)
                setMediaUrlError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitMediaUrl()
                }
              }}
              autoFocus
            />
          </Field>
          {mediaUrlError ? <p className="text-destructive text-xs">{mediaUrlError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMediaUrlOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={submitMediaUrl}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isBlockPanel && isAdmin ? (
        <Tabs
          value={adminWorkspace}
          onValueChange={(value) => value && setAdminWorkspace(value as typeof adminWorkspace)}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="editor">Редактор</TabsTrigger>
            <TabsTrigger value="ai">Параметры генерации</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {!isBlockPanel && isAdmin && adminWorkspace === 'ai' ? (
        <Card className="min-h-0 flex-1 overflow-hidden">
          <CardContent className="h-full min-h-0 overflow-y-auto p-4 sm:p-6">
            <AiGenerationParamsPanel
              brand={config.brand}
              copyFacts={config.copyFacts}
              onCopyFactsChange={(copyFacts) =>
                onChange((prev) => ({ ...prev, copyFacts }))
              }
            />
          </CardContent>
        </Card>
      ) : (
      <div
        className={`grid min-h-0 flex-1 items-stretch gap-4 ${
          isBlockPanel
            ? 'grid-cols-1'
            : 'max-[900px]:grid-cols-1 max-[900px]:min-h-0 max-[900px]:flex-none min-[901px]:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]'
        }`}
      >
        {!isBlockPanel ? (
        <aside className="flex min-h-0 flex-col overflow-hidden max-[900px]:overflow-visible max-[900px]:max-h-none">
          <div className="bg-card min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[900px]:overflow-visible max-[900px]:max-h-none">
          <div className="editor-seq-group">
            <div className="editor-seq-group-head">
              {/* <div className="min-w-0 px-2 pt-1.5">
                <p className="m-0 text-xs font-medium leading-tight">Письмо</p>
                <p className="text-muted-foreground mt-0.5 text-xs font-normal leading-tight">
                  картинка ссылки
                </p>
              </div> */}
            </div>
            <div className={`editor-seq-row${previewSelected ? ' is-active' : ''}`}>
              <Button
                type="button"
                variant="ghost"
                className="editor-seq h-auto min-h-12 justify-start whitespace-normal font-normal"
                onClick={selectPreview}
              >
                <span className="editor-seq-copy">
                  <span className="inline-flex items-center gap-2">
                    <Mail className="size-3.5 shrink-0 opacity-70" aria-hidden />
                    Превью
                  </span>
                  <small>
                    {config.emailPreview?.enabled
                      ? config.emailPreview?.src
                        ? 'своё фото'
                        : 'первый кадр'
                      : 'выкл'}
                  </small>
                </span>
              </Button>
            </div>
          </div>
          {(
            [
              { key: 'flow' as const, title: 'Автопоказ', ids: flowIds, hint: 'по порядку до меню' },
              { key: 'menu' as const, title: 'Меню', ids: menuIds, hint: 'кнопки разделов' },
              ...(otherIds.length
                ? [{ key: 'other' as const, title: 'Без показа', ids: otherIds, hint: 'не в плеере' }]
                : []),
            ] as const
          ).map((group) => (
            <div key={group.key} className="editor-seq-group">
              {group.key === 'menu' ? (
                <>
                  <div className="editor-seq-group-head">
                    <div className="min-w-0 px-2 pt-1.5">
                      <p className="m-0 text-xs font-medium leading-tight">Меню</p>
                      <p className="text-muted-foreground mt-0.5 text-xs font-normal leading-tight">
                        экраны и оформление
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Добавить экран меню"
                      aria-label="Добавить экран меню"
                      onClick={addMenuScreen}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </div>
                  {menusList.map((menu) => (
                    <div
                      key={menu.id}
                      className={`editor-seq-row has-draft-actions${selectedMenuId === menu.id ? ' is-active' : ''}`}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        className="editor-seq h-auto min-h-12 justify-start whitespace-normal font-normal"
                        onClick={() => selectMenu(menu.id)}
                      >
                        <span className="editor-seq-copy">
                          <span>{menu.label}</span>
                          <small>
                            {menu.branches.length}{' '}
                            {menu.branches.length === 1 ? 'раздел' : 'разделов'}
                          </small>
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="editor-seq-play"
                        title="Проиграть озвучку меню"
                        aria-label="Проиграть озвучку меню"
                        disabled={!menu.menuTtsSrc?.trim()}
                        onClick={(e) => {
                          e.stopPropagation()
                          selectMenu(menu.id)
                          setMenuTtsArmed(true)
                        }}
                      >
                        <Play aria-hidden fill="currentColor" strokeWidth={0} />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="editor-seq-more"
                            />
                          }
                        >
                          <EllipsisVertical aria-hidden />
                          <span className="sr-only">Действия для «{menu.label}»</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onClick={() => renameMenuScreen(menu.id)}>
                            Переименовать
                          </DropdownMenuItem>
                          {menusList.length > 1 ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => deleteMenuScreen(menu.id)}
                              >
                                Удалить меню
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                  <div className="editor-seq-group-head border-t border-border/60 pt-2">
                    <div className="min-w-0 px-2 pt-1.5">
                      <p className="m-0 text-xs font-medium leading-tight">
                        Разделы · {sectionsMenu.label}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs font-normal leading-tight">
                        кнопки видео в меню
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={`Добавить раздел в «${sectionsMenu.label}»`}
                      aria-label={`Добавить раздел в «${sectionsMenu.label}»`}
                      onClick={() => addBlock('menu')}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="editor-seq-group-head">
                  <div className="min-w-0 px-2 pt-1.5">
                    <p className="m-0 text-xs font-medium leading-tight">{group.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs font-normal leading-tight">{group.hint}</p>
                  </div>
                  {group.key === 'flow' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Добавить блок в автопоказ"
                      aria-label="Добавить блок в автопоказ"
                      onClick={() => addBlock('flow')}
                    >
                      <Plus aria-hidden />
                    </Button>
                  ) : null}
                </div>
              )}
              {group.ids.map((id, i) => {
                const s = config.sequences[id]
                if (!s) return null
                const sortable = group.key === 'flow' || group.key === 'menu'
                const list = group.key === 'menu' ? 'menu' : 'flow'
                return (
                  <div
                    key={id}
                    draggable={sortable}
                    className={[
                      'editor-seq-row',
                      sortable ? '' : 'has-draft-actions',
                      id === seqId && !menuSelected && !previewSelected ? 'is-active' : '',
                      dragSeq?.id === id ? 'is-dragging' : '',
                      sortable &&
                      dragSeq?.list === list &&
                      dropSeqIndex === i
                        ? 'is-drop-before'
                        : '',
                      sortable &&
                      dragSeq?.list === list &&
                      dropSeqIndex === i + 1 &&
                      i === group.ids.length - 1
                        ? 'is-drop-after'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragStart={
                      sortable
                        ? (e) => {
                            if (!seqDragFromGrip.current) {
                              e.preventDefault()
                              return
                            }
                            setDragSeq({ list, id })
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', `seq:${list}:${id}`)
                          }
                        : undefined
                    }
                    onDragEnd={
                      sortable
                        ? () => {
                            seqDragFromGrip.current = false
                            setDragSeq(null)
                            setDropSeqIndex(null)
                          }
                        : undefined
                    }
                    onDragOver={
                      sortable
                        ? (e) => {
                            if (!dragSeq || dragSeq.list !== list) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            const rect = e.currentTarget.getBoundingClientRect()
                            const before = e.clientY < rect.top + rect.height / 2
                            setDropSeqIndex(before ? i : i + 1)
                          }
                        : undefined
                    }
                    onDrop={
                      sortable
                        ? (e) => {
                            e.preventDefault()
                            const raw = e.dataTransfer.getData('text/plain')
                            const fromId =
                              raw.startsWith(`seq:${list}:`)
                                ? raw.slice(`seq:${list}:`.length)
                                : dragSeq?.list === list
                                  ? dragSeq.id
                                  : null
                            const to = dropSeqIndex ?? i
                            if (fromId) reorderInList(list, fromId, to)
                            setDragSeq(null)
                            setDropSeqIndex(null)
                          }
                        : undefined
                    }
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="editor-seq h-auto min-h-12 justify-start whitespace-normal font-normal"
                      onClick={() => selectBlock(id)}
                    >
                      {sortable ? (
                        <span
                          className="editor-seq-grip"
                          aria-hidden
                          title="Перетащить"
                          onPointerDown={() => {
                            seqDragFromGrip.current = true
                          }}
                          onPointerUp={() => {
                            seqDragFromGrip.current = false
                          }}
                        >
                          <GripVertical />
                        </span>
                      ) : null}
                      <span className="editor-seq-copy">
                        <span>{s.label}</span>
                        <small>
                          {sequenceDuration(s).toFixed(1)}с · {s.clips.length}
                        </small>
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="editor-seq-play"
                      title="Просмотр блока"
                      aria-label={`Просмотр блока «${s.label}»`}
                      disabled={!s.clips.length}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSeqId(id)
                        setSelectedId(null)
                        setSlidePreview(false)
                        setFullPreviewOpen(false)
                        setBlockPreviewKey((k) => k + 1)
                        setBlockPreviewId(id)
                      }}
                    >
                      <Play aria-hidden fill="currentColor" strokeWidth={0} />
                    </Button>
                    {!sortable ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="editor-seq-more"
                            />
                          }
                        >
                          <EllipsisVertical aria-hidden />
                          <span className="sr-only">Действия для «{s.label}»</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          {menusList.length > 1 ? (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>В меню</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {menusList.map((menu) => (
                                  <DropdownMenuItem
                                    key={menu.id}
                                    onClick={() => placeExisting(id, 'menu', menu.id)}
                                  >
                                    {menu.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          ) : (
                            <DropdownMenuItem onClick={() => placeExisting(id, 'menu')}>
                              В меню
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => placeExisting(id, 'flow')}>
                            В автопоказ
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => deleteBlock(id)}
                          >
                            Удалить блок
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                )
              })}
              {group.key === 'menu' && !group.ids.length ? (
                <p className="editor-hint editor-seq-empty">
                  Пусто. Нажмите +, чтобы добавить раздел.
                </p>
              ) : null}
            </div>
          ))}
          </div>
        </aside>
        ) : null}

        <main
          className={`bg-card min-h-0 overflow-x-hidden overscroll-contain rounded-xl border p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[900px]:max-h-none max-[900px]:overflow-visible ${
            !isBlockPanel && menuSelected
              ? 'flex min-h-0 flex-col overflow-hidden'
              : 'overflow-y-auto'
          }`}
        >
          {showBlockTimeline ? (
            blockTimelineEditor
          ) : previewSelected ? (
            <EmailPreviewInspector
              config={config}
              guestName={config.defaultGuestName}
              thumbUrl={libraryThumbUrl}
              picking={awaitingPreviewPick}
              libDragSrc={libDragSrc}
              onPickFromLibrary={() => {
                setAwaitingPreviewPick(true)
                setLibraryTab('photos')
                setLibraryOpen(true)
              }}
              onChange={(emailPreview: EmailPreviewConfig) => onChange({ ...config, emailPreview })}
            />
          ) : menuSelected && selectedMenu && selectedMenuId ? (
            <MenuInspector
              projectCode={projectCode}
              menuId={selectedMenuId}
              brand={config.brand}
              guestName={config.defaultGuestName}
              branches={selectedMenu.branches}
              menuCopy={selectedMenu.menuCopy}
              menuTheme={selectedMenu.menuTheme}
              menuLinks={selectedMenu.menuLinks}
              menuBgSrc={selectedMenu.menuBgSrc}
              menuTtsText={selectedMenu.menuTtsText}
              menuTtsSrc={selectedMenu.menuTtsSrc}
              menuTtsHash={selectedMenu.menuTtsHash}
              menuTtsFirstOnly={selectedMenu.menuTtsFirstOnly}
              ttsFiles={ttsFiles}
              ttsVolume={theme.ttsVolume}
              isLandscape={isLandscape}
              playArmed={menuTtsArmed}
              onPlayArmedConsumed={() => setMenuTtsArmed(false)}
              refreshTts={refreshTts}
              onMenuCopyChange={(menuCopy) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  return id ? updateMenu(prev, id, { menuCopy }) : prev
                })
              }
              onBrandPatch={(patch) =>
                onChange((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } }))
              }
              onMenuBgChange={(menuBgSrc) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  return id ? updateMenu(prev, id, { menuBgSrc }) : prev
                })
              }
              onMenuThemePatch={(patch) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  if (!id) return prev
                  const menu = resolveMenu(prev, id)
                  return updateMenu(prev, id, {
                    menuTheme: { ...normalizeMenuTheme(menu.menuTheme), ...patch },
                  })
                })
              }
              onMenuLinksChange={(menuLinks) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  return id ? updateMenu(prev, id, { menuLinks }) : prev
                })
              }
              onMenuTtsPatch={(patch) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  return id ? updateMenu(prev, id, patch) : prev
                })
              }
              onMenuTtsFirstOnlyChange={(menuTtsFirstOnly) =>
                onChange((prev) => {
                  const id = selectedMenuIdRef.current
                  return id ? updateMenu(prev, id, { menuTtsFirstOnly }) : prev
                })
              }
            />
          ) : null}
        </main>
      </div>
      )}

      {!isBlockPanel && fullPreviewOpen ? (
        <div
          className="block-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Весь ролик"
          onClick={closeFullPreview}
        >
          <div className="block-preview-full" onClick={(e) => e.stopPropagation()}>
            <div className={`block-preview-phone is-full-play${isLandscape ? ' is-landscape' : ''}`}>
              <Presentation
                key={`full-${fullPreviewKey}-${theme.orientation}`}
                property={config}
                embedded
              />
            </div>
            <Button type="button" variant="outline" onClick={closeFullPreview}>
              Закрыть предпросмотр
            </Button>
          </div>
        </div>
      ) : null}

      {blockPreviewSeq && (
        <div
          className="block-preview"
          role="dialog"
          aria-modal="true"
          onClick={() => setBlockPreviewId(null)}
        >
          <div className="block-preview-inner" onClick={(e) => e.stopPropagation()}>
            <div className={`block-preview-phone${isLandscape ? ' is-landscape' : ''}`}>
              <StoryPlayer
                key={`block-${blockPreviewId}-${blockPreviewKey}-${theme.orientation}`}
                clips={blockPreviewSeq.clips}
                cues={filledBlockPreviewCues}
                title={fillNameOptional(blockPreviewSeq.title, config.defaultGuestName)}
                captionBarStyle={captionBarStyle(config.theme)}
                onEnded={() => setBlockPreviewId(null)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="block-preview-close"
              aria-label="Закрыть"
              onClick={() => setBlockPreviewId(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <LibrarySheet
        open={libraryOpen}
        onOpenChange={(open, details) => {
          if (!open && (libPreviewSrc || libDragSrc || libUploading)) {
            details?.cancel()
            return
          }
          setLibraryOpen(open)
          if (!open) setAwaitingClipAdd(false)
        }}
        libraryTab={libraryTab}
        setLibraryTab={setLibraryTab}
        awaitingClipAdd={awaitingClipAdd}
        librarySrcs={librarySrcs}
        filteredLibrarySrcs={filteredLibrarySrcs}
        libPhotoQuery={libPhotoQuery}
        setLibPhotoQuery={setLibPhotoQuery}
        folderOptions={folderOptions}
        libFolders={libFolders}
        setLibFolders={setLibFolders}
        libError={libError}
        libUploadError={libUploadError}
        libUploading={libUploading}
        libFileHover={libFileHover}
        setLibFileHover={setLibFileHover}
        libraryUploadFolderLabel={
          folderOptions.find((f) => f.id === libraryUploadFolder)?.label ?? 'Загрузки'
        }
        libFileInputRef={libFileInputRef}
        importLibraryFiles={importLibraryFiles}
        libDragSrc={libDragSrc}
        setLibDragSrc={setLibDragSrc}
        setLibDropClipId={setLibDropClipId}
        setLibDropOnPreview={setLibDropOnPreview}
        usedInProject={usedInProject}
        libFocusSrcs={libFocusSrcs}
        libraryThumbUrl={libraryThumbUrl}
        libraryFileName={libraryFileName}
        onLibraryClick={onLibraryClick}
        onLibraryPick={onLibraryPick}
        onLibItemDragStart={() => {
          if (libClickTimer.current) {
            window.clearTimeout(libClickTimer.current)
            libClickTimer.current = null
          }
        }}
        deleteLibrarySrc={deleteLibrarySrc}
        deleteLibrarySrcs={deleteLibrarySrcs}
        setMediaUrlOpen={setMediaUrlOpen}
        setMediaUrlDraft={setMediaUrlDraft}
        setMediaUrlError={setMediaUrlError}
        libPreviewSrc={libPreviewSrc}
        setLibPreviewSrc={setLibPreviewSrc}
        libAudioRef={libAudioRef}
        libAudioSrc={libAudioSrc}
        libAudioPlaying={libAudioPlaying}
        libAudioDurations={libAudioDurations}
        setLibAudioDurations={setLibAudioDurations}
        setLibAudioPlaying={setLibAudioPlaying}
        musicItem={musicItem}
        usedTtsItems={usedTtsItems}
        ttsDurations={ttsDurations}
        toggleLibAudio={toggleLibAudio}
      />

      <TrackContextMenu
        state={trackCtx}
        onClose={() => setTrackCtx(null)}
        onDelete={(kind, id) => {
          if (kind === 'clip') removeClip(id)
          else removeCue(id)
        }}
        onDuplicate={(kind, id) => {
          if (kind === 'clip') duplicateClip(id)
          else duplicateCue(id)
        }}
      />
    </div>
  )
}
