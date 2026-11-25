<script setup>
import { validateJob } from '../../../shared/validateJob.mjs'
import { useWorkbenchPreview } from '../../composables/useWorkbenchPreview'
import { ref, computed, onMounted } from 'vue'
import { commandTextForSpec, defaultOutputDir, runJob } from '../../utils'
import CommandPreview from '../../components/CommandPreview.vue'
import ChatSelect from '../../components/ChatSelect.vue'
import { appState } from '../../state.js'
import { message, confirmHtml } from '../../ui/naive'
import { chatId, chatTitle, findChatByValue } from '../../chatCache'
import { saveForwardRecord, touchRecentChat } from '../../historyStore'
import { useAppliedRecord, useSelectedChat } from '../../useAppliedRecord'
const sourceType = ref('file')
const from = ref('')
const peer = ref('')
const thread = ref('')
const mode = ref('clone')
const dryRun = ref(true)
const silent = ref(false)
const single = ref(false)
const desc = ref(false)
const edit = ref('')
const selectedTargetChat = ref(null)

function getTopics(row) {
  return Array.isArray(row?.topics) ? row.topics : []
}

const targetTopics = computed(() => getTopics(selectedTargetChat.value))
const targetTopicOptions = computed(() => targetTopics.value.map(topic => ({
  label: `${topic.title || topic.id} / ${topic.id}`,
  value: String(topic.id)
})))

function handleTargetSelect(row) {
  selectedTargetChat.value = row
  if (row) touchRecentChat(row)
  if (!row) return
  // 选择新聊天时，如果新聊天没有当前话题，则清空话题，避免误发到旧话题。
  if (targetTopics.value.length && thread.value && !targetTopics.value.some(t => String(t.id) === String(thread.value))) {
    thread.value = ''
  }
}

function joinPath(dir, fileName) {
  if (!dir) return fileName
  const clean = String(dir).replace(/[\\/]+$/, '')
  const sep = clean.includes('\\') ? '\\' : '/'
  return `${clean}${sep}${fileName}`
}

async function defaultJsonFile() {
  const dir = await defaultOutputDir()
  return joinPath(dir, 'messages.json')
}

