<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { confirmHtml, message } from '../ui/naive'
import { appState } from '../state'
import { commandText } from '../utils'
import { allLogLines, clearLogs as resetLogs, MAX_LOG_LINES } from '../logStore'
import { isTaskFailed } from '../taskState'

// 一屏之外的日志没人看，但每一行都是真实 DOM 节点。
// 只渲染尾部这么多行，其余保留在内存缓冲里，复制/搜索仍然覆盖全量。
const RENDER_TAIL = 400

// 文本框用于搜索日志中的关键字
const searchText = ref('')
const selectedTaskId = ref('')
const autoScroll = ref(true)
const logBody = ref(null)

const taskOptions = computed(() => [
  { label: '全部任务', value: '' },
  ...appState.tasks.slice(0, 50).map(task => ({
    label: `${task.title || task.type} · ${task.status}`,
    value: task.id
  }))
])

// 由 logStore 增量维护，不再每次变更全量 filter 一遍日志数组。
const errorCount = computed(() => appState.logErrorCount)
const failedTasks = computed(() => appState.tasks.filter(isTaskFailed))
const hasFilter = computed(() => Boolean(selectedTaskId.value || searchText.value))

function matches(log) {
  if (selectedTaskId.value && log.taskId !== selectedTaskId.value) return false
  if (!searchText.value) return true
  return String(log.text).toLowerCase().includes(searchText.value.toLowerCase())
}

// 未过滤时直接从尾部切片，不遍历整个缓冲区。
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
  const text = allLogLines().filter(matches).map(log => logText(log)).join('\n')
  await writeClipboard(text, '当前日志已复制')
}

async function copyLine(log) {
  await writeClipboard(logText(log), '已复制该行')
}

async function copyFailedCommands() {
  const text = failedTasks.value
    .map(task => `${task.title || task.type}\n${commandText(task.args || [])}`)
    .join('\n\n')
  await writeClipboard(text, '失败任务命令已复制')
}

async function copySelectedLogs() {
  const selection = window.getSelection?.().toString() || ''
  if (!selection.trim()) {
    message.warning('请先用鼠标选中要复制的日志文字')
    return
  }
  await writeClipboard(selection, '已复制选中内容')
}

function collapseLog() { appState.showLog = false }

// logVersion 每帧最多加一次，滚动也就每帧最多一次。
let scrollQueued = false
watch(() => appState.logVersion, async () => {
  if (!autoScroll.value || scrollQueued) return
  scrollQueued = true
  await nextTick()
  scrollQueued = false
  if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
})
</script>
<template>
  <aside class="log-panel">
    <div class="log-title">
      <div class="log-heading">
        <span>任务日志</span>
        <span class="mini-muted">共 {{ matchedCount }} 行，错误 {{ errorCount }} 条</span>
      </div>
      <div class="log-toolbar">
        <n-select v-model:value="selectedTaskId" :options="taskOptions" size="small" style="width:180px" />
        <n-input v-model:value="searchText" placeholder="搜索" size="small" clearable style="width:120px" />
        <n-switch v-model:value="autoScroll" size="small" />
        <span class="mini-muted">自动滚动</span>
        <n-button size="small" @click="copySelectedLogs">复制选中</n-button>
        <n-button size="small" @click="copyLogs">复制全部</n-button>
        <n-button size="small" :disabled="!failedTasks.length" @click="copyFailedCommands">复制失败命令</n-button>
        <n-button size="small" @click="clearLogs">清空</n-button>
        <n-button size="small" @click="collapseLog">收起</n-button>
      </div>
    </div>
    <div ref="logBody" class="log-body">
      <div v-if="!appState.logs.length && !liveLogs.length" style="color:#788198">暂无日志。运行任务后会实时显示 tdl 输出。</div>
      <div v-else-if="!visibleLogs.length && !liveLogs.length" style="color:#788198">当前筛选条件下没有日志。</div>
      <div v-if="truncated" class="mini-muted" style="padding:4px 0">
        仅显示最近 {{ visibleLogs.length }} 行（缓冲上限 {{ MAX_LOG_LINES }} 行）。「复制全部」仍会导出缓冲区内的全部匹配行。
      </div>
      <div v-for="log in visibleLogs" :key="log.id" class="log-line-wrap">
        <pre class="log-line" :class="log.level">{{ logText(log) }}</pre>
        <button class="log-copy-btn" title="复制这一行" @click="copyLine(log)">复制</button>
      </div>
      <div v-for="log in liveLogs" :key="log.id" class="log-line-wrap">
        <pre class="log-line" :class="log.level">{{ logText(log) }}</pre>
      </div>
    </div>
  </aside>
</template>
