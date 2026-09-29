import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  declineLabel,
  DECLINE_LABELS,
  intentLabel,
  INTENT_LABELS,
  topicLabel,
  TOPIC_LABELS,
} from '@/cabinet/callInsightsLabels'
import { fetchProjectCallStats, type ProjectCallInsightsStats } from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'
import { ExternalLinkIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const DECLINE_CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

function toBarData(map: Record<string, number>, labelFn: (key: string) => string | null) {
  return Object.entries(map)
    .filter(([key, n]) => n > 0 && key !== 'none')
    .map(([key, n]) => ({
      key,
      label: labelFn(key) || key,
      count: n,
    }))
    .sort((a, b) => b.count - a.count)
}

function formatWeekLabel(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CallsAnalyticsPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const projectCode = String(code ?? '').trim()
  const base = `/app/projects/${projectCode}/calls`
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<ProjectCallInsightsStats | null>(null)
  const [amoBaseDomain, setAmoBaseDomain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    setPending(true)
    void fetchProjectCallStats(projectCode, { days })
      .then((data) => {
        if (cancelled) return
        setStats(data.stats)
        setAmoBaseDomain(data.amoBaseDomain ?? null)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить аналитику')
        setStats(null)
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectCode, days])

  const intentData = useMemo(
    () => toBarData(stats?.byIntent ?? {}, intentLabel),
    [stats],
  )
  const declineData = useMemo(
    () => toBarData(stats?.byDecline ?? {}, declineLabel),
    [stats],
  )
  const declineWithReason = useMemo(
    () => Object.values(stats?.byDecline ?? {}).reduce((sum, n) => sum + (n || 0), 0),
    [stats],
  )
  const declineWithoutReason = Math.max(0, (stats?.total ?? 0) - declineWithReason)
  const topicData = useMemo(
    () =>
      (stats?.byTopic ?? []).map((row) => ({
        key: row.topic,
        label: topicLabel(row.topic) || row.topic,
        count: row.count,
        addressed: row.addressed,
        addressedRate: row.addressedRate,
      })),
    [stats],
  )

  const weekReasons = useMemo(() => {
    const keys = new Set<string>()
    for (const week of stats?.declinesByWeek ?? []) {
      for (const key of Object.keys(week.byReason || {})) keys.add(key)
    }
    return [...keys].sort()
  }, [stats])

  const weekData = useMemo(
    () =>
      (stats?.declinesByWeek ?? []).map((week) => {
        const row: Record<string, string | number> = {
          weekStart: week.weekStart,
          label: formatWeekLabel(week.weekStart),
          total: week.total,
        }
        for (const key of weekReasons) {
          row[key] = week.byReason?.[key] || 0
        }
        return row
      }),
    [stats, weekReasons],
  )

  const weekChartConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {}
    weekReasons.forEach((key, index) => {
      config[key] = {
        label: declineLabel(key) || key,
        color: DECLINE_CHART_COLORS[index % DECLINE_CHART_COLORS.length],
      }
    })
    return config
  }, [weekReasons])

  const callsHref = (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    qs.set('status', 'done')
    qs.set('days', String(days))
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === '') continue
      qs.set(key, String(value))
    }
    return `${base}?${qs.toString()}`
  }

  return (
    <div className="h-full min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-lg font-semibold">Аналитика звонков</h2>
          <p className="text-muted-foreground text-sm">
            Состав входящих, отказы, темы и повторные контакты по сделкам.
          </p>
        </div>
        <NativeSelect
          value={String(days)}
          onChange={(event) => setDays(Number(event.target.value) || 30)}
          className="w-[140px]"
          aria-label="Период"
        >
          <NativeSelectOption value="7">7 дней</NativeSelectOption>
          <NativeSelectOption value="30">30 дней</NativeSelectOption>
          <NativeSelectOption value="90">90 дней</NativeSelectOption>
        </NativeSelect>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {pending && !stats ? <p className="text-muted-foreground text-sm">Загрузка…</p> : null}

      {stats ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Link
              to={callsHref({})}
              className="bg-card hover:bg-muted/40 rounded-xl border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">Звонков</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.total}</div>
            </Link>
            <Link
              to={callsHref({ review: '1' })}
              className="bg-card hover:bg-muted/40 rounded-xl border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">С разбором</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.withReview}</div>
            </Link>
            <Link
              to={callsHref({ followUp: 'open' })}
              className="bg-card hover:bg-muted/40 rounded-xl border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">Дожать · открыто</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.followUpOpen ?? 0}</div>
              {(stats.followUpOverdue ?? 0) > 0 ? (
                <div className="text-destructive mt-1 text-xs">
                  просрочено {stats.followUpOverdue}
                </div>
              ) : null}
            </Link>
            <Link
              to={callsHref({ follow: '1' })}
              className="bg-card hover:bg-muted/40 rounded-xl border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">Нужен контакт</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.needsFollowUp}</div>
            </Link>
            <Link
              to={callsHref({ warm: '1' })}
              className="bg-card hover:bg-muted/40 rounded-xl border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">Тёплые без брони · сделки</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {(stats.warmLeads ?? []).length}
              </div>
              {(stats.warmLeads ?? []).length > 0 ? (
                <div className="text-muted-foreground mt-1 text-xs">
                  {(stats.warmLeads ?? []).reduce((sum, lead) => sum + (lead.callCount || 0), 0)}{' '}
                  звонков
                </div>
              ) : null}
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Тип обращения</CardTitle>
                <CardDescription>Из чего состоит входящий поток</CardDescription>
              </CardHeader>
              <CardContent>
                {intentData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Пока нет данных.</p>
                ) : (
                  <ChartContainer
                    config={{
                      count: { label: 'Звонков', color: 'var(--chart-1)' },
                    }}
                    className="aspect-auto h-[280px] w-full"
                  >
                    <BarChart
                      data={intentData}
                      layout="vertical"
                      margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                    >
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={130}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[0, 4, 4, 0]}
                        cursor="pointer"
                        onClick={(entry) => {
                          const key = (entry as { key?: string })?.key
                          if (key) navigate(callsHref({ intent: key }))
                        }}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Причины отказа</CardTitle>
                <CardDescription>Почему ушли без брони</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {declineData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Отказов с причиной пока нет.</p>
                ) : (
                  <ChartContainer
                    config={{
                      count: { label: 'Звонков', color: 'var(--chart-2)' },
                    }}
                    className="aspect-auto h-[280px] w-full"
                  >
                    <BarChart
                      data={declineData}
                      layout="vertical"
                      margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                    >
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={110}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[0, 4, 4, 0]}
                        cursor="pointer"
                        onClick={(entry) => {
                          const key = (entry as { key?: string })?.key
                          if (key) navigate(callsHref({ decline: key }))
                        }}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
                {declineWithoutReason > 0 ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground text-left text-sm underline-offset-4 hover:underline"
                    onClick={() => navigate(callsHref({ decline: 'none' }))}
                  >
                    Ещё {declineWithoutReason} — не озвучили причину отказа
                  </button>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Отказы по неделям</CardTitle>
              <CardDescription>Агрегат для директора — динамика причин</CardDescription>
            </CardHeader>
            <CardContent>
              {weekData.length === 0 ? (
                <p className="text-muted-foreground text-sm">За период отказов с причиной нет.</p>
              ) : (
                <ChartContainer config={weekChartConfig} className="aspect-auto h-[300px] w-full">
                  <BarChart data={weekData} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    {weekReasons.map((key) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="declines"
                        fill={`var(--color-${key})`}
                        name={declineLabel(key) || key}
                        radius={[0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Возражения и темы</CardTitle>
                <CardDescription>Что спрашивали чаще и закрыл ли оператор</CardDescription>
              </CardHeader>
              <CardContent>
                {topicData.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Тем пока нет.</p>
                ) : (
                  <div className="space-y-3">
                    {topicData.map((item) => (
                      <div key={item.key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span>{item.label}</span>
                          <span className="text-muted-foreground tabular-nums text-xs">
                            {item.count} · закрыто {item.addressedRate}%
                          </span>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, item.addressedRate)}%`,
                              background: 'var(--chart-1)',
                            }}
                          />
                        </div>
                        {item.key === 'other' && (stats.otherTopicLabels ?? []).length > 0 ? (
                          <ul className="text-muted-foreground space-y-0.5 pl-1 text-xs">
                            {(stats.otherTopicLabels ?? []).map((row) => (
                              <li key={row.label} className="flex justify-between gap-2">
                                <span>— {row.label}</span>
                                <span className="tabular-nums shrink-0">
                                  {row.count} · {row.addressedRate}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {item.key === 'other' && (stats.otherTopicLabels ?? []).length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            Без расшифровки — переразметьте звонки с актуальным промптом.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card id="warm-leads" className="scroll-mt-4">
              <CardHeader>
                <CardTitle className="text-base">Повторный контакт</CardTitle>
                <CardDescription>
                  Сделки с ≥3 звонками, тёплый интерес, бронь не закрыта
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(stats.warmLeads ?? []).length === 0 ? (
                  <p className="text-muted-foreground text-sm">Таких сделок за период нет.</p>
                ) : (
                  <ul className="space-y-3">
                    {(stats.warmLeads ?? []).map((lead) => {
                      const amoHref = amoLeadUrl(amoBaseDomain, lead.leadId)
                      const leadPageHref = `/app/projects/${projectCode}/calls/leads/${encodeURIComponent(lead.leadId)}`
                      return (
                        <li
                          key={lead.leadId}
                          className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={leadPageHref}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              Сделка {lead.leadId}
                            </Link>
                            <Badge variant="secondary">{lead.callCount} звонк.</Badge>
                            {lead.openFollowUp ? (
                              <Badge variant="outline">Дожать · открыто</Badge>
                            ) : null}
                            {amoHref ? (
                              <a
                                href={amoHref}
                                target="_blank"
                                rel="noreferrer"
                                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                              >
                                Amo
                                <ExternalLinkIcon className="size-3" />
                              </a>
                            ) : null}
                          </div>
                          <Link
                            to={leadPageHref}
                            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                          >
                            {lead.signal ||
                              `гость звонил ${lead.callCount} раз, интерес тёплый, бронь не закрыта`}
                            {' · '}
                            {formatDt(lead.lastAt)}
                            {lead.lastIntent ? ` · ${intentLabel(lead.lastIntent)}` : ''}
                            {lead.lastDecline ? ` · ${declineLabel(lead.lastDecline)}` : ''}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-muted-foreground text-xs">
            Типы: {Object.keys(INTENT_LABELS).filter((k) => k !== 'none').join(', ')}. Отказы:{' '}
            {Object.keys(DECLINE_LABELS).filter((k) => k !== 'none').join(', ')}. Темы:{' '}
            {Object.keys(TOPIC_LABELS).join(', ')}.
          </p>
        </div>
      ) : null}
    </div>
  )
}
