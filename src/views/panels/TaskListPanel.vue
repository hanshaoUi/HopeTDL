<script setup>
import { computed, ref } from 'vue'
import { appState } from '../../state'
import { message, confirmHtml } from '../../ui/naive'
import {
  commandText,
  commandTextForSpec,
  copyTaskCommand,
  persistTasks,
  retryTask,
  retryPending,
  stopTask
} from '../../utils'
import { isTaskInterrupted, isTaskRunning, TASK_STATE, taskStatusType } from '../../taskState'

const statusFilter = ref('全部')
const selectedTaskId = ref('')

const statusOptions = [
  { label: '全部', value: '全部' },
  { label: '排队中', value: '排队中' },
  { label: '运行中', value: '运行中' },
  { label: '成功', value: '成功' },
  { label: '部分成功', value: '部分成功' },
  { label: '失败', value: '失败' },
  { label: '已中断', value: '已中断' },
  { label: '已停止', value: '已停止' }
]

const filteredTasks = computed(() => {
  if (statusFilter.value === '全部') return appState.tasks
  return appState.tasks.filter(task => task.status === statusFilter.value)
})

const runningCount = computed(() => appState.tasks.filter(isTaskRunning).length)
const interruptedCount = computed(() => appState.tasks.filter(isTaskInterrupted).length)
const enabledScheduleCount = computed(() => appState.schedules.filter(schedule => schedule.enabled).length)
const selectedTask = computed(() => appState.tasks.find(task => task.id === selectedTaskId.value) || null)

function taskCommand(task) {
  return task.command || (task.spec ? commandTextForSpec(task.spec) : commandText(task.args || []))
}

function taskSummary(task) {
  return task?.summary || '-'
}

function failureLabelText(task) {
  const label = String(task?.failureLabel || '')
  if (!label || taskSummary(task).startsWith(`${label}：`)) return ''
  return label
}

function extraErrorText(task) {
  const msg = String(task?.errorMessage || '').trim()
  if (!msg || taskSummary(task).includes(msg)) return ''
  return msg
}

async function handleRetry(task) {
  try {
    await retryTask(task)
    message.success('已重新发起任务')
  } catch (err) {
    message.error(err?.message || '重试失败')
  }
}

async function handleStop(task) {
  const result = await stopTask(task)
  if (result?.ok) return
  if (isTaskRunning(task)) {
    task.state = TASK_STATE.STOPPED
    task.status = '已停止'
    task.finishedAt = new Date().toLocaleString()
    persistTasks()
  }
}

function openTaskDetails(task) {
  selectedTaskId.value = task?.id || ''
}

