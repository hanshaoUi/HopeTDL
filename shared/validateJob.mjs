import { toArgs } from './jobSpec.mjs'
import { invalidNumbers } from './specKey.mjs'

// Validate original decimal input before conversion. Invalid drafts remain NaN
// so both execution and plan creation can reject them before JSON serialization.
export function safeDecimal(value, empty = null) {
  const raw = String(value ?? '').trim()
  if (!raw) return empty
  return /^\d+$/.test(raw) && BigInt(raw) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : NaN
}

export function validateJob(spec) {
  const filled = value => String(value ?? '').trim().length > 0
  if (!spec || invalidNumbers(spec)) throw new Error('ID、话题和延迟必须是非负安全整数')
  if (spec.kind === 'workflow') {
    if (!Array.isArray(spec.steps) || !spec.steps.length) throw new Error('流程至少需要一个步骤')
    spec.steps.forEach(validateJob)
    return
  }
  if (spec.kind === 'export') {
    if (!filled(spec.chat) || !filled(spec.output)) throw new Error('请填写导出来源和输出文件')
    if (spec.selector?.type && !['id','all'].includes(spec.selector.type) && !filled(spec.selector.input)) throw new Error('所选导出范围需要填写 -i')
    if (spec.reply != null && (!/^\d+$/.test(String(spec.reply)) || BigInt(spec.reply) === 0n || BigInt(spec.reply)>BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('主消息 ID 必须是正的安全整数')
  } else if (spec.kind === 'forward') {
    if (!filled(spec.from) || (!filled(spec.target?.peer) && !filled(spec.target?.routerFile))) throw new Error('请填写转发来源和目标')
  } else if (spec.kind === 'download') {
    if (!filled(spec.directory) && !spec.serve) throw new Error('请选择下载目录')
    if ((!spec.source?.items?.length || spec.source.items.some(v => !filled(v) || String(v).includes('<workDir>'))) && !['continue','restart'].includes(spec.resumeMode)) throw new Error('请填写下载来源或评论主消息 ID')
  } else if (spec.kind === 'upload') {
    if (!filled(spec.chat) || !filled(spec.path)) throw new Error('请填写上传文件和目标对话')
  } else if (spec.kind === 'comment-forward') {
    if (!filled(spec.sourceChat)) throw new Error('请填写源频道 / 群组')
    if (!spec.dryRun && !spec.exportOnly && (spec.forwardMain !== false || spec.forwardComments !== false) && !filled(spec.targetChat)) throw new Error('正式转发需要目标对话')
    if (spec.resume && !filled(spec.workDir)) throw new Error('续跑请选择原工作目录')
    return
  }
  toArgs(spec)
}
