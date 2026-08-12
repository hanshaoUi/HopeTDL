import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { filterMessageJson, shouldSkipForward } = require('../electron/shared/messageFilter.cjs')

test('global filter removes image and video messages from tdl export JSON', () => {
  const input = {
    id: 3866041623,
    messages: [
      { id: 1, type: 'message', text: '海报', file: 'poster.JPG' },
      { id: 2, type: 'message', text: '正片', file: 'movie.mp4' },
      { id: 3, type: 'message', text: '保留文档', file: 'notes.pdf' }
    ]
  }

  const result = filterMessageJson(input, { blockImages: true, blockVideos: true })

  assert.deepEqual(result.json.messages.map(item => item.id), [3])
  assert.equal(result.removedByType.image, 1)
  assert.equal(result.removedByType.video, 1)
})

test('global filter can delete matched lines, replace keywords, and strip links', () => {
  const removeLine = filterMessageJson({ messages: [
    { id: 1, date: 1, text: '正文第一行\n推广：加入群聊\n正文第二行 https://t.me/demo' }
  ] }, {
    filterKeywordsText: '推广',
    filterKeywordAction: 'remove-segment',
    removeLinks: true
  })
  assert.equal(removeLine.json.messages[0].text, '正文第一行\n正文第二行')

  const replace = filterMessageJson({ messages: [
    { id: 2, date: 1, text: '这是广告内容' }
  ] }, {
    filterKeywordsText: '广告',
    filterKeywordAction: 'replace',
    filterKeywordReplacement: '[已过滤]'
  })
  assert.equal(replace.json.messages[0].text, '这是[已过滤]内容')
})

test('drop-message action removes the whole matched message', () => {
  const result = filterMessageJson({ messages: [
    { id: 1, date: 1, text: '正常内容' },
    { id: 2, date: 1, text: '包含广告' }
  ] }, {
    filterKeywordsText: '广告',
    filterKeywordAction: 'drop-message'
  })
  assert.deepEqual(result.json.messages.map(item => item.id), [1])
  assert.deepEqual(result.hitKeywords, ['广告'])
})

test('comment-forward local keywords still drop messages when the global filter is disabled', () => {
  const result = filterMessageJson({ messages: [
    { id: 1, date: 1, text: '包含广告' }
  ] }, {
    forwardFilterEnabled: false,
    filterKeywordAction: 'remove-segment',
    blockKeywordsText: '广告'
  })

  assert.deepEqual(result.json.messages, [])
})

test('forward is skipped when enabled filters leave no messages', () => {
  assert.equal(shouldSkipForward({ enabled: true, count: 0 }), true)
  assert.equal(shouldSkipForward({ enabled: true, count: 1 }), false)
  assert.equal(shouldSkipForward({ enabled: false, count: 0 }), false)
})
