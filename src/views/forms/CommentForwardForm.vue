<script setup>
import { safeDecimal } from '../../../shared/validateJob.mjs'
import AppIcon from '../../components/AppIcon.vue'
import { invalidNumbers } from '../../../shared/specKey.mjs'
import { progressPercent as completedPercent } from '../../taskProgress'
import { useWorkbenchPreview } from '../../composables/useWorkbenchPreview'
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { message, confirmHtml } from '../../ui/naive'
import ChatSelect from '../../components/ChatSelect.vue'
import CommandPreview from '../../components/CommandPreview.vue'
import { appState } from '../../state.js'
import { commandTextForSpec, defaultOutputDir, runJob, updateTaskStatus } from '../../utils'
import { chatId, chatTitle, findChatByValue } from '../../chatCache'
import { getCommentForwardRecords, saveCommentForwardRecord, touchRecentChat } from '../../historyStore'
import { useAppliedRecord, useSelectedChat } from '../../useAppliedRecord'

const sourceChat = ref('')
const targetChat = ref('')
const targetTopicId = ref('')
const startId = ref('')
const endId = ref('')
const mode = ref('direct')
const delayMs = ref(1500)
const workDir = ref('')
const includeComments = ref(true)
const forwardMain = ref(true)
const forwardComments = ref(true)
const exportOnly = ref(false)
const dryRun = ref(true)
const resume = ref(false)
const skipExistingExport = ref(false)
const desc = ref(false)
const continueOnError = ref(true)
const blockKeywordsText = ref('')
const keywordCaseSensitive = ref(false)
const keywordRegexMode = ref(false)
const skipCommentsWhenPostBlocked = ref(true)
const advancedMode = ref(false)
const recentRecords = ref([])
let offProgress = null
let offStatus = null

const selectedSourceChat = ref(null)
const selectedTargetChat = ref(null)
const status = ref('idle')
const currentTaskId = ref('')
const currentWorkDir = ref('')
const progress = ref({ current: 0, total: 0, id: '', stage: '' })
const progressSummary = ref(null)

const targetTopics = computed(() => Array.isArray(selectedTargetChat.value?.topics) ? selectedTargetChat.value.topics : [])
const targetTopicOptions = computed(() => targetTopics.value.map(topic => ({
  label: `${topic.title || topic.id} / ${topic.id}`,
  value: String(topic.id)
})))
const running = computed(() => ['queued','running'].includes(status.value))
const progressPercent = computed(() => completedPercent({},progress.value) ?? 0)

const statusText = computed(() => ({
  idle: '待开始',
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  stopped: '已停止',
  error: '出错'
})[status.value] || status.value)

const stageText = computed(() => ({
  start: '开始处理',
  'export-list': '读取主消息列表',
  rehearsal: '演练检查完成（未逐条导出、未发送、未写断点）',
  skipped: '已跳过',
  'filter-post': '过滤主消息',
  'filter-comments': '过滤评论',
  checkpoint: '保存断点',
  'export-post': '导出主消息',
  'forward-post': '转发主消息',
  'export-comments': '导出评论区',
  'forward-comments': '转发评论区',
  done: '完成',
  failed: '失败'
})[progress.value.stage] || progress.value.stage || '-')

const previewCommand = computed(() => {
  const range = startId.value || endId.value ? `${startId.value || 0},${endId.value || '9223372036854775807'}` : '全部'
  const lines = [
    `# 任务队列，不是一条 tdl 命令`,
    commandTextForSpec({ kind: 'export', chat: sourceChat.value || '<源聊天>', selector: range === '全部' ? null : { type: 'id', input: range }, all: true, withContent: true, output: '<workDir>/posts.json' }),
    `# 然后循环每个消息 ID：`,
    commandTextForSpec({ kind: 'export', chat: sourceChat.value || '<源聊天>', selector: { type: 'id', input: '<id>,<id>' }, all: true, withContent: true, output: '<workDir>/queue/post_<id>.json' }),
    includeComments.value ? commandTextForSpec({ kind: 'export', chat: sourceChat.value || '<源聊天>', reply: '<id>', all: true, withContent: true, output: '<workDir>/comments/comments_<id>.json' }) : '# 未启用评论区处理',
    exportOnly.value ? '# 仅导出，不转发' : commandTextForSpec({ kind: 'forward', from: '<filtered json>', target: targetTopicId.value ? { routerFile: '<workDir>/target_router.txt' } : { peer: targetChat.value || '<目标聊天>' }, mode: mode.value })
  ]
  return (dryRun.value ? [lines[0], lines[1], '# 演练：跳过逐条导出、过滤、转发；不写已完成断点'] : lines).join('\n')
})

