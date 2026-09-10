import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultBlockMeta, type PropertyConfig, type StorySequence } from '../types/story.ts'
import {
  looksLikePersonName,
  missingRequiredGuestFields,
  requiresFieldsFromSequence,
  syncedRequiresFields,
  syncRequiresFieldsInConfig,
} from './guestSummaryFields.ts'

function makeSequence(overrides: Partial<StorySequence> = {}): StorySequence {
  return {
    id: 'greeting',
    label: 'Приветствие',
    clips: [],
    ...overrides,
  }
}

describe('looksLikePersonName', () => {
  it('accepts real names and rejects phones', () => {
    assert.equal(looksLikePersonName('Иван'), true)
    assert.equal(looksLikePersonName('Анна-Мария'), true)
    assert.equal(looksLikePersonName('Гость'), true)
    assert.equal(looksLikePersonName('89282648515'), false)
    assert.equal(looksLikePersonName('+7 928 264-85-15'), false)
    assert.equal(looksLikePersonName('lead@mail.ru'), false)
    assert.equal(looksLikePersonName(''), false)
  })

  it('treats a phone as a missing name field', () => {
    const summary = {
      guestName: '89282648515',
      dates: '',
      partyType: '',
      topics: '',
      objections: '',
      confidence: '0.4',
      room: '',
    }
    assert.deepEqual(missingRequiredGuestFields(summary, ['name']), ['name'])
  })
})

describe('syncedRequiresFields', () => {
  it('adds name when {name} appears in title', () => {
    const sequence = makeSequence({ title: 'Здравствуйте, {name}!' })
    assert.deepEqual(syncedRequiresFields(sequence, []), ['name'])
  })

  it('adds fields from captions and TTS', () => {
    const sequence = makeSequence({
      cues: [{ id: 'cue1', text: 'Номер {room}', ttsText: 'Даты {dates}' }],
    })
    assert.deepEqual(requiresFieldsFromSequence(sequence).sort(), ['dates', 'room'])
    assert.deepEqual(syncedRequiresFields(sequence, []).sort(), ['dates', 'room'])
  })

  it('does not require a field for {hello}', () => {
    const sequence = makeSequence({ title: '{hello}', cues: [{ id: 'c1', ttsText: '{hello}' }] })
    assert.deepEqual(requiresFieldsFromSequence(sequence), [])
    assert.deepEqual(syncedRequiresFields(sequence, []), [])
  })

  it('keeps manually added fields without placeholders', () => {
    const sequence = makeSequence({ title: 'Здравствуйте, {name}!' })
    assert.deepEqual(syncedRequiresFields(sequence, ['partyType']), ['name', 'partyType'])
  })

  it('drops manual catalog fields that are already derived from text', () => {
    const sequence = makeSequence({ title: '{name}' })
    assert.deepEqual(syncedRequiresFields(sequence, ['name', 'dates']), ['name', 'dates'])
  })
})

describe('syncRequiresFieldsInConfig', () => {
  it('updates sequence meta for blocks with placeholders', () => {
    const config: PropertyConfig = {
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
      flow: ['greeting', 'room'],
      branches: [],
      mediaLibrary: [],
      sequences: {
        greeting: makeSequence({ id: 'greeting', title: 'Привет, {name}!' }),
        room: makeSequence({ id: 'room', title: 'Номер {room}' }),
      },
      constructorV2: {
        mode: 'adaptive',
        assembly: {
          enabled: true,
          mode: 'adaptive',
          maxBlocks: 7,
          alwaysStartIds: [],
          alwaysEndIds: [],
        },
        sequenceMetaById: {
          greeting: { ...defaultBlockMeta(), requiresFields: [] },
          room: { ...defaultBlockMeta(), requiresFields: [] },
        },
      },
    }

    const synced = syncRequiresFieldsInConfig(config)
    assert.deepEqual(synced.constructorV2?.sequenceMetaById.greeting.requiresFields, ['name'])
    assert.deepEqual(synced.constructorV2?.sequenceMetaById.room.requiresFields, ['room'])
  })
})
