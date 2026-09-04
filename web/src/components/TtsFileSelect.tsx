import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const NONE = 'none'

function ttsFileLabel(src: string) {
  return src.replace(/^\/media\/projects\/[^/]+\/tts\//, '').replace(/^\/media\/tts\//, '')
}

type Props = {
  files: string[]
  value?: string
  onValueChange: (src: string | undefined) => void
  extraSrc?: string
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  'aria-label'?: string
}

export function TtsFileSelect({
  files,
  value,
  onValueChange,
  extraSrc,
  placeholder = 'Нет',
  size = 'sm',
  disabled = false,
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const opts = [...files]
    if (extraSrc && !opts.includes(extraSrc)) opts.unshift(extraSrc)
    return [
      { value: NONE, label: placeholder },
      ...opts.map((src) => ({ value: src, label: ttsFileLabel(src) })),
    ]
  }, [extraSrc, files, placeholder])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q),
    )
  }, [items, query])

  return (
    <Select
      items={items}
      value={value || NONE}
      disabled={disabled}
      onValueChange={(next) => {
        onValueChange(!next || next === NONE ? undefined : next)
      }}
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
        if (!next) setQuery('')
      }}
      open={disabled ? false : open}
    >
      <SelectTrigger
        size={size}
        className="w-full min-w-0"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="max-h-72"
      >
        <div
          className="bg-popover sticky top-0 z-10 p-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Фильтр…"
            aria-label="Фильтр файлов озвучки"
            autoComplete="off"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-center text-sm">
            Ничего не найдено
          </p>
        ) : (
          <SelectGroup>
            {filtered.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}
