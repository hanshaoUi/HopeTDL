<script setup>
import { computed, onMounted, ref } from 'vue'
import { message, confirmHtml } from '../ui/naive'
import ChatSelect from '../components/ChatSelect.vue'
import CommandPreview from '../components/CommandPreview.vue'
import { appState } from '../state.js'
import { commandText, createTask, updateTaskStatus } from '../utils'
import { chatId, chatTitle, findChatByValue } from '../chatCache'
import { touchRecentChat } from '../historyStore'

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

const selectedSourceChat = ref(null)
const selectedTargetChat = ref(null)
const status = ref('idle')
const currentTaskId = ref('')
const currentWorkDir = ref('')
const progress = ref({ current: 0, total: 0, id: '', stage: '' })

const targetTopics = computed(() => Array.isArray(selectedTargetChat.value?.topics) ? selectedTargetChat.value.topics : [])
const targetTopicOptions = computed(() => targetTopics.value.map(topic => ({
  label: `${topic.title || topic.id} / ${topic.id}`,
  value: String(topic.id)
})))
const running = computed(() => status.value === 'running')
const progressPercent = computed(() => progress.value.total ? Math.round((progress.value.current / progress.value.total) * 100) : 0)

const statusText = computed(() => ({
  idle: '待开始',
  running: '运行中',
  done: '已完成',
  stopped: '已停止',
  error: '出错'
})[status.value] || status.value)

const stageText = computed(() => ({
  start: '开始处理',
  skipped: '已跳过',
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
    commandText(['chat', 'export', '-c', sourceChat.value || '<源聊天>', ...(range === '全部' ? [] : ['-T', 'id', '-i', range]), '--all', '--with-content', '-o', '<workDir>/posts.json']),
    `# 然后循环每个消息 ID：`,
    commandText(['chat', 'export', '-c', sourceChat.value || '<源聊天>', '-T', 'id', '-i', '<id>,<id>', '--all', '--with-content', '-o', '<workDir>/queue/post_<id>.json']),
    includeComments.value ? commandText(['chat', 'export', '-c', sourceChat.value || '<源聊天>', '--reply', '<id>', '--all', '--with-content', '-o', '<workDir>/comments/comments_<id>.json']) : '# 未启用评论区处理',
    exportOnly.value ? '# 仅导出，不转发' : commandText(['forward', '--from', '<filtered json>', '--to', targetTopicId.value ? '<workDir>/target_router.txt' : (targetChat.value || '<目标聊天>'), '--mode', mode.value])
  ]
  return lines.join('\n')
})

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

function buildPayload() {
  return {
    taskId: currentTaskId.value,
    sourceChat: sourceChat.value,
    targetChat: targetChat.value,
    targetTopicId: targetTopicId.value ? Number(targetTopicId.value) : null,
    startId: startId.value ? Number(startId.value) : null,
    endId: endId.value ? Number(endId.value) : null,
    mode: mode.value,
    delayMs: Number(delayMs.value || 0),
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
  }
}

