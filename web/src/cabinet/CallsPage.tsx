import { useEffect, useState } from 'react'
import { ExternalLinkIcon, PhoneIcon, Trash2Icon } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  deleteProjectCall,
  fetchProjectCall,
  fetchProjectCalls,
  type ProjectCallDetail,
  type ProjectCallListItem,
  type ProjectCallStatus,
} from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function statusLabel(status: ProjectCallStatus) {
  switch (status) {
    case 'done':
      return 'Готово'
    case 'pending':
      return 'В очереди'
    case 'running':
      return 'Обработка'
    case 'skipped':
      return 'Пропущен'
    case 'failed':
      return 'Ошибка'
    default:
      return status
  }
}

function statusVariant(status: ProjectCallStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'done') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'skipped') return 'outline'
  return 'secondary'
}

const PAGE_SIZE = 50

export function CallsPage() {
  const { code } = useParams()
  const projectCode = String(code ?? '').trim()
  const [statusFilter, setStatusFilter] = useState('')
  const [calls, setCalls] = useState<ProjectCallListItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [amoBaseDomain, setAmoBaseDomain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectCallDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailPending, setDetailPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    setPending(true)
    void fetchProjectCalls(projectCode, {
      limit: PAGE_SIZE,
      status: statusFilter || undefined,
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
        setError(err instanceof Error ? err.message : 'Не удалось загрузить звонки')
        setCalls([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectCode, statusFilter])

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

  async function handleDelete(callId: string) {
    if (!projectCode) return
    if (!window.confirm('Удалить эту запись из списка звонков?')) return
    setDeletingId(callId)
    try {
      await deleteProjectCall(projectCode, callId)
      setCalls((prev) => (prev ? prev.filter((item) => item.id !== callId) : prev))
      setTotal((n) => Math.max(0, n - 1))
      if (selectedId === callId) setSelectedId(null)
      toast.success('Запись удалена')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить')
    } finally {
      setDeletingId(null)
    }
  }

  const leadHref = detail ? amoLeadUrl(amoBaseDomain, detail.leadId) : null

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-lg font-semibold">Звонки</h2>
          <p className="text-muted-foreground text-sm">
            Авто-саммари и транскрипты из Amo. Нажмите строку, чтобы открыть детали.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-[160px]"
          >
            <NativeSelectOption value="">Все статусы</NativeSelectOption>
            <NativeSelectOption value="done">Готово</NativeSelectOption>
            <NativeSelectOption value="pending">В очереди</NativeSelectOption>
            <NativeSelectOption value="running">Обработка</NativeSelectOption>
            <NativeSelectOption value="skipped">Пропущен</NativeSelectOption>
            <NativeSelectOption value="failed">Ошибка</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {calls === null ? (
        <p className="text-muted-foreground text-sm">Загрузка…</p>
      ) : calls.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-8 text-sm">
          <PhoneIcon className="size-5 opacity-60" />
          <p>
            {pending
              ? 'Загрузка…'
              : statusFilter
                ? 'Нет звонков с таким статусом'
                : 'Пока нет обработанных звонков. Они появятся после звонка с записью.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Показано {calls.length}
            {total > calls.length ? ` из ${total}` : ''}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Длительность</TableHead>
                  <TableHead>Сделка</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="min-w-[220px]">Саммари</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const href = amoLeadUrl(amoBaseDomain, call.leadId)
                  return (
                    <TableRow
                      key={call.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(call.id)}
                    >
                      <TableCell className="whitespace-nowrap">{formatDt(call.createdAt)}</TableCell>
                      <TableCell>{formatDuration(call.durationSec)}</TableCell>
                      <TableCell>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary inline-flex items-center gap-1 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {call.leadId}
                            <ExternalLinkIcon className="size-3.5 opacity-70" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{call.leadId || '—'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(call.status)}>{statusLabel(call.status)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <span className="line-clamp-2 text-sm">
                          {call.summaryOutcome ||
                            (call.status === 'failed'
                              ? call.error || 'Ошибка'
                              : call.status === 'skipped'
                                ? call.skipReason || 'Пропущен'
                                : '—')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={deletingId === call.id}
                          aria-label="Удалить"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDelete(call.id)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>Звонок</SheetTitle>
            <SheetDescription>
              {detail ? formatDt(detail.createdAt) : detailPending ? 'Загрузка…' : '—'}
              {detail?.durationSec != null ? ` · ${formatDuration(detail.durationSec)}` : ''}
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
                  <Badge variant={statusVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
                  {leadHref ? (
                    <Button variant="outline" size="sm" render={<a href={leadHref} target="_blank" rel="noreferrer" />}>
                      Открыть в Amo
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deletingId === detail.id}
                    onClick={() => void handleDelete(detail.id)}
                  >
                    <Trash2Icon />
                    Удалить
                  </Button>
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

                {detail.status === 'failed' && detail.error ? (
                  <p className="text-destructive text-sm">{detail.error}</p>
                ) : null}
                {detail.status === 'skipped' && detail.skipReason ? (
                  <p className="text-muted-foreground text-sm">Причина: {detail.skipReason}</p>
                ) : null}

                <section className="space-y-2">
                  <h3 className="font-sans text-sm font-medium">Транскрипт</h3>
                  {detail.transcript?.trim() ? (
                    <pre className="bg-muted/30 max-h-[50vh] overflow-auto rounded-lg border p-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {detail.transcript.trim()}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground text-sm">Транскрипта пока нет.</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
