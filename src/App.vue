<script setup>
import { onMounted, watch } from 'vue'
import { appState } from './main'
import Dashboard from './views/Dashboard.vue'
import Login from './views/Login.vue'
import Chats from './views/Chats.vue'
import ExportMessages from './views/ExportMessages.vue'
import Forward from './views/Forward.vue'
import Upload from './views/Upload.vue'
import History from './views/History.vue'
import Settings from './views/Settings.vue'
import TaskLog from './components/TaskLog.vue'

const views = { dashboard: Dashboard, login: Login, chats: Chats, export: ExportMessages, forward: Forward, upload: Upload, history: History, settings: Settings }
const nav = [
  ['dashboard', '仪表盘'], ['login', '登录账号'], ['chats', '对话列表'], ['export', '导出消息'], ['forward', '转发消息'], ['upload', '上传文件'], ['history', '历史记录'], ['settings', '设置']
]

onMounted(async () => {
  appState.config = await window.tdlApi.getConfig()
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
  window.tdlApi.onLog((data) => appState.logs.push(data))
  window.tdlApi.onDone((data) => {
    const task = appState.tasks.find(t => t.id === data.taskId)
    if (task) task.status = data.code === 0 ? '成功' : '失败'
  })

  // 应用启动时确保对话列表缓存可用：
  // 第一次没有缓存会自动刷新一次；缓存未过期时只读取本地缓存，不再重复请求 tdl。
  appState.chatCacheLoading = true
  try {
    const info = await window.tdlApi.ensureChatCache()
    appState.cachedChats = Array.isArray(info?.chats) ? info.chats : []
    appState.chatCacheMeta = info || null
  } catch (err) {
    appState.logs.push({ taskId: 'chat-cache', level: 'error', text: `[对话缓存] 初始化失败：${err?.message || err}\n` })
  } finally {
    appState.chatCacheLoading = false
  }
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
</script>

<template>
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
        <component :is="views[appState.activeView]" />
      </section>
      <!-- 当日志面板被折叠时显示一个按钮，点击后重新展开 -->
      <el-button
        v-if="!appState.showLog"
        size="small"
        @click="appState.showLog = true"
        style="margin: 0 22px 10px auto; width: 88px;"
      >显示日志</el-button>
      <!-- 日志面板根据 showLog 状态显示或隐藏 -->
      <TaskLog v-show="appState.showLog" />
    </main>
  </div>
</template>