async function clearFinished() {
  const removableCount = appState.tasks.filter(task => !isTaskRunning(task) && task.state !== TASK_STATE.QUEUED).length
  if (!removableCount) {
    message.info('没有可清理的已完成任务')
    return
  }

  try {
    await confirmHtml(`<p>将清理 ${removableCount} 条非运行中任务，运行中的任务会保留。</p>`, '清理任务记录', {
      confirmButtonText: '清理',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  if (window.tdlApi?.nativeRuntime) await window.tdlApi.clearFinished()
  else {
    appState.tasks = appState.tasks.filter(t => isTaskRunning(t) || t.state === TASK_STATE.QUEUED)
    persistTasks()
  }
  message.success('已清理已完成任务')
}

async function retryInterruptedTasks() {
  const targets = appState.tasks.filter(isTaskInterrupted).slice(0, 10)
  if (!targets.length) {
    message.info('没有可重试的中断任务')
    return
  }
  try {
    await confirmHtml(`<p>将重新发起 ${targets.length} 个已中断任务。</p>`, '重试中断任务', {
      confirmButtonText: '开始重试',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  let success = 0
  for (const task of targets) {
    try {
      await retryTask(task)
      success += 1
    } catch {}
  }
  message.success(`已重新发起 ${success} / ${targets.length} 个中断任务`)
}
</script>

<template>
  <n-alert
    v-if="appState.recovery.interruptedCount"
    type="warning"
    :show-icon="true"
    :closable="false"
    :title="`检测到 ${appState.recovery.interruptedCount} 个上次未完成的任务。它们已被标记为已中断，可逐条重试或清理。`"
    style="margin-bottom:16px"
  />
  <div v-if="interruptedCount" class="action-row section-actions" style="margin-bottom:16px">
    <n-button secondary @click="statusFilter = '已中断'">仅看已中断</n-button>
    <n-button type="primary" secondary @click="retryInterruptedTasks">批量重试已中断</n-button>
  </div>

  <div class="card task-center-card">
    <div class="task-center-toolbar">
      <div>
        <div class="card-title">定时计划</div>
        <div class="mini-muted">计划已独立至「计划」页统一创建、编辑与启停；当前已启用 {{ enabledScheduleCount }} / {{ appState.schedules.length }} 个。</div>
      </div>
      <n-button size="small" secondary @click="appState.activeView = 'plans'">前往计划页</n-button>
    </div>
  </div>

  <div class="card task-center-card">
    <div class="task-center-toolbar">
      <div>
        <div class="card-title">任务全量列表</div>
        <div class="mini-muted">保留最近 100 条任务记录（清理时会同步回收对应日志文件）。</div>
      </div>
      <div class="action-row">
        <n-select v-model:value="statusFilter" :options="statusOptions" size="small" style="width:120px" />
        <n-button size="small" secondary @click="clearFinished">清理已完成</n-button>
      </div>
    </div>

    <n-alert v-if="runningCount" type="warning" :show-icon="true" :closable="false" title="有任务正在运行。关闭应用会中断进程；需要先停止或等待完成。" />

    <div class="table-scroll task-table">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th>任务</th>
            <th style="width:130px">类型</th>
            <th style="width:110px">状态</th>
            <th style="width:190px">开始</th>
            <th style="width:190px">结束</th>
            <th style="width:260px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredTasks.length">
            <td colspan="6" class="empty-cell">暂无任务记录</td>
          </tr>
          <tr v-for="task in filteredTasks" :key="task.id">
            <td>
              <div class="table-title">{{ task.title || task.type }}</div>
              <div class="row-details truncate-cell">{{ taskCommand(task) }}</div>
              <div class="row-details">摘要：{{ taskSummary(task) }}</div>
              <div v-if="failureLabelText(task)" class="row-details error-text">失败分类：{{ failureLabelText(task) }}</div>
              <div v-if="task.failedCount" class="row-details error-text">
                失败 {{ task.failedCount }} 条：{{ (task.failedIds || []).join(', ') }}
              </div>
              <div v-if="extraErrorText(task)" class="row-details error-text">{{ extraErrorText(task) }}</div>
            </td>
            <td>{{ task.type }}</td>
            <td>
              <n-tag :type="taskStatusType(task)">
                {{ task.status }}
              </n-tag>
            </td>
            <td>{{ task.createdAt || '-' }}</td>
            <td>{{ task.finishedAt || '-' }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" tertiary @click="openTaskDetails(task)">详情</n-button>
                <n-button size="small" @click="copyTaskCommand(task)">复制命令</n-button>
                <n-button size="small" secondary :disabled="retryPending(task)" @click="handleRetry(task)">重试</n-button>
                <n-button size="small" type="error" :disabled="!isTaskRunning(task) && task.state !== TASK_STATE.QUEUED" @click="handleStop(task)">停止</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>

  <div v-if="selectedTask" class="card task-center-card">
    <div class="task-center-toolbar">
      <div>
        <div class="card-title">任务详情</div>
        <div class="mini-muted">{{ selectedTask.title || selectedTask.type }} / {{ selectedTask.id }}</div>
      </div>
      <n-tag :type="taskStatusType(selectedTask)">{{ selectedTask.status }}</n-tag>
    </div>

    <div class="grid-3 task-detail-grid">
      <div class="stat">
        <div class="label">任务类型</div>
        <div class="value task-detail-value">{{ selectedTask.type }}</div>
      </div>
      <div class="stat">
        <div class="label">开始时间</div>
        <div class="value task-detail-value">{{ selectedTask.createdAt || '-' }}</div>
      </div>
      <div class="stat">
        <div class="label">结束时间</div>
        <div class="value task-detail-value">{{ selectedTask.finishedAt || '-' }}</div>
      </div>
    </div>

    <div class="task-detail-section">
      <div class="table-meta">摘要</div>
      <div class="task-detail-box">{{ taskSummary(selectedTask) }}</div>
    </div>

    <div class="task-detail-section">
      <div class="table-meta">执行命令 <button class="btn sm ghost" @click="appState.focusedTaskId=selectedTask.id;appState.activeView='tasks';appState.showLog=true">在任务页查看日志</button></div>
      <pre class="task-detail-box task-detail-code">{{ taskCommand(selectedTask) }}</pre>
    </div>

    <div v-if="selectedTask.errorMessage" class="task-detail-section">
      <div class="table-meta">错误信息</div>
      <div class="task-detail-box error-text">{{ selectedTask.errorMessage }}</div>
    </div>

    <div v-if="selectedTask.failureLabel" class="task-detail-section">
      <div class="table-meta">失败分类</div>
      <div class="task-detail-box error-text">{{ selectedTask.failureLabel }}<span v-if="selectedTask.failureCategory">（{{ selectedTask.failureCategory }}）</span></div>
    </div>

    <div v-if="selectedTask.recoveryReason" class="task-detail-section">
      <div class="table-meta">恢复信息</div>
      <div class="task-detail-box">{{ selectedTask.recoveryReason }}</div>
    </div>

    <div v-if="selectedTask.failedCount || (selectedTask.failedIds || []).length" class="task-detail-section">
      <div class="table-meta">失败条目</div>
      <div class="task-detail-box">{{ selectedTask.failedCount || (selectedTask.failedIds || []).length }} 条：{{ (selectedTask.failedIds || []).join(', ') || '-' }}</div>
    </div>
  </div>
</template>
