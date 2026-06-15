<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from '../ui/naive'
import { commandText, runTask } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
import { appState } from '../state.js'
import { getDownloadRecords, saveDownloadRecord } from '../historyStore'

const sourceType = ref('url')
const urlsText = ref('')
const filesText = ref('')
const dir = ref('')
const includeExt = ref('')
const excludeExt = ref('')
const template = ref('')
const port = ref(8080)
const group = ref(true)
const skipSame = ref(true)
const rewriteExt = ref(false)
const serve = ref(false)
const takeout = ref(false)
const desc = ref(false)
const resumeMode = ref('none')
const recentRecords = ref([])

const urls = computed(() => urlsText.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))
const files = computed(() => filesText.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))

const args = computed(() => {
  const a = ['download']
  if (dir.value) a.push('-d', dir.value)
  if (includeExt.value.trim()) a.push('-i', includeExt.value.trim())
  if (excludeExt.value.trim()) a.push('-e', excludeExt.value.trim())
  if (template.value.trim()) a.push('--template', template.value.trim())
  if (group.value) a.push('--group')
  if (skipSame.value) a.push('--skip-same')
  if (rewriteExt.value) a.push('--rewrite-ext')
  if (serve.value) {
    a.push('--serve')
    if (port.value) a.push('--port', String(port.value))
  }
  if (takeout.value) a.push('--takeout')
  if (desc.value) a.push('--desc')
  if (resumeMode.value === 'continue') a.push('--continue')
  if (resumeMode.value === 'restart') a.push('--restart')
  for (const item of urls.value) a.push('-u', item)
  for (const item of files.value) a.push('-f', item)
  return a
})

