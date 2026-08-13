import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createErrorTails, summarizeTail } = require('../electron/shared/errorTail.cjs')

const ESC = ''

test('Given progress redraws and colors, when summarized, then only the final clean lines remain', () => {
  // 进度条在同一行里用 \r 反复重绘，只有最后一次重绘的内容是真实的。
  const raw = `downloading 10%\rdownloading 90%\n${ESC}[31mERROR${ESC}[0m failed to connect\n`
  assert.equal(summarizeTail(raw), 'downloading 90%\nERROR failed to connect')
})

test('Given a Go stack trace, when summarized, then only the human-readable lines survive', () => {
  // 实测取自 tdl 0.20.3：把一个不存在的频道填进导出任务。
  const raw = [
    'Error: callback:',
    'github.com/gotd/td/telegram.(*Client).Run.func3',
    'github.com/gotd/td@v0.140.0/telegram/connect.go:180',
    '- failed to get peer: resolve: rpc error code 400: USERNAME_NOT_OCCUPIED'
  ].join('\n')
  assert.equal(
    summarizeTail(raw),
    'Error: callback:\n- failed to get peer: resolve: rpc error code 400: USERNAME_NOT_OCCUPIED'
  )
})

test('Given long output, when summarized, then only the tail is kept', () => {
  const raw = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
  assert.equal(summarizeTail(raw), 'line 46\nline 47\nline 48\nline 49')
})

test('Given a task that only wrote to stdout, when taken, then stdout is the fallback reason', () => {
  const tails = createErrorTails()
  tails.record('t1', 'stdout', 'FLOOD_WAIT (37)\n')
  assert.equal(tails.take('t1'), 'FLOOD_WAIT (37)')
})

test('Given both channels, when taken, then stderr wins and the buffer is released', () => {
  const tails = createErrorTails()
  tails.record('t1', 'stdout', 'exporting…\n')
  tails.record('t1', 'stderr', 'context deadline exceeded\n')
  assert.equal(tails.take('t1'), 'context deadline exceeded')
  assert.equal(tails.take('t1'), '')
  assert.equal(tails.size, 0)
})

test('Given endless output, when recorded, then the buffer stays bounded', () => {
  const tails = createErrorTails(64)
  for (let i = 0; i < 1000; i += 1) tails.record('t1', 'stderr', `chunk ${i}\n`)
  assert.ok(tails.take('t1').includes('chunk 999'))
})
