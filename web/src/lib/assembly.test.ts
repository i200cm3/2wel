import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveFlowIds } from './assembly.ts'
import { requiresFieldsFromPlaceholders } from './guestSummaryFields.ts'
import { defaultBlockMeta, type BlockMeta, type PropertyConfig, type StorySequence } from '../types/story.ts'

function sequence(id: string, durationSec = 5): StorySequence {
  return {
    id,
    label: id,
    clips: [
      {
        id: `${id}-clip`,
        src: '/media/test.jpg',
        media: 'image',
        motion: 'none',
        durationSec,
        from: { x: 0.5, y: 0.5, scale: 1 },
        to: { x: 0.5, y: 0.5, scale: 1 },
        easing: 'ease-in-out',
      },
    ],
  }
}

function meta(patch: Partial<BlockMeta>): BlockMeta {
  return { ...defaultBlockMeta(), durationClass: 'short', ...patch }
}

function adaptiveConfig(): PropertyConfig {
  const ids = [
    'intro',
    'greeting',
    'family_with_kids',
    'rooms_standard',
    'rooms_family',
    'food_family',
    'objection_price',
    'next_step_ask_price',
    'cta_whatsapp',
    'cta_whatsapp_generic',
  ]
  return {
    id: 'test',
    brand: {
      name: 'Test',
      fullName: 'Test',
      city: '',
      address: '',
      phoneDisplay: '',
      phoneTel: '',
      site: '',
      whatsAppNumber: '',
    },
    defaultGuestName: 'Гость',
    greetingSubtitle: '',
    flow: ['intro', 'greeting'],
    branches: [],
    mediaLibrary: [],
    sequences: Object.fromEntries(ids.map((id) => [id, sequence(id)])),
    constructorV2: {
      mode: 'adaptive',
      sequenceMetaById: {
        intro: meta({ group: 'intro', priority: 6 }),
        greeting: meta({ group: 'intro', priority: 5 }),
        family_with_kids: meta({
          group: 'family',
          priority: 9,
          audienceTags: ['family'],
          topicTags: ['family', 'room', 'food'],
          objectionTags: ['family-fit'],
        }),
        rooms_standard: meta({
          group: 'rooms',
          priority: 8,
          audienceTags: ['solo'],
          topicTags: ['room', 'price'],
          objectionTags: ['price'],
        }),
        rooms_family: meta({
          group: 'rooms',
          priority: 8,
          audienceTags: ['family'],
          topicTags: ['room', 'family'],
          objectionTags: ['room-fit', 'family-fit'],
        }),
        food_family: meta({
          group: 'food',
          priority: 8,
          audienceTags: ['family'],
          topicTags: ['food', 'family'],
          objectionTags: ['food-fit', 'family-fit'],
        }),
        objection_price: meta({
          group: 'objection',
          priority: 9,
          topicTags: ['price'],
          objectionTags: ['price'],
        }),
        next_step_ask_price: meta({
          group: 'next-step',
          priority: 9,
          topicTags: ['next-step', 'price'],
          objectionTags: ['price'],
        }),
        cta_whatsapp: meta({
          group: 'cta',
          priority: 10,
          topicTags: ['cta', 'next-step'],
          requiresFields: ['name'],
        }),
        cta_whatsapp_generic: meta({
          group: 'cta',
          subgroup: 'whatsapp-generic',
          priority: 7,
          topicTags: ['cta', 'next-step'],
        }),
      },
      assembly: {
        enabled: true,
        mode: 'adaptive',
        maxAutoplaySec: 35,
        maxBlocks: 7,
        alwaysStartIds: ['intro', 'greeting'],
        alwaysEndIds: ['cta_whatsapp', 'cta_whatsapp_generic'],
        lowConfidenceBehavior: 'menu',
      },
    },
  }
}

