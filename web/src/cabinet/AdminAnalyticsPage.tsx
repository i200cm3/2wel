import { useEffect, useMemo, useState } from 'react'
import { Navigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { AnalyticsPanels } from '@/components/analytics-panels'
import { ChartAreaInteractive } from '@/components/chart-area-interactive'
import { ChartLineRates } from '@/components/chart-line-rates'
import { ChartRadialOpenRate } from '@/components/chart-radial-open-rate'
import { DateRangePicker } from '@/components/date-range-picker'
import { SectionCards } from '@/components/section-cards'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchAdminStats, type AdminServiceStats } from '@/lib/api'
import { defaultStatsRange, formatRangeLabel, parseDay, type DayRange } from '@/lib/statsRange'

function rangeFromSearch(params: URLSearchParams): DayRange {
  const from = parseDay(params.get('from'))
  const to = parseDay(params.get('to'))
  if (from && to) return from <= to ? { from, to } : { from: to, to: from }
  if (from) return { from, to: from }
  return defaultStatsRange()
}

export function AdminAnalyticsPage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const [params, setParams] = useSearchParams()
  const range = useMemo(() => rangeFromSearch(params), [params])
  const periodLabel = formatRangeLabel(range.from, range.to)
  const [stats, setStats] = useState<AdminServiceStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAdminStats(range)
      .then((data) => {
        if (cancelled) return
        setStats(data.stats)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику')
      })
    return () => {
      cancelled = true
    }
  }, [range.from, range.to])

  const setRange = (next: DayRange) => {
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev)
        nextParams.set('from', next.from)
        nextParams.set('to', next.to)
        return nextParams
      },
      { replace: true },
    )
  }

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  if (error && !stats) {
    return <p className="text-destructive p-6">{error}</p>
  }
  if (!stats) {
    return <p className="text-muted-foreground p-6">Загрузка…</p>
  }

  const summary = stats.summary

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Объекты</CardDescription>
              <CardTitle className="font-sans text-2xl font-semibold tabular-nums">
                {summary.projects}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Пользователи</CardDescription>
              <CardTitle className="font-sans text-2xl font-semibold tabular-nums">
                {summary.users}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Активные за период</CardDescription>
              <CardTitle className="font-sans text-2xl font-semibold tabular-nums">
                {summary.activeProjects}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
          <DateRangePicker value={range} onChange={setRange} />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <SectionCards stats={stats} periodLabel={periodLabel} />
        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-3 lg:px-6">
          <div className="lg:col-span-1">
            <ChartRadialOpenRate
              opened={stats.openRate?.opened ?? 0}
              issued={stats.openRate?.issued ?? 0}
              periodLabel={periodLabel}
            />
          </div>
          <div className="lg:col-span-2">
            <ChartAreaInteractive data={stats.series} periodLabel={periodLabel} />
          </div>
        </div>
        <div className="px-4 lg:px-6">
          <ChartLineRates data={stats.series} periodLabel={periodLabel} />
        </div>
        <AnalyticsPanels stats={stats} periodLabel={periodLabel} />
      </div>
    </div>
  )
}
