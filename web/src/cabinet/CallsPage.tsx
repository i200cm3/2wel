import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  Columns3Icon,
  ExternalLinkIcon,
  PhoneIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  declineLabel,
  INTENT_LABELS,
  intentLabel,
  sourceLabel,
  TOPIC_LABELS,
} from '@/cabinet/callInsightsLabels'
import { friendlyCallErrorLabel } from '@/cabinet/callErrorLabels'
import {
  CallFollowChip,
  CallIntentChip,
  CrmStageBadge,
  crmStageLabel,
} from '@/cabinet/CrmStageBadge'
import {
  deleteProjectCall,
  fetchProjectCall,
  fetchProjectCalls,
  reprocessProjectCall,
  type AmoPipeline,
  type ProjectCallDetail,
  type ProjectCallListItem,
  type ProjectCallStatus,
} from '@/lib/api'
import { amoLeadUrl } from '@/lib/amo'
import { cn } from '@/lib/utils'

function canReprocessCall(status: ProjectCallStatus) {
  return status !== 'pending' && status !== 'running'
}

type CallColumnId = 'date' | 'duration' | 'lead' | 'stage' | 'type' | 'summary' | 'actions'

const CALL_TABLE_COLUMNS: Array<{
  id: CallColumnId
  label: string
  sortKey?: string
  hideable?: boolean
}> = [
  { id: 'date', label: 'Дата', sortKey: 'created_at' },
  { id: 'duration', label: 'Длительность', sortKey: 'duration_sec' },
  { id: 'lead', label: 'Сделка', sortKey: 'lead_id' },
  { id: 'stage', label: 'Стадия', sortKey: 'status_id' },
  { id: 'type', label: 'Тип', sortKey: 'insights_intent' },
  { id: 'summary', label: 'Саммари', sortKey: 'summary_outcome' },
  { id: 'actions', label: 'Действия', hideable: false },
]

const COLUMNS_STORAGE_KEY = 'calls-table-columns-v1'

type ColumnVisibility = Record<CallColumnId, boolean>

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  date: true,
  duration: true,
  lead: true,
  stage: true,
  type: true,
  summary: true,
  actions: true,
}

function loadColumnVisibility(): ColumnVisibility {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_COLUMN_VISIBILITY }
    const parsed = JSON.parse(raw) as Partial<ColumnVisibility>
    return { ...DEFAULT_COLUMN_VISIBILITY, ...parsed, actions: true }
  } catch {
    return { ...DEFAULT_COLUMN_VISIBILITY }
  }
}

