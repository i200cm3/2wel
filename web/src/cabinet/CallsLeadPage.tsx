import { useEffect, useState } from 'react'
import { ExternalLinkIcon, PhoneIcon } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { friendlyCallErrorLabel } from '@/cabinet/callErrorLabels'
import { CrmStageBadge, CallFollowChip, CallIntentChip, leadFollowUpStatus } from '@/cabinet/CrmStageBadge'
import { declineLabel, intentLabel } from '@/cabinet/callInsightsLabels'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  fetchProjectCall,
  fetchProjectCallLead,
  type ProjectCallDetail,
  type ProjectCallLeadPage,
  type ProjectCallListItem,
} from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'
import { cn } from '@/lib/utils'

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function pluralCalls(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'звонок'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'звонка'
  return 'звонков'
}

function spanLabel(calls: ProjectCallListItem[]) {
  if (calls.length < 2) return null
  const times = calls
    .map((c) => new Date(c.createdAt).getTime())
    .filter((t) => Number.isFinite(t))
  if (times.length < 2) return null
  const min = Math.min(...times)
  const max = Math.max(...times)
  const days = Math.max(1, Math.round((max - min) / (24 * 60 * 60 * 1000)) + 1)
  if (days < 7) return `${days} дн.`
  const weeks = Math.round(days / 7)
  if (weeks <= 8) return `${weeks} ${weeks === 1 ? 'неделя' : weeks < 5 ? 'недели' : 'недель'}`
  return null
}

