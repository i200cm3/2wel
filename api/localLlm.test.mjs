import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatLocalModelLabel,
  normalizeLocalModelId,
  parseOllamaTagList,
} from './localLlm.mjs'

describe('normalizeLocalModelId', () => {
  it('режет пробелы и пустые', () => {
    assert.equal(normalizeLocalModelId('assembly:latest'), 'assembly')
    assert.equal(normalizeLocalModelId(''), '')
    assert.equal(normalizeLocalModelId('bad name'), 'badname')
    assert.equal(normalizeLocalModelId('', 'assembly'), 'assembly')
  })
})

describe('formatLocalModelLabel', () => {
  it('подписывает алиас assembly', () => {
    assert.equal(formatLocalModelLabel('assembly'), 'Qwen2.5-7B (assembly)')
    assert.equal(formatLocalModelLabel('assembly:latest'), 'Qwen2.5-7B (assembly)')
  })
})

describe('parseOllamaTagList', () => {
  it('кладёт assembly первым и убирает дубли', () => {
    const models = parseOllamaTagList({
      models: [
        { name: 'qwen2.5:7b-instruct-q4_K_M', size: 4700000000 },
        { name: 'assembly', size: 4700000000 },
        { name: 'assembly', size: 1 },
      ],
    })
    assert.equal(models[0]?.id, 'assembly')
    assert.equal(models.length, 2)
    assert.equal(models[1]?.id, 'qwen2.5:7b-instruct-q4_K_M')
  })

  it('пустой payload → []', () => {
    assert.deepEqual(parseOllamaTagList(null), [])
    assert.deepEqual(parseOllamaTagList({}), [])
  })
})
