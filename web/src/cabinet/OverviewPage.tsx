import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChartAreaInteractive } from '@/components/chart-area-interactive'
import { ChartLineRates } from '@/components/chart-line-rates'
import { ChartRadialOpenRate } from '@/components/chart-radial-open-rate'
import { AnalyticsPanels } from '@/components/analytics-panels'
import { DateRangePicker } from '@/components/date-range-picker'
import { PlanUsageBanner } from '@/components/plan-usage'
import { SectionCards } from '@/components/section-cards'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  createProjectLink,
  fetchProjectStats,
  fetchTemplateConfig,
  fetchTemplates,
  type ProjectStats,
  type Template,
} from '@/lib/api'
import { defaultStatsRange, formatRangeLabel, parseDay, type DayRange } from '@/lib/statsRange'
import { guestShareUrl } from '@/lib/utils'

function rangeFromSearch(params: URLSearchParams): DayRange {
  const from = parseDay(params.get('from'))
  const to = parseDay(params.get('to'))
  if (from && to) return from <= to ? { from, to } : { from: to, to: from }
  if (from) return { from, to: from }
  return defaultStatsRange()
}

function whatsAppFromConfig(config: unknown): string {
  if (!config || typeof config !== 'object') return ''
  const brand = (config as { brand?: { whatsAppNumber?: unknown } }).brand
  const raw = typeof brand?.whatsAppNumber === 'string' ? brand.whatsAppNumber : ''
  return raw.replace(/\D/g, '')
}

/** Один объект — сразу в обзор, не в аккаунт. */
export function AppIndex() {
  const { projects } = useOutletContext<CabinetOutlet>()
  const project = projects[0]
  if (project) return <Navigate to={`/app/projects/${project.code}`} replace />
  return <Navigate to="/app/account" replace />
}

export function OverviewPage() {
  const { code } = useParams()
  const { project, user } = useOutletContext<CabinetOutlet>()
  const [params, setParams] = useSearchParams()
  const range = useMemo(() => rangeFromSearch(params), [params])
  const periodLabel = formatRangeLabel(range.from, range.to)
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    void fetchProjectStats(code, range)
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
  }, [code, range.from, range.to])

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

  if (error && !stats) {
    return <p className="text-destructive p-6">{error}</p>
  }
  if (!stats || !project) {
    return <p className="text-muted-foreground p-6">Загрузка…</p>
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {code ? <SetupCard code={code} stats={stats} isAdmin={user.isAdmin} /> : null}
        <div className="px-4 lg:px-6 empty:hidden">
          <PlanUsageBanner plan={project.plan} projectCode={project.code} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
          <DateRangePicker value={range} onChange={setRange} />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <SectionCards stats={stats} status={project.status} periodLabel={periodLabel} />
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

function SetupCard({ code, stats, isAdmin }: { code: string; stats: ProjectStats; isAdmin: boolean }) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [whatsApp, setWhatsApp] = useState<string | null>(null)
  const [pendingLink, setPendingLink] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchTemplates(code)
      .then(async (data) => {
        if (cancelled) return
        setTemplates(data.templates)
        const def = data.templates.find((item) => item.isDefault) ?? data.templates[0]
        if (!def) {
          setWhatsApp('')
          return
        }
        const cfg = await fetchTemplateConfig(code, def.code)
        if (cancelled) return
        setWhatsApp(whatsAppFromConfig(cfg.draft ?? cfg.config))
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([])
          setWhatsApp('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (!templates) return null

  const published = templates.filter((item) => item.status === 'published')
  const def = templates.find((item) => item.isDefault) ?? templates[0]
  const editorTo = def ? `/app/projects/${code}/templates/${def.code}/edit` : `/app/projects/${code}/templates`
  const editorToV2 = def ? `/app/projects/${code}/templates/${def.code}/edit-v2` : `/app/projects/${code}/templates`
  const templatesTo = `/app/projects/${code}/templates`
  const linksTo = `/app/projects/${code}/links`

  const steps: { id: string; text: string; to?: string; action?: 'test-link' }[] = []
  if (templates.length === 0 || published.length === 0) {
    steps.push({
      id: 'publish',
      text: 'Опубликуйте шаблон — без этого ссылку гостю не выдать.',
      to: templatesTo,
    })
  }
  if (def && whatsApp === '') {
    steps.push({
      id: 'whatsapp',
      text: 'Укажите WhatsApp в конструкторе, иначе кнопка связи в меню пустая.',
      to: editorTo,
    })
  }
  if (stats.links === 0) {
    steps.push({
      id: 'link',
      text: 'Выдайте тестовую ссылку и откройте её с телефона.',
      action: 'test-link',
    })
  } else if ((stats.funnel?.open ?? 0) === 0) {
    steps.push({
      id: 'open',
      text: 'Ссылки уже есть, но открытий ещё не было. Откройте одну сами.',
      to: linksTo,
    })
  }

  if (steps.length === 0) return null

  const issueTestLink = () => {
    setPendingLink(true)
    void createProjectLink(code, { name: 'Тест' })
      .then((created) => {
        const url = guestShareUrl(code, created.url)
        return navigator.clipboard.writeText(url).then(
          () => url,
          () => url,
        )
      })
      .then((url) => {
        toast.success('Тестовая ссылка скопирована')
        window.open(url, '_blank', 'noopener,noreferrer')
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось выдать ссылку'))
      .finally(() => setPendingLink(false))
  }

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">С чего начать</CardTitle>
          <CardDescription>Пока гости не открыли презентацию — короткий чеклист.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
            {steps.map((step) => (
              <li key={step.id}>
                <span className="text-foreground">{step.text}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {def ? (
              isAdmin ? (
                <>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link to={editorTo} />}>
                    Конструктор V1
                  </Button>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link to={editorToV2} />}>
                    Конструктор V2
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link to={editorTo} />}>
                  Конструктор шаблона
                </Button>
              )
            ) : null}
            {stats.links === 0 ? (
              <Button size="sm" disabled={pendingLink || published.length === 0} onClick={issueTestLink}>
                {pendingLink ? 'Выдача…' : 'Тестовая ссылка'}
              </Button>
            ) : (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to={linksTo} />}>
                К ссылкам
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