function SortableHead({
  label,
  active,
  dir,
  onSort,
  className,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onSort?: () => void
  className?: string
}) {
  if (!onSort) {
    return <TableHead className={className}>{label}</TableHead>
  }
  const Icon = !active ? ArrowUpDownIcon : dir === 'asc' ? ArrowUpIcon : ArrowDownIcon
  return (
    <TableHead className={className}>
      <button
        type="button"
        className={cn(
          'hover:text-foreground inline-flex items-center gap-1.5 font-medium',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
        onClick={onSort}
      >
        {label}
        <Icon className="size-3.5 opacity-70" />
      </button>
    </TableHead>
  )
}


function applyCallPatch(
  prev: ProjectCallListItem,
  next: ProjectCallDetail | ProjectCallListItem,
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
    insightsIntent: next.insightsIntent,
    insightsDeclineReason: next.insightsDeclineReason,
    insightsTopics: next.insightsTopics,
    insightsFacts: next.insightsFacts,
    insightsNeedsFollowUp: next.insightsNeedsFollowUp,
    insightsAt: next.insightsAt,
    pipelineId: next.pipelineId,
    statusId: next.statusId,
    pipelineName: next.pipelineName,
    statusName: next.statusName,
    statusType: next.statusType,
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
      return 'Не принят'
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
  const [searchParams] = useSearchParams()
  const projectCode = String(code ?? '').trim()
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [statusFilter, setStatusFilter] = useState('')
  const [intentFilter, setIntentFilter] = useState(() => searchParams.get('intent') || '')
  const [declineFilter, setDeclineFilter] = useState(() => searchParams.get('decline') || '')
  const [followFilter, setFollowFilter] = useState(() => searchParams.get('follow') === '1')
  const [reviewFilter, setReviewFilter] = useState(() => searchParams.get('review') === '1')
  const [followUpFilter, setFollowUpFilter] = useState(() => {
    const v = searchParams.get('followUp') || ''
    return v === 'open' || v === 'done' ? v : ''
  })
  const [warmFilter, setWarmFilter] = useState(() => searchParams.get('warm') === '1')
  const [daysFilter, setDaysFilter] = useState(() => {
    const n = Number(searchParams.get('days') || 0)
    return n > 0 ? n : 0
  })
  const [leadIdInput, setLeadIdInput] = useState('')
  const [leadIdFilter, setLeadIdFilter] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState(() => searchParams.get('pipelineId') || '')
  const [crmStatusFilter, setCrmStatusFilter] = useState(() => searchParams.get('statusId') || '')
  const [pipelines, setPipelines] = useState<AmoPipeline[]>([])
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(loadColumnVisibility)
  const [sortBy, setSortBy] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleColumn(id: CallColumnId, next: boolean) {
    setColumnVisibility((prev) => {
      const updated = { ...prev, [id]: next, actions: true }
      try {
        localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(updated))
      } catch {
        /* ignore */
      }
      return updated
    })
  }

  function toggleSort(sortKey: string) {
    setPage(1)
    if (sortBy === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(sortKey)
    setSortDir(sortKey === 'created_at' ? 'desc' : 'asc')
  }

  useEffect(() => {
    setIntentFilter(searchParams.get('intent') || '')
    setDeclineFilter(searchParams.get('decline') || '')
    setFollowFilter(searchParams.get('follow') === '1')
    setReviewFilter(searchParams.get('review') === '1')
    const followUp = searchParams.get('followUp') || ''
    setFollowUpFilter(followUp === 'open' || followUp === 'done' ? followUp : '')
    setWarmFilter(searchParams.get('warm') === '1')
    const days = Number(searchParams.get('days') || 0)
    setDaysFilter(days > 0 ? days : 0)
    const statusFromUrl = searchParams.get('status') || ''
    if (statusFromUrl) setStatusFilter(statusFromUrl)
    const leadFromUrl = searchParams.get('leadId') || ''
    if (leadFromUrl) {
      setLeadIdInput(leadFromUrl)
      setLeadIdFilter(leadFromUrl)
    }
    setPipelineFilter(searchParams.get('pipelineId') || '')
    setCrmStatusFilter(searchParams.get('statusId') || '')
  }, [searchParams])

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
  }, [
    statusFilter,
    leadIdFilter,
    intentFilter,
    declineFilter,
    followFilter,
    reviewFilter,
    followUpFilter,
    warmFilter,
    daysFilter,
    pipelineFilter,
    crmStatusFilter,
  ])

  useEffect(() => {
    // При смене воронки сбрасываем стадию, если она не из этой воронки.
    if (!crmStatusFilter || !pipelineFilter) return
    const pipe = pipelines.find((p) => p.id === pipelineFilter)
    if (!pipe) return
    if (!pipe.statuses.some((st) => st.id === crmStatusFilter)) {
      setCrmStatusFilter('')
    }
  }, [pipelineFilter, pipelines, crmStatusFilter])

  const statusOptions = useMemo(() => {
    if (pipelineFilter) {
      const pipe = pipelines.find((p) => p.id === pipelineFilter)
      return (pipe?.statuses || []).map((st) => ({
        id: st.id,
        label: st.name,
      }))
    }
    const out: Array<{ id: string; label: string }> = []
    for (const pipe of pipelines) {
      for (const st of pipe.statuses) {
        out.push({
          id: st.id,
          label: pipelines.length > 1 ? `${pipe.name} · ${st.name}` : st.name,
        })
      }
    }
    return out
  }, [pipelines, pipelineFilter])

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
      intent: intentFilter || undefined,
      declineReason: declineFilter || undefined,
      needsFollowUp: followFilter ? '1' : undefined,
      hasOperatorReview: reviewFilter ? '1' : undefined,
      followUpStatus: followUpFilter || undefined,
      warmLeads: warmFilter ? '1' : undefined,
      days: daysFilter > 0 ? daysFilter : undefined,
      pipelineId: pipelineFilter || undefined,
      statusId: crmStatusFilter || undefined,
      orderBy: sortBy || undefined,
      orderDir: sortDir,
    })
      .then((data) => {
        if (cancelled) return
        setCalls(data.calls)
        setTotal(data.total)
        setAmoBaseDomain(data.amoBaseDomain)
        if (data.pipelines?.length) setPipelines(data.pipelines)
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
  }, [
    projectCode,
    statusFilter,
    leadIdFilter,
    intentFilter,
    declineFilter,
    followFilter,
    reviewFilter,
    followUpFilter,
    warmFilter,
    daysFilter,
    pipelineFilter,
    crmStatusFilter,
    sortBy,
    sortDir,
    page,
    pageSize,
  ])

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
    if (
      !window.confirm(
        'Пересобрать транскрипт и саммари заново? Старые итог и разметка будут заменены.',
      )
    ) {
      return
    }
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
      toast.success('Пересборка запущена')

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
  const hasFilters = Boolean(
    statusFilter ||
      leadIdFilter ||
      intentFilter ||
      declineFilter ||
      followFilter ||
      reviewFilter ||
      followUpFilter ||
      warmFilter ||
      daysFilter ||
      pipelineFilter ||
      crmStatusFilter,
  )
  const emptyFilterMessage = leadIdFilter
    ? `Нет звонков по сделке ${leadIdFilter}`
    : hasFilters
      ? 'Нет звонков по выбранным фильтрам'
      : 'Пока нет обработанных звонков. Они появятся после звонка с записью.'

  const thenStage = detail ? crmStageLabel(detail.statusName) : null
  const nowStage = detail ? crmStageLabel(detail.currentStatusName) : null
  const stageChanged =
    Boolean(thenStage && nowStage) &&
    (detail?.pipelineId !== detail?.currentPipelineId ||
      detail?.statusId !== detail?.currentStatusId)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-lg font-semibold">Список звонков</h2>
          <p className="text-muted-foreground text-sm">
            Саммари, разбор и разметка. Нажмите строку, чтобы открыть детали.
          </p>
        </div>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
          <Input
            type="search"
            inputMode="numeric"
            placeholder="Номер сделки"
            value={leadIdInput}
            onChange={(event) => setLeadIdInput(event.target.value)}
            className="w-[160px] shrink-0"
            aria-label="Фильтр по номеру сделки"
          />
          <NativeSelect
            value={reviewFilter ? 'review' : intentFilter}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'review') {
                setReviewFilter(true)
                setIntentFilter('')
                setPage(1)
                return
              }
              setReviewFilter(false)
              setIntentFilter(value)
              setPage(1)
            }}
            className="w-[150px] shrink-0"
          >
            <NativeSelectOption value="">Все типы</NativeSelectOption>
            {Object.entries(INTENT_LABELS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="review">С разбором</NativeSelectOption>
          </NativeSelect>
          {pipelines.length > 0 ? (
            <>
              <NativeSelect
                value={pipelineFilter}
                onChange={(event) => setPipelineFilter(event.target.value)}
                className="w-[170px] shrink-0"
              >
                <NativeSelectOption value="">Все воронки</NativeSelectOption>
                {pipelines.map((pipe) => (
                  <NativeSelectOption key={pipe.id} value={pipe.id}>
                    {pipe.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                value={crmStatusFilter}
                onChange={(event) => setCrmStatusFilter(event.target.value)}
                className="w-[180px] shrink-0"
              >
                <NativeSelectOption value="">Все стадии</NativeSelectOption>
                {statusOptions.map((opt) => (
                  <NativeSelectOption key={opt.id} value={opt.id}>
                    {opt.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          ) : null}
          <NativeSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-[160px] shrink-0"
          >
            <NativeSelectOption value="">Все (без очереди)</NativeSelectOption>
            <NativeSelectOption value="done">Готово</NativeSelectOption>
            <NativeSelectOption value="pending">В очереди</NativeSelectOption>
            <NativeSelectOption value="running">Обработка</NativeSelectOption>
            <NativeSelectOption value="skipped">Пропущен</NativeSelectOption>
            <NativeSelectOption value="failed">Ошибка</NativeSelectOption>
          </NativeSelect>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" />
              }
            >
              <Columns3Icon className="size-4" />
              Колонки
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Показать колонки</DropdownMenuLabel>
                {CALL_TABLE_COLUMNS.filter((col) => col.hideable !== false).map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={columnVisibility[col.id]}
                    onCheckedChange={(checked) => toggleColumn(col.id, Boolean(checked))}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {hasFilters ? (
        <div className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-2 text-xs">
          {intentFilter ? <span>Тип: {intentLabel(intentFilter)}</span> : null}
          {pipelineFilter ? (
            <span>
              Воронка:{' '}
              {pipelines.find((p) => p.id === pipelineFilter)?.name || pipelineFilter}
            </span>
          ) : null}
          {crmStatusFilter ? (
            <span>
              Стадия:{' '}
              {statusOptions.find((s) => s.id === crmStatusFilter)?.label || crmStatusFilter}
            </span>
          ) : null}
          {declineFilter ? <span>Отказ: {declineLabel(declineFilter)}</span> : null}
          {followFilter ? <span>Нужен контакт</span> : null}
          {followUpFilter === 'open' ? <span>Дожать: открыто</span> : null}
          {followUpFilter === 'done' ? <span>Дожать: сделано</span> : null}
          {reviewFilter ? <span>С разбором</span> : null}
          {warmFilter ? <span>Звонки тёплых сделок</span> : null}
          {daysFilter > 0 ? <span>Период: {daysFilter} дн.</span> : null}
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => {
              setIntentFilter('')
              setDeclineFilter('')
              setFollowFilter(false)
              setFollowUpFilter('')
              setReviewFilter(false)
              setWarmFilter(false)
              setDaysFilter(0)
              setStatusFilter('')
              setLeadIdInput('')
              setLeadIdFilter('')
              setPipelineFilter('')
              setCrmStatusFilter('')
            }}
          >
            Сбросить
          </button>
        </div>
      ) : null}

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
                  {columnVisibility.date ? (
                    <SortableHead
                      label="Дата"
                      active={sortBy === 'created_at'}
                      dir={sortDir}
                      onSort={() => toggleSort('created_at')}
                    />
                  ) : null}
                  {columnVisibility.duration ? (
                    <SortableHead
                      label="Длительность"
                      active={sortBy === 'duration_sec'}
                      dir={sortDir}
                      onSort={() => toggleSort('duration_sec')}
                    />
                  ) : null}
                  {columnVisibility.lead ? (
                    <SortableHead
                      label="Сделка"
                      active={sortBy === 'lead_id'}
                      dir={sortDir}
                      onSort={() => toggleSort('lead_id')}
                    />
                  ) : null}
                  {columnVisibility.stage ? (
                    <SortableHead
                      label="Стадия"
                      active={sortBy === 'status_id'}
                      dir={sortDir}
                      onSort={() => toggleSort('status_id')}
                    />
                  ) : null}
                  {columnVisibility.type ? (
                    <SortableHead
                      label="Тип"
                      active={sortBy === 'insights_intent'}
                      dir={sortDir}
                      onSort={() => toggleSort('insights_intent')}
                    />
                  ) : null}
                  {columnVisibility.summary ? (
                    <SortableHead
                      label="Саммари"
                      active={sortBy === 'summary_outcome'}
                      dir={sortDir}
                      onSort={() => toggleSort('summary_outcome')}
                      className="min-w-[220px]"
                    />
                  ) : null}
                  {columnVisibility.actions ? <TableHead className="w-20" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const href = amoLeadUrl(amoBaseDomain, call.leadId)
                  const needsReview = Boolean(call.operatorReviewMiss || call.operatorReviewDetail)
                  const intent = intentLabel(call.insightsIntent)
                  const decline = declineLabel(call.insightsDeclineReason)
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
                      {columnVisibility.date ? (
                        <TableCell className="whitespace-nowrap">{formatDt(call.createdAt)}</TableCell>
                      ) : null}
                      {columnVisibility.duration ? (
                        <TableCell>{formatDuration(call.durationSec)}</TableCell>
                      ) : null}
                      {columnVisibility.lead ? (
                        <TableCell>
                          {call.leadId && call.leadId !== '0' ? (
                            <div className="flex flex-col gap-0.5">
                              <Link
                                to={`/app/projects/${projectCode}/calls/leads/${encodeURIComponent(call.leadId)}`}
                                className="text-primary inline-flex items-center gap-1 hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {call.leadId}
                              </Link>
                              {href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Amo
                                  <ExternalLinkIcon className="size-3 opacity-70" />
                                </a>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ) : null}
                      {columnVisibility.stage ? (
                        <TableCell className="max-w-[200px] whitespace-normal">
                          <CrmStageBadge
                            statusName={call.statusName}
                            statusType={call.statusType}
                            statusId={call.statusId}
                          />
                        </TableCell>
                      ) : null}
                      {columnVisibility.type ? (
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {intent ? (
                              <CallIntentChip>{intent}</CallIntentChip>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {decline ? (
                              <span className="text-muted-foreground text-xs">{decline}</span>
                            ) : null}
                            {call.insightsNeedsFollowUp ? <CallFollowChip /> : null}
                            {needsReview ? <Badge variant="destructive">Разбор</Badge> : null}
                          </div>
                        </TableCell>
                      ) : null}
                      {columnVisibility.summary ? (
                        <TableCell className="max-w-md whitespace-normal">
                          <div className="space-y-1">
                            <span className="line-clamp-2 text-sm">
                              {call.summaryOutcome ||
                                (call.status === 'failed'
                                  ? friendlyCallErrorLabel(call.error)
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
                      ) : null}
                      {columnVisibility.actions ? (
                        <TableCell className="text-right">
                          <div className="inline-flex items-center justify-end gap-0.5">
                            {canReprocessCall(call.status) ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                disabled={reprocessingId === call.id || deletingId === call.id}
                                title="Пересобрать транскрипт и саммари"
                                aria-label="Пересобрать транскрипт и саммари"
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
                      ) : null}
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
                  {intentLabel(detail.insightsIntent) ? (
                    <CallIntentChip>{intentLabel(detail.insightsIntent)}</CallIntentChip>
                  ) : null}
                  {declineLabel(detail.insightsDeclineReason) ? (
                    <span className="text-muted-foreground text-xs">
                      {declineLabel(detail.insightsDeclineReason)}
                    </span>
                  ) : null}
                  {detail.insightsNeedsFollowUp ? <CallFollowChip /> : null}
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
                      Саммари заново
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

                {(thenStage || nowStage || detail.leadId) && (
                  <section className="space-y-2">
                    <h3 className="font-sans text-sm font-medium">Сделка в amo</h3>
                    <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm leading-relaxed">
                      {detail.leadId && detail.leadId !== '0' ? (
                        <p>
                          <span className="text-muted-foreground">ID: </span>
                          <Link
                            to={`/app/projects/${projectCode}/calls/leads/${encodeURIComponent(detail.leadId)}`}
                            className="text-primary hover:underline"
                          >
                            {detail.leadId}
                          </Link>
                          {leadHref ? (
                            <>
                              {' · '}
                              <a
                                href={leadHref}
                                target="_blank"
                                rel="noreferrer"
                                className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                              >
                                Amo
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">На момент звонка: </span>
                        {thenStage ? (
                          <CrmStageBadge
                            statusName={detail.statusName}
                            statusType={detail.statusType}
                            statusId={detail.statusId}
                          />
                        ) : (
                          '—'
                        )}
                      </p>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">Сейчас: </span>
                        {nowStage ? (
                          <CrmStageBadge
                            statusName={detail.currentStatusName}
                            statusType={detail.currentStatusType}
                            statusId={detail.currentStatusId}
                          />
                        ) : (
                          '—'
                        )}
                        {stageChanged ? (
                          <span className="text-muted-foreground text-xs">(изменилась)</span>
                        ) : null}
                      </p>
                    </div>
                  </section>
                )}

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

                {(detail.insightsIntent ||
                  detail.insightsDeclineReason ||
                  detail.insightsNeedsFollowUp ||
                  (detail.insightsFacts &&
                    Object.values(detail.insightsFacts).some((v) => v != null && v !== '')) ||
                  (detail.insightsTopics && detail.insightsTopics.length > 0)) && (
                  <section className="space-y-2">
                    <h3 className="font-sans text-sm font-medium">Разметка</h3>
                    <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm leading-relaxed">
                      {detail.insightsIntent ? (
                        <p>
                          <span className="text-muted-foreground">Тип: </span>
                          {intentLabel(detail.insightsIntent)}
                        </p>
                      ) : null}
                      {detail.insightsDeclineReason ? (
                        <p>
                          <span className="text-muted-foreground">Отказ: </span>
                          {declineLabel(detail.insightsDeclineReason)}
                        </p>
                      ) : null}
                      {detail.insightsNeedsFollowUp ? (
                        <p>
                          <span className="text-muted-foreground">Дожать: </span>
                          да
                        </p>
                      ) : null}
                      {detail.insightsFacts?.checkIn || detail.insightsFacts?.checkOut ? (
                        <p>
                          <span className="text-muted-foreground">Даты: </span>
                          {[detail.insightsFacts.checkIn, detail.insightsFacts.checkOut]
                            .filter(Boolean)
                            .join(' → ')}
                        </p>
                      ) : null}
                      {detail.insightsFacts?.guests != null ? (
                        <p>
                          <span className="text-muted-foreground">Гостей: </span>
                          {detail.insightsFacts.guests}
                        </p>
                      ) : null}
                      {detail.insightsFacts?.roomCategory ? (
                        <p>
                          <span className="text-muted-foreground">Номер: </span>
                          {detail.insightsFacts.roomCategory}
                        </p>
                      ) : null}
                      {detail.insightsFacts?.treatment ? (
                        <p>
                          <span className="text-muted-foreground">Лечение: </span>
                          {detail.insightsFacts.treatment}
                        </p>
                      ) : null}
                      {detail.insightsFacts?.budgetMax != null ? (
                        <p>
                          <span className="text-muted-foreground">Бюджет до: </span>
                          {detail.insightsFacts.budgetMax.toLocaleString('ru-RU')} ₽
                        </p>
                      ) : null}
                      {detail.insightsFacts?.source ? (
                        <p>
                          <span className="text-muted-foreground">Канал: </span>
                          {sourceLabel(detail.insightsFacts.source) ||
                            detail.insightsFacts.source}
                        </p>
                      ) : null}
                      {detail.insightsTopics && detail.insightsTopics.length > 0 ? (
                        <p>
                          <span className="text-muted-foreground">Темы: </span>
                          {detail.insightsTopics
                            .map((item) => {
                              const name = TOPIC_LABELS[item.topic] || item.topic
                              const detailLabel = item.label ? `: ${item.label}` : ''
                              const closed = item.addressed ? '' : ' (не закрыто)'
                              return `${name}${detailLabel}${closed}`
                            })
                            .join(', ')}
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
                  <p className="text-destructive text-sm">{friendlyCallErrorLabel(detail.error)}</p>
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
