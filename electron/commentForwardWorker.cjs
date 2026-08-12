const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const EventEmitter = require('events')

// 子进程输出只保留尾部这么多字符用于报错，其余丢弃。
const OUTPUT_TAIL_LIMIT = 32 * 1024

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readJsonSafe(file) {
  if (!file || !fs.existsSync(file)) return null
  try {
    const text = fs.readFileSync(file, 'utf8').trim()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeJsonSafe(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function quoteArg(value) {
  const s = String(value)
  return /[\s'"{}]/.test(s) ? JSON.stringify(s) : s
}

function createStamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function asSafeInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return null
  if (n < 0) return null
  return n
}

function looksLikeMessageObject(obj, trustId = false) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const id = asSafeInteger(obj.id ?? obj.ID ?? obj.message_id ?? obj.messageID)
  if (id === null) return false
  if (trustId) return true
  const messageKeys = [
    'date', 'message', 'text', 'raw', 'media', 'file', 'from_id', 'fromId', 'peer_id', 'peerId',
    'reply_to', 'replyTo', 'edit_date', 'editDate', 'entities', 'views', 'forwards', 'out', 'post',
    'grouped_id', 'groupedId', 'via_bot_id', 'viaBotId', 'ttl_period', 'ttlPeriod', 'caption', 'content'
  ]
  return messageKeys.some(key => Object.prototype.hasOwnProperty.call(obj, key))
}

function collectMessageIds(node, ids = [], contextKey = '') {
  if (!node) return ids
  if (Array.isArray(node)) {
    const trustedArray = ['messages', 'message', 'items', 'list', 'data', 'result'].includes(String(contextKey || '').toLowerCase())
    for (const item of node) {
      if (looksLikeMessageObject(item, trustedArray)) {
        const id = asSafeInteger(item.id ?? item.ID ?? item.message_id ?? item.messageID)
        if (id !== null) ids.push(id)
      }
      collectMessageIds(item, ids, contextKey)
    }
    return ids
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectMessageIds(value, ids, key)
  }
  return ids
}

function extractMessageIds(json) {
  return Array.from(new Set(collectMessageIds(json))).sort((a, b) => a - b)
}

function parseKeywords(input) {
  if (!input) return []
  if (Array.isArray(input)) return input.map(item => String(item).trim()).filter(Boolean)
  return String(input)
    .split(/\r?\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean)
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createKeywordMatcher(config) {
  const keywords = parseKeywords(config.blockKeywordsText || config.blockKeywords)
  if (!keywords.length) return null

  const caseSensitive = Boolean(config.keywordCaseSensitive)
  const regexMode = Boolean(config.keywordRegexMode)
  const rules = keywords.map(keyword => {
    if (regexMode) {
      try {
        return { raw: keyword, regex: new RegExp(keyword, caseSensitive ? 'm' : 'im') }
      } catch {
        return { raw: keyword, regex: new RegExp(escapeRegExp(keyword), caseSensitive ? 'm' : 'im') }
      }
    }
    return { raw: keyword, keyword: caseSensitive ? keyword : keyword.toLowerCase() }
  })

  return function matchKeyword(text) {
    const source = String(text || '')
    const comparable = caseSensitive ? source : source.toLowerCase()
    for (const rule of rules) {
      if (rule.regex) {
        if (rule.regex.test(source)) return rule.raw
      } else if (comparable.includes(rule.keyword)) {
        return rule.raw
      }
    }
    return null
  }
}

function collectTextCandidates(obj, depth = 0) {
  if (!obj || depth > 5) return []
  if (typeof obj === 'string') return [obj]
  if (Array.isArray(obj)) return obj.flatMap(item => collectTextCandidates(item, depth + 1))
  if (typeof obj !== 'object') return []

  const preferredKeys = [
    'message', 'Message', 'text', 'Text', 'caption', 'Caption', 'content', 'Content',
    'raw_text', 'rawText', 'body', 'Body', 'title', 'Title', 'description', 'Description'
  ]
  const result = []
  for (const key of preferredKeys) {
    if (typeof obj[key] === 'string') result.push(obj[key])
  }
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // 尽量避免路径、文件名、URL、peer 等内部字段误伤。
      if (/path|file|dir|url|thumb|mime|type|peer|chat|from|to/i.test(key)) continue
      result.push(value)
    } else if (value && typeof value === 'object') {
      if (/media|entities|reply|forward|content|message|text|caption|raw/i.test(key)) {
        result.push(...collectTextCandidates(value, depth + 1))
      }
    }
  }
  return result
}

// 原实现为整棵 JSON 建了一份全新的深拷贝（每个数组、每个对象都新建），
// 导出大频道时相当于把已经很大的解析结果再翻一倍。这里改成原地过滤：
// 数组用读写双指针就地压缩，对象直接删键，不产生第二棵树。
// 同一趟里顺便统计保留下来的消息 ID，省掉外层「写完再读回来数一遍」的第二次解析。
function filterTreeInPlace(node, contextKey, ctx) {
  if (Array.isArray(node)) {
    const trustedArray = ['messages', 'message', 'items', 'list', 'data', 'result'].includes(String(contextKey || '').toLowerCase())
    let write = 0
    for (let read = 0; read < node.length; read += 1) {
      const item = node[read]
      if (looksLikeMessageObject(item, trustedArray)) {
        if (ctx.matcher) {
          const hit = ctx.matcher(collectTextCandidates(item).join('\n'))
          if (hit) {
            ctx.removed += 1
            ctx.hitKeywords.add(hit)
            continue
          }
        }
        const id = asSafeInteger(item.id ?? item.ID ?? item.message_id ?? item.messageID)
        if (id !== null) ctx.ids.add(id)
      }
      filterTreeInPlace(item, contextKey, ctx)
      if (item === null || item === undefined) continue
      node[write] = item
      write += 1
    }
    node.length = write
    return node
  }

  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (value === null || value === undefined) {
        delete node[key]
        continue
      }
      filterTreeInPlace(value, key, ctx)
    }
    return node
  }

  return node
}

