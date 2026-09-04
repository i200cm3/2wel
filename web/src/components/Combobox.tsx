import {
  Combobox as UiCombobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export type ComboboxItem = {
  value: string
  label: string
}

type Props = {
  items: ComboboxItem[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  'aria-label'?: string
}

export function Combobox({
  items,
  value,
  onValueChange,
  placeholder = 'Выбрать…',
  emptyText = 'Ничего не найдено',
  'aria-label': ariaLabel,
}: Props) {
  const selected = items.find((item) => item.value === value) ?? null

  return (
    <UiCombobox
      items={items}
      value={selected}
      onValueChange={(item) => {
        if (item) onValueChange(item.value)
      }}
      itemToStringValue={(item) => item.value}
    >
      <ComboboxInput
        className="w-full"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
      <ComboboxContent className="w-(--anchor-width)">
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </UiCombobox>
  )
}
