<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { appState } from '../main'

// 文本框用于搜索日志中的关键字
const searchText = ref('')

// 根据搜索关键字过滤日志条目
const filteredLogs = computed(() => {
  if (!searchText.value) return appState.logs
  const kw = searchText.value.toLowerCase()
  return appState.logs.filter(log => String(log.text).toLowerCase().includes(kw))
})

function logText(log) {
  return String(log?.text || '')
}

function clearLogs() { appState.logs.splice(0) }

async function writeClipboard(text, successText = '已复制') {
  if (!String(text || '').trim()) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(String(text))
    ElMessage.success(successText)
  } catch (err) {
    ElMessage.error('复制失败：' + (err?.message || err))
  }
}

async function copyLogs() {
  const text = filteredLogs.value.map(log => logText(log)).join('')
  await writeClipboard(text, '当前日志已复制')
}

async function copyLine(log) {
  await writeClipboard(logText(log), '已复制该行')
}

async function copySelectedLogs() {
  const selection = window.getSelection?.().toString() || ''
  if (!selection.trim()) {
    ElMessage.warning('请先用鼠标选中要复制的日志文字')
    return
  }
  await writeClipboard(selection, '已复制选中内容')
}

function collapseLog() { appState.showLog = false }
</script>
<template>
  <aside class="log-panel">
    <div class="log-title">
      <span>任务日志</span>
      <div style="display:flex; gap:8px; align-items:center;">
        <el-input v-model="searchText" placeholder="搜索" size="small" clearable style="width:120px" />
        <el-button size="small" @click="copySelectedLogs">复制选中</el-button>
        <el-button size="small" @click="copyLogs">复制全部</el-button>
        <el-button size="small" @click="clearLogs">清空</el-button>
        <el-button size="small" @click="collapseLog">收起</el-button>
      </div>
    </div>
    <div class="log-body">
      <div v-if="!appState.logs.length" style="color:#788198">暂无日志。运行任务后会实时显示 tdl 输出。</div>
      <div v-for="(log, i) in filteredLogs" :key="i" class="log-line-wrap">
        <pre class="log-line" :class="log.level">{{ logText(log) }}</pre>
        <button class="log-copy-btn" title="复制这一行" @click="copyLine(log)">复制</button>
      </div>
    </div>
  </aside>
</template>
