<script setup>
import { computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { appState } from '../main.js'
import { loadChatCache, chatId, chatTitle, chatUsername, chatType, chatTopics, chatOptionLabel, findChatByValue } from '../chatCache'
import { isFavoriteChat, getRecentChats, sortChatsForUse, touchRecentChat, normalizeChatKey } from '../historyStore'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '@channel / ID' },
  buttonText: { type: String, default: '更新缓存' },
  showRefresh: { type: Boolean, default: true }
})

const emit = defineEmits(['update:modelValue', 'select'])

const value = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val || '')
})

const chats = computed(() => sortChatsForUse(appState.cachedChats || []))
const recentKeys = computed(() => new Set(getRecentChats().map(item => item.key)))
const loading = computed(() => appState.chatCacheLoading)

async function loadChats(force = false) {
  try {
    // 非强制时只读取/确保缓存；缓存未过期不会再次运行 tdl。
    await loadChatCache({ ensure: !force, refresh: force })
  } catch (err) {
    ElMessage.error('读取对话缓存失败：' + (err?.message || err))
  }
}

function handleChange(val) {
  const row = findChatByValue(val, chats.value)
  if (row) touchRecentChat(row)
  emit('select', row)
}

function isRecent(row) {
  return recentKeys.value.has(normalizeChatKey(chatId(row) || chatUsername(row)))
}

onMounted(() => {
  // 组件挂载只读取缓存。首次启动时 App 已经负责 ensure；如果还没完成，这里也不会重复刷新未过期缓存。
  if (!chats.value.length) loadChats(false)
})
</script>

<template>
  <div class="chat-select-wrap">
    <el-select
      v-model="value"
      filterable
      allow-create
      default-first-option
      clearable
      :reserve-keyword="false"
      :loading="loading"
      :placeholder="placeholder"
      style="width:100%"
      @visible-change="visible => visible && loadChats(false)"
      @focus="loadChats(false)"
      @change="handleChange"
    >
      <el-option
        v-for="row in chats"
        :key="String(chatId(row))"
        :label="chatOptionLabel(row)"
        :value="String(chatId(row))"
      >
        <div class="chat-option">
          <div class="chat-option-main">
            <span class="chat-option-title">{{ chatTitle(row) || '未命名对话' }}</span>
            <span v-if="isFavoriteChat(chatId(row) || chatUsername(row))" class="chat-option-badge favorite">收藏</span>
            <span v-else-if="isRecent(row)" class="chat-option-badge">最近</span>
            <span v-if="chatUsername(row)" class="chat-option-username">@{{ chatUsername(row) }}</span>
          </div>
          <div class="chat-option-meta">
            <span>{{ chatType(row) || 'unknown' }}</span>
            <span>ID: {{ chatId(row) }}</span>
            <span v-if="chatTopics(row).length">话题 {{ chatTopics(row).length }}</span>
          </div>
        </div>
      </el-option>
    </el-select>
    <el-button v-if="showRefresh" :loading="loading" @click="loadChats(true)">{{ buttonText }}</el-button>
  </div>
</template>
