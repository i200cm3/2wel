import { Label, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  type ChartConfig,
} from '@/components/ui/chart'

const chartConfig = {
  rate: { label: 'Открытия', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function ChartRadialOpenRate({
  opened,
  issued,
  periodLabel,
}: {
  opened: number
  issued: number
  periodLabel: string
}) {
  const pct = issued > 0 ? Math.min(100, Math.round((opened / issued) * 100)) : 0
  const chartData = [
    { name: 'rate', value: pct, fill: 'var(--color-rate)' },
    { name: 'rest', value: Math.max(0, 100 - pct), fill: 'transparent' },
  ]

  return (
    <Card className="@container/card flex h-full flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle className="font-sans">% открытий ссылок</CardTitle>
        <CardDescription>
          {periodLabel} · открыли {opened} из {issued} выданных
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center pb-4">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square h-[180px] w-full max-w-[220px]"
        >
          <RadialBarChart
            data={chartData}
            startAngle={90}
            endAngle={-270}
            innerRadius={68}
            outerRadius={96}
          >
            <PolarGrid
              gridType="circle"
              radialLines={false}
              stroke="none"
              className="first:fill-muted last:fill-background"
              polarRadius={[74, 62]}
            />
            <RadialBar dataKey="value" background stackId="a" cornerRadius={10} />
            <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-semibold tabular-nums"
                        >
                          {issued ? `${pct}%` : '—'}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 22}
                          className="fill-muted-foreground text-xs"
                        >
                          открыли
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
      </CardContent>
    </Card>
  )
}
