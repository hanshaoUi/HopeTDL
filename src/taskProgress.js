// A group's index is emitted before processing it. Count it only after its
// terminal event, so an export of group 1/1 cannot appear as 100% complete.
export function taskProgress(task, live) { return live || task.progress }
export function progressPercent(task, live) {
  const p = taskProgress(task, live)
  if (!p?.total) return null
  const complete = ['done', 'failed', 'skipped', 'rehearsal', 'checkpoint-summary'].includes(p.stage)
  const count = Math.max(0, Number(p.current) - (complete ? 0 : 1))
  return Math.min(100, Math.round(count / p.total * 100))
}
export function stagesForTask(task, progress) {
  const live = task.state === 'running'
  const failed = ['failed','partial','interrupted'].includes(task.state)
  if (task.spec?.kind === 'workflow') {
    return (task.spec.steps || []).map((s,i)=>({label:`${i+1}. ${s.kind}`,state:task.state==='success'||i+1<task.currentStep?'done':i+1===task.currentStep?(failed?'fail':live?'active':''):''}))
  }
  if (task.spec?.kind !== 'comment-forward') return []
  const stage = (progress || task.progress)?.stage
  const dry = task.spec.dryRun === true
  return ['读取主消息列表',dry?'逐条导出与转发（演练跳过）':'逐条导出、过滤与转发',dry?'完成断点（演练不写入）':'保存每组断点'].map((label,i)=>({
    label,
    state:dry&&i>0?'skipped':task.state==='success'?'done':task.state==='queued'?'':i===0?(stage && stage!=='export-list'?'done':failed?'fail':live?'active':''):i===1&&stage&&stage!=='export-list'?(stage==='checkpoint'?'done':failed?'fail':live?'active':''):i===2&&stage==='checkpoint'?(failed?'fail':live?'active':''):''
  }))
}
