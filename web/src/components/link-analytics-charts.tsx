import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarGrid,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { LinkStats } from '@/lib/api'

const funnelConfig = {
  open: { label: 'Открыл', color: 'var(--chart-1)' },
  autoplay: { label: 'Автопоказ', color: 'var(--chart-2)' },
  menu: { label: 'Меню', color: 'var(--chart-3)' },
  contact: { label: 'Связь', color: 'var(--chart-4)' },
} satisfies ChartConfig

const ratesConfig = {
  autoplayPct: { label: 'Досмотрел', color: 'var(--chart-2)' },
  contactPct: { label: 'Связь', color: 'var(--chart-4)' },
} satisfies ChartConfig

const hourConfig = {
  opens: { label: 'Открытия', color: 'var(--chart-1)' },
} satisfies ChartConfig

const deviceConfig = {
  phone: { label: 'Телефон', color: 'var(--chart-1)' },
  tablet: { label: 'Планшет', color: 'var(--chart-2)' },
  desktop: { label: 'Компьютер', color: 'var(--chart-3)' },
} satisfies ChartConfig

const channelConfig = {
  whatsapp: { label: 'WhatsApp', color: 'var(--chart-1)' },
  telegram: { label: 'Telegram', color: 'var(--chart-2)' },
  max: { label: 'MAX', color: 'var(--chart-3)' },
  tel: { label: 'Звонок', color: 'var(--chart-4)' },
  sms: { label: 'SMS', color: 'var(--chart-5)' },
  site: { label: 'Сайт', color: 'var(--chart-1)' },
  other: { label: 'Ссылка', color: 'var(--chart-2)' },
} satisfies ChartConfig

const engagementConfig = {
  rate: { label: 'Вовлечённость', color: 'var(--chart-1)' },
} satisfies ChartConfig

const DEVICE_LABEL: Record<string, string> = {
  phone: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Компьютер',
}

const DEVICE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'] as const
const CHANNEL_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

function rate(part: number, whole: number) {
  if (!whole) return null
  return Math.round((part / whole) * 100)
}

function hasActivity(stats: LinkStats) {
  const f = stats.funnel
  return (f.open ?? 0) + (f.autoplay ?? 0) + (f.menu ?? 0) + (f.contact ?? 0) + (f.whatsapp ?? 0) > 0
}

