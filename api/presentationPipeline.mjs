/**
 * Полный цикл: звонки → транскрибация → guestSummary → сборка → URL в amo.
 * Webhook отвечает сразу; запись URL в CRM — только после успешной персональной сборки.
 */

import { writeAmoLeadPresentationUrl } from './amoAuth.mjs'
import { syncAmoCallsToLink, probeRecordingUrlsDetailed, recordingProbeAvailability } from './amoCalls.mjs'
import { selectCallsForPresentationPipeline } from './callSourceFilters.mjs'
import { amoError, amoLog } from './amoLog.mjs'
import { geminiTranscribeConfigured, geminiTextConfigured, transcribeAudioFromUrl } from './geminiTranscribe.mjs'
import {
  buildRawTextFromSources,
  extractGuestSummaryFromRawText,
} from './guestSummaryExtract.mjs'
import {
  getProjectLinkDetail,
  getProjectLinkRow,
  listLinkRawSources,
  mergeLinkRawSourceMeta,
  patchLinkSummaryMeta,
  updateLinkRawSource,
} from './links.mjs'
import { guestLinkUrl } from './publicUrl.mjs'
import { recordingUrlFromSource } from './recordingUrl.mjs'
import { reassembleProjectLink } from './cabinet.mjs'

const runningPublicIds = new Set()

/** Единый лог этапов: grep `pipeline.` */
function pipeLog(step, data = {}) {
  amoLog(`pipeline.${step}`, data)
}

function buildTranscribeMeta(existingMeta, { audioUrl, model }) {
  const prev = existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
    ? { ...existingMeta }
    : {}
  const recordingUrl = String(audioUrl ?? prev.recordingUrl ?? '').trim()
  if (recordingUrl) prev.recordingUrl = recordingUrl
  if (model) prev.transcribeModel = model
  prev.transcribedAt = new Date().toISOString()
  return prev
}

async function markPipeline(linkId, patch) {
  try {
    await patchLinkSummaryMeta(linkId, {
      pipelineAt: new Date().toISOString(),
      ...patch,
    })
  } catch (err) {
    console.error('pipeline meta', linkId, err)
  }
}

async function probeAndMarkRecordings(linkId, sources) {
  const items = []
  for (const source of sources) {
    if (source?.meta?.nonTarget === true) continue
    const url = recordingUrlFromSource(source)
    if (!url) continue
    items.push({ sourceId: source.id, url })
  }
  if (!items.length) {
    pipeLog('probe.skip', { linkId, reason: 'no_recording_urls', sources: sources.length })
    return { probed: 0, available: 0 }
  }

  pipeLog('probe.start', { linkId, urls: items.length })
  const t0 = Date.now()
  const results = await probeRecordingUrlsDetailed(items.map((item) => item.url))
  const byUrl = new Map(results.map((item) => [item.url, item]))
  const probedAt = new Date().toISOString()
  let available = 0
  const reasons = {}

  for (const item of items) {
    const probe = byUrl.get(item.url)
    if (!probe) continue
    const existing = sources.find((source) => source.id === item.sourceId)
    const prev = existing?.meta && typeof existing.meta === 'object' ? { ...existing.meta } : {}
    const next = {
      ...prev,
      recordingProbedAt: probedAt,
      ...(probe.reason ? { recordingProbeReason: probe.reason } : {}),
    }
    if (probe.ok) {
      next.recordingAvailable = true
      available += 1
      reasons.ok = (reasons.ok || 0) + 1
    } else {
      const availability = recordingProbeAvailability(probe)
      next.recordingAvailable = availability === 'unavailable' ? false : null
      const key = probe.reason || availability || 'fail'
      reasons[key] = (reasons[key] || 0) + 1
    }
    await mergeLinkRawSourceMeta(linkId, item.sourceId, next)
  }

  pipeLog('probe.done', { linkId, ms: Date.now() - t0, probed: items.length, available, reasons })
  return { probed: items.length, available }
}

