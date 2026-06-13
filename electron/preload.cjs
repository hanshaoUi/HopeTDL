const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tdlApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: config => ipcRenderer.invoke('config:set', config),
  checkEnvironment: () => ipcRenderer.invoke('environment:check'),
  run: payload => ipcRenderer.invoke('tdl:run', payload),
  stop: taskId => ipcRenderer.invoke('tdl:stop', taskId),
  startCommentForward: payload => ipcRenderer.invoke('comment-forward:start', payload),
  stopCommentForward: () => ipcRenderer.invoke('comment-forward:stop'),
  openFile: options => ipcRenderer.invoke('dialog:openFile', options),
  openDirectory: options => ipcRenderer.invoke('dialog:openDirectory', options),
  saveFile: options => ipcRenderer.invoke('dialog:saveFile', options),
  getDefaultOutputDir: () => ipcRenderer.invoke('path:defaultOutputDir'),
  analyzeExportFile: filePath => ipcRenderer.invoke('export:analyze', filePath),
  showItemInFolder: filePath => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openPath: targetPath => ipcRenderer.invoke('shell:openPath', targetPath),
  getChatCache: () => ipcRenderer.invoke('chats:cache:get'),
  ensureChatCache: () => ipcRenderer.invoke('chats:cache:ensure'),
  refreshChatCache: () => ipcRenderer.invoke('chats:cache:refresh'),
  checkChatLatestMessage: chat => ipcRenderer.invoke('chats:latest-message', chat),
  showApp: () => ipcRenderer.invoke('app:show'),
  updateAppStatus: status => ipcRenderer.invoke('app:status', status),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onLog: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('tdl:log', listener)
    return () => ipcRenderer.removeListener('tdl:log', listener)
  },
  onDone: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('tdl:done', listener)
    return () => ipcRenderer.removeListener('tdl:done', listener)
  },
  onCommentForwardProgress: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('comment-forward:progress', listener)
    return () => ipcRenderer.removeListener('comment-forward:progress', listener)
  },
  onCommentForwardStatus: callback => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('comment-forward:status', listener)
    return () => ipcRenderer.removeListener('comment-forward:status', listener)
  },
  onNavigate: callback => {
    const listener = (_, view) => callback(view)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  onSchedulerPaused: callback => {
    const listener = (_, paused) => callback(paused)
    ipcRenderer.on('app:scheduler-paused', listener)
    return () => ipcRenderer.removeListener('app:scheduler-paused', listener)
  },
  onTasksStopped: callback => {
    const listener = () => callback()
    ipcRenderer.on('app:tasks-stopped', listener)
    return () => ipcRenderer.removeListener('app:tasks-stopped', listener)
  }
  ,
  /**
   * Fetch list of chats directly via tdl.
   * @param {{filter?: string}} options
   * @returns {Promise<Array|Object>} Parsed JSON array or error object
   */
  listChats: options => ipcRenderer.invoke('chats:list', options)
})
