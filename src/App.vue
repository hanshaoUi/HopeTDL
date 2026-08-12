<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import { appState } from './state'
import { naiveTheme, themeOverrides } from './ui/naive'
import { appendLog, finalizeLogs } from './logStore'
import { applyCacheInfo } from './chatCache'
import { persistTasks, startTaskScheduler, updateTaskStatus } from './utils'
import LogDrawer from './components/LogDrawer.vue'
import { isTaskFailed, isTaskRunning, TASK_STATE } from './taskState'

const Overview = defineAsyncComponent(() => import('./views/Overview.vue'))
const Chats = defineAsyncComponent(() => import('./views/Chats.vue'))
const NewTask = defineAsyncComponent(() => import('./views/NewTask.vue'))
const Tasks = defineAsyncComponent(() => import('./views/Tasks.vue'))
const Settings = defineAsyncComponent(() => import('./views/Settings.vue'))

const views = { overview: Overview, chats: Chats, newTask: NewTask, tasks: Tasks, settings: Settings }
const nav = [
  ['overview', '概览', '◎'],
  ['chats', '对话', '☰'],
  ['newTask', '新建任务', '＋'],
  ['tasks', '任务', '≡'],
  ['settings', '设置', '⚙']
]

// 旧的视图名散落在托盘菜单、历史记录跳转和用户习惯里，这里统一映射到新导航。
const legacyViews = {
  dashboard: 'overview',
  login: 'overview',
  export: 'newTask',
  forward: 'newTask',
  commentForward: 'newTask',
  download: 'newTask',
  upload: 'newTask',
  history: 'tasks',
  taskCenter: 'tasks'
}

function resolveView(name) {
  if (views[name]) return name
  return legacyViews[name] || 'overview'
}
let stopScheduler = null
let offLog = null
let offDone = null
let offNavigate = null
let offSchedulerPaused = null
let offTasksStopped = null

const runningTaskCount = computed(() => appState.tasks.filter(isTaskRunning).length)

function latestScheduleCheck() {
  const checks = appState.schedules
    .map(schedule => schedule.lastCheckedAt)
    .filter(Boolean)
  return checks[0] || ''
}

function syncAppStatus() {
  if (!window.tdlApi?.updateAppStatus) return
  window.tdlApi.updateAppStatus({
    runningTasks: appState.tasks.filter(isTaskRunning).length,
    failedTasks: appState.tasks.filter(isTaskFailed).length,
    enabledSchedules: appState.schedules.filter(schedule => schedule.enabled).length,
    totalSchedules: appState.schedules.length,
    schedulerPaused: appState.schedulerPaused,
    lastScheduleCheck: latestScheduleCheck()
  })
}

onMounted(async () => {
  const tdlApi = window.tdlApi
  if (appState.recovery?.interruptedCount) {
    appendLog({
      taskId: 'app-recovery',
      level: 'warning',
      text: `[恢复] 检测到 ${appState.recovery.interruptedCount} 个上次未完成的任务，已标记为“已中断”。请在任务中心决定是否重试。\n`
    })
  }
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
    appendLog({ taskId: 'app', level: 'warning', text: '[开发预览] 当前页面未运行在 Electron 中，tdl 操作不可用。\n' })
    return
  }

  offLog = tdlApi.onLog((data) => appendLog(data))
  offDone = tdlApi.onDone((data) => {
    // 把该任务残留的未换行输出落成历史行，避免进度条最后一帧永远挂着。
    finalizeLogs(data.taskId)
    const existing = appState.tasks.find(t => t.id === data.taskId)
    if (existing?.state === TASK_STATE.STOPPED) {
      updateTaskStatus(data.taskId, TASK_STATE.STOPPED, { exitCode: data.code })
      return
    }
    updateTaskStatus(data.taskId, data.code === 0 ? TASK_STATE.SUCCESS : TASK_STATE.FAILED, {
      finishedAt: new Date().toLocaleString(),
      exitCode: data.code
    })
  })
  offNavigate = tdlApi.onNavigate?.((view) => {
    appState.activeView = resolveView(view)
  })
  offSchedulerPaused = tdlApi.onSchedulerPaused?.((paused) => {
    appState.schedulerPaused = !!paused
  })
  offTasksStopped = tdlApi.onTasksStopped?.(() => {
    const now = new Date().toLocaleString()
    appState.tasks.forEach(task => {
      if (isTaskRunning(task)) updateTaskStatus(task.id, TASK_STATE.STOPPED, { finishedAt: now })
    })
  })
  stopScheduler = startTaskScheduler()
  syncAppStatus()

  // 应用启动时确保对话列表缓存可用：
  // 第一次没有缓存会自动刷新一次；缓存未过期时只读取本地缓存，不再重复请求 tdl。
  appState.chatCacheLoading = true
  try {
    applyCacheInfo(await tdlApi.ensureChatCache())
  } catch (err) {
    appendLog({ taskId: 'chat-cache', level: 'error', text: `[对话缓存] 初始化失败：${err?.message || err}\n` })
  } finally {
    appState.chatCacheLoading = false
  }
})

onUnmounted(() => {
  if (stopScheduler) stopScheduler()
  if (offLog) offLog()
  if (offDone) offDone()
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

// 原来这里每次任务变更都要把全部任务和计划拼成字符串再比较。
// 托盘/角标只关心几个计数，直接盯计数即可，省掉每次变更的全量遍历和字符串分配。
watch(
  () => [
    appState.tasks.length,
    appState.tasks.filter(isTaskRunning).length,
    appState.tasks.filter(isTaskFailed).length,
    appState.schedules.length,
    appState.schedules.filter(schedule => schedule.enabled).length,
    appState.schedulerPaused
  ].join(','),
  syncAppStatus
)
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell">
          <aside class="sidebar">
            <div class="brand">
              <span class="brand-mark">T</span>
              <span class="brand-text">HopeTDL</span>
            </div>
            <nav class="nav">
              <button
                v-for="item in nav"
                :key="item[0]"
                type="button"
                class="nav-item"
                :class="{ active: appState.activeView === item[0] }"
                @click="appState.activeView = item[0]"
              >
                <span class="nav-icon">{{ item[2] }}</span>
                <span class="nav-label">{{ item[1] }}</span>
                <span v-if="item[0] === 'tasks' && runningTaskCount" class="nav-badge">{{ runningTaskCount }}</span>
              </button>
            </nav>
          </aside>
          <main class="main">
            <section class="content">
              <!-- 页面常驻会把组件树和 watcher 永久留在内存里，只缓存最近 3 个。 -->
              <KeepAlive :max="3">
                <component :is="views[appState.activeView]" />
              </KeepAlive>
            </section>
            <LogDrawer />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
