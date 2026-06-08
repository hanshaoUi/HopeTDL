import { appState } from './main'

function applyCacheInfo(info) {
  const chats = Array.isArray(info?.chats) ? info.chats : []
  appState.cachedChats = chats
  appState.chatCacheMeta = info || null
  return chats
}

export async function loadChatCache({ ensure = false, refresh = false } = {}) {
  appState.chatCacheLoading = true
  try {
    let info
    if (refresh) {
      info = await window.tdlApi.refreshChatCache()
    } else if (ensure) {
      info = await window.tdlApi.ensureChatCache()
    } else {
      info = await window.tdlApi.getChatCache()
    }
    return applyCacheInfo(info)
  } finally {
    appState.chatCacheLoading = false
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
