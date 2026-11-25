<script setup>
import { computed, ref } from 'vue'
import { appState } from '../../state'
import { message, confirmHtml } from '../../ui/naive'
import {
  commandText,
  commandTextForSpec,
  copyTaskCommand,
  createScheduleFromTask,
  deleteSchedule,
  persistTasks,
  retryTask, retryPending,
  runScheduledTaskNow,
  stopTask,
  toggleSchedule
} from '../../utils'
import { isTaskInterrupted, isTaskRunning, TASK_STATE, taskStatusType } from '../../taskState'

const statusFilter = ref('全部')
const selectedTaskId = ref('')
const selectedScheduleId = ref('')
const scheduleDraft = ref({
  taskId: '',
  mode: 'once',
  triggerMode: 'time',
  watchChat: '',
  runAt: toDatetimeLocal(Date.now() + 10 * 60 * 1000),
  intervalMinutes: 60
})

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
const selectedSchedule = computed(() => appState.schedules.find(schedule => schedule.id === selectedScheduleId.value) || null)
const schedulableTaskOptions = computed(() => appState.tasks
  .filter(task => task.type !== 'comment-forward' && (task.spec || (Array.isArray(task.args) && task.args.length)))
  .slice(0, 50)
  .map(task => ({
    label: `${task.title || task.type} / ${task.createdAt || task.id}`,
    value: task.id
  })))
const triggerOptions = [
  { label: '到点直接执行', value: 'time' },
  { label: '频道有更新才执行', value: 'chat-update' }
]

function taskCommand(task) {
  return task.command || (task.spec ? commandTextForSpec(task.spec) : commandText(task.args || []))
}

function scheduleCommand(schedule) {
  return schedule.spec ? commandTextForSpec(schedule.spec) : commandText(schedule.args || [])
}

function taskSummary(task) {
  if (!task) return ''
  return task.summary || '-'
}

// 失败任务的摘要现在就是「失败分类：错误原因」，行内不必再把同一句话说第二遍。
// 只有摘要没覆盖到的部分才另起一行（比如调用方自己写死的摘要 + 另有错误原文）。
function failureLabelText(task) {
  const label = String(task?.failureLabel || '')
  if (!label || taskSummary(task).startsWith(`${label}：`)) return ''
  return label
}

function extraErrorText(task) {
  const message = String(task?.errorMessage || '').trim()
  if (!message || taskSummary(task).includes(message)) return ''
  return message
}

function scheduleSummary(schedule) {
  if (!schedule) return ''
  return schedule.lastDecision || schedule.lastStatus || '未运行'
}

function scheduleEventType(kind) {
  if (['error'].includes(kind)) return 'error'
  if (['skip', 'baseline', 'disabled'].includes(kind)) return 'warning'
  if (['run-success', 'enabled', 'ready'].includes(kind)) return 'success'
  return 'info'
}

