import { reactive, shallowReactive } from 'vue'
import { normalizeTaskRecord, recoverInterruptedTask } from './taskState'
import { previewConfig } from '../shared/appDefaults.mjs'
import localStorage from './storage'

const TASKS_KEY = 'hopetdl.tasks.v1'
const SCHEDULES_KEY = 'hopetdl.schedules.v1'

const recoveryInfo = {
  interruptedCount: 0,
  interruptedTaskIds: []
}

function readStoredTasks() {
  try {
    const value = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]')
    return Array.isArray(value)
      ? value.map(item => {
          const recovered = window.tdlApi?.nativeRuntime ? item : recoverInterruptedTask(item)
          if (recovered.state === 'interrupted') {
            recoveryInfo.interruptedCount += 1
            recoveryInfo.interruptedTaskIds.push(recovered.id)
          }
          return normalizeTaskRecord(recovered)
        })
      : []
  } catch {
    return []
  }
}

function readStoredSchedules() {
  try {
    const value = JSON.parse(localStorage.getItem(SCHEDULES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export const appState = reactive({
  config: previewConfig(),
  // 只存已换行的历史行，环形缓冲，写入统一走 logStore.appendLog。
  logs: [],
  // 未换行的活动行（进度条），每个 taskId+level 只占一条，随时被覆盖。
  liveLines: shallowReactive({}),
  // 增量维护，避免每来一行就全量 filter 一遍日志数组。
  logErrorCount: 0,
  logVersion: 0,
  // tdl 登录时用半块字符画的二维码，从日志流里单独抽出来整块渲染。
  // 混在日志里会被换行和行高毁掉，扫不出来。
  loginQr: null,
  tasks: readStoredTasks(),
  schedules: readStoredSchedules(),
  schedulerPaused: false,
  // 对话列表可能上千条且每条带 topics 数组，内容只读、整体替换。
  // 赋值时统一用 markRaw（见 chatCache.applyCacheInfo），避免给每一行建深层 Proxy。
  cachedChats: [],
  chatCacheMeta: null,
  chatCacheVersion: 0,
  chatPrefsVersion: 0,
  chatCacheLoading: false,
  recovery: recoveryInfo,
  /**
   * 当前选中的聊天对象，用于在列表页快速跳转到导出/转发页面时传递参数。
   * 当用户在对话列表中点击“导出”或“转发”按钮时，会更新此字段。
   */
  selectedChat: null,
  selectedExportRecord: null,
  selectedForwardRecord: null,
  selectedUploadRecord: null,
  selectedDownloadRecord: null,
  selectedCommentForwardRecord: null,
  /**
   * 是否显示任务日志面板。当为 false 时隐藏日志面板，并在界面底部提供按钮重新展开。
   */
  // 日志抽屉默认收起：展开态会吃掉三分之一屏幕，而多数时候用户不看它。
  showLog: false,
  activeView: 'newTask',
  planTaskId: '',
  planDraft: null,
  tasksTab: 'all',
  focusedTaskId: '',
  // 「新建任务」页当前选中的任务类型。
  newTaskKind: 'commentForward',
  /**
   * 保存主题偏好；system 的实际颜色由 theme.js 随系统解析。
   */
  theme: (() => {
    try {
      const saved = localStorage.getItem('theme')
      return ['system', 'light', 'dark'].includes(saved) ? saved : 'system'
    } catch (err) {
      return 'system'
    }
  })()
})
