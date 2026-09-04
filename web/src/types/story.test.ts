import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeClip, normalizeProperty, type StoryClip } from './story.ts'

function videoClip(patch: Partial<StoryClip> = {}): StoryClip {
  return {
    id: 'c1',
    src: '/media/projects/x/library/clip.mp4',
    media: 'video',
    motion: 'zoom-in',
    durationSec: 8,
    sourceDurationSec: 20,
    trimStartSec: 0,
    from: { x: 0.5, y: 0.5, scale: 1.2 },
    to: { x: 0.4, y: 0.4, scale: 1.1 },
    easing: 'ease-in-out',
    ...patch,
  }
}

function imageClip(patch: Partial<StoryClip> = {}): StoryClip {
  return {
    id: 'p1',
    src: '/media/projects/x/library/photo.jpg',
    media: 'image',
    motion: 'zoom-out',
    durationSec: 4,
    from: { x: 0.5, y: 0.5, scale: 1.15 },
    to: { x: 0.5, y: 0.5, scale: 1 },
    easing: 'ease-in-out',
    ...patch,
  }
}

describe('normalizeClip · видео trim', () => {
  it('сбрасывает Ken Burns у видео и оставляет trim', () => {
    const next = normalizeClip(videoClip({ trimStartSec: 3.2, durationSec: 5 }))
    assert.equal(next.motion, 'none')
    assert.equal(next.trimStartSec, 3.2)
    assert.equal(next.durationSec, 5)
    assert.equal(next.sourceDurationSec, 20)
  })

  it('не даёт trimStart выйти за исходник минус 0.8с', () => {
    const next = normalizeClip(videoClip({ trimStartSec: 99, durationSec: 2 }))
    assert.equal(next.trimStartSec, 19.2)
    assert.ok(next.durationSec <= 0.8 + 1e-9)
  })

  it('режет duration, если слайд длиннее оставшегося исходника', () => {
    const next = normalizeClip(videoClip({ trimStartSec: 15, durationSec: 12 }))
    assert.equal(next.trimStartSec, 15)
    assert.equal(next.durationSec, 5)
  })

  it('у фото нет trimStart и Ken Burns сохраняется', () => {
    const next = normalizeClip(imageClip({ trimStartSec: 4 }))
    assert.equal(next.motion, 'zoom-out')
    assert.equal(next.trimStartSec, undefined)
    assert.equal(next.from.scale, 1.15)
  })
})

describe('normalizeProperty', () => {
  it('нормализует клипы во всех последовательностях', () => {
    const next = normalizeProperty({
      id: 'p',
      brand: { fullName: 'Тест' },
      defaultGuestName: 'Гость',
      sequences: {
        intro: { id: 'intro', label: 'Интро', clips: [videoClip({ trimStartSec: 18, durationSec: 10 })] },
      },
      flow: ['intro'],
      branches: [],
    } as never)
    const clip = next.sequences.intro.clips[0]
    assert.equal(clip.motion, 'none')
    assert.equal(clip.trimStartSec, 18)
    assert.equal(clip.durationSec, 2)
  })

  it('подтягивает menuLinks с верхнего уровня, если в menus их нет', () => {
    const next = normalizeProperty({
      id: 'p',
      brand: { fullName: 'Тест' },
      defaultGuestName: 'Гость',
      sequences: {
        intro: { id: 'intro', label: 'Интро', clips: [imageClip()] },
      },
      flow: ['intro'],
      branches: [],
      menuLinks: [
        {
          id: 'custom',
          label: 'Telegram',
          href: 'https://t.me/{telegram}',
          bg: '#229ed9',
          textColor: '#ffffff',
        },
      ],
      menus: {
        main: { id: 'main', label: 'Меню', branches: [] },
      },
    } as never)
    assert.equal(next.menus.main.menuLinks?.length, 1)
    assert.equal(next.menus.main.menuLinks?.[0]?.label, 'Telegram')
    assert.equal(next.menuLinks?.[0]?.label, 'Telegram')
  })
})

describe('return menu helpers', () => {
  it('withReturnMenu пишет единственную кнопку «в меню»', async () => {
    const { withReturnMenu, resolveReturnMenuId, endButtonsGoStraightToMenu } = await import(
      './story.ts'
    )
    const next = withReturnMenu(
      {
        id: 'food',
        label: 'Питание',
        clips: [],
        endButtons: [
          { id: 'a', label: 'Тема', target: { kind: 'sequence', sequenceId: 'x' } },
          { id: 'b', label: 'WhatsApp', target: { kind: 'contact' } },
        ],
      },
      'submenu',
    )
    assert.equal(next.endButtons?.length, 1)
    assert.deepEqual(next.endButtons?.[0]?.target, { kind: 'menu', menuId: 'submenu' })
    assert.equal(resolveReturnMenuId(next.endButtons, 'main'), 'submenu')
    assert.equal(endButtonsGoStraightToMenu(next.endButtons), true)
    assert.equal(
      endButtonsGoStraightToMenu([
        { id: 't', label: 'Тема', target: { kind: 'sequence', sequenceId: 'x' } },
      ]),
      false,
    )
  })
})

describe('isMenuOnlyBlock', () => {
  it('считает menuOnly и legacy autoplayEligible=false одним режимом', async () => {
    const { defaultBlockMeta, isMenuOnlyBlock, menuOnlyBlockPatch } = await import('./story.ts')
    assert.equal(isMenuOnlyBlock(defaultBlockMeta()), false)
    assert.equal(isMenuOnlyBlock({ ...defaultBlockMeta(), menuOnly: true }), true)
    assert.equal(isMenuOnlyBlock({ ...defaultBlockMeta(), autoplayEligible: false }), true)
    assert.deepEqual(menuOnlyBlockPatch(true), { menuOnly: true, autoplayEligible: false })
    assert.deepEqual(menuOnlyBlockPatch(false), { menuOnly: false, autoplayEligible: true })
  })
})

describe('withoutDisabledBlocks', () => {
  it('убирает выключенный блок из flow и меню', async () => {
    const { withoutDisabledBlocks } = await import('./story.ts')
    const next = withoutDisabledBlocks({
      id: 'p',
      brand: { fullName: 'Тест' },
      defaultGuestName: 'Гость',
      sequences: {
        intro: { id: 'intro', label: 'Интро', clips: [] },
        rooms: { id: 'rooms', label: 'Номера', clips: [] },
      },
      flow: ['intro', 'rooms'],
      branches: [{ id: 'rooms', label: 'Номера', sequenceId: 'rooms' }],
      menus: {
        main: {
          id: 'main',
          label: 'Меню',
          branches: [{ id: 'rooms', label: 'Номера', sequenceId: 'rooms' }],
        },
      },
      constructorV2: {
        mode: 'fixed',
        sequenceMetaById: {
          intro: { enabled: true } as never,
          rooms: { enabled: false } as never,
        },
        assembly: { enabled: false, mode: 'fixed' } as never,
      },
    } as never)
    assert.deepEqual(next.flow, ['intro'])
    assert.equal(next.menus?.main?.branches.length, 0)
    assert.ok(next.sequences.rooms)
  })
})