export function LinkAnalyticsCharts({
  stats,
  periodLabel,
}: {
  stats: LinkStats
  periodLabel: string
}) {
  const devices = stats.devices ?? { phone: 0, tablet: 0, desktop: 0 }
  const hours = stats.hours ?? []
  const topics = stats.topics ?? []
  const channels = stats.channels ?? []

  const deviceData = (['phone', 'tablet', 'desktop'] as const)
    .map((key) => ({
      name: key,
      value: devices[key],
      fill: `var(--color-${key})`,
    }))
    .filter((row) => row.value > 0)

  const channelData = channels.map((row, index) => ({
    name: row.id,
    value: row.clicks,
    fill: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
  }))

  const topicData = topics.slice(0, 5).map((row) => ({
    label: row.label,
    opens: row.opens,
  }))

  const peak = hours.reduce(
    (best, row) => (row.opens > best.opens ? row : best),
    { hour: 0, opens: 0 },
  )

  const opens = stats.funnel.open ?? 0
  const engagementPct = opens
    ? Math.min(100, Math.round(((stats.funnel.autoplay ?? 0) / opens) * 100))
    : 0
  const engagementData = [
    { name: 'rate', value: engagementPct, fill: 'var(--color-rate)' },
    { name: 'rest', value: Math.max(0, 100 - engagementPct), fill: 'transparent' },
  ]

  const ratesSeries = useMemo(
    () =>
      stats.series.map((row) => ({
        date: row.date,
        autoplayPct: rate(row.autoplay, row.open),
        contactPct: rate(row.contact ?? row.whatsapp, row.open),
      })),
    [stats.series],
  )

  const totalOpens = stats.series.reduce((sum, row) => sum + (row.open ?? 0), 0)

  if (!hasActivity(stats)) {
    return (
      <div className="border-t pt-6">
        <p className="text-sm font-medium">Активность гостя</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Пока нет событий — когда гость откроет ссылку, здесь появятся графики.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t pt-6">
      <div>
        <p className="text-sm font-medium">Активность гостя</p>
        <p className="text-muted-foreground text-xs">{periodLabel}</p>
      </div>

      <div className="min-w-0 space-y-1">
        <p className="text-muted-foreground text-xs">Воронка по дням · {totalOpens} открытий</p>
        <ChartContainer config={funnelConfig} className="aspect-auto h-[130px] w-full">
          <AreaChart data={stats.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={28}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => {
                const date = new Date(`${value}T00:00:00`)
                return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                    })
                  }
                  indicator="dot"
                />
              }
            />
            <Area dataKey="open" type="monotone" fill="var(--color-open)" fillOpacity={0.15} stroke="var(--color-open)" strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      </div>

      {ratesSeries.some((row) => row.autoplayPct != null || row.contactPct != null) ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Конверсия по дням</p>
          <ChartContainer config={ratesConfig} className="aspect-auto h-[110px] w-full">
            <LineChart data={ratesSeries} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                minTickGap={28}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => {
                  const date = new Date(`${value}T00:00:00`)
                  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                }}
              />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                      })
                    }
                    formatter={(value, name) => (
                      <>
                        <span className="text-muted-foreground">
                          {ratesConfig[name as keyof typeof ratesConfig]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums">{value != null ? `${value}%` : '—'}</span>
                      </>
                    )}
                  />
                }
              />
              <Line dataKey="autoplayPct" type="monotone" stroke="var(--color-autoplayPct)" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="contactPct" type="monotone" stroke="var(--color-contactPct)" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ChartContainer>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col">
          <p className="text-muted-foreground mb-1 min-h-4 text-xs">
            {peak.opens ? `Время суток · пик ${String(peak.hour).padStart(2, '0')}:00` : 'Время суток'}
          </p>
          <ChartContainer config={hourConfig} className="aspect-auto h-[110px] w-full shrink-0">
            <BarChart data={hours} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={4} interval={3} tick={{ fontSize: 10 }} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => `${String(value).padStart(2, '0')}:00`}
                    indicator="dot"
                  />
                }
              />
              <Bar dataKey="opens" fill="var(--color-opens)" radius={2} />
            </BarChart>
          </ChartContainer>
          <div className="mt-1 min-h-[1.125rem]" aria-hidden />
        </div>

        <div className="flex min-w-0 flex-col">
          <p className="text-muted-foreground mb-1 min-h-4 text-xs">Досмотрел autoplay</p>
          <ChartContainer config={engagementConfig} className="aspect-auto h-[110px] w-full shrink-0">
            <RadialBarChart data={engagementData} startAngle={90} endAngle={-270} innerRadius={34} outerRadius={48}>
              <PolarGrid gridType="circle" radialLines={false} stroke="none" className="first:fill-muted last:fill-card" polarRadius={[38, 30]} />
              <RadialBar dataKey="value" background stackId="a" cornerRadius={6} />
              <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-lg font-semibold tabular-nums">
                            {opens ? `${engagementPct}%` : '—'}
                          </tspan>
                        </text>
                      )
                    }
                    return null
                  }}
                />
              </PolarRadiusAxis>
            </RadialBarChart>
          </ChartContainer>
          <div className="mt-1 min-h-[1.125rem]" aria-hidden />
        </div>

        <div className="flex min-w-0 flex-col">
          <p className="text-muted-foreground mb-1 min-h-4 text-xs">Устройство</p>
          {deviceData.length === 0 ? (
            <div className="text-muted-foreground flex h-[110px] shrink-0 items-center text-xs">Нет открытий</div>
          ) : (
            <ChartContainer config={deviceConfig} className="aspect-auto h-[110px] w-full shrink-0">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
                <Pie data={deviceData} dataKey="value" nameKey="name" innerRadius={28} outerRadius={44} strokeWidth={2}>
                  {deviceData.map((row, index) => (
                    <Cell key={row.name} fill={DEVICE_COLORS[index % DEVICE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
          <ul className="mt-1 flex min-h-[1.125rem] flex-wrap justify-center gap-x-3 gap-y-0.5 text-[11px]">
            {deviceData.map((row) => (
              <li key={row.name} className="text-muted-foreground tabular-nums">
                {DEVICE_LABEL[row.name]} {row.value}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {topicData.length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Темы из меню</p>
          <ChartContainer config={{ opens: { label: 'Открытия', color: 'var(--chart-2)' } }} className="aspect-auto h-[110px] w-full">
            <BarChart data={topicData} layout="vertical" margin={{ left: 4, right: 8, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={72} tick={{ fontSize: 10 }} tickMargin={4} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel indicator="dot" />} />
              <Bar dataKey="opens" fill="var(--color-opens)" radius={3} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : null}

      {channelData.length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Каналы связи</p>
          <ChartContainer config={channelConfig} className="mx-auto aspect-square h-[100px]">
            <PieChart>
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
              <Pie data={channelData} dataKey="value" nameKey="name" innerRadius={24} outerRadius={40} strokeWidth={2}>
                {channelData.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>
      ) : null}
    </div>
  )
}
