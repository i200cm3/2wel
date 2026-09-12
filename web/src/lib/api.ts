import { authFetch, authHeaders, clearEditorToken } from '@/lib/auth'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await authFetch(path, { cache: 'no-store' })
  if (res.status === 401) {
    clearEditorToken()
    throw new ApiError('unauthorized', 401)
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status)
  }
  return data
}

export type AuthUser = {
  id: string
  login: string
  email: string | null
  name: string
  isAdmin?: boolean
  isBlocked?: boolean
}

export type FunnelCounts = {
  open: number
  autoplay: number
  menu: number
  whatsapp: number
  /** Клики по кнопкам связи (WA / TG / MAX / звонок / SMS / …). */
  contact: number
}

export type ContactChannelId =
  | 'whatsapp'
  | 'telegram'
  | 'max'
  | 'tel'
  | 'sms'
  | 'site'
  | 'other'

export type ProjectStats = {
  templates: number
  links: number
  opens: number
  openedLinks: number
  range?: { from: string; to: string }
  funnel: FunnelCounts
  series: ({ date: string } & FunnelCounts)[]
  devices: { phone: number; tablet: number; desktop: number }
  hours: { hour: number; opens: number }[]
  topics?: {
    id: string
    label: string
    opens: number
    guests: number
    share: number
  }[]
  channels?: { id: ContactChannelId; clicks: number }[]
  openRate?: { opened: number; issued: number }
  /** Смены статуса CRM: после какого последнего действия гостя. */
  crmAfter?: { eventType: keyof FunnelCounts | 'topic' | 'none'; count: number }[]
  crmRecent?: {
    at: string
    statusId: string
    statusLabel: string | null
    pipelineId: string | null
    lastEventType: string | null
    lastEventAt: string | null
    priorTypes: string[]
    guestName: string
    publicId: string
  }[]
  recent: {
    at: string
    type: keyof FunnelCounts | 'topic' | 'contact'
    device: 'phone' | 'tablet' | 'desktop'
    guestName: string
    publicId: string
    topic?: string | null
    topicLabel?: string | null
  }[]
  /** Выданные за период ссылки без открытия */
  unopened?: {
    at: string
    guestName: string
    publicId: string
  }[]
}

export type PlanSummary = {
  id: string
  name: string
  price: number
  constructor?: 'v1' | 'v2'
  unlimited?: boolean
  included: number | null
  used: number
  remaining: number | null
  overage: number
  overageCost: number
  total: number
  share: number
  periodStart: string
  periodEnd: string
  pendingPlan: string | null
  pendingEffectiveAt: string | null
}

export type Project = {
  id: string
  code: string
  name: string
  type: string
  status: string
  createdAt: string
  updatedAt: string
  /** Не синтезировать TTS при выдаче ссылки (кабинет / API). */
  skipTtsOnLinkIssue?: boolean
  /** В гостевой презентации в титрах показывать текст TTS вместо короткого caption. */
  captionsFromTts?: boolean
  /** Догенерировать отсутствующие ttsSrc по ttsText при выдаче / открытии. */
  fillMissingTts?: boolean
  /** Собирать {hello} отдельным промптом по диалогу. Выкл — {hello} пустой. */
  helloFromDialog?: boolean
  /** owner — владелец, member — сотрудник, admin — системный администратор. */
  role?: 'owner' | 'member' | 'admin'
  stats: {
    templates: number
    links: number
    opens: number
  }
  plan: PlanSummary
}

export type PlanUsage = {
  links: number
  unlimited?: boolean
  included: number | null
  remaining: number | null
  overage: number
  overageCost: number
  base: number
  total: number
  share: number
}

export type PlanChange = {
  id: string
  fromPlan: string
  toPlan: string
  fromName: string
  toName: string
  kind: 'upgrade' | 'downgrade' | 'cancelled'
  effectiveAt: string
  createdAt: string
}

