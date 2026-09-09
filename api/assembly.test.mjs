import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  applyDerivedFlowToConfig,
  computeLinkAssembly,
  deriveFlowIds,
  freezeAdaptiveConfigForStart,
  isAdaptiveAssemblyEnabled,
  nameOnlyGuestSummary,
} from './assembly.mjs'

const baseConfig = {
  brand: { fullName: 'Test' },
  sequences: {
    intro: {
      id: 'intro',
      label: 'Intro',
      clips: [{ id: 'c1', src: '/a.jpg', durationSec: 8, from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } }],
      cues: [],
    },
    rooms: {
      id: 'rooms',
      label: 'Rooms',
      clips: [{ id: 'c2', src: '/b.jpg', durationSec: 10, from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } }],
      cues: [],
    },
    price: {
      id: 'price',
      label: 'Price',
      clips: [{ id: 'c3', src: '/c.jpg', durationSec: 12, from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } }],
      cues: [],
    },
  },
  flow: ['intro', 'rooms'],
  branches: [],
}

const adaptiveConfig = {
  ...baseConfig,
  constructorV2: {
    mode: 'adaptive',
    sequenceMetaById: {
      intro: {
        group: 'intro',
        autoplayEligible: true,
        menuOnly: false,
        priority: 5,
        durationClass: 'short',
        audienceTags: [],
        topicTags: [],
        objectionTags: [],
        requiresFields: [],
        slotFields: [],
      },
      rooms: {
        group: 'rooms',
        autoplayEligible: true,
        menuOnly: false,
        priority: 3,
        durationClass: 'medium',
        audienceTags: ['couple'],
        topicTags: ['room'],
        objectionTags: [],
        requiresFields: [],
        slotFields: [],
      },
      price: {
        group: 'price',
        autoplayEligible: true,
        menuOnly: false,
        priority: 2,
        durationClass: 'medium',
        audienceTags: [],
        topicTags: [],
        objectionTags: ['expensive'],
        requiresFields: [],
        slotFields: [],
      },
    },
    assembly: {
      enabled: true,
      mode: 'adaptive',
      maxAutoplaySec: 90,
      maxBlocks: 3,
      alwaysStartIds: ['intro'],
      alwaysEndIds: [],
      lowConfidenceBehavior: 'menu',
    },
  },
}

describe('isAdaptiveAssemblyEnabled', () => {
  it('false for fixed template', () => {
    assert.equal(isAdaptiveAssemblyEnabled(baseConfig), false)
  })

  it('true when adaptive assembly enabled', () => {
    assert.equal(isAdaptiveAssemblyEnabled(adaptiveConfig), true)
  })
})

