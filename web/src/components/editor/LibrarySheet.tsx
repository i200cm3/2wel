import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeEvent, DragEvent, RefObject } from 'react'
import { Check, Images, Link2, Music, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { FolderCombobox, type FolderOption } from '@/components/FolderCombobox'
import { LibraryAudioRow } from '@/components/editor/LibraryAudioRow'
import type { LibraryTab, ProjectAudioItem } from '@/components/editor/editorTypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  dataTransferHasFiles,
  libraryFilesFromDataTransfer,
  type LibraryImportProgress,
} from '@/lib/mediaUpload'
import { isVideoSrc } from '@/types/story'

type Props = {
  open: boolean
  onOpenChange: (open: boolean, details?: { cancel: () => void }) => void
  libraryTab: LibraryTab
  setLibraryTab: (tab: LibraryTab) => void
  awaitingClipAdd: boolean
  librarySrcs: string[]
  filteredLibrarySrcs: string[]
  libPhotoQuery: string
  setLibPhotoQuery: (q: string) => void
  folderOptions: FolderOption[]
  libFolders: string[]
  setLibFolders: (next: string[]) => void
  libError: string | null
  libUploadError: string | null
  libUploading: boolean
  libUploadProgress: LibraryImportProgress | null
  libFileHover: boolean
  setLibFileHover: (v: boolean) => void
  libraryUploadFolderLabel: string
  libFileInputRef: RefObject<HTMLInputElement | null>
  importLibraryFiles: (files: File[]) => void
  libDragSrc: string | null
  usedInProject: Set<string>
  libFocusSrcs: string[]
  libraryThumbUrl: (src: string) => string
  libraryFileName: (src: string) => string
  onLibraryClick: (src: string) => void
  onLibraryPick: (src: string) => void
  beginLibPointerDrag: (src: string, thumb: string, event: ReactPointerEvent) => void
  deleteLibrarySrc: (src: string) => void
  deleteLibrarySrcs: (srcs: string[]) => void | Promise<void>
  setMediaUrlOpen: (open: boolean) => void
  setMediaUrlDraft: (v: string) => void
  setMediaUrlError: (v: string | null) => void
  libPreviewSrc: string | null
  setLibPreviewSrc: (src: string | null) => void
  libAudioRef: RefObject<HTMLAudioElement | null>
  libAudioSrc: string | null
  libAudioPlaying: boolean
  libAudioDurations: Record<string, number>
  setLibAudioDurations: (
    fn: (prev: Record<string, number>) => Record<string, number>,
  ) => void
  setLibAudioPlaying: (v: boolean) => void
  musicItem: ProjectAudioItem | undefined
  usedTtsItems: ProjectAudioItem[]
  ttsDurations: Record<string, number>
  toggleLibAudio: (src: string, kind: 'music' | 'tts') => void
}

