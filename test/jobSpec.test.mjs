import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createIncrementalSpec,
  executionForSpec,
  sourceChatForSpec,
  toArgs
} from '../shared/jobSpec.mjs'

test('Given an export spec, when converted, then it emits the canonical tdl arguments', () => {
  const spec = {
    kind: 'export',
    chat: '@source',
    selector: { type: 'id', input: '10,20' },
    all: true,
    raw: false,
    withContent: true,
    output: '/tmp/messages.json'
  }

  assert.deepEqual(toArgs(spec), [
    'chat', 'export', '-c', '@source', '-T', 'id', '-i', '10,20',
    '--all', '--with-content', '-o', '/tmp/messages.json'
  ])
})

test('Given a forward spec with a topic, when converted, then its router target stays one argument', () => {
  const spec = {
    kind: 'forward',
    from: '/tmp/messages.json',
    target: { peer: '2365112217', thread: 68549 },
    mode: 'direct',
    dryRun: true,
    silent: true,
    single: false,
    desc: true,
    edit: 'Message.Message'
  }

  assert.deepEqual(toArgs(spec), [
    'forward', '--from', '/tmp/messages.json', '--to', '{ Peer: "2365112217", Thread: 68549 }',
    '--mode', 'direct', '--dry-run', '--silent', '--desc', '--edit', 'Message.Message'
  ])
})

test('Given an upload spec, when converted, then caption and media flags are preserved', () => {
  assert.deepEqual(toArgs({
    kind: 'upload',
    path: '/tmp/video.mp4',
    chat: '@target',
    topic: '42',
    caption: '说明\n#video',
    photo: true,
    remove: true
  }), [
    'upload', '-p', '/tmp/video.mp4', '-c', '@target', '--topic', '42',
    '--caption', '说明\n#video', '--photo', '--rm'
  ])
})

test('Given login and chat-list specs, when converted, then setup commands are canonical', () => {
  assert.deepEqual(toArgs({ kind: 'login', type: 'qr' }), ['login', '-T', 'qr'])
  assert.deepEqual(toArgs({ kind: 'chat-list', output: 'table', filter: "Type == 'channel'" }), [
    'chat', 'ls', '-o', 'table', '--filter', "Type == 'channel'"
  ])
})

test('Given a download spec, when converted, then repeated sources and resume mode are preserved', () => {
  assert.deepEqual(toArgs({
    kind: 'download',
    directory: '/tmp/media',
    include: 'mp4,jpg',
    exclude: 'webp',
    template: '{{ .DialogID }}',
    group: true,
    skipSame: true,
    rewriteExt: true,
    serve: true,
    port: 8080,
    takeout: true,
    desc: true,
    resumeMode: 'continue',
    source: { type: 'url', items: ['https://t.me/a/1', 'https://t.me/a/2'] }
  }), [
    'download', '-d', '/tmp/media', '-i', 'mp4,jpg', '-e', 'webp', '--template', '{{ .DialogID }}',
    '--group', '--skip-same', '--rewrite-ext', '--serve', '--port', '8080', '--takeout', '--desc',
    '--continue', '-u', 'https://t.me/a/1', '-u', 'https://t.me/a/2'
  ])
})

test('Given a comment-forward spec, when executed, then it routes to the worker payload', () => {
  const spec = {
    kind: 'comment-forward',
    sourceChat: '@source',
    targetChat: '@target',
    targetTopicId: 42,
    startId: 10,
    endId: 20,
    mode: 'direct',
    delayMs: 1500,
    workDir: '/tmp/work',
    includeComments: true,
    forwardMain: true,
    forwardComments: true,
    exportOnly: false,
    dryRun: true,
    resume: false,
    skipExistingExport: false,
    desc: false,
    continueOnError: true,
    blockKeywordsText: '广告',
    keywordCaseSensitive: false,
    keywordRegexMode: false,
    skipCommentsWhenPostBlocked: true
  }

  assert.deepEqual(executionForSpec(spec), { kind: 'comment-forward', payload: spec })
})

test('Given an export spec, when incremented, then the range changes without parsing arguments', () => {
  const spec = {
    kind: 'export',
    chat: '@source',
    selector: { type: 'last', input: '50' },
    all: true,
    raw: false,
    output: '/tmp/messages.json'
  }

  const next = createIncrementalSpec(spec, 101, 150, '20260812_120000')

  assert.deepEqual(next.selector, { type: 'id', input: '101,150' })
  assert.equal(next.output, '/tmp/messages_101-150_20260812_120000.json')
  assert.equal(sourceChatForSpec(next), '@source')
  assert.deepEqual(spec.selector, { type: 'last', input: '50' })
})

test('Given an unsupported spec, when converted, then it fails at the boundary', () => {
  assert.throws(() => toArgs({ kind: 'unknown' }), /Unsupported JobSpec kind/)
})
