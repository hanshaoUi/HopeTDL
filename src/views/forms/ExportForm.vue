<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { confirmHtml, message } from '../../ui/naive'
import { commandTextForSpec, defaultOutputDir, runJob, runJobAndWait } from '../../utils'
import CommandPreview from '../../components/CommandPreview.vue'
import ChatSelect from '../../components/ChatSelect.vue'
import { appState } from '../../state.js'
import { chatId as getChatId, chatTitle as getChatTitle, findChatByValue } from '../../chatCache'
import { readJson, saveForwardRecord, touchRecentChat, writeJson } from '../../historyStore'
import { useAppliedRecord } from '../../useAppliedRecord'

const chat = ref('')
const type = ref('id')
const input = ref('')
const all = ref(true)
const raw = ref(false)
const output = ref('')
const selectedSourceChat = ref(null)
const pendingExportTaskId = ref('')
const pendingExportRecord = ref(null)
const autoOutput = ref(true)
const autoForward = ref(false)
const forwardPeer = ref('')
const forwardThread = ref('')
const forwardMode = ref('clone')
const forwardDryRun = ref(true)
const selectedForwardChat = ref(null)
let offDone = null
const typeOptions = [
  { label: '按消息 ID', value: 'id' },
  { label: '最近 N 条', value: 'last' },
  { label: '全部', value: 'all' }
]

const HISTORY_KEY = 'hopetdl.export.memory.v1'
const exportMemory = ref({ last: null, chats: {}, records: [] })

const nsKey = computed(() => String(appState.config?.ns || 'default'))
const chatKey = computed(() => String(chat.value || '').trim())
const chatLastRecord = computed(() => chatKey.value ? getChatMemory(chatKey.value) : null)
const recentRecords = computed(() => exportMemory.value.records?.slice(0, 8) || [])
const forwardTopics = computed(() => Array.isArray(selectedForwardChat.value?.topics) ? selectedForwardChat.value.topics : [])
const forwardTopicOptions = computed(() => forwardTopics.value.map(topic => ({
  label: `${topic.title || topic.id} / ${topic.id}`,
  value: String(topic.id)
})))

function normalizeChatKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // 兼容 tdl / Telegram 中同一个群有时显示为 174xxx、有时显示为 -174xxx 的情况。
  // 不处理 @username，只对数字 ID 做符号归一。
  if (raw.startsWith('@')) return raw.toLowerCase()
  return raw.replace(/^-/, '')
}

function chatKeyCandidates(value) {
  const raw = String(value || '').trim()
  const normalized = normalizeChatKey(raw)
  const list = [raw]
  if (normalized && normalized !== raw) list.push(normalized)
  if (normalized && !normalized.startsWith('@')) {
    list.push('-' + normalized)
    list.push('-100' + normalized)
  }
  return Array.from(new Set(list.filter(Boolean)))
}

function getChatMemory(value) {
  const chats = exportMemory.value.chats || {}
  for (const key of chatKeyCandidates(value)) {
    if (chats[key]) return chats[key]
  }

  // 如果 chats 索引里没有，继续从最近记录里倒查，避免旧版本/误操作覆盖导致找不到。
  const normalized = normalizeChatKey(value)
  const records = exportMemory.value.records || []
  return records.find(item =>
    normalizeChatKey(item.chat) === normalized &&
    (item.input || item.type === 'all')
  ) || null
}

function requiresInput() {
  // 最近 N 条必须填写 -i；按消息 ID 可以留空执行全量导出，完成后会自动从导出 JSON 里分析最大消息 ID，生成下一次的 -i。
  return type.value === 'last'
}

function canAutoAnalyzeNextInput() {
  return type.value === 'id' && !String(input.value || '').trim()
}

function joinPath(dir, fileName) {
  if (!dir) return fileName
  const clean = String(dir).replace(/[\\/]+$/, '')
  const sep = clean.includes('\\') ? '\\' : '/'
  return `${clean}${sep}${fileName}`
}

