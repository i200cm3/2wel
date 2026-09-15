import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLinkIcon, PhoneIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
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
  reprocessProjectCall,
  type ProjectCallDetail,
  type ProjectCallListItem,
  type ProjectCallStatus,
} from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'

function canReprocessCall(status: ProjectCallStatus) {
  return status === 'failed' || status === 'skipped'
}

function applyCallPatch(
  prev: ProjectCallListItem,
  next: Pick<
    ProjectCallDetail,
    | 'status'
    | 'skipReason'
    | 'error'
    | 'summaryOutcome'
    | 'summaryNextStep'
    | 'operatorReviewMiss'
    | 'operatorReviewDetail'
    | 'updatedAt'
  >,
): ProjectCallListItem {
  return {
    ...prev,
    status: next.status,
    skipReason: next.skipReason,
    error: next.error,
    summaryOutcome: next.summaryOutcome,
    summaryNextStep: next.summaryNextStep,
    operatorReviewMiss: next.operatorReviewMiss,
    operatorReviewDetail: next.operatorReviewDetail,
    updatedAt: next.updatedAt,
  }
}

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

function skipReasonLabel(reason: string | null | undefined) {
  switch (String(reason ?? '').trim()) {
    case 'no_recording_url':
      return 'Нет записи (ждём Sipuni)'
    case 'recording_unavailable':
      return 'Запись недоступна'
    case 'unanswered':
      return 'Недозвон'
    case 'short_call':
      return 'Короткий звонок'
    case 'no_lead':
      return 'Нет сделки'
    case 'pipeline_not_allowed':
      return 'Вне воронки'
    default:
      return reason || 'Пропущен'
  }
}

function statusVariant(status: ProjectCallStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'done') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'skipped') return 'outline'
  return 'secondary'
}

/** Страницы вокруг текущей: 1 … 4 5 6 … N */
function pageNumbers(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages = new Set<number>([1, totalPages, current])
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i >= 1 && i <= totalPages) pages.add(i)
  }
  const sorted = [...pages].sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []
  for (let i = 0; i < sorted.length; i += 1) {
    const page = sorted[i]!
    if (i > 0 && page - sorted[i - 1]! > 1) result.push('ellipsis')
    result.push(page)
  }
  return result
}

/** Высота строки с line-clamp-2 саммари; заголовок таблицы ~40px. */
const ROW_HEIGHT_PX = 56
const TABLE_HEAD_PX = 40
const PAGE_SIZE_MIN = 5
const PAGE_SIZE_MAX = 25
const PAGE_SIZE_DEFAULT = 10

function pageSizeFromHeight(height: number) {
  const rows = Math.floor((height - TABLE_HEAD_PX) / ROW_HEIGHT_PX)
  return Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, rows || PAGE_SIZE_DEFAULT))
}

