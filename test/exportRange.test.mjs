import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRangeStart } from '../src/exportRange.js'

test('Given a typed start, when resolving, then the typed value wins', () => {
  assert.equal(resolveRangeStart('501,1500', { nextStartId: 301 }), 501)
  assert.equal(resolveRangeStart('501', { nextStartId: 301 }), 501)
  assert.equal(resolveRangeStart('  700 , 900 ', null), 700)
})

test('Given only a memory record, when resolving, then it continues after the last export', () => {
  assert.equal(resolveRangeStart('', { nextStartId: 501 }), 501)
  assert.equal(resolveRangeStart('', { maxId: 500 }), 501)
  assert.equal(resolveRangeStart('', { input: '301,500' }), 301)
})

test('Given the open-ended upper bound from an older record, when resolving, then the start still reads back', () => {
  assert.equal(resolveRangeStart('', { input: '501,9223372036854775807' }), 501)
})

test('Given nothing usable, when resolving, then it reports no start', () => {
  assert.equal(resolveRangeStart('', null), 0)
  assert.equal(resolveRangeStart('', {}), 0)
  assert.equal(resolveRangeStart('abc', { input: 'last' }), 0)
  assert.equal(resolveRangeStart('0,100', null), 0)
})
