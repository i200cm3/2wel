import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseProjectCode, slugifyProjectCode } from './projectCode.mjs'

describe('slugifyProjectCode', () => {
  it('транслит и дефисы', () => {
    assert.equal(slugifyProjectCode(' Плаза '), 'plaza')
    assert.equal(slugifyProjectCode('Сосновый берег'), 'sosnovyj-bereg')
    assert.equal(slugifyProjectCode('DJINAL'), 'djinal')
  })
})

describe('parseProjectCode', () => {
  it('принимает djinal и plaza', () => {
    assert.deepEqual(parseProjectCode('djinal'), { ok: true, code: 'djinal' })
    assert.equal(parseProjectCode('Plaza-2').code, 'plaza-2')
  })

  it('отклоняет зарезервированные', () => {
    const out = parseProjectCode('www')
    assert.equal(out.ok, false)
    assert.match(out.error, /занят/)
  })
})
