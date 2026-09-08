import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addMemberError, canManageProject, inviteEmailMismatch } from './members.mjs'
import { projectJoinUrl } from './access.mjs'

describe('canManageProject', () => {
  it('владелец и админ управляют объектом, сотрудник — нет', () => {
    assert.equal(canManageProject({ access_role: 'owner' }), true)
    assert.equal(canManageProject({ role: 'admin' }), true)
    assert.equal(canManageProject({ role: 'member' }), false)
    assert.equal(canManageProject(null), false)
  })
})

describe('addMemberError', () => {
  it('не пускает владельца и повторное добавление', () => {
    assert.equal(addMemberError({ ownerId: 'a', targetId: 'a' }), 'Этот человек уже владелец объекта')
    assert.equal(
      addMemberError({ ownerId: 'a', targetId: 'b', alreadyMember: true }),
      'Уже в команде объекта',
    )
    assert.equal(addMemberError({ ownerId: 'a', targetId: 'b', blocked: true }), 'Аккаунт заблокирован')
    assert.equal(addMemberError({ ownerId: 'a', targetId: 'b' }), null)
  })
})

describe('inviteEmailMismatch', () => {
  it('сравнивает почту без учёта регистра', () => {
    assert.equal(inviteEmailMismatch('A@B.c', 'a@b.c'), false)
    assert.equal(inviteEmailMismatch('a@b.c', 'other@b.c'), true)
    assert.equal(inviteEmailMismatch('', 'anyone@b.c'), false)
  })
})

describe('projectJoinUrl', () => {
  it('собирает ссылку из PUBLIC_ORIGIN', () => {
    const prev = process.env.PUBLIC_ORIGIN
    process.env.PUBLIC_ORIGIN = 'https://2wel.ru'
    assert.equal(projectJoinUrl({}, 'abc+token'), 'https://2wel.ru/join?invite=abc%2Btoken')
    if (prev === undefined) delete process.env.PUBLIC_ORIGIN
    else process.env.PUBLIC_ORIGIN = prev
  })
})
