import type { RefObject } from 'react'
import { ChevronLeft, ChevronRight, Crop, Move, Play, Square, Trash2 } from 'lucide-react'
import { Combobox } from '@/components/Combobox'
import { CropPathEditor } from '@/components/CropPathEditor'
import { StoryPlayer } from '@/components/StoryPlayer'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CLIP_TRANSITIONS,
  DEFAULT_EASING,
  DEFAULT_TRANSITION,
  EASING_LABELS,
  EASING_PRESETS,
  MOTION_LABELS,
  MOTION_PRESETS,
  TRANSITION_LABELS,
  captionBarStyle,
  clipMediaKind,
  type ClipTransition,
  type EasingPreset,
  type MotionPath,
  type MotionPreset,
  type PropertyTheme,
  type StoryClip,
} from '@/types/story'
import {
  inspectorFieldsClass,
  inspectorGridClass,
  inspectorShellClass,
  inspectorStageClass,
  type InspectorTab,
} from './editorTypes'
import { isLibraryDrag, readLibrarySrc, sliderNumber } from './timelineMath'

type Props = {
  selected: StoryClip
  inspectorRef: RefObject<HTMLDivElement | null>
  isLandscape: boolean
  viewAspect: number
  theme: PropertyTheme
  displayTitle: string
  slidePreview: boolean
  slidePreviewKey: number
  slidePreviewClipsRef: RefObject<StoryClip[] | null>
  inspectorTab: InspectorTab
  setInspectorTab: (tab: InspectorTab) => void
  libDragSrc: string | null
  libDropOnPreview: boolean
  setLibDropOnPreview: (v: boolean) => void
  replaceClipSrc: (clipId: string, src: string) => void
  applyPath: (clipId: string, path: MotionPath) => void
  applyPreset: (clipId: string, motion: MotionPreset) => void
  updateClip: (clipId: string, patch: Partial<StoryClip>) => void
  moveClip: (clipId: string, dir: -1 | 1) => void
  removeClip: (clipId: string) => void
  setSlidePreview: (v: boolean) => void
  setSlidePreviewKey: (fn: (k: number) => number) => void
}

