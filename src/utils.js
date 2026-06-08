import { appState } from './main'

export function quoteArg(v) {
  if (v === undefined || v === null || v === '') return ''
  const s = String(v)
  return /[\s'"{}]/.test(s) ? JSON.stringify(s) : s
}

export function globalArgs() {
  const c = appState.config || {}
  const args = []
  if (c.proxy) args.push('--proxy', c.proxy)
  if (c.delay) args.push('--delay', c.delay)
  if (c.limit) args.push('-l', String(c.limit))
  if (c.threads) args.push('--threads', String(c.threads))
  if (c.ns) args.push('-n', c.ns)
  return args
}

export function commandText(args) {
  const c = appState.config || {}
  return [c.tdlPath || 'tdl', ...globalArgs(), ...args].map(quoteArg).join(' ')
}

export async function runTask(type, args, title) {
  const id = `${type}_${Date.now()}`
  appState.tasks.unshift({ id, type, title, status: '运行中', args, createdAt: new Date().toLocaleString() })
  return window.tdlApi.run({ taskId: id, args })
}
