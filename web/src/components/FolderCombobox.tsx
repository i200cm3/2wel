import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'

export type FolderOption = {
  id: string
  label: string
  count?: number
}

type Props = {
  options: FolderOption[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  emptyLabel?: string
}

export function FolderCombobox({
  options,
  value,
  onChange,
  placeholder = 'Добавить папку…',
  emptyLabel = 'Все папки',
}: Props) {
  const anchor = useComboboxAnchor()
  const selected = options.filter((option) => value.includes(option.id))

  return (
    <Combobox
      multiple
      autoComplete="none"
      items={options}
      value={selected}
      onValueChange={(next) => onChange(next.map((item) => item.id))}
      itemToStringValue={(item) => item.id}
    >
      <ComboboxChips ref={anchor} className="w-full min-h-9">
        <ComboboxValue>
          {(values: FolderOption[]) =>
            values.length ? (
              values.map((item) => (
                <ComboboxChip key={item.id}>
                  {item.label}
                  {typeof item.count === 'number' ? ` · ${item.count}` : ''}
                </ComboboxChip>
              ))
            ) : (
              <span className="text-muted-foreground text-sm">{emptyLabel}</span>
            )
          }
        </ComboboxValue>
        <ComboboxChipsInput placeholder={placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>Ничего не найдено</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.id} value={item}>
              <span className="flex-1">{item.label}</span>
              {typeof item.count === 'number' ? (
                <span className="text-muted-foreground text-xs">{item.count}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
