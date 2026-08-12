<script setup>
import { ref, computed, onMounted } from 'vue'
import { commandText, runTask } from '../../utils'
import CommandPreview from '../../components/CommandPreview.vue'
import ChatSelect from '../../components/ChatSelect.vue'
import { appState } from '../../state.js'
import { message } from '../../ui/naive'
import { findChatByValue } from '../../chatCache'
import { saveUploadRecord, touchRecentChat } from '../../historyStore'
const path = ref('')
const chat = ref('')
const topic = ref('')
const caption = ref('')
const photo = ref(false)
const remove = ref(false)
const selectedTargetChat = ref(null)

function getTopics(row) {
  return Array.isArray(row?.topics) ? row.topics : []
}

const targetTopics = computed(() => getTopics(selectedTargetChat.value))
const targetTopicOptions = computed(() => targetTopics.value.map(item => ({
  label: `${item.title || item.id} / ${item.id}`,
  value: String(item.id)
})))

function handleTargetSelect(row) {
  selectedTargetChat.value = row
  if (row) touchRecentChat(row)
  if (!row) return
  if (targetTopics.value.length && topic.value && !targetTopics.value.some(t => String(t.id) === String(topic.value))) {
    topic.value = ''
  }
}

async function pickPath() {
  const dir = await window.tdlApi.openDirectory({ defaultPath: path.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (dir) path.value = dir
}

async function pickFile() {
  const file = await window.tdlApi.openFile({
    defaultPath: path.value || appState.config?.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir(),
    filters: [
      { name: 'Media', extensions: ['mkv', 'mp4', 'mov', 'avi', 'mp3', 'm4a', 'flac', 'jpg', 'jpeg', 'png', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (file) path.value = file
}
const args = computed(() => {
  const a = ['upload']
  if (path.value) a.push('-p', path.value)
  if (chat.value) a.push('-c', chat.value)
  if (topic.value) a.push('--topic', topic.value)
  if (caption.value) a.push('--caption', caption.value)
  if (photo.value) a.push('--photo')
  if (remove.value) a.push('--rm')
  return a
})
onMounted(() => {
  if (appState && appState.selectedUploadRecord) {
    const record = appState.selectedUploadRecord
    path.value = record.path || ''
    chat.value = record.chat || ''
    topic.value = record.topic || ''
    caption.value = record.caption || ''
    photo.value = record.photo ?? false
    remove.value = record.remove ?? false
    selectedTargetChat.value = findChatByValue(chat.value, appState.cachedChats || [])
    appState.selectedUploadRecord = null
  } else if (appState && appState.selectedChat) {
    const row = appState.selectedChat
    selectedTargetChat.value = row
    touchRecentChat(row)
    const id = row.id || row.dialog_id || row.dialogID || ''
    chat.value = String(id || row.username || '')
  }
})

function run() {
  if (!path.value || !chat.value) {
    message.error('请先填写上传路径和目标聊天')
    return
  }
  const row = selectedTargetChat.value || findChatByValue(chat.value, appState.cachedChats || [])
  if (row) touchRecentChat(row)
  saveUploadRecord({
    path: path.value,
    chat: chat.value,
    topic: topic.value,
    caption: caption.value,
    photo: photo.value,
    remove: remove.value,
    command: commandText(args.value),
    time: new Date().toLocaleString()
  })
  runTask('upload', args.value, '上传文件')
}
</script>
<template>
  <div class="card">
    <n-form label-width="120px">
      <n-form-item label="上传路径">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <n-input v-model:value="path" placeholder="文件或文件夹绝对路径，例如 /Users/hope/Desktop/4k hdr.mkv" style="flex:1" />
          <n-button @click="pickFile">选择文件</n-button>
          <n-button @click="pickPath">选择文件夹</n-button>
        </div>
      </n-form-item>
      <div class="grid-2">
        <n-form-item label="目标聊天">
          <ChatSelect
            v-model="chat"
            placeholder="从对话列表选择目标，或手动输入 @channel / ID"
            button-text="更新缓存"
            @select="handleTargetSelect"
          />
        </n-form-item>
        <n-form-item label="话题">
          <n-select
            v-if="targetTopics.length"
            v-model:value="topic"
            filterable
            tag
            default-first-option
            clearable
            :options="targetTopicOptions"
            placeholder="从该聊天的话题中选择，或手动输入"
            style="width:100%"
          />
          <n-input v-else v-model:value="topic" placeholder="可选" />
        </n-form-item>
      </div>
      <n-form-item label="Caption"><n-input v-model:value="caption" placeholder="可选" /></n-form-item>
      <n-form-item label="选项"><n-checkbox v-model:checked="photo">作为图片上传</n-checkbox><n-checkbox v-model:checked="remove">上传后删除本地</n-checkbox></n-form-item>
    </n-form>
    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <n-button type="primary" @click="run">开始上传</n-button>
  </div>
</template>
