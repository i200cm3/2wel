import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Copy, Lock, LockOpen, Mic, Play, Sparkles, Square, Trash2, Type } from 'lucide-react'
import { StoryPlayer } from '@/components/StoryPlayer'
import { TtsFileSelect } from '@/components/TtsFileSelect'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { GUEST_SUBSTITUTION_HINT } from '@/lib/guestSummaryFields'
import {
  buildTtsTextFromCaption,
  generateTts,
  speakTextForTts,
  ttsTextNeedsGuestName,
} from '@/lib/ttsGenerate'
import { ttsPlaybackUrl } from '@/lib/ttsUrl'
import {
  captionBarStyle,
  defaultBlockMeta,
  type BlockMeta,
  type PropertyBrand,
  type PropertyTheme,
  type StoryClip,
  type StoryCue,
  type StorySequence,
} from '@/types/story'
import { CaptionThemeFields } from './CaptionThemeFields'
import { CueCopyGenerateDialog } from './CueCopyGenerateDialog'
import {
  inspectorFieldsClass,
  inspectorGridClass,
  inspectorLiveFieldsClass,
  inspectorLiveShellClass,
  inspectorShellClass,
  inspectorStageClass,
} from './editorTypes'
import { ttsFileLabel } from './timelineMath'

type Props = {
  projectCode: string
  selectedCue: StoryCue
  sequence: StorySequence
  filledCues: StoryCue[]
  displayTitle: string
  sequenceTitle?: string
  onSequenceTitleChange: (title: string) => void
  theme: PropertyTheme
  isLandscape: boolean
  guestName: string
  inspectorRef: RefObject<HTMLDivElement | null>
  captionInputRef: RefObject<HTMLTextAreaElement | null>
  ttsFiles: string[]
  ttsDurations: Record<string, number>
  ttsError: string | null
  ensureTtsFile: (src: string, knownSec?: number | null) => Promise<number | null>
  refreshTts: () => void
  updateCue: (cueId: string, patch: Partial<StoryCue>) => void
  updateClip: (clipId: string, patch: Partial<StoryClip>) => void
  removeCue: (cueId: string) => void
  patchTheme: (patch: Partial<PropertyTheme>) => void
  cuePreviewClip: StoryClip | null
  isAdmin?: boolean
  brand?: PropertyBrand
  copyFacts?: string
  blockMeta?: BlockMeta
}