export function CallsPage() {
  const { code } = useParams()
  const projectCode = String(code ?? '').trim()
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [statusFilter, setStatusFilter] = useState('')
  const [leadIdInput, setLeadIdInput] = useState('')
  const [leadIdFilter, setLeadIdFilter] = useState('')
  const [page, setPage] = useState(1)
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
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = tableAreaRef.current
    if (!el) return
    const update = () => {
      const next = pageSizeFromHeight(el.clientHeight)
      setPageSize((prev) => (prev === next ? prev : next))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const trimmed = leadIdInput.trim()
    const timer = window.setTimeout(() => {
      setLeadIdFilter((prev) => (prev === trimmed ? prev : trimmed))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [leadIdInput])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, leadIdFilter])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1)
    if (page > maxPage) setPage(maxPage)
  }, [pageSize, total, page])

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    setPending(true)
    void fetchProjectCalls(projectCode, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: statusFilter || undefined,
      leadId: leadIdFilter || undefined,
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
  }, [projectCode, statusFilter, leadIdFilter, page, pageSize])

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

  async function handleReprocess(callId: string) {
    if (!projectCode) return
    setReprocessingId(callId)
    try {
      const data = await reprocessProjectCall(projectCode, callId)
      setCalls((prev) =>
        prev
          ? prev.map((item) => (item.id === callId ? applyCallPatch(item, data.call) : item))
          : prev,
      )
      if (selectedId === callId) {
        setDetail((prev) => (prev && prev.id === callId ? { ...prev, ...data.call } : prev))
      }
      toast.success('Анализ запущен')

      // Подтянуть финальный статус после фоновой обработки.
      void (async () => {
        for (const delayMs of [4000, 8000, 15000, 30000]) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          try {
            const refreshed = await fetchProjectCall(projectCode, callId)
            setCalls((prev) =>
              prev
                ? prev.map((item) =>
                    item.id === callId ? applyCallPatch(item, refreshed.call) : item,
                  )
                : prev,
            )
            if (selectedId === callId) {
              setDetail(refreshed.call)
              if (refreshed.amoBaseDomain) setAmoBaseDomain(refreshed.amoBaseDomain)
            }
            if (refreshed.call.status !== 'pending' && refreshed.call.status !== 'running') break
          } catch {
            break
          }
        }
      })()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось запустить анализ')
    } finally {
      setReprocessingId(null)
    }
  }

  const leadHref = detail ? amoLeadUrl(amoBaseDomain, detail.leadId) : null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showPagination = total > pageSize
  const hasFilters = Boolean(statusFilter || leadIdFilter)
  const emptyFilterMessage = leadIdFilter
    ? `Нет звонков по сделке ${leadIdFilter}`
    : statusFilter
      ? 'Нет звонков с таким статусом'
      : 'Пока нет обработанных звонков. Они появятся после звонка с записью.'

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-lg font-semibold">Звонки</h2>
          <p className="text-muted-foreground text-sm">
            Авто-саммари и транскрипты из Amo. Нажмите строку, чтобы открыть детали.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            inputMode="numeric"
            placeholder="Номер сделки"
            value={leadIdInput}
            onChange={(event) => setLeadIdInput(event.target.value)}
            className="w-[160px]"
            aria-label="Фильтр по номеру сделки"
          />
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

      {error ? <p className="text-destructive shrink-0 text-sm">{error}</p> : null}

      {calls !== null && calls.length > 0 ? (
        <p className="text-muted-foreground shrink-0 text-xs">
          {showPagination
            ? `Страница ${page} из ${totalPages} · ${total} звонков`
            : `Показано ${calls.length}${total > calls.length ? ` из ${total}` : ''}`}
          {hasFilters && !showPagination ? ' (фильтр)' : ''}
        </p>
      ) : null}

      <div ref={tableAreaRef} className="min-h-0 flex-1 overflow-hidden">
        {calls === null ? (
          <p className="text-muted-foreground text-sm">Загрузка…</p>
        ) : calls.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-8 text-sm">
            <PhoneIcon className="size-5 opacity-60" />
            <p>{pending ? 'Загрузка…' : emptyFilterMessage}</p>
          </div>
        ) : (
          <div className="h-full overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Длительность</TableHead>
                  <TableHead>Сделка</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="min-w-[220px]">Саммари</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const href = amoLeadUrl(amoBaseDomain, call.leadId)
                  const needsReview = Boolean(call.operatorReviewMiss || call.operatorReviewDetail)
                  return (
                    <TableRow
                      key={call.id}
                      className={
                        needsReview
                          ? 'cursor-pointer bg-destructive/5 hover:bg-destructive/10'
                          : 'cursor-pointer'
                      }
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusVariant(call.status)}>{statusLabel(call.status)}</Badge>
                          {needsReview ? (
                            <Badge variant="destructive">Разбор</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <div className="space-y-1">
                          <span className="line-clamp-2 text-sm">
                            {call.summaryOutcome ||
                              (call.status === 'failed'
                                ? call.error || 'Ошибка'
                                : call.status === 'skipped'
                                  ? skipReasonLabel(call.skipReason)
                                  : call.status === 'pending'
                                    ? 'Ждём запись / в очереди'
                                    : '—')}
                          </span>
                          {needsReview ? (
                            <span className="text-destructive line-clamp-2 text-xs font-medium">
                              {call.operatorReviewMiss || call.operatorReviewDetail}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-0.5">
                          {canReprocessCall(call.status) ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              disabled={reprocessingId === call.id || deletingId === call.id}
                              title="Запустить анализ"
                              aria-label="Запустить анализ"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleReprocess(call.id)
                              }}
                            >
                              <RefreshCwIcon
                                className={reprocessingId === call.id ? 'animate-spin' : undefined}
                              />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={deletingId === call.id || reprocessingId === call.id}
                            aria-label="Удалить"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(call.id)
                            }}
                          >
                            <Trash2Icon />
                          </Button>
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

      <div className="flex h-9 shrink-0 items-center justify-center">
        {showPagination ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={page <= 1 || pending}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                />
              </PaginationItem>
              {pageNumbers(page, totalPages).map((item, index) =>
                item === 'ellipsis' ? (
                  <PaginationItem key={`e-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      isActive={item === page}
                      disabled={pending}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  disabled={page >= totalPages || pending}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>

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
                  {canReprocessCall(detail.status) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={reprocessingId === detail.id || deletingId === detail.id}
                      onClick={() => void handleReprocess(detail.id)}
                    >
                      <RefreshCwIcon
                        className={reprocessingId === detail.id ? 'animate-spin' : undefined}
                      />
                      Анализ
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deletingId === detail.id || reprocessingId === detail.id}
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

                {(detail.operatorReviewMiss || detail.operatorReviewDetail) && (
                  <section className="space-y-2">
                    <h3 className="font-sans text-sm font-medium text-destructive">
                      Разбор оператора
                    </h3>
                    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed">
                      {detail.operatorReviewMiss ? (
                        <p className="font-medium text-destructive">{detail.operatorReviewMiss}</p>
                      ) : null}
                      {detail.operatorReviewDetail ? (
                        <p className="text-destructive/90">{detail.operatorReviewDetail}</p>
                      ) : null}
                    </div>
                  </section>
                )}

                {detail.status === 'failed' && detail.error ? (
                  <p className="text-destructive text-sm">{detail.error}</p>
                ) : null}
                {detail.status === 'skipped' && detail.skipReason ? (
                  <p className="text-muted-foreground text-sm">
                    Причина: {skipReasonLabel(detail.skipReason)}
                  </p>
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
