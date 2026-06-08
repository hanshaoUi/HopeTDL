const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const isDev = !app.isPackaged
const userDataDir = () => app.getPath('userData')
const configPath = () => path.join(userDataDir(), 'config.json')
const chatCachePath = () => path.join(userDataDir(), 'chats-cache.json')

function projectRoot() {
  // In dev mode, __dirname is <project>/electron, so the root is one level up.
  // In packaged mode, use the executable directory as a predictable writable-adjacent base.
  return isDev ? path.resolve(__dirname, '..') : path.dirname(app.getPath('exe'))
}

function defaultOutputDir() {
  const dir = path.join(projectRoot(), 'output')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function appIconPath() {
  // Use the same icon in dev mode and packaged mode.
  // The assets directory is included by electron-builder.
  return isDev
    ? path.join(projectRoot(), 'assets', 'icons', 'icon.png')
    : path.join(__dirname, '..', 'assets', 'icons', 'icon.png')
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
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'HopeTDL',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
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
  event.sender.send('tdl:log', { taskId, level: 'info', text: `$ ${tdlPath} ${args.map(a => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}\n` })

  // Ensure the parent directory of export/download output exists when -o is used.
  const outputIndex = args.findIndex(item => String(item) === '-o' || String(item) === '--output')
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    try {
      fs.mkdirSync(path.dirname(String(args[outputIndex + 1])), { recursive: true })
    } catch (err) {
      event.sender.send('tdl:log', { taskId, level: 'warning', text: `[输出目录创建失败] ${err.message}\n` })
    }
  }

  const child = spawn(tdlPath, args, { shell: false, env: { ...process.env, PATH: augmentedPathEnv() } })

  child.stdout.on('data', data => {
    event.sender.send('tdl:log', { taskId, level: 'stdout', text: data.toString() })
  })
  child.stderr.on('data', data => {
    event.sender.send('tdl:log', { taskId, level: 'stderr', text: data.toString() })
  })
  child.on('error', err => {
    event.sender.send('tdl:log', { taskId, level: 'error', text: `\n[启动失败] ${err.message}\n[建议] 打包后的 macOS App 可能找不到终端里的 tdl。请在设置里把 tdl 路径改成 /opt/homebrew/bin/tdl 或 /usr/local/bin/tdl；本版也会自动尝试这些路径。\n` })
    event.sender.send('tdl:done', { taskId, code: -1 })
  })
  child.on('close', code => {
    event.sender.send('tdl:log', { taskId, level: code === 0 ? 'info' : 'error', text: `\n[任务结束] exit code: ${code}\n` })
    event.sender.send('tdl:done', { taskId, code })
  })
  return { taskId, pid: child.pid, args }
}


function readChatCacheStore() {
  try {
    return JSON.parse(fs.readFileSync(chatCachePath(), 'utf8'))
  } catch {
    return { version: 1, caches: {} }
  }
}

function writeChatCacheStore(store) {
  fs.mkdirSync(userDataDir(), { recursive: true })
  fs.writeFileSync(chatCachePath(), JSON.stringify(store, null, 2), 'utf8')
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
    event.sender.send('tdl:log', {
      taskId: 'chat-cache',
      level: 'info',
      text: `$ ${tdlPath} ${args.map(a => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}\n`
    })
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    // Ensure the parent directory of export/download output exists when -o is used.
  const outputIndex = args.findIndex(item => String(item) === '-o' || String(item) === '--output')
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    try {
      fs.mkdirSync(path.dirname(String(args[outputIndex + 1])), { recursive: true })
    } catch (err) {
      event.sender.send('tdl:log', { taskId, level: 'warning', text: `[输出目录创建失败] ${err.message}\n` })
    }
  }

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
          event.sender.send('tdl:log', {
            taskId: 'chat-cache',
            level: 'info',
            text: `[对话列表] ${reason} 完成，共 ${chats.length} 条\n`
          })
        }
        resolve(result)
      } catch (err) {
        reject(new Error(`Failed to parse tdl output: ${err.message}\n${stdout}`))
      }
    })
  })
}


function asSafeInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return null
  if (n < 0) return null
  return n
}

function looksLikeMessageObject(obj, trustId = false) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const id = asSafeInteger(obj.id ?? obj.ID ?? obj.message_id ?? obj.messageID)
  if (id === null) return false
  if (trustId) return true
  const messageKeys = [
    'date', 'message', 'text', 'raw', 'media', 'file', 'from_id', 'fromId', 'peer_id', 'peerId',
    'reply_to', 'replyTo', 'edit_date', 'editDate', 'entities', 'views', 'forwards', 'out', 'post',
    'grouped_id', 'groupedId', 'via_bot_id', 'viaBotId', 'ttl_period', 'ttlPeriod'
  ]
  return messageKeys.some(key => Object.prototype.hasOwnProperty.call(obj, key))
}

function collectMessageIds(node, ids = [], contextKey = '') {
  if (!node) return ids

  if (Array.isArray(node)) {
    const trustedArray = ['messages', 'message', 'items', 'list', 'data', 'result'].includes(String(contextKey || '').toLowerCase())
    for (const item of node) {
      if (looksLikeMessageObject(item, trustedArray)) {
        const id = asSafeInteger(item.id ?? item.ID ?? item.message_id ?? item.messageID)
        if (id !== null) ids.push(id)
      }
      collectMessageIds(item, ids, contextKey)
    }
    return ids
  }

  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectMessageIds(value, ids, key)
    }
  }
  return ids
}

function analyzeExportFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: '输出文件不存在', filePath }
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.trim()) return { ok: false, reason: '输出文件为空', filePath }
    const json = JSON.parse(content)
    const ids = collectMessageIds(json).filter(n => Number.isSafeInteger(n) && n >= 0)
    const unique = Array.from(new Set(ids)).sort((a, b) => a - b)
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

ipcMain.handle('config:get', () => readConfig())
ipcMain.handle('config:set', (_, config) => saveConfig(config))
ipcMain.handle('tdl:run', (event, payload) => runTdl(event, payload))
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

app.setName('HopeTDL')

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath())
  }
  createWindow()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
