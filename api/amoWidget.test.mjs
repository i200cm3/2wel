import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAllowedAmoWidgetOrigin,
  isAmoWidgetPath,
  mapWidgetPipelineStatus,
} from './amoWidget.mjs'

describe('amoWidget paths', () => {
  it('матчит status и issue', () => {
    assert.equal(isAmoWidgetPath('/api/v1/projects/plaza/amo-widget/leads/123'), true)
    assert.equal(isAmoWidgetPath('/api/v1/projects/plaza/amo-widget/leads/123/issue'), true)
    assert.equal(isAmoWidgetPath('/api/v1/projects/plaza/links'), false)
  })
})

describe('amoWidget CORS origins', () => {
  it('пускает домены amo/kommo', () => {
    assert.equal(isAllowedAmoWidgetOrigin('https://djinal.amocrm.ru'), true)
    assert.equal(isAllowedAmoWidgetOrigin('https://example.kommo.com'), true)
    assert.equal(isAllowedAmoWidgetOrigin('https://evil.com'), false)
    assert.equal(isAllowedAmoWidgetOrigin('http://localhost:5173'), true)
  })
})

describe('mapWidgetPipelineStatus', () => {
  it('running meta → not ready', () => {
    const out = mapWidgetPipelineStatus({
      meta: { pipeline: 'running', pipelineStep: 'transcribe' },
      publicId: 'abc',
      leadId: '1',
    })
    assert.equal(out.ready, false)
    assert.equal(out.running, true)
    assert.equal(out.pipeline, 'running')
  })

  it('failed → not ready', () => {
    const out = mapWidgetPipelineStatus({
      meta: { pipeline: 'failed', pipelineError: 'boom', pipelineStep: 'extract' },
      publicId: 'abc',
      leadId: '1',
    })
    assert.equal(out.ready, false)
    assert.equal(out.pipeline, 'failed')
    assert.equal(out.pipelineError, 'boom')
  })

  it('ready_pending_amo / empty → ready', () => {
    assert.equal(
      mapWidgetPipelineStatus({
        meta: { pipeline: 'ready_pending_amo', presentationUrl: 'https://x/y' },
        publicId: 'abc',
        leadId: '1',
      }).ready,
      true,
    )
    assert.equal(mapWidgetPipelineStatus({ meta: null, publicId: 'abc', leadId: '1' }).ready, true)
  })
})
