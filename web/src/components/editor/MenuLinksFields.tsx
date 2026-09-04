import { useRef, useState } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  brandMax,
  brandPhoneDigits,
  brandTel,
  brandTelegram,
  fillLinkVars,
  isSafeMenuHref,
} from '@/content'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  MENU_LINK_AUTO_TOKEN,
  MENU_LINK_KIND_UI,
  MENU_LINK_PRESETS,
  buildMenuLinkHref,
  menuLinkFromPreset,
  normalizeMenuLinks,
  parseMenuLinkHref,
  sanitizeMenuLinkTarget,
  type MenuLink,
  type MenuLinkKind,
  type MenuLinkParts,
  type MenuLinkPresetId,
  type PropertyBrand,
} from '@/types/story'

const KIND_TITLE: Record<MenuLinkKind, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  max: 'MAX',
  tel: 'Звонок',
  sms: 'SMS',
  site: 'Сайт',
  other: 'Ссылка',
}

type Props = {
  links?: MenuLink[]
  guestName: string
  brand: PropertyBrand
  onChange: (links: MenuLink[]) => void
}

function reorderLinks(list: MenuLink[], fromId: string, toIndex: number) {
  const from = list.findIndex((link) => link.id === fromId)
  if (from < 0) return list
  let insertAt = Math.max(0, Math.min(toIndex, list.length))
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (from < insertAt) insertAt -= 1
  next.splice(insertAt, 0, item)
  return next
}