export type ProjectPlan = {
  ok: true
  plan: {
    id: string
    name: string
    price: number
    constructor: 'v1' | 'v2'
  }
  plans: {
    id: string
    name: string
    price: number
    constructor: 'v1' | 'v2'
    current: boolean
  }[]
  period: { start: string; end: string }
  usage: PlanUsage
  pending: { plan: string; name: string; effectiveAt: string } | null
  history: PlanChange[]
}

export function fetchProjectPlan(projectCode: string) {
  return apiGet<ProjectPlan>(`/api/projects/${encodeURIComponent(projectCode)}/plan`)
}

export function changeProjectPlan(projectCode: string, plan: string) {
  return apiSend<ProjectPlan>(`/api/projects/${encodeURIComponent(projectCode)}/plan`, 'POST', {
    plan,
  })
}

/** Админ: мгновенно Старт / Про (пока без оплаты). */
export function adminSetProjectPlan(projectCode: string, plan: string) {
  return apiSend<ProjectPlan>(`/api/admin/projects/${encodeURIComponent(projectCode)}/plan`, 'POST', {
    plan,
  })
}

export type Template = {
  id: string
  code: string
  name: string
  isDefault: boolean
  status: string
  hasDraft?: boolean
  createdAt: string
  updatedAt: string
}

export type ProjectLinkSummaryPreview = {
  dates: string
  partyType: string
  topics: string
  objections: string
  confidence: string
  room: string
}

export type ProjectLink = {
  id: string
  publicId: string
  url: string
  guestName: string
  externalId: string | null
  templateCode: string
  templateName: string
  createdAt: string
  firstOpenedAt: string | null
  openCount: number
  summaryPreview?: ProjectLinkSummaryPreview | null
  flowBlockCount?: number
  hasRawSources?: boolean
  /** pending/running — транскрибация/сборка/TTS ещё идут. */
  pipelineStatus?: string | null
  pipelineStep?: string | null
}

/** Ссылка ещё собирается (не копировать / не открывать гостю). */
export function isLinkPreparing(pipelineStatus?: string | null): boolean {
  const status = String(pipelineStatus ?? '').trim().toLowerCase()
  return status === 'pending' || status === 'running'
}

export type AssemblyTraceEntry = {
  id: string
  label: string
  included: boolean
  score: number
  reason: string
  placement: string
}

export type LinkRawSourceMeta = {
  recordingUrl?: string
  transcribeModel?: string
  transcribedAt?: string
  durationSec?: number
  recordingAvailable?: boolean
  recordingProbedAt?: string
  recordingProbeReason?: string
  /** Вручную помечен как нецелевой — не участвует в транскрибации и анализе. */
  nonTarget?: boolean
}

export type LinkRawSource = {
  id: string
  kind: string
  title: string
  body: string
  externalRef: string | null
  capturedAt: string | null
  createdAt: string
  meta: LinkRawSourceMeta | null
}

export type ProjectLinkDetail = ProjectLink & {
  guestSummary: {
    guestName?: string
    dates?: string
    partyType?: string
    topics?: string
    objections?: string
    confidence?: string
    room?: string
    fillRemaining?: string
    hello?: string
  } | null
  derivedFlow: string[] | null
  assemblyTrace: AssemblyTraceEntry[] | null
  amoSnapshot: Record<string, unknown> | null
  summaryMeta: Record<string, unknown> | null
  crmStatusId: string | null
  crmPipelineId: string | null
  crmStatusAt: string | null
  rawSources: LinkRawSource[]
}

export type LinkStats = {
  range: { from: string; to: string }
  funnel: FunnelCounts
  series: ({ date: string } & FunnelCounts)[]
  devices: { phone: number; tablet: number; desktop: number }
  hours: { hour: number; opens: number }[]
  topics?: {
    id: string
    label: string
    opens: number
    guests: number
    share: number
  }[]
  channels?: { id: ContactChannelId; clicks: number }[]
  recent: ProjectStats['recent']
}