async function transcribeEligibleCalls(linkId, eligible, ctx = {}) {
  const transcribed = []
  const failed = []
  const already = eligible.filter((item) => !item.needsTranscribe).length
  const todo = eligible.filter((item) => item.needsTranscribe && item.url)

  if (!geminiTranscribeConfigured()) {
    pipeLog('transcribe.skip', { ...ctx, reason: 'not_configured', todo: todo.length, already })
    return {
      transcribed,
      failed: todo.map((item) => ({
        id: item.source?.id,
        error: 'transcribe_not_configured',
      })),
      skippedConfig: true,
    }
  }

  pipeLog('transcribe.start', { ...ctx, todo: todo.length, already, total: eligible.length })

  for (const item of eligible) {
    if (!item.needsTranscribe || !item.url) {
      if (!item.needsTranscribe) transcribed.push(item.source?.id)
      continue
    }
    const started = Date.now()
    pipeLog('transcribe.item.start', {
      ...ctx,
      sourceId: item.source?.id,
      title: item.source?.title || '',
      urlHost: (() => {
        try {
          return new URL(item.url).host
        } catch {
          return 'invalid'
        }
      })(),
    })
    const result = await transcribeAudioFromUrl(item.url)
    if (!result.ok) {
      failed.push({ id: item.source?.id, error: result.error || 'transcribe_failed' })
      pipeLog('transcribe.item.fail', {
        ...ctx,
        sourceId: item.source?.id,
        ms: Date.now() - started,
        error: result.error,
        status: result.status ?? null,
      })
      continue
    }
    const updated = await updateLinkRawSource(linkId, item.source.id, {
      kind: 'call_transcript',
      title: item.source.title || 'Звонок',
      body: result.text,
      meta: buildTranscribeMeta(item.source.meta, { audioUrl: item.url, model: result.model }),
    })
    if (updated) transcribed.push(updated.id)
    pipeLog('transcribe.item.ok', {
      ...ctx,
      sourceId: item.source?.id,
      ms: Date.now() - started,
      model: result.model,
      textLen: result.text?.length ?? 0,
    })
  }

  pipeLog('transcribe.done', {
    ...ctx,
    transcribed: transcribed.length,
    failed: failed.length,
    failedSample: failed.slice(0, 5),
  })
  return { transcribed, failed, skippedConfig: false }
}

/**
 * @param {{
 *   project: { id: string, code: string },
 *   publicId: string,
 *   connection: object | null,
 *   redirectUri: string,
 *   leadId?: string,
 * }} args
 */