function closeAdvanced(event) {
  if (appState.activeView !== 'newTask' || appState.newTaskKind !== 'commentForward' || document.querySelector('[aria-modal="true"]')) return
  if (event.key === 'Escape' && advancedMode.value) {
    advancedMode.value = false
    event.stopPropagation()
  }
}
function getChatLabel(row, fallback) {
  const title = chatTitle(row)
  const id = chatId(row) || fallback
  return title ? `${title}（${id}）` : String(fallback || '')
}

function handleSourceSelect(row) {
  selectedSourceChat.value = row
  if (row) touchRecentChat(row)
}

function handleTargetSelect(row) {
  selectedTargetChat.value = row
  if (row) touchRecentChat(row)
  if (targetTopics.value.length && targetTopicId.value && !targetTopics.value.some(t => String(t.id) === String(targetTopicId.value))) {
    targetTopicId.value = ''
  }
}

function makeRecord() {
  return {
    sourceChat: sourceChat.value,
    targetChat: targetChat.value,
    targetTopicId: targetTopicId.value,
    startId: startId.value,
    endId: endId.value,
    mode: mode.value,
    delayMs: delayMs.value,
    workDir: workDir.value,
    includeComments: includeComments.value,
    forwardMain: forwardMain.value,
    forwardComments: forwardComments.value,
    exportOnly: exportOnly.value,
    dryRun: dryRun.value,
    resume: resume.value,
    skipExistingExport: skipExistingExport.value,
    desc: desc.value,
    continueOnError: continueOnError.value,
    blockKeywordsText: blockKeywordsText.value,
    keywordCaseSensitive: keywordCaseSensitive.value,
    keywordRegexMode: keywordRegexMode.value,
    skipCommentsWhenPostBlocked: skipCommentsWhenPostBlocked.value,
    command: previewCommand.value,
    time: new Date().toLocaleString()
  }
}

function applyRecord(record) {
  sourceChat.value = record.sourceChat || ''
  targetChat.value = record.targetChat || ''
  targetTopicId.value = record.targetTopicId || ''
  startId.value = record.startId || ''
  endId.value = record.endId || ''
  mode.value = record.mode || 'direct'
  delayMs.value = Number(record.delayMs ?? 1500)
  workDir.value = record.workDir || ''
  includeComments.value = record.includeComments !== false
  forwardMain.value = record.forwardMain !== false
  forwardComments.value = record.forwardComments !== false
  exportOnly.value = !!record.exportOnly
  // 演练默认保持开启：套用历史不应该让一次误点直接真发。
  dryRun.value = record.dryRun ?? true
  resume.value = !!record.resume
  skipExistingExport.value = !!record.skipExistingExport
  desc.value = !!record.desc
  continueOnError.value = record.continueOnError !== false
  blockKeywordsText.value = record.blockKeywordsText || ''
  keywordCaseSensitive.value = !!record.keywordCaseSensitive
  keywordRegexMode.value = !!record.keywordRegexMode
  skipCommentsWhenPostBlocked.value = record.skipCommentsWhenPostBlocked !== false
  selectedSourceChat.value = findChatByValue(sourceChat.value, appState.cachedChats || [])
  selectedTargetChat.value = findChatByValue(targetChat.value, appState.cachedChats || [])
  if (record.blockKeywordsText || record.workDir || record.resume) advancedMode.value = true
}

function loadHistory() {
  recentRecords.value = getCommentForwardRecords().slice(0, 6)
}

useAppliedRecord('selectedCommentForwardRecord', applyRecord)

const spec = computed(() => ({
    kind: 'comment-forward',
    sourceChat: sourceChat.value,
    targetChat: targetChat.value,
    targetTopicId: safeDecimal(targetTopicId.value),
    startId: safeDecimal(startId.value),
    endId: safeDecimal(endId.value),
    mode: mode.value,
    delayMs: safeDecimal(delayMs.value, 0),
    workDir: workDir.value,
    includeComments: includeComments.value,
    forwardMain: forwardMain.value,
    forwardComments: forwardComments.value,
    exportOnly: exportOnly.value,
    dryRun: dryRun.value,
    resume: resume.value,
    skipExistingExport: skipExistingExport.value,
    desc: desc.value,
    continueOnError: continueOnError.value,
    blockKeywordsText: blockKeywordsText.value,
    keywordCaseSensitive: keywordCaseSensitive.value,
    keywordRegexMode: keywordRegexMode.value,
    skipCommentsWhenPostBlocked: skipCommentsWhenPostBlocked.value
}))