async function pickWorkDir() {
  const dir = await window.tdlApi.openDirectory({ defaultPath: workDir.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (dir) workDir.value = dir
}

async function openWorkDir() {
  const dir = currentWorkDir.value || workDir.value
  if (!dir) return
  const result = await window.tdlApi.openPath(dir)
  if (result && !result.ok) message.error(result.message || '打开失败')
}

async function startTask() {
  if (!sourceChat.value) {
    message.error('请填写源频道 / 群组')
    return
  }
  if (!exportOnly.value && !dryRun.value && (forwardMain.value || forwardComments.value) && !targetChat.value) {
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
  status.value = 'running'
  progress.value = { current: 0, total: 0, id: '', stage: '' }
  createTask('comment-forward', [], '评论区顺序转发', {
    id: taskId,
    command: previewCommand.value,
    sourceChat: sourceChat.value,
    targetChat: targetChat.value,
    dryRun: dryRun.value
  })

  const result = await window.tdlApi.startCommentForward(buildPayload())
  if (!result?.ok) {
    status.value = 'error'
    updateTaskStatus(taskId, '失败', { errorMessage: result?.message || '任务启动失败' })
    message.error(result?.message || '任务启动失败')
    return
  }
  currentWorkDir.value = result.workDir || ''
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

onMounted(() => {
  if (appState.selectedChat) {
    const row = appState.selectedChat
    selectedSourceChat.value = row
    const id = row.id || row.dialog_id || row.dialogID || ''
    sourceChat.value = String(id || row.username || '')
    touchRecentChat(row)
  }

  window.tdlApi.onCommentForwardProgress(data => {
    if (currentTaskId.value && data.taskId !== currentTaskId.value) return
    progress.value = { ...progress.value, ...data }
  })
  window.tdlApi.onCommentForwardStatus(data => {
    if (currentTaskId.value && data.taskId !== currentTaskId.value) return
    status.value = data.status || status.value
    if (data.workDir) currentWorkDir.value = data.workDir
  })
})
</script>

<template>
  <h1 class="page-title">评论区顺序转发</h1>
  <p class="page-desc">把频道主消息和每条消息下的评论区按顺序导出 / 转发：主消息 1 → 评论区 1 → 主消息 2 → 评论区 2。</p>

  <div class="card">
    <div class="comment-forward-head">
      <div>
        <div class="card-title">任务参数</div>
        <div class="mini-muted">当前状态：{{ statusText }}；进度：{{ progress.current || 0 }} / {{ progress.total || 0 }}；阶段：{{ stageText }}</div>
      </div>
      <n-progress :percentage="progressPercent" :stroke-width="12" style="width:260px" />
    </div>

    <n-form label-width="130px">
      <n-form-item label="源频道 / 群组">
        <ChatSelect
          v-model="sourceChat"
          placeholder="从对话列表选择，或手动输入 @source / ID"
          button-text="更新缓存"
          @select="handleSourceSelect"
        />
      </n-form-item>

      <div class="grid-2">
        <n-form-item label="起始消息 ID">
          <n-input v-model:value="startId" placeholder="可空，例如 2313" />
        </n-form-item>
        <n-form-item label="结束消息 ID">
          <n-input v-model:value="endId" placeholder="可空，例如 2500；只测单条就和起始相同" />
        </n-form-item>
      </div>

      <div class="grid-2">
        <n-form-item label="目标 Peer">
          <ChatSelect
            v-model="targetChat"
            placeholder="从对话列表选择目标，或手动输入 @target / ID"
            button-text="更新缓存"
            @select="handleTargetSelect"
          />
        </n-form-item>
        <n-form-item label="目标话题 ID">
          <n-select
            v-if="targetTopics.length"
            v-model:value="targetTopicId"
            filterable
            tag
            default-first-option
            clearable
            :options="targetTopicOptions"
            placeholder="从该聊天的话题中选择，或手动输入"
            style="width:100%"
          />
          <n-input v-else v-model:value="targetTopicId" placeholder="可空，例如 68549" />
        </n-form-item>
      </div>

      <div class="grid-2">
        <n-form-item label="转发模式">
          <n-radio-group v-model:value="mode">
            <n-radio-button value="direct">direct</n-radio-button>
            <n-radio-button value="clone">clone</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="每条间隔 ms">
          <n-input-number v-model:value="delayMs" :min="0" :max="60000" :step="500" />
        </n-form-item>
      </div>

      <n-form-item label="基础选项">
        <n-checkbox v-model:checked="includeComments">处理评论区</n-checkbox>
        <n-checkbox v-model:checked="forwardMain">转发主消息</n-checkbox>
        <n-checkbox v-model:checked="forwardComments">转发评论区</n-checkbox>
        <n-checkbox v-model:checked="exportOnly">仅导出不转发</n-checkbox>
        <n-checkbox v-model:checked="dryRun">演练模式</n-checkbox>
      </n-form-item>

      <div class="advanced-toggle">
        <n-button size="small" secondary @click="advancedMode = !advancedMode">
          {{ advancedMode ? '收起高级选项' : '展开高级选项' }}
        </n-button>
        <span class="mini-muted">关键词、续跑、缓存目录和失败处理都在高级选项里。</span>
      </div>

      <template v-if="advancedMode">
      <n-form-item label="工作目录">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="workDir" placeholder="可空，默认在设置的输出目录下生成 comment-forward/时间戳" style="flex:1" />
          <n-button @click="pickWorkDir">选择</n-button>
          <n-button :disabled="!currentWorkDir && !workDir" @click="openWorkDir">打开</n-button>
        </div>
      </n-form-item>

      <n-form-item label="屏蔽关键词">
        <div style="width:100%">
          <n-input
            v-model:value="blockKeywordsText"
            type="textarea"
            :rows="5"
            placeholder="一行一个关键词，例如：\n广告\n推广\n返佣"
          />
          <div class="action-row" style="margin-top:8px">
            <n-button size="small" @click="fillDemoKeywords">填入示例</n-button>
            <span class="mini-muted">命中关键词的主消息 / 评论会从 filtered JSON 中删除后再转发。</span>
          </div>
        </div>
      </n-form-item>

      <n-form-item label="安全 / 续跑">
        <n-checkbox v-model:checked="resume">读取 progress.json 续跑</n-checkbox>
        <n-checkbox v-model:checked="skipExistingExport">已有缓存 JSON 跳过导出</n-checkbox>
        <n-checkbox v-model:checked="continueOnError">单条失败后继续</n-checkbox>
        <n-checkbox v-model:checked="desc">倒序处理</n-checkbox>
      </n-form-item>

      <n-form-item label="关键词选项">
        <n-checkbox v-model:checked="skipCommentsWhenPostBlocked">主消息命中时跳过评论区</n-checkbox>
        <n-checkbox v-model:checked="keywordCaseSensitive">区分大小写</n-checkbox>
        <n-checkbox v-model:checked="keywordRegexMode">按正则匹配</n-checkbox>
      </n-form-item>
      </template>
    </n-form>

    <CommandPreview :command="previewCommand" />
    <div style="height:16px"></div>
    <n-alert v-if="dryRun" type="warning"  :show-icon="true" :closable="false" title="当前是演练模式：会真实导出主消息列表用于识别 ID，但不会逐条导出 / 转发。要测试过滤结果，可取消演练并勾选“仅导出不转发”。" />
    <div style="height:16px"></div>
    <div class="action-row">
      <n-button type="primary" :disabled="running" @click="startTask">{{ running ? '运行中...' : '开始任务' }}</n-button>
      <n-button type="error" :disabled="!running" @click="stopTask">停止</n-button>
      <n-button :disabled="!currentWorkDir && !workDir" @click="openWorkDir">打开缓存目录</n-button>
    </div>
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
