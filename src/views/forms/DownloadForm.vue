<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from '../../ui/naive'
import { commandText, runTask, runTaskAndWait } from '../../utils'
import CommandPreview from '../../components/CommandPreview.vue'
import ChatSelect from '../../components/ChatSelect.vue'
import { appState } from '../../state.js'
import { getDownloadRecords, saveDownloadRecord } from '../../historyStore'

const sourceType = ref('url')
const urlsText = ref('')
const filesText = ref('')
const commentsChat = ref('')
const commentsIdsText = ref('')
const commentsWorkDir = ref('')
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
const commentsIds = computed(() => commentsIdsText.value.split(/\r?\n|,|，/).map(item => item.trim()).filter(Boolean))

function pad(n) {
  return String(n).padStart(2, '0')
}

function timestampToken() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function cleanPathPart(value) {
  return String(value || 'chat').replace(/[\\/:*?"<>|#%{}~&\s]+/g, '_').slice(0, 60) || 'chat'
}

function joinPath(base, child) {
  const cleanBase = String(base || '').replace(/[\\/]+$/, '')
  if (!cleanBase) return child
  const sep = cleanBase.includes('\\') ? '\\' : '/'
  return `${cleanBase}${sep}${child}`
}

function defaultCommentsWorkDir() {
  const base = commentsWorkDir.value || dir.value || appState.config?.defaultDownloadDir || ''
  return joinPath(base, `comment-download_${timestampToken()}`)
}

function commentExportFile(workDir, id) {
  return joinPath(workDir, `comments_${cleanPathPart(commentsChat.value)}_${cleanPathPart(id)}.json`)
}

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
  if (sourceType.value === 'url') {
    for (const item of urls.value) a.push('-u', item)
  } else if (sourceType.value === 'file') {
    for (const item of files.value) a.push('-f', item)
  } else if (sourceType.value === 'comments') {
    for (const id of commentsIds.value) a.push('-f', commentExportFile('<workDir>', id))
  }
  return a
})

const previewCommand = computed(() => {
  if (sourceType.value !== 'comments') return commandText(args.value)
  const ids = commentsIds.value.length ? commentsIds.value : ['<主消息ID>']
  const lines = [
    '# 评论区下载会先导出评论区 JSON，再下载其中媒体'
  ]
  for (const id of ids) {
    lines.push(commandText(['chat', 'export', '-c', commentsChat.value || '<源频道/群组>', '--reply', id, '--all', '--with-content', '-o', commentExportFile('<workDir>', id)]))
  }
  lines.push(commandText(args.value))
  return lines.join('\n')
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

async function pickCommentsWorkDir() {
  const selected = await window.tdlApi.openDirectory({ defaultPath: commentsWorkDir.value || dir.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (selected) commentsWorkDir.value = selected
}

function applyRecord(record) {
  sourceType.value = record.sourceType || 'url'
  urlsText.value = (record.urls || []).join('\n')
  filesText.value = (record.files || []).join('\n')
  commentsChat.value = record.commentsChat || ''
  commentsIdsText.value = (record.commentsIds || []).join('\n')
  commentsWorkDir.value = record.commentsWorkDir || ''
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
  if (sourceType.value === 'comments') {
    if (!commentsChat.value) {
      message.error('请填写评论区所属的源频道 / 群组')
      return
    }
    if (!commentsIds.value.length) {
      message.error('请至少填写一个主消息 ID')
      return
    }
  }
  if (!dir.value && !serve.value) {
    message.error('请先选择下载目录')
    return
  }

  saveDownloadRecord({
    sourceType: sourceType.value,
    urls: urls.value,
    files: files.value,
    commentsChat: commentsChat.value,
    commentsIds: commentsIds.value,
    commentsWorkDir: commentsWorkDir.value,
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
    command: previewCommand.value,
    time: new Date().toLocaleString()
  })
  loadHistory()
  if (sourceType.value !== 'comments') {
    await runTask('download', args.value, '下载媒体')
    return
  }

  const workDir = defaultCommentsWorkDir()
  const exportedFiles = []
  for (const id of commentsIds.value) {
    const output = commentExportFile(workDir, id)
    await runTaskAndWait('export', ['chat', 'export', '-c', commentsChat.value, '--reply', id, '--all', '--with-content', '-o', output], `导出评论区 ${id}`)
    exportedFiles.push(output)
  }

  const downloadArgs = args.value.filter((item, index, source) => {
    if (source[index - 1] === '-f' || source[index - 1] === '--file') return false
    return item !== '-f' && item !== '--file'
  })
  for (const file of exportedFiles) downloadArgs.push('-f', file)
  await runTask('download', downloadArgs, '下载评论区媒体')
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

  <div class="card">
    <n-form label-width="120px">
      <n-form-item label="来源类型">
        <n-radio-group v-model:value="sourceType">
          <n-radio-button value="url">消息链接</n-radio-button>
          <n-radio-button value="file">导出文件</n-radio-button>
          <n-radio-button value="comments">评论区</n-radio-button>
        </n-radio-group>
      </n-form-item>

      <n-form-item v-if="sourceType === 'url'" label="消息链接">
        <n-input v-model:value="urlsText" type="textarea" :rows="5" placeholder="一行一个 https://t.me/... 链接" />
      </n-form-item>

      <n-form-item v-else-if="sourceType === 'file'" label="导出文件">
        <div style="display:flex; gap:10px; align-items:flex-start; width:100%">
          <n-input v-model:value="filesText" type="textarea" :rows="5" placeholder="一行一个官方客户端导出的文件路径" style="flex:1" />
          <n-button @click="pickFiles">选择文件</n-button>
        </div>
      </n-form-item>

      <template v-else>
        <n-form-item label="源频道 / 群组">
          <ChatSelect
            v-model="commentsChat"
            placeholder="评论区所属频道 / 群组，例如 @source 或 ID"
            button-text="更新缓存"
          />
        </n-form-item>

        <n-form-item label="主消息 ID">
          <n-input v-model:value="commentsIdsText" type="textarea" :rows="4" placeholder="一行一个主消息 ID，或用逗号分隔，例如 2313,2314" />
        </n-form-item>

        <n-form-item label="评论区缓存">
          <div style="display:flex; gap:10px; align-items:center; width:100%">
            <n-input v-model:value="commentsWorkDir" placeholder="可空，默认在下载目录下生成 comment-download_时间戳" style="flex:1" />
            <n-button @click="pickCommentsWorkDir">选择目录</n-button>
          </div>
        </n-form-item>
      </template>

      <n-form-item label="下载目录">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="dir" placeholder="下载目录" style="flex:1" />
          <n-button @click="pickDir">选择目录</n-button>
        </div>
      </n-form-item>

      <div class="grid-2">
        <n-form-item label="只下载这些后缀">
          <n-input v-model:value="includeExt" placeholder="例如 mp4,mp3" />
        </n-form-item>
        <n-form-item label="跳过这些后缀">
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

    <CommandPreview :command="previewCommand" />
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
            <td>{{ row.sourceType === 'comments' ? '评论区' : row.sourceType === 'file' ? '导出文件' : '消息链接' }}</td>
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
