import { appState } from './state'
import { message } from './ui/naive'

const TASKS_KEY = 'hopetdl.tasks.v1'
const SCHEDULES_KEY = 'hopetdl.schedules.v1'

export function quoteArg(v) {
  if (v === undefined || v === null || v === '') return ''
  const s = String(v)
  return /[\s'"{}]/.test(s) ? JSON.stringify(s) : s
}

export function globalArgs() {
  const c = appState.config || {}
  const args = []
  if (c.proxy) args.push('--proxy', c.proxy)
  if (c.delay) args.push('--delay', c.delay)
  if (c.limit) args.push('-l', String(c.limit))
  if (c.threads) args.push('--threads', String(c.threads))
  if (c.ns) args.push('-n', c.ns)
  return args
}

export function commandText(args) {
  const c = appState.config || {}
  return [c.tdlPath || 'tdl', ...globalArgs(), ...args].map(quoteArg).join(' ')
}

export function persistTasks() {
  try {
    const snapshot = appState.tasks.slice(0, 100)
    localStorage.setItem(TASKS_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage failures; task state still works in memory.
  }
}

export function persistSchedules() {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(appState.schedules.slice(0, 100)))
  } catch {
    // Ignore storage failures; schedule state still works in memory.
  }
}

export function createTask(type, args, title, extra = {}) {
  const id = extra.id || `${type}_${Date.now()}`
  const task = {
    id,
    type,
    title,
    status: extra.status || '运行中',
    args: Array.isArray(args) ? args : [],
    createdAt: extra.createdAt || new Date().toLocaleString(),
    finishedAt: extra.finishedAt || '',
    exitCode: extra.exitCode ?? null,
    ...extra,
    id
  }
  appState.tasks.unshift(task)
  persistTasks()
  return task
}

export function updateTaskStatus(taskId, status, extra = {}) {
  const task = appState.tasks.find(t => t.id === taskId)
  if (!task) return null
  Object.assign(task, {
    status,
    ...extra
  })
  if (!task.finishedAt && status !== '运行中') task.finishedAt = new Date().toLocaleString()
  persistTasks()
  return task
}

export async function runTask(type, args, title, extra = {}) {
  const task = createTask(type, args, title, extra)
  return window.tdlApi.run({ taskId: task.id, args })
}

export async function copyTaskCommand(task) {
  const text = task?.command || commandText(task?.args || [])
  await navigator.clipboard.writeText(text)
  message.success('命令已复制')
}

export async function retryTask(task) {
  if (!task) return null
  return runTask(task.type, task.args || [], task.title || task.type)
}

function nextRunAfter(schedule, from = Date.now()) {
  if (schedule.mode === 'interval') {
    const minutes = Math.max(1, Number(schedule.intervalMinutes || 1))
    return from + minutes * 60 * 1000
  }
  return Number(schedule.runAt || 0)
}

function sourceChatFromArgs(args = []) {
  const chatIndex = args.findIndex(item => ['-c', '--chat'].includes(String(item)))
  if (chatIndex >= 0 && args[chatIndex + 1]) return String(args[chatIndex + 1])
  return ''
}

function argValue(args = [], names = []) {
  const index = args.findIndex(item => names.includes(String(item)))
  return index >= 0 && args[index + 1] ? String(args[index + 1]) : ''
}

function inputRangeFromArgs(args = []) {
  const inputIndex = args.findIndex(item => ['-i', '--input'].includes(String(item)))
  if (inputIndex < 0 || !args[inputIndex + 1]) return null
  const raw = String(args[inputIndex + 1]).trim()
  const parts = raw.split(',').map(item => Number(String(item).trim()))
  if (!parts.length || parts.some(item => !Number.isSafeInteger(item) || item < 0)) return null
  if (parts.length === 1) return { start: parts[0], end: parts[0], raw }
  return { start: parts[0], end: parts[1], raw }
}

function replaceArgValue(args = [], names = [], value) {
  const next = [...args]
  const index = next.findIndex(item => names.includes(String(item)))
  if (index >= 0) {
    next[index + 1] = String(value)
    return next
  }
  next.push(names[0], String(value))
  return next
}

function timestampToken() {
  const date = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function outputPathForRange(outputPath, rangeText) {
  if (!outputPath) return ''
  const text = String(outputPath)
  const dotIndex = text.lastIndexOf('.')
  const suffix = `_${String(rangeText).replace(/[^0-9a-zA-Z_-]/g, '-')}_${timestampToken()}`
  if (dotIndex <= 0) return `${text}${suffix}`
  return `${text.slice(0, dotIndex)}${suffix}${text.slice(dotIndex)}`
}

function argsForIncrementalRange(args = [], start, end) {
  const rangeText = `${start},${end}`
  let next = replaceArgValue(args, ['-T', '--type'], 'id')
  next = replaceArgValue(next, ['-i', '--input'], rangeText)
  const outputIndex = next.findIndex(item => ['-o', '--output'].includes(String(item)))
  if (outputIndex >= 0 && next[outputIndex + 1]) {
    next[outputIndex + 1] = outputPathForRange(next[outputIndex + 1], rangeText)
  }
  return next
}

function outputPathFromArgs(args = []) {
  return argValue(args, ['-o', '--output'])
}

function fromPathFromArgs(args = []) {
  return argValue(args, ['--from'])
}

function defaultIncrementalOutputPath(schedule, rangeText) {
  const baseDir = appState.config?.defaultDownloadDir || ''
  const safeName = String(schedule.name || schedule.type || 'schedule')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60)
  const fileName = `${safeName}_${rangeText.replace(/[^0-9a-zA-Z_-]/g, '-')}_${timestampToken()}.json`
  if (!baseDir) return fileName
  const clean = String(baseDir).replace(/[\\/]+$/, '')
  const sep = clean.includes('\\') ? '\\' : '/'
  return `${clean}${sep}${fileName}`
}

