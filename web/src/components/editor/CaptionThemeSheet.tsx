import { Type } from 'lucide-react'
import type { PropertyTheme } from '@/types/story'
import { normalizeTheme } from '@/types/story'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { CaptionThemeFields } from './CaptionThemeFields'
import { sliderNumber } from './timelineMath'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: PropertyTheme | undefined
  onPatch: (patch: Partial<PropertyTheme>) => void
}

export function CaptionThemeSheet({ open, onOpenChange, theme, onPatch }: Props) {
  const t = normalizeTheme(theme)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Type className="size-4" aria-hidden />
            Титры
          </SheetTitle>
          <SheetDescription>
            Общие настройки для всех блоков: режим, заголовок и оформление.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4 pb-10">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">Заголовок блока</p>
                <p className="text-muted-foreground text-xs">
                  Показывать заголовок в плеере и в настройках титра. Выключите, если нужны только
                  титры.
                </p>
              </div>
              <Switch
                checked={t.showTitle}
                onCheckedChange={(checked) => onPatch({ showTitle: checked === true })}
                aria-label="Заголовок блока"
              />
            </div>

            <div className="rounded-lg border p-3">
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel>Режим титров</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    value={t.captionMode}
                    onChange={(e) =>
                      onPatch({ captionMode: e.target.value === 'cues' ? 'cues' : 'marquee' })
                    }
                  >
                    <NativeSelectOption value="marquee">Бегущая строка</NativeSelectOption>
                    <NativeSelectOption value="cues">
                      Титры по фразам (YouTube / Instagram)
                    </NativeSelectOption>
                  </NativeSelect>
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Бегущая строка склеивает все тексты. «По фразам» — один титр в момент cue на
                    шкале, синхронно с озвучкой.
                  </p>
                </Field>
                {t.captionMode === 'marquee' ? (
                  <Field>
                    <FieldLabel className="justify-between">
                      Скорость бегущей строки
                      <span className="text-muted-foreground font-normal">{t.marqueeSpeed} px/s</span>
                    </FieldLabel>
                    <Slider
                      min={10}
                      max={200}
                      step={1}
                      value={[t.marqueeSpeed]}
                      onValueChange={(v) => onPatch({ marqueeSpeed: sliderNumber(v) })}
                    />
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      Чем выше — тем быстрее едет текст. ~45 спокойно, ~90+ быстрее.
                    </p>
                  </Field>
                ) : null}
              </FieldGroup>
            </div>

            <div className="rounded-lg border p-3">
              <CaptionThemeFields theme={theme} onPatch={onPatch} />
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