export function CallsLeadPage() {
  const { code, leadId: leadIdParam } = useParams()
  const navigate = useNavigate()
  const projectCode = String(code ?? '').trim()
  const leadId = String(leadIdParam ?? '').trim()
  const callsBase = `/app/projects/${projectCode}/calls`

  const [lead, setLead] = useState<ProjectCallLeadPage | null>(null)
  const [calls, setCalls] = useState<ProjectCallListItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [amoBaseDomain, setAmoBaseDomain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectCallDetail | null>(null)
  const [detailPending, setDetailPending] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectCode || !leadId) return
    let cancelled = false
    setPending(true)
    void fetchProjectCallLead(projectCode, leadId)
      .then((data) => {
        if (cancelled) return
        setLead(data.lead)
        setCalls(data.calls)
        setTotal(data.total)
        setAmoBaseDomain(data.amoBaseDomain)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить сделку')
        setLead(null)
        setCalls([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectCode, leadId])

  useEffect(() => {
    if (!projectCode || !selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailPending(true)
    setDetail(null)
    void fetchProjectCall(projectCode, selectedId)
      .then((data) => {
        if (cancelled) return
        setDetail(data.call)
        if (data.amoBaseDomain) setAmoBaseDomain(data.amoBaseDomain)
        setDetailError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setDetailError(err instanceof Error ? err.message : 'Не удалось загрузить звонок')
      })
      .finally(() => {
        if (!cancelled) setDetailPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectCode, selectedId])

  const amoHref = amoLeadUrl(amoBaseDomain, leadId)
  const count = total || calls?.length || 0
  const span = calls ? spanLabel(calls) : null
  const guest = lead?.name?.trim() || null
  const followUpStatus = leadFollowUpStatus(calls)
  const metaParts = [
    guest ? `Имя: ${guest}` : null,
    count > 0 ? `${count} ${pluralCalls(count)}${span ? ` за ${span}` : ''}` : null,
  ].filter(Boolean)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
      <p className="text-muted-foreground shrink-0 text-xs">
        <Link to={callsBase} className="hover:text-foreground underline-offset-4 hover:underline">
          Звонки
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">Сделка {leadId || '—'}</span>
      </p>

      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="flex flex-wrap items-center gap-2 font-sans text-lg font-semibold tracking-tight">
            <span>Сделка {leadId || '—'}</span>
            {followUpStatus ? <CallFollowChip status={followUpStatus} /> : null}
          </h2>
          <p className="text-muted-foreground text-sm">
            {metaParts.length > 0
              ? metaParts.join(' · ')
              : pending
                ? 'Загрузка…'
                : 'Нет звонков по сделке'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(callsBase)}>
            К списку
          </Button>
          {amoHref ? (
            <Button variant="default" size="sm" render={<a href={amoHref} target="_blank" rel="noreferrer" />}>
              Открыть в Amo
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}

      <div className="bg-muted/40 flex shrink-0 flex-wrap items-center gap-2.5 rounded-lg border px-3.5 py-3">
        <span className="text-muted-foreground text-xs">Сейчас в amo</span>
        {lead?.currentStatusName ? (
          <CrmStageBadge
            statusName={lead.currentStatusName}
            statusType={lead.currentStatusType}
            statusId={lead.currentStatusId}
          />
        ) : pending ? (
          <span className="text-muted-foreground text-xs">…</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
        {lead?.updatedAt ? (
          <span className="text-muted-foreground text-xs">обновлено {formatDt(lead.updatedAt)}</span>
        ) : null}
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <h3 className="text-muted-foreground text-sm font-medium">Таймлайн звонков</h3>

        {calls === null || pending ? (
          <p className="text-muted-foreground text-sm">Загрузка…</p>
        ) : calls.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-8 text-sm">
            <PhoneIcon className="size-5 opacity-60" />
            <p>По этой сделке пока нет обработанных звонков.</p>
            <Button variant="outline" size="sm" render={<Link to={callsBase} />}>
              К списку звонков
            </Button>
          </div>
        ) : (
          <ol className="relative m-0 list-none space-y-0 p-0">
            {calls.map((call, index) => {
              const intent = intentLabel(call.insightsIntent)
              const decline = declineLabel(call.insightsDeclineReason)
              const duration = formatDuration(call.durationSec)
              const selected = selectedId === call.id
              return (
                <li key={call.id} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3">
                  <div className="relative flex justify-center">
                    <span
                      className="relative z-[1] mt-[18px] size-2.5 shrink-0 rounded-full border-2 border-blue-500 bg-background"
                      aria-hidden
                    />
                    {index < calls.length - 1 ? (
                      <span
                        className="bg-border absolute top-7 bottom-0 w-px"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(call.id)}
                    className={cn(
                      'mb-3 w-full rounded-[10px] border p-3.5 text-left transition-colors',
                      selected
                        ? 'border-blue-400/70 bg-slate-50 dark:border-blue-500/50 dark:bg-slate-900/50'
                        : 'bg-card hover:bg-muted/20 border-border',
                    )}
                  >
                    <div className="text-muted-foreground mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span>{formatDt(call.createdAt)}</span>
                      {duration ? (
                        <>
                          <span>·</span>
                          <span>{duration}</span>
                        </>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed">
                      {call.summaryOutcome ||
                        (call.status === 'failed'
                          ? friendlyCallErrorLabel(call.error)
                          : call.status === 'skipped'
                            ? 'Пропущен'
                            : '—')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {intent ? <CallIntentChip>{intent}</CallIntentChip> : null}
                      {decline ? (
                        <span className="text-muted-foreground text-xs">{decline}</span>
                      ) : null}
                      {call.followUpStatus === 'open' || call.followUpStatus === 'done' ? (
                        <CallFollowChip status={call.followUpStatus} />
                      ) : call.insightsNeedsFollowUp ? (
                        <CallFollowChip />
                      ) : null}
                      {call.statusName ? (
                        <span className="text-muted-foreground inline-flex flex-wrap items-center gap-1.5 text-xs">
                          на момент звонка:
                          <CrmStageBadge
                            statusName={call.statusName}
                            statusType={call.statusType}
                            statusId={call.statusId}
                          />
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>Звонок</SheetTitle>
            <SheetDescription>
              {detail ? formatDt(detail.createdAt) : detailPending ? 'Загрузка…' : '—'}
              {detail?.durationSec != null && formatDuration(detail.durationSec)
                ? ` · ${formatDuration(detail.durationSec)}`
                : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {detailError ? <p className="text-destructive text-sm">{detailError}</p> : null}
            {detailPending && !detail ? (
              <p className="text-muted-foreground text-sm">Загрузка…</p>
            ) : null}
            {detail ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {intentLabel(detail.insightsIntent) ? (
                    <CallIntentChip>{intentLabel(detail.insightsIntent)}</CallIntentChip>
                  ) : null}
                  {declineLabel(detail.insightsDeclineReason) ? (
                    <span className="text-muted-foreground text-xs">
                      {declineLabel(detail.insightsDeclineReason)}
                    </span>
                  ) : null}
                  {detail.followUpStatus === 'open' || detail.followUpStatus === 'done' ? (
                    <CallFollowChip status={detail.followUpStatus} />
                  ) : detail.insightsNeedsFollowUp ? (
                    <CallFollowChip />
                  ) : null}
                  {detail.recordingUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={detail.recordingUrl} target="_blank" rel="noreferrer" />}
                    >
                      Запись
                    </Button>
                  ) : null}
                </div>

                {(detail.summaryOutcome || detail.summaryNextStep) && (
                  <section className="space-y-2">
                    <h3 className="font-sans text-sm font-medium">Саммари</h3>
                    <div className="bg-muted/40 space-y-3 rounded-lg border p-3 text-sm leading-relaxed">
                      {detail.summaryOutcome ? (
                        <p>
                          <span className="text-muted-foreground">Итог: </span>
                          {detail.summaryOutcome}
                        </p>
                      ) : null}
                      {detail.summaryNextStep ? (
                        <p>
                          <span className="text-muted-foreground">Следующий шаг: </span>
                          {detail.summaryNextStep}
                        </p>
                      ) : null}
                    </div>
                  </section>
                )}

                {(detail.statusName || detail.currentStatusName) && (
                  <section className="space-y-2">
                    <h3 className="font-sans text-sm font-medium">Стадия</h3>
                    <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">На момент звонка:</span>
                        <CrmStageBadge
                          statusName={detail.statusName}
                          statusType={detail.statusType}
                          statusId={detail.statusId}
                        />
                      </p>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">Сейчас:</span>
                        <CrmStageBadge
                          statusName={detail.currentStatusName}
                          statusType={detail.currentStatusType}
                          statusId={detail.currentStatusId}
                        />
                      </p>
                    </div>
                  </section>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  render={
                    <Link
                      to={`${callsBase}?leadId=${encodeURIComponent(leadId)}`}
                    />
                  }
                >
                  Открыть в списке звонков
                </Button>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