function exportArgsForSchedule(schedule, start, end) {
  const rangeText = `${start},${end}`
  if (schedule.type === 'export') return argsForIncrementalRange(schedule.args, start, end)
  const output = defaultIncrementalOutputPath(schedule, rangeText)
  return ['chat', 'export', '-c', schedule.watchChat, '-T', 'id', '-i', rangeText, '--all', '--with-content', '-o', output]
}

function forwardArgsForIncrementalFile(args = [], filePath) {
  return replaceArgValue(args, ['--from'], filePath)
}

function runTaskAndWait(type, args, title, extra = {}) {
  return new Promise(async (resolve, reject) => {
    let offDone = null
    try {
      const task = createTask(type, args, title, extra)
      const taskId = task.id
      offDone = window.tdlApi.onDone(data => {
        if (data.taskId !== taskId) return
        if (offDone) offDone()
        if (data.code === 0) resolve(data)
        else reject(new Error(`任务失败，退出码 ${data.code}`))
      })
      await window.tdlApi.run({ taskId, args })
    } catch (err) {
      if (offDone) offDone()
      reject(err)
    }
  })
}

export function createScheduleFromTask(task, options = {}) {
  if (!task || !Array.isArray(task.args) || !task.args.length) {
    throw new Error('该任务没有可重放的 tdl 参数，不能创建定时任务')
  }
  if (task.type === 'comment-forward') {
    throw new Error('评论区转发暂不支持从任务中心定时重放，请使用普通 tdl 任务创建计划')
  }

  const schedule = {
    id: `schedule_${Date.now()}`,
    name: options.name || task.title || task.type,
    type: task.type,
    args: [...task.args],
    templateOutputPath: outputPathFromArgs(task.args),
    templateFromPath: fromPathFromArgs(task.args),
    mode: options.mode || 'once',
    triggerMode: options.triggerMode || 'time',
    watchChat: options.watchChat || sourceChatFromArgs(task.args),
    lastSeenMessageId: Number(options.lastSeenMessageId || inputRangeFromArgs(task.args)?.end || 0),
    lastCheckedAt: '',
    runAt: Number(options.runAt || Date.now()),
    intervalMinutes: Math.max(1, Number(options.intervalMinutes || 60)),
    enabled: options.enabled !== false,
    createdAt: new Date().toLocaleString(),
    lastRunAt: '',
    nextRunAt: 0,
    runCount: 0,
    lastStatus: options.lastStatus || '未运行'
  }
  schedule.nextRunAt = nextRunAfter(schedule, schedule.mode === 'interval' ? Date.now() : 0)
  appState.schedules.unshift(schedule)
  persistSchedules()
  return schedule
}

export function updateSchedule(scheduleId, patch = {}) {
  const schedule = appState.schedules.find(item => item.id === scheduleId)
  if (!schedule) return null
  Object.assign(schedule, patch)
  if (patch.mode || patch.runAt || patch.intervalMinutes) {
    schedule.nextRunAt = nextRunAfter(schedule, schedule.mode === 'interval' ? Date.now() : 0)
  }
  persistSchedules()
  return schedule
}

export function deleteSchedule(scheduleId) {
  appState.schedules = appState.schedules.filter(item => item.id !== scheduleId)
  persistSchedules()
}

export function toggleSchedule(schedule) {
  if (!schedule) return null
  schedule.enabled = !schedule.enabled
  if (schedule.enabled) {
    schedule.nextRunAt = nextRunAfter(schedule, schedule.mode === 'interval' ? Date.now() : 0)
  }
  persistSchedules()
  return schedule
}

