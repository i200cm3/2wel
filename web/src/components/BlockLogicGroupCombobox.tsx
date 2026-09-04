import { useMemo } from 'react'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from '@/components/ui/combobox'
import {
  BLOCK_LOGIC_GROUPS,
  BLOCK_LOGIC_OPTION_BY_VALUE,
  type BlockLogicOption,
} from '@/lib/blockLogicGroups'

type Props = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  'aria-label'?: string
}

export function BlockLogicGroupCombobox({
  value,
  onValueChange,
  placeholder = 'Выберите тип блока…',
  'aria-label': ariaLabel,
}: Props) {
  const selected = useMemo((): BlockLogicOption | null => {
    if (!value.trim()) return null
    return (
      BLOCK_LOGIC_OPTION_BY_VALUE.get(value.trim()) ?? {
        value: value.trim(),
        label: value.trim(),
        hint: 'Своё значение вне каталога',
      }
    )
  }, [value])

  return (
    <div className="grid w-full gap-1.5 self-start">
      <Combobox
        items={BLOCK_LOGIC_GROUPS}
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
            {(group, index) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
                {index < BLOCK_LOGIC_GROUPS.length - 1 ? <ComboboxSeparator /> : null}
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {selected?.hint ? (
        <p className="text-muted-foreground text-xs leading-snug">{selected.hint}</p>
      ) : null}
    </div>
  )
}