function safeName(value, fallback = 'chat') {
  const text = String(value || fallback).trim() || fallback
  return text.replace(/[\\/:*?"<>|#%{}~&]/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

function timestampForFile() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function inputToken() {
  const val = String(input.value || '').trim()
  if (!val) return type.value === 'id' ? 'full' : 'none'
  return val.replace(/9223372036854775807/g, 'latest').replace(/[,\s]+/g, '-').replace(/[^0-9a-zA-Z_@.-]/g, '_')
}

function sourceChatRow() {
  return selectedSourceChat.value || findChatByValue(chat.value, appState.cachedChats || [])
}

async function defaultOutputFile() {
  const baseDir = await defaultOutputDir()
  const row = sourceChatRow()
  const title = getChatTitle(row) || chat.value || 'chat'
  const id = getChatId(row) || chat.value || 'unknown'
  const folder = safeName(`${title}_${id}`)
  const name = `export_${safeName(type.value)}_${safeName(inputToken())}_${timestampForFile()}.json`
  return joinPath(joinPath(baseDir, folder), name)
}

async function updateSmartOutput({ force = false } = {}) {
  if (!force && !autoOutput.value) return
  output.value = await defaultOutputFile()
}

function handleSourceSelect(row) {
  selectedSourceChat.value = row
  if (row) touchRecentChat(row)
  const id = row?.id || row?.dialog_id || row?.dialogID || ''
  if (id) {
    const remembered = getChatMemory(String(id))
    if (remembered) applyRecord(remembered, 'chat-id')
  }
  autoOutput.value = true
  updateSmartOutput({ force: true })
}

function handleForwardTargetSelect(row) {
  selectedForwardChat.value = row
  if (row) touchRecentChat(row)
  if (forwardThread.value && !forwardTopics.value.some(topic => String(topic.id) === String(forwardThread.value))) {
    forwardThread.value = ''
  }
}


// 走 historyStore 的统一读写：那里有解析缓存，
// 直接操作 localStorage 会让 Chats.vue 等页面读到过期的导出记忆。
function readAllMemory() {
  return readJson(HISTORY_KEY, {})
}

function writeAllMemory(memory) {
  try {
    writeJson(HISTORY_KEY, memory)
  } catch (err) {
    message.error('保存导出记录失败')
  }
}

function copyText(text, successText = '已复制') {
  navigator.clipboard.writeText(String(text || '')).then(() => message.success(successText))
}

function loadMemory() {
  const allMemory = readAllMemory()
  const ns = nsKey.value
  exportMemory.value = allMemory[ns] || { last: null, chats: {}, records: [] }
}

function makeRecord(extra = {}) {
  const usedInput = String(input.value || '').trim()
  return {
    chat: String(chat.value || '').trim(),
    type: type.value,
    // input 表示下一次建议使用的 -i；如果本次填写了 -i，默认先等于本次值，导出完成后会根据输出文件更新成下一次范围。
    input: usedInput,
    usedInput,
    all: all.value,
    raw: raw.value,
    output: output.value,
    ns: nsKey.value,
    time: new Date().toLocaleString(),
    command: commandTextForSpec(spec.value),
    ...extra
  }
}

function saveMemory(record = makeRecord()) {
  const allMemory = readAllMemory()
  const ns = nsKey.value
  const current = allMemory[ns] || { last: null, chats: {}, records: [] }
  current.last = record

  // type=id / last 时，如果 -i 为空，不覆盖该聊天已有的有效记录。
  // 这能避免一次误操作把上次的 1213,1500 之类的输入值冲掉。
  const canSaveChatIndex = record.chat && (record.input || record.type === 'all')
  if (canSaveChatIndex) {
    for (const key of chatKeyCandidates(record.chat)) {
      current.chats[key] = record
    }
  }

  const records = current.records || []
  const duplicated = records.findIndex(item =>
    item.chat === record.chat &&
    item.type === record.type &&
    item.input === record.input &&
    item.output === record.output
  )
  if (duplicated >= 0) records.splice(duplicated, 1)
  current.records = [record, ...records].slice(0, 30)

  allMemory[ns] = current
  writeAllMemory(allMemory)
  exportMemory.value = current
}

function applyRecord(record, mode = 'all') {
  if (!record) return
  if (mode === 'all') {
    chat.value = record.chat || ''
    type.value = record.type || 'id'
    input.value = record.input || ''
    all.value = record.all ?? true
    raw.value = record.raw ?? false
    output.value = record.output || ''
  }
  if (mode === 'chat-id') {
    // 只读取该聊天上次的 -i，避免覆盖你当前的 -c
    type.value = record.type || 'id'
    input.value = record.input || ''
    all.value = record.all ?? true
    raw.value = record.raw ?? false
    if (!output.value) output.value = record.output || ''
  }
}

function useLastExport() {
  if (!exportMemory.value.last) {
    message.info('还没有上次导出记录')
    return
  }
  applyRecord(exportMemory.value.last, 'all')
  autoOutput.value = true
  updateSmartOutput({ force: true })
  message.success('已读取上次的 -c 和 -i')
}

function useChatLastInput() {
  if (!chatLastRecord.value) {
    message.info('当前聊天还没有历史 -i 记录')
    return
  }
  applyRecord(chatLastRecord.value, 'chat-id')
  autoOutput.value = true
  updateSmartOutput({ force: true })
  message.success('已读取当前聊天对应的上次 -i')
}


function applyRecordAndSmart(record, mode = 'all') {
  applyRecord(record, mode)
  autoOutput.value = true
  updateSmartOutput({ force: true })
}

function applyAnalyzeResultToRecord(record, analysis) {
  if (!record) return null
  if (!analysis?.ok) return record
  const next = {
    ...record,
    exportedCount: analysis.count,
    minId: analysis.minId,
    maxId: analysis.maxId,
    nextStartId: analysis.nextStartId,
    nextInput: analysis.nextInput,
    // 保存为下一次建议使用的 -i。下次读取该聊天时，就会自动填入 maxId+1 到最大值。
    input: analysis.nextInput,
    analyzedAt: new Date().toLocaleString()
  }
  next.command = commandTextForSpec({
    kind: 'export',
    chat: next.chat,
    selector: { type: next.type || 'id', input: next.input },
    all: next.all,
    raw: next.raw,
    output: next.output
  })
  return next
}

async function finalizeExportMemory(record) {
  if (!record?.output) {
    saveMemory(record)
    return
  }
  const analysis = await window.tdlApi.analyzeExportFile(record.output)
  if (analysis?.ok) {
    const nextRecord = applyAnalyzeResultToRecord(record, analysis)
    saveMemory(nextRecord)
    input.value = nextRecord.input || ''
    message.success(`已从导出文件识别最大消息 ID：${analysis.maxId}，下次建议 -i：${analysis.nextInput}`)
  } else {
    saveMemory(record)
    message.warning(`导出完成，但未能自动识别下一次 -i：${analysis?.reason || '未知原因'}`)
  }
}

async function pickOutput() {
  const f = await window.tdlApi.saveFile({ defaultPath: output.value || await defaultOutputFile(), filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (f) { output.value = f; autoOutput.value = false }
}

// 如果从对话列表中点击“导出”，自动填充源聊天 ID，并尝试匹配该聊天历史记录
useAppliedRecord('selectedExportRecord', record => {
  loadMemory()
  applyRecord(record, 'all')
})

onMounted(async () => {
  loadMemory()

  if (appState && appState.selectedChat) {
    const row = appState.selectedChat
    const id = row.id || row.dialog_id || row.dialogID || ''
    chat.value = String(id)
    selectedSourceChat.value = row
    touchRecentChat(row)
    const remembered = getChatMemory(String(id))
    if (remembered) applyRecord(remembered, 'chat-id')
  } else if (exportMemory.value.last) {
    // 没有从列表传入聊天时，默认恢复上一次的 -c 和 -i，但输出文件重新生成，避免覆盖旧文件。
    applyRecord(exportMemory.value.last, 'all')
  }

  autoOutput.value = true
  await updateSmartOutput({ force: true })

  if (!window.tdlApi?.onDone) return
  offDone = window.tdlApi.onDone(async (data) => {
    if (!pendingExportTaskId.value || data.taskId !== pendingExportTaskId.value) return
    const record = pendingExportRecord.value
    pendingExportTaskId.value = ''
    pendingExportRecord.value = null
    if (data.code === 0) {
      await finalizeExportMemory(record)
    } else if (record) {
      // 失败时只保存草稿，避免丢失你刚填写的参数，但不更新 nextInput。
      saveMemory(record)
    }
  })
})

onUnmounted(() => {
  if (offDone) offDone()
})

// 切换命名空间后重新读取对应历史
watch(nsKey, () => loadMemory())
watch([chat, type, input], () => updateSmartOutput())

const spec = computed(() => ({
  kind: 'export',
  chat: chat.value,
  selector: { type: type.value, input: input.value },
  all: all.value,
  raw: raw.value,
  output: output.value
}))

const forwardSpec = computed(() => ({
  kind: 'forward',
  from: output.value,
  target: { peer: forwardPeer.value, thread: forwardThread.value || null },
  mode: forwardMode.value,
  dryRun: forwardDryRun.value
}))

function forwardTargetLabel() {
  const row = selectedForwardChat.value || findChatByValue(forwardPeer.value, appState.cachedChats || [])
  const title = getChatTitle(row)
  const id = getChatId(row) || forwardPeer.value
  return title ? `${title}（${id}）` : String(forwardPeer.value || '')
}

function forwardThreadLabel() {
  if (!forwardThread.value) return '未指定'
  const topic = forwardTopics.value.find(item => String(item.id) === String(forwardThread.value))
  return topic ? `${topic.title || topic.id}（${topic.id}）` : String(forwardThread.value)
}

async function run() {
  if (requiresInput() && !String(input.value || '').trim()) {
    const remembered = getChatMemory(chat.value)
    if (remembered?.input) {
      applyRecord(remembered, 'chat-id')
      message.success('已自动读取当前聊天上次的 -i')
    } else {
      message.error('当前导出类型需要填写 -i。请填写输入值，或先点击“读取该聊天”。')
      return
    }
  }

  if (canAutoAnalyzeNextInput()) {
    message.info('本次未填写 -i，将按 tdl 默认范围导出；完成后会从输出 JSON 自动识别最大消息 ID，并生成下次的 -i。')
  }

  const row = sourceChatRow()
  if (row) touchRecentChat(row)

  if (autoForward.value && !String(forwardPeer.value || '').trim()) {
    message.error('已开启导出后转发，请先选择目标对话')
    return
  }

  if (autoForward.value && !forwardDryRun.value) {
    try {
      await confirmHtml([
        `<p><strong>导出文件：</strong>${output.value}</p>`,
        `<p><strong>目标聊天：</strong>${forwardTargetLabel()}</p>`,
        `<p><strong>目标话题：</strong>${forwardThreadLabel()}</p>`,
        '<p style="color:#d03050">导出成功后会立即实际发送，请再次确认目标。</p>'
      ].join(''), '确认导出后转发', {
        confirmButtonText: '确认导出并转发',
        cancelButtonText: '取消',
        type: 'error',
        dangerouslyUseHTMLString: true
      })
    } catch {
      return
    }
  }

  const record = makeRecord({
    usedInput: String(input.value || '').trim(),
    autoAnalyzeNextInput: canAutoAnalyzeNextInput()
  })
  // 先保存草稿，任务成功后再用导出文件分析结果更新为 nextInput。
  saveMemory(record)
  if (autoForward.value) {
    try {
      await runJobAndWait(spec.value, '导出消息')
      await finalizeExportMemory(record)
      saveForwardRecord({
        sourceType: 'file',
        from: output.value,
        peer: forwardPeer.value,
        targetLabel: forwardTargetLabel(),
        thread: forwardThread.value,
        threadLabel: forwardThreadLabel(),
        mode: forwardMode.value,
        dryRun: forwardDryRun.value,
        command: commandTextForSpec(forwardSpec.value),
        time: new Date().toLocaleString(),
        chain: 'export-forward'
      })
      await runJob(forwardSpec.value, '导出后转发')
      message.success('导出成功，已启动后续转发')
    } catch (err) {
      message.error(`导出后转发链路已停止：${err?.message || err}`)
    }
    return
  }
  const started = await runJob(spec.value, '导出消息')
  pendingExportTaskId.value = started?.taskId || ''
  pendingExportRecord.value = record
}
</script>
<template>
  <div class="card">
    <n-form label-width="120px">
      <n-form-item label="源对话">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <ChatSelect
            v-model="chat"
            placeholder="从对话列表选择，或手动输入 @source / ID"
            button-text="更新缓存"
            @select="handleSourceSelect"
          />
          <n-button @click="useLastExport">读取上次</n-button>
        </div>
      </n-form-item>
      <div class="grid-2">
        <n-form-item label="导出方式">
          <n-select v-model:value="type" :options="typeOptions" />
        </n-form-item>
        <n-form-item label="消息范围">
          <div style="display:flex; gap:10px; align-items:center; width:100%">
            <n-input v-model:value="input" placeholder="例如 1213,1500 或 100" style="flex:1" />
            <n-button @click="useChatLastInput">读取该聊天</n-button>
          </div>
        </n-form-item>
      </div>
      <n-alert
        v-if="requiresInput() && !input"
        type="warning"
        
        :show-icon="true" :closable="false"
        style="margin-bottom:16px"
        title="最近 N 条需要 -i；按消息 ID 留空时会全量导出，完成后自动读取输出 JSON 的最大消息 ID，生成下次续导范围。"
      />
      <n-alert
        v-if="canAutoAnalyzeNextInput()"
        type="info"
        
        :show-icon="true" :closable="false"
        style="margin-bottom:16px"
        title="未填写 -i：本次会按 tdl 默认范围导出；完成后软件会读取 output JSON，记录最大消息 ID，并自动生成下次 -i。"
      />
      <n-alert
        v-if="chatLastRecord"
        type="info"
        
        :show-icon="true" :closable="false"
        style="margin-bottom:16px"
        :title="`当前聊天上次导出：-i ${chatLastRecord.input || '未填写'}，时间：${chatLastRecord.time || '-'}`"
      />
      <n-form-item label="选项"><n-checkbox v-model:checked="all">包含消息正文</n-checkbox><n-checkbox v-model:checked="raw">保留原始结构</n-checkbox></n-form-item>
      <n-form-item label="输出文件">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="output" placeholder="messages.json 绝对路径" style="flex:1" />
          <n-button @click="pickOutput">选择</n-button>
        </div>
      </n-form-item>
      <n-form-item label="完成后转发">
        <n-switch v-model:value="autoForward" />
        <span class="mini-muted" style="margin-left:10px">导出成功后，将本次 JSON 直接交给转发任务。</span>
      </n-form-item>
      <template v-if="autoForward">
        <div class="grid-2">
          <n-form-item label="目标对话">
            <ChatSelect
              v-model="forwardPeer"
              placeholder="选择后续转发目标"
              button-text="更新缓存"
              @select="handleForwardTargetSelect"
            />
          </n-form-item>
          <n-form-item label="目标话题">
            <n-select
              v-if="forwardTopics.length"
              v-model:value="forwardThread"
              filterable
              tag
              clearable
              :options="forwardTopicOptions"
              placeholder="可选"
            />
            <n-input v-else v-model:value="forwardThread" placeholder="可选，例如 65054" />
          </n-form-item>
        </div>
        <n-form-item label="转发设置">
          <n-radio-group v-model:value="forwardMode">
            <n-radio-button value="direct">direct 保留来源</n-radio-button>
            <n-radio-button value="clone">clone 复制发送</n-radio-button>
          </n-radio-group>
          <n-checkbox v-model:checked="forwardDryRun" style="margin-left:18px">演练模式，不真正发送</n-checkbox>
        </n-form-item>
      </template>
    </n-form>
    <CommandPreview :command="commandTextForSpec(spec)" />
    <template v-if="autoForward">
      <div style="height:10px"></div>
      <CommandPreview :command="commandTextForSpec(forwardSpec)" />
    </template>
    <div style="height:16px"></div>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <n-button type="primary" @click="run">开始导出</n-button>
      <n-button @click="saveMemory">仅保存当前 -c / -i</n-button>
    </div>
  </div>

  <div class="card" v-if="recentRecords.length">
    <div class="card-title">最近导出记录</div>
    <div class="table-scroll">
      <n-table :bordered="false" size="small" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="width:180px;">-c 源聊天</th>
            <th style="width:130px;">本次 -i</th>
            <th style="width:110px;">最大ID</th>
            <th style="width:190px;">下次建议 -i</th>
            <th style="min-width:280px;">输出文件</th>
            <th style="width:110px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recentRecords" :key="`${row.time}-${row.output}`">
            <td>{{ row.time }}</td>
            <td>{{ row.chat }}</td>
            <td>{{ row.usedInput }}</td>
            <td>{{ row.maxId }}</td>
            <td>{{ row.input }}</td>
            <td class="truncate-cell link-like" title="点击复制路径" @click="copyText(row.output, '输出路径已复制')">{{ row.output }}</td>
            <td>
              <n-button size="small" type="primary" secondary @click="applyRecordAndSmart(row, 'all')">套用</n-button>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>
</template>
