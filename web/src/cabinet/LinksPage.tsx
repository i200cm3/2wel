import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { ChevronDownIcon, CopyIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { LinkAmoCallItem } from '@/cabinet/LinkAmoCallItem'
import {
  amoCallRecordingProbeTargets,
  callNeedsRecordingProbe,
  recordingAvailabilityFromSources,
  runRecordingProbe,
  sourceRecordingAvailability,
  type RecordingAvailability,
} from '@/cabinet/linkCallRecordingProbe'
import { LinkRawSourceDraft, LinkRawSourceItem, type RawSourcePayload } from '@/cabinet/LinkRawSourceItem'
import { isAmoCallHiddenFromMainList, isAmoCallSourceRef, isManualNonTargetSource } from '@/cabinet/linkRawSourceKinds'
import { LinkAnalyticsCharts } from '@/components/link-analytics-charts'
import { LinkAssemblyBlockItem } from '@/components/link-assembly-block-item'
import { Combobox } from '@/components/Combobox'
import { PlanUsageBanner } from '@/components/plan-usage'
import { SingleTagCombobox, TagsCombobox } from '@/components/TagsCombobox'
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ItemGroup } from '@/components/ui/item'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  addProjectLinkRawSource,
  createProjectLink,
  deleteProjectLink,
  deleteProjectLinkRawSource,
  extractProjectLinkSummary,
  fetchAmoConnection,
  fetchLinks,
  fetchProjectLink,
  fetchProjectLinkStats,
  fetchTemplateConfig,
  fetchTemplates,
  reassembleProjectLink,
  syncProjectLinkAmoCalls,
  transcribeProjectLinkRawSource,
  updateProjectLinkRawSource,
  type AssemblyTraceEntry,
  type LinkRawSource,
  type LinkStats,
  type ProjectLink,
  type ProjectLinkDetail,
  type Template,
} from '@/lib/api'
import {
  AUDIENCE_TAG_OPTIONS,
  OBJECTION_TAG_OPTIONS,
  ROOM_TAG_OPTIONS,
  TOPIC_TAG_OPTIONS,
  tagOptionsFromValues,
  type TagOption,
} from '@/lib/blockMetaTags'
import { isPropertyConfig } from '@/hooks/usePropertyConfig'
import { amoLeadUrl, emailFromDemoExternalId, isMarketingDemoExternalId } from '@/lib/amo'
import { guestShareUrl } from '@/lib/utils'
import { defaultBlockMeta, normalizeProperty, type PropertyConfig } from '@/types/story'
import { formatRangeLabel } from '@/lib/statsRange'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function AmoLeadLink({
  leadId,
  baseDomain,
  onClick,
}: {
  leadId: string
  baseDomain: string | null
  onClick?: (event: MouseEvent) => void
}) {
  const href = amoLeadUrl(baseDomain, leadId)
  if (!href) {
    return <code className="text-xs">{leadId}</code>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary text-xs underline-offset-4 hover:underline"
      title="Открыть сделку в amo"
      onClick={onClick}
    >
      {leadId}
    </a>
  )
}

/** CRM id сделки или email демо с лендинга (`demo:…`). */
function ExternalRefCell({
  externalId,
  baseDomain,
  onClick,
}: {
  externalId: string
  baseDomain: string | null
  onClick?: (event: MouseEvent) => void
}) {
  const demoEmail = emailFromDemoExternalId(externalId)
  if (demoEmail) {
    return (
      <a
        href={`mailto:${demoEmail}`}
        className="text-primary block truncate text-xs underline-offset-4 hover:underline"
        title="Почта демо с лендинга"
        onClick={onClick}
      >
        {demoEmail}
      </a>
    )
  }
  return <AmoLeadLink leadId={externalId} baseDomain={baseDomain} onClick={onClick} />
}

function formatDt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

function LinkRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4">
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  )
}

function parseSummaryCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function summaryTagsLabel(value: string, catalog: TagOption[]): string {
  return tagOptionsFromValues(parseSummaryCsv(value), catalog)
    .map((item) => item.label)
    .join(', ')
}

function fillRemainingLabel(value?: string | null): string {
  const raw = String(value ?? 'off').trim().toLowerCase()
  if (raw === 'soft') return 'Мягкий'
  if (raw === 'aggressive') return 'До лимита'
  return 'Выкл'
}


type LinkDetailTab = 'overview' | 'dialogs' | 'assembly'

type SummaryDraft = {
  guestName: string
  dates: string
  partyType: string
  room: string
  topics: string
  objections: string
  confidence: string
  fillRemaining: 'off' | 'soft' | 'aggressive'
}

function emptySummaryDraft(): SummaryDraft {
  return {
    guestName: '',
    dates: '',
    partyType: '',
    room: '',
    topics: '',
    objections: '',
    confidence: '0.8',
    fillRemaining: 'off',
  }
}

function orderedIncludedBlocks(detail: ProjectLinkDetail): AssemblyTraceEntry[] {
  const trace = detail.assemblyTrace ?? []
  const included = trace.filter((item) => item.included)
  const flow = detail.derivedFlow
  if (!flow?.length) return included
  const byId = new Map(included.map((item) => [item.id, item]))
  const ordered: AssemblyTraceEntry[] = []
  for (const id of flow) {
    const hit = byId.get(id)
    if (hit) {
      ordered.push(hit)
      byId.delete(id)
    } else {
      ordered.push({
        id,
        label: id,
        included: true,
        score: 0,
        reason: 'в derived_flow',
        placement: 'flow',
      })
    }
  }
  for (const rest of byId.values()) ordered.push(rest)
  return ordered
}

