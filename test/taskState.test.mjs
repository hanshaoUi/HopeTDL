import test from 'node:test'
import assert from 'node:assert/strict'
import { TASK_STATE, normalizeTaskRecord, recoverInterruptedTask } from '../src/taskState.js'

test('Given a running task, when it fails, then the summary follows the new state', () => {
  const running = normalizeTaskRecord({ id: 'x', state: TASK_STATE.RUNNING })
  assert.equal(running.summary, '任务正在执行')

  const failed = normalizeTaskRecord({ ...running, state: TASK_STATE.FAILED, exitCode: 1, errorMessage: 'proxy timeout' })
  assert.equal(failed.failureLabel, '网络或代理')
  assert.equal(failed.summary, '网络或代理：proxy timeout')

  const success = normalizeTaskRecord({ ...running, state: TASK_STATE.SUCCESS })
  assert.equal(success.summary, '任务已完成')
})

test('Given real tdl failure output, when classified, then the category matches the cause', () => {
  const classify = errorMessage => {
    const record = normalizeTaskRecord({ id: 'x', state: TASK_STATE.FAILED, exitCode: 1, errorMessage })
    return record.failureLabel
  }
  assert.equal(classify('rpc error: code = FLOOD_WAIT (37)'), '触发限流')
  assert.equal(classify('context deadline exceeded'), '网络或代理')
  assert.equal(classify('dial tcp 149.154.167.51:443: i/o timeout'), '网络或代理')
  assert.equal(classify('rpc error: code = CHANNEL_PRIVATE'), '登录或权限')
  assert.equal(classify('unknown flag: --reply'), '参数错误')
  assert.equal(classify('- failed to get peer: resolve: rpc error code 400: USERNAME_NOT_OCCUPIED'), '参数错误')
  assert.equal(classify('exec: "tdl": executable file not found in $PATH'), '环境或路径')
  assert.equal(classify('something nobody predicted'), '运行失败')

  const spawnFailure = normalizeTaskRecord({ id: 'x', state: TASK_STATE.FAILED, exitCode: -1, errorMessage: '启动失败：spawn tdl ENOENT' })
  assert.equal(spawnFailure.failureLabel, '环境或路径')
})

test('Given a failure without a message, when summarized, then the exit code is reported', () => {
  const failed = normalizeTaskRecord({ id: 'x', state: TASK_STATE.FAILED, exitCode: 2 })
  assert.equal(failed.summary, '运行失败：退出码 2')
})

test('Given a caller-written summary, when the state changes, then it is kept', () => {
  const task = normalizeTaskRecord({ id: 'x', state: TASK_STATE.RUNNING, summaryAuto: false, summary: '第 3 步：转发' })
  assert.equal(task.summary, '第 3 步：转发')
  assert.equal(normalizeTaskRecord({ ...task, state: TASK_STATE.SUCCESS }).summary, '第 3 步：转发')
})

test('Given an interrupted task, when recovered, then the previous state stays in the summary', () => {
  const recovered = recoverInterruptedTask({ id: 'x', state: TASK_STATE.RUNNING })
  assert.equal(recovered.state, TASK_STATE.INTERRUPTED)
  assert.equal(recovered.summary, '任务在上次退出时中断，原状态：运行中')
})

test('Given a legacy record with a stale summary, when normalized, then it is recomputed', () => {
  const legacy = { id: 'x', state: TASK_STATE.SUCCESS, summary: '任务正在执行' }
  assert.equal(normalizeTaskRecord(legacy).summary, '任务已完成')
})
