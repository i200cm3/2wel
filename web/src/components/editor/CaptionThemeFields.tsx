import {
  STORY_FONTS,
  normalizeTheme,
  type PropertyTheme,
  type StoryFontId,
} from '@/types/story'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { sliderNumber } from './timelineMath'

export function CaptionThemeFields({
  theme,
  onPatch,
}: {
  theme: PropertyTheme | undefined
  onPatch: (patch: Partial<PropertyTheme>) => void
}) {
  const t = normalizeTheme(theme)
  return (
    <FieldGroup className="gap-3">
      <p className="text-muted-foreground text-xs tracking-wider uppercase">Оформление титров</p>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Шрифт заголовка</FieldLabel>
          <NativeSelect
            className="w-full"
            value={t.titleFont}
            onChange={(e) => onPatch({ titleFont: e.target.value as StoryFontId })}
          >
            {STORY_FONTS.map((f) => (
              <NativeSelectOption key={f.id} value={f.id}>
                {f.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel>Шрифт текста</FieldLabel>
          <NativeSelect
            className="w-full"
            value={t.textFont}
            onChange={(e) => onPatch({ textFont: e.target.value as StoryFontId })}
          >
            {STORY_FONTS.map((f) => (
              <NativeSelectOption key={f.id} value={f.id}>
                {f.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel className="justify-between">
            Размер заголовка
            <span className="text-muted-foreground font-normal">{t.titleFontSize}px</span>
          </FieldLabel>
          <Slider
            min={14}
            max={56}
            step={1}
            value={[t.titleFontSize]}
            onValueChange={(v) => onPatch({ titleFontSize: sliderNumber(v) })}
          />
        </Field>
        <Field>
          <FieldLabel className="justify-between">
            Размер текста
            <span className="text-muted-foreground font-normal">{t.textFontSize}px</span>
          </FieldLabel>
          <Slider
            min={10}
            max={32}
            step={1}
            value={[t.textFontSize]}
            onValueChange={(v) => onPatch({ textFontSize: sliderNumber(v) })}
          />
        </Field>
        <Field orientation="horizontal" className="items-center">
          <Input
            type="color"
            className="h-8 w-9 shrink-0 p-1"
            value={t.titleColor}
            onChange={(e) => onPatch({ titleColor: e.target.value })}
          />
          <FieldLabel className="min-w-0">Цвет заголовка</FieldLabel>
        </Field>
        <Field orientation="horizontal" className="items-center">
          <Input
            type="color"
            className="h-8 w-9 shrink-0 p-1"
            value={t.textColor}
            onChange={(e) => onPatch({ textColor: e.target.value })}
          />
          <FieldLabel className="min-w-0">Цвет текста</FieldLabel>
        </Field>
        <Field orientation="horizontal" className="items-center">
          <Input
            type="color"
            className="h-8 w-9 shrink-0 p-1"
            value={t.captionBarColor}
            onChange={(e) => onPatch({ captionBarColor: e.target.value })}
          />
          <FieldLabel className="min-w-0">Цвет плашки</FieldLabel>
        </Field>
        <Field>
          <FieldLabel className="justify-between">
            Прозрачность плашки
            <span className="text-muted-foreground font-normal">
              {Math.round(t.captionBarOpacity * 100)}%
            </span>
          </FieldLabel>
          <Slider
            min={0}
            max={1}
            step={0.02}
            value={[t.captionBarOpacity]}
            onValueChange={(v) => onPatch({ captionBarOpacity: sliderNumber(v) })}
          />
        </Field>
      </div>
    </FieldGroup>
  )
}
