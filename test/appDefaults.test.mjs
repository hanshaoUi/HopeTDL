import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_NAMESPACE, previewConfig } from '../shared/appDefaults.mjs'

test('browser preview uses the same hope namespace as Electron defaults', () => {
  assert.equal(DEFAULT_NAMESPACE, 'hope')
  assert.deepEqual(previewConfig(), { ns: 'hope' })
})