async function pickWorkDir() {
  const dir = await window.tdlApi.openDirectory({ defaultPath: workDir.value || await defaultOutputDir() })
  if (dir) workDir.value = dir
}

async function openWorkDir() {
  const dir = currentWorkDir.value || workDir.value
  if (!dir) return
  const result = await window.tdlApi.openPath(dir)
  if (result && !result.ok) message.error(result.message || '打开失败')
}

async function loadProgressSummary(targetDir = currentWorkDir.value || workDir.value) {
  if (!targetDir || !window.tdlApi?.readCommentForwardProgress) {
    progressSummary.value = null
    return
  }
  const result = await window.tdlApi.readCommentForwardProgress(targetDir)
  progressSummary.value = result?.ok ? result : null
  if (result?.ok && currentTaskId.value) {
    updateTaskStatus(currentTaskId.value, status.value === 'running' ? '运行中' : status.value === 'done' ? '成功' : status.value === 'stopped' ? '已停止' : status.value === 'error' ? '失败' : '运行中', {
      failedCount: result.failedCount || 0,
      failedIds: result.failedIds || []
    })
  }
}

async function startTask() {
  if(invalidNumbers(spec.value)){message.error('ID、话题和延迟必须是非负安全整数');return}
  if(resume.value&&!workDir.value.trim()){message.error('续跑请选择原工作目录');return}
  if (!sourceChat.value.trim()) {
    message.error('请填写源频道 / 群组')
    return
  }
  if (!exportOnly.value && !dryRun.value && (forwardMain.value || forwardComments.value) && !targetChat.value.trim()) {
    message.error('正式转发时必须填写目标频道 / 群组')
    return
  }

  const sourceLabel = getChatLabel(selectedSourceChat.value || findChatByValue(sourceChat.value, appState.cachedChats || []), sourceChat.value)
  const targetLabel = targetChat.value ? getChatLabel(selectedTargetChat.value || findChatByValue(targetChat.value, appState.cachedChats || []), targetChat.value) : '未填写'
  const keywordCount = blockKeywordsText.value.split(/\r?\n|,|，/).map(x => x.trim()).filter(Boolean).length
  const html = [
    `<p><strong>源：</strong>${sourceLabel}</p>`,
    `<p><strong>目标：</strong>${targetLabel}</p>`,
    `<p><strong>目标话题：</strong>${targetTopicId.value || '未指定'}</p>`,
    `<p><strong>消息范围：</strong>${startId.value || '开始'} - ${endId.value || '结束'}</p>`,
    `<p><strong>处理评论区：</strong>${includeComments.value ? '是' : '否'}</p>`,
    `<p><strong>关键词规则：</strong>${keywordCount ? `${keywordCount} 条` : '未启用'}</p>`,
    `<p><strong>模式：</strong>${dryRun.value ? '演练模式' : (exportOnly.value ? '仅导出' : '正式转发')}</p>`,
    `<p style="color:#d99000">执行顺序是：主消息 → 该消息评论区 → 下一条主消息。</p>`
  ].join('')

  try {
    await confirmHtml(html, '确认评论区顺序转发任务', {
      confirmButtonText: dryRun.value ? '开始演练' : '开始执行',
      cancelButtonText: '取消',
      type: dryRun.value ? 'warning' : 'error',
      dangerouslyUseHTMLString: true
    })
  } catch {
    return
  }

  const taskId = `comment_forward_${Date.now()}`
  currentTaskId.value = taskId
  status.value = window.tdlApi?.nativeRuntime ? 'queued' : 'running'
  progress.value = { current: 0, total: 0, id: '', stage: '' }
  let result
  try { result = await runJob(spec.value, '评论区顺序转发', {
    id: taskId,
    command: previewCommand.value,
    sourceChat: sourceChat.value,
    targetChat: targetChat.value,
    dryRun: dryRun.value
  }) } catch (err) {
    status.value = 'error'
    message.error(`任务启动失败：${err?.message || err}`)
    return
  }
  if (!result?.ok) {
    status.value = 'error'
    updateTaskStatus(taskId, '失败', { errorMessage: result?.message || '任务启动失败' })
    message.error(result?.message || '任务启动失败')
    return
  }
  currentWorkDir.value = result.workDir || ''
  saveCommentForwardRecord({ ...makeRecord(), workDir: result.workDir || workDir.value })
  loadHistory()
  await loadProgressSummary(currentWorkDir.value)
  message.success(result.message || '任务已开始')
}