function toDatetimeLocal(value) {
  const date = new Date(value)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function taskSourceChat(task) {
  const args = task?.args || []
  const chatIndex = args.findIndex(item => ['-c', '--chat'].includes(String(item)))
  if (chatIndex >= 0 && args[chatIndex + 1]) return String(args[chatIndex + 1])
  return ''
}

function taskArgValue(task, names = []) {
  const args = task?.args || []
  const index = args.findIndex(item => names.includes(String(item)))
  return index >= 0 && args[index + 1] ? String(args[index + 1]) : ''
}

function inputRangeFromTask(task) {
  const args = task?.args || []
  const inputIndex = args.findIndex(item => ['-i', '--input'].includes(String(item)))
  if (inputIndex < 0 || !args[inputIndex + 1]) return null
  const parts = String(args[inputIndex + 1]).split(',').map(item => Number(item.trim()))
  if (!parts.length || parts.some(item => !Number.isSafeInteger(item) || item < 0)) return null
  return {
    start: parts[0],
    end: parts.length > 1 ? parts[1] : parts[0]
  }
}

async function baselineFromTaskFile(task) {
  const filePath = taskArgValue(task, task?.type === 'forward' ? ['--from'] : ['-o', '--output'])
  if (!filePath) return null
  const analysis = await window.tdlApi.analyzeExportFile(filePath)
  if (!analysis?.ok) return null
  return {
    lastSeenMessageId: Number(analysis.maxId || 0),
    status: `已分析历史 JSON 基线：${analysis.maxId}`,
    filePath
  }
}

function formatTime(value) {
  const time = Number(value || 0)
  return time ? new Date(time).toLocaleString() : '-'
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

function openScheduleDetails(schedule) {
  selectedScheduleId.value = schedule?.id || ''
}

async function createSchedule() {
  const task = appState.tasks.find(item => item.id === scheduleDraft.value.taskId)
  if (!task) {
    message.error('请选择一个可重放的历史任务')
    return
  }
  const runAt = fromDatetimeLocal(scheduleDraft.value.runAt)
  if (scheduleDraft.value.mode === 'once' && (!runAt || runAt <= Date.now())) {
    message.error('一次性任务的执行时间必须晚于当前时间')
    return
  }
  const watchChat = String(scheduleDraft.value.watchChat || taskSourceChat(task)).trim()
  const templateRange = inputRangeFromTask(task)
  let lastSeenMessageId = templateRange?.end || 0
  let lastStatus = '未运行'
  if (scheduleDraft.value.triggerMode === 'chat-update') {
    if (!watchChat) {
      message.error('检测更新需要填写源频道 / 群组')
      return
    }
    if (lastSeenMessageId) {
      lastStatus = `已读取模板范围基线：${lastSeenMessageId}`
    } else {
      const fileBaseline = await baselineFromTaskFile(task)
      if (fileBaseline?.lastSeenMessageId) {
        lastSeenMessageId = fileBaseline.lastSeenMessageId
        lastStatus = fileBaseline.status
      } else {
        const latest = await window.tdlApi.checkChatLatestMessage(watchChat)
        if (!latest?.ok) {
          message.error(latest?.message || '建立频道检测基线失败')
          return
        }
        lastSeenMessageId = Number(latest.latestMessageId || 0)
        lastStatus = `未找到历史范围或 JSON，已建立当前最新基线：${lastSeenMessageId}`
      }
    }
  }
  try {
    await createScheduleFromTask(task, {
      mode: scheduleDraft.value.mode,
      triggerMode: scheduleDraft.value.triggerMode,
      watchChat,
      lastSeenMessageId,
      lastStatus,
      runAt,
      intervalMinutes: scheduleDraft.value.intervalMinutes,
      name: task.title || task.type
    })
    message.success('定时任务已创建')
  } catch (err) {
    message.error(err?.message || '创建失败')
  }
}

async function runScheduleNow(schedule) {
  try {
    await runScheduledTaskNow(schedule)
    message.success('已发起定时任务')
  } catch (err) {
    message.error(err?.message || '发起失败')
  }
}

async function removeSchedule(schedule) {
  try {
    await confirmHtml(`<p>确认删除定时任务：${schedule.name || schedule.type}？</p>`, '删除定时任务', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  await deleteSchedule(schedule.id)
  message.success('已删除定时任务')
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
    appState.tasks = appState.tasks.filter(t=>isTaskRunning(t)||t.state===TASK_STATE.QUEUED)
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
        <div class="card-title">定时任务</div>
        <div class="mini-muted">应用运行时触发。关闭主窗口会隐藏到托盘并继续检测；从托盘菜单退出后不再执行。</div>
      </div>
      <n-tag :type="enabledScheduleCount ? 'success' : 'default'">
        已启用 {{ enabledScheduleCount }}
      </n-tag>
    </div>

    <n-alert type="info" :show-icon="true" :closable="false" title="关闭窗口不会停止定时任务；需要真正退出请使用托盘菜单里的“退出 HopeTDL”。" />

    <div class="schedule-builder">
      <n-select
        v-model:value="scheduleDraft.taskId"
        :options="schedulableTaskOptions"
        filterable
        clearable
        placeholder="选择一个历史任务作为模板"
      />
      <n-radio-group v-model:value="scheduleDraft.mode">
        <n-radio-button value="once">一次性</n-radio-button>
        <n-radio-button value="interval">重复</n-radio-button>
      </n-radio-group>
      <n-select
        v-model:value="scheduleDraft.triggerMode"
        :options="triggerOptions"
        style="min-width:160px"
      />
      <input
        v-if="scheduleDraft.mode === 'once'"
        v-model="scheduleDraft.runAt"
        class="native-input"
        type="datetime-local"
      >
      <n-input-number
        v-else
        v-model:value="scheduleDraft.intervalMinutes"
        :min="1"
        :max="10080"
        :step="5"
        placeholder="间隔分钟"
      />
      <n-button type="primary" :disabled="!schedulableTaskOptions.length" @click="createSchedule">创建计划</n-button>
    </div>
    <div v-if="scheduleDraft.triggerMode === 'chat-update'" class="schedule-builder schedule-builder-secondary">
      <n-input v-model:value="scheduleDraft.watchChat" placeholder="检测频道 / 群组，可留空自动读取任务里的 -c" />
      <div class="mini-muted">优先读取 -i 结束 ID；没有 -i 时分析导出 -o 或转发 --from 的 JSON 最大 ID；检测到最新 500 时自动执行 101,500。</div>
    </div>

    <div class="table-scroll task-table">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th>计划</th>
            <th style="width:120px">模式</th>
            <th style="width:190px">下次运行</th>
            <th style="width:190px">上次运行</th>
            <th style="width:90px">次数</th>
            <th style="width:260px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!appState.schedules.length">
            <td colspan="6" class="empty-cell">暂无定时任务。先运行一次任务，再从这里创建计划。</td>
          </tr>
          <tr v-for="schedule in appState.schedules" :key="schedule.id">
            <td>
              <div class="table-title">{{ schedule.name || schedule.type }}</div>
              <div class="row-details truncate-cell">{{ scheduleCommand(schedule) }}</div>
              <div class="row-details">状态：{{ schedule.enabled ? '已启用' : '已停用' }}；{{ schedule.lastStatus || '未运行' }}</div>
              <div v-if="schedule.triggerMode === 'chat-update'" class="row-details">
                检测：{{ schedule.watchChat || '-' }}；已处理到 ID：{{ schedule.lastSeenMessageId || '-' }}；上次检测：{{ schedule.lastCheckedAt || '-' }}
              </div>
              <div v-if="schedule.chain === 'export-forward'" class="row-details">
                执行链路：先导出增量 JSON，再转发该增量文件。
              </div>
            </td>
            <td>{{ schedule.mode === 'interval' ? `每 ${schedule.intervalMinutes || 1} 分钟` : '一次性' }}</td>
            <td>{{ formatTime(schedule.nextRunAt) }}</td>
            <td>{{ schedule.lastRunAt || '-' }}</td>
            <td>{{ schedule.runCount || 0 }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" @click="toggleSchedule(schedule)">{{ schedule.enabled ? '停用' : '启用' }}</n-button>
                <n-button size="small" tertiary @click="openScheduleDetails(schedule)">详情</n-button>
                <n-button size="small" secondary @click="runScheduleNow(schedule)">立即运行</n-button>
                <n-button size="small" type="error" @click="removeSchedule(schedule)">删除</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>

  <div v-if="selectedSchedule" class="card task-center-card">
    <div class="task-center-toolbar">
      <div>
        <div class="card-title">计划详情</div>
        <div class="mini-muted">{{ selectedSchedule.name || selectedSchedule.type }} / {{ selectedSchedule.id }}</div>
      </div>
      <n-tag :type="selectedSchedule.enabled ? 'success' : 'default'">{{ selectedSchedule.enabled ? '已启用' : '已停用' }}</n-tag>
    </div>

    <div class="grid-3 task-detail-grid">
      <div class="stat">
        <div class="label">触发方式</div>
        <div class="value task-detail-value">{{ selectedSchedule.triggerMode === 'chat-update' ? '频道更新触发' : '到点执行' }}</div>
      </div>
      <div class="stat">
        <div class="label">下次运行</div>
        <div class="value task-detail-value">{{ formatTime(selectedSchedule.nextRunAt) }}</div>
      </div>
      <div class="stat">
        <div class="label">最近结果</div>
        <div class="value task-detail-value">{{ scheduleSummary(selectedSchedule) }}</div>
      </div>
    </div>

    <div class="task-detail-section">
      <div class="table-meta">规则摘要</div>
      <div class="task-detail-box">
        检测频道：{{ selectedSchedule.watchChat || '-' }}<br>
        已处理到主消息 ID：{{ selectedSchedule.lastSeenMessageId || '-' }}<br>
        上次检测：{{ selectedSchedule.lastCheckedAt || '-' }}<br>
        执行次数：{{ selectedSchedule.runCount || 0 }}
      </div>
    </div>

    <div class="task-detail-section">
      <div class="table-meta">事件记录</div>
      <div v-if="!(selectedSchedule.eventHistory || []).length" class="task-detail-box">暂无事件记录</div>
      <div v-else class="schedule-event-list">
        <div v-for="event in selectedSchedule.eventHistory" :key="event.id" class="schedule-event-item">
          <n-tag size="small" :type="scheduleEventType(event.kind)">{{ event.kind }}</n-tag>
          <div class="schedule-event-main">
            <div class="schedule-event-text">{{ event.text }}</div>
            <div class="mini-muted">{{ event.time }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card task-center-card">
    <div class="task-center-toolbar">
      <div>
        <div class="card-title">任务列表</div>
        <div class="mini-muted">保留最近 100 条任务记录。普通任务可直接停止，评论区转发会调用专用停止流程。</div>
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
