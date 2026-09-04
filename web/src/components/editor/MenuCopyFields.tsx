import { CircleHelp } from 'lucide-react'
import { FieldLabel } from '@/components/ui/field'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  DEFAULT_MENU_HINT,
  DEFAULT_MENU_TITLE,
  normalizeMenuCopy,
  type MenuCopy,
} from '@/types/story'

type Props = {
  copy?: MenuCopy
  brandName: string
  onChange: (copy: MenuCopy) => void
}

export function MenuCopyFields({ copy, brandName, onChange }: Props) {
  const value = normalizeMenuCopy(copy)
  const patch = (next: Partial<MenuCopy>) => onChange({ ...value, ...next })

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-base font-semibold tracking-wide">Настройка меню</h3>
        <HoverCard>
          <HoverCardTrigger
            delay={100}
            closeDelay={150}
            className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-full outline-none"
            aria-label="Подсказка по переменным"
          >
            <CircleHelp className="size-4" aria-hidden />
          </HoverCardTrigger>
          <HoverCardContent side="bottom" align="start" className="w-64">
            <p className="mb-2 text-sm font-medium">В тексте можно писать:</p>
            <ul className="text-muted-foreground space-y-1.5 text-sm">
              <li>
                <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
                  {'{name}'}
                </code>{' '}
                — имя гостя
              </li>
              <li>
                <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
                  {'{brand}'}
                </code>{' '}
                — название объекта
              </li>
            </ul>
          </HoverCardContent>
        </HoverCard>
      </div>
      <div className="grid gap-3">
        <MenuTextRow
          id="editor-menu-kicker"
          label="Надзаголовок"
          show={value.showKicker !== false}
          text={value.kicker ?? brandName}
          placeholder={brandName}
          onShowChange={(showKicker) => patch({ showKicker })}
          onTextChange={(kicker) => patch({ kicker })}
        />
        <MenuTextRow
          id="editor-menu-title"
          label="Заголовок"
          multiline
          show={value.showTitle !== false}
          text={value.title ?? DEFAULT_MENU_TITLE}
          placeholder={DEFAULT_MENU_TITLE}
          onShowChange={(showTitle) => patch({ showTitle })}
          onTextChange={(title) => patch({ title })}
        />
        <MenuTextRow
          id="editor-menu-hint"
          label="Подсказка"
          show={value.showHint !== false}
          text={value.hint ?? DEFAULT_MENU_HINT}
          placeholder={DEFAULT_MENU_HINT}
          onShowChange={(showHint) => patch({ showHint })}
          onTextChange={(hint) => patch({ hint })}
        />
      </div>
    </div>
  )
}

function MenuTextRow({
  id,
  label,
  show,
  text,
  placeholder,
  multiline,
  onShowChange,
  onTextChange,
}: {
  id: string
  label: string
  show: boolean
  text: string
  placeholder?: string
  multiline?: boolean
  onShowChange: (show: boolean) => void
  onTextChange: (text: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Switch
          id={id}
          checked={show}
          onCheckedChange={(checked) => onShowChange(checked === true)}
        />
        <FieldLabel htmlFor={id} className="w-28 shrink-0">
          {label}
        </FieldLabel>
        {show ? (
          multiline ? (
            <Textarea
              rows={2}
              value={text}
              placeholder={placeholder}
              aria-label={label}
              className="min-h-10 min-w-0 flex-1"
              onChange={(e) => onTextChange(e.target.value)}
            />
          ) : (
            <Input
              value={text}
              placeholder={placeholder}
              aria-label={label}
              className="min-w-0 flex-1"
              onChange={(e) => onTextChange(e.target.value)}
            />
          )
        ) : null}
      </div>
    </div>
  )
}
