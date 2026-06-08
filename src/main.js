import { createApp, reactive } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'

export const appState = reactive({
  config: {},
  logs: [],
  tasks: [],
  cachedChats: [],
  chatCacheMeta: null,
  chatCacheLoading: false,
  /**
   * 当前选中的聊天对象，用于在列表页快速跳转到导出/转发页面时传递参数。
   * 当用户在对话列表中点击“导出”或“转发”按钮时，会更新此字段。
   */
  selectedChat: null,
  selectedExportRecord: null,
  selectedForwardRecord: null,
  selectedUploadRecord: null,
  /**
   * 是否显示任务日志面板。当为 false 时隐藏日志面板，并在界面底部提供按钮重新展开。
   */
  showLog: true,
  activeView: 'dashboard',
  /**
   * 当前主题，可选值为 'dark' 或 'light'。默认从 localStorage 中读取，若没有则默认为 dark。
   */
  theme: (() => {
    try {
      const saved = localStorage.getItem('theme')
      return saved === 'light' ? 'light' : 'dark'
    } catch (err) {
      return 'dark'
    }
  })()
})

createApp(App).use(ElementPlus).mount('#app')
