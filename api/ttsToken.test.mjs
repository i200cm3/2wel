import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { signTtsToken, verifyTtsToken } from './ttsToken.mjs'

describe('signTtsToken', () => {
  it('подписывает проект и файл', () => {
    const token = signTtsToken('djinal', 'sb_abc123.mp3')
    assert.deepEqual(verifyTtsToken(token), { code: 'djinal', fileName: 'sb_abc123.mp3' })
  })

  it('не подписывает путь с выходом из папки', () => {
    assert.equal(signTtsToken('djinal', '../../secret.mp3'), '')
  })

  it('держит старые имена Джинала с плюсом', () => {
    assert.deepEqual(verifyTtsToken(signTtsToken('djinal', '2-1+.mp3')), {
      code: 'djinal',
      fileName: '2-1+.mp3',
    })
  })
})

describe('verifyTtsToken', () => {
  it('отклоняет подделанную подпись', () => {
    const token = signTtsToken('djinal', 'sb_abc123.mp3')
    const broken = `${token.slice(0, -3)}${token.slice(-3) === 'aaa' ? 'bbb' : 'aaa'}`
    assert.equal(verifyTtsToken(broken), null)
  })

  it('отклоняет мусор', () => {
    assert.equal(verifyTtsToken(''), null)
    assert.equal(verifyTtsToken('nope'), null)
  })
})
