<script setup>
import { ref, computed, onMounted } from 'vue'
import { commandText, runTask } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
import ChatSelect from '../components/ChatSelect.vue'
import { appState } from '../main.js'
import { ElMessage } from 'element-plus'
import { findChatByValue } from '../chatCache'
import { saveUploadRecord, touchRecentChat } from '../historyStore'
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
    ElMessage.error('请先填写上传路径和目标聊天')
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
  <h1 class="page-title">上传文件</h1>
  <p class="page-desc">上传文件或文件夹到指定聊天，可指定话题和 caption。</p>
  <div class="card">
    <el-form label-width="120px">
      <!-- Wrap the input and button in a flex container to prevent line breaks -->
      <el-form-item label="上传路径">
        <div style="display:flex; gap:10px; align-items:center; width:100%">
          <el-input v-model="path" placeholder="文件夹路径" style="flex:1" />
          <!-- Remove margin-left and rely on flex gap for spacing -->
          <el-button @click="pickPath">选择文件夹</el-button>
        </div>
      </el-form-item>
      <div class="grid-2">
        <el-form-item label="目标聊天">
          <ChatSelect
            v-model="chat"
            placeholder="从对话列表选择目标，或手动输入 @channel / ID"
            button-text="更新缓存"
            @select="handleTargetSelect"
          />
        </el-form-item>
        <el-form-item label="话题 ID">
          <el-select
            v-if="targetTopics.length"
            v-model="topic"
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="从该聊天的话题中选择，或手动输入"
            style="width:100%"
          >
            <el-option
              v-for="item in targetTopics"
              :key="String(item.id)"
              :label="`${item.title || item.id} / ${item.id}`"
              :value="String(item.id)"
            />
          </el-select>
          <el-input v-else v-model="topic" placeholder="可选" />
        </el-form-item>
      </div>
      <el-form-item label="Caption"><el-input v-model="caption" placeholder="可选" /></el-form-item>
      <el-form-item label="选项"><el-checkbox v-model="photo">作为图片上传</el-checkbox><el-checkbox v-model="remove">上传后删除本地</el-checkbox></el-form-item>
    </el-form>
    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <el-button type="primary" @click="run">开始上传</el-button>
  </div>
</template>
