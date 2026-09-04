import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { Clapperboard, GripVertical, Images, Minus, Pencil, Play, Plus, Trash2, Type } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { isVideoSrc, type MenuScreenConfig, type StoryClip, type StoryCue, type StorySequence } from '@/types/story'
import {
  PX_PER_SEC_DEFAULT,
  PX_PER_SEC_MAX,
  PX_PER_SEC_MIN,
  PX_PER_SEC_STEP,
  TIMELINE_LABEL_PX,
  TRACK_ADD_GAP,
  clipLaneWidth,
  cueSnippet,
  isLibraryDrag,
  readLibrarySrc,
  sliderNumber,
} from './timelineMath'

type Props = {
  sequence: StorySequence
  cues: StoryCue[]
  selectedId: string | null
  selectedCueId: string | null
  pxPerSec: number
  timelineWidth: number
  snapGuideSec: number | null
  rulerMarks: number[]
  lastCueEndSec: number
  total: number
  blockPlacement: 'flow' | 'menu' | 'none'
  /** Constructor V2: скрыть управление размещением блока в flow/меню */
  blockPanel?: boolean
  onOpenLibrary?: () => void
  libraryCount?: number
  /** Экраны меню — для выбора «после ролика» */
  menus: MenuScreenConfig[]
  defaultMenuId: string
  returnMenuId: string
  onReturnMenuChange: (menuId: string) => void
  seqId: string
  dragId: string | null
  dropIndex: number | null
  dragCueId: string | null
  dragClipResizeId: string | null
  /** Синхронный флаг ресайза/drag cue — до commit React state */
  timelineGestureRef: RefObject<boolean>
  libDragSrc: string | null
  libDropClipId: string | null
  awaitingClipAdd: boolean
  ttsDurations: Record<string, number>
  reelScrollRef: RefObject<HTMLDivElement | null>
  cueLaneRef: RefObject<HTMLDivElement | null>
  cueDragMovedRef: RefObject<boolean>
  applyTimelineZoom: (next: number, clientX?: number) => void
  renameBlock: (id: string, label: string) => void
  removeFromPlacement: (id: string) => void
  deleteBlock: (id: string) => void
  setBlockPreviewId: (id: string | null) => void
  setBlockPreviewKey: (fn: (k: number) => number) => void
  selectClip: (id: string) => void
  selectCue: (id: string, opts?: { editCaption?: boolean }) => void
  setSelectedCueId: (id: string | null) => void
  setSlidePreview: (v: boolean) => void
  setTrackCtx: (state: { kind: 'clip' | 'cue'; id: string; x: number; y: number }) => void
  setDragId: (id: string | null) => void
  setDropIndex: (i: number | null) => void
  setLibDropClipId: (id: string | null | ((prev: string | null) => string | null)) => void
  setLibDragSrc: (src: string | null) => void
  setLibDropOnPreview: (v: boolean) => void
  replaceClipSrc: (clipId: string, src: string) => void
  reorderClip: (fromId: string, toIndex: number) => void
  addClip: (src: string) => void
  beginAddClip: () => void
  addCue: () => void
  startClipResize: (
    e: ReactPointerEvent<HTMLElement>,
    clip: StoryClip,
    edge?: 'start' | 'end',
  ) => void
  startCuePointerDrag: (
    e: ReactPointerEvent<HTMLElement>,
    cue: StoryCue,
    mode: 'move' | 'resize',
  ) => void
}

/** Миниатюра клипа: для видео показывает кадр с указанной секунды. */
function ClipThumb({ src, timeSec }: { src: string; timeSec: number }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const seek = () => {
      const total = el.duration
      if (!Number.isFinite(total) || total <= 0) return
      const target = Math.min(Math.max(0, timeSec), Math.max(0, total - 0.05))
      if (Math.abs(el.currentTime - target) < 0.04) return
      try {
        el.currentTime = target
      } catch {
        /* ignore */
      }
    }
    if (el.readyState >= 1) seek()
    else el.addEventListener('loadedmetadata', seek)
    return () => el.removeEventListener('loadedmetadata', seek)
  }, [src, timeSec])

  if (!isVideoSrc(src)) return <img src={src} alt="" draggable={false} />
  return <video ref={videoRef} src={src} muted playsInline preload="metadata" draggable={false} />
}