export function fetchProjects() {
  return apiGet<{ ok: true; projects: Project[] }>('/api/projects')
}

export function canManageProject(project?: { role?: string } | null) {
  return Boolean(project) && project?.role !== 'member'
}

export type ProjectTeamMember = {
  id: string
  email: string | null
  name: string
  login: string
  role: 'owner' | 'member'
  joinedAt: string
}

export type ProjectTeamInvite = {
  id: string
  email: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  token?: string
  url?: string
}

export function fetchProjectTeam(projectCode: string) {
  return apiGet<{ ok: true; members: ProjectTeamMember[]; invites: ProjectTeamInvite[] }>(
    `/api/projects/${encodeURIComponent(projectCode)}/team`,
  )
}

export function inviteProjectMember(projectCode: string, email: string) {
  return apiSend<{
    ok: true
    added: boolean
    member?: ProjectTeamMember
    invite?: ProjectTeamInvite
    mailed?: boolean
  }>(`/api/projects/${encodeURIComponent(projectCode)}/team`, 'POST', { email })
}

export function removeProjectMember(projectCode: string, userId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/team/${encodeURIComponent(userId)}`,
    'DELETE',
  )
}

export function revokeProjectInvite(projectCode: string, inviteId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/team/invites/${encodeURIComponent(inviteId)}`,
    'DELETE',
  )
}

export function leaveProject(projectCode: string) {
  return apiSend<{ ok: true }>(`/api/projects/${encodeURIComponent(projectCode)}/team/leave`, 'POST')
}

export function createProject(payload: { name: string; code?: string }) {
  return apiSend<{ ok: true; project: Project; templates: Template[] }>('/api/projects', 'POST', payload)
}

export function checkProjectCode(code: string) {
  return apiGet<{ ok: true; available: boolean; code: string; error: string | null }>(
    `/api/project-code/check?code=${encodeURIComponent(code)}`,
  )
}

export function patchProject(
  code: string,
  payload: {
    name?: string
    code?: string
    skipTtsOnLinkIssue?: boolean
    captionsFromTts?: boolean
    fillMissingTts?: boolean
    helloFromDialog?: boolean
  },
) {
  return apiSend<{
    ok: true
    project: Project
    guestHost?: { host: string; ok: boolean; error: string | null }
  }>(`/api/projects/${encodeURIComponent(code)}`, 'PATCH', payload)
}

export function fetchProject(code: string) {
  return apiGet<{ ok: true; project: Project; templates: Template[] }>(
    `/api/projects/${encodeURIComponent(code)}`,
  )
}

export function fetchProjectStats(code: string, range?: { from: string; to: string }) {
  const q = new URLSearchParams()
  if (range?.from) q.set('from', range.from)
  if (range?.to) q.set('to', range.to)
  const qs = q.toString()
  return apiGet<{ ok: true; project: Project; stats: ProjectStats }>(
    `/api/projects/${encodeURIComponent(code)}/stats${qs ? `?${qs}` : ''}`,
  )
}

/** Синхронный кэш списка шаблонов — чтобы не мигать «Загрузка…» при возврате из редактора. */
const templatesListCache = new Map<string, Template[]>()

export function peekTemplates(code: string): Template[] | null {
  return templatesListCache.get(code) ?? null
}

export function fetchTemplates(code: string) {
  return apiGet<{ ok: true; templates: Template[] }>(
    `/api/projects/${encodeURIComponent(code)}/templates`,
  ).then((data) => {
    templatesListCache.set(code, data.templates)
    return data
  })
}

export function createTemplate(
  projectCode: string,
  payload: { name: string; code?: string; from?: string; isDefault?: boolean; starter?: boolean },
) {
  return apiSend<{ ok: true; template: Template }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates`,
    'POST',
    payload,
  )
}

export function patchTemplate(
  projectCode: string,
  templateCode: string,
  payload: { name?: string; code?: string; isDefault?: boolean },
) {
  return apiSend<{ ok: true; template: Template }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}`,
    'PATCH',
    payload,
  )
}

