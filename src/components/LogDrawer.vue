<script setup>
import AppIcon from './AppIcon.vue'
import { ref, computed, nextTick, watch } from 'vue'
import { confirmHtml, message } from '../ui/naive'
import { appState } from '../state'
import { commandText, commandTextForSpec } from '../utils'
import { allLogLines, clearLogs as resetLogs, MAX_LOG_LINES } from '../logStore'
import { isTaskFailed, isTaskRunning } from '../taskState'

// 一屏之外的日志没人看，但每一行都是真实 DOM 节点。
// 只渲染尾部这么多行，其余保留在内存缓冲里，复制/搜索仍然覆盖全量。
const RENDER_TAIL = 400

const searchText = ref('')
const selectedTaskId = ref('')
const diskTail = ref('')
watch(selectedTaskId, async id => {
  diskTail.value = ''
  if (!id || !window.tdlApi?.nativeRuntime) return
  try {
    const tail = await window.tdlApi.logTail(id)
    if (selectedTaskId.value === id) diskTail.value = tail
  } catch (error) { message.error(String(error)) }
})
const autoScroll = ref(true)
const logBody = ref(null)

const expanded = computed({
  get: () => appState.showLog,
  set: val => { appState.showLog = val }
})

const runningCount = computed(() => appState.tasks.filter(isTaskRunning).length)
const failedTasks = computed(() => appState.tasks.filter(isTaskFailed))
const errorCount = computed(() => appState.logErrorCount)

const taskOptions = computed(() => [
  { label: '全部任务', value: '' },
  ...appState.tasks.map(task => ({
    label: `${task.title || task.type} · ${task.status}`,
    value: task.id
  }))
])

const hasFilter = computed(() => Boolean(selectedTaskId.value || searchText.value))

function matches(log) {
  if (selectedTaskId.value && log.taskId !== selectedTaskId.value) return false
  if (!searchText.value) return true
  return String(log.text).toLowerCase().includes(searchText.value.toLowerCase())
}

const matchedCount = computed(() => {
  appState.logVersion
  if (!hasFilter.value) return appState.logs.length
  let count = 0
  for (const log of appState.logs) if (matches(log)) count += 1
  return count
})

const visibleLogs = computed(() => {
  appState.logVersion
  const logs = appState.logs
  if (!hasFilter.value) return logs.slice(-RENDER_TAIL)
  const rows = []
  for (let i = logs.length - 1; i >= 0 && rows.length < RENDER_TAIL; i -= 1) {
    if (matches(logs[i])) rows.push(logs[i])
  }
  return rows.reverse()
})

// 进度条这类未换行的输出只占一行，随时被覆盖，不进历史缓冲。
const liveLogs = computed(() => Object.values(appState.liveLines).filter(matches))
const truncated = computed(() => matchedCount.value > visibleLogs.value.length)

// 收起时状态条上显示的最后一行，让用户不展开也知道在跑什么。
const lastLine = computed(() => {
  appState.logVersion
  const live = Object.values(appState.liveLines)
  if (live.length) return live[live.length - 1].text
  const logs = appState.logs
  return logs.length ? logs[logs.length - 1].text : ''
})

function logText(log) {
  return String(log?.text || '')
}

async function clearLogs() {
  if (!appState.logs.length) return
  try {
    await confirmHtml('<p>清空后当前日志面板内容会被移除，但不会影响已经运行的任务记录。</p>', '清空任务日志', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
    resetLogs()
  } catch {}
}

async function writeClipboard(text, successText = '已复制') {
  if (!String(text || '').trim()) {
    message.warning('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(String(text))
    message.success(successText)
  } catch (err) {
    message.error('复制失败：' + (err?.message || err))
  }
}

async function copyLogs() {
  // 复制的是全量匹配结果，不受渲染尾部限制。
  await writeClipboard(allLogLines().filter(matches).map(logText).join('\n'), '当前日志已复制')
}

async function copyLine(log) {
  await writeClipboard(logText(log), '已复制该行')
}

async function copyFailedCommands() {
  const text = failedTasks.value
    .map(task => `${task.title || task.type}\n${task.command || (task.spec ? commandTextForSpec(task.spec) : commandText(task.args || []))}`)
    .join('\n\n')
  await writeClipboard(text, '失败任务命令已复制')
}

// logVersion 每帧最多加一次，滚动也就每帧最多一次。
let scrollQueued = false
watch(() => appState.logVersion, async () => {
  if (!autoScroll.value || !expanded.value || scrollQueued) return
  scrollQueued = true
  await nextTick()
  scrollQueued = false
  if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
})
</script>

<template>
  <section class="log-drawer" :class="{ expanded }">
    <!-- 收起态：只占一行。展开才吃屏幕高度。 -->
    <button class="log-bar" type="button" @click="expanded = !expanded">
      <span class="log-bar-chevron" :class="{ up: !expanded }"><AppIcon name="chevron" :size="12" style="transform:rotate(90deg)" /></span>
      <span class="log-bar-label">任务日志</span>
      <span v-if="runningCount" class="log-pill running">运行中 {{ runningCount }}</span>
      <span v-if="errorCount" class="log-pill error">错误 {{ errorCount }}</span>
      <span v-if="!runningCount && !errorCount" class="log-pill idle">空闲</span>
      <span class="log-bar-tail">{{ lastLine || '暂无输出' }}</span>
      <span class="log-bar-action">{{ expanded ? '收起' : '展开' }}</span>
    </button>

    <div v-if="expanded" class="log-panel-body">
      <div class="log-toolbar">
        <n-select v-model:value="selectedTaskId" :options="taskOptions" filterable size="small" style="width:190px" />
        <n-input v-model:value="searchText" placeholder="搜索日志" size="small" clearable style="width:150px" />
        <span class="log-toolbar-spacer" />
        <n-switch v-model:value="autoScroll" size="small" />
        <span class="mini-muted">自动滚动</span>
        <n-button size="small" quaternary @click="copyLogs">复制全部</n-button>
        <n-button size="small" quaternary :disabled="!failedTasks.length" @click="copyFailedCommands">复制失败命令</n-button>
        <n-button size="small" quaternary @click="clearLogs">清空</n-button>
      </div>

      <div ref="logBody" class="log-body">
        <template v-if="diskTail">
          <div class="log-truncated">磁盘日志末尾（最多 32 KB；包含窗口隐藏或重启前的输出）</div>
          <pre class="log-line">{{ diskTail }}</pre>
        </template>
        <div v-if="!diskTail && !appState.logs.length && !liveLogs.length" class="log-empty">暂无日志。运行任务后会实时显示 tdl 输出。</div>
        <div v-else-if="!diskTail && !visibleLogs.length && !liveLogs.length" class="log-empty">当前筛选条件下没有日志。</div>
        <div v-if="truncated" class="log-truncated">
          仅显示最近 {{ visibleLogs.length }} 行（缓冲上限 {{ MAX_LOG_LINES }} 行）。「复制全部」仍会导出缓冲区内的全部匹配行。
        </div>
        <div v-for="log in visibleLogs" :key="log.id" class="log-line-wrap">
          <pre class="log-line" :class="log.level">{{ logText(log) }}</pre>
          <button class="log-copy-btn" title="复制这一行" @click="copyLine(log)">复制</button>
        </div>
        <div v-for="log in liveLogs" :key="log.id" class="log-line-wrap">
          <pre class="log-line live" :class="log.level">{{ logText(log) }}</pre>
        </div>
      </div>
    </div>
  </section>
</template>