async function pickFile() {
  const f = await window.tdlApi.openFile({ defaultPath: from.value || await defaultJsonFile(), filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All', extensions: ['*'] }] })
  if (f) from.value = f
}

// 如果从对话列表中点击“转发”，自动填充目标
function applyRecord(record) {
  sourceType.value = record.sourceType || 'file'
  from.value = record.from || ''
  peer.value = record.peer || record.to || ''
  thread.value = record.thread || ''
  mode.value = record.mode || 'clone'
  dryRun.value = record.dryRun ?? true
  silent.value = record.silent ?? false
  single.value = record.single ?? false
  desc.value = record.desc ?? false
  edit.value = record.edit || ''
  selectedTargetChat.value = findChatByValue(peer.value, appState.cachedChats || [])
}

useAppliedRecord('selectedForwardRecord', applyRecord)
useSelectedChat(row => {
  selectedTargetChat.value = row
  touchRecentChat(row)
  peer.value = String(row.id || row.dialog_id || row.dialogID || row.username || '')
}, 'forward')

onMounted(async () => {
  if (!from.value && sourceType.value === 'file') from.value = await defaultJsonFile()
})
const spec = computed(() => ({
  kind: 'forward',
  from: from.value,
  target: { peer: peer.value, thread: thread.value || null },
  mode: mode.value,
  dryRun: dryRun.value,
  silent: silent.value,
  single: single.value,
  desc: desc.value,
  edit: edit.value
}))
function targetLabel() {
  const row = selectedTargetChat.value || findChatByValue(peer.value, appState.cachedChats || [])
  const title = chatTitle(row)
  const id = chatId(row) || peer.value
  return title ? `${title}（${id}）` : String(peer.value || '')
}

function threadLabel() {
  if (!thread.value) return '未指定'
  const topic = targetTopics.value.find(item => String(item.id) === String(thread.value))
  return topic ? `${topic.title || topic.id}（${topic.id}）` : String(thread.value)
}

async function analyzeSourceCount() {
  if (sourceType.value !== 'file' || !from.value) return ''
  try {
    const result = await window.tdlApi.analyzeExportFile(from.value)
    if (result?.ok) return `${result.count} 条（ID ${result.minId} - ${result.maxId}）`
  } catch {}
  return '无法识别，按 tdl 实际处理为准'
}

function makeRecord(extra = {}) {
  return {
    sourceType: sourceType.value,
    from: from.value,
    peer: peer.value,
    targetLabel: targetLabel(),
    thread: thread.value,
    threadLabel: threadLabel(),
    mode: mode.value,
    dryRun: dryRun.value,
    silent: silent.value,
    single: single.value,
    desc: desc.value,
    edit: edit.value,
    command: commandTextForSpec(spec.value),
    time: new Date().toLocaleString(),
    ...extra
  }
}

async function run() {
  try { validateJob(spec.value) } catch(error) { message.error(error.message); return }
  if (!from.value || !peer.value) {
    message.error('请先填写来源和目标 Peer')
    return
  }
  const countText = await analyzeSourceCount()
  const html = [
    `<p><strong>来源：</strong>${from.value}</p>`,
    `<p><strong>目标聊天：</strong>${targetLabel()}</p>`,
    `<p><strong>目标话题：</strong>${threadLabel()}</p>`,
    `<p><strong>模式：</strong>${mode.value}</p>`,
    `<p><strong>Dry Run：</strong>${dryRun.value ? '是，仅演练' : '否，会实际发送'}</p>`,
    countText ? `<p><strong>来源消息：</strong>${countText}</p>` : '',
    `<p style="color:#d99000">请确认目标聊天和话题无误后再继续。</p>`
  ].join('')
  try {
    await confirmHtml(html, '确认转发预览', {
      confirmButtonText: dryRun.value ? '开始演练' : '确认转发',
      cancelButtonText: '取消',
      type: dryRun.value ? 'warning' : 'error',
      dangerouslyUseHTMLString: true
    })
  } catch {
    return
  }
  const record = saveForwardRecord(makeRecord({ estimatedMessages: countText }))
  const row = selectedTargetChat.value || findChatByValue(peer.value, appState.cachedChats || [])
  if (row) touchRecentChat(row)
  await runJob(spec.value, '转发消息')
  message.success('已记录本次转发参数')
}

useWorkbenchPreview(spec)
</script>
<template>
  <div class="card">
    <n-form label-width="120px">
      <n-form-item label="来源类型"><n-radio-group v-model:value="sourceType"><n-radio-button value="file">JSON 文件</n-radio-button><n-radio-button value="url">消息链接</n-radio-button></n-radio-group></n-form-item>
      <!-- Wrap the input and optional button in a flex container for better spacing -->
      <n-form-item label="来源">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="from" placeholder="messages.json 绝对路径，或 https://t.me/xxx/123" style="flex:1" />
          <!-- Only show the button for file source type -->
          <n-button v-if="sourceType==='file'" @click="pickFile">选择</n-button>
        </div>
      </n-form-item>
      <div class="grid-2">
        <n-form-item label="目标对话">
          <ChatSelect
            v-model="peer"
            placeholder="从对话列表选择目标，或手动输入 @channel / ID"
            button-text="更新缓存"
            @select="handleTargetSelect"
          />
        </n-form-item>
        <n-form-item label="目标话题">
          <n-select
            v-if="targetTopics.length"
            v-model:value="thread"
            filterable
            tag
            default-first-option
            clearable
            :options="targetTopicOptions"
            placeholder="从该聊天的话题中选择，或手动输入"
            style="width:100%"
          />
          <n-input v-else v-model:value="thread" placeholder="可选，例如 65054" />
        </n-form-item>
      </div>
      <n-form-item label="模式"><n-radio-group v-model:value="mode"><n-radio-button value="direct">direct 保留来源</n-radio-button><n-radio-button value="clone">clone 复制发送</n-radio-button></n-radio-group></n-form-item>
      <n-form-item label="选项"><n-checkbox v-model:checked="dryRun">演练模式，不真正发送</n-checkbox><n-checkbox v-model:checked="silent">静默</n-checkbox><n-checkbox v-model:checked="single">单条</n-checkbox><n-checkbox v-model:checked="desc">倒序</n-checkbox></n-form-item>
      <n-form-item label="内容改写"><n-input v-model:value="edit" placeholder='例如 Message.Message + "\n整理自频道"' /></n-form-item>
    </n-form>
    <CommandPreview :command="commandTextForSpec(spec)" />
    <div style="height:16px"></div>
    <n-alert v-if="dryRun" type="warning"  :show-icon="true" :closable="false" title="当前是 dry-run，只演练不真正发送。正式转发前取消勾选。" />
    <div style="height:16px"></div>
    <n-button type="primary" @click="run">开始转发</n-button>
  </div>
</template>