export function ClipInspector({
  selected,
  inspectorRef,
  isLandscape,
  viewAspect,
  theme,
  displayTitle,
  slidePreview,
  slidePreviewKey,
  slidePreviewClipsRef,
  inspectorTab,
  setInspectorTab,
  libDragSrc,
  libDropOnPreview,
  setLibDropOnPreview,
  replaceClipSrc,
  applyPath,
  applyPreset,
  updateClip,
  moveClip,
  removeClip,
  setSlidePreview,
  setSlidePreviewKey,
}: Props) {
  const isVideo = clipMediaKind(selected) === 'video'
  const toggleSlidePreview = () => {
    if (slidePreview) {
      slidePreviewClipsRef.current = null
      setSlidePreview(false)
      return
    }
    slidePreviewClipsRef.current = [selected]
    setSlidePreviewKey((k) => k + 1)
    setSlidePreview(true)
  }

  return (
    <div ref={inspectorRef} className={`${inspectorShellClass} ${inspectorGridClass} items-start`}>
      <div className={`${inspectorStageClass}${slidePreview ? ' is-preview' : ''}`}>
        <div
          className={`editor-crop-drop${libDropOnPreview ? ' is-lib-drop' : ''}`}
          onDragOver={(e) => {
            if (!(isLibraryDrag(e.dataTransfer) || libDragSrc)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setLibDropOnPreview(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setLibDropOnPreview(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            const libSrc = readLibrarySrc(e.dataTransfer) || libDragSrc
            if (libSrc) replaceClipSrc(selected.id, libSrc)
            else setLibDropOnPreview(false)
          }}
        >
          {isVideo ? (
            <div className="editor-video-still">
              <video
                key={selected.src}
                src={selected.src}
                className="editor-video-still-media"
                muted
                playsInline
                controls
                preload="metadata"
              />
              <p className="text-muted-foreground mt-2 text-xs">
                Видео играет по длительности слайда. Кроп и Ken Burns пока только для фото.
              </p>
            </div>
          ) : (
            <div
              className={`editor-crop-workspace${isLandscape ? ' is-landscape' : ''}`}
            >
              <CropPathEditor
                src={selected.src}
                from={selected.from}
                to={selected.to}
                linked={selected.motion === 'none'}
                viewAspect={viewAspect}
                onChange={(path) => applyPath(selected.id, path)}
              />
            </div>
          )}
        </div>
        {slidePreview ? (
          <div className="editor-slide-preview-overlay">
            <div className={`editor-inspector-phone${isLandscape ? ' is-landscape' : ''}`}>
              <StoryPlayer
                key={`slide-anim-${selected.id}-${slidePreviewKey}-${theme.orientation}`}
                clips={slidePreviewClipsRef.current ?? [selected]}
                title={displayTitle}
                captionBarStyle={captionBarStyle(theme)}
                onEnded={() => undefined}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className={inspectorFieldsClass}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={slidePreview ? 'outline' : 'default'}
            size="sm"
            onClick={toggleSlidePreview}
            title="Пробел — превью слайда"
          >
            {slidePreview ? (
              <>
                <Square data-icon="inline-start" aria-hidden />
                Стоп
              </>
            ) : (
              <>
                <Play data-icon="inline-start" aria-hidden fill="currentColor" strokeWidth={0} />
                Превью слайда ({isLandscape ? '16:9' : '9:16'})
              </>
            )}
          </Button>
        </div>
        <Tabs
          value={inspectorTab}
          onValueChange={(v) => {
            if (v === 'frame' || v === 'motion') setInspectorTab(v)
          }}
          className="w-full"
        >
          <TabsList className="w-full">
            <TabsTrigger value="frame" disabled={isVideo}>
              <Crop data-icon="inline-start" aria-hidden />
              Кадр
            </TabsTrigger>
            <TabsTrigger value="motion" disabled={isVideo}>
              <Move data-icon="inline-start" aria-hidden />
              Анимация
            </TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 flex-col gap-3">
            {isVideo ? (
              <>
                <p className="text-muted-foreground text-xs">
                  Кроп и Ken Burns — только для фото. Звук ролика по умолчанию выключен, чтобы не
                  пересекаться с озвучкой титров.
                </p>
                <Field orientation="horizontal">
                  <FieldLabel>Звук видео</FieldLabel>
                  <Switch
                    checked={Boolean(selected.playVideoAudio)}
                    onCheckedChange={(checked) =>
                      updateClip(selected.id, { playVideoAudio: checked === true })
                    }
                  />
                </Field>
                {selected.playVideoAudio ? (
                  <p className="text-muted-foreground text-xs">
                    Звук ролика играет вместе с музыкой и TTS.
                  </p>
                ) : null}
                <Field>
                  <FieldLabel>Переход на слайд</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    value={selected.transition ?? DEFAULT_TRANSITION}
                    onChange={(e) =>
                      updateClip(selected.id, {
                        transition: e.target.value as ClipTransition,
                      })
                    }
                  >
                    {CLIP_TRANSITIONS.map((t) => (
                      <NativeSelectOption key={t} value={t}>
                        {TRANSITION_LABELS[t]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            ) : (
              <>
            <TabsContent value="motion">
              <label>
                Анимация
                <div className="editor-motion-combobox">
                  <Combobox
                    aria-label="Пресет анимации"
                    placeholder="Анимация"
                    items={MOTION_PRESETS.map((m) => ({
                      value: m,
                      label: MOTION_LABELS[m],
                    }))}
                    value={selected.motion}
                    onValueChange={(next) => applyPreset(selected.id, next as MotionPreset)}
                  />
                </div>
              </label>
              <Field>
                <FieldLabel>Скорость</FieldLabel>
                <NativeSelect
                  className="w-full"
                  value={selected.easing ?? DEFAULT_EASING}
                  onChange={(e) =>
                    updateClip(selected.id, { easing: e.target.value as EasingPreset })
                  }
                >
                  {EASING_PRESETS.map((ease) => (
                    <NativeSelectOption key={ease} value={ease}>
                      {EASING_LABELS[ease]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>Переход на слайд</FieldLabel>
                <NativeSelect
                  className="w-full"
                  value={selected.transition ?? DEFAULT_TRANSITION}
                  onChange={(e) =>
                    updateClip(selected.id, {
                      transition: e.target.value as ClipTransition,
                    })
                  }
                >
                  {CLIP_TRANSITIONS.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {TRANSITION_LABELS[t]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <p className="editor-motion-hint">
                {selected.motion === 'none'
                  ? 'Без анимации: выбери область кадра (зум и положение). A и B совпадают.'
                  : 'Рамка A — старт, B — финиш. Чем больше зум, тем меньше рамка.'}{' '}
                Переход — как появляется этот слайд с предыдущего (по умолчанию без анимации).
              </p>
            </TabsContent>
            <TabsContent value="frame">
              {slidePreview ? (
                <p className="editor-hint">
                  Вертикальный кадр — как у гостя. Остановите превью, чтобы править рамки A/B и зум.
                </p>
              ) : (
                <p className="editor-hint">
                  Полное фото крупно — двигай рамку. Мини-телефон справа показывает кадр гостя. На
                  панораме прокрути холст влево/вправо.
                </p>
              )}
              {selected.motion === 'none' ? (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <label className="editor-field">
                      <span className="editor-field-label">X</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.from.x.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          const x = Math.min(1, Math.max(0, v))
                          applyPath(selected.id, {
                            from: { ...selected.from, x },
                            to: { ...selected.to, x },
                          })
                        }}
                      />
                    </label>
                    <label className="editor-field">
                      <span className="editor-field-label">Y</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.from.y.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          const y = Math.min(1, Math.max(0, v))
                          applyPath(selected.id, {
                            from: { ...selected.from, y },
                            to: { ...selected.to, y },
                          })
                        }}
                      />
                    </label>
                  </div>
                  <p className="editor-hint">X/Y — центр кадра на фото, от 0 до 1 (0.5 = середина).</p>
                  <label className="editor-field">
                    <span className="editor-field-label">Зум</span>
                    <div className="editor-field-controls">
                      <Slider
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={[selected.from.scale]}
                        onValueChange={(v) => {
                          const scale = sliderNumber(v)
                          applyPath(selected.id, {
                            from: { ...selected.from, scale },
                            to: { ...selected.to, scale },
                          })
                        }}
                      />
                      <Input
                        type="number"
                        className="editor-num"
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={Number(selected.from.scale.toFixed(2))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          const scale = Math.min(1.35, Math.max(1, v))
                          applyPath(selected.id, {
                            from: { ...selected.from, scale },
                            to: { ...selected.to, scale },
                          })
                        }}
                      />
                    </div>
                  </label>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <label className="editor-field">
                      <span className="editor-field-label">A · X</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.from.x.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: { ...selected.from, x: Math.min(1, Math.max(0, v)) },
                            to: selected.to,
                          })
                        }}
                      />
                    </label>
                    <label className="editor-field">
                      <span className="editor-field-label">A · Y</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.from.y.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: { ...selected.from, y: Math.min(1, Math.max(0, v)) },
                            to: selected.to,
                          })
                        }}
                      />
                    </label>
                    <label className="editor-field">
                      <span className="editor-field-label">B · X</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.to.x.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: selected.from,
                            to: { ...selected.to, x: Math.min(1, Math.max(0, v)) },
                          })
                        }}
                      />
                    </label>
                    <label className="editor-field">
                      <span className="editor-field-label">B · Y</span>
                      <Input
                        type="number"
                        className="editor-num editor-num-wide"
                        min={0}
                        max={1}
                        step={0.001}
                        value={Number(selected.to.y.toFixed(3))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: selected.from,
                            to: { ...selected.to, y: Math.min(1, Math.max(0, v)) },
                          })
                        }}
                      />
                    </label>
                  </div>
                  <p className="editor-hint">A/B · X/Y — центр кадра на фото, от 0 до 1 (0.5 = середина).</p>
                  <label className="editor-field">
                    <span className="editor-field-label">Зум A</span>
                    <div className="editor-field-controls">
                      <Slider
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={[selected.from.scale]}
                        onValueChange={(v) =>
                          applyPath(selected.id, {
                            from: { ...selected.from, scale: sliderNumber(v) },
                            to: selected.to,
                          })
                        }
                      />
                      <Input
                        type="number"
                        className="editor-num"
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={Number(selected.from.scale.toFixed(2))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: { ...selected.from, scale: Math.min(1.35, Math.max(1, v)) },
                            to: selected.to,
                          })
                        }}
                      />
                    </div>
                  </label>
                  <label className="editor-field">
                    <span className="editor-field-label">Зум B</span>
                    <div className="editor-field-controls">
                      <Slider
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={[selected.to.scale]}
                        onValueChange={(v) =>
                          applyPath(selected.id, {
                            from: selected.from,
                            to: { ...selected.to, scale: sliderNumber(v) },
                          })
                        }
                      />
                      <Input
                        type="number"
                        className="editor-num"
                        min={1}
                        max={1.35}
                        step={0.01}
                        value={Number(selected.to.scale.toFixed(2))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          applyPath(selected.id, {
                            from: selected.from,
                            to: { ...selected.to, scale: Math.min(1.35, Math.max(1, v)) },
                          })
                        }}
                      />
                    </div>
                  </label>
                </>
              )}
            </TabsContent>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Сдвинуть влево"
                onClick={() => moveClip(selected.id, -1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Сдвинуть вправо"
                onClick={() => moveClip(selected.id, 1)}
              >
                <ChevronRight aria-hidden />
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => removeClip(selected.id)}>
                <Trash2 data-icon="inline-start" aria-hidden />
                Удалить
              </Button>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  )
}