export async function runScheduledTaskNow(schedule) {
  if (!schedule || !Array.isArray(schedule.args)) return null
  if (schedule.chain === 'export-forward') {
    const exportArgs = schedule.nextExportArgs || []
    const exportOutput = outputPathFromArgs(exportArgs)
    if (!exportArgs.length || !exportOutput) throw new Error('缺少增量导出参数')
    await runTaskAndWait('export', exportArgs, `${schedule.name || schedule.type}（定时导出）`, { scheduleId: schedule.id })
    const forwardArgs = forwardArgsForIncrementalFile(schedule.args, exportOutput)
    const result = await runTaskAndWait('forward', forwardArgs, `${schedule.name || schedule.type}（定时转发）`, { scheduleId: schedule.id })
    schedule.lastRunAt = new Date().toLocaleString()
    schedule.runCount = Number(schedule.runCount || 0) + 1
    schedule.lastStatus = '已发起增量导出并转发'
    if (schedule.pendingLastSeenMessageId) schedule.lastSeenMessageId = schedule.pendingLastSeenMessageId
    schedule.nextArgs = null
    schedule.nextExportArgs = null
    schedule.pendingLastSeenMessageId = 0
    persistSchedules()
    return result
  }
  const taskTitle = `${schedule.name || schedule.type}（定时）`
  const runArgs = schedule.nextArgs || schedule.args
  const result = schedule.triggerMode === 'chat-update'
    ? await runTaskAndWait(schedule.type, runArgs, taskTitle, { scheduleId: schedule.id })
    : await runTask(schedule.type, runArgs, taskTitle, { scheduleId: schedule.id })
  schedule.lastRunAt = new Date().toLocaleString()
  schedule.runCount = Number(schedule.runCount || 0) + 1
  schedule.lastStatus = '已发起'
  if (schedule.pendingLastSeenMessageId) schedule.lastSeenMessageId = schedule.pendingLastSeenMessageId
  schedule.nextArgs = null
  schedule.pendingLastSeenMessageId = 0
  persistSchedules()
  return result
}

async function shouldRunSchedule(schedule) {
  if (schedule.triggerMode !== 'chat-update') return true
  const chat = String(schedule.watchChat || '').trim()
  if (!chat) {
    schedule.lastStatus = '缺少检测频道'
    schedule.lastCheckedAt = new Date().toLocaleString()
    persistSchedules()
    return false
  }

  const result = await window.tdlApi.checkChatLatestMessage(chat)
  schedule.lastCheckedAt = result?.checkedAt || new Date().toLocaleString()
  if (!result?.ok) {
    schedule.lastStatus = `检测失败：${result?.message || '未知错误'}`
    persistSchedules()
    return false
  }

  const latest = Number(result.latestMessageId || 0)
  const lastSeen = Number(schedule.lastSeenMessageId || 0)
  if (!lastSeen) {
    schedule.lastSeenMessageId = latest
    schedule.lastStatus = `已建立基线：${latest}`
    persistSchedules()
    return false
  }
  if (latest <= lastSeen) {
    schedule.lastStatus = `无更新：${latest}`
    persistSchedules()
    return false
  }

  const start = lastSeen + 1
  if (schedule.type === 'forward') {
    schedule.chain = 'export-forward'
    schedule.nextExportArgs = exportArgsForSchedule(schedule, start, latest)
    schedule.nextArgs = null
  } else {
    schedule.chain = ''
    schedule.nextArgs = argsForIncrementalRange(schedule.args, start, latest)
    schedule.nextExportArgs = null
  }
  schedule.pendingLastSeenMessageId = latest
  schedule.lastStatus = `发现更新：${start},${latest}`
  persistSchedules()
  return true
}

export function startTaskScheduler() {
  let checking = false
  const tick = async () => {
    if (checking || !window.tdlApi || appState.schedulerPaused) return
    checking = true
    const now = Date.now()
    const dueSchedules = appState.schedules.filter(schedule => (
      schedule.enabled &&
      Number(schedule.nextRunAt || 0) > 0 &&
      Number(schedule.nextRunAt || 0) <= now
    ))

    for (const schedule of dueSchedules) {
      if (schedule.mode === 'once') {
        schedule.enabled = false
        schedule.nextRunAt = 0
      } else {
        schedule.nextRunAt = nextRunAfter(schedule, now)
      }
      persistSchedules()
      appState.logs.push({
        taskId: 'scheduler',
        level: 'info',
        text: `[定时任务] 检查：${schedule.name || schedule.type}\n`
      })
      try {
        const shouldRun = await shouldRunSchedule(schedule)
        if (shouldRun) {
          await runScheduledTaskNow(schedule)
        } else {
          appState.logs.push({
            taskId: 'scheduler',
            level: 'info',
            text: `[定时任务] 跳过：${schedule.name || schedule.type}，${schedule.lastStatus || '未满足触发条件'}\n`
          })
        }
      } catch (err) {
        schedule.lastStatus = '发起失败'
        persistSchedules()
        appState.logs.push({
          taskId: 'scheduler',
          level: 'error',
          text: `[定时任务] 发起失败：${err?.message || err}\n`
        })
      }
    }
    checking = false
  }

  tick()
  const timer = window.setInterval(tick, 15000)
  return () => window.clearInterval(timer)
}

export async function stopTask(task) {
  if (!task) return { ok: false, message: '任务不存在' }
  if (!window.tdlApi) return { ok: false, message: '当前不在 Electron 环境中' }
  const result = task.type === 'comment-forward'
    ? await window.tdlApi.stopCommentForward()
    : await window.tdlApi.stop(task.id)
  if (result?.ok) {
    updateTaskStatus(task.id, '已停止', { finishedAt: new Date().toLocaleString() })
    message.warning(result.message || '已请求停止任务')
  } else {
    message.info(result?.message || '任务不在运行中或已结束')
  }
  return result
}
