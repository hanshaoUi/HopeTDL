const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tdlApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: config => ipcRenderer.invoke('config:set', config),
  run: payload => ipcRenderer.invoke('tdl:run', payload),
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
  onLog: callback => ipcRenderer.on('tdl:log', (_, data) => callback(data)),
  onDone: callback => ipcRenderer.on('tdl:done', (_, data) => callback(data))
  ,
  /**
   * Fetch list of chats directly via tdl.
   * @param {{filter?: string}} options
   * @returns {Promise<Array|Object>} Parsed JSON array or error object
   */
  listChats: options => ipcRenderer.invoke('chats:list', options)
})
