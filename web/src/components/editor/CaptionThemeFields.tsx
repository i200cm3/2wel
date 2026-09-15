import type { ReactNode } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import {
  STORY_COPY_EM_BASE,
  STORY_FONTS,
  normalizeTheme,
  storyFontSizeEm,
  type PropertyTheme,
  type StoryFontId,
} from '@/types/story'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { TextStyleToggle } from './TextStyleToggle'
import { sliderNumber } from './timelineMath'

function sizeLabel(size: number) {
  return storyFontSizeEm(size)
}

function DeviceGroup({
  device,
  children,
}: {
  device: 'desktop' | 'mobile'
  children: ReactNode
}) {
  const isMobile = device === 'mobile'
  const Icon = isMobile ? Smartphone : Monitor
  return (
    <div className="col-span-2 rounded-lg border bg-muted/25 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="bg-background text-foreground inline-flex size-7 items-center justify-center rounded-md border shadow-xs">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-none">{isMobile ? 'Телефон' : 'Компьютер'}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
            {isMobile ? 'Кадр ≤ 560px · превью в редакторе' : 'Широкий кадр · desktop'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

export function CaptionThemeFields({
  theme,
  onPatch,
}: {
  theme: PropertyTheme | undefined
  onPatch: (patch: Partial<PropertyTheme>) => void
}) {
  const t = normalizeTheme(theme)
  const titlesOn = t.showTitle
  return (
    <FieldGroup className="gap-3">
      <p className="text-muted-foreground text-xs tracking-wider uppercase">Оформление титров</p>
      <div className="grid grid-cols-2 gap-3">
        {titlesOn ? (
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
        ) : null}
        <Field className={titlesOn ? undefined : 'col-span-2'}>
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
        {titlesOn ? (
          <TextStyleToggle
            label="Начертание заголовка"
            bold={t.titleBold}
            italic={t.titleItalic}
            underline={t.titleUnderline}
            stroke={t.titleStroke}
            onChange={(next) =>
              onPatch({
                titleBold: next.bold,
                titleItalic: next.italic,
                titleUnderline: next.underline,
                titleStroke: next.stroke,
              })
            }
          />
        ) : null}
        <TextStyleToggle
          label="Начертание текста"
          bold={t.textBold}
          italic={t.textItalic}
          underline={t.textUnderline}
          stroke={t.textStroke}
          onChange={(next) =>
            onPatch({
              textBold: next.bold,
              textItalic: next.italic,
              textUnderline: next.underline,
              textStroke: next.stroke,
            })
          }
        />

        <DeviceGroup device="desktop">
          {titlesOn ? (
            <Field>
              <FieldLabel className="justify-between">
                Заголовок
                <span className="text-muted-foreground font-normal">{sizeLabel(t.titleFontSize)}</span>
              </FieldLabel>
              <Slider
                min={14}
                max={56}
                step={1}
                value={[t.titleFontSize]}
                onValueChange={(v) => onPatch({ titleFontSize: sliderNumber(v) })}
              />
            </Field>
          ) : null}
          <Field className={titlesOn ? undefined : 'col-span-2'}>
            <FieldLabel className="justify-between">
              Текст
              <span className="text-muted-foreground font-normal">{sizeLabel(t.textFontSize)}</span>
            </FieldLabel>
            <Slider
              min={10}
              max={32}
              step={1}
              value={[t.textFontSize]}
              onValueChange={(v) => onPatch({ textFontSize: sliderNumber(v) })}
            />
          </Field>
        </DeviceGroup>

        <DeviceGroup device="mobile">
          {titlesOn ? (
            <Field>
              <FieldLabel className="justify-between">
                Заголовок
                <span className="text-muted-foreground font-normal">
                  {sizeLabel(t.titleFontSizeMobile)}
                </span>
              </FieldLabel>
              <Slider
                min={14}
                max={56}
                step={1}
                value={[t.titleFontSizeMobile]}
                onValueChange={(v) => onPatch({ titleFontSizeMobile: sliderNumber(v) })}
              />
            </Field>
          ) : null}
          <Field className={titlesOn ? undefined : 'col-span-2'}>
            <FieldLabel className="justify-between">
              Текст
              <span className="text-muted-foreground font-normal">
                {sizeLabel(t.textFontSizeMobile)}
              </span>
            </FieldLabel>
            <Slider
              min={10}
              max={32}
              step={1}
              value={[t.textFontSizeMobile]}
              onValueChange={(v) => onPatch({ textFontSizeMobile: sliderNumber(v) })}
            />
          </Field>
        </DeviceGroup>

        <p className="text-muted-foreground col-span-2 text-[11px] leading-snug">
          Размеры в em от базы {STORY_COPY_EM_BASE}px.
        </p>

        {titlesOn ? (
          <Field orientation="horizontal" className="items-center">
            <Input
              type="color"
              className="h-8 w-9 shrink-0 p-1"
              value={t.titleColor}
              onChange={(e) => onPatch({ titleColor: e.target.value })}
            />
            <FieldLabel className="min-w-0">Цвет заголовка</FieldLabel>
          </Field>
        ) : null}
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
        <Field className="col-span-2">
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

        <DeviceGroup device="desktop">
          <Field>
            <FieldLabel className="justify-between">
              Отступ текста
              <span className="text-muted-foreground font-normal">{t.captionTextPad}px</span>
            </FieldLabel>
            <Slider
              min={0}
              max={64}
              step={1}
              value={[t.captionTextPad]}
              onValueChange={(v) => onPatch({ captionTextPad: sliderNumber(v) })}
            />
          </Field>
          <Field>
            <FieldLabel className="justify-between">
              Плашка от текста
              <span className="text-muted-foreground font-normal">{t.captionBarPad}px</span>
            </FieldLabel>
            <Slider
              min={0}
              max={64}
              step={1}
              value={[t.captionBarPad]}
              onValueChange={(v) => onPatch({ captionBarPad: sliderNumber(v) })}
            />
          </Field>
        </DeviceGroup>

        <DeviceGroup device="mobile">
          <Field>
            <FieldLabel className="justify-between">
              Отступ текста
              <span className="text-muted-foreground font-normal">{t.captionTextPadMobile}px</span>
            </FieldLabel>
            <Slider
              min={0}
              max={64}
              step={1}
              value={[t.captionTextPadMobile]}
              onValueChange={(v) => onPatch({ captionTextPadMobile: sliderNumber(v) })}
            />
          </Field>
          <Field>
            <FieldLabel className="justify-between">
              Плашка от текста
              <span className="text-muted-foreground font-normal">{t.captionBarPadMobile}px</span>
            </FieldLabel>
            <Slider
              min={0}
              max={64}
              step={1}
              value={[t.captionBarPadMobile]}
              onValueChange={(v) => onPatch({ captionBarPadMobile: sliderNumber(v) })}
            />
          </Field>
        </DeviceGroup>

        <p className="text-muted-foreground col-span-2 text-[11px] leading-snug">
          Отступ текста — расстояние от низа кадра до строки. Плашка от текста — только высота
          фона вокруг строки (текст не двигает).
        </p>
      </div>
    </FieldGroup>
  )
}
