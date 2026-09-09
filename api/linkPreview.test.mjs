import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  coverWindow,
  cropPixels,
  emailPreviewOptions,
  fillPreviewTitle,
  focusToCropRect,
  parsePreviewPath,
  pickPreviewClip,
  pickPreviewTitleTemplate,
  wrapTitleLines,
  renderLinkPreview,
} from './linkPreview.mjs'

describe('emailPreviewOptions', () => {
  it('по умолчанию не собирает картинку', () => {
    assert.equal(emailPreviewOptions({}).enabled, false)
    assert.equal(emailPreviewOptions({ emailPreview: { src: '/a.jpg' } }).enabled, false)
    assert.equal(emailPreviewOptions({ emailPreview: { enabled: true } }).enabled, true)
  })
})

describe('parsePreviewPath', () => {
  it('читает id из гостевого URL и из API', () => {
    assert.equal(parsePreviewPath('/k7m2n9q/preview.jpg'), 'k7m2n9q')
    assert.equal(parsePreviewPath('/api/public/links/abc123xyz/preview.jpeg'), 'abc123xyz')
    assert.equal(parsePreviewPath('/k7m2n9q'), null)
    assert.equal(parsePreviewPath('/app/preview.jpg'), null)
    assert.equal(parsePreviewPath('/login/preview.jpg'), null)
  })
})

describe('fillPreviewTitle', () => {
  it('подставляет имя с заглавной буквы', () => {
    assert.equal(fillPreviewTitle('Здравствуйте, {name}!', 'виталий'), 'Здравствуйте, Виталий!')
    assert.equal(fillPreviewTitle('', 'анна'), 'Здравствуйте, Анна!')
  })
})

describe('pickPreviewClip', () => {
  it('берёт фото из greeting, не видео intro', () => {
    const clip = pickPreviewClip({
      flow: ['intro', 'greeting'],
      sequences: {
        intro: {
          id: 'intro',
          clips: [{ src: '/media/projects/x/library/intro.mp4' }],
        },
        greeting: {
          id: 'greeting',
          title: 'Здравствуйте, {name}!',
          clips: [{ src: '/media/projects/x/library/01.jpg', from: { x: 0.4, y: 0.5, scale: 1.1 } }],
        },
      },
    })
    assert.equal(clip.src, '/media/projects/x/library/01.jpg')
    assert.equal(clip.from.x, 0.4)
  })

  it('своё фото из конструктора важнее greeting', () => {
    const clip = pickPreviewClip({
      emailPreview: { src: '/media/projects/x/library/cover.jpg' },
      flow: ['greeting'],
      sequences: {
        greeting: {
          id: 'greeting',
          clips: [{ src: '/media/projects/x/library/01.jpg' }],
        },
      },
    })
    assert.equal(clip.src, '/media/projects/x/library/cover.jpg')
  })
})

describe('pickPreviewTitleTemplate', () => {
  it('берёт титр приветствия', () => {
    assert.equal(
      pickPreviewTitleTemplate({
        flow: ['intro'],
        sequences: {
          intro: { id: 'intro', title: 'Санаторий' },
          greeting: { id: 'greeting', title: 'Здравствуйте, {name}!' },
        },
      }),
      'Здравствуйте, {name}!',
    )
  })

  it('свой титр из конструктора важнее greeting', () => {
    assert.equal(
      pickPreviewTitleTemplate({
        emailPreview: { title: 'Для вас, {name}' },
        sequences: { greeting: { id: 'greeting', title: 'Здравствуйте, {name}!' } },
      }),
      'Для вас, {name}',
    )
  })
})

describe('crop', () => {
  it('окно cover для портрета на широком фото уже исходника', () => {
    const win = coverWindow(16 / 9, 1, 9 / 16)
    assert.ok(win.w < 1)
    assert.equal(win.h, 1)
  })

  it('пиксели кропа внутри кадра', () => {
    const px = cropPixels(4000, 3000, { x: 0.5, y: 0.5, scale: 1.02 }, 9 / 16)
    assert.ok(px.left >= 0)
    assert.ok(px.top >= 0)
    assert.ok(px.left + px.width <= 4000)
    assert.ok(px.top + px.height <= 3000)
    assert.ok(px.height > px.width)
  })

  it('focusToCropRect держит кадр внутри 0..1', () => {
    const rect = focusToCropRect({ x: 0, y: 0, scale: 1.4 }, 1.5, 9 / 16)
    assert.ok(rect.left >= -1e-9)
    assert.ok(rect.top >= -1e-9)
    assert.ok(rect.left + rect.width <= 1 + 1e-9)
    assert.ok(rect.top + rect.height <= 1 + 1e-9)
  })
})

describe('wrapTitleLines', () => {
  it('режет длинную строку по словам', () => {
    const lines = wrapTitleLines('Здравствуйте, уважаемый Александр Петрович', 16)
    assert.ok(lines.length >= 2)
    assert.ok(lines.join(' ').includes('Александр'))
  })
})

describe('renderLinkPreview', () => {
  it('собирает jpeg с титром, даже если фото нет', async () => {
    const publicId = `testprev-${Date.now().toString(36)}`
    const { jpeg } = await renderLinkPreview({
      config: {
        flow: ['greeting'],
        sequences: { greeting: { id: 'greeting', title: 'Здравствуйте, {name}!' } },
      },
      guestName: 'иван',
      publicId,
    })
    assert.ok(jpeg.length > 800)
    assert.equal(jpeg[0], 0xff)
    assert.equal(jpeg[1], 0xd8)
  })
})
