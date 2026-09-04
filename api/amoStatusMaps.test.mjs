import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeStatusMapRows } from './amoStatusMaps.mjs'

describe('normalizeStatusMapRows', () => {
  it('чистит и дедуплицирует status_id', () => {
    assert.deepEqual(
      normalizeStatusMapRows([
        { statusId: '142', templateCode: 'CheckIn', label: ' Заехал ' },
        { status_id: 142, template_code: 'other' },
        { statusId: 'x', templateCode: 'default' },
        { statusId: '143', templateCode: 'double' },
      ]),
      [
        { statusId: '142', templateCode: 'checkin', label: 'Заехал' },
        { statusId: '143', templateCode: 'double', label: null },
      ],
    )
  })
})
