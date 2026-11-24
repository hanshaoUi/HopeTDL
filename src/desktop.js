import { hydrateStorage } from './storage'

export async function initializeDesktop() {
  if (!window.__TAURI_INTERNALS__) return
  const [{ invoke }, { listen }, dialog, opener] = await Promise.all([
    import('@tauri-apps/api/core'), import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-opener')
  ])
  const callbacks = new Map()
  const dispatch = (event, payload) => {
    if (event === 'runtime:snapshot') api.runtimeSnapshot = payload
    for (const callback of callbacks.get(event) || []) callback(payload)
  }
  const subscribe = event => callback => {
    if (!callbacks.has(event)) callbacks.set(event, new Set())
    callbacks.get(event).add(callback)
    return () => callbacks.get(event).delete(callback)
  }
  const request = (channel, payload = null) => invoke('request', { channel, payload })
  const pick = async (options = {}, directory = false) => {
    const result = await dialog.open({ ...options, directory, multiple: false })
    return Array.isArray(result) ? result[0] : (result || '')
  }
  const api = {
    nativeRuntime: true,
    reportError: error => dispatch('runtime:error', String(error)),
    getConfig: () => request('config:get'), setConfig: config => request('config:set', config),
    checkEnvironment: () => request('environment:check'),
    getTdlVersion: () => request('tdl:version'), previewFilter: payload => request('filter:preview', payload),
    run: payload => request('tdl:run', payload), runJob: payload => request('job:run', payload),
    stop: id => request('tdl:stop', id),
    startCommentForward: payload => request('comment-forward:start', payload),
    stopCommentForward: () => request('comment-forward:stop'),
    openFile: options => pick(options), openDirectory: options => pick(options, true),
    saveFile: async options => (await dialog.save(options)) || '',
    getDefaultOutputDir: () => request('path:defaultOutputDir'),
    analyzeExportFile: file => request('export:analyze', file),
    readCommentForwardProgress: dir => request('comment-forward:progress:read', dir),
    showItemInFolder: path => opener.revealItemInDir(path),
    openPath: async path => { try { await opener.openPath(path); return { ok: true } } catch (e) { return { ok: false, message: String(e) } } },
    getChatCache: () => request('chats:cache:get'), ensureChatCache: () => request('chats:cache:ensure'),
    refreshChatCache: () => request('chats:cache:refresh'), listChats: options => request('chats:list', options),
    checkChatLatestMessage: chat => request('chats:latest-message', chat),
    showApp: () => request('app:show'), updateAppStatus: () => Promise.resolve(), quitApp: () => request('app:quit'),
    setPreference: (key, value) => request('runtime:preference', { key, value }),
    saveSchedule: schedule => request('runtime:schedule', { action: 'upsert', id: schedule.id, schedule: JSON.parse(JSON.stringify(schedule)) }),
    deleteSchedule: id => request('runtime:schedule', { action: 'delete', id }),
    runSchedule: id => request('runtime:runSchedule', id),
    pauseScheduler: paused => request('runtime:pause', paused),
    clearFinished: () => request('runtime:clearFinished'),
    taskMetadata: (id, patch) => request('runtime:taskMetadata', { id, ...patch }),
    logTail: id => request('runtime:logTail', id),
    onLog: subscribe('tdl:log'), onDone: subscribe('tdl:done'),
    onCommentForwardProgress: subscribe('comment-forward:progress'), onCommentForwardStatus: subscribe('comment-forward:status'),
    onNavigate: subscribe('app:navigate'), onSchedulerPaused: subscribe('app:scheduler-paused'), onTasksStopped: subscribe('app:tasks-stopped'),
    onFloodWait: subscribe('task:flood-wait'), onRuntimeSnapshot: subscribe('runtime:snapshot'), onRuntimeError: subscribe('runtime:error'),
    exportMigration: async () => {
      const file = await dialog.save({ defaultPath: 'HopeTDL-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
      return file ? request('migration:export', file) : { cancelled: true }
    },
    importMigration: async () => {
      const file = await pick({ filters: [{ name: 'JSON', extensions: ['json'] }] })
      return file ? request('migration:import', file) : { cancelled: true }
    }
  }
  window.tdlApi = api
  // Register all native listeners before the Vue application can launch a job.
  await Promise.all(['tdl:log', 'tdl:done', 'comment-forward:progress', 'comment-forward:status', 'app:navigate',
    'task:flood-wait', 'app:scheduler-paused', 'app:tasks-stopped', 'runtime:snapshot', 'runtime:error'].map(event =>
    listen(event.replaceAll(':', '-'), ({ payload }) => dispatch(event, payload))))
  const snapshot = await request('runtime:get')
  if (!api.runtimeSnapshot || snapshot.revision >= api.runtimeSnapshot.revision) api.runtimeSnapshot = snapshot
  hydrateStorage(api.runtimeSnapshot)
}
