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
    // 带上原状态，比通用的中断摘要更有信息量，所以固定住不让它被重算。
    summaryAuto: false,
    summary: `任务在上次退出时中断，原状态：${taskStatusLabel(previousState)}`
  })
}

// 失败原因（子进程输出的最后几行，见 electron/shared/errorTail.cjs）按顺序匹配，
// 命中即止。顺序有讲究：FLOOD_WAIT 里带 "wait" 也带超时语气，得排在网络之前；
// 「environment」放最后，因为 "not found" 这类词在 peer / 参数类报错里也常出现。
const FAILURE_RULES = [
  { category: 'limit', label: '触发限流', test: /flood_wait|too many requests|rate limit|限流/ },
  { category: 'auth', label: '登录或权限', test: /auth_key|unauthorized|forbidden|not logged|need to login|session_|channel_private|chat_admin_required|登录|权限/ },
  { category: 'network', label: '网络或代理', test: /proxy|timeout|timed out|deadline exceeded|dial tcp|i\/o timeout|no such host|network|socket|econn|连接/ },
  // 「对话填错了」在实际使用里比命令行参数写错更常见，tdl 报的是 USERNAME_NOT_OCCUPIED
  // 这类 rpc 错误码，归到参数错误 —— 要改的确实是你填进表单的那个值。
  { category: 'arguments', label: '参数错误', test: /flag provided but not defined|unknown (?:flag|command|shorthand)|invalid|usage:|username_not_occupied|peer_id_invalid|failed to get peer|peer not found|chat not found|参数/ },
  { category: 'environment', label: '环境或路径', test: /启动失败|enoent|command not found|no such file|executable file not found|tdl 路径|找不到/ }
]

function autoSummary(state, task, failureLabel) {
  if (state === TASK_STATE.RUNNING) return '任务正在执行'
  if (state === TASK_STATE.STOPPED) return '任务已停止'
  if (state === TASK_STATE.INTERRUPTED) return '任务在上次退出时中断'
  if (state === TASK_STATE.SUCCESS) return '任务已完成'
  if (state === TASK_STATE.PARTIAL) return `部分成功，失败 ${Number(task.failedCount || 0)} 条`
  if (state === TASK_STATE.FAILED) {
    const reason = String(task.errorMessage || '').trim()
      || (task.exitCode === null || task.exitCode === undefined ? '请检查日志' : `退出码 ${task.exitCode}`)
    return failureLabel ? `${failureLabel}：${reason}` : reason
  }
  return '排队中'
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
    // exitCode -1 只有 spawn 失败会出现，那一定是找不到 tdl，不用再看文本。
    const matched = task.exitCode === -1
      ? FAILURE_RULES.find(rule => rule.category === 'environment')
      : FAILURE_RULES.find(rule => rule.test.test(errorText))
    failureCategory = matched?.category || 'runtime'
    failureLabel = matched?.label || '运行失败'
  }
  // 摘要是状态的派生值，状态一变就得重算。早期实现是「summary 非空就沿用」，
  // 于是任务创建时写下的「任务正在执行」会一路跟到成功或失败之后，
  // 把这里算好的失败原因整条盖掉。只有调用方显式给的摘要（summaryAuto === false）才固定不变。
  const manualSummary = task.summaryAuto === false ? String(task.summary || '').trim() : ''
  return {
    ...task,
    state,
    status: taskStatusLabel(state),
    updatedAt: task.updatedAt || task.finishedAt || task.createdAt || new Date().toLocaleString(),
    failureCategory,
    failureLabel,
    summaryAuto: !manualSummary,
    summary: manualSummary || autoSummary(state, task, failureLabel)
  }
}
