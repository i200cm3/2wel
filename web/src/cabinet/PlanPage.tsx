import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckIcon } from 'lucide-react'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { changeProjectPlan, fetchProjectPlan, type ProjectPlan } from '@/lib/api'
import {
  formatDay,
  formatPeriod,
  formatPriceFrom,
  isPlanUpgrade,
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
  const { project, reloadProjects } = useOutletContext<CabinetOutlet>()
  const projectCode = code || project?.code || ''
  const [data, setData] = useState<ProjectPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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

  const { plan, usage, period, pending: scheduled } = data
  const targetPlan = target ? data.plans.find((item) => item.id === target) : null
  const upgrading = target ? isPlanUpgrade(plan.id, target) : false

  const apply = async (planId: string) => {
    const wasActive = plan.id
    setPending(true)
    try {
      const next = await changeProjectPlan(projectCode, planId)
      setData(next)
      setTarget(null)
      await reloadProjects()
      if (next.pending?.plan === planId) {
        toast.success(
          `Переход на «${next.pending.name}» запланирован на ${formatDay(next.pending.effectiveAt)}`,
        )
      } else if (planId === wasActive) {
        toast.success(`Остаётесь на тарифе «${next.plan.name}»`)
      } else {
        toast.success(`Тариф «${next.plan.name}» подключён`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сменить тариф')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Тариф «{plan.name}»</CardTitle>
          <CardDescription>
            {planTier(plan.id).tagline} · период {formatPeriod(period.start, period.end)}.
            Следующий расчётный день — {formatDay(period.end)}.
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
            Ссылки не тарифицируются отдельно — в подписку входит продукт целиком.
          </p>

          {scheduled ? (
            <div className="flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                С {formatDay(scheduled.effectiveAt)} тариф сменится на «{scheduled.name}».
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void apply(plan.id)}
              >
                Оставить «{plan.name}»
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {data.plans.map((item) => {
          const higher = isPlanUpgrade(plan.id, item.id)
          const tier = planTier(item.id)
          return (
            <Card key={item.id} className={cn(item.current && 'border-primary')}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-sans">{item.name}</CardTitle>
                  {item.current ? <Badge>Текущий</Badge> : null}
                </div>
                <CardDescription>{tier.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p>
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatPriceFrom(item.price)}
                  </span>
                  <span className="text-muted-foreground text-sm"> ₽ / мес</span>
                </p>
                <ul className="text-muted-foreground space-y-1.5 text-sm">
                  {tier.features.slice(0, 3).map((feature) => (
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
                  <p className="text-muted-foreground text-sm">
                    {higher
                      ? 'Включится сразу после подтверждения'
                      : `Включится ${formatDay(period.end)}, с конца оплаченного периода`}
                  </p>
                )}

                <Button
                  className="w-full"
                  variant={higher ? 'default' : 'outline'}
                  disabled={item.current || pending || scheduled?.plan === item.id}
                  onClick={() => setTarget(item.id)}
                >
                  {item.current
                    ? 'Текущий тариф'
                    : scheduled?.plan === item.id
                      ? 'Уже запланирован'
                      : higher
                        ? 'Перейти сейчас'
                        : 'Перейти с конца периода'}
                </Button>
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

      <AlertDialog
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {upgrading
                ? `Перейти на «${targetPlan?.name}»?`
                : `Понизить до «${targetPlan?.name}»?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {upgrading
                ? `Тариф включится сразу: «${targetPlan?.name}» — ${planTier(targetPlan?.id).tagline}, ${formatPriceFrom(targetPlan?.price ?? 0)} ₽ / мес. Число гостей не ограничено.`
                : `Текущий тариф доработает до ${formatDay(period.end)}, после чего включится «${targetPlan?.name}» — ${planTier(targetPlan?.id).tagline}, ${formatPriceFrom(targetPlan?.price ?? 0)} ₽ / мес.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => target && void apply(target)}>
              {upgrading ? 'Перейти сейчас' : 'Запланировать'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