export function publishTemplate(projectCode: string, templateCode: string) {
  return apiSend<{ ok: true; hasDraft: boolean; template: Template }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/publish`,
    'POST',
    {},
  )
}

export function fetchTemplateOrphanMedia(projectCode: string, templateCode: string) {
  return apiGet<{ ok: true; count: number; orphans: string[] }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/orphan-media`,
  )
}

export function deleteTemplate(
  projectCode: string,
  templateCode: string,
  opts?: { purgeUnused?: boolean },
) {
  const q = opts?.purgeUnused ? '?purgeUnused=1' : ''
  return apiSend<{ ok: true; purgedMedia?: number }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}${q}`,
    'DELETE',
  )
}

export function fetchLinks(code: string) {
  return apiGet<{ ok: true; links: ProjectLink[] }>(
    `/api/projects/${encodeURIComponent(code)}/links`,
  )
}

export function fetchProjectLink(projectCode: string, publicId: string) {
  return apiGet<{ ok: true; link: ProjectLinkDetail }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}`,
  )
}

export function fetchProjectLinkStats(projectCode: string, publicId: string) {
  return apiGet<{ ok: true; stats: LinkStats }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/stats`,
  )
}

export function addProjectLinkRawSource(
  projectCode: string,
  publicId: string,
  payload: { body?: string; kind?: string; title?: string; audioUrl?: string },
) {
  return apiSend<{ ok: true; source: LinkRawSource }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/raw-sources`,
    'POST',
    payload,
  )
}

export function updateProjectLinkRawSource(
  projectCode: string,
  publicId: string,
  sourceId: string,
  payload: { body?: string; kind?: string; title?: string; nonTarget?: boolean },
) {
  return apiSend<{ ok: true; source: LinkRawSource }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/raw-sources/${encodeURIComponent(sourceId)}`,
    'PATCH',
    payload,
  )
}

export function deleteProjectLinkRawSource(projectCode: string, publicId: string, sourceId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/raw-sources/${encodeURIComponent(sourceId)}`,
    'DELETE',
  )
}

export function transcribeProjectLinkRawSource(
  projectCode: string,
  publicId: string,
  sourceId: string,
  payload: { audioUrl: string; title?: string },
  init?: Pick<RequestInit, 'signal'>,
) {
  return apiSend<{ ok: true; source: LinkRawSource }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/raw-sources/${encodeURIComponent(sourceId)}/transcribe`,
    'POST',
    payload,
    init,
  )
}

export function syncProjectLinkAmoCalls(projectCode: string, publicId: string) {
  return apiSend<{
    ok: true
    inserted: number
    skipped: number
    found: number
    withRecording: number
    matched: number
    pruned: number
    recordingUnavailable: number
    timings?: {
      totalMs: number
      pruneMs: number
      fetchMs: number
      probeMs: number
      insertMs: number
      amoRequests: number
      amoMs: number
      amoSlowest?: Array<{ method: string; path: string; ms: number; status: number; ok: boolean }>
      phases?: Array<Record<string, unknown>>
    } | null
    link: ProjectLinkDetail
  }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/sync-amo-calls`,
    'POST',
    {},
  )
}

export type CallRecordingProbeResult = {
  url: string
  ok: boolean
  status: number
  reason: string | null
}

export type CallRecordingProbeItem = {
  sourceId: string
  url: string
}

export function probeProjectLinkCallRecordings(
  projectCode: string,
  publicId: string,
  payload: { urls?: string[]; items?: CallRecordingProbeItem[] },
) {
  return apiSend<{ ok: true; results: CallRecordingProbeResult[] }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/probe-call-recordings`,
    'POST',
    payload,
  )
}

export function reassembleProjectLink(
  projectCode: string,
  publicId: string,
  payload?: {
    name?: string
    summary?: Record<string, string>
    summaryMeta?: Record<string, unknown>
    /** Опубликовать черновик шаблона перед пересборкой (кнопка в кабинете). */
    applyDraft?: boolean
  },
) {
  return apiSend<{ ok: true; link: ProjectLinkDetail; publishedDraft?: boolean }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/reassemble`,
    'POST',
    payload ?? {},
  )
}