export function LibrarySheet({
  open,
  onOpenChange,
  libraryTab,
  setLibraryTab,
  awaitingClipAdd,
  librarySrcs,
  filteredLibrarySrcs,
  libPhotoQuery,
  setLibPhotoQuery,
  folderOptions,
  libFolders,
  setLibFolders,
  libError,
  libUploadError,
  libUploading,
  libUploadProgress,
  libFileHover,
  setLibFileHover,
  libraryUploadFolderLabel,
  libFileInputRef,
  importLibraryFiles,
  libDragSrc,
  usedInProject,
  libFocusSrcs,
  libraryThumbUrl,
  libraryFileName,
  onLibraryClick,
  onLibraryPick,
  beginLibPointerDrag,
  deleteLibrarySrc,
  deleteLibrarySrcs,
  setMediaUrlOpen,
  setMediaUrlDraft,
  setMediaUrlError,
  libPreviewSrc,
  setLibPreviewSrc,
  libAudioRef,
  libAudioSrc,
  libAudioPlaying,
  libAudioDurations,
  setLibAudioDurations,
  setLibAudioPlaying,
  musicItem,
  usedTtsItems,
  ttsDurations,
  toggleLibAudio,
}: Props) {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedSrcs, setSelectedSrcs] = useState<string[]>([])

  useEffect(() => {
    if (!open || libraryTab !== 'photos') {
      setSelectMode(false)
      setSelectedSrcs([])
    }
  }, [open, libraryTab])

  useEffect(() => {
    setSelectedSrcs((prev) => prev.filter((src) => librarySrcs.includes(src)))
  }, [librarySrcs])

  const selectedVisibleCount = useMemo(() => {
    const selected = new Set(selectedSrcs)
    return filteredLibrarySrcs.reduce((count, src) => count + (selected.has(src) ? 1 : 0), 0)
  }, [filteredLibrarySrcs, selectedSrcs])

  const allVisibleSelected =
    filteredLibrarySrcs.length > 0 && selectedVisibleCount === filteredLibrarySrcs.length

  const toggleSelected = (src: string) => {
    setSelectedSrcs((prev) =>
      prev.includes(src) ? prev.filter((item) => item !== src) : [...prev, src],
    )
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedSrcs([])
  }

  const onDeleteSelected = () => {
    if (!selectedSrcs.length || libUploading) return
    const count = selectedSrcs.length
    const usedCount = selectedSrcs.filter((src) => usedInProject.has(src)).length
    const usedNote = usedCount
      ? `\n\n${usedCount === 1 ? 'Этот файл используется' : `${usedCount} файлов используются`} в блоках и будет удалён из timeline.`
      : ''
    if (
      !window.confirm(
        `${
          count === 1
            ? 'Удалить выбранный файл из медиатеки?'
            : `Удалить ${count} файлов из медиатеки?`
        }${usedNote}`,
      )
    ) {
      return
    }
    const toDelete = [...selectedSrcs]
    exitSelectMode()
    void deleteLibrarySrcs(toDelete)
  }

  const onFileDrop = (e: DragEvent<HTMLButtonElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer) || libDragSrc) return
    e.preventDefault()
    e.stopPropagation()
    setLibFileHover(false)
    void libraryFilesFromDataTransfer(e.dataTransfer).then((files) => importLibraryFiles(files))
  }

  return (
    <>
      <Sheet
        open={open}
        modal={false}
        disablePointerDismissal={Boolean(libFileHover || libUploading)}
        onOpenChange={onOpenChange}
      >
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Медиатека</SheetTitle>
            <SheetDescription>
              {libraryTab === 'photos'
                ? `${filteredLibrarySrcs.length}${
                    libPhotoQuery.trim() && filteredLibrarySrcs.length !== librarySrcs.length
                      ? ` из ${librarySrcs.length}`
                      : ''
                  } файлов${libError ? ` · ошибка: ${libError}` : ''}${
                    selectMode
                      ? ` · выбрано ${selectedSrcs.length}`
                      : awaitingClipAdd
                        ? ' · выберите медиа для нового слайда'
                        : ''
                  }`
                : `Фон плеера · озвучка объекта${
                    usedTtsItems.length ? ` · ${usedTtsItems.length}` : ''
                  }`}
            </SheetDescription>
          </SheetHeader>
          <audio
            ref={libAudioRef}
            className="sr-only"
            preload="metadata"
            onEnded={() => setLibAudioPlaying(false)}
            onPause={() => setLibAudioPlaying(false)}
            onPlay={() => setLibAudioPlaying(true)}
            onLoadedMetadata={(e) => {
              const src = libAudioSrc
              const d = e.currentTarget.duration
              if (!src || !Number.isFinite(d) || d <= 0) return
              setLibAudioDurations((prev) => (prev[src] === d ? prev : { ...prev, [src]: d }))
            }}
          />
          <Tabs
            value={libraryTab}
            onValueChange={(v) => setLibraryTab(v as LibraryTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="px-4 pt-3">
              <TabsList className="w-full">
                <TabsTrigger value="photos">
                  <Images aria-hidden />
                  Медиа
                </TabsTrigger>
                <TabsTrigger value="audio">
                  <Music aria-hidden />
                  Аудио
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value="photos"
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 pt-3"
            >
              <input
                ref={libFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.m4v"
                multiple
                hidden
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const files = [...(e.target.files ?? [])]
                  if (files.length) void importLibraryFiles(files)
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={libUploading || selectMode}
                onClick={() => libFileInputRef.current?.click()}
                onDragOver={(e) => {
                  if (!dataTransferHasFiles(e.dataTransfer) || libDragSrc || selectMode) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'copy'
                  setLibFileHover(true)
                }}
                onDrop={onFileDrop}
                className={cn(
                  'h-auto min-h-28 w-full justify-center whitespace-normal border-dashed px-4 py-6 text-left text-sm font-normal',
                  'bg-accent text-accent-foreground',
                  libFileHover && 'border-primary bg-primary/15',
                )}
              >
                <Upload data-icon="inline-start" aria-hidden />
                <span>
                  {libUploading
                    ? libUploadProgress?.phase === 'scan'
                      ? 'Читаю папку…'
                      : libUploadProgress?.phase === 'resize'
                        ? 'Ресайз…'
                        : 'Импорт…'
                    : libFileHover
                      ? 'Отпустите, чтобы добавить в медиатеку'
                      : `Перетащите фото, видео или папку сюда или нажмите · папка: ${libraryUploadFolderLabel}`}
                </span>
              </Button>
              {libUploadProgress ? (
                <div className="rounded-lg border bg-muted/40 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {libUploadProgress.phase === 'scan'
                        ? `Читаю папку… найдено ${libUploadProgress.current}`
                        : libUploadProgress.phase === 'resize'
                          ? `Ресайз ${libUploadProgress.current} из ${libUploadProgress.total}${
                              libUploadProgress.fileName ? ` · ${libUploadProgress.fileName}` : ''
                            }`
                          : `Импорт ${libUploadProgress.current} из ${libUploadProgress.total}${
                              libUploadProgress.fileName ? ` · ${libUploadProgress.fileName}` : ''
                            }`}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {libUploadProgress.phase === 'scan'
                        ? `${libUploadProgress.current}`
                        : `${libUploadProgress.percent}%`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background">
                    <div
                      className={
                        libUploadProgress.phase === 'scan'
                          ? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                          : 'h-full rounded-full bg-primary transition-[width]'
                      }
                      style={
                        libUploadProgress.phase === 'scan'
                          ? undefined
                          : { width: `${libUploadProgress.percent}%` }
                      }
                    />
                  </div>
                </div>
              ) : null}
              {libUploadError ? <p className="text-destructive text-xs">{libUploadError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectMode}
                  onClick={() => {
                    setMediaUrlError(null)
                    setMediaUrlDraft('')
                    setMediaUrlOpen(true)
                  }}
                  title="Прямая ссылка на JPG/PNG/WebP/MP4/WebM"
                >
                  <Link2 data-icon="inline-start" aria-hidden />
                  По ссылке
                </Button>
                {selectMode ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!filteredLibrarySrcs.length || libUploading}
                      onClick={() => {
                        if (allVisibleSelected) {
                          const visible = new Set(filteredLibrarySrcs)
                          setSelectedSrcs((prev) => prev.filter((src) => !visible.has(src)))
                          return
                        }
                        setSelectedSrcs((prev) => [
                          ...new Set([...prev, ...filteredLibrarySrcs]),
                        ])
                      }}
                    >
                      {allVisibleSelected ? 'Снять видимые' : 'Выбрать видимые'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={!selectedSrcs.length || libUploading}
                      onClick={onDeleteSelected}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden />
                      Удалить{selectedSrcs.length ? ` (${selectedSrcs.length})` : ''}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={libUploading}
                      onClick={exitSelectMode}
                    >
                      Отмена
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!filteredLibrarySrcs.length || libUploading}
                    onClick={() => {
                      setSelectMode(true)
                      setSelectedSrcs([])
                      setLibPreviewSrc(null)
                    }}
                  >
                    Выбрать
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {selectMode
                  ? 'Клик — отметить файл · затем «Удалить»'
                  : awaitingClipAdd
                    ? 'Выберите фото или видео — оно станет новым слайдом'
                    : 'Перетащите на кадр, чтобы заменить · клик — увеличить · двойной или правый клик — добавить в проект'}
              </p>
              <FolderCombobox
                options={folderOptions}
                value={libFolders}
                onChange={setLibFolders}
                placeholder="Добавить папку…"
                emptyLabel="Все папки"
              />
              <div className="relative">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={libPhotoQuery}
                  onChange={(e) => setLibPhotoQuery(e.target.value)}
                  placeholder="Поиск медиа…"
                  aria-label="Поиск медиа"
                  className="h-9 pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
                />
                {libPhotoQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute top-1/2 right-1.5 -translate-y-1/2"
                    aria-label="Очистить поиск"
                    onClick={() => setLibPhotoQuery('')}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </div>
              <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                {filteredLibrarySrcs.length ? (
                  <div className="editor-library-grid pr-3">
                    {filteredLibrarySrcs.map((src) => {
                      const selected = selectedSrcs.includes(src)
                      return (
                        <ContextMenu key={src}>
                          <ContextMenuTrigger
                            render={
                              <button
                                type="button"
                                draggable={false}
                                aria-pressed={selectMode ? selected : undefined}
                                className={`editor-lib-item${libDragSrc === src ? ' is-dragging' : ''}${
                                  libFocusSrcs.includes(src) ? ' is-new' : ''
                                }${selectMode ? ' is-select-mode' : ''}${
                                  selectMode && selected ? ' is-selected' : ''
                                }`}
                                data-lib-src={src}
                                title={
                                  usedInProject.has(src)
                                    ? `${libraryFileName(src)} · в проекте`
                                    : libraryFileName(src)
                                }
                                onPointerDown={(e) => {
                                  if (selectMode || e.button !== 0) return
                                  beginLibPointerDrag(src, libraryThumbUrl(src), e)
                                }}
                                onDragStart={(e) => e.preventDefault()}
                                onClick={() => {
                                  if (selectMode) {
                                    toggleSelected(src)
                                    return
                                  }
                                  onLibraryClick(src)
                                }}
                                onDoubleClick={(e) => {
                                  if (selectMode) {
                                    e.preventDefault()
                                    return
                                  }
                                  e.preventDefault()
                                  onLibraryPick(src)
                                }}
                              >
                                {isVideoSrc(src) ? (
                                  <video
                                    src={libraryThumbUrl(src)}
                                    className="editor-lib-item-img"
                                    muted
                                    playsInline
                                    preload="metadata"
                                    draggable={false}
                                  />
                                ) : (
                                  <img
                                    src={libraryThumbUrl(src)}
                                    alt=""
                                    className="editor-lib-item-img"
                                    draggable={false}
                                  />
                                )}
                                {selectMode ? (
                                  <span
                                    className={cn(
                                      'pointer-events-none absolute top-1 left-1 flex size-5 items-center justify-center rounded-sm border shadow-md',
                                      selected
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-white/80 bg-black/35 text-transparent',
                                    )}
                                    aria-hidden
                                  >
                                    <Check className="size-3.5" />
                                  </span>
                                ) : null}
                                {usedInProject.has(src) ? (
                                  <Badge className="pointer-events-none absolute top-1 right-1 bg-green-600 px-1.5 text-[10px] font-semibold text-white shadow-md ring-1 ring-black/40">
                                    В проекте
                                  </Badge>
                                ) : null}
                              </button>
                            }
                          />
                          <ContextMenuContent>
                            {selectMode ? (
                              <>
                                <ContextMenuItem onClick={() => toggleSelected(src)}>
                                  <Check aria-hidden />
                                  {selected ? 'Снять выбор' : 'Выбрать'}
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                              </>
                            ) : (
                              <>
                                <ContextMenuItem onClick={() => onLibraryPick(src)}>
                                  <Plus aria-hidden />
                                  Добавить в проект
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                              </>
                            )}
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => void deleteLibrarySrc(src)}
                            >
                              <Trash2 aria-hidden />
                              Удалить
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground px-1 text-xs">
                    {libPhotoQuery.trim() ? 'Ничего не найдено' : 'В выбранных папках нет фото'}
                  </p>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent
              value="audio"
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 pt-3"
            >
              <p className="text-muted-foreground text-xs">
                Файлы, которые уже стоят в этом объекте: фон плеера и озвучка титров.
              </p>
              <ScrollArea className="min-h-0 flex-1 overflow-hidden">
                <div className="flex flex-col gap-4 pr-3">
                  {musicItem ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-muted-foreground text-xs tracking-wide uppercase">
                        Фоновая музыка
                      </p>
                      <LibraryAudioRow
                        item={musicItem}
                        playing={libAudioPlaying && libAudioSrc === musicItem.src}
                        durationSec={libAudioDurations[musicItem.src] ?? ttsDurations[musicItem.src]}
                        onToggle={() => void toggleLibAudio(musicItem.src, 'music')}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">Озвучка</p>
                    {usedTtsItems.length ? (
                      usedTtsItems.map((item) => (
                        <LibraryAudioRow
                          key={item.src}
                          item={item}
                          playing={libAudioPlaying && libAudioSrc === item.src}
                          durationSec={ttsDurations[item.src] ?? libAudioDurations[item.src]}
                          onToggle={() => void toggleLibAudio(item.src, 'tts')}
                        />
                      ))
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        В этом объекте нет подключённой озвучки
                      </p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {libPreviewSrc
        ? createPortal(
            <div
              className="lib-lightbox"
              role="dialog"
              aria-modal="true"
              onClick={() => setLibPreviewSrc(null)}
            >
              <div className="lib-lightbox-inner" onClick={(e) => e.stopPropagation()}>
                {isVideoSrc(libPreviewSrc) ? (
                  <video
                    src={libraryThumbUrl(libPreviewSrc)}
                    className="lib-lightbox-img"
                    controls
                    playsInline
                    muted
                  />
                ) : (
                  <img src={libraryThumbUrl(libPreviewSrc)} alt="" className="lib-lightbox-img" />
                )}
                <div className="lib-lightbox-actions">
                  <Button type="button" size="sm" onClick={() => onLibraryPick(libPreviewSrc)}>
                    Добавить в таймлайн
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLibPreviewSrc(null)}
                  >
                    Закрыть
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