async function pickDir() {
  const selected = await window.tdlApi.openDirectory({ defaultPath: dir.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (selected) dir.value = selected
}

async function pickFiles() {
  const selected = await window.tdlApi.openFile({
    properties: ['openFile', 'multiSelections'],
    defaultPath: dir.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir(),
    filters: [{ name: 'Exported Files', extensions: ['json', 'txt', '*'] }]
  })
  if (!selected) return
  if (Array.isArray(selected)) filesText.value = selected.join('\n')
  else filesText.value = String(selected)
}

function applyRecord(record) {
  sourceType.value = record.sourceType || 'url'
  urlsText.value = (record.urls || []).join('\n')
  filesText.value = (record.files || []).join('\n')
  dir.value = record.dir || ''
  includeExt.value = record.includeExt || ''
  excludeExt.value = record.excludeExt || ''
  template.value = record.template || ''
  port.value = Number(record.port || 8080)
  group.value = record.group !== false
  skipSame.value = record.skipSame !== false
  rewriteExt.value = !!record.rewriteExt
  serve.value = !!record.serve
  takeout.value = !!record.takeout
  desc.value = !!record.desc
  resumeMode.value = record.resumeMode || 'none'
}

function loadHistory() {
  recentRecords.value = getDownloadRecords().slice(0, 8)
}

async function run() {
  if (sourceType.value === 'url' && !urls.value.length && resumeMode.value === 'none') {
    message.error('请至少填写一个 Telegram 消息链接')
    return
  }
  if (sourceType.value === 'file' && !files.value.length && resumeMode.value === 'none') {
    message.error('请至少填写一个导出文件路径')
    return
  }
  if (!dir.value && !serve.value) {
    message.error('请先选择下载目录')
    return
  }

  saveDownloadRecord({
    sourceType: sourceType.value,
    urls: urls.value,
    files: files.value,
    dir: dir.value,
    includeExt: includeExt.value,
    excludeExt: excludeExt.value,
    template: template.value,
    port: port.value,
    group: group.value,
    skipSame: skipSame.value,
    rewriteExt: rewriteExt.value,
    serve: serve.value,
    takeout: takeout.value,
    desc: desc.value,
    resumeMode: resumeMode.value,
    command: commandText(args.value),
    time: new Date().toLocaleString()
  })
  loadHistory()
  await runTask('download', args.value, '下载媒体')
}

onMounted(async () => {
  if (appState?.selectedDownloadRecord) {
    applyRecord(appState.selectedDownloadRecord)
    appState.selectedDownloadRecord = null
  }
  loadHistory()
  if (!dir.value) {
    dir.value = appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir()
  }
})
</script>

<template>
  <h1 class="page-title">下载媒体</h1>
  <p class="page-desc">独立执行 `tdl download`，适合从消息链接或导出文件批量下载受保护媒体。</p>

  <div class="card">
    <n-form label-width="120px">
      <n-form-item label="来源类型">
        <n-radio-group v-model:value="sourceType">
          <n-radio-button value="url">消息链接</n-radio-button>
          <n-radio-button value="file">导出文件</n-radio-button>
        </n-radio-group>
      </n-form-item>

      <n-form-item v-if="sourceType === 'url'" label="消息链接">
        <n-input v-model:value="urlsText" type="textarea" :rows="5" placeholder="一行一个 https://t.me/... 链接" />
      </n-form-item>

      <n-form-item v-else label="导出文件">
        <div style="display:flex; gap:10px; align-items:flex-start; width:100%">
          <n-input v-model:value="filesText" type="textarea" :rows="5" placeholder="一行一个官方客户端导出的文件路径" style="flex:1" />
          <n-button @click="pickFiles">选择文件</n-button>
        </div>
      </n-form-item>

      <n-form-item label="下载目录">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="dir" placeholder="下载目录" style="flex:1" />
          <n-button @click="pickDir">选择目录</n-button>
        </div>
      </n-form-item>

      <div class="grid-2">
        <n-form-item label="包含后缀">
          <n-input v-model:value="includeExt" placeholder="例如 mp4,mp3" />
        </n-form-item>
        <n-form-item label="排除后缀">
          <n-input v-model:value="excludeExt" placeholder="例如 jpg,png" />
        </n-form-item>
      </div>

      <div class="grid-2">
        <n-form-item label="命名模板">
          <n-input v-model:value="template" placeholder="{{ .DialogID }}_{{ .MessageID }}_{{ filenamify .FileName }}" />
        </n-form-item>
        <n-form-item label="续传模式">
          <n-radio-group v-model:value="resumeMode">
            <n-radio-button value="none">无</n-radio-button>
            <n-radio-button value="continue">continue</n-radio-button>
            <n-radio-button value="restart">restart</n-radio-button>
          </n-radio-group>
        </n-form-item>
      </div>

      <div class="grid-2">
        <n-form-item label="下载选项">
          <n-checkbox v-model:checked="group">分组消息整组下载</n-checkbox>
          <n-checkbox v-model:checked="skipSame">跳过同名同大小</n-checkbox>
          <n-checkbox v-model:checked="rewriteExt">按 MIME 改写后缀</n-checkbox>
          <n-checkbox v-model:checked="takeout">takeout 会话</n-checkbox>
          <n-checkbox v-model:checked="desc">从新到旧</n-checkbox>
        </n-form-item>
        <n-form-item label="Serve 模式">
          <n-checkbox v-model:checked="serve">作为 HTTP 服务</n-checkbox>
          <n-input-number v-model:value="port" :min="1" :max="65535" :disabled="!serve" />
        </n-form-item>
      </div>
    </n-form>

    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <n-button type="primary" @click="run">开始下载</n-button>
  </div>

  <div class="card" v-if="recentRecords.length">
    <div class="card-title">最近下载记录</div>
    <div class="table-scroll">
      <n-table :bordered="false" size="small" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="width:90px;">来源</th>
            <th style="width:120px;">目录</th>
            <th>摘要</th>
            <th style="width:110px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recentRecords" :key="row.id">
            <td>{{ row.time }}</td>
            <td>{{ row.sourceType === 'file' ? '导出文件' : '消息链接' }}</td>
            <td class="truncate-cell">{{ row.dir }}</td>
            <td class="truncate-cell">{{ row.command }}</td>
            <td>
              <n-button size="small" type="primary" secondary @click="applyRecord(row)">套用</n-button>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>
</template>