export type ExtractedGuestSummary = {
  guestName: string
  dates: string
  partyType: string
  room: string
  topics: string
  objections: string
  confidence: string
  fillRemaining: string
  hello?: string
}

export function extractProjectLinkSummary(projectCode: string, publicId: string) {
  return apiSend<{
    ok: true
    summary: ExtractedGuestSummary
    summaryJson: ExtractedGuestSummary
    explanation: string
    model: string
    sourceCount: number
  }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}/extract-summary`,
    'POST',
  )
}

export type CreatedLink = {
  ok: true
  url: string
  publicId: string
  guestName: string
  externalId: string | null
  templateCode: string
  templateName: string
  reused: boolean
}

export function createProjectLink(
  projectCode: string,
  payload: {
    name: string
    category?: string
    externalId?: string
    summary?: Record<string, string>
    rawText?: string
    rawSources?: Array<{ kind?: string; title?: string; body: string }>
    amoSnapshot?: Record<string, unknown>
  },
) {
  return apiSend<CreatedLink>(
    `/api/projects/${encodeURIComponent(projectCode)}/links`,
    'POST',
    payload,
  )
}

export function deleteProjectLink(projectCode: string, publicId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/links/${encodeURIComponent(publicId)}`,
    'DELETE',
  )
}

export type ProjectApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  token?: string
}

export function fetchApiKeys(projectCode: string) {
  return apiGet<{ ok: true; keys: ProjectApiKey[] }>(
    `/api/projects/${encodeURIComponent(projectCode)}/keys`,
  )
}

export function createApiKey(projectCode: string, name?: string) {
  return apiSend<{ ok: true; key: ProjectApiKey }>(
    `/api/projects/${encodeURIComponent(projectCode)}/keys`,
    'POST',
    { name: name ?? '' },
  )
}

export function revokeApiKey(projectCode: string, keyId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/keys/${encodeURIComponent(keyId)}`,
    'POST',
    { action: 'revoke' },
  )
}

export function deleteApiKey(projectCode: string, keyId: string) {
  return apiSend<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectCode)}/keys/${encodeURIComponent(keyId)}`,
    'DELETE',
  )
}

export type TtsVoiceOption = {
  id: string
  name: string
  label: string
  /** Официальный пример — проигрывается без генерации через API. */
  demoSrc?: string
  /** false — в кабинете недоступен для выбора (нет демо). */
  available?: boolean
}

export type TtsProviderInfo = {
  id: 'sber' | 'elevenlabs'
  name: string
  note: string
  configured: boolean
  defaultVoice: string
  voices: TtsVoiceOption[]
}

export type ProjectVoice = {
  ok: true
  provider: 'sber' | 'elevenlabs'
  voice: string
  label: string
  /** ElevenLabs доступен только при ручном включении у объекта. */
  elevenlabsEnabled?: boolean
  providers: TtsProviderInfo[]
}

export function fetchProjectVoice(projectCode: string) {
  return apiGet<ProjectVoice>(`/api/projects/${encodeURIComponent(projectCode)}/tts/voices`)
}

export function saveProjectVoice(projectCode: string, provider: string, voice: string) {
  return apiSend<ProjectVoice>(
    `/api/projects/${encodeURIComponent(projectCode)}/tts/voice`,
    'POST',
    { provider, voice },
  )
}

export type AmoStatusMap = {
  statusId: string
  templateCode: string
  label: string | null
}

export type AmoPipeline = {
  id: string
  name: string
  statuses: { id: string; name: string }[]
}

