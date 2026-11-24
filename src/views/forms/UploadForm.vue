<script setup>
import { useWorkbenchPreview } from '../../composables/useWorkbenchPreview'
import { ref, computed, watch } from 'vue'
import { commandTextForSpec, defaultOutputDir, runJob } from '../../utils'
import CommandPreview from '../../components/CommandPreview.vue'
import ChatSelect from '../../components/ChatSelect.vue'
import { appState } from '../../state.js'
import { message } from '../../ui/naive'
import { findChatByValue } from '../../chatCache'
import { saveUploadRecord, touchRecentChat } from '../../historyStore'
import { useAppliedRecord, useSelectedChat } from '../../useAppliedRecord'
import { formatTags, tagsFromFilename } from '../../filenameTags'
const path = ref('')
const chat = ref('')
const topic = ref('')
const caption = ref('')
const photo = ref(false)
const remove = ref(false)
const tags = ref([])
// 用户手动改过标签之后就不再自动覆盖，避免边改边被冲掉。
const tagsTouched = ref(false)
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
  const dir = await window.tdlApi.openDirectory({ defaultPath: path.value || await defaultOutputDir() })
  if (dir) path.value = dir
}

async function pickFile() {
  const file = await window.tdlApi.openFile({
    defaultPath: path.value || await defaultOutputDir(),
    filters: [
      { name: 'Media', extensions: ['mkv', 'mp4', 'mov', 'avi', 'mp3', 'm4a', 'flac', 'jpg', 'jpeg', 'png', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (file) path.value = file
}
const spec = computed(() => ({
  kind: 'upload',
  path: path.value,
  chat: chat.value,
  topic: topic.value,
  caption: finalCaption.value,
  photo: photo.value,
  remove: remove.value
}))
// 换文件就重新切一次标签，除非用户已经手动改过。
watch(path, value => {
  if (tagsTouched.value) return
  tags.value = tagsFromFilename(value)
})

function regenerateTags() {
  tags.value = tagsFromFilename(path.value)
  tagsTouched.value = false
}

function clearTags() {
  tags.value = []
  tagsTouched.value = true
}

const tagText = computed(() => formatTags(tags.value))

// 标签追加到 caption 末尾，另起一行，不覆盖用户自己写的说明。
const finalCaption = computed(() => [caption.value, tagText.value].filter(Boolean).join('\n'))

function applyRecord(record) {
  path.value = record.path || ''
  chat.value = record.chat || ''
  topic.value = record.topic || ''
  caption.value = record.caption || ''
  photo.value = record.photo ?? false
  remove.value = record.remove ?? false
  tags.value = Array.isArray(record.tags) ? [...record.tags] : []
  tagsTouched.value = tags.value.length > 0
  selectedTargetChat.value = findChatByValue(chat.value, appState.cachedChats || [])
}

useAppliedRecord('selectedUploadRecord', applyRecord)
useSelectedChat(row => {
  selectedTargetChat.value = row
  touchRecentChat(row)
  chat.value = String(row.id || row.dialog_id || row.dialogID || row.username || '')
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
    tags: [...tags.value],
    photo: photo.value,
    remove: remove.value,
    command: commandTextForSpec(spec.value),
    time: new Date().toLocaleString()
  })
  runJob(spec.value, '上传文件')
}
useWorkbenchPreview(spec)
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
      <n-form-item label="Caption"><n-input v-model:value="caption" placeholder="可选，标签会另起一行追加在后面" /></n-form-item>
      <n-form-item label="标签">
        <div style="width:100%">
          <n-select
            v-model:value="tags"
            multiple
            filterable
            tag
            :options="[]"
            placeholder="选择文件后自动从文件名切出标签，可增删"
            style="width:100%"
            @update:value="tagsTouched = true"
          />
          <div class="action-row" style="margin-top:8px">
            <n-button size="small" :disabled="!path" @click="regenerateTags">按文件名重新生成</n-button>
            <n-button size="small" :disabled="!tags.length" @click="clearTags">清空</n-button>
            <span class="mini-muted">{{ tagText || '暂无标签' }}</span>
          </div>
        </div>
      </n-form-item>
      <n-form-item label="选项"><n-checkbox v-model:checked="photo">作为图片上传</n-checkbox><n-checkbox v-model:checked="remove">上传后删除本地</n-checkbox></n-form-item>
    </n-form>
    <CommandPreview :command="commandTextForSpec(spec)" />
    <div style="height:16px"></div>
    <n-button type="primary" @click="run">开始上传</n-button>
  </div>
</template>
