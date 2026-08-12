const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { CommentForwardWorker } = require('./commentForwardWorker.cjs')
const { extractMessageIds } = require('./shared/messageJson.cjs')

const isDev = !app.isPackaged
const devServerUrl = 'http://127.0.0.1:5174'
let currentCommentForwardWorker = null
let mainWindow = null
let tray = null
let isQuitting = false
let appStatus = {
  runningTasks: 0,
  failedTasks: 0,
  enabledSchedules: 0,
  totalSchedules: 0,
  schedulerPaused: false,
  lastScheduleCheck: ''
}
const activeTdlChildren = new Map()

// tdl 的 stdout 是高频小块（进度条每秒几十上百次重绘）。
// 每块都单独走一次 IPC + 一次渲染端 push，会把主进程和渲染进程一起拖死。
// 这里按 taskId 聚合，最多每 LOG_FLUSH_MS 发一帧，并且单帧超过 LOG_FLUSH_MAX_BYTES 立即冲刷。
const LOG_FLUSH_MS = 120
const LOG_FLUSH_MAX_BYTES = 64 * 1024
const logBuffers = new Map()

function flushLogBuffer(key) {
  const entry = logBuffers.get(key)
  if (!entry) return
  logBuffers.delete(key)
  if (entry.timer) clearTimeout(entry.timer)
  if (!entry.text) return
  const sender = entry.sender
  if (!sender || sender.isDestroyed()) return
  sender.send('tdl:log', { taskId: entry.taskId, level: entry.level, text: entry.text })
}

function flushAllLogBuffers() {
  for (const key of Array.from(logBuffers.keys())) flushLogBuffer(key)
}

function sendLog(sender, { taskId, level, text }) {
  if (!sender || sender.isDestroyed()) return
  const content = String(text ?? '')
  if (!content) return
  const key = `${sender.id}::${taskId}::${level}`
  const existing = logBuffers.get(key)
  if (existing) {
    existing.text += content
    if (existing.text.length >= LOG_FLUSH_MAX_BYTES) flushLogBuffer(key)
    return
  }
  const entry = { sender, taskId, level, text: content, timer: null }
  entry.timer = setTimeout(() => flushLogBuffer(key), LOG_FLUSH_MS)
  if (entry.timer.unref) entry.timer.unref()
  logBuffers.set(key, entry)
  if (entry.text.length >= LOG_FLUSH_MAX_BYTES) flushLogBuffer(key)
}

const userDataDir = () => app.getPath('userData')
const configPath = () => path.join(userDataDir(), 'config.json')
const chatCachePath = () => path.join(userDataDir(), 'chats-cache.json')

function projectRoot() {
  // In dev mode, __dirname is <project>/electron, so the root is one level up.
  return path.resolve(__dirname, '..')
}

function defaultOutputDir() {
  // 打包后 dirname(exe) 在 macOS 上是 HopeTDL.app/Contents/MacOS，
  // 往里写 output/ 会破坏签名、被 Gatekeeper 拦，而且升级时整个目录被替换、数据丢失。
  // 打包版一律写到用户可见的文档目录。
  const base = isDev ? projectRoot() : path.join(app.getPath('documents'), 'HopeTDL')
  const dir = path.join(base, 'output')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function appIconPath() {
  return path.join(projectRoot(), 'assets', 'icons', 'icon.png')
}

function trayIconPath() {
  return path.join(projectRoot(), 'assets', 'icons', 'icon-24.png')
}

function trayIcon() {
  const image = nativeImage.createFromPath(trayIconPath())
  return image.resize({ width: 18, height: 18 })
}

function commandExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function augmentedPathEnv() {
  const extraPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
  const currentPath = process.env.PATH || ''
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  for (const item of extraPaths) {
    if (!parts.includes(item)) parts.push(item)
  }
  return parts.join(path.delimiter)
}

function resolveTdlPath(tdlPath = 'tdl') {
  const raw = String(tdlPath || 'tdl').trim()
  if (!raw || raw === 'tdl') {
    const candidates = [
      '/opt/homebrew/bin/tdl',
      '/usr/local/bin/tdl',
      '/usr/bin/tdl',
      '/bin/tdl'
    ]
    const found = candidates.find(commandExists)
    return found || 'tdl'
  }
  if (path.isAbsolute(raw)) return raw
  return raw
}

function defaultConfig() {
  return {
    ns: 'hope',
    proxy: '',
    delay: '',
    limit: 1,
    threads: 4,
    // Chat list cache TTL. The first launch refreshes once; within this period, pages read the cached list.
    chatCacheDays: 7,
    // Default export/download location is <project root>/output.
    defaultDownloadDir: defaultOutputDir(),
    tdlPath: resolveTdlPath('tdl')
  }
}

function readConfig() {
  const defaults = defaultConfig()
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    const config = { ...defaults, ...saved }
    if (!config.defaultDownloadDir) config.defaultDownloadDir = defaultOutputDir()
    return config
  } catch {
    return defaults
  }
}