async function stopTask() {
  const result = await window.tdlApi.stopCommentForward()
  if (result?.ok) message.warning(result.message)
  else message.info(result?.message || '没有正在运行的任务')
}

function fillDemoKeywords() {
  blockKeywordsText.value = ['广告', '推广', '返佣', '二维码'].join('\n')
}

useSelectedChat(row => {
  selectedSourceChat.value = row
  sourceChat.value = String(row.id || row.dialog_id || row.dialogID || row.username || '')
  touchRecentChat(row)
}, 'commentForward')

onMounted(() => {
  window.addEventListener('keydown',closeAdvanced)
  loadHistory()

  // 没有 tdlApi 时（浏览器预览）直接跳过订阅，否则整个页面挂掉。
  if (!window.tdlApi) return

  offProgress = window.tdlApi.onCommentForwardProgress(data => {
    if (currentTaskId.value && data.taskId !== currentTaskId.value) return
    progress.value = { ...progress.value, ...data }
  })
  offStatus = window.tdlApi.onCommentForwardStatus(data => {
    if (currentTaskId.value && data.taskId !== currentTaskId.value) return
    status.value = data.status || status.value
    if (data.workDir) currentWorkDir.value = data.workDir
    if (['done', 'error', 'stopped'].includes(data.status)) {
      loadProgressSummary(data.workDir || currentWorkDir.value)
    }
  })
})

// 原来这两个订阅从不注销，页面每次重建都会多挂一份监听。
onUnmounted(() => {
  window.removeEventListener('keydown',closeAdvanced)
  if (offProgress) offProgress()
  if (offStatus) offStatus()
})
onDeactivated(() => window.removeEventListener('keydown', closeAdvanced))
onActivated(() => window.addEventListener('keydown', closeAdvanced))
const workbench = useWorkbenchPreview(spec, { taskId: currentTaskId, status, progress })
</script>