export function MenuLinksFields({ links, guestName, brand, onChange }: Props) {
  const value = links == null ? normalizeMenuLinks(undefined) : links
  const [openIds, setOpenIds] = useState<string[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragFromGrip = useRef(false)
  const vars = {
    name: guestName,
    brand: brand.fullName,
    phone: brandPhoneDigits(brand),
    telegram: brandTelegram(brand),
    max: brandMax(brand),
    tel: brandTel(brand),
  }

  const patchAt = (index: number, next: Partial<MenuLink>) => {
    onChange(value.map((link, i) => (i === index ? { ...link, ...next } : link)))
  }

  const patchParts = (index: number, parts: MenuLinkParts, next: Partial<MenuLinkParts>) => {
    patchAt(index, { href: buildMenuLinkHref({ ...parts, ...next }) })
  }

  const removeAt = (index: number) => {
    const id = value[index]?.id
    onChange(value.filter((_, i) => i !== index))
    if (id) setOpenIds((prev) => prev.filter((x) => x !== id))
  }

  const addPreset = (id: MenuLinkPresetId) => {
    const next = menuLinkFromPreset(id)
    onChange([...value, next])
    setOpenIds([next.id])
  }

  const clearDrag = () => {
    dragFromGrip.current = false
    setDragId(null)
    setDropIndex(null)
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <p className="text-muted-foreground text-xs tracking-wider uppercase">Кнопки со ссылками</p>
        {value.length > 1 ? (
          <p className="text-muted-foreground text-xs">Тяните за ⋮⋮, чтобы поменять порядок.</p>
        ) : null}
      </div>
      {value.length ? (
        <Accordion
          multiple
          value={openIds}
          onValueChange={(next) => setOpenIds(next as string[])}
          className="rounded-xl border"
        >
          {value.map((link, index) => {
            const parts = parseMenuLinkHref(link.href)
            const ui = MENU_LINK_KIND_UI[parts.kind]
            const autoToken = MENU_LINK_AUTO_TOKEN[parts.kind]
            const isAuto = autoToken != null && parts.target.trim() === autoToken
            const autoValue = autoToken ? fillLinkVars(autoToken, vars).trim() : ''
            const emptyTarget = !fillLinkVars(parts.target, vars).trim()
            const invalid =
              parts.kind === 'other'
                ? Boolean(link.href.trim()) && !isSafeMenuHref(link.href)
                : emptyTarget
            const setTarget = (raw: string) => {
              const next = sanitizeMenuLinkTarget(parts.kind, raw)
              patchParts(index, parts, { target: next || autoToken || '' })
            }
            const showDropBefore = dragId != null && dropIndex === index
            const showDropAfter =
              dragId != null && dropIndex === index + 1 && index === value.length - 1
            return (
              <AccordionItem
                key={link.id}
                value={link.id}
                draggable={value.length > 1}
                className={cn(
                  'relative px-3 not-last:border-b',
                  dragId === link.id && 'opacity-50',
                  showDropBefore &&
                    'before:bg-foreground before:absolute before:inset-x-3 before:top-0 before:z-10 before:h-0.5 before:content-[""]',
                  showDropAfter &&
                    'after:bg-foreground after:absolute after:inset-x-3 after:bottom-0 after:z-10 after:h-0.5 after:content-[""]',
                )}
                onDragStart={(e) => {
                  if (!dragFromGrip.current || value.length < 2) {
                    e.preventDefault()
                    return
                  }
                  setDragId(link.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', `menu-link:${link.id}`)
                }}
                onDragEnd={clearDrag}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY < rect.top + rect.height / 2
                  setDropIndex(before ? index : index + 1)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const raw = e.dataTransfer.getData('text/plain')
                  const fromId = raw.startsWith('menu-link:')
                    ? raw.slice('menu-link:'.length)
                    : dragId
                  const to = dropIndex ?? index
                  if (fromId) onChange(reorderLinks(value, fromId, to))
                  clearDrag()
                }}
              >
                <div className="flex w-full items-center gap-1">
                  {value.length > 1 ? (
                    <span
                      className="text-muted-foreground inline-flex size-8 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
                      aria-label="Перетащить"
                      title="Перетащить"
                      onPointerDown={() => {
                        dragFromGrip.current = true
                      }}
                      onPointerUp={() => {
                        dragFromGrip.current = false
                      }}
                      onPointerCancel={() => {
                        dragFromGrip.current = false
                      }}
                    >
                      <GripVertical className="size-4" aria-hidden />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <AccordionTrigger className="w-full py-2.5 hover:no-underline">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-3.5 shrink-0 rounded-full border border-black/10"
                          style={{ background: link.bg }}
                          aria-hidden
                        />
                        <span className="truncate">{KIND_TITLE[parts.kind]}</span>
                        {invalid ? (
                          <span className="text-destructive shrink-0 text-xs font-normal">
                            не заполнено
                          </span>
                        ) : null}
                      </span>
                    </AccordionTrigger>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto shrink-0"
                    aria-label="Удалить кнопку"
                    onClick={() => removeAt(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <AccordionContent className="pb-3">
                  <div className="grid gap-3 pt-1">
                    <Field>
                      <FieldLabel htmlFor={`editor-menu-link-label-${link.id}`}>
                        Текст кнопки
                      </FieldLabel>
                      <Input
                        id={`editor-menu-link-label-${link.id}`}
                        value={link.label}
                        onChange={(e) => patchAt(index, { label: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`editor-menu-link-target-${link.id}`}>
                        {ui.targetLabel}
                      </FieldLabel>
                      {ui.prefix ? (
                        <InputGroup aria-invalid={invalid || undefined}>
                          <InputGroupAddon>
                            <InputGroupText className="font-mono text-xs">
                              {ui.prefix}
                            </InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            id={`editor-menu-link-target-${link.id}`}
                            value={isAuto ? '' : parts.target}
                            aria-invalid={invalid || undefined}
                            placeholder={
                              isAuto && autoValue ? autoValue : ui.targetPlaceholder
                            }
                            onChange={(e) => setTarget(e.target.value)}
                          />
                        </InputGroup>
                      ) : (
                        <Input
                          id={`editor-menu-link-target-${link.id}`}
                          value={parts.target}
                          aria-invalid={invalid || undefined}
                          placeholder={ui.targetPlaceholder}
                          onChange={(e) =>
                            patchParts(index, parts, { target: e.target.value })
                          }
                        />
                      )}
                      {invalid ? (
                        <FieldDescription className="text-destructive">
                          {parts.kind === 'other'
                            ? 'Ссылка не откроется. Нужен http(s), tel:, sms: или mailto:.'
                            : isAuto
                              ? 'Заполните контакт выше или впишите значение здесь.'
                              : `Заполните: ${ui.targetLabel.toLowerCase()}.`}
                        </FieldDescription>
                      ) : isAuto && autoValue ? (
                        <FieldDescription>Из контактов</FieldDescription>
                      ) : null}
                    </Field>
                    {ui.textLabel ? (
                      <Field>
                        <FieldLabel htmlFor={`editor-menu-link-text-${link.id}`}>
                          {ui.textLabel}
                        </FieldLabel>
                        <Textarea
                          id={`editor-menu-link-text-${link.id}`}
                          rows={2}
                          value={parts.text}
                          placeholder="Необязательно"
                          onChange={(e) =>
                            patchParts(index, parts, { text: e.target.value })
                          }
                        />
                        <FieldDescription>
                          Гость увидит его в поле ввода — отправит сам.
                        </FieldDescription>
                      </Field>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <Field orientation="horizontal" className="items-center">
                        <Input
                          type="color"
                          className="h-8 w-9 shrink-0 p-1"
                          value={link.bg}
                          onChange={(e) => patchAt(index, { bg: e.target.value })}
                          aria-label="Фон кнопки"
                        />
                        <FieldLabel className="min-w-0">Фон</FieldLabel>
                      </Field>
                      <Field orientation="horizontal" className="items-center">
                        <Input
                          type="color"
                          className="h-8 w-9 shrink-0 p-1"
                          value={link.textColor}
                          onChange={(e) => patchAt(index, { textColor: e.target.value })}
                          aria-label="Цвет текста кнопки"
                        />
                        <FieldLabel className="min-w-0">Текст</FieldLabel>
                      </Field>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {MENU_LINK_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addPreset(preset.id)}
          >
            <Plus data-icon="inline-start" aria-hidden />
            {preset.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