export async function runPresentationPipeline(args) {
  const project = args?.project
  const publicId = String(args?.publicId ?? '').trim()
  const connection = args?.connection ?? null
  const redirectUri = args?.redirectUri ?? ''
  const leadId = String(args?.leadId ?? '').trim()
  const ctx = { project: project?.code || null, publicId, leadId: leadId || null }

  pipeLog('run.start', {
    ...ctx,
    hasConnection: Boolean(connection),
    geminiTranscribe: geminiTranscribeConfigured(),
    geminiText: geminiTextConfigured(),
  })

  if (!project?.id || !publicId) {
    pipeLog('run.abort', { ...ctx, error: 'missing_args' })
    return { ok: false, error: 'missing_args' }
  }
  if (runningPublicIds.has(publicId)) {
    pipeLog('run.abort', { ...ctx, error: 'already_running' })
    return { ok: false, error: 'already_running' }
  }

  runningPublicIds.add(publicId)
  const started = Date.now()
  let linkRow = null
  let step = 'init'

  try {
    step = 'load_link'
    linkRow = await getProjectLinkRow(project.id, publicId)
    if (!linkRow) {
      pipeLog('run.abort', { ...ctx, error: 'link_not_found', step })
      return { ok: false, error: 'link_not_found' }
    }

    const externalId = leadId || String(linkRow.external_id ?? '').trim()
    const runCtx = { ...ctx, linkId: linkRow.id, leadId: externalId || null, guestName: linkRow.guest_name || '' }

    step = 'sync_calls'
    await markPipeline(linkRow.id, {
      pipeline: 'running',
      pipelineError: null,
      pipelineStep: step,
    })
    pipeLog('sync.start', runCtx)

    let syncResult = { inserted: [], found: 0, matched: 0, withRecording: 0 }
    if (connection && externalId) {
      const tSync = Date.now()
      syncResult = await syncAmoCallsToLink({
        connection: { ...connection, projectId: project.id },
        redirectUri,
        linkId: linkRow.id,
        leadId: externalId,
        prune: false,
        requireLive: false,
      })
      pipeLog('sync.done', {
        ...runCtx,
        ms: Date.now() - tSync,
        found: syncResult.found ?? 0,
        matched: syncResult.matched ?? 0,
        inserted: syncResult.inserted?.length ?? 0,
        withRecording: syncResult.withRecording ?? 0,
        error: syncResult.error || null,
      })
      if (syncResult.error) {
        console.warn('pipeline sync', project.code, publicId, syncResult.error)
      }
    } else {
      pipeLog('sync.skip', {
        ...runCtx,
        reason: !connection ? 'no_connection' : 'no_lead_id',
      })
    }

    step = 'probe'
    await markPipeline(linkRow.id, { pipelineStep: step })
    let sources = await listLinkRawSources(linkRow.id)
    pipeLog('sources.loaded', { ...runCtx, count: sources.length })
    const probe = await probeAndMarkRecordings(linkRow.id, sources)
    sources = await listLinkRawSources(linkRow.id)

    step = 'select'
    const { eligible, skipped } = selectCallsForPresentationPipeline(sources)
    pipeLog('select.done', {
      ...runCtx,
      eligible: eligible.length,
      needTranscribe: eligible.filter((item) => item.needsTranscribe).length,
      skipped: skipped.length,
      skippedReasons: skipped.reduce((acc, item) => {
        acc[item.reason] = (acc[item.reason] || 0) + 1
        return acc
      }, {}),
    })

    step = 'transcribe'
    await markPipeline(linkRow.id, { pipelineStep: step })
    const stt = await transcribeEligibleCalls(linkRow.id, eligible, runCtx)

    step = 'extract'
    await markPipeline(linkRow.id, { pipelineStep: step })
    sources = await listLinkRawSources(linkRow.id)
    const packed = buildRawTextFromSources(sources)
    pipeLog('extract.start', {
      ...runCtx,
      packedOk: packed.ok,
      dialogItems: packed.items?.length ?? 0,
      rawTextLen: packed.rawText?.length ?? 0,
      geminiText: geminiTextConfigured(),
      packedError: packed.ok ? null : packed.error,
    })

    let summary = {
      guestName: String(linkRow.guest_name ?? '').trim(),
      dates: '',
      partyType: '',
      room: '',
      topics: '',
      objections: '',
      confidence: '0.4',
      fillRemaining: 'aggressive',
    }
    let summaryMeta = {
      source: 'pipeline',
      prompt: 'guest-summary-extract',
      extractedAt: new Date().toISOString(),
    }
    let extractOk = false

    if (packed.ok && geminiTextConfigured()) {
      const tExtract = Date.now()
      const extracted = await extractGuestSummaryFromRawText(packed.rawText)
      if (extracted.ok) {
        extractOk = true
        summary = {
          ...extracted.summary,
          guestName: String(linkRow.guest_name ?? '').trim() || extracted.summary.guestName || '',
        }
        summaryMeta = {
          ...summaryMeta,
          model: extracted.model,
          source: 'llm',
          explanation: extracted.explanation || '',
          sourceCount: packed.items.length,
        }
        pipeLog('extract.ok', {
          ...runCtx,
          ms: Date.now() - tExtract,
          model: extracted.model,
          topics: summary.topics,
          objections: summary.objections,
          partyType: summary.partyType,
          fillRemaining: summary.fillRemaining,
          confidence: summary.confidence,
        })
      } else {
        summaryMeta.extractError = extracted.error || 'extract_failed'
        pipeLog('extract.fail', {
          ...runCtx,
          ms: Date.now() - tExtract,
          error: extracted.error,
          status: extracted.status ?? null,
        })
      }
    } else if (!packed.ok) {
      summaryMeta.extractError = packed.error
      summaryMeta.source = 'name_only'
      pipeLog('extract.skip', { ...runCtx, reason: 'no_dialogs', error: packed.error })
    } else {
      summaryMeta.extractError = 'extract_not_configured'
      summaryMeta.source = 'name_only'
      pipeLog('extract.skip', { ...runCtx, reason: 'not_configured' })
    }

    step = 'assemble'
    await markPipeline(linkRow.id, { pipelineStep: step })
    const assemblyRules = linkRow.config?.constructorV2?.assembly ?? {}
    pipeLog('assemble.start', {
      ...runCtx,
      guestName: summary.guestName,
      topics: summary.topics,
      objections: summary.objections,
      fillRemaining: summary.fillRemaining,
      maxBlocks: Number(assemblyRules.maxBlocks) || null,
      maxAutoplaySec: Number(assemblyRules.maxAutoplaySec) || null,
    })
    const tAssemble = Date.now()
    const assembled = await reassembleProjectLink(project, publicId, {
      name: summary.guestName || linkRow.guest_name,
      summary,
      summaryMeta: {
        ...summaryMeta,
        pipeline: 'ready',
        pipelineAt: new Date().toISOString(),
        pipelineStep: 'done',
        callsFound: syncResult.found ?? 0,
        callsEligible: eligible.length,
        callsTranscribed: stt.transcribed.length,
        callsFailed: stt.failed.length,
        callsSkipped: skipped.length,
        recordingsProbed: probe.probed,
        recordingsAvailable: probe.available,
        extractOk,
        maxBlocks: Number(assemblyRules.maxBlocks) || null,
        maxAutoplaySec: Number(assemblyRules.maxAutoplaySec) || null,
      },
    })

    if (assembled.error || assembled.status >= 400) {
      pipeLog('assemble.fail', {
        ...runCtx,
        ms: Date.now() - tAssemble,
        error: assembled.error,
        status: assembled.status,
      })
      await markPipeline(linkRow.id, {
        pipeline: 'failed',
        pipelineStep: 'assemble',
        pipelineError: assembled.error || `status_${assembled.status}`,
      })
      return {
        ok: false,
        error: assembled.error || 'assemble_failed',
        status: assembled.status,
      }
    }

    const flowLen = Array.isArray(assembled.link?.derivedFlow)
      ? assembled.link.derivedFlow.length
      : Array.isArray(assembled.derivedFlow)
        ? assembled.derivedFlow.length
        : null
    pipeLog('assemble.ok', {
      ...runCtx,
      ms: Date.now() - tAssemble,
      flowLen,
    })

    const detail = assembled.link || (await getProjectLinkDetail(project.id, publicId))
    const url = detail?.url || guestLinkUrl(project.code, publicId)

    let writtenToAmo = false
    if (connection && externalId && url) {
      step = 'write_amo'
      await markPipeline(linkRow.id, { pipelineStep: step })
      pipeLog('write_amo.start', { ...runCtx, url })
      try {
        const tWrite = Date.now()
        await writeAmoLeadPresentationUrl(connection, externalId, url, redirectUri)
        writtenToAmo = true
        pipeLog('write_amo.ok', { ...runCtx, url, ms: Date.now() - tWrite })
      } catch (err) {
        amoError('pipeline.write_amo', err, { project: project.code, publicId, leadId: externalId })
        pipeLog('write_amo.fail', { ...runCtx, url, error: err?.message || String(err) })
        await markPipeline(linkRow.id, {
          pipeline: 'ready',
          pipelineStep: 'write_amo_failed',
          pipelineError: err?.message || String(err),
          writtenToAmo: false,
        })
        return {
          ok: true,
          url,
          writtenToAmo: false,
          error: 'amo_write_failed',
          ms: Date.now() - started,
        }
      }
    } else {
      pipeLog('write_amo.skip', {
        ...runCtx,
        url,
        reason: !connection ? 'no_connection' : !externalId ? 'no_lead_id' : 'no_url',
      })
    }

    await markPipeline(linkRow.id, {
      pipeline: 'ready',
      pipelineStep: 'done',
      pipelineError: null,
      writtenToAmo,
      presentationUrl: url,
    })

    pipeLog('run.done', {
      ...runCtx,
      ms: Date.now() - started,
      eligible: eligible.length,
      transcribed: stt.transcribed.length,
      extractOk,
      writtenToAmo,
      url,
    })

    return {
      ok: true,
      url,
      writtenToAmo,
      extractOk,
      eligible: eligible.length,
      transcribed: stt.transcribed.length,
      ms: Date.now() - started,
    }
  } catch (err) {
    amoError('pipeline', err, { project: project?.code, publicId, step })
    pipeLog('run.crash', {
      ...ctx,
      step,
      error: err?.message || String(err),
      stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | '),
      ms: Date.now() - started,
    })
    if (linkRow?.id) {
      await markPipeline(linkRow.id, {
        pipeline: 'failed',
        pipelineStep: step,
        pipelineError: err?.message || String(err),
      })
    }
    return { ok: false, error: err?.message || String(err) }
  } finally {
    runningPublicIds.delete(publicId)
  }
}

/** Fire-and-forget после webhook: не блокирует ответ Salesbot. */
export function schedulePresentationPipeline(args) {
  pipeLog('schedule', {
    project: args?.project?.code || null,
    publicId: args?.publicId || null,
    leadId: args?.leadId || null,
    hasConnection: Boolean(args?.connection),
  })
  // Не unref: пайплайн должен гарантированно стартовать после ответа webhook.
  const timer = setTimeout(() => {
    pipeLog('schedule.fire', {
      project: args?.project?.code || null,
      publicId: args?.publicId || null,
    })
    void runPresentationPipeline(args).catch((err) => {
      pipeLog('schedule.unhandled', {
        project: args?.project?.code || null,
        publicId: args?.publicId || null,
        error: err?.message || String(err),
      })
      console.error('pipeline schedule', args?.project?.code, args?.publicId, err)
    })
  }, 0)
  return timer
}
