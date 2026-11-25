const TDL_JOB_KINDS = new Set(['login', 'chat-list', 'export', 'forward', 'upload', 'download'])

function pushValue(args, flag, value) {
  if (value === undefined || value === null || value === '') return
  args.push(flag, String(value))
}

function pushFlag(args, flag, enabled) {
  if (enabled) args.push(flag)
}

function exportArgs(spec) {
  const args = ['chat', 'export']
  pushValue(args, '-c', spec.chat)
  if (spec.reply !== undefined && spec.reply !== null && spec.reply !== '') {
    pushValue(args, '--reply', spec.reply)
  } else if (spec.selector && spec.selector.type !== 'all' && String(spec.selector.input ?? '').trim()) {
    pushValue(args, '-T', spec.selector.type)
    pushValue(args, '-i', spec.selector.input)
  }
  pushFlag(args, '--all', spec.all)
  pushFlag(args, '--raw', spec.raw)
  pushFlag(args, '--with-content', spec.withContent)
  pushValue(args, '-o', spec.output)
  return args
}

function forwardTarget(target) {
  if (!target) return ''
  if (target.routerFile) return String(target.routerFile)
  const peer = String(target.peer || '')
  if (!peer || target.thread === undefined || target.thread === null || target.thread === '') return peer
  const raw=String(target.thread)
  if(!/^\d+$/.test(raw)||BigInt(raw)>18446744073709551615n)throw new TypeError('话题 ID 必须是非负整数')
  return `{ Peer: ${JSON.stringify(peer)}, Thread: ${BigInt(raw).toString()} }`
}

function forwardArgs(spec) {
  const args = ['forward']
  pushValue(args, '--from', spec.from)
  pushValue(args, '--to', forwardTarget(spec.target))
  pushValue(args, '--mode', spec.mode)
  pushFlag(args, '--dry-run', spec.dryRun)
  pushFlag(args, '--silent', spec.silent)
  pushFlag(args, '--single', spec.single)
  pushFlag(args, '--desc', spec.desc)
  pushValue(args, '--edit', spec.edit)
  return args
}

function uploadArgs(spec) {
  const args = ['upload']
  pushValue(args, '-p', spec.path)
  pushValue(args, '-c', spec.chat)
  pushValue(args, '--topic', spec.topic)
  pushValue(args, '--caption', spec.caption)
  pushFlag(args, '--photo', spec.photo)
  pushFlag(args, '--rm', spec.remove)
  return args
}

function loginArgs(spec) {
  const args = ['login']
  pushValue(args, '-T', spec.type)
  return args
}

function chatListArgs(spec) {
  const args = ['chat', 'ls']
  pushValue(args, '-o', spec.output || 'json')
  pushValue(args, '--filter', spec.filter)
  return args
}

function downloadArgs(spec) {
  const args = ['download']
  pushValue(args, '-d', spec.directory)
  pushValue(args, '-i', spec.include)
  pushValue(args, '-e', spec.exclude)
  pushValue(args, '--template', spec.template)
  pushFlag(args, '--group', spec.group)
  pushFlag(args, '--skip-same', spec.skipSame)
  pushFlag(args, '--rewrite-ext', spec.rewriteExt)
  pushFlag(args, '--serve', spec.serve)
  if (spec.serve) pushValue(args, '--port', spec.port)
  pushFlag(args, '--takeout', spec.takeout)
  pushFlag(args, '--desc', spec.desc)
  pushFlag(args, '--continue', spec.resumeMode === 'continue')
  pushFlag(args, '--restart', spec.resumeMode === 'restart')
  const sourceFlag = spec.source?.type === 'url' ? '-u' : '-f'
  for (const item of spec.source?.items || []) pushValue(args, sourceFlag, item)
  return args
}

function toArgs(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('JobSpec must be an object')
  switch (spec.kind) {
    case 'login': return loginArgs(spec)
    case 'chat-list': return chatListArgs(spec)
    case 'export': return exportArgs(spec)
    case 'forward': return forwardArgs(spec)
    case 'upload': return uploadArgs(spec)
    case 'download': return downloadArgs(spec)
    default: throw new TypeError(`Unsupported JobSpec kind: ${String(spec.kind)}`)
  }
}

function executionForSpec(spec) {
  if (spec?.kind === 'comment-forward') return { kind: 'comment-forward', payload: spec }
  if (!TDL_JOB_KINDS.has(spec?.kind)) {
    throw new TypeError(`Unsupported JobSpec kind: ${String(spec?.kind)}`)
  }
  return { kind: 'tdl', args: toArgs(spec) }
}

function sourceChatForSpec(spec) {
  if (!spec || typeof spec !== 'object') return ''
  if (spec.kind === 'export') return String(spec.chat || '')
  if (spec.kind === 'comment-forward') return String(spec.sourceChat || '')
  return ''
}

function outputPathForRange(outputPath, rangeText, timestamp) {
  if (!outputPath) return ''
  const text = String(outputPath)
  const dotIndex = text.lastIndexOf('.')
  const suffix = `_${String(rangeText).replace(/[^0-9a-zA-Z_-]/g, '-')}_${timestamp}`
  if (dotIndex <= 0) return `${text}${suffix}`
  return `${text.slice(0, dotIndex)}${suffix}${text.slice(dotIndex)}`
}

function createIncrementalSpec(spec, start, end, timestamp) {
  if (spec?.kind !== 'export') {
    throw new TypeError(`Incremental range requires an export JobSpec, received: ${String(spec?.kind)}`)
  }
  const rangeText = `${start},${end}`
  return {
    ...spec,
    selector: { type: 'id', input: rangeText },
    output: outputPathForRange(spec.output, rangeText, timestamp)
  }
}

function withForwardSource(spec, filePath) {
  if (spec?.kind !== 'forward') {
    throw new TypeError(`Forward source requires a forward JobSpec, received: ${String(spec?.kind)}`)
  }
  return { ...spec, from: String(filePath || '') }
}

export {
  createIncrementalSpec,
  executionForSpec,
  sourceChatForSpec,
  toArgs,
  withForwardSource
}