export type AmoConnection = {
  ok: true
  configured: boolean
  connected: boolean
  baseDomain: string | null
  webhookUrl: string | null
  connectedAt: string | null
  statusMaps: AmoStatusMap[]
  pipelines: AmoPipeline[]
}

export function fetchAmoConnection(projectCode: string) {
  return apiGet<AmoConnection>(`/api/projects/${encodeURIComponent(projectCode)}/amocrm`)
}

export function saveAmoStatusMap(projectCode: string, maps: AmoStatusMap[]) {
  return apiSend<{ ok: true; maps: AmoStatusMap[] }>(
    `/api/projects/${encodeURIComponent(projectCode)}/amocrm/status-map`,
    'PUT',
    { maps },
  )
}

export function connectAmo(projectCode: string) {
  return apiSend<{ ok: true; authUrl: string }>(
    `/api/projects/${encodeURIComponent(projectCode)}/amocrm/connect`,
    'POST',
  )
}

export function disconnectAmo(projectCode: string) {
  return apiSend<{ ok: true }>(`/api/projects/${encodeURIComponent(projectCode)}/amocrm`, 'DELETE')
}

export type PublicPlayback = {
  ok: true
  id: string
  guestName: string
  property: unknown
}

export async function fetchPublicLink(publicId: string): Promise<PublicPlayback | null> {
  const res = await fetch(`/api/public/links/${encodeURIComponent(publicId)}`, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as PublicPlayback | null
  if (!data?.ok || !data.guestName) return null
  return data
}

export async function requestDemoGuest(payload: {
  name: string
  email: string
}): Promise<{ ok: true; mailed: boolean; reused: boolean }> {
  const res = await fetch('/api/public/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    mailed?: boolean
    reused?: boolean
    error?: string
  }
  if (!res.ok || !data.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status)
  }
  return { ok: true, mailed: Boolean(data.mailed), reused: Boolean(data.reused) }
}

export type PublicEventType = 'autoplay' | 'menu' | 'whatsapp' | 'topic' | 'contact'

export function trackPublicEvent(
  publicId: string,
  type: PublicEventType,
  extra?: { topic?: string; channel?: string },
) {
  if (!publicId) return
  const topic = extra?.topic?.trim()
  const channel = extra?.channel?.trim()
  if (type === 'topic' && !topic) return
  if (type === 'contact' && !channel) return
  const body =
    type === 'topic'
      ? { type, topic }
      : type === 'contact'
        ? { type, channel }
        : { type }
  void fetch(`/api/public/links/${encodeURIComponent(publicId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
    cache: 'no-store',
  }).catch(() => undefined)
}

export async function apiSend<T>(
  path: string,
  method: string,
  body?: unknown,
  init?: Pick<RequestInit, 'signal'>,
): Promise<T> {
  const res = await authFetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: init?.signal,
  })
  if (res.status === 401) {
    clearEditorToken()
    throw new ApiError('unauthorized', 401)
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string }
  if (!res.ok) {
    const message = data.detail
      ? data.error && !data.detail.includes(data.error)
        ? `${data.error}: ${data.detail}`
        : data.detail
      : data.error || `HTTP ${res.status}`
    throw new ApiError(message, res.status)
  }
  return data
}

export type TemplateConfigResponse = {
  ok: true
  template: Template
  project: { code: string; name: string }
  config: unknown
  draft: unknown
  hasDraft: boolean
}

export function fetchTemplateConfig(projectCode: string, templateCode: string) {
  return apiGet<TemplateConfigResponse>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}`,
  )
}

export function saveTemplateConfig(projectCode: string, templateCode: string, config: unknown) {
  return apiSend<{ ok: true; hasDraft: boolean }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}`,
    'PUT',
    config,
  )
}

export function saveTemplateDraft(projectCode: string, templateCode: string, config: unknown) {
  return apiSend<{ ok: true; hasDraft: boolean }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/draft`,
    'PUT',
    config,
  )
}