/**
 * 读一次、走一遍：完成关键词过滤并给出过滤后的消息条数。
 * 没有关键词规则时不写新文件，只统计条数。
 */
function filterAndCount(sourceFile, targetFile, config) {
  const matcher = createKeywordMatcher(config)
  const hasKeywordRules = Boolean(matcher)
  const json = readJsonSafe(sourceFile)
  if (!json) return { file: sourceFile, removed: 0, hitKeywords: [], hasKeywordRules, count: 0 }

  const ctx = { matcher, removed: 0, hitKeywords: new Set(), ids: new Set() }
  filterTreeInPlace(json, '', ctx)

  if (hasKeywordRules) writeJsonSafe(targetFile, json)
  return {
    file: hasKeywordRules ? targetFile : sourceFile,
    removed: ctx.removed,
    hitKeywords: Array.from(ctx.hitKeywords),
    hasKeywordRules,
    count: ctx.ids.size
  }
}

function normalizeConfig(input) {
  const config = input || {}
  const baseOutputDir = config.baseOutputDir || process.cwd()
  const workDir = config.workDir
    ? path.resolve(config.workDir)
    : path.resolve(baseOutputDir, 'comment-forward', createStamp())

  return {
    taskId: config.taskId || `comment_forward_${Date.now()}`,
    tdlPath: config.tdlPath || 'tdl',
    globalArgs: Array.isArray(config.globalArgs) ? config.globalArgs : [],
    pathEnv: config.pathEnv || process.env.PATH || '',
    sourceChat: String(config.sourceChat || '').trim(),
    targetChat: String(config.targetChat || '').trim(),
    targetTopicId: config.targetTopicId ? Number(config.targetTopicId) : null,
    startId: config.startId ? Number(config.startId) : null,
    endId: config.endId ? Number(config.endId) : null,
    includeComments: config.includeComments !== false,
    forwardMain: config.forwardMain !== false,
    forwardComments: config.forwardComments !== false,
    exportOnly: Boolean(config.exportOnly),
    dryRun: Boolean(config.dryRun),
    resume: Boolean(config.resume),
    skipExistingExport: Boolean(config.skipExistingExport),
    delayMs: Number(config.delayMs || 1500),
    mode: config.mode || 'direct',
    desc: Boolean(config.desc),
    continueOnError: config.continueOnError !== false,
    blockKeywordsText: String(config.blockKeywordsText || '').trim(),
    keywordCaseSensitive: Boolean(config.keywordCaseSensitive),
    keywordRegexMode: Boolean(config.keywordRegexMode),
    fallbackToDefaultTopicOnMsgIdInvalid: config.fallbackToDefaultTopicOnMsgIdInvalid !== false,
    skipPostWhenNoComments: Boolean(config.skipPostWhenNoComments),
    skipCommentsWhenPostBlocked: config.skipCommentsWhenPostBlocked !== false,
    workDir
  }
}