describe('deriveFlowIds · adaptive slots', () => {
  it('keeps a directed scenario and reserves room for the final CTA', () => {
    const flow = deriveFlowIds(adaptiveConfig(), {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })

    assert.deepEqual(flow, [
      'intro',
      'family_with_kids',
      'rooms_family',
      'objection_price',
      'food_family',
      'next_step_ask_price',
      'cta_whatsapp',
    ])
    assert.equal(flow.includes('greeting'), false)
  })

  it('starts with dated intro when dates exist and generic intro when they do not', () => {
    const config = adaptiveConfig()
    config.sequences.intro_by_dates = sequence('intro_by_dates')
    config.constructorV2!.sequenceMetaById.intro_by_dates = meta({
      group: 'intro',
      subgroup: 'by-dates',
      priority: 8,
      requiresFields: ['dates'],
    })
    config.constructorV2!.assembly.alwaysStartIds = ['intro', 'intro_by_dates', 'greeting']

    const withDates = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: 'июнь',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withDates[0], 'intro_by_dates')
    assert.equal(withDates.includes('intro'), false)
    assert.equal(withDates.includes('greeting'), false)

    const withoutDates = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withoutDates[0], 'intro')
    assert.equal(withoutDates.includes('intro_by_dates'), false)
    assert.equal(withoutDates.includes('greeting'), false)
  })

  it('soft-fills uncovered groups when budget remains', () => {
    const config = adaptiveConfig()
    config.constructorV2!.assembly.maxAutoplaySec = 120
    config.constructorV2!.assembly.maxBlocks = 12
    config.sequences.treatment_start = sequence('treatment_start')
    config.sequences.leisure_calm = sequence('leisure_calm')
    config.sequences.location_where = sequence('location_where')
    config.constructorV2!.sequenceMetaById.treatment_start = meta({
      group: 'treatment',
      priority: 7,
      topicTags: ['treatment'],
    })
    config.constructorV2!.sequenceMetaById.leisure_calm = meta({
      group: 'leisure',
      priority: 6,
      topicTags: ['leisure'],
    })
    config.constructorV2!.sequenceMetaById.location_where = meta({
      group: 'location',
      priority: 5,
      topicTags: ['location'],
    })

    const flow = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'couple',
      topics: '',
      objections: '',
      confidence: '0.8',
      room: '',
      fillRemaining: 'soft',
    })

    assert.ok(flow.includes('intro'))
    assert.ok(flow.includes('cta_whatsapp'))
    assert.equal(flow[flow.length - 1], 'cta_whatsapp')
    assert.ok(flow.includes('treatment_start'), 'treatment should soft-fill first by group order')
    assert.ok(flow.includes('food_family'), 'food is next uncovered fill group')
    assert.ok(flow.includes('leisure_calm'), 'leisure should soft-fill within soft cap')
    assert.equal(flow.includes('location_where'), false, 'soft caps at 3 fill blocks')
    assert.ok(flow.length <= 12)
    const fillIds = ['treatment_start', 'food_family', 'leisure_calm', 'location_where']
    assert.equal(fillIds.filter((id) => flow.includes(id)).length, 3)
  })

  it('does not soft-fill when fillRemaining is off', () => {
    const config = adaptiveConfig()
    config.constructorV2!.assembly.maxAutoplaySec = 120
    config.constructorV2!.assembly.maxBlocks = 12
    config.sequences.treatment_start = sequence('treatment_start')
    config.constructorV2!.sequenceMetaById.treatment_start = meta({
      group: 'treatment',
      priority: 7,
      topicTags: ['treatment'],
    })

    const flow = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'couple',
      topics: '',
      objections: '',
      confidence: '0.8',
      room: '',
      fillRemaining: 'off',
    })

    assert.equal(flow.includes('treatment_start'), false)
  })

  it('places soft-fill before next-step so CTA stays adjacent', () => {
    const config = adaptiveConfig()
    config.constructorV2!.assembly.maxAutoplaySec = 120
    config.constructorV2!.assembly.maxBlocks = 9
    config.sequences.treatment_detox = sequence('treatment_detox', 9)
    config.constructorV2!.sequenceMetaById.treatment_detox = meta({
      group: 'treatment',
      priority: 8,
      topicTags: ['treatment', 'wellness'],
      objectionTags: ['uncertainty'],
    })

    const flow = deriveFlowIds(config, {
      guestName: 'Виталий',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
      fillRemaining: 'soft',
    })

    assert.ok(flow.includes('treatment_detox'), 'soft-fill should add treatment')
    assert.ok(flow.includes('next_step_ask_price'))
    assert.equal(flow[flow.length - 1], 'cta_whatsapp')
    const detoxAt = flow.indexOf('treatment_detox')
    const nextAt = flow.indexOf('next_step_ask_price')
    const ctaAt = flow.indexOf('cta_whatsapp')
    assert.ok(detoxAt < nextAt, 'fill must come before next-step')
    assert.equal(nextAt + 1, ctaAt, 'next-step must sit directly before CTA')
  })
})

