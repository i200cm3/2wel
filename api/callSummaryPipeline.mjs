/**
 * Авто-саммари звонка → короткая заметка в amo.
 * По умолчанию — все воронки/этапы.
 * Ограничение (опционально): AMO_CALL_SUMMARY_PIPELINE_IDS / AMO_CALL_SUMMARY_STATUS_IDS.
 */

import { amoApi, fetchAmoLeadSnapshot } from './amoAuth.mjs'
import {
  claimAmoCallSummary,
  listAmoCallSummariesNeedingRecordingRetry,
  markAmoCallSummaryRunning,
  patchAmoCallSummary,
} from './amoCallSummaries.mjs'
import {
  callDirectionFromNoteType,
  callParamsMetaFromAmoNote,
  fetchAmoNote,
  fetchLeadIdsForContact,
  fetchNotesByIds,
  isUnansweredAmoCallNote,
  parseCallNoteFromAmo,
  phonesFromAmoCallNote,
  probeRecordingUrlsDetailed,
  recordingProbeAvailability,
} from './amoCalls.mjs'
import { amoError, amoLog, amoWarn } from './amoLog.mjs'
import {
  extractAmoNoteEvents,
  extractContactIdsFromNoteWebhook,
  extractLeadIdsFromNoteWebhook,
  extractPhonesFromAmoWebhook,
  isCallLikeNoteType,
  shouldSyncCallsFromNoteEvents,
} from './amoWebhook.mjs'
import { NON_TARGET_CALL_MAX_SEC } from './callSourceFilters.mjs'
import { extractCallSummaryFromTranscript } from './callSummaryExtract.mjs'
import { transcribeAudioFromUrl } from './gigaamTranscribe.mjs'
import { findLinksForAmoCall } from './links.mjs'
import { isTranscribeConfigured } from './platformIntegrations.mjs'
import { assemblyTextConfigured } from './yandexGpt.mjs'

const runningKeys = new Set()
/** Sipuni часто дописывает link в note с задержкой — ждём дольше и перечитываем note. */
const CALL_SUMMARY_RETRY_MS = [20_000, 60_000, 180_000, 600_000, 1_200_000]
const CALL_SUMMARY_SWEEP_MS = 120_000
const CALL_SUMMARY_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000
const CALL_SUMMARY_SWEEP_MIN_AGE_MS = 45_000
const CALL_SUMMARY_SWEEP_BATCH = 25
let sweepTimer = null
let sweepRunning = false

