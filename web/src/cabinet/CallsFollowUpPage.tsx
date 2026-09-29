import { useEffect, useState } from 'react'
import { CheckIcon, ExternalLinkIcon, PhoneIcon } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { declineLabel, intentLabel } from '@/cabinet/callInsightsLabels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchProjectCalls,
  updateProjectCallFollowUp,
  type ProjectCallListItem,
} from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isOverdue(dueAt: string | null | undefined) {
  if (!dueAt) return false
  const t = new Date(dueAt).getTime()
  return Number.isFinite(t) && t < Date.now()
}

export function CallsFollowUpPage() {
  const { code } = useParams()
  const projectCode = String(code ?? '').trim()
  const [statusTab, setStatusTab] = useState<'open' | 'done'>('open')
  const [calls, setCalls] = useState<ProjectCallListItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [amoBaseDomain, setAmoBaseDomain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    setPending(true)
    void fetchProjectCalls(projectCode, {
      limit: 100,
      offset: 0,
      followUpStatus: statusTab,
    })
      .then((data) => {
        if (cancelled) return
        setCalls(data.calls)
        setTotal(data.total)
        setAmoBaseDomain(data.amoBaseDomain)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить очередь')
        setCalls([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectCode, statusTab])

  async function markDone(call: ProjectCallListItem) {
    if (!projectCode) return
    setSavingId(call.id)
    try {
      await updateProjectCallFollowUp(projectCode, call.id, { status: 'done' })
      setCalls((prev) => (prev ? prev.filter((item) => item.id !== call.id) : prev))
      setTotal((n) => Math.max(0, n - 1))
      toast.success('Отмечено как сделано')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить')
    } finally {
      setSavingId(null)
    }
  }

  async function reopen(call: ProjectCallListItem) {
    if (!projectCode) return
    setSavingId(call.id)
    try {
      await updateProjectCallFollowUp(projectCode, call.id, { status: 'open' })
      setCalls((prev) => (prev ? prev.filter((item) => item.id !== call.id) : prev))
      setTotal((n) => Math.max(0, n - 1))
      toast.success('Снова в очереди')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить')
    } finally {
      setSavingId(null)
    }
  }

  const overdueCount = (calls || []).filter((c) => isOverdue(c.followUpDueAt)).length

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-lg font-semibold">Дожать</h2>
          <p className="text-muted-foreground text-sm">
            Звонки, где нужен следующий шаг. Отметьте «сделано», когда действие выполнено.
          </p>
        </div>
        <NativeSelect
          value={statusTab}
          onChange={(event) => setStatusTab(event.target.value === 'done' ? 'done' : 'open')}
          className="w-[160px]"
        >
          <NativeSelectOption value="open">Открытые</NativeSelectOption>
          <NativeSelectOption value="done">Сделано</NativeSelectOption>
        </NativeSelect>
      </div>

      {statusTab === 'open' && overdueCount > 0 ? (
        <p className="text-destructive shrink-0 text-sm">
          Просрочено: {overdueCount}
        </p>
      ) : null}

      {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {calls === null || pending ? (
          <p className="text-muted-foreground text-sm">Загрузка…</p>
        ) : calls.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-8 text-sm">
            <PhoneIcon className="size-5 opacity-60" />
            <p>
              {statusTab === 'open'
                ? 'Открытых нет — либо всё сделано, либо ещё не размечено.'
                : 'Пока нет отмеченных как сделанные.'}
            </p>
            <Button variant="outline" size="sm" render={<Link to={`/app/projects/${projectCode}/calls`} />}>
              К списку звонков
            </Button>
          </div>
        ) : (
          <div className="h-full overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Срок</TableHead>
                  <TableHead>Сделка</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="min-w-[240px]">Что сделать</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const href = amoLeadUrl(amoBaseDomain, call.leadId)
                  const overdue = statusTab === 'open' && isOverdue(call.followUpDueAt)
                  return (
                    <TableRow
                      key={call.id}
                      className={overdue ? 'bg-destructive/5' : undefined}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className={overdue ? 'text-destructive font-medium' : ''}>
                            {formatDt(call.followUpDueAt)}
                          </span>
                          {overdue ? (
                            <Badge variant="destructive">Просрочен</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {call.leadId && call.leadId !== '0' ? (
                          <div className="flex flex-col gap-0.5">
                            <Link
                              to={`/app/projects/${projectCode}/calls/leads/${encodeURIComponent(call.leadId)}`}
                              className="text-primary hover:underline"
                            >
                              {call.leadId}
                            </Link>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline"
                              >
                                Amo
                                <ExternalLinkIcon className="size-3 opacity-70" />
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          call.leadId || '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {intentLabel(call.insightsIntent) ? (
                            <Badge variant="secondary">{intentLabel(call.insightsIntent)}</Badge>
                          ) : (
                            '—'
                          )}
                          {declineLabel(call.insightsDeclineReason) ? (
                            <span className="text-muted-foreground text-xs">
                              {declineLabel(call.insightsDeclineReason)}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <div className="space-y-1 text-sm">
                          <p className="line-clamp-2">
                            {call.summaryNextStep || call.summaryOutcome || '—'}
                          </p>
                          {call.summaryOutcome && call.summaryNextStep ? (
                            <p className="text-muted-foreground line-clamp-2 text-xs">
                              {call.summaryOutcome}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            render={
                              <Link
                                to={`/app/projects/${projectCode}/calls/leads/${encodeURIComponent(call.leadId || '')}`}
                              />
                            }
                          >
                            Сделка
                          </Button>
                          {statusTab === 'open' ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={savingId === call.id}
                              onClick={() => void markDone(call)}
                            >
                              <CheckIcon />
                              Сделано
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={savingId === call.id}
                              onClick={() => void reopen(call)}
                            >
                              Вернуть
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {calls && calls.length > 0 ? (
        <p className="text-muted-foreground shrink-0 text-xs">{total} в очереди</p>
      ) : null}
    </div>
  )
}
