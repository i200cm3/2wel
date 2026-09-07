import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adminRoleChangeError } from './users.mjs'

describe('adminRoleChangeError', () => {
  it('запрещает менять свою роль', () => {
    assert.equal(
      adminRoleChangeError({
        actorId: 'a',
        targetId: 'a',
        makingAdmin: true,
        targetIsAdmin: false,
        adminCount: 2,
      }),
      'Нельзя менять роль своего аккаунта',
    )
  })

  it('запрещает снимать последнего администратора', () => {
    assert.equal(
      adminRoleChangeError({
        actorId: 'a',
        targetId: 'b',
        makingAdmin: false,
        targetIsAdmin: true,
        adminCount: 1,
      }),
      'Нельзя снять последнего администратора',
    )
  })

  it('разрешает выдать и снять роль, если админов больше одного', () => {
    assert.equal(
      adminRoleChangeError({
        actorId: 'a',
        targetId: 'b',
        makingAdmin: true,
        targetIsAdmin: false,
        adminCount: 1,
      }),
      null,
    )
    assert.equal(
      adminRoleChangeError({
        actorId: 'a',
        targetId: 'b',
        makingAdmin: false,
        targetIsAdmin: true,
        adminCount: 2,
      }),
      null,
    )
  })
})
