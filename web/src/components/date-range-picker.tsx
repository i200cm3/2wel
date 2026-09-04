import { useEffect, useMemo, useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { TZDate, type DateRange } from 'react-day-picker'
import { ru } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  STATS_TZ,
  formatRangeLabel,
  formatYmd,
  lastDaysRange,
  monthToDateRange,
  parseDay,
  type DayRange,
} from '@/lib/statsRange'

const PRESETS = [
  { id: '7', label: '7 дней', range: () => lastDaysRange(7) },
  { id: '14', label: '14 дней', range: () => lastDaysRange(14) },
  { id: '30', label: '30 дней', range: () => lastDaysRange(30) },
  { id: 'month', label: 'Этот месяц', range: () => monthToDateRange() },
] as const

const SUMMARY_DATES_RE = /^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(\d{4}-\d{2}-\d{2})$/

function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new TZDate(y, m - 1, d, STATS_TZ)
}

function toDayRange(next: DateRange | undefined): DayRange | null {
  if (!next?.from || !next.to) return null
  const from = formatYmd(next.from)
  const to = formatYmd(next.to)
  return from <= to ? { from, to } : { from: to, to: from }
}

export function formatSummaryDates(range: DayRange): string {
  return `${range.from} — ${range.to}`
}

export function parseSummaryDates(value: string): DayRange | null {
  const match = SUMMARY_DATES_RE.exec(value.trim())
  if (!match) return null
  const from = parseDay(match[1])
  const to = parseDay(match[2])
  if (!from || !to) return null
  return from <= to ? { from, to } : { from: to, to: from }
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DayRange
  onChange: (next: DayRange) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo<DateRange>(
    () => ({ from: ymdToDate(value.from), to: ymdToDate(value.to) }),
    [value.from, value.to],
  )
  const [draft, setDraft] = useState<DateRange | undefined>(selected)

  useEffect(() => {
    setDraft(selected)
  }, [selected])

  const activePreset = PRESETS.find((item) => {
    const range = item.range()
    return range.from === value.from && range.to === value.to
  })?.id

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={activePreset === item.id ? 'default' : 'outline'}
            onClick={() => onChange(item.range())}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={cn('min-w-52 justify-start font-normal')}
            />
          }
        >
          <CalendarIcon />
          {formatRangeLabel(value.from, value.to)}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0">
          <Calendar
            key={`${value.from}-${value.to}`}
            mode="range"
            numberOfMonths={2}
            locale={ru}
            timeZone={STATS_TZ}
            defaultMonth={selected.from}
            selected={draft}
            onSelect={(next) => {
              setDraft(next)
              const range = toDayRange(next)
              if (range) onChange(range)
            }}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Range calendar for optional stay dates (mock guest summary). */
export function OptionalDateRangePicker({
  value,
  onChange,
  placeholder = 'Выберите даты…',
}: {
  value: DayRange | null
  onChange: (next: DayRange | null) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo<DateRange | undefined>(
    () => (value ? { from: ymdToDate(value.from), to: ymdToDate(value.to) } : undefined),
    [value],
  )
  const [draft, setDraft] = useState<DateRange | undefined>(selected)

  useEffect(() => {
    setDraft(selected)
  }, [selected])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              'h-9 w-full justify-start font-normal',
              !value && 'text-muted-foreground',
            )}
          />
        }
      >
        <CalendarIcon />
        {value ? formatRangeLabel(value.from, value.to) : placeholder}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-0">
        <Calendar
          key={value ? `${value.from}-${value.to}` : 'empty'}
          mode="range"
          numberOfMonths={1}
          locale={ru}
          timeZone={STATS_TZ}
          defaultMonth={selected?.from ?? new Date()}
          selected={draft}
          onSelect={(next) => {
            setDraft(next)
            const range = toDayRange(next)
            if (range) onChange(range)
          }}
        />
        {value ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setDraft(undefined)
                onChange(null)
                setOpen(false)
              }}
            >
              Сбросить даты
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
