<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { appState } from '../state'
import { commandTextForSpec, runJob } from '../utils'
import { message } from '../ui/naive'
import { isTaskFailed, isTaskRunning, taskStatusType } from '../taskState'

// 「登录账号」原本是和日常操作平级的一个导航项，但它是一次性设置。
// 这里并进概览：环境没就绪时它是主角，就绪之后收成一行。
const loginType = ref('qr')
const envLoading = ref(false)
const envResult = ref(null)

const loginSpec = computed(() => ({ kind: 'login', type: loginType.value }))
const latestTasks = computed(() => appState.tasks.slice(0, 6))
const runningCount = computed(() => appState.tasks.filter(isTaskRunning).length)
const failedCount = computed(() => appState.tasks.filter(isTaskFailed).length)

const tdlCheck = computed(() => envResult.value?.checks?.find(item => item.key === 'tdl') || null)
const envReady = computed(() => Boolean(tdlCheck.value?.ok))

async function checkEnvironment() {
  if (!window.tdlApi) return
  envLoading.value = true
  try {
    envResult.value = await window.tdlApi.checkEnvironment()
  } catch (err) {
    message.error('环境检查失败：' + (err?.message || err))
  } finally {
    envLoading.value = false
  }
}

function startLogin() {
  runJob(loginSpec.value, `登录：${loginType.value}`)
}

// 最近一次登录任务成功后重新检查环境，让上面的状态跟着变，
// 不用用户自己再点一次「重新检查」。
const lastLoginState = computed(() => appState.tasks.find(task => task.type === 'login')?.state)
watch(lastLoginState, (state, previous) => {
  if (state === 'success' && state !== previous) checkEnvironment()
})

function goto(view, kind) {
  if (kind) appState.newTaskKind = kind
  appState.activeView = view
}

onMounted(checkEnvironment)
</script>

<template>
  <header class="page-head">
    <h1 class="page-title">概览</h1>
    <p class="page-desc">当前环境状态和最近的任务。要做事从「新建任务」开始，要找对话去「对话」。</p>
  </header>

  <n-alert
    v-if="appState.recovery.interruptedCount"
    type="warning"
    :show-icon="true"
    :closable="false"
    :title="`检测到 ${appState.recovery.interruptedCount} 个上次未完成的任务，已标记为已中断。`"
    style="margin-bottom:20px"
  />

  <div class="stat-row">
    <div class="stat">
      <div class="label">命名空间</div>
      <div class="value">{{ appState.config.ns || 'default' }}</div>
    </div>
    <div class="stat">
      <div class="label">运行中任务</div>
      <div class="value">{{ runningCount }}</div>
    </div>
    <div class="stat" :class="{ warn: failedCount }">
      <div class="label">失败任务</div>
      <div class="value">{{ failedCount }}</div>
    </div>
    <div class="stat">
      <div class="label">对话缓存</div>
      <div class="value">{{ appState.chatCacheMeta?.count || 0 }}</div>
    </div>
  </div>

  <!-- 环境没就绪时，登录和自检是主角；就绪后收成一行状态。 -->
  <section class="card" :class="{ 'card-attention': !envReady }">
    <div class="card-head">
      <div>
        <div class="card-title">环境状态</div>
        <div class="mini-muted">
          <template v-if="envLoading">检查中…</template>
          <template v-else-if="!envResult">尚未检查</template>
          <template v-else-if="envReady">tdl 可用：{{ tdlCheck.detail }}</template>
          <template v-else>tdl 不可用：{{ tdlCheck?.detail || '未检测到' }}</template>
        </div>
      </div>
      <div class="action-row">
        <n-button size="small" :loading="envLoading" @click="checkEnvironment">重新检查</n-button>
        <n-button size="small" quaternary @click="goto('settings')">去设置</n-button>
      </div>
    </div>

    <div v-if="envResult && !envReady" class="env-hint">
      找不到 tdl 可执行文件。装好后如果仍然找不到，去「设置」把 tdl 路径填成完整路径，例如
      <code>/opt/homebrew/bin/tdl</code>。
    </div>

    <div class="login-row">
      <span class="login-label">登录账号</span>
      <n-radio-group v-model:value="loginType" size="small">
        <n-radio-button value="qr">二维码</n-radio-button>
        <n-radio-button value="code">验证码</n-radio-button>
        <n-radio-button value="desktop">Desktop 导入</n-radio-button>
      </n-radio-group>
      <n-button size="small" type="primary" @click="startLogin">开始登录</n-button>
      <code class="inline-command">{{ commandTextForSpec(loginSpec) }}</code>
    </div>

    <!-- 验证码方式需要往 tdl 进程的 stdin 里输手机号和验证码，
         而主进程根本没接 stdin，界面上没有任何地方能输入 —— 会一直卡住。 -->
    <n-alert
      v-if="loginType === 'code'"
      type="warning"
      :show-icon="true"
      :closable="false"
      style="margin-top:12px"
      title="验证码登录目前只能在终端里做：应用还没有把输入通道接到 tdl 进程，点了会一直等待。建议用二维码。"
    />
    <n-alert
      v-else-if="loginType === 'desktop'"
      type="info"
      :show-icon="true"
      :closable="false"
      style="margin-top:12px"
      title="Desktop 导入读取 Telegram Desktop（Qt 版）的 tdata 目录。你装的是 Telegram for macOS，没有 tdata，这个方式用不了。"
    />
  </section>

  <!-- 二维码必须整块、等宽、1 倍行高渲染才扫得出来。 -->
  <section v-if="appState.loginQr" class="card qr-card">
    <div class="card-head">
      <div>
        <div class="card-title">扫码登录</div>
        <div class="mini-muted">用手机 Telegram：设置 → 设备 → 关联桌面设备，扫下面的码。二维码会定期刷新。</div>
      </div>
      <n-button size="small" quaternary @click="appState.loginQr = null">关闭</n-button>
    </div>
    <pre class="qr-block">{{ appState.loginQr.lines.join('\n') }}</pre>
  </section>

  <section class="card">
    <div class="card-head">
      <div class="card-title">快速开始</div>
    </div>
    <div class="quick-grid">
      <button type="button" class="quick-item" @click="goto('newTask', 'export')">
        <span class="quick-icon">⤓</span><span>导出消息</span>
      </button>
      <button type="button" class="quick-item" @click="goto('newTask', 'download')">
        <span class="quick-icon">⭳</span><span>下载媒体</span>
      </button>
      <button type="button" class="quick-item" @click="goto('newTask', 'commentForward')">
        <span class="quick-icon">⇉</span><span>评论区转发</span>
      </button>
      <button type="button" class="quick-item" @click="goto('chats')">
        <span class="quick-icon">☰</span><span>浏览对话</span>
      </button>
    </div>
  </section>

  <section class="card">
    <div class="card-head">
      <div class="card-title">最近任务</div>
      <n-button size="small" quaternary @click="goto('tasks')">查看全部</n-button>
    </div>
    <div v-if="!latestTasks.length" class="empty-cell">暂无任务</div>
    <ul v-else class="recent-list">
      <li v-for="row in latestTasks" :key="row.id" class="recent-item">
        <n-tag size="small" :type="taskStatusType(row)">{{ row.status }}</n-tag>
        <span class="recent-title">{{ row.title || row.type }}</span>
        <span class="recent-time">{{ row.createdAt }}</span>
      </li>
    </ul>
  </section>
</template>
