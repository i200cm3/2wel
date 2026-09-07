import { useCallback, useEffect, useState } from 'react'
import { Copy, Lock, LockOpen, Mic, Play, Square } from 'lucide-react'
import { MenuScreen } from '@/components/MenuScreen'
import { TtsFileSelect } from '@/components/TtsFileSelect'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  generateTts,
  speakTextForTts,
  ttsTextNeedsGuestName,
} from '@/lib/ttsGenerate'
import {
  DEFAULT_MENU_TITLE,
  normalizeMenuCopy,
  type MenuCopy,
  type MenuLink,
  type MenuTheme,
  type PropertyBrand,
  type PropertyBranch,
} from '@/types/story'
import { MenuBackgroundFields } from './MenuBackgroundFields'
import { MenuContactFields } from './MenuContactFields'
import { MenuCopyFields } from './MenuCopyFields'
import { MenuLinksFields } from './MenuLinksFields'
import { MenuThemeFields } from './MenuThemeFields'
import { ttsFileLabel } from './timelineMath'

/** Текст озвучки из заголовка меню (кнопка «из текста»). */
export function buildMenuTtsFromCopy(copy?: MenuCopy): string {
  const c = normalizeMenuCopy(copy)
  if (c.showTitle === false) return ''
  const title = (c.title ?? DEFAULT_MENU_TITLE).trim()
  return title.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

type Props = {
  projectCode: string
  menuId: string
  brand: PropertyBrand
  guestName: string
  branches: PropertyBranch[]
  menuCopy?: MenuCopy
  menuTheme?: MenuTheme
  menuLinks?: MenuLink[]
  menuBgSrc?: string
  menuTtsText?: string
  menuTtsSrc?: string
  menuTtsHash?: string
  menuTtsFirstOnly?: boolean
  ttsFiles: string[]
  ttsVolume: number
  isLandscape: boolean
  playArmed?: boolean
  onPlayArmedConsumed?: () => void
  refreshTts: () => void
  onMenuCopyChange: (copy: MenuCopy) => void
  onBrandPatch: (patch: Partial<PropertyBrand>) => void
  onMenuBgChange?: (src: string | undefined) => void
  onMenuThemePatch: (patch: Partial<MenuTheme>) => void
  onMenuLinksChange: (links: MenuLink[]) => void
  onMenuTtsPatch: (patch: {
    menuTtsText?: string
    menuTtsSrc?: string
    menuTtsHash?: string
  }) => void
  onMenuTtsFirstOnlyChange: (firstOnly: boolean) => void
}

export function MenuInspector({
  projectCode,
  menuId,
  brand,
  guestName,
  branches,
  menuCopy,
  menuTheme,
  menuLinks,
  menuBgSrc,
  menuTtsText,
  menuTtsSrc,
  menuTtsHash,
  menuTtsFirstOnly,
  ttsFiles,
  ttsVolume,
  isLandscape,
  playArmed = false,
  onPlayArmedConsumed,
  refreshTts,
  onMenuCopyChange,
  onBrandPatch,
  onMenuBgChange,
  onMenuThemePatch,
  onMenuLinksChange,
  onMenuTtsPatch,
  onMenuTtsFirstOnlyChange,
}: Props) {
  const [ttsPreviewKey, setTtsPreviewKey] = useState(0)
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const [ttsBusy, setTtsBusy] = useState(false)
  const [ttsGenMessage, setTtsGenMessage] = useState<string | null>(null)
  const [ttsUnlocked, setTtsUnlocked] = useState(false)

  const hasGeneratedTts = Boolean(menuTtsSrc?.trim())
  const ttsPersonalized = ttsTextNeedsGuestName(menuTtsText)
  const ttsLocked = hasGeneratedTts && !ttsUnlocked && !ttsPersonalized

  useEffect(() => {
    setTtsUnlocked(false)
    setTtsGenMessage(null)
    setTtsPlaying(false)
    setTtsPreviewKey(0)
  }, [menuId])

  const replayTts = useCallback(() => {
    if (!menuTtsSrc?.trim()) return
    setTtsPreviewKey((k) => k + 1)
  }, [menuTtsSrc])

  const stopTts = useCallback(() => {
    setTtsPreviewKey(0)
    setTtsPlaying(false)
  }, [])

  useEffect(() => {
    if (!playArmed) return
    replayTts()
    onPlayArmedConsumed?.()
  }, [playArmed, replayTts, onPlayArmedConsumed])

  const copyMenuTextToTts = useCallback(() => {
    if (ttsLocked) {
      setTtsGenMessage('Снимите замок, чтобы изменить текст озвучки')
      return
    }
    const next = buildMenuTtsFromCopy(menuCopy)
    onMenuTtsPatch({ menuTtsText: next })
    setTtsGenMessage(next ? 'Заголовок меню скопирован в TTS' : 'Нечего копировать')
  }, [menuCopy, onMenuTtsPatch, ttsLocked])

  const generateMenuTts = useCallback(async () => {
    if (ttsBusy) return
    const draft = (menuTtsText ?? '').trim() || buildMenuTtsFromCopy(menuCopy)
    if (!draft) {
      setTtsGenMessage('Нет текста для озвучки')
      return
    }
    const speak = speakTextForTts(draft, guestName || 'гость')
    setTtsBusy(true)
    setTtsGenMessage(null)
    try {
      const result = await generateTts(speak, { force: true, projectCode })
      onMenuTtsPatch({
        menuTtsText: draft,
        menuTtsSrc: result.src,
        menuTtsHash: result.hash,
      })
      setTtsUnlocked(false)
      setTtsPreviewKey((k) => k + 1)
      window.setTimeout(() => refreshTts(), 400)
      const voiceNote = result.voiceId ? ` · voice ${result.voiceId.slice(0, 8)}…` : ''
      const file = ttsFileLabel(result.src)
      const personal = ttsTextNeedsGuestName(draft)
        ? ' · для гостя пересоберётся при выдаче ссылки'
        : ''
      setTtsGenMessage(`Подключено · ${file}${voiceNote}${personal}`)
    } catch (err) {
      setTtsGenMessage(err instanceof Error ? err.message : 'Ошибка генерации')
    } finally {
      setTtsBusy(false)
    }
  }, [ttsBusy, menuTtsText, menuCopy, guestName, projectCode, onMenuTtsPatch, refreshTts])

  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[901px]:h-full min-[901px]:min-h-0 min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="editor-inspector-stage min-[901px]:sticky min-[901px]:top-0 min-[901px]:self-start">
        <div className={`editor-inspector-phone${isLandscape ? ' is-landscape' : ''}`}>
          <div className={`app is-player is-embedded${isLandscape ? ' is-landscape' : ''}`}>
            <div className="phone">
              <MenuScreen
                key={`menu-live-${ttsPreviewKey}-${menuBgSrc ?? 'default'}`}
                brandName={brand.fullName}
                guestName={guestName}
                branches={branches}
                menuCopy={menuCopy}
                menuTheme={menuTheme}
                menuLinks={menuLinks}
                bgSrc={menuBgSrc}
                ttsSrc={ttsPreviewKey > 0 ? menuTtsSrc : undefined}
                ttsVolume={ttsVolume}
                editable
                onLayoutPatch={onMenuThemePatch}
                onSelect={() => undefined}
                onLink={() => undefined}
                onTtsPlayingChange={setTtsPlaying}
              />
            </div>
          </div>
        </div>
        <div className="editor-inspector-stage-actions">
          <p className="editor-hint">
            Текст и кнопки на превью можно подвинуть. Квадратик справа снизу меняет ширину блока и
            размер кнопок.
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4 pb-8 min-[901px]:h-full min-[901px]:min-h-0 min-[901px]:overflow-y-auto min-[901px]:overscroll-contain min-[901px]:[scrollbar-gutter:stable]">
        <MenuCopyFields copy={menuCopy} brandName={brand.fullName} onChange={onMenuCopyChange} />
        {onMenuBgChange ? (
          <MenuBackgroundFields
            projectCode={projectCode}
            bgSrc={menuBgSrc}
            onChange={onMenuBgChange}
          />
        ) : null}
        <MenuContactFields brand={brand} onPatch={onBrandPatch} />
        <MenuLinksFields
          links={menuLinks}
          guestName={guestName}
          brand={brand}
          onChange={onMenuLinksChange}
        />
        <MenuThemeFields theme={menuTheme} onPatch={onMenuThemePatch} />
        <Accordion multiple defaultValue={['tts']} className="rounded-xl border">
          <AccordionItem value="tts" className="px-3">
            <AccordionTrigger className="hover:no-underline">Озвучка</AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="grid gap-3 pt-1">
                <Field>
                  <FieldLabel>
                    <Mic size={16} aria-hidden />
                    Текст озвучки (TTS)
                  </FieldLabel>
                  <Textarea
                    rows={3}
                    value={menuTtsText ?? ''}
                    placeholder="Текст для озвучки меню · «из текста» скопирует заголовок"
                    readOnly={ttsLocked}
                    aria-readonly={ttsLocked || undefined}
                    onChange={(e) => {
                      if (ttsLocked) return
                      onMenuTtsPatch({ menuTtsText: e.target.value })
                      setTtsGenMessage(null)
                    }}
                  />
                  {ttsPersonalized ? (
                    <p className="editor-hint">
                      Есть {'{name}'} — при выдаче ссылки озвучка соберётся заново с именем гостя и
                      текущим голосом проекта.
                    </p>
                  ) : null}
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
                      onClick={copyMenuTextToTts}
                      disabled={ttsLocked || !buildMenuTtsFromCopy(menuCopy)}
                      title={
                        ttsLocked
                          ? 'Снимите замок, чтобы скопировать'
                          : 'Скопировать заголовок меню в поле озвучки'
                      }
                    >
                      <Copy aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void generateMenuTts()}
                      disabled={
                        ttsBusy ||
                        (!(menuTtsText ?? '').trim() && !buildMenuTtsFromCopy(menuCopy))
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
                    <p className="editor-hint">
                      Озвучка сгенерирована — снимите замок, чтобы изменить текст.
                    </p>
                  ) : null}
                  {ttsGenMessage ? <p className="editor-hint">{ttsGenMessage}</p> : null}
                  {menuTtsHash ? (
                    <p className="editor-hint editor-tts-hash">
                      hash {menuTtsHash.slice(0, 12)}…
                    </p>
                  ) : null}
                </Field>
                <div className="grid gap-3 min-[901px]:grid-cols-2 min-[901px]:items-end">
                  <Field>
                    <FieldLabel>Файл</FieldLabel>
                    <div className="editor-tts-file-row">
                      <TtsFileSelect
                        files={ttsFiles}
                        value={menuTtsSrc}
                        aria-label="Озвучка меню"
                        onValueChange={(src) => onMenuTtsPatch({ menuTtsSrc: src })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={!menuTtsSrc?.trim()}
                        onClick={() => (ttsPlaying ? stopTts() : replayTts())}
                        title={
                          !menuTtsSrc?.trim()
                            ? 'Сначала выберите файл озвучки'
                            : ttsPlaying
                              ? 'Стоп'
                              : 'Проиграть озвучку'
                        }
                        aria-label={ttsPlaying ? 'Стоп' : 'Проиграть озвучку'}
                      >
                        {ttsPlaying ? <Square aria-hidden /> : <Play aria-hidden />}
                      </Button>
                    </div>
                  </Field>
                  <Field orientation="horizontal" className="min-[901px]:pb-0.5">
                    <Switch
                      id="editor-menu-tts-first-only"
                      checked={menuTtsFirstOnly !== false}
                      onCheckedChange={(checked) => onMenuTtsFirstOnlyChange(checked === true)}
                    />
                    <FieldLabel htmlFor="editor-menu-tts-first-only">
                      Озвучивать только при первом входе в меню
                    </FieldLabel>
                  </Field>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}
