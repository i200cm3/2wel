import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { FunnelCounts } from '@/lib/api'

const chartConfig = {
  autoplayPct: { label: 'Досмотрел автопоказ', color: 'var(--chart-2)' },
  contactPct: { label: 'Нажал кнопку связи', color: 'var(--chart-4)' },
} satisfies ChartConfig

function rate(part: number, whole: number) {
  if (!whole) return null
  return Math.round((part / whole) * 100)
}

export function ChartLineRates({
  data,
  periodLabel,
}: {
  data: ({ date: string } & FunnelCounts)[]
  periodLabel: string
}) {
  const series = data.map((row) => ({
    date: row.date,
    autoplayPct: rate(row.autoplay, row.open),
    contactPct: rate(row.contact ?? row.whatsapp, row.open),
  }))

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="font-sans">Конверсия во времени</CardTitle>
        <CardDescription>
          {periodLabel} · доля открывших, кто досмотрел ролик и кто нажал WhatsApp / MAX / звонок
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <LineChart data={series} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(`${value}T00:00:00`)
                return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              }}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              width={36}
              tickFormatter={(value) => `${value}%`}
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
                  formatter={(value, name) => (
                    <div className="flex flex-1 items-center justify-between leading-none">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {value == null ? '—' : `${value}%`}
                      </span>
                    </div>
                  )}
                  indicator="line"
                />
              }
            />
            <Line
              dataKey="autoplayPct"
              type="monotone"
              stroke="var(--color-autoplayPct)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              dataKey="contactPct"
              type="monotone"
              stroke="var(--color-contactPct)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
