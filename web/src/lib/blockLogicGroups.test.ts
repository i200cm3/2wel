import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('blockLogicGroups', () => {
  it('склеивает и разбирает ключ group.subgroup', async () => {
    const { blockLogicKeyFromMeta, blockMetaFromLogicKey, blockLogicLabelFromMeta } = await import(
      './blockLogicGroups.ts'
    )
    assert.equal(blockLogicKeyFromMeta({ group: 'rooms', subgroup: 'luxury' }), 'rooms.luxury')
    assert.deepEqual(blockMetaFromLogicKey('intro.generic'), { group: 'intro', subgroup: 'generic' })
    assert.equal(blockLogicLabelFromMeta({ group: 'intro', subgroup: 'generic' }), 'Универсальное intro')
  })

  it('orders library groups consistently', async () => {
    const { blockLibraryGroupSortIndex } = await import('./blockLogicGroups.ts')
    assert.ok(blockLibraryGroupSortIndex('intro') < blockLibraryGroupSortIndex('rooms'))
    assert.ok(blockLibraryGroupSortIndex('rooms') < blockLibraryGroupSortIndex('treatment'))
    assert.ok(blockLibraryGroupSortIndex('price') < blockLibraryGroupSortIndex('cta'))
  })
})