export function CueInspector({
  projectCode,
  selectedCue,
  sequence,
  filledCues,
  displayTitle,
  sequenceTitle = '',
  onSequenceTitleChange,
  theme,
  isLandscape,
  guestName,
  inspectorRef,
  captionInputRef,
  ttsFiles,
  ttsDurations,
  ttsError,
  ensureTtsFile,
  refreshTts,
  updateCue,
  updateClip,
  removeCue,
  patchTheme,
  cuePreviewClip,
  isAdmin = false,
  brand,
  copyFacts = '',
  blockMeta,
}: Props) {
  const [ttsBusy, setTtsBusy] = useState(false)
  const [ttsGenMessage, setTtsGenMessage] = useState<string | null>(null)
  const [ttsPreviewBump, setTtsPreviewBump] = useState(0)
  const [ttsPreviewPlaying, setTtsPreviewPlaying] = useState(false)
  /** Пока есть сгенерированный TTS — поле текста заблокировано, пока не снимут замок. */
  const [ttsUnlocked, setTtsUnlocked] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const ttsPreviewAudioRef = useRef<HTMLAudioElement | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const pinnedRef = useRef(false)

  useEffect(() => {
    const node = inspectorRef.current
    const fields = fieldsRef.current
    if (!node || !fields) return
    const scroller = node.parentElement
    if (!scroller) return
    scrollerRef.current = scroller

    const updatePinned = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      pinnedRef.current = max <= 1 || scroller.scrollTop >= max - 2
    }
    updatePinned()
    scroller.addEventListener('scroll', updatePinned, { passive: true })

    const onWheel = (e: WheelEvent) => {
      if (window.matchMedia('(max-width: 900px)').matches) return
      const sc = scrollerRef.current
      if (!sc) return
      const sendToMain = !pinnedRef.current || (fields.scrollTop <= 0 && e.deltaY < 0)
      if (!sendToMain) return
      e.preventDefault()
      sc.scrollTop += e.deltaY
      updatePinned()
    }
    fields.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('scroll', updatePinned)
      fields.removeEventListener('wheel', onWheel)
    }
  }, [inspectorRef, selectedCue.id])

  useEffect(() => {
    setTtsGenMessage(null)
    setTtsPreviewPlaying(false)
    const a = ttsPreviewAudioRef.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
  }, [selectedCue.id])

  const stopPreview = () => {
    const a = ttsPreviewAudioRef.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    setTtsPreviewPlaying(false)
  }

  const toggleTtsPreview = useCallback(async () => {
    const audio = ttsPreviewAudioRef.current
    if (!audio || !selectedCue.ttsSrc) return
    try {
      if (!audio.paused) {
        audio.pause()
        audio.currentTime = 0
        setTtsPreviewPlaying(false)
        return
      }
      audio.currentTime = 0
      await audio.play()
      setTtsPreviewPlaying(true)
    } catch (err) {
      setTtsPreviewPlaying(false)
      setTtsGenMessage(err instanceof Error ? `Play: ${err.message}` : 'Не удалось воспроизвести')
    }
  }, [selectedCue.ttsSrc])

  useEffect(() => {
    setTtsUnlocked(false)
    setTtsGenMessage(null)
  }, [selectedCue.id])

  const previewClip = cuePreviewClip ?? sequence.clips[0]
  const showTitle = previewClip?.showTitle !== false
  const showText = selectedCue.showText !== false
  const hasGeneratedTts = Boolean(selectedCue.ttsSrc)
  const ttsPersonalized = ttsTextNeedsGuestName(selectedCue.ttsText)
  const ttsLocked = hasGeneratedTts && !ttsUnlocked && !ttsPersonalized
  const cueIndex = Math.max(
    0,
    filledCues.findIndex((cue) => cue.id === selectedCue.id),
  )
  const canUseAi = isAdmin && Boolean(brand) && filledCues.length > 0
  const resolvedMeta = blockMeta ?? defaultBlockMeta()

  const buildTtsFromCaption = useCallback(
    () =>
      buildTtsTextFromCaption({
        caption: selectedCue.text,
        sequenceTitle,
        showTitle,
      }),
    [selectedCue.text, sequenceTitle, showTitle],
  )

  const copyCaptionToTts = useCallback(() => {
    if (ttsLocked) {
      setTtsGenMessage('Снимите замок, чтобы изменить текст озвучки')
      return
    }
    const next = buildTtsFromCaption()
    updateCue(selectedCue.id, { ttsText: next })
    setTtsGenMessage(
      next
        ? showTitle && sequenceTitle.trim()
          ? 'Заголовок и титр скопированы в TTS'
          : 'Текст титра скопирован в TTS'
        : 'Нечего копировать',
    )
  }, [buildTtsFromCaption, selectedCue.id, sequenceTitle, showTitle, ttsLocked, updateCue])

  const generateCueTts = useCallback(
    async () => {
      if (ttsBusy) return
      const cueId = selectedCue.id
      const draft = (selectedCue.ttsText ?? '').trim() || buildTtsFromCaption()
      if (!draft) {
        setTtsGenMessage('Нет текста для озвучки')
        return
      }
      const speak = speakTextForTts(draft, guestName || 'гость')
      setTtsBusy(true)
      setTtsGenMessage(null)
      try {
        const result = await generateTts(speak, { force: true, projectCode })
        const ttsSec = await ensureTtsFile(result.src, result.durationSec)
        const durationSec =
          ttsSec != null && ttsSec > 0
            ? Math.max(selectedCue.durationSec, Number(ttsSec.toFixed(3)))
            : selectedCue.durationSec
        updateCue(cueId, {
          ttsText: draft,
          ttsSrc: result.src,
          ttsHash: result.hash,
          durationSec,
        })
        setTtsUnlocked(false)
        setTtsPreviewBump(result.version ?? Date.now())
        window.setTimeout(() => refreshTts(), 400)
        const voiceNote = result.voiceId ? ` · voice ${result.voiceId.slice(0, 8)}…` : ''
        const file = ttsFileLabel(result.src)
        const dur = ttsSec ? ` · ${ttsSec.toFixed(1)}с` : ''
        const personal = ttsTextNeedsGuestName(draft)
          ? ' · для гостя пересоберётся при выдаче ссылки'
          : ''
        setTtsGenMessage(`Подключено · ${file}${dur}${voiceNote}${personal}`)
      } catch (err) {
        setTtsGenMessage(err instanceof Error ? err.message : 'Ошибка генерации')
      } finally {
        setTtsBusy(false)
      }
    },
    [
      selectedCue,
      ttsBusy,
      guestName,
      projectCode,
      updateCue,
      refreshTts,
      ensureTtsFile,
      buildTtsFromCaption,
    ],
  )

  return (
    <div
      ref={inspectorRef}
      className={`${inspectorShellClass} ${inspectorGridClass} ${inspectorLiveShellClass}`}
    >
      <div className="editor-inspector-stage-wrap min-w-0 min-[901px]:h-full min-[901px]:min-h-0">
        <div className={inspectorStageClass}>
          <div className={`editor-inspector-phone${isLandscape ? ' is-landscape' : ''}`}>
            <StoryPlayer
              key={`cue-live-${selectedCue.id}-${cuePreviewClip?.id ?? 'empty'}-${theme.orientation}`}
              clips={sequence.clips}
              cues={filledCues}
              title={displayTitle}
              captionBarStyle={captionBarStyle(theme)}
              paused
              editable
              activeClipId={cuePreviewClip?.id ?? sequence.clips[0]?.id ?? null}
              editTitle={sequenceTitle}
              editLine={selectedCue.text ?? ''}
              editShowLine={showText}
              onTitleChange={onSequenceTitleChange}
              onLineChange={(value) => updateCue(selectedCue.id, { text: value })}
              onEnded={() => undefined}
            />
          </div>
        </div>
      </div>
      <div ref={fieldsRef} className={`${inspectorFieldsClass} ${inspectorLiveFieldsClass}`}>
        <div className="flex min-w-0 flex-col gap-3">
          {canUseAi ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setAiOpen(true)}>
                <Sparkles data-icon="inline-start" />
                ИИ · титр
              </Button>
            </div>
          ) : null}
          <Field orientation="horizontal" data-disabled={!previewClip || undefined}>
            <Switch
              id="editor-show-title"
              checked={showTitle}
              disabled={!previewClip}
              onCheckedChange={(checked) => {
                if (!previewClip) return
                updateClip(previewClip.id, { showTitle: checked === true })
              }}
            />
            <FieldLabel htmlFor="editor-show-title">Показывать заголовок</FieldLabel>
          </Field>
          {showTitle ? (
            <Field>
              <FieldLabel htmlFor="editor-block-title">Заголовок</FieldLabel>
              <Input
                id="editor-block-title"
                value={sequenceTitle}
                placeholder="Здравствуйте, {name}!"
                onChange={(e) => onSequenceTitleChange(e.target.value)}
              />
              <FieldDescription>{GUEST_SUBSTITUTION_HINT}</FieldDescription>
            </Field>
          ) : null}
          <Field orientation="horizontal">
            <Switch
              id="editor-show-caption"
              checked={showText}
              onCheckedChange={(checked) => updateCue(selectedCue.id, { showText: checked === true })}
            />
            <FieldLabel htmlFor="editor-show-caption">Показывать титр</FieldLabel>
          </Field>
          <Field>
            <FieldLabel>
              <Type size={16} aria-hidden />
              Титр
            </FieldLabel>
            <Textarea
              ref={captionInputRef}
              rows={3}
              value={selectedCue.text ?? ''}
              placeholder="Текст титра · {name} — имя гостя"
              onChange={(e) => updateCue(selectedCue.id, { text: e.target.value })}
            />
            <FieldDescription>{GUEST_SUBSTITUTION_HINT}</FieldDescription>
            {!showText ? (
              <FieldDescription>Текст сохранится для таймлайна и TTS, но на слайде не покажется.</FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel>
              <Mic size={16} aria-hidden />
              Текст озвучки (TTS)
            </FieldLabel>
            <Textarea
              rows={3}
              value={selectedCue.ttsText ?? ''}
              placeholder={
                showTitle
                  ? 'Текст для озвучки · «из титра» скопирует заголовок.титр'
                  : 'Текст для озвучки · кнопка «из титра» скопирует сюда'
              }
              readOnly={ttsLocked}
              aria-readonly={ttsLocked || undefined}
              onChange={(e) => {
                if (ttsLocked) return
                updateCue(selectedCue.id, { ttsText: e.target.value })
                setTtsGenMessage(null)
              }}
            />
            {ttsTextNeedsGuestName(selectedCue.ttsText) ? (
              <p className="editor-hint">
                Есть {'{name}'} — при выдаче ссылки озвучка соберётся заново с именем гостя и
                текущим голосом проекта.
              </p>
            ) : (
              <FieldDescription>{GUEST_SUBSTITUTION_HINT}</FieldDescription>
            )}
            <div className="editor-tts-actions">
              {hasGeneratedTts ? (
                <Button
                  type="button"
                  variant={ttsLocked ? 'default' : 'outline'}
                  size="icon-sm"
                  onClick={() => {
                    setTtsUnlocked((v) => !v)
                    setTtsGenMessage(
                      ttsLocked
                        ? 'Замок снят — можно менять текст озвучки'
                        : 'Текст озвучки снова заблокирован',
                    )
                  }}
                  title={
                    ttsLocked
                      ? 'Озвучка уже сгенерирована. Нажмите, чтобы разрешить правку текста'
                      : 'Заблокировать текст озвучки'
                  }
                  aria-label={ttsLocked ? 'Снять замок' : 'Закрыть замок'}
                  aria-pressed={ttsLocked}
                >
                  {ttsLocked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={copyCaptionToTts}
                disabled={
                  ttsLocked ||
                  (!(selectedCue.text ?? '').trim() &&
                    !(showTitle && sequenceTitle.trim()))
                }
                title={
                  ttsLocked
                    ? 'Снимите замок, чтобы скопировать'
                    : showTitle
                      ? 'Скопировать заголовок и титр в поле озвучки'
                      : 'Скопировать текст титра в поле озвучки'
                }
              >
                <Copy aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void generateCueTts()}
                disabled={
                  ttsBusy ||
                  (!(selectedCue.ttsText ?? '').trim() && !buildTtsFromCaption())
                }
                title="Сгенерировать в папку этого проекта"
              >
                {ttsBusy ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden />
                    Генерация…
                  </>
                ) : (
                  <>
                    <Mic data-icon="inline-start" aria-hidden />
                    Сгенерировать
                  </>
                )}
              </Button>
            </div>
            {ttsLocked ? (
              <p className="editor-hint">Озвучка сгенерирована — снимите замок, чтобы изменить текст.</p>
            ) : null}
            {ttsGenMessage ? <p className="editor-hint">{ttsGenMessage}</p> : null}
            {selectedCue.ttsHash ? (
              <p className="editor-hint editor-tts-hash">hash {selectedCue.ttsHash.slice(0, 12)}…</p>
            ) : null}
          </Field>
          <Field data-disabled={ttsPersonalized || undefined}>
            <FieldLabel>Озвучка (файл)</FieldLabel>
            <div className="editor-tts-file-row">
              <TtsFileSelect
                files={ttsFiles}
                extraSrc={selectedCue.ttsSrc}
                value={ttsPersonalized ? undefined : selectedCue.ttsSrc}
                placeholder={ttsPersonalized ? 'Авто при выдаче ссылки' : 'Нет'}
                disabled={ttsPersonalized}
                aria-label="Файл озвучки"
                onValueChange={(ttsSrc) => {
                  if (ttsPersonalized) return
                  if (!ttsSrc) {
                    stopPreview()
                    updateCue(selectedCue.id, { ttsSrc: undefined, ttsHash: undefined })
                    setTtsUnlocked(true)
                    return
                  }
                  const ttsSec = ttsDurations[ttsSrc]
                  const durationSec =
                    ttsSec != null && ttsSec > 0
                      ? Math.max(selectedCue.durationSec, Number(ttsSec.toFixed(3)))
                      : selectedCue.durationSec
                  updateCue(selectedCue.id, { ttsSrc, durationSec, ttsHash: undefined })
                  setTtsUnlocked(false)
                }}
              />
              <div className="editor-tts-file-row-actions">
                <Button
                  type="button"
                  size="icon-sm"
                  disabled={!selectedCue.ttsSrc}
                  onClick={() => void toggleTtsPreview()}
                  title={
                    ttsPersonalized
                      ? 'Превью с именем из конструктора; у гостя будет своё'
                      : ttsPreviewPlaying
                        ? 'Стоп'
                        : 'Прослушать озвучку'
                  }
                  aria-label={ttsPreviewPlaying ? 'Стоп' : 'Слушать'}
                >
                  {ttsPreviewPlaying ? <Square aria-hidden /> : <Play aria-hidden />}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  disabled={!selectedCue.ttsSrc || ttsPersonalized}
                  title={
                    ttsPersonalized
                      ? 'При {name} файл задаётся при выдаче ссылки'
                      : 'Отключить озвучку от титра'
                  }
                  aria-label="Удалить озвучку"
                  onClick={() => {
                    if (!selectedCue.ttsSrc || ttsPersonalized) return
                    stopPreview()
                    updateCue(selectedCue.id, { ttsSrc: undefined, ttsHash: undefined })
                    setTtsUnlocked(true)
                    setTtsGenMessage(null)
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
            {ttsPersonalized ? (
              <p className="editor-hint">
                В тексте есть {'{name}'} — файл для гостя соберётся при выдаче ссылки. Выбор файла
                отключён.
              </p>
            ) : null}
          </Field>
          {selectedCue.ttsSrc ? (
            <audio
              ref={ttsPreviewAudioRef}
              key={`${selectedCue.ttsSrc}:${selectedCue.ttsHash ?? ''}:${ttsPreviewBump}`}
              className="editor-tts-audio-hidden"
              preload="auto"
              src={`${ttsPlaybackUrl(selectedCue.ttsSrc)}?v=${encodeURIComponent(
                `${selectedCue.ttsHash ?? '1'}-${ttsPreviewBump || '0'}`,
              )}`}
              onEnded={() => setTtsPreviewPlaying(false)}
              onPause={() => setTtsPreviewPlaying(false)}
              onPlay={() => setTtsPreviewPlaying(true)}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                if (!Number.isFinite(d) || d <= 0) return
                if (ttsDurations[selectedCue.ttsSrc!] == null) {
                  void ensureTtsFile(selectedCue.ttsSrc!, d)
                }
                if (selectedCue.durationSec < d - 0.001) {
                  updateCue(selectedCue.id, { durationSec: Number(d.toFixed(3)) })
                }
              }}
              onError={() => {
                setTtsPreviewPlaying(false)
                setTtsGenMessage(`Не загружается: ${selectedCue.ttsSrc}`)
              }}
            />
          ) : null}
          {ttsError ? <p className="editor-hint">TTS: {ttsError}</p> : null}
          {selectedCue.ttsSrc ? (
            <p className="editor-hint">
              Подключено · старт в момент cue
              {ttsDurations[selectedCue.ttsSrc] != null
                ? ` · ${ttsDurations[selectedCue.ttsSrc]!.toFixed(1)}с`
                : ''}
              ; длительность титра ≥ озвучки.
            </p>
          ) : (
            <p className="editor-hint">
              После генерации файл сам подключится к этому титру. Файлы только этого проекта
              {ttsFiles.length ? ` · ${ttsFiles.length} шт.` : ''}.
            </p>
          )}
          <CaptionThemeFields theme={theme} onPatch={patchTheme} />
          <p className="editor-hint">
            Начало: {selectedCue.startSec.toFixed(1)}с · длительность:{' '}
            {selectedCue.durationSec.toFixed(1)}с.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => removeCue(selectedCue.id)}>
              <Trash2 data-icon="inline-start" aria-hidden />
              Удалить титр
            </Button>
          </div>
        </div>
      </div>
      {canUseAi && brand ? (
        <CueCopyGenerateDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          brand={brand}
          copyFacts={copyFacts}
          sequence={sequence}
          blockMeta={resolvedMeta}
          cues={filledCues}
          cueIndex={cueIndex}
          onApply={(draft) => {
            if (draft.title !== (sequenceTitle ?? '')) {
              onSequenceTitleChange(draft.title)
            }
            updateCue(selectedCue.id, {
              text: draft.text,
              ttsText: draft.ttsText,
            })
            setTtsUnlocked(true)
            setTtsGenMessage('Текст обновлён ИИ — при необходимости перегенерируйте озвучку')
          }}
        />
      ) : null}
    </div>
  )
}
