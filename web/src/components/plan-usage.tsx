import { Link } from 'react-router-dom'
import { ArrowUpRightIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlanSummary } from '@/lib/api'
import { formatDay, planTier } from '@/lib/plans'
import { cn } from '@/lib/utils'

/** Баннер только при запланированном понижении — пакетов ссылок больше нет. */
export function PlanUsageBanner({
  plan,
  projectCode,
}: {
  plan: PlanSummary | undefined
  projectCode: string
}) {
  if (!plan?.pendingPlan || !plan.pendingEffectiveAt) return null

  const pendingName = planTier(plan.pendingPlan).name

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
      )}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="text-sm">
          <p className="font-medium">Запланирован переход на «{pendingName}»</p>
          <p className="text-muted-foreground mt-0.5">
            С {formatDay(plan.pendingEffectiveAt)} тариф сменится. Ссылки без лимита на обоих
            уровнях.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        render={<Link to={`/app/projects/${projectCode}/plan`} />}
      >
        Тариф
        <ArrowUpRightIcon />
      </Button>
    </div>
  )
}
