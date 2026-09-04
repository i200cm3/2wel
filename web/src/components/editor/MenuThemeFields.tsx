import {
  STORY_FONTS,
  normalizeMenuTheme,
  type MenuTheme,
  type StoryFontId,
} from '@/types/story'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { sliderNumber } from './timelineMath'

function SizeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel className="justify-between">
        {label}
        <span className="text-muted-foreground font-normal">{value}px</span>
      </FieldLabel>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(sliderNumber(v))}
      />
    </Field>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field orientation="horizontal" className="items-center">
      <Input
        type="color"
        className="h-8 w-9 shrink-0 p-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldLabel className="min-w-0">{label}</FieldLabel>
    </Field>
  )
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string
  value: StoryFontId
  onChange: (value: StoryFontId) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect
        className="w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as StoryFontId)}
      >
        {STORY_FONTS.map((f) => (
          <NativeSelectOption key={f.id} value={f.id}>
            {f.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

export function MenuThemeFields({
  theme,
  onPatch,
}: {
  theme: MenuTheme | undefined
  onPatch: (patch: Partial<MenuTheme>) => void
}) {
  const t = normalizeMenuTheme(theme)
  return (
    <FieldGroup className="gap-0">
      <Accordion multiple className="rounded-xl border">
        <AccordionItem value="fonts" className="px-3 not-last:border-b">
          <AccordionTrigger className="hover:no-underline">Шрифты</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="grid grid-cols-1 gap-3 pt-1 min-[901px]:grid-cols-2">
              <FontField
                label="Заголовок"
                value={t.titleFont}
                onChange={(titleFont) => onPatch({ titleFont })}
              />
              <FontField
                label="Текст"
                value={t.textFont}
                onChange={(textFont) => onPatch({ textFont })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sizes" className="px-3 not-last:border-b">
          <AccordionTrigger className="hover:no-underline">Размеры</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="grid grid-cols-1 gap-3 pt-1 min-[901px]:grid-cols-3">
              <SizeField
                label="Заголовок"
                value={t.titleFontSize}
                min={18}
                max={56}
                onChange={(titleFontSize) => onPatch({ titleFontSize })}
              />
              <SizeField
                label="Текст"
                value={t.textFontSize}
                min={10}
                max={24}
                onChange={(textFontSize) => onPatch({ textFontSize })}
              />
              <SizeField
                label="Надзаголовок"
                value={t.kickerFontSize}
                min={9}
                max={16}
                onChange={(kickerFontSize) => onPatch({ kickerFontSize })}
              />
              <SizeField
                label="Кнопки"
                value={t.buttonFontSize}
                min={12}
                max={24}
                onChange={(buttonFontSize) => onPatch({ buttonFontSize })}
              />
              <SizeField
                label="Высота кнопок"
                value={t.buttonPadY}
                min={8}
                max={22}
                onChange={(buttonPadY) => onPatch({ buttonPadY })}
              />
              <SizeField
                label="Закругление"
                value={t.buttonRadius}
                min={0}
                max={32}
                onChange={(buttonRadius) => onPatch({ buttonRadius })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="colors" className="px-3">
          <AccordionTrigger className="hover:no-underline">Цвета</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="grid grid-cols-1 gap-3 pt-1 min-[901px]:grid-cols-4">
              <ColorField
                label="Заголовок"
                value={t.titleColor}
                onChange={(titleColor) => onPatch({ titleColor })}
              />
              <ColorField
                label="Текст"
                value={t.textColor}
                onChange={(textColor) => onPatch({ textColor })}
              />
              <ColorField
                label="Надзаголовок"
                value={t.kickerColor}
                onChange={(kickerColor) => onPatch({ kickerColor })}
              />
              <ColorField
                label="Фон кнопки"
                value={t.buttonBg}
                onChange={(buttonBg) => onPatch({ buttonBg })}
              />
              <ColorField
                label="Текст кнопки"
                value={t.buttonText}
                onChange={(buttonText) => onPatch({ buttonText })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </FieldGroup>
  )
}
