import { useMemo, useState } from 'react'
import { ImagePlus, RotateCcw } from 'lucide-react'
import { useMediaLibrary } from '@/hooks/useMediaLibrary'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const IMAGE_RE = /\.(jpe?g|png|webp)(\?|$)/i

type Props = {
  projectCode: string
  bgSrc?: string
  onChange: (src: string | undefined) => void
}

export function MenuBackgroundFields({ projectCode, bgSrc = '', onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { manifest, error } = useMediaLibrary(projectCode)

  const images = useMemo(() => {
    const srcs = (manifest?.items ?? [])
      .map((item) => item.src)
      .filter((src) => IMAGE_RE.test(src))
    const q = query.trim().toLowerCase()
    if (!q) return srcs
    const tokens = q.split(/\s+/).filter(Boolean)
    return srcs.filter((src) => {
      const hay = src.toLowerCase()
      return tokens.every((token) => hay.includes(token))
    })
  }, [manifest, query])

  const thumbUrl = (src: string) => {
    const mtime = manifest?.items.find((item) => item.src === src)?.mtime
    return typeof mtime === 'number' ? `${src}?v=${mtime}` : src
  }

  const current = bgSrc.trim()

  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel>Фон меню</FieldLabel>
        <FieldDescription>
          Своё фото для этого экрана меню в шаблоне. Без выбора — запасной кадр по умолчанию.
        </FieldDescription>
      </Field>

      <div className="flex flex-wrap items-end gap-4">
        <div
          className="relative w-full max-w-[140px] shrink-0 overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: '9 / 16' }}
        >
          {current ? (
            <img src={thumbUrl(current)} alt="" className="size-full object-cover" />
          ) : (
            <div className="text-muted-foreground flex size-full items-center justify-center p-3 text-center text-xs">
              Не задано
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, rgba(13, 20, 17, 0.35), rgba(13, 20, 17, 0.88))',
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <ImagePlus data-icon="inline-start" />
            Из медиатеки
          </Button>
          {current ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              <RotateCcw data-icon="inline-start" />
              Сбросить
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(88vh,40rem)] w-[min(calc(100vw-2rem),40rem)] max-w-none flex-col gap-3 overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Фон меню</DialogTitle>
            <DialogDescription>Выберите фото из медиатеки проекта.</DialogDescription>
          </DialogHeader>
          <Input
            className="shrink-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск…"
            aria-label="Поиск фото"
          />
          {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="grid grid-cols-3 gap-2 p-1 sm:grid-cols-4">
              {images.map((src) => {
                const selected = src === current
                return (
                  <button
                    key={src}
                    type="button"
                    className={`overflow-hidden rounded-lg border text-left transition ${
                      selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => {
                      onChange(src)
                      setOpen(false)
                    }}
                  >
                    <img src={thumbUrl(src)} alt="" className="aspect-[3/4] w-full object-cover" />
                  </button>
                )
              })}
            </div>
            {!images.length ? (
              <p className="text-muted-foreground px-1 py-6 text-sm">В медиатеке пока нет фото.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