function saveConfig(config) {
  const defaults = defaultConfig()
  fs.mkdirSync(userDataDir(), { recursive: true })
  const nextConfig = { ...defaults, ...config }
  if (!nextConfig.defaultDownloadDir) nextConfig.defaultDownloadDir = defaultOutputDir()
  fs.writeFileSync(configPath(), JSON.stringify(nextConfig, null, 2), 'utf8')
  return readConfig()
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow()
    return mainWindow
  }

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 768,
    minHeight: 640,
    title: 'HopeTDL',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  mainWindow = win

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideMainWindow()
  })

  win.on('minimize', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideMainWindow()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (isDev) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (process.platform === 'darwin' && app.dock) app.dock.show()
  mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  if (process.platform === 'darwin' && app.dock) app.dock.hide()
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function shutdownRunningTasks() {
  if (currentCommentForwardWorker) {
    currentCommentForwardWorker.abort()
    currentCommentForwardWorker = null
  }
  for (const child of activeTdlChildren.values()) {
    try { child.kill('SIGTERM') } catch {}
  }
  activeTdlChildren.clear()
}

function updateDockBadge() {
  if (process.platform !== 'darwin' || !app.dock) return
  if (appStatus.runningTasks > 0) {
    app.dock.setBadge(String(appStatus.runningTasks))
    return
  }
  if (appStatus.failedTasks > 0) {
    app.dock.setBadge('!')
    return
  }
  app.dock.setBadge('')
}

function navigateRenderer(view) {
  showMainWindow()
  sendToRenderer('app:navigate', view)
}

function updateTrayMenu() {
  if (!tray) return
  const scheduleText = appStatus.schedulerPaused
    ? `定时任务：已暂停（${appStatus.enabledSchedules}/${appStatus.totalSchedules}）`
    : `定时任务：已启用 ${appStatus.enabledSchedules}/${appStatus.totalSchedules}`
  tray.setToolTip(`HopeTDL · 运行中 ${appStatus.runningTasks} · 定时 ${appStatus.enabledSchedules}/${appStatus.totalSchedules}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'HopeTDL', enabled: false },
    { label: `运行中任务：${appStatus.runningTasks}`, enabled: false },
    { label: `失败任务：${appStatus.failedTasks}`, enabled: false },
    { label: scheduleText, enabled: false },
    { label: `最近一次检测：${appStatus.lastScheduleCheck || '-'}`, enabled: false },
    { type: 'separator' },
    { label: '打开 HopeTDL', click: showMainWindow },
    { label: '任务', click: () => navigateRenderer('tasks') },
    { label: '设置', click: () => navigateRenderer('settings') },
    { type: 'separator' },
    {
      label: appStatus.schedulerPaused ? '恢复定时任务' : '暂停所有定时任务',
      click: () => {
        appStatus.schedulerPaused = !appStatus.schedulerPaused
        sendToRenderer('app:scheduler-paused', appStatus.schedulerPaused)
        updateDockBadge()
        updateTrayMenu()
      }
    },
    {
      label: '停止全部运行中任务',
      enabled: appStatus.runningTasks > 0 || activeTdlChildren.size > 0 || !!currentCommentForwardWorker,
      click: () => {
        shutdownRunningTasks()
        sendToRenderer('app:tasks-stopped')
      }
    },
    {
      label: '打开输出目录',
      click: async () => {
        const config = readConfig()
        await shell.openPath(config.defaultDownloadDir || defaultOutputDir())
      }
    },
    { type: 'separator' },
    {
      label: '退出 HopeTDL',
      click: () => {
        isQuitting = true
        shutdownRunningTasks()
        app.quit()
      }
    }
  ]))
}

function createTray() {
  if (tray) return tray
  tray = new Tray(trayIcon())
  updateTrayMenu()
  tray.on('click', showMainWindow)
  return tray
}

function buildGlobalArgs(config) {
  const args = []
  if (config.proxy) args.push('--proxy', config.proxy)
  if (config.delay) args.push('--delay', config.delay)
  if (config.limit) args.push('-l', String(config.limit))
  if (config.threads) args.push('--threads', String(config.threads))
  if (config.ns) args.push('-n', config.ns)
  return args
}

function runTdl(event, payload) {
  const config = readConfig()
  const tdlPath = resolveTdlPath(config.tdlPath || 'tdl')
  const args = [...buildGlobalArgs(config), ...(payload.args || [])]
  const taskId = payload.taskId || `task_${Date.now()}`
  sendLog(event.sender, { taskId, level: 'info', text: `$ ${tdlPath} ${args.map(a => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}\n` })

  // Ensure the parent directory of export/download output exists when -o is used.
  const outputIndex = args.findIndex(item => String(item) === '-o' || String(item) === '--output')
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    try {
      fs.mkdirSync(path.dirname(String(args[outputIndex + 1])), { recursive: true })
    } catch (err) {
      sendLog(event.sender, { taskId, level: 'warning', text: `[输出目录创建失败] ${err.message}\n` })
    }
  }

  const child = spawn(tdlPath, args, { shell: false, env: { ...process.env, PATH: augmentedPathEnv() } })
  activeTdlChildren.set(taskId, child)

  child.stdout.on('data', data => {
    sendLog(event.sender, { taskId, level: 'stdout', text: data.toString() })
  })
  child.stderr.on('data', data => {
    sendLog(event.sender, { taskId, level: 'stderr', text: data.toString() })
  })
  child.on('error', err => {
    activeTdlChildren.delete(taskId)
    sendLog(event.sender, { taskId, level: 'error', text: `\n[启动失败] ${err.message}\n[建议] 打包后的 macOS App 可能找不到终端里的 tdl。请在设置里把 tdl 路径改成 /opt/homebrew/bin/tdl 或 /usr/local/bin/tdl；本版也会自动尝试这些路径。\n` })
    flushAllLogBuffers()
    if (!event.sender.isDestroyed()) event.sender.send('tdl:done', { taskId, code: -1 })
  })
  child.on('close', code => {
    activeTdlChildren.delete(taskId)
    sendLog(event.sender, { taskId, level: code === 0 ? 'info' : 'error', text: `\n[任务结束] exit code: ${code}\n` })
    // 任务结束时立即冲刷，保证 done 之前日志已经到齐。
    flushAllLogBuffers()
    if (!event.sender.isDestroyed()) event.sender.send('tdl:done', { taskId, code })
  })
  return { taskId, pid: child.pid, args }
}

function stopTdlTask(taskId) {
  const child = activeTdlChildren.get(taskId)
  if (!child) return { ok: false, message: '任务不在运行中或已结束' }
  child.kill('SIGTERM')
  return { ok: true, message: '已请求停止任务' }
}


// 对话缓存文件可能有几 MB。chats:cache:get 每个页面都会调，
// 每次都整份 readFileSync + JSON.parse 会反复制造大对象喂给 GC。
// 按 mtime 记忆解析结果，文件没变就直接复用。
let chatStoreMemo = { mtimeMs: -1, size: -1, store: null }

function readChatCacheStore() {
  const file = chatCachePath()
  try {
    const stat = fs.statSync(file)
    if (chatStoreMemo.store && chatStoreMemo.mtimeMs === stat.mtimeMs && chatStoreMemo.size === stat.size) {
      return chatStoreMemo.store
    }
    const store = JSON.parse(fs.readFileSync(file, 'utf8'))
    chatStoreMemo = { mtimeMs: stat.mtimeMs, size: stat.size, store }
    return store
  } catch {
    return { version: 1, caches: {} }
  }
}

function writeChatCacheStore(store) {
  fs.mkdirSync(userDataDir(), { recursive: true })
  const file = chatCachePath()
  fs.writeFileSync(file, JSON.stringify(store), 'utf8')
  try {
    const stat = fs.statSync(file)
    chatStoreMemo = { mtimeMs: stat.mtimeMs, size: stat.size, store }
  } catch {
    chatStoreMemo = { mtimeMs: -1, size: -1, store: null }
  }
}

function chatCacheTtlMs(config = readConfig()) {
  const days = Number(config.chatCacheDays || 7)
  return Math.max(1, days) * 24 * 60 * 60 * 1000
}

function chatCacheInfo(config = readConfig()) {
  const ns = String(config.ns || 'default')
  const store = readChatCacheStore()
  const current = store.caches?.[ns] || { updatedAt: 0, chats: [] }
  const chats = Array.isArray(current.chats) ? current.chats : []
  const updatedAt = Number(current.updatedAt || 0)
  const ttlDays = Number(config.chatCacheDays || 7)
  const expired = !updatedAt || (Date.now() - updatedAt > chatCacheTtlMs(config))
  return {
    ns,
    chats,
    count: chats.length,
    updatedAt,
    updatedAtText: updatedAt ? new Date(updatedAt).toLocaleString() : '',
    ttlDays,
    expired,
    cacheFile: chatCachePath()
  }
}

function saveChatCache(config, chats) {
  const ns = String(config.ns || 'default')
  const store = readChatCacheStore()
  if (!store.version) store.version = 1
  if (!store.caches) store.caches = {}
  store.caches[ns] = {
    ns,
    updatedAt: Date.now(),
    chats: Array.isArray(chats) ? chats : []
  }
  writeChatCacheStore(store)
  return chatCacheInfo(config)
}

function parseChatListOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return []
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.dialogs)) return parsed.dialogs
  if (Array.isArray(parsed?.items)) return parsed.items
  return []
}

function fetchChatsFromTdl(event, { filter = '', cache = false, reason = 'refresh' } = {}) {
  const config = readConfig()
  const tdlPath = resolveTdlPath(config.tdlPath || 'tdl')
  const args = [...buildGlobalArgs(config), 'chat', 'ls', '-o', 'json']
  if (filter) args.push('--filter', filter)

  if (event?.sender) {
    sendLog(event.sender, {
      taskId: 'chat-cache',
      level: 'info',
      text: `$ ${tdlPath} ${args.map(a => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}\n`
    })
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(tdlPath, args, { shell: false, env: { ...process.env, PATH: augmentedPathEnv() } })
    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', err => reject(new Error(err.message)))
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `tdl exited with code ${code}`))
        return
      }
      try {
        const chats = parseChatListOutput(stdout)
        const result = cache ? saveChatCache(config, chats) : { chats, count: chats.length }
        if (event?.sender) {
          sendLog(event.sender, {
            taskId: 'chat-cache',
            level: 'info',
            text: `[对话列表] ${reason} 完成，共 ${chats.length} 条\n`
          })
          flushAllLogBuffers()
        }
        resolve(result)
      } catch (err) {
        reject(new Error(`Failed to parse tdl output: ${err.message}\n${stdout}`))
      }
    })
  })
}


function analyzeExportFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: '输出文件不存在', filePath }
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.trim()) return { ok: false, reason: '输出文件为空', filePath }
    const json = JSON.parse(content)
    // collectMessageIds 内部已经用 asSafeInteger 过滤过，这里不需要再筛一遍。
    const unique = extractMessageIds(json)
    if (!unique.length) {
      return { ok: false, reason: '没有在导出 JSON 中识别到消息 ID', filePath }
    }
    const minId = unique[0]
    const maxId = unique[unique.length - 1]
    return {
      ok: true,
      filePath,
      count: unique.length,
      minId,
      maxId,
      nextStartId: maxId + 1,
      nextInput: `${maxId + 1},9223372036854775807`
    }
  } catch (err) {
    return { ok: false, reason: err.message, filePath }
  }
}

function readCommentForwardProgress(workDir) {
  if (!workDir) return { ok: false, reason: '工作目录为空' }
  const filePath = path.join(String(workDir), 'progress.json')
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'progress.json 不存在', filePath }
  }
  try {
    const progress = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const doneEntries = Object.values(progress.done || {})
    const failedEntries = Object.values(progress.failed || {})
    const failedIds = failedEntries
      .map(item => Number(item?.id))
      .filter(id => Number.isSafeInteger(id))
      .sort((a, b) => a - b)
    return {
      ok: true,
      filePath,
      updatedAt: progress.updatedAt || '',
      doneCount: doneEntries.length,
      failedCount: failedEntries.length,
      failedIds,
      failedItems: failedEntries
        .map(item => ({
          id: Number(item?.id),
          error: item?.error || '',
          failedAt: item?.failedAt || ''
        }))
        .filter(item => Number.isSafeInteger(item.id))
        .sort((a, b) => a.id - b.id)
    }
  } catch (err) {
    return { ok: false, reason: err.message, filePath }
  }
}

function checkChatLatestMessage(chat) {
  const peer = String(chat || '').trim()
  if (!peer) return Promise.resolve({ ok: false, message: '频道为空' })

  const config = readConfig()
  const tdlPath = resolveTdlPath(config.tdlPath || 'tdl')
  const tempDir = path.join(app.getPath('temp'), 'hopetdl-checks')
  fs.mkdirSync(tempDir, { recursive: true })
  const tempFile = path.join(tempDir, `latest_${Date.now()}_${Math.random().toString(16).slice(2)}.json`)
  const args = [...buildGlobalArgs(config), 'chat', 'export', '-c', peer, '-T', 'last', '-i', '1', '--all', '--with-content', '-o', tempFile]

  return new Promise(resolve => {
    let stderr = ''
    const child = spawn(tdlPath, args, { shell: false, env: { ...process.env, PATH: augmentedPathEnv() } })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', err => {
      try { fs.rmSync(tempFile, { force: true }) } catch {}
      resolve({ ok: false, message: err.message, chat: peer })
    })
    child.on('close', code => {
      try {
        if (code !== 0) {
          resolve({ ok: false, code, message: stderr || `tdl exited with code ${code}`, chat: peer })
          return
        }
        const analysis = analyzeExportFile(tempFile)
        if (!analysis.ok) {
          resolve({ ok: false, code, message: analysis.reason || '未识别到最新消息', chat: peer })
          return
        }
        resolve({
          ok: true,
          chat: peer,
          latestMessageId: analysis.maxId,
          checkedAt: new Date().toLocaleString()
        })
      } catch (err) {
        resolve({ ok: false, code, message: err.message, chat: peer })
      } finally {
        try { fs.rmSync(tempFile, { force: true }) } catch {}
      }
    })
  })
}


function startCommentForward(event, payload = {}) {
  if (currentCommentForwardWorker) {
    return { ok: false, message: '已有评论区转发任务正在运行，请先停止当前任务' }
  }

  const config = readConfig()
  const taskId = payload.taskId || `comment_forward_${Date.now()}`
  const worker = new CommentForwardWorker({
    ...payload,
    taskId,
    tdlPath: resolveTdlPath(payload.tdlPath || config.tdlPath || 'tdl'),
    globalArgs: buildGlobalArgs(config),
    pathEnv: augmentedPathEnv(),
    baseOutputDir: payload.baseOutputDir || config.defaultDownloadDir || defaultOutputDir()
  })

  currentCommentForwardWorker = worker
  const sender = event.sender

  worker.on('log', data => {
    sendLog(sender, data)
  })

  worker.on('progress', data => {
    if (!sender.isDestroyed()) sender.send('comment-forward:progress', data)
  })

  worker.on('status', data => {
    if (!sender.isDestroyed()) sender.send('comment-forward:status', data)
    if (['done', 'error', 'stopped'].includes(data.status)) {
      flushAllLogBuffers()
      if (!sender.isDestroyed()) sender.send('tdl:done', { taskId, code: data.status === 'done' ? 0 : 1 })
      currentCommentForwardWorker = null
    }
  })

  worker.start()
  return { ok: true, taskId, workDir: worker.paths.root, message: '评论区顺序转发任务已开始' }
}

function stopCommentForward() {
  if (!currentCommentForwardWorker) return { ok: false, message: '当前没有正在运行的评论区转发任务' }
  currentCommentForwardWorker.abort()
  return { ok: true, message: '已请求停止评论区转发任务' }
}

function runCheckCommand(command, args = [], timeoutMs = 8000) {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, { shell: false, env: { ...process.env, PATH: augmentedPathEnv() } })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, code: -1, stdout, stderr, message: '检查超时' })
    }, timeoutMs)

    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.on('error', err => {
      clearTimeout(timer)
      resolve({ ok: false, code: -1, stdout, stderr, message: err.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        message: code === 0 ? '正常' : (stderr || stdout || `退出码 ${code}`).trim()
      })
    })
  })
}

async function checkEnvironment() {
  const config = readConfig()
  const tdlPath = resolveTdlPath(config.tdlPath || 'tdl')
  const outputDir = config.defaultDownloadDir || defaultOutputDir()
  const checks = []

  const version = await runCheckCommand(tdlPath, ['version'])
  checks.push({
    key: 'tdl',
    label: 'tdl version',
    ok: version.ok,
    detail: version.ok ? (version.stdout || version.stderr).trim() : version.message,
    meta: tdlPath
  })

  try {
    fs.mkdirSync(outputDir, { recursive: true })
    fs.accessSync(outputDir, fs.constants.W_OK)
    checks.push({ key: 'output', label: '输出目录可写', ok: true, detail: outputDir })
  } catch (err) {
    checks.push({ key: 'output', label: '输出目录可写', ok: false, detail: err.message, meta: outputDir })
  }

  checks.push({
    key: 'ns',
    label: '命名空间 ns',
    ok: !!String(config.ns || '').trim(),
    detail: String(config.ns || '').trim() || '未设置'
  })

  checks.push({
    key: 'proxy',
    label: '代理',
    ok: !config.proxy || /^(socks5|http|https):\/\//i.test(String(config.proxy)),
    detail: config.proxy || '未设置'
  })

  return {
    ok: checks.every(item => item.ok),
    checkedAt: new Date().toLocaleString(),
    checks
  }
}

ipcMain.handle('config:get', () => readConfig())
ipcMain.handle('config:set', (_, config) => saveConfig(config))
ipcMain.handle('tdl:run', (event, payload) => runTdl(event, payload))
ipcMain.handle('tdl:stop', (_, taskId) => stopTdlTask(taskId))
ipcMain.handle('environment:check', () => checkEnvironment())
ipcMain.handle('comment-forward:start', (event, payload) => startCommentForward(event, payload))
ipcMain.handle('comment-forward:stop', () => stopCommentForward())
ipcMain.handle('dialog:openFile', async (_, options = {}) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], ...options })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('dialog:openDirectory', async (_, options = {}) => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], ...options })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('path:defaultOutputDir', () => defaultOutputDir())
ipcMain.handle('export:analyze', (_, filePath) => analyzeExportFile(filePath))
ipcMain.handle('comment-forward:progress:read', (_, workDir) => readCommentForwardProgress(workDir))
ipcMain.handle('chats:latest-message', (_, chat) => checkChatLatestMessage(chat))
ipcMain.handle('shell:showItemInFolder', (_, filePath) => {
  if (filePath) shell.showItemInFolder(filePath)
  return true
})
ipcMain.handle('shell:openPath', async (_, targetPath) => {
  if (!targetPath) return { ok: false, message: '路径为空' }
  const message = await shell.openPath(targetPath)
  return { ok: !message, message }
})
ipcMain.handle('dialog:saveFile', async (_, options = {}) => {
  if (options.defaultPath) {
    try { fs.mkdirSync(path.dirname(String(options.defaultPath)), { recursive: true }) } catch {}
  }
  const result = await dialog.showSaveDialog(options)
  return result.canceled ? null : result.filePath
})

// Chat cache APIs.
// Pages such as export/forward/upload must read this central cache instead of running tdl repeatedly.
ipcMain.handle('chats:cache:get', () => chatCacheInfo(readConfig()))
ipcMain.handle('chats:cache:ensure', async (event) => {
  const config = readConfig()
  const info = chatCacheInfo(config)
  if (info.chats.length && !info.expired) return { ...info, refreshed: false }
  const refreshed = await fetchChatsFromTdl(event, { cache: true, reason: info.chats.length ? '缓存过期自动刷新' : '首次启动自动刷新' })
  return { ...refreshed, refreshed: true }
})
ipcMain.handle('chats:cache:refresh', async (event) => {
  const refreshed = await fetchChatsFromTdl(event, { cache: true, reason: '手动刷新缓存' })
  return { ...refreshed, refreshed: true }
})

// Compatibility API: filter requests are live and do not overwrite the central cache.
// Without filter, this returns cached data unless force=true.
ipcMain.handle('chats:list', async (event, options = {}) => {
  if (options.filter) {
    const live = await fetchChatsFromTdl(event, { filter: options.filter, cache: false, reason: '按过滤条件读取' })
    return live.chats
  }
  if (options.force) {
    const refreshed = await fetchChatsFromTdl(event, { cache: true, reason: '手动刷新缓存' })
    return refreshed.chats
  }
  const info = chatCacheInfo(readConfig())
  return info.chats
})
ipcMain.handle('app:show', () => {
  showMainWindow()
  return true
})
ipcMain.handle('app:status', (_, status = {}) => {
  appStatus = {
    ...appStatus,
    runningTasks: Number(status.runningTasks || 0),
    failedTasks: Number(status.failedTasks || 0),
    enabledSchedules: Number(status.enabledSchedules || 0),
    totalSchedules: Number(status.totalSchedules || 0),
    schedulerPaused: !!status.schedulerPaused,
    lastScheduleCheck: status.lastScheduleCheck || ''
  }
  updateDockBadge()
  updateTrayMenu()
  return true
})
ipcMain.handle('app:quit', () => {
  isQuitting = true
  shutdownRunningTasks()
  app.quit()
  return true
})

app.setName('HopeTDL')

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath())
  }
  createTray()
  createWindow()
})
app.on('before-quit', () => {
  isQuitting = true
  shutdownRunningTasks()
})
app.on('window-all-closed', () => {
  if (isQuitting) return
})
app.on('activate', () => {
  showMainWindow()
})
