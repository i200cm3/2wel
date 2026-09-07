import { BoldIcon, ItalicIcon, UnderlineIcon } from 'lucide-react'
import { Field, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  textStyleFlags,
  textStyleFromFlags,
  type TextStyleFlag,
  type TextStyleState,
} from '@/types/story'

function StrokeGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5">
      <text
        x="8"
        y="12.5"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      >
        A
      </text>
    </svg>
  )
}

export function TextStyleToggle({
  label,
  bold,
  italic,
  underline,
  stroke,
  onChange,
}: {
  label: string
  bold: boolean
  italic: boolean
  underline: boolean
  stroke: boolean
  onChange: (next: TextStyleState) => void
}) {
  const value = textStyleFlags({ bold, italic, underline, stroke })
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        multiple
        value={value}
        onValueChange={(next) => onChange(textStyleFromFlags(next as TextStyleFlag[]))}
        aria-label={label}
      >
        <ToggleGroupItem value="bold" aria-label="Жирный" title="Жирный">
          <BoldIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Курсив" title="Курсив">
          <ItalicIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="underline" aria-label="Подчёркнутый" title="Подчёркнутый">
          <UnderlineIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="stroke" aria-label="Обводка" title="Обводка">
          <StrokeGlyph />
        </ToggleGroupItem>
      </ToggleGroup>
    </Field>
  )
}
