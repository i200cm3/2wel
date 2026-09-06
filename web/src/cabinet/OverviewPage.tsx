import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { Loader2Icon } from 'lucide-react'
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
  createTemplate,
  fetchProjectStats,
  fetchTemplateConfig,
  fetchTemplates,
  publishTemplate,
  type ProjectStats,
  type Template,
} from '@/lib/api'
import { defaultStatsRange, formatRangeLabel, parseDay, type DayRange } from '@/lib/statsRange'
import { guestShareUrl } from '@/lib/utils'
import { editorPathForPlan, planTier } from '@/lib/plans'

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
  const { project } = useOutletContext<CabinetOutlet>()
  const [params, setParams] = useSearchParams()
  const range = useMemo(() => rangeFromSearch(params), [params])
  const periodLabel = formatRangeLabel(range.from, range.to)
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const welcome = params.get('welcome') === '1'

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

  const clearWelcome = useCallback(() => {
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev)
        nextParams.delete('welcome')
        return nextParams
      },
      { replace: true },
    )
  }, [setParams])

  if (error && !stats) {
    return <p className="text-destructive p-6">{error}</p>
  }
  if (!stats || !project) {
    return <p className="text-muted-foreground p-6">Загрузка…</p>
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {code ? (
          <SetupCard
            code={code}
            stats={stats}
            planId={project?.plan?.id}
            welcome={welcome}
            onWelcomeHandled={clearWelcome}
          />
        ) : null}
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

function SetupCard({
  code,
  stats,
  planId,
  welcome,
  onWelcomeHandled,
}: {
  code: string
  stats: ProjectStats
  planId?: string
  welcome?: boolean
  onWelcomeHandled?: () => void
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [whatsApp, setWhatsApp] = useState<string | null>(null)
  const [pendingLink, setPendingLink] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState(false)
  const [pendingPublish, setPendingPublish] = useState(false)

  const applyTemplates = async (list: Template[]) => {
    setTemplates(list)
    const nextDef = list.find((item) => item.isDefault) ?? list[0]
    if (!nextDef) {
      setWhatsApp('')
      return
    }
    const cfg = await fetchTemplateConfig(code, nextDef.code)
    setWhatsApp(whatsAppFromConfig(cfg.draft ?? cfg.config))
  }

  const loadTemplates = () =>
    fetchTemplates(code).then(async (data) => {
      await applyTemplates(data.templates)
      return data.templates
    })

  useEffect(() => {
    let cancelled = false
    void fetchTemplates(code)
      .then(async (data) => {
        if (cancelled) return
        setTemplates(data.templates)
        const nextDef = data.templates.find((item) => item.isDefault) ?? data.templates[0]
        if (!nextDef) {
          setWhatsApp('')
          return
        }
        const cfg = await fetchTemplateConfig(code, nextDef.code)
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
  const editorTo = def
    ? editorPathForPlan(planId, code, def.code)
    : `/app/projects/${code}/templates`
  const templatesTo = `/app/projects/${code}/templates`
  const linksTo = `/app/projects/${code}/links`
  const ctorLabel = planTier(planId).constructor === 'v2' ? 'Конструктор V2' : 'Конструктор шаблона'

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
        onWelcomeHandled?.()
        window.open(url, '_blank', 'noopener,noreferrer')
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось выдать ссылку'))
      .finally(() => setPendingLink(false))
  }

  // Регистрация уже создаёт опубликованный «Сосновый берег» — welcome ведёт к первому тесту.
  if (welcome && templates.length > 0 && published.length > 0) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="font-sans">Добро пожаловать</CardTitle>
            <CardDescription>
              Пример «Сосновый берег» уже в объекте и опубликован. Откройте тестовую ссылку с
              телефона — так выглядит канал для гостя. Потом можно поменять бренд в конструкторе.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" disabled={pendingLink} onClick={issueTestLink}>
              {pendingLink ? <Loader2Icon className="animate-spin" /> : null}
              Тестовая ссылка
            </Button>
            {def ? (
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to={editorTo} onClick={() => onWelcomeHandled?.()} />}
              >
                {ctorLabel}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => onWelcomeHandled?.()}>
              Позже
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (templates.length === 0) {
    const addStarter = () => {
      setPendingTemplate(true)
      void createTemplate(code, { name: 'Пример шаблона: Сосновый берег', starter: true })
        .then(async (data) => {
          try {
            await publishTemplate(code, data.template.code)
            toast.success('Пример добавлен и опубликован — можно выдать тестовую ссылку')
          } catch {
            toast.success('Пример добавлен — опубликуйте его, чтобы выдать ссылку')
          }
          onWelcomeHandled?.()
          return loadTemplates()
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : 'Не удалось добавить пример')
        })
        .finally(() => setPendingTemplate(false))
    }

    const addBlank = () => {
      setPendingTemplate(true)
      void createTemplate(code, { name: 'Новый шаблон' })
        .then((data) => {
          toast.success(`Создан «${data.template.name}» — откройте конструктор`)
          onWelcomeHandled?.()
          return loadTemplates()
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : 'Не удалось создать шаблон')
        })
        .finally(() => setPendingTemplate(false))
    }

    return (
      <div className="px-4 lg:px-6">
        <Card className={welcome ? 'border-primary/40' : undefined}>
          <CardHeader>
            <CardTitle className="font-sans">
              {welcome ? 'Добро пожаловать — добавьте первый шаблон' : 'Добавьте первый шаблон'}
            </CardTitle>
            <CardDescription>
              Без шаблона ссылку гостю не выдать. Пример «Сосновый берег» сразу можно
              опубликовать и открыть с телефона. Или начните с пустого.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" disabled={pendingTemplate} onClick={addStarter}>
              {pendingTemplate ? <Loader2Icon className="animate-spin" /> : null}
              Добавить пример
            </Button>
            <Button type="button" variant="outline" disabled={pendingTemplate} onClick={addBlank}>
              Пустой шаблон
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link to={templatesTo} />}
            >
              К шаблонам
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const steps: { id: string; text: string; to?: string; action?: 'test-link' | 'publish' }[] = []
  if (published.length === 0) {
    steps.push({
      id: 'publish',
      text: 'Опубликуйте шаблон — без этого ссылку гостю не выдать.',
      action: 'publish',
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

  const publishDraft = () => {
    if (!def) return
    setPendingPublish(true)
    void publishTemplate(code, def.code)
      .then(() => loadTemplates())
      .then(() => toast.success(`«${def.name}» опубликован`))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось опубликовать'))
      .finally(() => setPendingPublish(false))
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
            {published.length === 0 && def ? (
              <Button size="sm" disabled={pendingPublish} onClick={publishDraft}>
                {pendingPublish ? <Loader2Icon className="animate-spin" /> : null}
                Опубликовать
              </Button>
            ) : null}
            {def ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to={editorTo} />}>
                {ctorLabel}
              </Button>
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