describe('requiresFields · guest parameters', () => {
  it('maps placeholders to summary fields', () => {
    assert.deepEqual(requiresFieldsFromPlaceholders(['name', 'room', 'brand']), ['name', 'room'])
  })

  it('excludes blocks when required guest parameters are missing', () => {
    const config = adaptiveConfig()
    config.sequences.greeting = {
      ...config.sequences.greeting,
      cues: [{ id: 'c1', startSec: 0, durationSec: 5, ttsText: 'Здравствуйте, {name}!' }],
    }
    config.constructorV2!.assembly.alwaysStartIds = ['greeting']
    config.constructorV2!.sequenceMetaById.greeting = meta({
      group: 'intro',
      priority: 5,
      requiresFields: ['name'],
    })

    const withoutName = deriveFlowIds(config, {
      guestName: '',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withoutName.includes('greeting'), false)

    const withName = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withName.includes('greeting'), true)
  })

  it('picks named CTA when name is present and generic when missing', () => {
    const withoutName = deriveFlowIds(adaptiveConfig(), {
      guestName: '',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withoutName.includes('cta_whatsapp'), false)
    assert.equal(withoutName.includes('cta_whatsapp_generic'), true)
    assert.equal(withoutName[withoutName.length - 1], 'cta_whatsapp_generic')

    const withName = deriveFlowIds(adaptiveConfig(), {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withName.includes('cta_whatsapp'), true)
    assert.equal(withName.includes('cta_whatsapp_generic'), false)
    assert.equal(withName[withName.length - 1], 'cta_whatsapp')
  })

  it('never keeps two alwaysEnd CTAs even if group meta is empty', () => {
    const config = adaptiveConfig()
    config.constructorV2!.sequenceMetaById.cta_whatsapp = meta({
      group: '',
      priority: 10,
      topicTags: ['cta', 'next-step'],
      requiresFields: [],
    })
    config.constructorV2!.sequenceMetaById.cta_whatsapp_generic = meta({
      group: '',
      priority: 7,
      topicTags: ['cta', 'next-step'],
    })

    const flow = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room, food',
      objections: 'price',
      confidence: '0.8',
      room: '',
    })
    const ctas = flow.filter((id) => id.startsWith('cta_'))
    assert.deepEqual(ctas, ['cta_whatsapp'])
  })

  it('excludes room-specific blocks when room is missing', () => {
    const config = adaptiveConfig()
    config.sequences.greeting = {
      ...config.sequences.greeting,
      title: 'Вы смотрели {room}',
    }
    config.constructorV2!.sequenceMetaById.greeting = meta({
      group: 'intro',
      priority: 8,
      requiresFields: ['room'],
    })

    const withoutRoom = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room',
      objections: '',
      confidence: '0.8',
      room: '',
    })
    assert.equal(withoutRoom.includes('greeting'), false)

    const withRoom = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'family',
      topics: 'room',
      objections: '',
      confidence: '0.8',
      room: 'люкс с видом',
    })
    assert.equal(withRoom.includes('greeting'), true)
  })
})
