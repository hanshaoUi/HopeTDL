<script setup>
import { defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import { appState } from './state'
import { naiveTheme, themeOverrides } from './ui/naive'
import { persistTasks, startTaskScheduler, updateTaskStatus } from './utils'
import TaskLog from './components/TaskLog.vue'

const Dashboard = defineAsyncComponent(() => import('./views/Dashboard.vue'))
const Login = defineAsyncComponent(() => import('./views/Login.vue'))
const Chats = defineAsyncComponent(() => import('./views/Chats.vue'))
const ExportMessages = defineAsyncComponent(() => import('./views/ExportMessages.vue'))
const Forward = defineAsyncComponent(() => import('./views/Forward.vue'))
const CommentForward = defineAsyncComponent(() => import('./views/CommentForward.vue'))
const Upload = defineAsyncComponent(() => import('./views/Upload.vue'))
const History = defineAsyncComponent(() => import('./views/History.vue'))
const TaskCenter = defineAsyncComponent(() => import('./views/TaskCenter.vue'))
const Settings = defineAsyncComponent(() => import('./views/Settings.vue'))

const views = { dashboard: Dashboard, login: Login, chats: Chats, export: ExportMessages, forward: Forward, commentForward: CommentForward, upload: Upload, history: History, taskCenter: TaskCenter, settings: Settings }
const nav = [
  ['dashboard', '仪表盘'], ['login', '登录账号'], ['chats', '对话列表'], ['export', '导出消息'], ['forward', '转发消息'], ['commentForward', '评论区转发'], ['upload', '上传文件'], ['history', '历史记录'], ['taskCenter', '任务中心'], ['settings', '设置']
]
let stopScheduler = null
let offNavigate = null
let offSchedulerPaused = null
let offTasksStopped = null

function latestScheduleCheck() {
  const checks = appState.schedules
    .map(schedule => schedule.lastCheckedAt)
    .filter(Boolean)
  return checks[0] || ''
}

function syncAppStatus() {
  if (!window.tdlApi?.updateAppStatus) return
  window.tdlApi.updateAppStatus({
    runningTasks: appState.tasks.filter(task => task.status === '运行中').length,
    failedTasks: appState.tasks.filter(task => task.status === '失败').length,
    enabledSchedules: appState.schedules.filter(schedule => schedule.enabled).length,
    totalSchedules: appState.schedules.length,
    schedulerPaused: appState.schedulerPaused,
    lastScheduleCheck: latestScheduleCheck()
  })
}

onMounted(async () => {
  const tdlApi = window.tdlApi
  if (tdlApi) {
    appState.config = await tdlApi.getConfig()
  }
  // 恢复日志面板的显示状态
  try {
    const saved = localStorage.getItem('showLog')
    if (saved !== null) appState.showLog = saved === 'true'
  } catch (err) {
    // 忽略 localStorage 读取错误
  }
  // 初始化主题：根据 appState.theme 设置 data-theme 属性
  try {
    document.documentElement.setAttribute('data-theme', appState.theme)
  } catch (err) {
    // 忽略设置错误
  }
  if (!tdlApi) {
    appState.logs.push({ taskId: 'app', level: 'warning', text: '[开发预览] 当前页面未运行在 Electron 中，tdl 操作不可用。\n' })
    return
  }

  tdlApi.onLog((data) => appState.logs.push(data))
  tdlApi.onDone((data) => {
    const existing = appState.tasks.find(t => t.id === data.taskId)
    if (existing?.status === '已停止') {
      updateTaskStatus(data.taskId, '已停止', { exitCode: data.code })
      return
    }
    updateTaskStatus(data.taskId, data.code === 0 ? '成功' : '失败', {
      finishedAt: new Date().toLocaleString(),
      exitCode: data.code
    })
  })
  offNavigate = tdlApi.onNavigate?.((view) => {
    if (views[view]) appState.activeView = view
  })
  offSchedulerPaused = tdlApi.onSchedulerPaused?.((paused) => {
    appState.schedulerPaused = !!paused
  })
  offTasksStopped = tdlApi.onTasksStopped?.(() => {
    const now = new Date().toLocaleString()
    appState.tasks.forEach(task => {
      if (task.status === '运行中') {
        task.status = '已停止'
        task.finishedAt = now
      }
    })
    persistTasks()
  })
  stopScheduler = startTaskScheduler()
  syncAppStatus()

  // 应用启动时确保对话列表缓存可用：
  // 第一次没有缓存会自动刷新一次；缓存未过期时只读取本地缓存，不再重复请求 tdl。
  appState.chatCacheLoading = true
  try {
    const info = await tdlApi.ensureChatCache()
    appState.cachedChats = Array.isArray(info?.chats) ? info.chats : []
    appState.chatCacheMeta = info || null
  } catch (err) {
    appState.logs.push({ taskId: 'chat-cache', level: 'error', text: `[对话缓存] 初始化失败：${err?.message || err}\n` })
  } finally {
    appState.chatCacheLoading = false
  }
})

onUnmounted(() => {
  if (stopScheduler) stopScheduler()
  if (offNavigate) offNavigate()
  if (offSchedulerPaused) offSchedulerPaused()
  if (offTasksStopped) offTasksStopped()
})

// 持久化日志面板的显示状态
watch(() => appState.showLog, (val) => {
  try {
    localStorage.setItem('showLog', String(val))
  } catch (err) {
    // 忽略 localStorage 写入错误
  }
})

// 监听主题变化，更新 data-theme 属性并持久化
watch(() => appState.theme, (val) => {
  try {
    document.documentElement.setAttribute('data-theme', val)
    localStorage.setItem('theme', val)
  } catch (err) {
    // 忽略错误
  }
})

watch(
  () => ({
    tasks: appState.tasks.map(task => `${task.id}:${task.status}`).join('|'),
    schedules: appState.schedules.map(schedule => `${schedule.id}:${schedule.enabled}:${schedule.lastCheckedAt || ''}`).join('|'),
    schedulerPaused: appState.schedulerPaused
  }),
  syncAppStatus,
  { deep: false }
)
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell">
          <aside class="sidebar">
            <div class="brand">HopeTDL</div>
            <div class="brand-sub">tdl 图形化操作原型</div>
            <div v-for="item in nav" :key="item[0]" class="nav-item" :class="{ active: appState.activeView === item[0] }" @click="appState.activeView = item[0]">
              {{ item[1] }}
            </div>
          </aside>
          <main class="main">
            <section class="content">
              <KeepAlive>
                <component :is="views[appState.activeView]" />
              </KeepAlive>
            </section>
            <n-button
              v-if="!appState.showLog"
              size="small"
              class="show-log-button"
              @click="appState.showLog = true"
            >显示日志</n-button>
            <TaskLog v-show="appState.showLog" />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
