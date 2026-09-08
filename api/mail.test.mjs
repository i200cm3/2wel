import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatFrom,
  isLeakedSmtpPass,
  mailEnv,
  otpMail,
  passwordResetMail,
  smtpReady,
} from './mail.mjs'

describe('mailEnv', () => {
  it('по умолчанию SpaceWeb и support@2wel.ru', () => {
    const prev = { ...process.env }
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS
    delete process.env.MAIL_FROM
    const env = mailEnv()
    assert.equal(env.host, 'smtp.spaceweb.ru')
    assert.equal(env.port, 465)
    assert.equal(env.secure, true)
    assert.equal(env.user, 'support@2wel.ru')
    assert.equal(env.from, 'support@2wel.ru')
    assert.equal(smtpReady(env), false)
    Object.assign(process.env, prev)
  })
})

describe('isLeakedSmtpPass', () => {
  it('ловит известный утёкший пароль', () => {
    assert.equal(isLeakedSmtpPass('950201712Wel'), true)
    assert.equal(isLeakedSmtpPass('fresh-password'), false)
    assert.equal(isLeakedSmtpPass(''), false)
  })

  it('smtpReady=false для утёкшего пароля', () => {
    assert.equal(
      smtpReady({
        host: 'smtp.spaceweb.ru',
        user: 'support@2wel.ru',
        pass: '950201712Wel',
        from: 'support@2wel.ru',
      }),
      false,
    )
  })
})

describe('passwordResetMail', () => {
  it('From совпадает с ящиком, в письме есть ссылка', () => {
    const env = {
      from: 'support@2wel.ru',
      fromName: '2wel',
    }
    const mail = passwordResetMail({
      to: 'guest@example.com',
      link: 'https://2wel.ru/reset?token=abc',
      env,
    })
    assert.equal(formatFrom(env), '"2wel" <support@2wel.ru>')
    assert.equal(mail.from, '"2wel" <support@2wel.ru>')
    assert.equal(mail.to, 'guest@example.com')
    assert.match(mail.subject, /парол/i)
    assert.match(mail.text, /https:\/\/2wel.ru\/reset\?token=abc/)
    assert.match(mail.html, /https:\/\/2wel.ru\/reset\?token=abc/)
  })
})

describe('otpMail', () => {
  it('кладёт 4 цифры в тему сброса', () => {
    const mail = otpMail({
      to: 'guest@example.com',
      code: '0421',
      purpose: 'reset',
      env: { from: 'support@2wel.ru', fromName: '2wel' },
    })
    assert.match(mail.subject, /сброс/i)
    assert.match(mail.text, /0421/)
    assert.match(mail.html, /0421/)
  })
})

describe('teamInviteMail', () => {
  it('кладёт название объекта и ссылку', async () => {
    const { teamInviteMail } = await import('./mail.mjs')
    const mail = teamInviteMail({
      to: 'content@plaza.spa',
      projectName: 'Plaza',
      link: 'https://2wel.ru/join?invite=abc',
      env: { from: 'support@2wel.ru', fromName: '2wel' },
    })
    assert.match(mail.subject, /Plaza/)
    assert.match(mail.text, /сотрудника/)
    assert.match(mail.text, /https:\/\/2wel.ru\/join\?invite=abc/)
    assert.equal(mail.to, 'content@plaza.spa')
  })
})