class CommentForwardWorker extends EventEmitter {
  constructor(config) {
    super()
    this.config = normalizeConfig(config)
    this.aborted = false
    this.currentProcess = null
    this.paths = {
      root: this.config.workDir,
      posts: path.join(this.config.workDir, 'posts.json'),
      queue: path.join(this.config.workDir, 'queue'),
      comments: path.join(this.config.workDir, 'comments'),
      filtered: path.join(this.config.workDir, 'filtered'),
      router: path.join(this.config.workDir, 'target_router.txt'),
      progress: path.join(this.config.workDir, 'progress.json')
    }
  }

  abort() {
    this.aborted = true
    if (this.currentProcess && !this.currentProcess.killed) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.currentProcess.pid), '/f', '/t'])
        } else {
          this.currentProcess.kill('SIGTERM')
        }
      } catch {}
    }
  }

  log(text, level = 'info') {
    if (text === undefined || text === null) return
    const content = String(text)
    if (!content.trim()) return
    this.emit('log', { taskId: this.config.taskId, level, text: content.endsWith('\n') ? content : content + '\n' })
  }

  status(status, extra = {}) {
    this.emit('status', { status, taskId: this.config.taskId, ...extra })
  }

  progress(data) {
    this.emit('progress', { taskId: this.config.taskId, ...data })
  }

  async runCommand(args, options = {}) {
    if (this.aborted) throw new Error('任务已停止')
    const finalArgs = [...this.config.globalArgs, ...args]
    this.log(`$ ${this.config.tdlPath} ${finalArgs.map(quoteArg).join(' ')}`, options.commandType || 'info')

    if (this.config.dryRun && options.allowDryRun !== false) {
      this.log('[演练模式] 跳过实际执行\n', 'warning')
      return { code: 0, stdout: '', stderr: '' }
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(this.config.tdlPath, finalArgs, {
        cwd: this.paths.root,
        shell: false,
        env: { ...process.env, PATH: this.config.pathEnv || process.env.PATH || '' }
      })
      this.currentProcess = child
      let stdout = ''
      let stderr = ''

      // 这两份字符串只用于失败时拼错误信息。
      // 原来是无上限累积：导出大频道时 tdl 的进度输出能堆到几百 MB。
      const keepTail = text => text.length > OUTPUT_TAIL_LIMIT ? text.slice(-OUTPUT_TAIL_LIMIT) : text

      child.stdout.on('data', data => {
        const text = data.toString()
        stdout = keepTail(stdout + text)
        this.log(text, 'stdout')
      })
      child.stderr.on('data', data => {
        const text = data.toString()
        stderr = keepTail(stderr + text)
        this.log(text, 'stderr')
      })
      child.on('error', err => {
        this.currentProcess = null
        reject(err)
      })
      child.on('close', code => {
        this.currentProcess = null
        if (code === 0) resolve({ code, stdout, stderr })
        else {
          const details = [stderr, stdout].map(text => String(text || '').trim()).filter(Boolean).join('\n')
          const err = new Error(details ? `命令执行失败，退出码：${code}\n${details}` : `命令执行失败，退出码：${code}`)
          err.exitCode = code
          err.stdout = stdout
          err.stderr = stderr
          reject(err)
        }
      })
    })
  }

  validate() {
    if (!this.config.sourceChat) throw new Error('请填写源频道 / 群组')
    if (!this.config.exportOnly && !this.config.dryRun && (this.config.forwardMain || this.config.forwardComments) && !this.config.targetChat) {
      throw new Error('需要转发时，请填写目标频道 / 群组')
    }
    if (this.config.startId && this.config.endId && this.config.startId > this.config.endId) {
      throw new Error('起始 ID 不能大于结束 ID')
    }
  }

  loadProgress() {
    if (!this.config.resume) return { done: {}, failed: {} }
    const progress = readJsonSafe(this.paths.progress)
    return { done: progress?.done || {}, failed: progress?.failed || {} }
  }

  saveProgress(progress) {
    writeJsonSafe(this.paths.progress, { updatedAt: new Date().toISOString(), ...progress })
  }

  exportRangeArgs() {
    const { startId, endId } = this.config
    if (!startId && !endId) return []
    const start = startId || 0
    const end = endId || '9223372036854775807'
    return ['-T', 'id', '-i', `${start},${end}`]
  }

  async exportPostsList() {
    if (this.config.skipExistingExport && fs.existsSync(this.paths.posts)) {
      this.log(`已存在主消息列表，跳过重新导出：${this.paths.posts}`, 'info')
      return
    }
    await this.runCommand([
      'chat', 'export', '-c', this.config.sourceChat,
      ...this.exportRangeArgs(),
      '--all', '--with-content', '-o', this.paths.posts
    ], { commandType: 'export', allowDryRun: false })
  }

  async exportSinglePost(id, file) {
    if (this.config.skipExistingExport && fs.existsSync(file)) {
      this.log(`已存在主消息缓存，跳过导出：${path.basename(file)}`, 'info')
      return
    }
    await this.runCommand([
      'chat', 'export', '-c', this.config.sourceChat,
      '-T', 'id', '-i', `${id},${id}`,
      '--all', '--with-content', '-o', file
    ], { commandType: 'export' })
  }

  async exportComments(id, file) {
    if (this.config.skipExistingExport && fs.existsSync(file)) {
      this.log(`已存在评论区缓存，跳过导出：${path.basename(file)}`, 'info')
      return
    }
    await this.runCommand([
      'chat', 'export', '-c', this.config.sourceChat,
      '--reply', String(id),
      '--all', '--with-content', '-o', file
    ], { commandType: 'export' })
  }

  buildDestination() {
    if (!this.config.targetTopicId) return this.config.targetChat
    const safePeer = String(this.config.targetChat).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const expr = `{ Peer: "${safePeer}", Thread: ${this.config.targetTopicId} }`
    fs.writeFileSync(this.paths.router, expr, 'utf8')
    return this.paths.router
  }


  buildDefaultDestination() {
    return this.config.targetChat;
  }

  isMsgIdInvalid(error) {
    const message = [
      error && error.message,
      error && error.stderr,
      error && error.stdout,
      error
    ].map(item => String(item || "")).join("\n");
    return message.includes("MSG_ID_INVALID");
  }

  async forwardJsonToDefault(file, label) {
    if (this.config.exportOnly) {
      this.log(`仅导出模式：跳过转发 ${label}`, "warn");
      return;
    }

    const args = [
      "forward",
      "--from",
      file,
      "--to",
      this.buildDefaultDestination(),
      "--mode",
      this.config.mode
    ];

    await this.runCommand(args, {
      commandType: "forward"
    });

    this.log(`${label} 已降级转发到目标群默认聊天`, "success");
  }

  async forwardJson(file, label) {
    if (this.config.exportOnly) {
      this.log(`仅导出模式：跳过转发 ${label}`, "warn");
      return;
    }

    const args = [
      "forward",
      "--from",
      file,
      "--to",
      this.buildDestination(),
      "--mode",
      this.config.mode
    ];

    try {
      await this.runCommand(args, {
        commandType: "forward"
      });

      this.log(`${label} 已转发`, "success");
    } catch (error) {
      if (this.config.targetTopicId && this.isMsgIdInvalid(error)) {
        this.log(
          `转发到目标话题失败：MSG_ID_INVALID。目标话题 Thread 可能无效，或目标群不是 Topics 群。当前 Thread=${this.config.targetTopicId}`,
          "error"
        );

        if (this.config.fallbackToDefaultTopicOnMsgIdInvalid) {
          this.log("已开启降级：改为发送到目标群默认聊天，不指定话题", "warn");
          await this.forwardJsonToDefault(file, label);
          return;
        }
      }

      throw error;
    }
  }

  async start() {
    try {
      this.validate()
    } catch (err) {
      this.status('error', { message: err.message })
      this.log(err.message, 'error')
      return
    }

    ensureDir(this.paths.root)
    ensureDir(this.paths.queue)
    ensureDir(this.paths.comments)
    ensureDir(this.paths.filtered)

    this.status('running', { workDir: this.paths.root })
    this.log(`工作目录：${this.paths.root}`, 'info')
    if (this.config.targetTopicId) {
      this.log(`目标话题 ID：${this.config.targetTopicId}`, 'info')
      this.log(`目标路由文件：${this.paths.router}`, 'info')
    }
    const keywordList = parseKeywords(this.config.blockKeywordsText)
    if (keywordList.length) {
      this.log(`已启用关键词屏蔽：${keywordList.join(' / ')}`, 'info')
      if (this.config.skipCommentsWhenPostBlocked) this.log('主消息命中关键词时：连同评论区一起跳过', 'info')
    }

    const progress = this.loadProgress()
    const needCommentProcessing = this.config.includeComments && (this.config.forwardComments || this.config.skipPostWhenNoComments)
    if (this.config.skipPostWhenNoComments) {
      this.log('规则：无评论区时跳过整组，包括主消息', 'info')
    }
    if (!needCommentProcessing && this.config.includeComments) {
      this.log('当前仅转发主消息，跳过评论区导出与处理', 'info')
    }

    try {
      this.log('开始导出主消息列表', 'info')
      await this.exportPostsList()
      let ids = extractMessageIds(readJsonSafe(this.paths.posts))
      if (this.config.startId || this.config.endId) {
        ids = ids.filter(id => {
          if (this.config.startId && id < this.config.startId) return false
          if (this.config.endId && id > this.config.endId) return false
          return true
        })
      }
      if (this.config.desc) ids = ids.sort((a, b) => b - a)
      this.log(`共找到 ${ids.length} 条主消息`, 'info')

      let index = 0
      for (const id of ids) {
        index += 1
        if (this.aborted) throw new Error('任务已停止')
        const idKey = String(id)
        if (progress.done[idKey]) {
          this.log(`跳过已完成：${id}`, 'info')
          this.progress({ current: index, total: ids.length, id, stage: 'skipped' })
          continue
        }

        const postFile = path.join(this.paths.queue, `post_${id}.json`)
        const commentsFile = path.join(this.paths.comments, `comments_${id}.json`)
        this.progress({ current: index, total: ids.length, id, stage: 'start' })
        this.log(`========== 处理 ${index}/${ids.length}：主消息 ${id} ==========`, 'info')

        try {
          this.progress({ current: index, total: ids.length, id, stage: 'export-post' })
          await this.exportSinglePost(id, postFile)

          const filteredPostFile = path.join(this.paths.filtered, `post_${id}.filtered.json`)
          const postFilter = filterAndCount(postFile, filteredPostFile, this.config)
          if (postFilter.removed > 0) {
            this.log(`主消息 ${id} 命中关键词，已屏蔽 ${postFilter.removed} 条；关键词：${postFilter.hitKeywords.join(' / ')}`, 'warning')
          }
          const postCount = postFilter.count
          this.log(`主消息 ${id} 过滤后数量：${postCount}`, 'info')
          const postBlocked = postFilter.removed > 0 && postCount === 0

          let commentsFilter = null
          let commentCount = 0
          let skipWholeGroupBecauseNoComments = false

          // 开启“无评论区时跳过主消息”后，需要先导出并过滤评论区；
          // 只有评论区过滤后仍有内容，才转发主消息和评论区。
          if (needCommentProcessing) {
            if (postBlocked && this.config.skipCommentsWhenPostBlocked) {
              this.log(`主消息 ${id} 已被关键词屏蔽，按设置跳过其评论区`, 'warning')
            } else {
              this.progress({ current: index, total: ids.length, id, stage: 'export-comments' })
              await this.exportComments(id, commentsFile)
              const filteredCommentsFile = path.join(this.paths.filtered, `comments_${id}.filtered.json`)
              commentsFilter = filterAndCount(commentsFile, filteredCommentsFile, this.config)
              if (commentsFilter.removed > 0) {
                this.log(`主消息 ${id} 的评论区命中关键词，已屏蔽 ${commentsFilter.removed} 条；关键词：${commentsFilter.hitKeywords.join(' / ')}`, 'warning')
              }
              commentCount = commentsFilter.count
              this.log(`主消息 ${id} 评论区过滤后数量：${commentCount}`, 'info')

              if (this.config.skipPostWhenNoComments && commentCount === 0) {
                skipWholeGroupBecauseNoComments = true
                this.log(`主消息 ${id} 没有评论区或评论区过滤后为空，按设置跳过整组：主消息和评论区都不转发`, 'warning')
              }
            }
          } else if (this.config.skipPostWhenNoComments) {
            skipWholeGroupBecauseNoComments = true
            this.log(`已开启“无评论区时跳过主消息”，但当前未启用评论区处理，跳过主消息 ${id}`, 'warning')
          }

          if (!skipWholeGroupBecauseNoComments) {
            if (postCount > 0 && this.config.forwardMain) {
              this.progress({ current: index, total: ids.length, id, stage: 'forward-post' })
              await this.forwardJson(postFilter.file, `主消息 ${id}`)
            } else if (postFilter.hasKeywordRules && postCount === 0) {
              this.log(`主消息 ${id} 过滤后为空，跳过主消息转发`, 'warning')
            }

            if (needCommentProcessing && commentsFilter && commentCount > 0 && this.config.forwardComments) {
              this.progress({ current: index, total: ids.length, id, stage: 'forward-comments' })
              await this.forwardJson(commentsFilter.file, `主消息 ${id} 的评论区`)
            } else if (needCommentProcessing && commentsFilter && commentCount === 0) {
              this.log(`主消息 ${id} 没有可转发的评论区，跳过评论区转发`, 'info')
            }
          }

          progress.done[idKey] = { id, doneAt: new Date().toISOString() }
          delete progress.failed[idKey]
          this.saveProgress(progress)
          this.progress({ current: index, total: ids.length, id, stage: 'done' })
          if (this.config.delayMs > 0) await sleep(this.config.delayMs)
        } catch (err) {
          progress.failed[idKey] = { id, error: err.message, failedAt: new Date().toISOString() }
          this.saveProgress(progress)
          this.log(`消息 ${id} 处理失败：${err.message}`, 'error')
          this.progress({ current: index, total: ids.length, id, stage: 'failed' })
          if (!this.config.continueOnError) throw err
          if (this.config.delayMs > 0) await sleep(this.config.delayMs)
        }
      }

      this.status('done', { workDir: this.paths.root })
      this.log('全部完成', 'info')
    } catch (err) {
      const state = this.aborted ? 'stopped' : 'error'
      this.status(state, { message: err.message, workDir: this.paths.root })
      this.log(err.message, state === 'stopped' ? 'warning' : 'error')
    }
  }
}

module.exports = { CommentForwardWorker, filterAndCount, extractMessageIds }
