<script setup>
import { computed, h, onMounted } from 'vue'
import { message } from '../ui/naive'
import { appState } from '../state.js'
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

// cachedChats 是 markRaw 的，内容变化只靠 chatCacheVersion 触发重算，
// 这样排序和 option 构建不会在每次无关的响应式更新时重复跑一遍。
const chats = computed(() => {
  appState.chatCacheVersion
  return sortChatsForUse(appState.cachedChats || [])
})
const chatOptions = computed(() => chats.value.map(row => ({
  label: chatOptionLabel(row),
  value: String(chatId(row)),
  row
})))
const recentKeys = computed(() => {
  appState.chatCacheVersion
  return new Set(getRecentChats().map(item => item.key))
})
const loading = computed(() => appState.chatCacheLoading)

async function loadChats(force = false) {
  if (!window.tdlApi) return
  // 已经有缓存就不再往主进程要一遍整份列表：
  // 原来每次下拉展开和聚焦都会走一次 IPC，把上千条对话重新序列化传一遍。
  if (!force && chats.value.length) return
  try {
    // 非强制时只读取/确保缓存；缓存未过期不会再次运行 tdl。
    await loadChatCache({ ensure: !force, refresh: force })
  } catch (err) {
    message.error('读取对话缓存失败：' + (err?.message || err))
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

function renderChatLabel(option) {
  const row = option.row
  if (!row) return option.label
  return h('div', { class: 'chat-option' }, [
    h('div', { class: 'chat-option-main' }, [
      h('span', { class: 'chat-option-title' }, chatTitle(row) || '未命名对话'),
      isFavoriteChat(chatId(row) || chatUsername(row))
        ? h('span', { class: 'chat-option-badge favorite' }, '收藏')
        : isRecent(row)
          ? h('span', { class: 'chat-option-badge' }, '最近')
          : null,
      chatUsername(row) ? h('span', { class: 'chat-option-username' }, `@${chatUsername(row)}`) : null
    ]),
    h('div', { class: 'chat-option-meta' }, [
      h('span', chatType(row) || 'unknown'),
      h('span', `ID: ${chatId(row)}`),
      chatTopics(row).length ? h('span', `话题 ${chatTopics(row).length}`) : null
    ])
  ])
}

onMounted(() => {
  // 组件挂载只读取缓存。首次启动时 App 已经负责 ensure；如果还没完成，这里也不会重复刷新未过期缓存。
  if (!chats.value.length) loadChats(false)
})
</script>

<template>
  <div class="chat-select-wrap">
    <n-select
      v-model:value="value"
      filterable
      tag
      default-first-option
      clearable
      :loading="loading"
      :options="chatOptions"
      :render-label="renderChatLabel"
      :placeholder="placeholder"
      style="width:100%"
      @update:show="visible => visible && loadChats(false)"
      @focus="loadChats(false)"
      @update:value="handleChange"
    />
    <n-button v-if="showRefresh" :loading="loading" @click="loadChats(true)">{{ buttonText }}</n-button>
  </div>
</template>
