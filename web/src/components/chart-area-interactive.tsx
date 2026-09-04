import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { FunnelCounts } from "@/lib/api"

const chartConfig = {
  open: {
    label: "Открыл",
    color: "var(--chart-1)",
  },
  autoplay: {
    label: "Автопоказ",
    color: "var(--chart-2)",
  },
  menu: {
    label: "Меню",
    color: "var(--chart-3)",
  },
  contact: {
    label: "Связь",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive({
  data,
  periodLabel,
}: {
  data: ({ date: string } & FunnelCounts)[]
  periodLabel: string
}) {
  const total = data.reduce((sum, row) => sum + (row.open ?? 0), 0)
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="font-sans">Воронка по дням</CardTitle>
        <CardDescription>
          {periodLabel} · {total} открытий
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="fillOpen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-open)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-open)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(`${value}T00:00:00`)
                return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                    })
                  }
                  indicator="dot"
                />
              }
            />
            <Area dataKey="open" type="monotone" fill="url(#fillOpen)" stroke="var(--color-open)" />
            <Area dataKey="autoplay" type="monotone" fill="transparent" stroke="var(--color-autoplay)" />
            <Area dataKey="menu" type="monotone" fill="transparent" stroke="var(--color-menu)" />
            <Area dataKey="contact" type="monotone" fill="transparent" stroke="var(--color-contact)" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
