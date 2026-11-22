<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
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
const slots = computed(() => Math.max(1,Number(appState.config.maxConcurrentTasks || 2)))
const occupiedSlots = computed(() => appState.tasks.filter(isTaskRunning).length)
const enabledPlans = computed(() => appState.schedules.filter(s=>s.enabled).length)
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
    <h1 class="page-title">主页</h1>
    <p class="page-desc">当前环境和最近任务。</p>
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
    <button class="stat-card info" @click="goto('tasks')"><div class="stat-label">运行中</div><div class="stat-value">{{runningCount}}</div></button>
    <button class="stat-card" :class="{warn:failedCount}" @click="goto('tasks')"><div class="stat-label">失败</div><div class="stat-value">{{failedCount}}</div></button>
    <button class="stat-card" @click="goto('plans')"><div class="stat-label">计划</div><div class="stat-value">{{enabledPlans}} / {{appState.schedules.length}}</div></button>
    <button class="stat-card" @click="goto('chats')"><div class="stat-label">对话缓存</div><div class="stat-value">{{appState.chatCacheMeta?.count||0}}</div></button>
  </div>
  <section class="card">
    <div class="card-head"><div><h2 class="card-title">tdl 环境</h2><div class="card-hint">外部 tdl 执行 · Rust 后台调度</div></div><div class="action-row"><span class="state-label" :class="envReady?'success':'queued'">{{envLoading?'检查中':envReady?'tdl 可用':'待检查 / 不可用'}}</span><button class="btn sm" @click="goto('settings')">设置</button><n-button size="tiny" :loading="envLoading" @click="checkEnvironment">重新检查</n-button></div></div>
    <div class="session-card"><div class="session-avatar">{{(appState.config.ns||'hope')[0].toUpperCase()}}</div><div class="session-info"><div class="session-name">当前命名空间</div><div class="session-meta">任务、对话缓存与历史按此空间管理</div></div><span class="session-ns">{{appState.config.ns||'hope'}}</span><button class="btn sm" @click="goto('settings')">切换</button></div>
    <div class="tdl-info-grid">
      <div class="tdl-info-item"><AppIcon name="tasks" :size="16" /><div><div class="tdl-info-label">版本 / 可执行文件</div><div class="tdl-info-value env-version">{{tdlCheck?.detail||appState.config.tdlPath||'尚未检查'}}</div></div></div>
      <div class="tdl-info-item"><AppIcon name="transfer" :size="16" /><div><div class="tdl-info-label">代理</div><div class="tdl-info-value">{{appState.config.proxy||'未配置 · 直连'}}</div></div></div>
      <div class="tdl-info-item"><AppIcon name="info" :size="16" /><div><div class="tdl-info-label">API 限流状态</div><div class="tdl-info-value mini-muted">tdl 未提供实时额度数据</div></div></div>
      <div class="tdl-info-item"><AppIcon name="clock" :size="16" /><div><div class="tdl-info-label">并发上限</div><div class="tdl-info-value">{{slots}} slots（{{Math.max(0,slots-occupiedSlots)}} 空闲）</div></div></div>
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
        <AppIcon class="quick-icon" name="download" :size="18" /><span>导出消息</span>
      </button>
      <button type="button" class="quick-item" @click="goto('newTask', 'download')">
        <AppIcon class="quick-icon" name="media" :size="18" /><span>下载媒体</span>
      </button>
      <button type="button" class="quick-item" @click="goto('newTask', 'commentForward')">
        <AppIcon class="quick-icon" name="comments" :size="18" /><span>评论区转发</span>
      </button>
      <button type="button" class="quick-item" @click="goto('newTask', 'upload')">
        <AppIcon class="quick-icon" name="upload" :size="18" /><span>上传文件</span>
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
