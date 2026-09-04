import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { CheckIcon } from 'lucide-react'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchProjectPlan, type ProjectPlan } from '@/lib/api'
import {
  formatDay,
  formatPeriod,
  formatPriceFrom,
  planTier,
  pluralLinks,
} from '@/lib/plans'
import { cn, supportMailHref } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = {
  upgrade: 'Повышение',
  downgrade: 'Понижение',
  cancelled: 'Отменено',
}

function formatDt(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PlanPage() {
  const { code } = useParams()
  const { project } = useOutletContext<CabinetOutlet>()
  const projectCode = code || project?.code || ''
  const [data, setData] = useState<ProjectPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    void fetchProjectPlan(projectCode)
      .then((next) => {
        if (cancelled) return
        setData(next)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить тариф')
      })
    return () => {
      cancelled = true
    }
  }, [projectCode])

  if (error && !data) return <p className="text-destructive p-6">{error}</p>
  if (!data) return <p className="text-muted-foreground p-6">Загрузка…</p>

  const { plan, usage, period } = data
  const tier = planTier(plan.id)

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Тариф «{plan.name}»</CardTitle>
          <CardDescription>
            {tier.tagline} · конструктор {plan.constructor === 'v2' ? 'V2' : 'V1'} · период{' '}
            {formatPeriod(period.start, period.end)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">Подписка</dt>
              <dd className="mt-1 font-medium tabular-nums">{formatPriceFrom(usage.base)} ₽ / мес</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Ссылки за период</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {usage.links} {pluralLinks(usage.links)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Лимит ссылок</dt>
              <dd className="mt-1 font-medium">Без лимита</dd>
            </div>
          </dl>

          <p className="text-muted-foreground text-sm">
            Пока оплата не подключена, тариф «Про» включает администратор 2wel.
            Напишите в поддержку, если нужен конструктор после разговора (V2).
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<a href={supportMailHref(`Тариф Про — ${project?.name ?? projectCode}`)} />}
          >
            Написать в поддержку
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {data.plans.map((item) => {
          const itemTier = planTier(item.id)
          return (
            <Card key={item.id} className={cn(item.current && 'border-primary')}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-sans">{item.name}</CardTitle>
                  {item.current ? <Badge>Текущий</Badge> : null}
                </div>
                <CardDescription>{itemTier.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p>
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatPriceFrom(item.price)}
                  </span>
                  <span className="text-muted-foreground text-sm"> ₽ / мес</span>
                </p>
                <ul className="text-muted-foreground space-y-1.5 text-sm">
                  {itemTier.features.slice(0, 4).map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {item.current ? (
                  <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <CheckIcon className="text-primary size-4" />
                    Подключён
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">Включение через администратора</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Отдельные услуги</CardTitle>
          <CardDescription>Не входят в тариф и считаются отдельно.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Подключение собственного домена и белая этикетка в адресе гостя.
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<a href={supportMailHref(`Отдельные услуги — ${project?.name ?? projectCode}`)} />}
          >
            Написать в поддержку
          </Button>
        </CardContent>
      </Card>

      {data.history.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-sans">История тарифа</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Когда</TableHead>
                  <TableHead>Что</TableHead>
                  <TableHead>Переход</TableHead>
                  <TableHead>Действует с</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDt(row.createdAt)}
                    </TableCell>
                    <TableCell>{KIND_LABEL[row.kind] ?? row.kind}</TableCell>
                    <TableCell>
                      {row.fromName} → {row.toName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDay(row.effectiveAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
