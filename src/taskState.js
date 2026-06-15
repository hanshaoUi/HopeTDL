export const TASK_STATE = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
  STOPPED: 'stopped',
  INTERRUPTED: 'interrupted'
}

const legacyMap = {
  排队中: TASK_STATE.QUEUED,
  运行中: TASK_STATE.RUNNING,
  成功: TASK_STATE.SUCCESS,
  部分成功: TASK_STATE.PARTIAL,
  失败: TASK_STATE.FAILED,
  已停止: TASK_STATE.STOPPED,
  已中断: TASK_STATE.INTERRUPTED
}

const stateMeta = {
  [TASK_STATE.QUEUED]: { label: '排队中', type: 'default' },
  [TASK_STATE.RUNNING]: { label: '运行中', type: 'warning' },
  [TASK_STATE.SUCCESS]: { label: '成功', type: 'success' },
  [TASK_STATE.PARTIAL]: { label: '部分成功', type: 'warning' },
  [TASK_STATE.FAILED]: { label: '失败', type: 'error' },
  [TASK_STATE.STOPPED]: { label: '已停止', type: 'info' },
  [TASK_STATE.INTERRUPTED]: { label: '已中断', type: 'warning' }
}

export function normalizeTaskState(value) {
  if (!value) return TASK_STATE.QUEUED
  const raw = String(value).trim()
  if (stateMeta[raw]) return raw
  return legacyMap[raw] || TASK_STATE.QUEUED
}

export function taskStateMeta(value) {
  const state = normalizeTaskState(value)
  return { state, ...(stateMeta[state] || stateMeta[TASK_STATE.QUEUED]) }
}

export function taskStatusLabel(taskOrState) {
  const raw = typeof taskOrState === 'object' ? (taskOrState?.state || taskOrState?.status) : taskOrState
  return taskStateMeta(raw).label
}

export function taskStatusType(taskOrState) {
  const raw = typeof taskOrState === 'object' ? (taskOrState?.state || taskOrState?.status) : taskOrState
  return taskStateMeta(raw).type
}

export function isTaskRunning(task) {
  return normalizeTaskState(task?.state || task?.status) === TASK_STATE.RUNNING
}

export function isTaskFailed(task) {
  const state = normalizeTaskState(task?.state || task?.status)
  return state === TASK_STATE.FAILED || state === TASK_STATE.PARTIAL
}

export function isTaskInterrupted(task) {
  return normalizeTaskState(task?.state || task?.status) === TASK_STATE.INTERRUPTED
}

export function isTaskFinished(task) {
  return ![TASK_STATE.QUEUED, TASK_STATE.RUNNING].includes(normalizeTaskState(task?.state || task?.status))
}

export function recoverInterruptedTask(task = {}) {
  const previousState = normalizeTaskState(task.state || task.status)
  if (![TASK_STATE.QUEUED, TASK_STATE.RUNNING].includes(previousState)) return normalizeTaskRecord(task)
  const interruptedAt = new Date().toLocaleString()
  return normalizeTaskRecord({
    ...task,
    previousState,
    state: TASK_STATE.INTERRUPTED,
    status: taskStatusLabel(TASK_STATE.INTERRUPTED),
    interruptedAt,
    finishedAt: task.finishedAt || interruptedAt,
    recoveryReason: '应用上次退出时任务未完成',
    summary: `任务在上次退出时中断，原状态：${taskStatusLabel(previousState)}`
  })
}

export function normalizeTaskRecord(task = {}) {
  let state = normalizeTaskState(task.state || task.status)
  if (state === TASK_STATE.SUCCESS && Number(task.failedCount || 0) > 0) {
    state = TASK_STATE.PARTIAL
  }
  const errorText = String(task.errorMessage || '').toLowerCase()
  let failureCategory = task.failureCategory || ''
  let failureLabel = task.failureLabel || ''
  if (!failureCategory && state === TASK_STATE.FAILED) {
    if (task.exitCode === -1 || /启动失败|not found|enoent|tdl 路径|找不到/.test(errorText)) {
      failureCategory = 'environment'
      failureLabel = '环境或路径'
    } else if (/proxy|timeout|timed out|network|socket|econn|连接/.test(errorText)) {
      failureCategory = 'network'
      failureLabel = '网络或代理'
    } else if (/auth|login|unauthorized|forbidden|session|sign in|登录/.test(errorText)) {
      failureCategory = 'auth'
      failureLabel = '登录或权限'
    } else if (/input|参数|invalid|usage|flag provided but not defined/.test(errorText)) {
      failureCategory = 'arguments'
      failureLabel = '参数错误'
    } else {
      failureCategory = 'runtime'
      failureLabel = '运行失败'
    }
  }
  let summary = String(task.summary || '').trim()
  if (!summary) {
    if (state === TASK_STATE.RUNNING) summary = '任务正在执行'
    else if (state === TASK_STATE.STOPPED) summary = '任务已停止'
    else if (state === TASK_STATE.SUCCESS) summary = '任务已完成'
    else if (state === TASK_STATE.PARTIAL) summary = `部分成功，失败 ${Number(task.failedCount || 0)} 条`
    else if (state === TASK_STATE.FAILED) summary = failureLabel ? `${failureLabel}：${task.errorMessage || '请检查日志'}` : String(task.errorMessage || '任务执行失败')
    else summary = task.status || '排队中'
  }
  return {
    ...task,
    state,
    status: taskStatusLabel(state),
    updatedAt: task.updatedAt || task.finishedAt || task.createdAt || new Date().toLocaleString(),
    failureCategory,
    failureLabel,
    summary
  }
}
