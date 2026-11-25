import { appState } from './state'

// 日志面板过去是「一次 IPC 一条 reactive 记录 + 一个 DOM 节点」，且永不回收。
// tdl 下载/导出时 stdout 每秒几十上百块，跑十几分钟就是几十万条记录和几十万 DOM 节点，
// 这是内存和卡顿的主要来源。这里做三件事：
//   1. 按行合并，未换行的「活动行」（进度条）单独放 liveLines，只占一行，不进历史；
//   2. 同一行里的 \r 原地重绘只保留最后一次结果；
//   3. 历史行做环形缓冲，超过上限从头丢弃。
export const MAX_LOG_LINES = 1500
// 一次冲刷最多丢弃多少条，做批量 splice 摊销，避免每来一行 splice 一次。
const TRIM_OVERSHOOT = 300

let seq = 0
let pending = []
let flushHandle = null
// key -> 尚未换行的残句，等下一块数据接上
const carries = new Map()

function collapseCarriage(text) {
  const index = text.lastIndexOf('\r')
  return index >= 0 ? text.slice(index + 1) : text
}

// tdl 会输出 ANSI 颜色/光标转义码。日志面板是 HTML，不是终端，
// 这些码会被当成普通文字原样显示，插在输出中间（二维码里尤其明显）。
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|[@-Z\\-_])/g

function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '')
}

// tdl 的二维码登录用半块字符画图：█ ▄ ▀ 和空格。
// 这些行必须整块、按原样、以 1 倍行高渲染才扫得出来，
// 混在普通日志里既会被换行毁掉，也会被行高拉变形。所以单独抽出来。
const QR_CHARS = /^[▀▄█░▒▓ ]+$/
const QR_MIN_LINES = 10

function isQrLine(text) {
  return text.length >= 8 && QR_CHARS.test(text)
}

const qrBuffers = new Map()

function commitQrIfAny(taskId) {
  const qrBuffer=qrBuffers.get(taskId)||[]
  if (qrBuffer.length >= QR_MIN_LINES) {
    // 二维码会随 token 定期重画，后来的整块替换前一块。
    appState.loginQr = Object.freeze({
      taskId,
      lines: Object.freeze(qrBuffer.slice()),
      at: Date.now()
    })
  }
  qrBuffers.delete(taskId)
}

function isErrorLevel(level) {
  return level === 'stderr' || level === 'error'
}

function scheduleFlush() {
  if (flushHandle !== null) return
  const run = () => {
    flushHandle = null
    flush()
  }
  flushHandle = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : setTimeout(run, 100)
}

function flush() {
  if (!pending.length) return
  const batch = pending
  pending = []

  const logs = appState.logs
  let errorDelta = 0
  for (const entry of batch) {
    logs.push(entry)
    if (isErrorLevel(entry.level)) errorDelta += 1
  }

  if (logs.length > MAX_LOG_LINES + TRIM_OVERSHOOT) {
    const dropCount = logs.length - MAX_LOG_LINES
    const dropped = logs.splice(0, dropCount)
    for (const entry of dropped) {
      if (isErrorLevel(entry.level)) errorDelta -= 1
    }
  }

  appState.logErrorCount = Math.max(0, appState.logErrorCount + errorDelta)
  appState.logVersion += 1
}

/**
 * 追加一段原始输出。可以是任意大小的块，不要求按行对齐。
 * @param {{taskId?: string, level?: string, text?: string}} data
 */
export function appendLog(data) {
  const taskId = data?.taskId || 'app'
  const level = data?.level || 'info'
  const raw = String(data?.text ?? '')
  if (!raw) return

  const key = `${taskId}\u0000${level}`
  const buffer = (carries.get(key) || '') + stripAnsi(raw)
  const parts = buffer.split('\n')
  const tail = parts.pop() ?? ''

  for (const part of parts) {
    const line = collapseCarriage(part)
    // 二维码的块字符行不进日志：它们必须整块渲染，混在日志里会被换行和行高毁掉。
    if (isQrLine(line)) {
      const lines=qrBuffers.get(taskId)||[]
      lines.push(line);qrBuffers.set(taskId,lines.slice(-80))
      continue
    }
    commitQrIfAny(taskId)
    // Object.freeze 让 Vue 跳过深层响应式包装：日志只读，不需要每条都建 Proxy。
    pending.push(Object.freeze({ id: ++seq, taskId, level, text: line }))
  }

  const live = collapseCarriage(tail).slice(-32768)
  if(carries.size>=400 && !carries.has(key)){const oldest=carries.keys().next().value;carries.delete(oldest);delete appState.liveLines[oldest]}
  if(live)carries.set(key,live);else carries.delete(key)
  if (live) {
    appState.liveLines[key] = Object.freeze({ id: key, taskId, level, text: live })
  } else {
    delete appState.liveLines[key]
  }

  scheduleFlush()
}

/** 任务结束时收尾：把残留的活动行落成历史行。 */
export function finalizeLogs(taskId) {
  const prefix = `${taskId}\u0000`
  for (const key of Array.from(carries.keys())) {
    if (!key.startsWith(prefix)) continue
    const text = carries.get(key)
    carries.delete(key)
    delete appState.liveLines[key]
    if (!text) continue
    const level = key.slice(prefix.length)
    pending.push(Object.freeze({ id: ++seq, taskId, level, text }))
  }
  // 任务结束时把最后一块二维码提交掉（登录成功/超时后不会再有非二维码行来触发）。
  commitQrIfAny(taskId)
  scheduleFlush()
}

export function clearLogs() {
  carries.clear()
  pending = []
  qrBuffers.clear()
  appState.loginQr = null
  appState.logs.splice(0)
  for (const key of Object.keys(appState.liveLines)) delete appState.liveLines[key]
  appState.logErrorCount = 0
  appState.logVersion += 1
}

/** 当前全部日志行（历史 + 活动行），用于复制/导出，不参与渲染。 */
export function allLogLines() {
  return [...appState.logs, ...Object.values(appState.liveLines)]
}