export function discardTemplateDraft(projectCode: string, templateCode: string) {
  return apiSend<{ ok: true; hasDraft: boolean }>(
    `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/draft`,
    'DELETE',
  )
}

export type ImportArchiveProgress = {
  phase: 'uploading' | 'processing'
  loaded: number
  total: number
  percent: number
}

export type ExportArchiveProgress = {
  phase: 'preparing' | 'downloading'
  loaded: number
  total: number
  percent: number
}

export async function importTemplateArchive(
  projectCode: string,
  templateCode: string,
  file: File,
  onProgress?: (progress: ImportArchiveProgress) => void,
) {
  return new Promise<{
    ok?: true
    config?: unknown
    filesWritten?: number
    manifestTotal?: number
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      'POST',
      `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/import-archive`,
    )
    xhr.withCredentials = true
    for (const [key, value] of authHeaders()) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size
      const loaded = event.loaded
      const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0
      onProgress?.({ phase: 'uploading', loaded, total, percent })
    }
    xhr.upload.onload = () => {
      onProgress?.({ phase: 'processing', loaded: file.size, total: file.size, percent: 100 })
    }
    xhr.onerror = () => reject(new ApiError('Сеть недоступна', 0))
    xhr.onload = () => {
      if (xhr.status === 401) clearEditorToken()
      let data: { ok?: true; error?: string; config?: unknown; filesWritten?: number; manifestTotal?: number } = {}
      try {
        data = JSON.parse(xhr.responseText || '{}')
      } catch {
        data = {}
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(data.error || `HTTP ${xhr.status}`, xhr.status))
        return
      }
      resolve(data)
    }
    xhr.send(file)
  })
}

export async function downloadTemplateArchive(
  projectCode: string,
  templateCode: string,
  onProgress?: (progress: ExportArchiveProgress) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      'GET',
      `/api/projects/${encodeURIComponent(projectCode)}/templates/${encodeURIComponent(templateCode)}/export-archive`,
    )
    xhr.responseType = 'blob'
    xhr.withCredentials = true
    for (const [key, value] of authHeaders()) xhr.setRequestHeader(key, value)

    onProgress?.({ phase: 'preparing', loaded: 0, total: 0, percent: 0 })

    xhr.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100))
        onProgress?.({
          phase: 'downloading',
          loaded: event.loaded,
          total: event.total,
          percent,
        })
        return
      }
      // Server may stream without Content-Length while packing — keep preparing pulse.
      onProgress?.({
        phase: 'preparing',
        loaded: event.loaded,
        total: 0,
        percent: Math.min(90, Math.round(event.loaded / (256 * 1024))),
      })
    }

    xhr.onerror = () => reject(new ApiError('Сеть недоступна', 0))
    xhr.onload = () => {
      if (xhr.status === 401) {
        clearEditorToken()
        reject(new ApiError('unauthorized', 401))
        return
      }
      const blob = xhr.response as Blob
      if (xhr.status < 200 || xhr.status >= 300) {
        void blob.text().then((text) => {
          let message = `HTTP ${xhr.status}`
          try {
            const data = JSON.parse(text || '{}') as { error?: string }
            if (data.error) message = data.error
          } catch {
            /* keep default */
          }
          reject(new ApiError(message, xhr.status))
        })
        return
      }

      const total = blob.size || 1
      onProgress?.({ phase: 'downloading', loaded: total, total, percent: 100 })

      const disposition = xhr.getResponseHeader('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const fileName = match?.[1] || `${projectCode}-${templateCode}-template.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      resolve()
    }
    xhr.send()
  })
}

export type AdminUser = AuthUser & {
  createdAt?: string
  templateCount: number
}

export type AdminUserProject = Project & {
  templates: Template[]
}

export type AdminUserWorkspace = {
  ok: true
  user: AdminUser
  projects: AdminUserProject[]
}

