<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { confirmHtml, message } from '../ui/naive'
import { appState } from '../state'
import { commandText } from '../utils'
import { isTaskFailed } from '../taskState'

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

const errorCount = computed(() => appState.logs.filter(log => ['stderr', 'error'].includes(log.level)).length)
const failedTasks = computed(() => appState.tasks.filter(isTaskFailed))

// 根据搜索关键字过滤日志条目
const filteredLogs = computed(() => {
  let rows = appState.logs
  if (selectedTaskId.value) rows = rows.filter(log => log.taskId === selectedTaskId.value)
  if (!searchText.value) return rows
  const kw = searchText.value.toLowerCase()
  return rows.filter(log => String(log.text).toLowerCase().includes(kw))
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
    appState.logs.splice(0)
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
  const text = filteredLogs.value.map(log => logText(log)).join('')
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

watch(() => appState.logs.length, async () => {
  if (!autoScroll.value) return
  await nextTick()
  if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
})
</script>
<template>
  <aside class="log-panel">
    <div class="log-title">
      <div class="log-heading">
        <span>任务日志</span>
        <span class="mini-muted">共 {{ filteredLogs.length }} 行，错误 {{ errorCount }} 条</span>
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
      <div v-if="!appState.logs.length" style="color:#788198">暂无日志。运行任务后会实时显示 tdl 输出。</div>
      <div v-else-if="!filteredLogs.length" style="color:#788198">当前筛选条件下没有日志。</div>
      <div v-for="(log, i) in filteredLogs" :key="i" class="log-line-wrap">
        <pre class="log-line" :class="log.level">{{ logText(log) }}</pre>
        <button class="log-copy-btn" title="复制这一行" @click="copyLine(log)">复制</button>
      </div>
    </div>
  </aside>
</template>