describe('deriveFlowIds', () => {
  it('returns fixed flow when adaptive disabled', () => {
    const flow = deriveFlowIds(baseConfig, {
      guestName: 'Иван',
      dates: '',
      partyType: 'couple',
      topics: 'room',
      objections: '',
      confidence: '0.8',
    })
    assert.deepEqual(flow, ['intro', 'rooms'])
  })

  it('skips disabled blocks in fixed flow', () => {
    const flow = deriveFlowIds(
      {
        ...baseConfig,
        constructorV2: {
          sequenceMetaById: {
            rooms: { enabled: false },
          },
        },
      },
      {
        guestName: 'Иван',
        dates: '',
        partyType: 'couple',
        topics: '',
        objections: '',
        confidence: '0.8',
      },
    )
    assert.deepEqual(flow, ['intro'])
  })

  it('builds adaptive flow with always-start and topic scoring', () => {
    const flow = deriveFlowIds(adaptiveConfig, {
      guestName: 'Иван',
      dates: '',
      partyType: 'couple',
      topics: 'room',
      objections: '',
      confidence: '0.8',
    })
    assert.deepEqual(flow, ['intro', 'rooms'])
  })

  it('prefers objection block when tagged', () => {
    const flow = deriveFlowIds(adaptiveConfig, {
      guestName: 'Иван',
      dates: '',
      partyType: '',
      topics: '',
      objections: 'expensive',
      confidence: '0.8',
    })
    assert.equal(flow[0], 'intro')
    assert.ok(flow.includes('price'))
  })

  it('picks one intro from alwaysStart family (dates vs generic)', () => {
    const config = structuredClone(adaptiveConfig)
    config.sequences.intro_by_dates = {
      id: 'intro_by_dates',
      label: 'Intro by dates',
      clips: [
        {
          id: 'c4',
          src: '/d.jpg',
          durationSec: 8,
          from: { x: 0, y: 0, w: 1, h: 1 },
          to: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
      cues: [],
    }
    config.constructorV2.sequenceMetaById.intro_by_dates = {
      group: 'intro',
      subgroup: 'by-dates',
      autoplayEligible: true,
      menuOnly: false,
      priority: 8,
      durationClass: 'short',
      audienceTags: [],
      topicTags: [],
      objectionTags: [],
      requiresFields: ['dates'],
      slotFields: [],
    }
    config.constructorV2.assembly.alwaysStartIds = ['intro', 'intro_by_dates']

    const withDates = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: 'июнь',
      partyType: 'couple',
      topics: 'room',
      objections: '',
      confidence: '0.8',
    })
    assert.equal(withDates[0], 'intro_by_dates')
    assert.equal(withDates.includes('intro'), false)

    const withoutDates = deriveFlowIds(config, {
      guestName: 'Анна',
      dates: '',
      partyType: 'couple',
      topics: 'room',
      objections: '',
      confidence: '0.8',
    })
    assert.equal(withoutDates[0], 'intro')
    assert.equal(withoutDates.includes('intro_by_dates'), false)
  })
})

describe('applyDerivedFlowToConfig', () => {
  it('replaces flow with valid ids only', () => {
    const next = applyDerivedFlowToConfig(baseConfig, ['rooms', 'missing', 'intro'])
    assert.deepEqual(next.flow, ['rooms', 'intro'])
  })

  it('strips disabled blocks from flow and menus', () => {
    const next = applyDerivedFlowToConfig(
      {
        ...baseConfig,
        menus: {
          main: {
            id: 'main',
            label: 'Menu',
            branches: [{ id: 'rooms', label: 'Rooms', sequenceId: 'rooms' }],
          },
        },
        constructorV2: {
          sequenceMetaById: {
            rooms: { enabled: false },
          },
        },
      },
      null,
    )
    assert.deepEqual(next.flow, ['intro'])
    assert.deepEqual(next.menus.main.branches, [])
  })
})

