import { ImagePlus, RotateCcw } from 'lucide-react'
import { fillName } from '@/content'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  firstAutoplayImageSrc,
  normalizeEmailPreview,
  type EmailPreviewConfig,
  type PropertyConfig,
} from '@/types/story'
import { inspectorShellClass } from './editorTypes'
import { isLibraryDrag, readLibrarySrc } from './timelineMath'

type Props = {
  config: PropertyConfig
  guestName: string
  thumbUrl: (src: string) => string
  picking: boolean
  libDragSrc: string | null
  onPickFromLibrary: () => void
  onChange: (next: EmailPreviewConfig) => void
}

const IMAGE_RE = /\.(jpe?g|png|webp)(\?|$)/i

export function EmailPreviewInspector({
  config,
  guestName,
  thumbUrl,
  picking,
  libDragSrc,
  onPickFromLibrary,
  onChange,
}: Props) {
  const preview = normalizeEmailPreview(config.emailPreview)
  const autoSrc = firstAutoplayImageSrc(config)
  const src = preview.src || autoSrc
  const custom = Boolean(preview.src)
  const titleTemplate = preview.title || 'Здравствуйте, {name}!'
  const title = fillName(titleTemplate, guestName)
  const on = preview.enabled === true

  const patch = (next: Partial<EmailPreviewConfig>) => {
    onChange(normalizeEmailPreview({ ...preview, ...next }))
  }

  const applySrc = (nextSrc: string) => {
    if (!IMAGE_RE.test(nextSrc)) return
    patch({ src: nextSrc })
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-sans text-base font-medium">Превью для письма</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          JPEG по адресу ссылка/preview.jpg. Почта часто блокирует такие картинки, поэтому сборка
          выключена. Включите, когда решите, как её показывать.
        </p>
      </div>

      <Field orientation="horizontal">
        <FieldLabel htmlFor="email-preview-on">Формировать картинку</FieldLabel>
        <Switch
          id="email-preview-on"
          checked={on}
          onCheckedChange={(checked) => patch({ enabled: checked === true })}
        />
      </Field>

      {on ? (
        <>
          <div
            className={`relative mx-auto w-full max-w-[220px] overflow-hidden rounded-xl bg-black ${
              picking || libDragSrc ? 'ring-2 ring-primary' : ''
            }`}
            style={{ aspectRatio: '9 / 16' }}
            onDragOver={(e) => {
              if (!isLibraryDrag(e.dataTransfer) && !libDragSrc) return
              e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const dropped = readLibrarySrc(e.dataTransfer) || libDragSrc
              if (dropped) applySrc(dropped)
            }}
          >
            {src ? (
              <img src={thumbUrl(src)} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-xs">
                Нет кадра. Добавьте фото в автопоказ или выберите из библиотеки.
              </div>
            )}
            {src && (preview.showPlay !== false || preview.showTitle !== false) ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    preview.showTitle !== false
                      ? 'linear-gradient(to top, rgba(10,16,14,0.88) 0%, transparent 48%)'
                      : undefined,
                }}
              />
            ) : null}
            {src && preview.showPlay !== false ? (
              <div className="pointer-events-none absolute top-[42%] left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/90 bg-white/20">
                <span
                  className="ml-0.5 block border-y-[8px] border-l-[12px] border-y-transparent border-l-white"
                  aria-hidden
                />
              </div>
            ) : null}
            {src && preview.showTitle !== false ? (
              <p className="pointer-events-none absolute inset-x-3 bottom-4 text-center text-sm font-semibold text-[#e8dfd0]">
                {title}
              </p>
            ) : null}
          </div>

          <p className="text-muted-foreground text-center text-xs">
            {custom ? 'Своё фото' : 'Первый кадр автопоказа'}
            {picking ? ' · выберите снимок в библиотеке' : ''}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={picking ? 'default' : 'outline'} onClick={onPickFromLibrary}>
              <ImagePlus aria-hidden />
              {custom ? 'Заменить фото' : 'Своё фото'}
            </Button>
            {custom ? (
              <Button type="button" variant="ghost" onClick={() => patch({ src: undefined })}>
                <RotateCcw aria-hidden />
                Вернуть первый кадр
              </Button>
            ) : null}
          </div>

          <div className={inspectorShellClass}>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="email-preview-play">Иконка play</FieldLabel>
              <Switch
                id="email-preview-play"
                checked={preview.showPlay !== false}
                onCheckedChange={(checked) => patch({ showPlay: checked })}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="email-preview-title-on">Титр с именем</FieldLabel>
              <Switch
                id="email-preview-title-on"
                checked={preview.showTitle !== false}
                onCheckedChange={(checked) => patch({ showTitle: checked })}
              />
            </Field>
            {preview.showTitle !== false ? (
              <Field>
                <FieldLabel htmlFor="email-preview-title">Текст титра</FieldLabel>
                <Input
                  id="email-preview-title"
                  value={preview.title ?? ''}
                  placeholder="Здравствуйте, {name}!"
                  onChange={(e) => patch({ title: e.target.value })}
                />
                <FieldDescription>
                  {'{name}'} заменится на имя гостя из ссылки. Пусто — как в блоке «Приветствие».
                </FieldDescription>
              </Field>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
