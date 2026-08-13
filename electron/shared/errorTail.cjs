// 任务失败时只报「退出码 N」等于没说：真正的原因在子进程最后几行输出里，
// 而日志是流式发走的，没人留底。这里按 taskId 留一小段尾巴，任务结束时随
// tdl:done 带回渲染端 —— 它既是任务列表里显示的失败原因，
// 也是 normalizeTaskRecord 用来分类（网络 / 登录 / 参数 / 限流 / 环境）的输入。
const TAIL_LIMIT = 2 * 1024

// tdl 会输出 ANSI 颜色和光标控制码，进度条还会用 \r 原地重绘。
// 这些混进错误原因里既难看也会干扰分类，先清掉。
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g

// Go 调用栈的两种行：包路径（github.com/gotd/td/telegram.(*Client).Run.func3）
// 和文件位置（github.com/gotd/td@v0.140.0/telegram/connect.go:180）。
const STACK_FRAME_PATTERN = /^(?:[\w.-]+\.[a-z]{2,}\/\S*|\S+\.go:\d+)$/

/**
 * 取输出尾部若干行作为失败原因。
 * @param {string} text 原始输出
 * @param {{maxLines?: number, maxChars?: number}} options
 * @returns {string}
 */
function summarizeTail(text, options = {}) {
  const maxLines = options.maxLines || 4
  const maxChars = options.maxChars || 400
  const lines = String(text || '')
    .replace(ANSI_PATTERN, '')
    .split(/\r?\n/)
    // 行内的 \r 是进度条重绘，只有最后一次的内容才是真实的。
    .map(line => line.slice(line.lastIndexOf('\r') + 1).trim())
    .filter(Boolean)
    // tdl 是 Go 写的，报错常常带一串调用栈（包路径一行、文件:行号一行）。
    // 这些行对使用者没有意义，还会把真正的原因挤出尾部窗口。
    .filter(line => !STACK_FRAME_PATTERN.test(line))
  if (!lines.length) return ''
  return lines.slice(-maxLines).join('\n').slice(-maxChars)
}

/**
 * 按 taskId 维护输出尾巴的缓冲区，总量恒定（每个任务每个通道最多 TAIL_LIMIT 字节）。
 */
function createErrorTails(limit = TAIL_LIMIT) {
  const buffers = new Map()

  return {
    record(taskId, channel, text) {
      if (!taskId || !text) return
      const entry = buffers.get(taskId) || { stdout: '', stderr: '' }
      if (!(channel in entry)) return
      entry[channel] = (entry[channel] + String(text)).slice(-limit)
      buffers.set(taskId, entry)
    },
    /** 取出并清掉某个任务的尾巴。stderr 为空时兜到 stdout。 */
    take(taskId) {
      const entry = buffers.get(taskId)
      buffers.delete(taskId)
      if (!entry) return ''
      return summarizeTail(entry.stderr) || summarizeTail(entry.stdout)
    },
    drop(taskId) {
      buffers.delete(taskId)
    },
    get size() {
      return buffers.size
    }
  }
}

module.exports = { createErrorTails, summarizeTail, TAIL_LIMIT }