describe('computeLinkAssembly', () => {
  it('returns summary and fixed trace for fixed template', () => {
    const result = computeLinkAssembly(baseConfig, 'Иван', { topics: 'room' })
    assert.equal(result.guestSummary.guestName, 'Иван')
    assert.equal(result.derivedFlow, null)
    assert.ok(Array.isArray(result.assemblyTrace))
    assert.equal(result.assemblyTrace.find((item) => item.id === 'intro')?.included, true)
    assert.equal(result.assemblyTrace.find((item) => item.id === 'price')?.included, false)
  })

  it('returns summary, derived flow and adaptive trace', () => {
    const result = computeLinkAssembly(adaptiveConfig, 'Иван', { topics: 'room', partyType: 'couple' })
    assert.equal(result.guestSummary.guestName, 'Иван')
    assert.deepEqual(result.derivedFlow, ['intro', 'rooms'])
    assert.ok(result.assemblyTrace.some((item) => item.id === 'rooms' && item.included))
    assert.match(result.assemblyTrace.find((item) => item.id === 'rooms').reason, /темы: room/)
  })
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const plazaConfigPath = join(__dirname, '../web/public/properties/plaza-kislovodsk-adaptive-draft2.json')

describe('deriveFlowIds · plaza2 name-only (matches Constructor V2)', () => {
  it('does not stack three next_step blocks when only guest name is known', () => {
    const config = JSON.parse(readFileSync(plazaConfigPath, 'utf8'))
    const flow = deriveFlowIds(config, {
      guestName: 'Иван',
      dates: '',
      partyType: '',
      room: '',
      topics: '',
      objections: '',
      confidence: '0.8',
      fillRemaining: 'off',
    })
    const nextSteps = flow.filter((id) => id.startsWith('next_step_'))
    assert.equal(nextSteps.length, 0, `expected no next_step blocks, got: ${nextSteps.join(', ')}`)
    assert.equal(flow[flow.length - 1], 'cta_whatsapp')
    assert.ok(flow.includes('intro_generic'))
    assert.ok(flow.includes('greeting_warm'))
  })

  it('builds a neutral overview instead of niche audience blocks', () => {
    const config = JSON.parse(readFileSync(plazaConfigPath, 'utf8'))
    const flow = deriveFlowIds(config, {
      guestName: 'Иван',
      dates: '',
      partyType: '',
      room: '',
      topics: '',
      objections: '',
      confidence: '0.8',
      fillRemaining: 'off',
    })
    assert.equal(flow.includes('family_with_kids'), false)
    assert.equal(flow.includes('couple_quiet_rest'), false)
    assert.equal(flow.includes('senior_calm_rhythm'), false)
    assert.equal(flow.includes('objection_dates_not_fixed'), false)
    assert.equal(flow.includes('treatment_profile_cardio'), false)
    assert.ok(
      flow.some((id) => id.startsWith('treatment_') || id.startsWith('food_') || id.startsWith('territory_') || id.startsWith('leisure_') || id.startsWith('wellness_')),
      `expected overview body blocks, got: ${flow.join(' -> ')}`,
    )
  })
})

const plazaCopyPath = join(__dirname, '../web/public/properties/adm-plaza-copy-v2.json')

describe('deriveFlowIds · adm-plaza-copy-v2 name-only', () => {
  it('assembles place / treatment / food / leisure overview', () => {
    const config = JSON.parse(readFileSync(plazaCopyPath, 'utf8'))
    const flow = deriveFlowIds(config, {
      guestName: 'Иван',
      dates: '',
      partyType: '',
      room: '',
      topics: '',
      objections: '',
      confidence: '0.8',
      fillRemaining: 'off',
    })
    assert.equal(flow[0], 'intro_generic')
    assert.equal(flow[flow.length - 1], 'cta_whatsapp')
    assert.ok(flow.includes('territory_walks'), flow.join(' -> '))
    assert.ok(flow.includes('treatment_individual_plan') || flow.includes('treatment_detox_antistress'), flow.join(' -> '))
    assert.ok(flow.includes('food_diet'), flow.join(' -> '))
    assert.ok(flow.includes('leisure_active') || flow.includes('leisure_evening') || flow.includes('wellness_pool') || flow.includes('wellness_sleep_recovery'), flow.join(' -> '))
    assert.equal(flow.includes('family_with_kids'), false)
    assert.equal(flow.includes('couple_quiet_rest'), false)
    assert.equal(flow.includes('senior_calm_rhythm'), false)
    assert.equal(flow.includes('objection_dates_not_fixed'), false)
    assert.equal(flow.includes('food_family'), false)
    assert.equal(flow.includes('rooms_family'), false)
  })
})

describe('freezeAdaptiveConfigForStart', () => {
  it('writes name-only flow and disables adaptive', () => {
    const config = JSON.parse(readFileSync(plazaCopyPath, 'utf8'))
    assert.equal(isAdaptiveAssemblyEnabled(config), true)
    assert.deepEqual(config.flow, ['intro_generic', 'intro_by_dates'])

    const expected = deriveFlowIds(config, nameOnlyGuestSummary('Иван'))
    const frozen = freezeAdaptiveConfigForStart(config, 'Иван')

    assert.equal(isAdaptiveAssemblyEnabled(frozen), false)
    assert.equal(frozen.constructorV2.mode, 'fixed')
    assert.equal(frozen.constructorV2.assembly.enabled, false)
    assert.deepEqual(frozen.flow, expected)
    assert.equal(frozen.flow.includes('intro_by_dates'), false)
    assert.equal(frozen.flow[0], 'intro_generic')
  })

  it('leaves non-adaptive configs unchanged', () => {
    const frozen = freezeAdaptiveConfigForStart(baseConfig)
    assert.equal(frozen, baseConfig)
  })
})