<template>
  <div class="card comment-task-card">
    <div v-if="currentTaskId" class="comment-live-status" role="status"><span>当前状态：{{statusText}} · {{progress.current||0}} / {{progress.total||0}} · {{stageText}}</span><n-progress :percentage="progressPercent" :stroke-width="4" :show-indicator="false" /></div>
    <n-form label-placement="left" label-width="76px" size="small">
      <section class="form-section"><h2 class="form-section-title">来源与目标</h2>
        <n-form-item label="源对话"><ChatSelect v-model="sourceChat" placeholder="选择或输入 @source / ID" button-text="更新" @select="handleSourceSelect" /></n-form-item>
        <n-form-item label="目标对话"><ChatSelect v-model="targetChat" placeholder="选择或输入 @target / ID" button-text="更新" @select="handleTargetSelect" /></n-form-item>
      </section>
      <section class="form-section"><h2 class="form-section-title">消息范围</h2>
        <n-form-item label="起始 ID"><n-input v-model:value="startId" placeholder="留空 = 从头" /></n-form-item>
        <n-form-item label="结束 ID"><n-input v-model:value="endId" placeholder="留空 = 到末尾" /></n-form-item>
      </section>
      <div class="compact-checks">
        <n-checkbox v-model:checked="dryRun">演练模式</n-checkbox><n-checkbox v-model:checked="resume">断点续跑</n-checkbox><n-checkbox v-model:checked="includeComments">包含评论区</n-checkbox><n-checkbox v-model:checked="forwardMain">转发主消息</n-checkbox><n-checkbox v-model:checked="forwardComments">转发评论区</n-checkbox>
      </div>
      <button type="button" class="adv-toggle" :aria-expanded="advancedMode" @click="advancedMode=!advancedMode"><span class="adv-chev" :class="{open:advancedMode}"><AppIcon name="chevron" :size="12" /></span>高级选项<span class="advanced-hint">过滤、话题、延迟…</span></button>
      <section v-if="advancedMode" class="comment-advanced">
        <n-form-item label="话题 ID"><n-select v-if="targetTopics.length" v-model:value="targetTopicId" filterable tag clearable :options="targetTopicOptions" placeholder="选择话题或输入 ID" /><n-input v-else v-model:value="targetTopicId" placeholder="留空 = 默认聊天" /></n-form-item>
        <n-form-item label="模式"><n-radio-group v-model:value="mode"><n-radio-button value="direct">direct</n-radio-button><n-radio-button value="clone">clone</n-radio-button></n-radio-group></n-form-item>
        <n-form-item label="延迟"><div class="inline-field"><n-input-number v-model:value="delayMs" :min="0" :step="500" style="width:120px" /><span class="mini-muted">ms · 每组消息的处理间隔</span></div></n-form-item>
        <n-form-item label="屏蔽词"><n-input v-model:value="blockKeywordsText" type="textarea" :rows="3" placeholder="广告, 推广, 加群；也可一行一个" /></n-form-item>
        <div class="compact-checks advanced-checks"><n-checkbox v-model:checked="continueOnError">失败后继续</n-checkbox><n-checkbox v-model:checked="exportOnly">仅导出不转发</n-checkbox><n-checkbox v-model:checked="skipCommentsWhenPostBlocked">屏蔽主消息时跳过评论</n-checkbox><n-checkbox v-model:checked="skipExistingExport">已有缓存 JSON 跳过导出</n-checkbox><n-checkbox v-model:checked="desc">倒序处理</n-checkbox><n-checkbox v-model:checked="keywordCaseSensitive">区分大小写</n-checkbox><n-checkbox v-model:checked="keywordRegexMode">按正则匹配</n-checkbox></div>
        <n-form-item label="工作目录"><div class="inline-field grow"><n-input v-model:value="workDir" placeholder="留空自动生成；续跑请选择原目录" /><n-button @click="pickWorkDir">选择</n-button></div></n-form-item>
        <button type="button" class="btn sm ghost" @click="fillDemoKeywords">填入示例关键词</button>
      </section>
    </n-form>
    <CommandPreview :command="previewCommand" />
    <div v-if="dryRun" class="mode-explanation">演练会读取主消息列表，但不逐条导出、不发送，也不写已完成断点。</div>
    <div v-else-if="exportOnly" class="mode-explanation">仅导出：读取并过滤主消息与评论，保存到本地，不发送。</div>
    <div class="form-actions"><n-button type="primary" :disabled="running" @click="startTask">{{running?'处理中…':dryRun?'开始演练':'运行'}}</n-button><n-button :disabled="!running" @click="stopTask">停止</n-button><span class="flex-sp" /><n-button size="tiny" quaternary :disabled="!currentWorkDir&&!workDir" @click="openWorkDir">打开缓存</n-button><n-button size="tiny" quaternary :disabled="!currentWorkDir&&!workDir" @click="loadProgressSummary()">失败记录</n-button><button v-if="workbench" class="btn sm ghost" @click="workbench.plan()">存为计划</button></div>
  </div>
  <div v-if="progressSummary" class="card">
    <div class="card-title">失败记录</div>
    <div class="mini-muted">
      已完成 {{ progressSummary.doneCount || 0 }} 条；失败 {{ progressSummary.failedCount || 0 }} 条；更新时间 {{ progressSummary.updatedAt || '-' }}
    </div>
    <div style="height:12px"></div>
    <n-alert
      v-if="progressSummary.failedCount"
      type="warning"
      :show-icon="true"
      :closable="false"
      :title="`失败消息 ID：${progressSummary.failedIds.join(', ')}`"
    />
    <div v-else class="empty-cell">当前没有失败记录</div>
  </div>

  <div class="card" v-if="recentRecords.length">
    <div class="card-title">最近的评论区转发</div>
    <div class="mini-muted" style="margin-bottom:10px">套用会恢复全部参数，但演练模式一律重新打开，避免误发。</div>
    <ul class="chat-list">
      <li v-for="row in recentRecords" :key="row.id" class="chat-card">
        <div class="chat-main">
          <div class="chat-line">
            <span class="chat-name">{{ row.sourceChat }} → {{ row.targetChat || '未填目标' }}</span>
            <span v-if="row.targetTopicId" class="chat-topics">话题 {{ row.targetTopicId }}</span>
          </div>
          <div class="chat-line chat-sub">
            <span>{{ row.time }}</span>
            <span class="chat-stat">范围 {{ row.startId || '起' }} - {{ row.endId || '止' }}</span>
            <span v-if="row.blockKeywordsText" class="chat-stat">有关键词规则</span>
            <span v-if="row.exportOnly" class="chat-stat">仅导出</span>
          </div>
        </div>
        <div class="chat-actions">
          <n-button size="small" type="primary" secondary @click="applyRecord(row)">套用</n-button>
        </div>
      </li>
    </ul>
  </div>

  <div class="card" v-if="advancedMode">
    <div class="card-title">输出结构</div>
    <div class="command-preview">comment-forward/时间戳/
  posts.json
  target_router.txt              # 目标话题转发时自动生成，避免 Windows 引号问题
  progress.json
  queue/post_2313.json
  comments/comments_2313.json
  filtered/post_2313.filtered.json
  filtered/comments_2313.filtered.json</div>
  </div>
</template>

<style scoped>
.comment-forward-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
</style>