export function LinksPage() {
  const { code } = useParams()
  const { project } = useOutletContext<CabinetOutlet>()
  const [links, setLinks] = useState<ProjectLink[] | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)
  const [amoBaseDomain, setAmoBaseDomain] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [externalId, setExternalId] = useState('')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectLinkDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [rawPending, setRawPending] = useState(false)
  const [amoSyncPending, setAmoSyncPending] = useState(false)
  const [deletingRawSourceId, setDeletingRawSourceId] = useState<string | null>(null)
  const [reassemblePending, setReassemblePending] = useState(false)
  const [extractPending, setExtractPending] = useState(false)
  const [extractModel, setExtractModel] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraft>(emptySummaryDraft)
  const [detailTab, setDetailTab] = useState<LinkDetailTab>('overview')
  const [linkStats, setLinkStats] = useState<LinkStats | null>(null)
  const [linkStatsLoading, setLinkStatsLoading] = useState(false)
  const [linkTemplateConfig, setLinkTemplateConfig] = useState<PropertyConfig | null>(null)
  const [recordingAvailability, setRecordingAvailability] = useState<
    Record<string, RecordingAvailability>
  >({})
  const [probingCalls, setProbingCalls] = useState(false)
  const probeCancelRef = useRef(false)
  const probeSessionRef = useRef(0)
  const detailRef = useRef(detail)
  detailRef.current = detail
  const [showUnavailableAmoCalls, setShowUnavailableAmoCalls] = useState(false)

  const reload = (projectCode: string) => fetchLinks(projectCode).then((data) => setLinks(data.links))

  const saveNewRawSource = async (payload: RawSourcePayload) => {
    if (!code || !detail) return
    setRawPending(true)
    try {
      const data = await addProjectLinkRawSource(code, detail.publicId, payload)
      setDetail((prev) => (prev ? { ...prev, rawSources: [data.source, ...prev.rawSources] } : prev))
      toast.success(
        payload.audioUrl && !payload.body && payload.kind !== 'call_transcript'
          ? 'Звонок транскрибирован и сохранён'
          : payload.audioUrl && payload.kind === 'call_transcript' && !payload.body
            ? 'Запись звонка сохранена'
            : 'Запись сохранена',
      )
      await reload(code)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
      throw err
    } finally {
      setRawPending(false)
    }
  }

  const saveExistingRawSource = async (sourceId: string, payload: RawSourcePayload) => {
    if (!code || !detail) return
    const text = payload.body?.trim()
    if (!text) return
    setRawPending(true)
    try {
      const data = await updateProjectLinkRawSource(code, detail.publicId, sourceId, {
        body: text,
        kind: payload.kind,
        title: payload.title,
      })
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              rawSources: prev.rawSources.map((item) =>
                item.id === data.source.id ? data.source : item,
              ),
            }
          : prev,
      )
      toast.success('Запись обновлена')
      await reload(code)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
      throw err
    } finally {
      setRawPending(false)
    }
  }

  const removeRawSource = async (source: LinkRawSource) => {
    if (!code || !detail) return
    if (!window.confirm('Удалить эту запись?')) return
    setDeletingRawSourceId(source.id)
    try {
      await deleteProjectLinkRawSource(code, detail.publicId, source.id)
      setDetail((prev) =>
        prev ? { ...prev, rawSources: prev.rawSources.filter((item) => item.id !== source.id) } : prev,
      )
      toast.success('Запись удалена')
      await reload(code)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить')
      throw err
    } finally {
      setDeletingRawSourceId(null)
    }
  }

  const setRawSourceNonTarget = async (source: LinkRawSource, nonTarget: boolean) => {
    if (!code || !detail) return
    try {
      const data = await updateProjectLinkRawSource(code, detail.publicId, source.id, { nonTarget })
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              rawSources: prev.rawSources.map((item) =>
                item.id === data.source.id ? data.source : item,
              ),
            }
          : prev,
      )
      toast.success(nonTarget ? 'Помечен как нецелевой' : 'Вернули в целевые')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить')
      throw err
    }
  }

  useEffect(() => {
    if (!code) return
    let cancelled = false
    void Promise.all([fetchLinks(code), fetchTemplates(code), fetchAmoConnection(code)])
      .then(([linkData, tplData, amo]) => {
        if (cancelled) return
        setLinks(linkData.links)
        setTemplates(tplData.templates)
        setAmoBaseDomain(amo.connected ? amo.baseDomain : null)
        const published = tplData.templates.filter((item) => item.status === 'published')
        const def =
          published.find((item) => item.isDefault) ??
          published[0] ??
          tplData.templates.find((item) => item.isDefault) ??
          tplData.templates[0]
        if (def) setCategory(def.code)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  useEffect(() => {
    if (!code || !selectedPublicId) {
      setDetail(null)
      setDetailError(null)
      setLinkStats(null)
      setLinkTemplateConfig(null)
      setRecordingAvailability({})
      setProbingCalls(false)
      setShowUnavailableAmoCalls(false)
      setExtractModel(null)
      probeCancelRef.current = true
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void fetchProjectLink(code, selectedPublicId)
      .then((data) => {
        if (cancelled) return
        setDetail(data.link)
        const s = data.link.guestSummary
        const fillRaw = String(s?.fillRemaining ?? 'off').toLowerCase()
        setSummaryDraft({
          guestName: String(s?.guestName ?? data.link.guestName ?? ''),
          dates: String(s?.dates ?? ''),
          partyType: String(s?.partyType ?? ''),
          room: String(s?.room ?? ''),
          topics: String(s?.topics ?? ''),
          objections: String(s?.objections ?? ''),
          confidence: String(s?.confidence ?? '0.8'),
          fillRemaining: fillRaw === 'soft' || fillRaw === 'aggressive' ? fillRaw : 'off',
        })
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : 'Не удалось загрузить')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, selectedPublicId])

  useEffect(() => {
    if (!code || !selectedPublicId) {
      setLinkStats(null)
      return
    }
    let cancelled = false
    setLinkStatsLoading(true)
    void fetchProjectLinkStats(code, selectedPublicId)
      .then((data) => {
        if (!cancelled) setLinkStats(data.stats)
      })
      .catch(() => {
        if (!cancelled) setLinkStats(null)
      })
      .finally(() => {
        if (!cancelled) setLinkStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, selectedPublicId])

  useEffect(() => {
    if (!code || !detail?.templateCode) {
      setLinkTemplateConfig(null)
      return
    }
    let cancelled = false
    void fetchTemplateConfig(code, detail.templateCode)
      .then((data) => {
        if (cancelled) return
        const raw = data.config ?? data.draft
        setLinkTemplateConfig(isPropertyConfig(raw) ? normalizeProperty(raw) : null)
      })
      .catch(() => {
        if (!cancelled) setLinkTemplateConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, detail?.templateCode])

  const linkStatsPeriodLabel = useMemo(() => {
    if (!linkStats?.range) return ''
    return formatRangeLabel(linkStats.range.from, linkStats.range.to)
  }, [linkStats?.range])

  const filtered = useMemo(() => {
    if (!links) return []
    const q = query.trim().toLowerCase()
    if (!q) return links
    return links.filter((link) => {
      const demoEmail = emailFromDemoExternalId(link.externalId)
      const hay = `${link.guestName} ${link.externalId ?? ''} ${demoEmail ?? ''} ${link.templateName} ${link.templateCode} ${link.publicId} ${link.summaryPreview?.dates ?? ''} ${link.summaryPreview?.topics ?? ''}`
      return hay.toLowerCase().includes(q)
    })
  }, [links, query])

  const includedBlocks = useMemo(
    () => (detail ? orderedIncludedBlocks(detail) : []),
    [detail],
  )

  const amoCallSources = useMemo(() => {
    if (!detail) return []
    return detail.rawSources
      .filter((item) => isAmoCallSourceRef(item.externalRef))
      .sort((a, b) => {
        const aAt = new Date(a.capturedAt ?? a.createdAt).getTime()
        const bAt = new Date(b.capturedAt ?? b.createdAt).getTime()
        return bAt - aAt
      })
  }, [detail])

  const unavailableAmoCallCount = useMemo(
    () =>
      amoCallSources.filter((source) => isAmoCallHiddenFromMainList(source, recordingAvailability)).length,
    [amoCallSources, recordingAvailability],
  )

  const visibleAmoCallSources = useMemo(() => {
    if (showUnavailableAmoCalls) return amoCallSources
    return amoCallSources.filter((source) => !isAmoCallHiddenFromMainList(source, recordingAvailability))
  }, [amoCallSources, recordingAvailability, showUnavailableAmoCalls])

  const manualRawSources = useMemo(
    () => (detail ? detail.rawSources.filter((item) => !isAmoCallSourceRef(item.externalRef)) : []),
    [detail],
  )

  const visibleManualRawSources = useMemo(() => {
    if (showUnavailableAmoCalls) return manualRawSources
    return manualRawSources.filter((source) => !isManualNonTargetSource(source))
  }, [manualRawSources, showUnavailableAmoCalls])

  const hiddenManualRawCount = useMemo(
    () => manualRawSources.filter((source) => isManualNonTargetSource(source)).length,
    [manualRawSources],
  )

  const startRecordingProbe = useCallback(
    async (
      targets: LinkRawSource[],
      { force = false }: { force?: boolean } = {},
    ) => {
      const link = detailRef.current
      if (!code || !link || targets.length === 0) return

      const pendingTargets = force ? targets : targets.filter((source) => callNeedsRecordingProbe(source))
      if (!pendingTargets.length) return

      probeCancelRef.current = false
      const session = ++probeSessionRef.current
      setProbingCalls(true)

      try {
        const result = await runRecordingProbe({
          projectCode: code,
          publicId: link.publicId,
          targets: pendingTargets,
          shouldCancel: () => probeCancelRef.current || probeSessionRef.current !== session,
          onProgress: () => {},
          onResult: (sourceId, availability) => {
            if (probeSessionRef.current !== session) return
            setRecordingAvailability((prev) => {
              if (!availability) {
                const next = { ...prev }
                delete next[sourceId]
                return next
              }
              return { ...prev, [sourceId]: availability }
            })
          },
        })

        if (probeSessionRef.current !== session || result.cancelled) return

        const refreshed = await fetchProjectLink(code, link.publicId)
        if (probeSessionRef.current !== session) return
        detailRef.current = refreshed.link
        setDetail(refreshed.link)
        setRecordingAvailability((prev) => {
          const fromMeta = recordingAvailabilityFromSources(
            amoCallRecordingProbeTargets(refreshed.link.rawSources),
          )
          const next = { ...prev, ...fromMeta }
          for (const [id, value] of Object.entries(next)) {
            if (value === 'pending') delete next[id]
          }
          return next
        })

        if (result.unavailable > 0) {
          toast.message(`${result.unavailable} ${recordingsUnavailableLabel(result.unavailable)}`)
        }
      } catch (err) {
        if (probeSessionRef.current === session) {
          toast.error(err instanceof Error ? err.message : 'Не удалось проверить записи')
        }
      } finally {
        if (probeSessionRef.current === session) {
          setProbingCalls(false)
        }
      }
    },
    [code],
  )

  useEffect(() => {
    if (!detail) {
      setRecordingAvailability({})
      return
    }

    const targets = amoCallRecordingProbeTargets(detail.rawSources)
    setRecordingAvailability(recordingAvailabilityFromSources(targets))

    const needsProbe = targets.filter((source) => callNeedsRecordingProbe(source))
    if (needsProbe.length) {
      void startRecordingProbe(needsProbe)
    }

    return () => {
      probeCancelRef.current = true
    }
  }, [detail?.publicId, startRecordingProbe])

  const assemblyJson = useMemo(() => {
    if (!detail) return null
    return {
      guestSummary: detail.guestSummary,
      derivedFlow: detail.derivedFlow,
      assemblyTrace: detail.assemblyTrace,
      summaryMeta: detail.summaryMeta,
    }
  }, [detail])

  const handleReassemble = () => {
    if (!code || !detail) return
    setReassemblePending(true)
    void reassembleProjectLink(code, detail.publicId, {
      name: summaryDraft.guestName || detail.guestName,
      summary: {
        dates: summaryDraft.dates,
        partyType: summaryDraft.partyType,
        room: summaryDraft.room,
        topics: summaryDraft.topics,
        objections: summaryDraft.objections,
        confidence: summaryDraft.confidence,
        fillRemaining: summaryDraft.fillRemaining,
      },
      summaryMeta: {
        source: extractModel ? 'llm' : 'manual',
        extractedAt: new Date().toISOString(),
        ...(extractModel ? { model: extractModel, prompt: 'guest-summary-extract' } : {}),
      },
    })
      .then((data) => {
        setDetail(data.link)
        toast.success('Презентация пересобрана')
        return reload(code)
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Не удалось пересобрать'),
      )
      .finally(() => setReassemblePending(false))
  }

  const handleExtractSummary = () => {
    if (!code || !detail) return
    setExtractPending(true)
    void extractProjectLinkSummary(code, detail.publicId)
      .then((data) => {
        const fillRaw = String(data.summary.fillRemaining ?? 'off').toLowerCase()
        setSummaryDraft({
          guestName: String(data.summary.guestName ?? ''),
          dates: String(data.summary.dates ?? ''),
          partyType: String(data.summary.partyType ?? ''),
          room: String(data.summary.room ?? ''),
          topics: String(data.summary.topics ?? ''),
          objections: String(data.summary.objections ?? ''),
          confidence: String(data.summary.confidence ?? '0.8'),
          fillRemaining: fillRaw === 'soft' || fillRaw === 'aggressive' ? fillRaw : 'off',
        })
        setExtractModel(data.model || null)
        toast.success(
          data.sourceCount === 1
            ? 'Сводка извлечена из 1 записи'
            : `Сводка извлечена из ${data.sourceCount} записей`,
        )
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Не удалось извлечь сводку')
      })
      .finally(() => setExtractPending(false))
  }

  const transcribeAmoCall = async (
    sourceId: string,
    audioUrl: string,
    title: string,
    signal?: AbortSignal,
  ) => {
    if (!code || !detail) return
    setRawPending(true)
    try {
      const data = await transcribeProjectLinkRawSource(
        code,
        detail.publicId,
        sourceId,
        {
          audioUrl,
          title,
        },
        { signal },
      )
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              rawSources: prev.rawSources.map((item) =>
                item.id === data.source.id ? data.source : item,
              ),
            }
          : prev,
      )
      toast.success('Звонок транскрибирован')
      void reload(code)
    } catch (err) {
      if (signal?.aborted) return
      toast.error(err instanceof Error ? err.message : 'Не удалось транскрибировать')
      throw err
    } finally {
      setRawPending(false)
    }
  }

  const syncAmoCalls = async () => {
    if (!code || !detail) return
    setAmoSyncPending(true)
    try {
      const data = await syncProjectLinkAmoCalls(code, detail.publicId)
      setDetail(data.link)
      if (data.timings) {
        console.info('[amo sync timings]', data.timings)
      }
      if (data.inserted > 0) {
        toast.success(`Подтянуто звонков: ${data.inserted}`)
      } else if (data.skipped > 0) {
        toast.message('Новых звонков нет — список уже актуален')
      } else if ((data.found ?? 0) > 0) {
        toast.message(`В amo найдено звонков: ${data.found}, с URL записи: ${data.withRecording ?? 0}`)
      } else {
        toast.message('В amo не найдено звонков с записью')
      }
      await reload(code)
      await startRecordingProbe(amoCallRecordingProbeTargets(data.link.rawSources), { force: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось синхронизировать')
      throw err
    } finally {
      setAmoSyncPending(false)
    }
  }

  if (error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  const markCopied = (id: string) => {
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
  }

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4 p-4 md:p-6">
      <PlanUsageBanner plan={project?.plan} projectCode={project?.code ?? code ?? ''} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!code) return
          setPending(true)
          setFormError(null)
          const ext = externalId.trim()
          void createProjectLink(code, {
            name: name.trim(),
            category,
            externalId: ext || undefined,
          })
            .then(async (created) => {
              const url = guestShareUrl(code ?? '', created.url)
              await copyText(url).catch(() => undefined)
              markCopied(created.publicId)
              setName('')
              if (created.reused) {
                toast.success('Ссылка уже выдавалась — скопирована существующая')
              } else {
                toast.success('Ссылка создана и скопирована')
              }
              return reload(code)
            })
            .catch((err) => {
              setFormError(err instanceof Error ? err.message : 'Не удалось создать ссылку')
            })
            .finally(() => setPending(false))
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[8.5rem] flex-1 basis-36 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Имя гостя</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Иван"
              required
              disabled={pending}
            />
          </label>
          <label className="flex min-w-[8.5rem] flex-1 basis-36 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Шаблон</span>
            <Combobox
              aria-label="Шаблон"
              placeholder="Выбрать шаблон"
              disabled={pending || templates.length === 0}
              value={category}
              onValueChange={setCategory}
              items={templates.map((tpl) => ({
                value: tpl.code,
                label:
                  tpl.status !== 'published' ? `${tpl.name} — не опубликован` : tpl.name,
              }))}
            />
          </label>
          <Button type="submit" className="shrink-0" disabled={pending || !name.trim() || templates.length === 0}>
            {pending ? 'Выдача…' : 'Выдать'}
          </Button>
        </div>
        <Collapsible className="group/more">
          <CollapsibleTrigger className="text-muted-foreground flex items-center gap-1 text-sm outline-none hover:text-foreground">
            Ещё
            <ChevronDownIcon className="size-3.5 transition-transform group-data-[open]/more:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden pt-2">
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span className="text-muted-foreground">ID сделки в CRM</span>
              <Input
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
                placeholder="необязательно"
                disabled={pending}
              />
            </label>
          </CollapsibleContent>
        </Collapsible>
      </form>
      {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Поиск</span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, почта, шаблон, даты"
        />
      </label>
      <div className="min-w-0 max-w-full overflow-hidden rounded-xl border md:overflow-hidden">
        {!links ? (
          <div className="divide-y">
            {Array.from({ length: 3 }, (_, index) => (
              <LinkRowSkeleton key={index} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground whitespace-normal p-4 text-sm">
            {links.length === 0 ? (
              <>
                Пока нет выдач. Введите имя гостя выше и нажмите «Выдать».
                {code ? (
                  <>
                    {' '}
                    Нет шаблона?{' '}
                    <Link className="text-primary underline-offset-4 hover:underline" to={`/app/projects/${code}/templates`}>
                      Открыть шаблоны
                    </Link>
                  </>
                ) : null}
              </>
            ) : (
              'Ничего не найдено'
            )}
          </p>
        ) : (
          <>
            <div className="divide-y md:hidden">
              {filtered.map((link) => {
                const url = guestShareUrl(code ?? '', link.url)
                const demoEmail = emailFromDemoExternalId(link.externalId)
                return (
                  <div
                    key={link.id}
                    className="flex cursor-pointer flex-col gap-2 p-3"
                    onClick={() => setSelectedPublicId(link.publicId)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{link.guestName}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {link.templateName} · открытий: {link.openCount}
                          {demoEmail ? ` · ${demoEmail}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          title={copiedId === link.publicId ? 'Скопировано' : 'Копировать'}
                          aria-label={copiedId === link.publicId ? 'Скопировано' : 'Копировать'}
                          onClick={() => {
                            void copyText(url)
                              .then(() => {
                                markCopied(link.publicId)
                                toast.success('Ссылка скопирована')
                              })
                              .catch(() => toast.error('Не удалось скопировать'))
                          }}
                        >
                          <CopyIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          title="Удалить"
                          aria-label="Удалить"
                          disabled={deletingId === link.publicId || pending}
                          onClick={() => {
                            if (!code) return
                            if (!window.confirm(`Удалить ссылку для ${link.guestName}?`)) return
                            setDeletingId(link.publicId)
                            setFormError(null)
                            void deleteProjectLink(code, link.publicId)
                              .then(() => reload(code))
                              .catch((err) => {
                                setFormError(err instanceof Error ? err.message : 'Не удалось удалить')
                              })
                              .finally(() => setDeletingId(null))
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                    <a
                      className="text-primary truncate text-sm underline-offset-4 hover:underline"
                      href={url}
                      title={url}
                      onClick={(event) => event.stopPropagation()}
                    >
                      /{link.publicId}
                    </a>
                  </div>
                )
              })}
            </div>
            <Table className="table-fixed max-md:hidden">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[18%]">Имя</TableHead>
                  <TableHead className="w-[16%] max-lg:hidden">Шаблон</TableHead>
                  <TableHead className="w-[18%] max-md:hidden">Даты / темы</TableHead>
                  <TableHead className="w-[10%] max-lg:hidden">CRM / почта</TableHead>
                  <TableHead className="w-[16%]">Ссылка</TableHead>
                  <TableHead className="w-[7%] max-md:hidden">Открытий</TableHead>
                  <TableHead className="w-[10%] max-md:hidden">Создана</TableHead>
                  <TableHead className="sticky right-0 z-10 w-[5.5rem] bg-background text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)]">
                    {' '}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((link) => {
                  const url = guestShareUrl(code ?? '', link.url)
                  const preview = link.summaryPreview
                  return (
                    <TableRow
                      key={link.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedPublicId(link.publicId)}
                    >
                      <TableCell className="max-w-0 font-medium">
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <span className="truncate">{link.guestName}</span>
                          {isMarketingDemoExternalId(link.externalId) ? (
                            <span
                              className="bg-muted text-muted-foreground shrink-0 rounded px-1 text-[10px] font-normal tracking-wide uppercase"
                              title="Демо с лендинга"
                            >
                              демо
                            </span>
                          ) : null}
                          {link.hasRawSources ? (
                            <span
                              className="bg-muted text-muted-foreground shrink-0 rounded px-1 text-[10px] font-normal tracking-wide uppercase"
                              title="Есть сохранённые диалоги"
                            >
                              диалоги
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-0 max-lg:hidden">
                        <div className="truncate" title={`${link.templateName} (${link.templateCode})`}>
                          {link.templateName}{' '}
                          <code className="text-muted-foreground text-xs">{link.templateCode}</code>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-0 max-md:hidden text-xs whitespace-normal">
                        <div className="truncate">{preview?.dates || '—'}</div>
                        <div className="truncate">
                          {preview?.topics
                            ? summaryTagsLabel(preview.topics, TOPIC_TAG_OPTIONS)
                            : ''}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-0 max-lg:hidden">
                        {link.externalId ? (
                          <div className="truncate">
                            <ExternalRefCell
                              externalId={link.externalId}
                              baseDomain={amoBaseDomain}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-0">
                        <a
                          className="text-primary block truncate underline-offset-4 hover:underline"
                          href={url}
                          title={url}
                          onClick={(event) => event.stopPropagation()}
                        >
                          /{link.publicId}
                        </a>
                      </TableCell>
                      <TableCell className="max-md:hidden">{link.openCount}</TableCell>
                      <TableCell className="max-md:hidden">{formatDt(link.createdAt)}</TableCell>
                      <TableCell
                        className="sticky right-0 z-10 bg-background text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)]"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            title={copiedId === link.publicId ? 'Скопировано' : 'Копировать'}
                            aria-label={copiedId === link.publicId ? 'Скопировано' : 'Копировать'}
                            onClick={() => {
                              void copyText(url)
                                .then(() => {
                                  markCopied(link.publicId)
                                  toast.success('Ссылка скопирована')
                                })
                                .catch(() => toast.error('Не удалось скопировать'))
                            }}
                          >
                            <CopyIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            title="Удалить"
                            aria-label="Удалить"
                            disabled={deletingId === link.publicId || pending}
                            onClick={() => {
                              if (!code) return
                              if (!window.confirm(`Удалить ссылку для ${link.guestName}?`)) return
                              setDeletingId(link.publicId)
                              setFormError(null)
                              void deleteProjectLink(code, link.publicId)
                                .then(() => reload(code))
                                .catch((err) => {
                                  setFormError(err instanceof Error ? err.message : 'Не удалось удалить')
                                })
                                .finally(() => setDeletingId(null))
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
          </>
        )}
      </div>

      <Dialog
        open={Boolean(selectedPublicId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedPublicId(null)
            setSummaryDraft(emptySummaryDraft())
            setDetailTab('overview')
            setLinkStats(null)
          }
        }}
      >
        <DialogContent className="flex max-h-[92vh] w-[min(calc(100vw-2rem),72rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-sans">{detail?.guestName ?? 'Карточка выдачи'}</DialogTitle>
            <DialogDescription>
              Обзор, диалоги с гостем и сборка презентации по сводке.
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <p className="text-muted-foreground text-sm">Загрузка…</p> : null}
          {detailError ? <p className="text-destructive text-sm">{detailError}</p> : null}

          {detail ? (
            <Tabs
              value={detailTab}
              onValueChange={(value) => value && setDetailTab(value as LinkDetailTab)}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <TabsList>
                <TabsTrigger value="overview">Обзор по ссылке</TabsTrigger>
                <TabsTrigger value="dialogs">Диалоги</TabsTrigger>
                <TabsTrigger value="assembly">Сборка шаблона</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="min-h-0 overflow-y-auto">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-sans">Обзор по ссылке</CardTitle>
                    <CardDescription>
                      Статистика выдачи, ссылка для гостя, шаблон и данные CRM.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">Ссылка для гостя</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const url = guestShareUrl(code ?? '', detail.url)
                            void copyText(url)
                              .then(() => toast.success('Ссылка скопирована'))
                              .catch(() => toast.error('Не удалось скопировать'))
                          }}
                        >
                          Копировать
                        </Button>
                      </div>
                      <a
                        className="text-primary block break-all text-sm underline-offset-4 hover:underline"
                        href={guestShareUrl(code ?? '', detail.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {guestShareUrl(code ?? '', detail.url)}
                      </a>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Имя гостя</p>
                        <p className="mt-0.5 font-medium">{detail.guestName}</p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Создана</p>
                        <p className="mt-0.5 font-medium">{formatDt(detail.createdAt)}</p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Шаблон</p>
                        <p className="mt-0.5 font-medium">
                          {detail.templateName}{' '}
                          <code className="text-muted-foreground text-xs font-normal">
                            {detail.templateCode}
                          </code>
                        </p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">publicId</p>
                        <p className="mt-0.5">
                          <code className="text-xs">{detail.publicId}</code>
                        </p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">
                          {emailFromDemoExternalId(detail.externalId) ? 'Почта (демо)' : 'Сделка amo'}
                        </p>
                        <p className="mt-0.5 font-medium">
                          {detail.externalId ? (
                            <ExternalRefCell
                              externalId={detail.externalId}
                              baseDomain={amoBaseDomain}
                            />
                          ) : (
                            '—'
                          )}
                        </p>
                      </div>
                      {detail.crmStatusAt ? (
                        <div className="rounded-lg border px-3 py-2.5">
                          <p className="text-muted-foreground text-xs">Статус CRM</p>
                          <p className="mt-0.5 font-medium">{formatDt(detail.crmStatusAt)}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Открытий</p>
                        <p className="text-xl font-medium tabular-nums">{detail.openCount}</p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Первое открытие</p>
                        <p className="text-sm font-medium">{formatDt(detail.firstOpenedAt)}</p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Блоков в сборке</p>
                        <p className="text-xl font-medium tabular-nums">{includedBlocks.length}</p>
                      </div>
                      <div className="rounded-lg border px-3 py-2.5">
                        <p className="text-muted-foreground text-xs">Записей диалогов</p>
                        <p className="text-xl font-medium tabular-nums">{detail.rawSources.length}</p>
                      </div>
                    </div>

                    {linkStatsLoading ? (
                      <p className="text-muted-foreground border-t pt-6 text-sm">Загрузка графиков…</p>
                    ) : linkStats ? (
                      <LinkAnalyticsCharts stats={linkStats} periodLabel={linkStatsPeriodLabel} />
                    ) : null}

                    {detail.guestSummary ? (
                      <div className="space-y-3 border-t pt-6">
                        <div>
                          <p className="text-sm font-medium">Кратко по клиенту</p>
                          <p className="text-muted-foreground text-sm">
                            Текущая сводка, по которой собрана презентация.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="rounded-lg border px-3 py-2.5">
                            <p className="text-muted-foreground text-xs">Даты</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {detail.guestSummary.dates?.trim() || '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border px-3 py-2.5">
                            <p className="text-muted-foreground text-xs">Номер / категория</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {detail.guestSummary.room
                                ? summaryTagsLabel(detail.guestSummary.room, ROOM_TAG_OPTIONS)
                                : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border px-3 py-2.5">
                            <p className="text-muted-foreground text-xs">Тип компании</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {detail.guestSummary.partyType
                                ? summaryTagsLabel(detail.guestSummary.partyType, AUDIENCE_TAG_OPTIONS)
                                : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border px-3 py-2.5">
                            <p className="text-muted-foreground text-xs">Дожим</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {fillRemainingLabel(detail.guestSummary.fillRemaining)}
                            </p>
                          </div>
                          <div className="rounded-lg border px-3 py-2.5 sm:col-span-2 lg:col-span-2">
                            <p className="text-muted-foreground text-xs">Темы</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {detail.guestSummary.topics
                                ? summaryTagsLabel(detail.guestSummary.topics, TOPIC_TAG_OPTIONS)
                                : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border px-3 py-2.5 sm:col-span-2 lg:col-span-3">
                            <p className="text-muted-foreground text-xs">Возражения</p>
                            <p className="mt-0.5 text-sm font-medium">
                              {detail.guestSummary.objections
                                ? summaryTagsLabel(
                                    detail.guestSummary.objections,
                                    OBJECTION_TAG_OPTIONS,
                                  )
                                : '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="dialogs" className="min-h-0 overflow-y-auto">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-sans">Диалоги</CardTitle>
                    {detail.externalId && !isMarketingDemoExternalId(detail.externalId) ? (
                      <CardAction>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={amoSyncPending || rawPending}
                          onClick={() => void syncAmoCalls()}
                        >
                          {amoSyncPending ? (
                            <>
                              Синхронизация…
                              <Spinner data-icon="inline-start" aria-hidden />
                            </>
                          ) : (
                            'Обновить из Amo'
                          )}
                        </Button>
                      </CardAction>
                    ) : null}
                    <CardDescription>
                      Звонки из CRM, переписка, транскрипты и заметки по гостю.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          Звонки из Amo
                          {probingCalls ? (
                            <span className="text-muted-foreground ml-2 font-normal">
                              · проверяем записи…
                            </span>
                          ) : null}
                        </p>
                        {amoCallSources.length > 0 && unavailableAmoCallCount > 0 ? (
                          <label
                            htmlFor="show-unavailable-amo-calls"
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="text-muted-foreground whitespace-nowrap">
                              Показать скрытые
                            </span>
                            <Switch
                              id="show-unavailable-amo-calls"
                              checked={showUnavailableAmoCalls}
                              onCheckedChange={(value) => setShowUnavailableAmoCalls(value === true)}
                              aria-label="Показать скрытые звонки"
                            />
                          </label>
                        ) : null}
                      </div>
                      {!detail.externalId ? (
                        <p className="text-muted-foreground text-sm">
                          Нет externalId (id сделки amo) — звонки подтянутся после webhook.
                        </p>
                      ) : isMarketingDemoExternalId(detail.externalId) ? (
                        <p className="text-muted-foreground text-sm">
                          Демо с лендинга
                          {emailFromDemoExternalId(detail.externalId)
                            ? ` · ${emailFromDemoExternalId(detail.externalId)}`
                            : ''}
                          — звонков amo здесь не будет.
                        </p>
                      ) : amoCallSources.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Пока нет звонков. Они появятся после webhook или по кнопке выше.
                        </p>
                      ) : visibleAmoCallSources.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {unavailableAmoCallCount} скрытых звонков — включите переключатель выше, чтобы
                          показать.
                        </p>
                      ) : (
                        <ItemGroup className="gap-2">
                          {visibleAmoCallSources.map((source) => (
                            <LinkAmoCallItem
                              key={source.id}
                              source={source}
                              recordingAvailability={sourceRecordingAvailability(
                                source,
                                recordingAvailability,
                              )}
                              disabled={rawPending || amoSyncPending}
                              deleting={deletingRawSourceId === source.id}
                              onTranscribe={transcribeAmoCall}
                              onDelete={() => removeRawSource(source)}
                              onSetNonTarget={(nonTarget) => setRawSourceNonTarget(source, nonTarget)}
                            />
                          ))}
                        </ItemGroup>
                      )}
                    </div>

                    <div className="space-y-3 border-t pt-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Чаты и заметки</p>
                          <p className="text-muted-foreground text-sm">
                            Переписка, транскрипты и текст, добавленный вручную.
                          </p>
                        </div>
                        {hiddenManualRawCount > 0 && !showUnavailableAmoCalls ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowUnavailableAmoCalls(true)}
                          >
                            Показать нецелевые ({hiddenManualRawCount})
                          </Button>
                        ) : null}
                      </div>
                      {visibleManualRawSources.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {hiddenManualRawCount > 0
                            ? 'Нецелевые скрыты — нажмите «Показать нецелевые» выше.'
                            : 'Пока нет записей — добавьте ниже.'}
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {visibleManualRawSources.map((source) => (
                            <LinkRawSourceItem
                              key={source.id}
                              source={source}
                              disabled={rawPending}
                              deleting={deletingRawSourceId === source.id}
                              onSave={(payload) => saveExistingRawSource(source.id, payload)}
                              onDelete={() => removeRawSource(source)}
                              onSetNonTarget={(nonTarget) => setRawSourceNonTarget(source, nonTarget)}
                            />
                          ))}
                        </ul>
                      )}
                      <ul>
                        <LinkRawSourceDraft disabled={rawPending} onSave={saveNewRawSource} />
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="assembly" className="min-h-0 overflow-y-auto">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-sans">Сборка шаблона</CardTitle>
                      <CardDescription>Блоки в порядке autoplay.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Блоки в сборке</p>
                        {includedBlocks.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            Пока пусто — заполните сводку справа и нажмите «Пересобрать».
                          </p>
                        ) : (
                          <ItemGroup className="gap-2">
                            {includedBlocks.map((entry) => (
                              <LinkAssemblyBlockItem
                                key={entry.id}
                                entry={entry}
                                sequence={linkTemplateConfig?.sequences[entry.id]}
                                meta={
                                  linkTemplateConfig?.constructorV2?.sequenceMetaById?.[entry.id] ??
                                  defaultBlockMeta()
                                }
                              />
                            ))}
                          </ItemGroup>
                        )}
                      </div>

                      <Accordion className="border-t pt-2">
                        <AccordionItem value="assembly-json">
                          <AccordionTrigger>JSON сборки</AccordionTrigger>
                          <AccordionContent className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-muted-foreground text-sm">
                                guestSummary, derivedFlow, assemblyTrace и meta.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!assemblyJson}
                                onClick={() => {
                                  if (!assemblyJson) return
                                  void copyText(JSON.stringify(assemblyJson, null, 2))
                                    .then(() => toast.success('JSON скопирован'))
                                    .catch(() => toast.error('Не удалось скопировать'))
                                }}
                              >
                                Копировать
                              </Button>
                            </div>
                            <pre className="bg-muted max-h-[min(24rem,40vh)] overflow-auto rounded-lg p-3 font-mono text-xs">
                              {JSON.stringify(assemblyJson, null, 2)}
                            </pre>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="font-sans">Сводка по диалогам</CardTitle>
                      <CardAction>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={extractPending || reassemblePending || !code}
                            onClick={handleExtractSummary}
                          >
                            {extractPending ? (
                              <>
                                Извлечение…
                                <Spinner data-icon="inline-start" aria-hidden />
                              </>
                            ) : (
                              'Извлечь из диалогов'
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={reassemblePending || extractPending || !code}
                            onClick={handleReassemble}
                          >
                            {reassemblePending ? 'Сборка…' : 'Пересобрать'}
                          </Button>
                        </div>
                      </CardAction>
                      <CardDescription>
                        Данные о госте для адаптивной сборки. После правок нажмите «Пересобрать».
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Дожим непокрытых тем</span>
                        <NativeSelect
                          value={summaryDraft.fillRemaining}
                          onChange={(e) =>
                            setSummaryDraft((prev) => ({
                              ...prev,
                              fillRemaining: e.target.value as SummaryDraft['fillRemaining'],
                            }))
                          }
                          className="w-full"
                          title="Если после основной сборки осталось место — добавить блоки из групп, о которых ещё не говорили"
                        >
                          <NativeSelectOption value="off">Выкл — только по параметрам гостя</NativeSelectOption>
                          <NativeSelectOption value="soft">Мягкий — до 3 блоков</NativeSelectOption>
                          <NativeSelectOption value="aggressive">До лимита блоков / секунд</NativeSelectOption>
                        </NativeSelect>
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Имя гостя</span>
                        <Input
                          value={summaryDraft.guestName}
                          onChange={(e) =>
                            setSummaryDraft((prev) => ({ ...prev, guestName: e.target.value }))
                          }
                          placeholder="Пусто — как будто amo не передала имя"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Номер / категория</span>
                        <SingleTagCombobox
                          options={ROOM_TAG_OPTIONS}
                          value={summaryDraft.room}
                          onValueChange={(room) => setSummaryDraft((prev) => ({ ...prev, room }))}
                          placeholder="Выберите категорию…"
                          aria-label="Номер / категория"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Даты</span>
                        <Input
                          value={summaryDraft.dates}
                          onChange={(e) =>
                            setSummaryDraft((prev) => ({ ...prev, dates: e.target.value }))
                          }
                          placeholder="с 19 сентября на 14 дней"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Тип компании</span>
                        <SingleTagCombobox
                          options={AUDIENCE_TAG_OPTIONS}
                          value={summaryDraft.partyType}
                          onValueChange={(partyType) =>
                            setSummaryDraft((prev) => ({ ...prev, partyType }))
                          }
                          placeholder="Выберите аудиторию…"
                          aria-label="Тип компании"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Темы</span>
                        <TagsCombobox
                          options={TOPIC_TAG_OPTIONS}
                          value={parseSummaryCsv(summaryDraft.topics)}
                          onValueChange={(topics) =>
                            setSummaryDraft((prev) => ({ ...prev, topics: topics.join(', ') }))
                          }
                          emptyLabel="Не выбрано"
                          placeholder="Добавить тему…"
                          aria-label="Темы"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Возражения</span>
                        <TagsCombobox
                          options={OBJECTION_TAG_OPTIONS}
                          value={parseSummaryCsv(summaryDraft.objections)}
                          onValueChange={(objections) =>
                            setSummaryDraft((prev) => ({ ...prev, objections: objections.join(', ') }))
                          }
                          emptyLabel="Не выбрано"
                          placeholder="Добавить возражение…"
                          aria-label="Возражения"
                        />
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Уверенность</span>
                        <Input
                          type="number"
                          step="0.05"
                          min="0"
                          max="1"
                          value={summaryDraft.confidence}
                          onChange={(e) =>
                            setSummaryDraft((prev) => ({ ...prev, confidence: e.target.value }))
                          }
                          placeholder="0.8"
                        />
                      </label>

                      {detail.summaryMeta ? (
                        <div className="space-y-3 border-t pt-6">
                          <div>
                            <p className="text-sm font-medium">Meta сводки</p>
                            <p className="text-muted-foreground text-sm">Когда и откуда получена сводка.</p>
                          </div>
                          <pre className="bg-muted overflow-auto rounded-lg p-3 text-xs">
                            {JSON.stringify(detail.summaryMeta, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function recordingsUnavailableLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'запись недоступна'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи недоступны'
  return 'записей недоступно'
}