function parseIdSet(raw) {
  return new Set(
    String(raw ?? '')
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

/** Пусто = все воронки. Не наследует AMO_ISSUE_*. */
export function callSummaryPipelineAllowlist() {
  return parseIdSet(process.env.AMO_CALL_SUMMARY_PIPELINE_IDS)
}

/** Пусто = все этапы. Не наследует AMO_ISSUE_*. */
export function callSummaryStatusAllowlist() {
  return parseIdSet(process.env.AMO_CALL_SUMMARY_STATUS_IDS)
}

/**
 * Пустые списки = разрешено всё.
 * Если задан pipeline и/или status — фильтруем только по ним.
 */
export function isCallSummaryAllowed(pipelineId, statusId) {
  const pipelines = callSummaryPipelineAllowlist()
  const statuses = callSummaryStatusAllowlist()
  if (!pipelines.size && !statuses.size) return true
  const pipe = String(pipelineId ?? '').trim()
  const status = String(statusId ?? '').trim()
  if (pipelines.size && !pipelines.has(pipe)) return false
  if (statuses.size && !statuses.has(status)) return false
  return true
}

export function isCallSummaryFeatureConfigured() {
  return true
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!total) return ''
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function formatRuCallWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatCallSummaryNoteText({
  direction = '',
  capturedAt = null,
  durationSec = null,
  outcome = '',
  nextStep = '',
} = {}) {
  const dir =
    direction === 'in' ? 'Входящий' : direction === 'out' ? 'Исходящий' : 'Звонок'
  const when = formatRuCallWhen(capturedAt)
  const dur = formatDuration(durationSec)
  const head = [dir, when, dur].filter(Boolean).join(' · ')
  const outcomeLine = String(outcome ?? '').trim() || 'Итог неясен'
  const nextLine = String(nextStep ?? '').trim() || 'Уточнить интерес при следующем контакте'
  return `${head}\n\nИтог: ${outcomeLine}\n\nСледующий шаг: ${nextLine}`
}

/**
 * Отдельная заметка-разбор: только при упущенном закрытии.
 * Цвет через API amo недоступен — визуальный маркер + закрепление.
 */
export function formatOperatorReviewNoteText({ miss = '', detail = '' } = {}) {
  const missLine = String(miss ?? '').trim() || 'Недоработка при возможности закрыть сделку'
  const detailLine = String(detail ?? '').trim()
  const body = detailLine && detailLine !== missLine ? `${missLine}\n\n${detailLine}` : missLine
  return `⚠ РАЗБОР ОПЕРАТОРА (упущена бронь)\n\n${body}`
}

export async function writeAmoLeadCommonNote(connection, leadId, text, redirectUri) {
  const id = String(leadId ?? '').trim()
  const bodyText = String(text ?? '').trim()
  if (!id) return { ok: false, error: 'no lead' }
  if (!bodyText) return { ok: false, error: 'empty note' }
  const body = await amoApi(connection, `/api/v4/leads/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    redirectUri,
    body: [{ note_type: 'common', params: { text: bodyText } }],
  })
  const note = Array.isArray(body?._embedded?.notes) ? body._embedded.notes[0] : null
  return {
    ok: true,
    noteId: note?.id != null ? String(note.id) : '',
  }
}

export async function pinAmoLeadNote(connection, noteId, redirectUri) {
  const id = String(noteId ?? '').trim()
  if (!id) return { ok: false, error: 'no note' }
  await amoApi(connection, `/api/v4/leads/notes/${encodeURIComponent(id)}/pin`, {
    method: 'POST',
    redirectUri,
  })
  return { ok: true }
}

function runKey(projectId, callNoteId) {
  return `${projectId}:${callNoteId}`
}

function scheduleRetry(run, delayMs) {
  const timer = setTimeout(() => {
    void run().catch((err) => amoError('call_summary.retry', err, {}))
  }, delayMs)
  if (typeof timer.unref === 'function') timer.unref()
}

function directionFromNote(note) {
  return callDirectionFromNoteType(note?.note_type)
}

function durationSecFromParsed(parsed) {
  const n = Number(parsed?.meta?.durationSec)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/**
 * Выбрать leadId для саммари.
 * Sipuni часто пишет звонок на контакт с десятками сделок — тогда:
 * 1) явный lead из webhook/заметки
 * 2) уже выданные ссылки презентации (findLinksForAmoCall)
 * 3) сделки контакта на allowlist-этапе (Тест)
 */
export async function resolveCallSummaryLeadId({
  connection,
  redirectUri,
  preferredLeadId = '',
  candidateLeadIds = [],
  linkLeadIds = [],
  note = null,
}) {
  const preferred = String(preferredLeadId ?? '').trim()
  if (preferred) return preferred

  const entityType = String(note?.entity_type ?? note?.element_type ?? '').toLowerCase()
  const entityId = String(note?.entity_id ?? note?.element_id ?? '').trim()
  if (entityId && (entityType === 'lead' || entityType === 'leads' || entityType === '2')) {
    return entityId
  }

  const fromLinks = [...new Set((linkLeadIds || []).map((id) => String(id ?? '').trim()).filter(Boolean))]
  const candidates = [
    ...new Set([
      ...fromLinks,
      ...(candidateLeadIds || []).map((id) => String(id ?? '').trim()).filter(Boolean),
    ]),
  ]
  if (!candidates.length) return ''

  const allowed = []
  const probeLimit = Math.min(candidates.length, 40)
  for (const leadId of candidates.slice(0, probeLimit)) {
    try {
      const snap = await fetchAmoLeadSnapshot(connection, leadId, redirectUri)
      if (isCallSummaryAllowed(snap.pipelineId, snap.statusId)) allowed.push(leadId)
    } catch (err) {
      amoWarn('call_summary.lead_probe', { leadId, error: err?.message || String(err) })
    }
  }

  if (!allowed.length) return ''

  // Предпочитаем сделку, у которой уже есть ссылка презентации.
  const linkSet = new Set(fromLinks)
  const preferredAllowed = allowed.find((id) => linkSet.has(id))
  if (preferredAllowed) return preferredAllowed

  if (allowed.length > 1) {
    amoWarn('call_summary.multi_lead', { allowed: allowed.slice(0, 5), picked: allowed[0] })
  }
  return allowed[0]
}

/** Собрать кандидатов leadId: ссылки + сделки контакта (даже shared >25). */
export async function collectCallSummaryLeadCandidates({
  projectId,
  connection,
  redirectUri,
  body,
  noteEvents = [],
  notes = [],
}) {
  const leadIds = new Set(extractLeadIdsFromNoteWebhook(body))
  const contactIds = new Set(extractContactIdsFromNoteWebhook(body))
  const phones = new Set(extractPhonesFromAmoWebhook(body))

  for (const event of noteEvents) {
    if (event.leadId) leadIds.add(event.leadId)
    if (event.contactId) contactIds.add(event.contactId)
  }

  for (const note of notes) {
    const type = String(note?.entity_type ?? note?.element_type ?? '').toLowerCase()
    const id = String(note?.entity_id ?? note?.element_id ?? '').trim()
    if (!id) continue
    if (type === 'lead' || type === 'leads' || type === '2') leadIds.add(id)
    else if (type === 'contact' || type === 'contacts' || type === '1') contactIds.add(id)
    for (const phone of phonesFromAmoCallNote(note)) phones.add(phone)
  }

  let linkLeadIds = []
  try {
    const links = await findLinksForAmoCall(projectId, {
      leadIds: [...leadIds],
      contactIds: [...contactIds],
      phones: [...phones],
    })
    linkLeadIds = links.map((row) => String(row.externalId || '').trim()).filter(Boolean)
    for (const id of linkLeadIds) leadIds.add(id)
  } catch (err) {
    amoWarn('call_summary.find_links', { error: err?.message || String(err) })
  }

  // Shared contact: не отбрасываем сделки — фильтр по Тест сделает resolveCallSummaryLeadId.
  for (const contactId of [...contactIds].slice(0, 3)) {
    try {
      const ids = await fetchLeadIdsForContact(connection, contactId, redirectUri)
      for (const id of ids) leadIds.add(id)
    } catch (err) {
      amoWarn('call_summary.contact_leads', { contactId, error: err?.message || String(err) })
    }
  }

  return {
    candidateLeadIds: [...leadIds],
    linkLeadIds: [...new Set(linkLeadIds)],
    contactIds: [...contactIds],
    phones: [...phones],
  }
}

async function processOneCallSummary({
  projectId,
  projectCode,
  connection,
  redirectUri,
  leadId,
  note,
  retryIndex = 0,
}) {
  const callNoteId = note?.id != null ? String(note.id) : ''
  if (!projectId || !callNoteId) return { ok: false, reason: 'bad_args' }

  const key = runKey(projectId, callNoteId)
  if (runningKeys.has(key)) return { ok: false, reason: 'already_running' }
  runningKeys.add(key)

  const ctx = { project: projectCode, leadId, callNoteId, retryIndex }

  try {
    if (!isCallSummaryFeatureConfigured()) {
      amoLog('call_summary.skip', { ...ctx, reason: 'allowlist_empty' })
      return { ok: false, reason: 'allowlist_empty' }
    }

    // Webhook часто приходит до того, как Sipuni дописал link — всегда берём свежий note.
    let liveNote = note
    try {
      const fresh = await fetchAmoNote(connection, callNoteId, redirectUri)
      if (fresh?.id != null) liveNote = fresh
    } catch (err) {
      amoWarn('call_summary.note_refresh', {
        ...ctx,
        error: err?.message || String(err),
      })
    }

    const parsed = parseCallNoteFromAmo(liveNote)
    const meta = callParamsMetaFromAmoNote(liveNote)
    const recordingUrl = parsed?.body || meta.recordingUrl || ''
    const durationSec = durationSecFromParsed(parsed) ?? meta.durationSec

    const snap = leadId ? await fetchAmoLeadSnapshot(connection, leadId, redirectUri) : null
    const pipelineId = snap?.pipelineId || ''
    const statusId = snap?.statusId || ''

    await claimAmoCallSummary({
      projectId,
      leadId: leadId || '0',
      callNoteId,
      recordingUrl: recordingUrl || null,
      pipelineId: pipelineId || null,
      statusId: statusId || null,
      durationSec,
    })

    if (!leadId) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'no_lead',
      })
      amoLog('call_summary.skip', { ...ctx, reason: 'no_lead' })
      return { ok: false, reason: 'no_lead' }
    }

    if (!isCallSummaryAllowed(pipelineId, statusId)) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'pipeline_not_allowed',
        pipelineId,
        statusId,
        leadId,
      })
      amoLog('call_summary.skip', {
        ...ctx,
        reason: 'pipeline_not_allowed',
        pipelineId,
        statusId,
      })
      return { ok: false, reason: 'pipeline_not_allowed' }
    }

    if (isUnansweredAmoCallNote(liveNote)) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'unanswered',
        durationSec: durationSec ?? 0,
        leadId,
      })
      amoLog('call_summary.skip', {
        ...ctx,
        reason: 'unanswered',
        callResult: meta.callResult || null,
        callStatus: meta.callStatus,
        durationSec,
      })
      return { ok: false, reason: 'unanswered' }
    }

    if (durationSec != null && durationSec < NON_TARGET_CALL_MAX_SEC) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'short_call',
        durationSec,
        leadId,
      })
      amoLog('call_summary.skip', { ...ctx, reason: 'short_call', durationSec })
      return { ok: false, reason: 'short_call' }
    }

    if (!recordingUrl) {
      const delay = CALL_SUMMARY_RETRY_MS[retryIndex]
      if (delay != null) {
        await patchAmoCallSummary(projectId, callNoteId, {
          status: 'pending',
          error: null,
          skipReason: null,
          leadId,
        })
        amoLog('call_summary.retry', { ...ctx, reason: 'no_recording_url', delayMs: delay })
        scheduleRetry(
          () =>
            processOneCallSummary({
              projectId,
              projectCode,
              connection,
              redirectUri,
              leadId,
              note: liveNote,
              retryIndex: retryIndex + 1,
            }),
          delay,
        )
        return { ok: false, reason: 'no_recording_url', retry: true }
      }
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'no_recording_url',
        leadId,
      })
      amoLog('call_summary.skip', { ...ctx, reason: 'no_recording_url' })
      return { ok: false, reason: 'no_recording_url' }
    }

    const claimed = await markAmoCallSummaryRunning(projectId, callNoteId)
    if (!claimed) {
      amoLog('call_summary.skip', { ...ctx, reason: 'not_claimable' })
      return { ok: false, reason: 'not_claimable' }
    }

    if (!(await isTranscribeConfigured())) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'failed',
        error: 'transcribe_not_configured',
      })
      return { ok: false, reason: 'transcribe_not_configured' }
    }
    if (!(await assemblyTextConfigured())) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'failed',
        error: 'summary_not_configured',
      })
      return { ok: false, reason: 'summary_not_configured' }
    }

    const probes = await probeRecordingUrlsDetailed([recordingUrl])
    const availability = recordingProbeAvailability(probes[0])
    // Sipuni часто отвечает «недоступно» первые секунды после звонка — ретраим как transient.
    if (availability === 'unavailable' || availability == null) {
      const delay = CALL_SUMMARY_RETRY_MS[retryIndex]
      if (delay != null) {
        await patchAmoCallSummary(projectId, callNoteId, {
          status: 'pending',
          error: null,
          skipReason: null,
          recordingUrl,
        })
        amoLog('call_summary.retry', {
          ...ctx,
          reason: availability === 'unavailable' ? 'recording_not_ready' : 'recording_probe_transient',
          delayMs: delay,
          probeStatus: probes[0]?.status ?? null,
          probeReason: probes[0]?.reason ?? null,
        })
        scheduleRetry(
          () =>
            processOneCallSummary({
              projectId,
              projectCode,
              connection,
              redirectUri,
              leadId,
              note: liveNote,
              retryIndex: retryIndex + 1,
            }),
          delay,
        )
        return {
          ok: false,
          reason: availability === 'unavailable' ? 'recording_not_ready' : 'recording_probe_transient',
          retry: true,
        }
      }
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'skipped',
        skipReason: 'recording_unavailable',
      })
      amoLog('call_summary.skip', {
        ...ctx,
        reason: 'recording_unavailable',
        probeStatus: probes[0]?.status ?? null,
        probeReason: probes[0]?.reason ?? null,
      })
      return { ok: false, reason: 'recording_unavailable' }
    }

    amoLog('call_summary.transcribe.start', ctx)
    const stt = await transcribeAudioFromUrl(recordingUrl)
    if (!stt.ok || !String(stt.text ?? '').trim()) {
      const delay = CALL_SUMMARY_RETRY_MS[retryIndex]
      const err = stt.error || 'transcribe_failed'
      if (delay != null && (stt.retryable || /timeout|502|503|429/i.test(String(err)))) {
        await patchAmoCallSummary(projectId, callNoteId, { status: 'pending', error: err })
        scheduleRetry(
          () =>
            processOneCallSummary({
              projectId,
              projectCode,
              connection,
              redirectUri,
              leadId,
              note: liveNote,
              retryIndex: retryIndex + 1,
            }),
          delay,
        )
        return { ok: false, reason: 'transcribe_retry', retry: true }
      }
      await patchAmoCallSummary(projectId, callNoteId, { status: 'failed', error: err })
      amoError('call_summary.transcribe', new Error(err), ctx)
      return { ok: false, reason: 'transcribe_failed' }
    }

    const transcript = String(stt.text).trim()
    await patchAmoCallSummary(projectId, callNoteId, { transcript })

    amoLog('call_summary.extract.start', { ...ctx, chars: transcript.length })
    const extracted = await extractCallSummaryFromTranscript(transcript)
    if (!extracted.ok) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'failed',
        error: extracted.error || 'extract_failed',
      })
      amoError('call_summary.extract', new Error(extracted.error || 'extract_failed'), ctx)
      return { ok: false, reason: 'extract_failed' }
    }

    const noteText = formatCallSummaryNoteText({
      direction: directionFromNote(note),
      capturedAt: parsed?.capturedAt || null,
      durationSec,
      outcome: extracted.outcome,
      nextStep: extracted.nextStep,
    })

    const written = await writeAmoLeadCommonNote(connection, leadId, noteText, redirectUri)
    if (!written.ok) {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'failed',
        error: written.error || 'amo_note_failed',
        summaryOutcome: extracted.outcome,
        summaryNextStep: extracted.nextStep,
        operatorReviewMiss: extracted.operatorReview?.miss || null,
        operatorReviewDetail: extracted.operatorReview?.detail || null,
      })
      return { ok: false, reason: 'amo_note_failed' }
    }

    let operatorReviewNoteId = null
    const review = extracted.operatorReview
    if (review) {
      const reviewText = formatOperatorReviewNoteText(review)
      try {
        const reviewWritten = await writeAmoLeadCommonNote(
          connection,
          leadId,
          reviewText,
          redirectUri,
        )
        if (reviewWritten.ok && reviewWritten.noteId) {
          operatorReviewNoteId = reviewWritten.noteId
          try {
            await pinAmoLeadNote(connection, operatorReviewNoteId, redirectUri)
          } catch (pinErr) {
            amoWarn('call_summary.operator_review.pin', {
              ...ctx,
              noteId: operatorReviewNoteId,
              error: pinErr?.message || String(pinErr),
            })
          }
        } else {
          amoWarn('call_summary.operator_review.note', {
            ...ctx,
            error: reviewWritten.error || 'empty',
          })
        }
      } catch (reviewErr) {
        amoWarn('call_summary.operator_review', {
          ...ctx,
          error: reviewErr?.message || String(reviewErr),
        })
      }
    }

    await patchAmoCallSummary(projectId, callNoteId, {
      status: 'done',
      summaryOutcome: extracted.outcome,
      summaryNextStep: extracted.nextStep,
      summaryNoteId: written.noteId || null,
      operatorReviewMiss: review?.miss || null,
      operatorReviewDetail: review?.detail || null,
      operatorReviewNoteId,
      error: null,
      skipReason: null,
    })

    amoLog('call_summary.done', {
      ...ctx,
      summaryNoteId: written.noteId || null,
      operatorReviewNoteId,
      hasOperatorReview: Boolean(review),
      reviewPass: extracted.reviewPass || null,
      model: extracted.model || null,
      reviewModel: extracted.reviewModel || null,
      sttModel: stt.model || null,
    })
    return {
      ok: true,
      summaryNoteId: written.noteId,
      operatorReviewNoteId,
    }
  } catch (err) {
    amoError('call_summary', err, ctx)
    try {
      await patchAmoCallSummary(projectId, callNoteId, {
        status: 'failed',
        error: err?.message || String(err),
      })
    } catch {
      /* ignore */
    }
    return { ok: false, reason: 'exception' }
  } finally {
    runningKeys.delete(key)
  }
}

/**
 * После webhook о звонке: для каждого call note — саммари, если сделка на этапе allowlist.
 */
export async function scheduleCallSummariesFromNoteWebhook(
  key,
  connection,
  redirectUri,
  body,
  noteEvents,
  { resolveLeadIds } = {},
) {
  if (!isCallSummaryFeatureConfigured()) {
    amoLog('call_summary.skip', {
      project: key?.project?.code || null,
      reason: 'allowlist_empty',
    })
    return { scheduled: 0, reason: 'allowlist_empty' }
  }

  const events = Array.isArray(noteEvents) ? noteEvents : extractAmoNoteEvents(body)
  if (events.length && !shouldSyncCallsFromNoteEvents(events)) {
    return { scheduled: 0, reason: 'not_a_call_note' }
  }

  const noteIds = [...new Set(events.map((event) => event.noteId).filter(Boolean))]
  if (!noteIds.length) return { scheduled: 0, reason: 'no_note_ids' }

  let notes = []
  try {
    notes = await fetchNotesByIds(connection, noteIds, redirectUri)
  } catch (err) {
    amoError('call_summary.fetch_notes', err, { project: key.project.code, noteIds })
    return { scheduled: 0, reason: 'fetch_notes_failed' }
  }

  const leadHintByNote = new Map()
  for (const event of events) {
    if (event.noteId && event.leadId) leadHintByNote.set(event.noteId, event.leadId)
  }
  for (const id of extractLeadIdsFromNoteWebhook(body)) {
    if (id && noteIds.length === 1 && !leadHintByNote.has(noteIds[0])) {
      leadHintByNote.set(noteIds[0], id)
    }
  }

  const collected = await collectCallSummaryLeadCandidates({
    projectId: key.project.id,
    connection,
    redirectUri,
    body,
    noteEvents: events,
    notes,
  })

  let extraLeadIds = []
  if (typeof resolveLeadIds === 'function') {
    try {
      extraLeadIds = await resolveLeadIds()
    } catch (err) {
      amoWarn('call_summary.resolve_leads', { error: err?.message || String(err) })
    }
  }

  const candidateLeadIds = [
    ...new Set([...(collected.candidateLeadIds || []), ...extraLeadIds.map(String)]),
  ]

  amoLog('call_summary.resolve', {
    project: key.project.code,
    noteIds,
    candidates: candidateLeadIds.length,
    linkLeads: collected.linkLeadIds?.length || 0,
    contacts: collected.contactIds?.length || 0,
  })

  let scheduled = 0
  for (const note of notes) {
    const callNoteId = note?.id != null ? String(note.id) : ''
    if (!callNoteId) continue
    const noteType = String(note?.note_type ?? '').toLowerCase()
    if (!isCallLikeNoteType(noteType) && !parseCallNoteFromAmo(note)) continue

    const preferredLeadId = leadHintByNote.get(callNoteId) || ''
    const leadId = await resolveCallSummaryLeadId({
      connection,
      redirectUri,
      preferredLeadId,
      candidateLeadIds,
      linkLeadIds: collected.linkLeadIds,
      note,
    })

    scheduled += 1
    void processOneCallSummary({
      projectId: key.project.id,
      projectCode: key.project.code,
      connection: { ...connection, projectId: key.project.id },
      redirectUri,
      leadId,
      note,
      retryIndex: 0,
    }).catch((err) => amoError('call_summary.schedule', err, { callNoteId }))
  }

  amoLog('call_summary.scheduled', {
    project: key.project.code,
    scheduled,
    noteIds,
  })
  return { scheduled }
}

/** Перезапуск одного звонка (после фикса no_lead и т.п.). */
export async function reprocessCallSummaryNote({
  projectId,
  projectCode,
  connection,
  redirectUri,
  callNoteId,
  leadId = '',
}) {
  const id = String(callNoteId ?? '').trim()
  if (!id) return { ok: false, reason: 'no_note_id' }
  const notes = await fetchNotesByIds(connection, [id], redirectUri)
  const note = notes[0]
  if (!note) return { ok: false, reason: 'note_not_found' }

  await patchAmoCallSummary(projectId, id, {
    status: 'pending',
    skipReason: null,
    error: null,
  }).catch(() => undefined)

  let resolvedLeadId = String(leadId ?? '').trim()
  if (!resolvedLeadId) {
    const collected = await collectCallSummaryLeadCandidates({
      projectId,
      connection,
      redirectUri,
      body: {},
      noteEvents: [{ noteId: id, leadId: '', contactId: '', noteType: String(note.note_type || '') }],
      notes: [note],
    })
    resolvedLeadId = await resolveCallSummaryLeadId({
      connection,
      redirectUri,
      candidateLeadIds: collected.candidateLeadIds,
      linkLeadIds: collected.linkLeadIds,
      note,
    })
  }

  return processOneCallSummary({
    projectId,
    projectCode,
    connection: { ...connection, projectId },
    redirectUri,
    leadId: resolvedLeadId,
    note,
    retryIndex: 0,
  })
}

/**
 * Фоновый обход: Sipuni часто дописывает recording URL после webhook.
 * Поднимает pending / skipped(no_recording_url|recording_unavailable|no_lead).
 */
export async function sweepCallSummariesWaitingForRecording(redirectUri) {
  if (sweepRunning) return { ok: true, skipped: true, reason: 'already_running' }
  sweepRunning = true
  try {
    const rows = await listAmoCallSummariesNeedingRecordingRetry({
      minAgeMs: CALL_SUMMARY_SWEEP_MIN_AGE_MS,
      maxAgeMs: CALL_SUMMARY_SWEEP_MAX_AGE_MS,
      limit: CALL_SUMMARY_SWEEP_BATCH,
    })
    if (!rows.length) return { ok: true, scheduled: 0 }

    const { getAmoConnection } = await import('./amoConnections.mjs')
    let scheduled = 0
    for (const row of rows) {
      const projectId = row.projectId
      const callNoteId = row.callNoteId
      if (!projectId || !callNoteId) continue
      if (runningKeys.has(runKey(projectId, callNoteId))) continue
      try {
        const connection = await getAmoConnection(projectId)
        if (!connection) continue
        await patchAmoCallSummary(projectId, callNoteId, {
          status: 'pending',
          skipReason: null,
          error: null,
        })
        void reprocessCallSummaryNote({
          projectId,
          projectCode: row.projectCode || '',
          connection: { ...connection, projectId },
          redirectUri,
          callNoteId,
          leadId: row.leadId && row.leadId !== '0' ? row.leadId : '',
        }).catch((err) =>
          amoError('call_summary.sweep.one', err, {
            project: row.projectCode,
            callNoteId,
          }),
        )
        scheduled += 1
      } catch (err) {
        amoWarn('call_summary.sweep.item', {
          project: row.projectCode,
          callNoteId,
          error: err?.message || String(err),
        })
      }
    }
    amoLog('call_summary.sweep', { scheduled, candidates: rows.length })
    return { ok: true, scheduled, candidates: rows.length }
  } finally {
    sweepRunning = false
  }
}

export function startCallSummaryRecordingSweeper(redirectUri) {
  if (sweepTimer) return
  const run = () => {
    void sweepCallSummariesWaitingForRecording(redirectUri).catch((err) =>
      amoError('call_summary.sweep', err, {}),
    )
  }
  sweepTimer = setInterval(run, CALL_SUMMARY_SWEEP_MS)
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
  // Первый проход чуть позже старта, чтобы не бить API сразу при boot.
  const first = setTimeout(run, 20_000)
  if (typeof first.unref === 'function') first.unref()
  amoLog('call_summary.sweep.start', { everyMs: CALL_SUMMARY_SWEEP_MS })
}
