import { markRaw } from 'vue'
import { appState } from './state'

export function applyCacheInfo(info) {
  const chats = Array.isArray(info?.chats) ? info.chats : []
  // markRaw：对话行是只读数据、整体替换，不需要每行一个深层 Proxy。
  appState.cachedChats = markRaw(chats)
  appState.chatCacheMeta = info ? markRaw(info) : null
  appState.chatCacheVersion += 1
  return chats
}

// 同一时刻只允许一次在途请求，页面切换/下拉聚焦不会重复往主进程要整份列表。
let inflight = null

export async function loadChatCache({ ensure = false, refresh = false } = {}) {
  if (inflight && !refresh) return inflight
  appState.chatCacheLoading = true
  const request = (async () => {
    try {
      const api = window.tdlApi
      if (!api) {
        if (refresh) throw new Error('当前处于浏览器预览模式，无法刷新对话列表')
        return applyCacheInfo({ chats: [] })
      }
      let info
      if (refresh) {
        info = await api.refreshChatCache()
      } else if (ensure) {
        info = await api.ensureChatCache()
      } else {
        info = await api.getChatCache()
      }
      return applyCacheInfo(info)
    } finally {
      appState.chatCacheLoading = false
    }
  })()
  inflight = request
  try {
    return await request
  } finally {
    if (inflight === request) inflight = null
  }
}

export function chatId(row) {
  return row?.id || row?.dialog_id || row?.dialogID || ''
}

export function chatTitle(row) {
  return row?.VisibleName || row?.visibleName || row?.visible_name || row?.title || row?.Name || row?.name || (row?.dialog && row.dialog.title) || ''
}

export function chatUsername(row) {
  return row?.username || row?.Username || row?.user_name || ''
}

export function chatType(row) {
  return row?.type || row?.Type || ''
}

export function chatTopics(row) {
  return Array.isArray(row?.topics) ? row.topics : []
}

export function findChatByValue(value, chats = appState.cachedChats) {
  const val = String(value || '')
  if (!val) return null
  return (chats || []).find(row => {
    const id = String(chatId(row))
    const username = chatUsername(row)
    return id === val || (username && `@${username}` === val) || (username && username === val)
  }) || null
}

export function chatOptionLabel(row) {
  const parts = []
  const title = chatTitle(row)
  const username = chatUsername(row)
  const id = chatId(row)
  if (title) parts.push(title)
  if (username) parts.push('@' + username)
  if (id) parts.push(String(id))
  return parts.join(' / ') || String(id)
}
