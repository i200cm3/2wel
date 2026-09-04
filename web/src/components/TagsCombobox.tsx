import { useMemo } from 'react'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { tagOptionsFromValues, type TagOption } from '@/lib/blockMetaTags'

type MultiProps = {
  options: TagOption[]
  value: string[]
  onValueChange: (next: string[]) => void
  placeholder?: string
  emptyLabel?: string
  'aria-label'?: string
}

export function TagsCombobox({
  options,
  value,
  onValueChange,
  placeholder = 'Добавить…',
  emptyLabel = 'Не выбрано',
  'aria-label': ariaLabel,
}: MultiProps) {
  const anchor = useComboboxAnchor()
  const selected = useMemo(() => tagOptionsFromValues(value, options), [options, value])

  return (
    <Combobox
      multiple
      autoComplete="none"
      items={options}
      value={selected}
      onValueChange={(next) => onValueChange(next.map((item) => item.value))}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
    >
      <ComboboxChips ref={anchor} className="min-h-9 h-auto w-full items-start">
        <ComboboxValue>
          {(values: TagOption[]) =>
            values.length ? (
              values.map((item) => <ComboboxChip key={item.value}>{item.label}</ComboboxChip>)
            ) : (
              <span className="text-muted-foreground text-sm">{emptyLabel}</span>
            )
          }
        </ComboboxValue>
        <ComboboxChipsInput placeholder={placeholder} aria-label={ariaLabel ?? placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>Ничего не найдено</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

type SingleProps = {
  options: TagOption[]
  value: string
  onValueChange: (next: string) => void
  placeholder?: string
  'aria-label'?: string
}

export function SingleTagCombobox({
  options,
  value,
  onValueChange,
  placeholder = 'Выберите…',
  'aria-label': ariaLabel,
}: SingleProps) {
  const selected = useMemo((): TagOption | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    return options.find((item) => item.value === trimmed) ?? { value: trimmed, label: trimmed }
  }, [options, value])

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(item) => onValueChange(item?.value ?? '')}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
    >
      <ComboboxInput
        className="w-full"
        placeholder={placeholder}
        showClear={!!selected}
        aria-label={ariaLabel ?? placeholder}
      />
      <ComboboxContent className="w-(--anchor-width)">
        <ComboboxEmpty>Ничего не найдено</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
