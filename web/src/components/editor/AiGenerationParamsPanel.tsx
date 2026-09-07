import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import type { PropertyBrand } from '@/types/story'

type Props = {
  brand: PropertyBrand
  copyFacts?: string
  onCopyFactsChange: (value: string) => void
}

export function AiGenerationParamsPanel({
  brand,
  copyFacts = '',
  onCopyFactsChange,
}: Props) {
  const brandLine = [brand.fullName || brand.name, brand.city, brand.site]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Параметры для генерации</h2>
        <p className="text-muted-foreground text-sm">
          Факты об объекте для ИИ-титров и заголовков. Только админ. Сайт сам не читается — всё, что
          можно говорить, впишите сюда.
        </p>
      </div>

      {brandLine ? (
        <p className="text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          Из карточки объекта в промпт также уходит: {brandLine}
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor="ai-copy-facts">Факты об объекте</FieldLabel>
        <Textarea
          id="ai-copy-facts"
          rows={14}
          value={copyFacts}
          placeholder={
            'Город, адрес, категории номеров, лечение, питание, СПА, уникальные факты.\nБез выдумок, рейтингов «лучший» и медгарантий.\nЭто единственный источник фактов при генерации титров.'
          }
          onChange={(e) => onCopyFactsChange(e.target.value)}
        />
        <FieldDescription>
          Сохраняется в черновике шаблона вместе с остальным конфигом. Используется кнопкой «ИИ · титр»
          в инспекторе cue.
        </FieldDescription>
      </Field>
    </div>
  )
}