export function TimelineTracks(props: Props) {
  const {
    sequence,
    cues,
    selectedId,
    selectedCueId,
    pxPerSec,
    timelineWidth,
    snapGuideSec,
    rulerMarks,
    lastCueEndSec,
    total,
    blockPlacement,
    blockPanel = false,
    onOpenLibrary,
    libraryCount,
    menus,
    defaultMenuId,
    returnMenuId,
    onReturnMenuChange,
    seqId,
    dragId,
    dropIndex,
    dragCueId,
    dragClipResizeId,
    timelineGestureRef,
    libDragSrc,
    libDropClipId,
    awaitingClipAdd,
    ttsDurations,
    reelScrollRef,
    cueLaneRef,
    cueDragMovedRef,
    applyTimelineZoom,
    renameBlock,
    removeFromPlacement,
    deleteBlock,
    setBlockPreviewId,
    setBlockPreviewKey,
    selectClip,
    selectCue,
    setSelectedCueId,
    setSlidePreview,
    setTrackCtx,
    setDragId,
    setDropIndex,
    setLibDropClipId,
    setLibDragSrc,
    setLibDropOnPreview,
    replaceClipSrc,
    reorderClip,
    addClip,
    beginAddClip,
    addCue,
    startClipResize,
    startCuePointerDrag,
  } = props

  const [renaming, setRenaming] = useState(false)
  const [draftLabel, setDraftLabel] = useState(sequence.label)

  useEffect(() => {
    setRenaming(false)
    setDraftLabel(sequence.label)
  }, [seqId, sequence.label])

  const commitRename = () => {
    const next = draftLabel.trim()
    setRenaming(false)
    if (!next || next === sequence.label) {
      setDraftLabel(sequence.label)
      return
    }
    renameBlock(seqId, next)
  }

  return (
    <>
      <div className="editor-timeline-head">
        <div>
          <div className="editor-timeline-title">
            {renaming ? (
              <Input
                value={draftLabel}
                aria-label="Название блока"
                className="h-8 max-w-xs font-medium"
                autoFocus
                onChange={(e) => setDraftLabel(e.target.value)}
                onBlur={commitRename}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setDraftLabel(sequence.label)
                    setRenaming(false)
                  }
                }}
              />
            ) : (
              <>
                <h2>{sequence.label}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Переименовать"
                  aria-label={`Переименовать «${sequence.label}»`}
                  onClick={() => {
                    setDraftLabel(sequence.label)
                    setRenaming(true)
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
              </>
            )}
            {!blockPanel && blockPlacement !== 'none' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={blockPlacement === 'menu' ? 'Убрать из меню' : 'Убрать из автопоказа'}
                aria-label={
                  blockPlacement === 'menu'
                    ? `Убрать «${sequence.label}» из меню`
                    : `Убрать «${sequence.label}» из автопоказа`
                }
                onClick={() => removeFromPlacement(seqId)}
              >
                <Trash2 data-icon="inline-start" aria-hidden />
                {blockPlacement === 'menu' ? 'Из меню' : 'Из автопоказа'}
              </Button>
            ) : blockPlacement === 'none' ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                title="Удалить блок · можно вернуть Cmd+Z"
                aria-label={`Удалить блок «${sequence.label}»`}
                onClick={() => deleteBlock(seqId)}
              >
                <Trash2 data-icon="inline-start" aria-hidden />
                Удалить блок
              </Button>
            ) : null}
          </div>
          <p>
            {sequence.clips.length} кадров · {total.toFixed(1)} с
          </p>
          {!blockPanel && blockPlacement !== 'none' && menus.length > 0 ? (
            <div className="border-border/70 bg-muted/30 mt-3 flex max-w-md flex-col gap-1.5 rounded-md border px-3 py-2.5">
              <span className="text-foreground text-xs font-medium leading-tight">
                {blockPlacement === 'flow'
                  ? 'После автопоказа показать меню'
                  : `После «${sequence.label}» показать меню`}
              </span>
              <select
                className="border-input bg-background text-foreground h-9 w-full rounded-md border px-2 text-sm"
                value={menus.some((m) => m.id === returnMenuId) ? returnMenuId : defaultMenuId}
                onChange={(e) => onReturnMenuChange(e.target.value)}
                aria-label={
                  blockPlacement === 'flow'
                    ? 'Меню после автопоказа'
                    : 'Меню после раздела'
                }
              >
                {menus.map((menu) => (
                  <option key={menu.id} value={menu.id}>
                    {menu.id === defaultMenuId ? `${menu.label} (основное)` : menu.label}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-[11px] leading-snug">
                Гость досмотрел ролик → откроется выбранный экран меню
              </span>
            </div>
          ) : null}
        </div>
        <div className="editor-timeline-head-actions">
          <div className="editor-timeline-zoom" title="Масштаб шкалы · Ctrl + колесо">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Уменьшить масштаб"
              disabled={pxPerSec <= PX_PER_SEC_MIN}
              onClick={() => applyTimelineZoom(pxPerSec - PX_PER_SEC_STEP)}
            >
              <Minus aria-hidden />
            </Button>
            <Slider
              min={PX_PER_SEC_MIN}
              max={PX_PER_SEC_MAX}
              step={1}
              value={[pxPerSec]}
              onValueChange={(v) => applyTimelineZoom(sliderNumber(v))}
              aria-label="Масштаб шкалы времени"
              className="editor-timeline-zoom-slider"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Увеличить масштаб"
              disabled={pxPerSec >= PX_PER_SEC_MAX}
              onClick={() => applyTimelineZoom(pxPerSec + PX_PER_SEC_STEP)}
            >
              <Plus aria-hidden />
            </Button>
            <span className="editor-timeline-zoom-value">
              {Math.round((pxPerSec / PX_PER_SEC_DEFAULT) * 100)} %
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!sequence.clips.length}
            title="Пробел — превью блока"
            onClick={() => {
              setBlockPreviewKey((k) => k + 1)
              setBlockPreviewId(seqId)
            }}
          >
            <Play data-icon="inline-start" aria-hidden fill="currentColor" strokeWidth={0} />
            Просмотр блока
          </Button>
          {blockPanel && onOpenLibrary ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenLibrary}>
              <Images data-icon="inline-start" aria-hidden />
              Медиатека
              {libraryCount != null ? (
                <span className="text-muted-foreground text-xs font-normal">{libraryCount}</span>
              ) : null}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="editor-reel"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropIndex(null)
          }
        }}
      >
        <div className="editor-reel-scroll" ref={reelScrollRef}>
          <div
            className="editor-reel-inner"
            style={{ width: timelineWidth, ['--editor-sec-px' as string]: `${pxPerSec}px` }}
          >
            {snapGuideSec != null ? (
              <div
                className="editor-snap-guide"
                style={{ left: TIMELINE_LABEL_PX + snapGuideSec * pxPerSec }}
                aria-hidden
              />
            ) : null}
            <div className="editor-ruler" aria-hidden>
              {rulerMarks.map((t) => (
                <span key={t} className="editor-ruler-mark" style={{ left: t * pxPerSec }}>
                  {t % 1 === 0 ? `${t}с` : t.toFixed(1)}
                </span>
              ))}
            </div>

            <div className="editor-track">
              <div className="editor-track-label" title="Видео">
                <Clapperboard size={14} aria-hidden />
              </div>
              <div
                className={`editor-track-lane${libDragSrc ? ' is-lib-drag' : ''}`}
                role="list"
                onDragOver={(e) => {
                  if (!(isLibraryDrag(e.dataTransfer) || libDragSrc)) return
                  if (libDropClipId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={(e) => {
                  const libSrc = readLibrarySrc(e.dataTransfer) || libDragSrc
                  if (!libSrc) return
                  e.preventDefault()
                  if (!libDropClipId) {
                    addClip(libSrc)
                    setLibDragSrc(null)
                    setLibDropOnPreview(false)
                  }
                }}
              >
                {sequence.clips.map((clip, i) => (
                  <div
                    key={clip.id}
                    data-clip-id={clip.id}
                    role="listitem"
                    tabIndex={-1}
                    draggable={!libDragSrc && dragClipResizeId !== clip.id && !timelineGestureRef.current}
                    className={[
                      'editor-clip',
                      selectedId === clip.id ? 'is-selected' : '',
                      dragId === clip.id ? 'is-dragging' : '',
                      dragClipResizeId === clip.id ? 'is-resizing' : '',
                      dropIndex === i ? 'is-drop-before' : '',
                      libDropClipId === clip.id ? 'is-lib-drop' : '',
                      (clip.trimStartSec ?? 0) > 0 ? 'is-trimmed-start' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ width: clipLaneWidth(clip, pxPerSec) }}
                    onClick={() => selectClip(clip.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setTrackCtx({ kind: 'clip', id: clip.id, x: e.clientX, y: e.clientY })
                    }}
                    onDragStart={(e) => {
                      if (libDragSrc || dragClipResizeId || timelineGestureRef.current) {
                        e.preventDefault()
                        return
                      }
                      setDragId(clip.id)
                      setSlidePreview(false)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', clip.id)
                      if (e.currentTarget instanceof HTMLElement) {
                        e.dataTransfer.setDragImage(e.currentTarget, 40, 40)
                      }
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setDropIndex(null)
                    }}
                    onDragOver={(e) => {
                      if (isLibraryDrag(e.dataTransfer) || libDragSrc) {
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'copy'
                        setLibDropClipId(clip.id)
                        setDropIndex(null)
                        return
                      }
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      const before = e.clientX < rect.left + rect.width / 2
                      setDropIndex(before ? i : i + 1)
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setLibDropClipId((id) => (id === clip.id ? null : id))
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const libSrc = readLibrarySrc(e.dataTransfer) || libDragSrc
                      if (libSrc) {
                        replaceClipSrc(clip.id, libSrc)
                        return
                      }
                      const fromId = e.dataTransfer.getData('text/plain') || dragId
                      const to = dropIndex ?? i
                      if (fromId && !fromId.startsWith('lib:')) reorderClip(fromId, to)
                      setDragId(null)
                      setDropIndex(null)
                    }}
                  >
                    <div className="editor-clip-handle" aria-hidden>
                      <GripVertical />
                    </div>
                    <div className="editor-clip-thumb">
                      <ClipThumb src={clip.src} timeSec={clip.trimStartSec ?? 0} />
                    </div>
                    <div className="editor-clip-body" aria-hidden />
                    {isVideoSrc(clip.src) ? (
                      <div
                        className="editor-clip-thumb editor-clip-thumb-end"
                        title={`Последний кадр: ${(
                          (clip.trimStartSec ?? 0) + clip.durationSec
                        ).toFixed(1)}с`}
                      >
                        <ClipThumb
                          src={clip.src}
                          timeSec={Math.max(
                            clip.trimStartSec ?? 0,
                            (clip.trimStartSec ?? 0) + clip.durationSec - 0.05,
                          )}
                        />
                      </div>
                    ) : null}
                    <Badge variant="secondary" className="editor-clip-badge">
                      {isVideoSrc(clip.src) && (clip.trimStartSec ?? 0) > 0
                        ? `${(clip.trimStartSec ?? 0).toFixed(1)}–${(
                            (clip.trimStartSec ?? 0) + clip.durationSec
                          ).toFixed(1)}с`
                        : `${clip.durationSec.toFixed(1)}с`}
                    </Badge>
                    {isVideoSrc(clip.src) ? (
                      <span
                        className="editor-clip-resize editor-clip-resize-start"
                        title="Тяните вправо, чтобы начать видео позже"
                        aria-label="Изменить начало видео"
                        draggable={false}
                        onPointerDown={(e) => startClipResize(e, clip, 'start')}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.preventDefault()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : null}
                    <span
                      className="editor-clip-resize editor-clip-resize-end"
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      title={
                        isVideoSrc(clip.src)
                          ? 'Тяните влево, чтобы закончить видео раньше'
                          : 'Тяните, чтобы изменить длительность'
                      }
                      aria-label={
                        isVideoSrc(clip.src)
                          ? 'Изменить конец видео'
                          : 'Изменить длительность слайда'
                      }
                      onPointerDown={(e) => startClipResize(e, clip, 'end')}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                ))}
                {dropIndex === sequence.clips.length && <div className="editor-drop-end" aria-hidden />}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn(
                    'editor-track-add size-auto h-[72px] w-12 shrink-0 border-dashed',
                    (libDragSrc || awaitingClipAdd) && 'border-primary bg-primary/10 text-primary',
                  )}
                  title="Добавить слайд из библиотеки"
                  aria-label="Добавить слайд"
                  onClick={(e) => {
                    e.stopPropagation()
                    beginAddClip()
                  }}
                  onDragOver={(e) => {
                    if (!(isLibraryDrag(e.dataTransfer) || libDragSrc)) return
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={(e) => {
                    const libSrc = readLibrarySrc(e.dataTransfer) || libDragSrc
                    if (!libSrc) return
                    e.preventDefault()
                    e.stopPropagation()
                    addClip(libSrc)
                    setLibDragSrc(null)
                    setLibDropOnPreview(false)
                  }}
                >
                  <Plus aria-hidden />
                </Button>
                {libDragSrc && !sequence.clips.length ? (
                  <p className="editor-track-empty">Отпустите, чтобы добавить кадр</p>
                ) : null}
              </div>
            </div>

            <div className="editor-track editor-track-text">
              <div className="editor-track-label" title="Титры">
                <Type size={14} aria-hidden />
              </div>
              <div
                ref={cueLaneRef}
                className="editor-track-lane editor-cue-lane"
                role="list"
                onClick={() => {
                  setSelectedCueId(null)
                  setSlidePreview(false)
                }}
              >
                {cues.map((cue) => {
                  const ttsSec = cue.ttsSrc ? ttsDurations[cue.ttsSrc] : undefined
                  const barSec =
                    ttsSec != null && ttsSec > 0 ? Math.min(ttsSec, cue.durationSec) : null
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      role="listitem"
                      className={[
                        'editor-cue',
                        selectedCueId === cue.id ? 'is-selected' : '',
                        dragCueId === cue.id ? 'is-dragging' : '',
                        cue.ttsSrc ? 'has-tts' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        left: cue.startSec * pxPerSec,
                        width: Math.max(16, cue.durationSec * pxPerSec),
                      }}
                      title={
                        ttsSec != null
                          ? `${cue.text?.trim() || 'Титр'} · TTS ${ttsSec.toFixed(1)}с`
                          : cue.text?.trim() || 'Титр без текста'
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        if (cueDragMovedRef.current) {
                          cueDragMovedRef.current = false
                          return
                        }
                        selectCue(cue.id, { editCaption: true })
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setTrackCtx({ kind: 'cue', id: cue.id, x: e.clientX, y: e.clientY })
                      }}
                      onPointerDown={(e) => startCuePointerDrag(e, cue, 'move')}
                    >
                      <span className="editor-cue-text">{cueSnippet(cue)}</span>
                      {barSec != null ? (
                        <span
                          className="editor-cue-tts-bar"
                          style={{ width: Math.max(4, barSec * pxPerSec) }}
                          title={`TTS ${barSec.toFixed(1)}с`}
                          aria-hidden
                        />
                      ) : null}
                      <span
                        className="editor-cue-resize"
                        aria-hidden
                        onPointerDown={(e) => startCuePointerDrag(e, cue, 'resize')}
                      />
                    </button>
                  )
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="editor-track-add editor-track-add-cue size-auto h-14 w-12 shrink-0 border-dashed"
                  style={{
                    left:
                      (cues.length ? lastCueEndSec * pxPerSec : 0) +
                      (cues.length ? TRACK_ADD_GAP : 4),
                  }}
                  title="Добавить титр"
                  aria-label="Добавить титр"
                  onClick={(e) => {
                    e.stopPropagation()
                    addCue()
                  }}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
