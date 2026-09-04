import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { PropertyBrand } from '@/types/story'

type Props = {
  brand: PropertyBrand
  onPatch: (patch: Partial<PropertyBrand>) => void
}

function telegramValue(value: string) {
  return value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?t\.me\//i, '')
    .replace(/^@+/, '')
}

function maxValue(value: string) {
  return value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?max\.ru\//i, '')
    .replace(/^@+/, '')
}

function contactSummary(brand: PropertyBrand) {
  const parts = [
    brand.whatsAppNumber?.trim() ? 'WhatsApp' : null,
    brand.telegramUsername?.trim() ? 'Telegram' : null,
    brand.maxUsername?.trim() ? 'MAX' : null,
    brand.phoneTel?.trim() ? 'звонок/SMS' : null,
  ].filter(Boolean)
  if (!parts.length) return 'не заполнены'
  return parts.join(' · ')
}

export function MenuContactFields({ brand, onPatch }: Props) {
  return (
    <Collapsible className="group/contacts grid gap-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left outline-none">
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-wide">Контакты</span>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs font-normal">
            {contactSummary(brand)}
          </span>
        </span>
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[open]/contacts:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="grid gap-3 pt-1 min-[901px]:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="editor-menu-brand">Название объекта</FieldLabel>
            <Input
              id="editor-menu-brand"
              value={brand.fullName}
              placeholder="Название объекта"
              onChange={(e) => onPatch({ fullName: e.target.value })}
            />
            <FieldDescription>{'{brand}'}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="editor-menu-whatsapp">WhatsApp</FieldLabel>
            <Input
              id="editor-menu-whatsapp"
              inputMode="tel"
              value={brand.whatsAppNumber}
              placeholder="79001234567"
              onChange={(e) => onPatch({ whatsAppNumber: e.target.value.replace(/\D/g, '') })}
            />
            <FieldDescription>Номер без + и пробелов · {'{phone}'}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="editor-menu-telegram">Telegram</FieldLabel>
            <Input
              id="editor-menu-telegram"
              value={brand.telegramUsername ?? ''}
              placeholder="username"
              onChange={(e) => onPatch({ telegramUsername: telegramValue(e.target.value) })}
            />
            <FieldDescription>Логин без @ · {'{telegram}'}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="editor-menu-max">MAX</FieldLabel>
            <Input
              id="editor-menu-max"
              value={brand.maxUsername ?? ''}
              placeholder="u/… или логин"
              onChange={(e) => onPatch({ maxUsername: maxValue(e.target.value) })}
            />
            <FieldDescription>
              Из приложения: Профиль → поделиться · {'{max}'}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="editor-menu-phone">Звонок и SMS</FieldLabel>
            <Input
              id="editor-menu-phone"
              inputMode="tel"
              value={brand.phoneTel}
              placeholder="+79001234567"
              onChange={(e) => onPatch({ phoneTel: e.target.value.replace(/[^\d+*#]/g, '') })}
            />
            <FieldDescription>Номер с кодом страны · {'{tel}'}</FieldDescription>
          </Field>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