export function searchAdminUsers(q = '') {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
  return apiGet<{ ok: true; users: AdminUser[] }>(`/api/admin/users${qs}`)
}

export function fetchAdminUser(userId: string) {
  return apiGet<AdminUserWorkspace>(`/api/admin/users/${encodeURIComponent(userId)}`)
}

export function setAdminUserBlocked(userId: string, isBlocked: boolean) {
  return apiSend<{ ok: true; user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    'PATCH',
    { isBlocked },
  )
}

export function setAdminUserRole(userId: string, isAdmin: boolean) {
  return apiSend<{ ok: true; user: AdminUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    'PATCH',
    { isAdmin },
  )
}

export function deleteAdminUser(userId: string) {
  return apiSend<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}`, 'DELETE')
}

export type GenerateCueCopyPayload = {
  brand?: {
    name?: string
    fullName?: string
    city?: string
    site?: string
  }
  copyFacts?: string
  block: {
    label?: string
    group?: string
    subgroup?: string
    audienceTags?: string[]
    topicTags?: string[]
    objectionTags?: string[]
    slotFields?: string[]
    title?: string
    cues: Array<{ text?: string; ttsText?: string }>
  }
  cueIndex: number
  updateTitle?: boolean
}

export type GenerateCueCopyResult = {
  ok: true
  title: string
  cue: { text: string; ttsText: string }
  model?: string
}

export function generateCueCopy(payload: GenerateCueCopyPayload) {
  return apiSend<GenerateCueCopyResult>('/api/admin/generate-cue-copy', 'POST', payload)
}

export type AdminTtsUsageUser = {
  id: string
  login: string
  name: string
  email: string | null
  characters: number
  generations: number
  lastAt: string | null
}

export type AdminElevenlabsBalance =
  | {
      ok: true
      tier: string
      status: string
      characterCount: number
      characterLimit: number
      charactersRemaining: number
      nextResetAt: string | null
    }
  | {
      ok: false
      error: string
      detail?: string
    }

export type AdminTtsUsageOverview = {
  ok: true
  users: AdminTtsUsageUser[]
  totals: { characters: number; generations: number }
  days: number
  provider: string
  elevenlabs: AdminElevenlabsBalance
}

export function fetchAdminTtsUsage(days = 0) {
  const qs = days > 0 ? `?days=${encodeURIComponent(String(days))}` : ''
  return apiGet<AdminTtsUsageOverview>(`/api/admin/tts-usage${qs}`)
}

export type AdminIntegrationProvider = {
  id: string
  label: string
  comingSoon: boolean
  hasKey: boolean
  keyHint: string | null
  source: 'database' | 'env' | 'none'
  folderId?: string | null
  hasFolderId?: boolean
  folderIdSource?: 'database' | 'env' | 'none'
}

export type AdminTranscribeProvider = {
  id: string
  label: string
  available: boolean
}

export type AdminAssemblyProvider = {
  id: string
  label: string
  available: boolean
}

export type AdminExtractModel = {
  id: string
  label: string
  sizeBytes?: number
}

export type AdminIntegrationsOverview = {
  ok: true
  transcribeProvider: string
  transcribeProviders: AdminTranscribeProvider[]
  assemblyProvider: string
  assemblyProviders: AdminAssemblyProvider[]
  extractModel?: string
  extractModels?: AdminExtractModel[]
  localLlmConfigured?: boolean
  localLlmError?: string | null
  integrations: AdminIntegrationProvider[]
}

export function fetchAdminIntegrations() {
  return apiGet<AdminIntegrationsOverview>('/api/admin/integrations')
}

export function saveAdminIntegrations(payload: {
  transcribeProvider?: string
  assemblyProvider?: string
  extractModel?: string
  secrets?: Record<string, string>
  configs?: { yandexFolderId?: string }
}) {
  return apiSend<AdminIntegrationsOverview>('/api/admin/integrations', 'PATCH', payload)
}
