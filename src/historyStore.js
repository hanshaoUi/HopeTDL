import { appState } from './state'
import { chatId, chatTitle, chatUsername } from './chatCache'

export const EXPORT_MEMORY_KEY = 'hopetdl.export.memory.v1'
export const FORWARD_HISTORY_KEY = 'hopetdl.forward.history.v1'
export const UPLOAD_HISTORY_KEY = 'hopetdl.upload.history.v1'
export const DOWNLOAD_HISTORY_KEY = 'hopetdl.download.history.v1'
export const CHAT_PREFS_KEY = 'hopetdl.chat.prefs.v1'

export function nsKey() {
  return String(appState.config?.ns || 'default')
}

// localStorage.getItem + JSON.parse 在排序/渲染热路径上会被调用成百上千次
// （chatSortScore 每次比较都要读收藏和最近列表）。这里缓存解析结果，写入时失效。
const parsedCache = new Map()

export function readJson(key, fallback = {}) {
  if (parsedCache.has(key)) return parsedCache.get(key)
  let value
  try {
    const raw = localStorage.getItem(key)
    value = raw ? JSON.parse(raw) : fallback
  } catch {
    value = fallback
  }
  parsedCache.set(key, value)
  return value
}

export function writeJson(key, value) {
  parsedCache.set(key, value)
  localStorage.setItem(key, JSON.stringify(value))
}

export function invalidateStorageCache(key) {
  if (key) parsedCache.delete(key)
  else parsedCache.clear()
}

export function normalizeChatKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('@')) return raw.toLowerCase()
  return raw.replace(/^-/, '')
}

export function chatKeyCandidates(value) {
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

export function chatValueFromRow(row) {
  return String(chatId(row) || chatUsername(row) || '')
}

export function chatLabelFromRow(row) {
  const title = chatTitle(row)
  const username = chatUsername(row)
  const id = chatId(row)
  const parts = []
  if (title) parts.push(title)
  if (username) parts.push('@' + username)
  if (id) parts.push(String(id))
  return parts.join(' / ') || String(id || username || '')
}

export function getExportMemory(ns = nsKey()) {
  const all = readJson(EXPORT_MEMORY_KEY, {})
  return all[ns] || { last: null, chats: {}, records: [] }
}

export function setExportMemory(memory, ns = nsKey()) {
  const all = readJson(EXPORT_MEMORY_KEY, {})
  all[ns] = memory || { last: null, chats: {}, records: [] }
  writeJson(EXPORT_MEMORY_KEY, all)
}

export function getExportRecords(ns = nsKey()) {
  return getExportMemory(ns).records || []
}

export function findExportMemoryForChat(chat, ns = nsKey()) {
  const memory = getExportMemory(ns)
  const chats = memory.chats || {}
  for (const key of chatKeyCandidates(chat)) {
    if (chats[key]) return chats[key]
  }
  const normalized = normalizeChatKey(chat)
  return (memory.records || []).find(item => normalizeChatKey(item.chat) === normalized) || null
}

function getScopedHistory(key, ns = nsKey()) {
  const all = readJson(key, {})
  return all[ns] || { records: [] }
}

function setScopedHistory(key, history, ns = nsKey()) {
  const all = readJson(key, {})
  all[ns] = history || { records: [] }
  writeJson(key, all)
}

function saveScopedRecord(key, record, ns = nsKey(), limit = 80) {
  const history = getScopedHistory(key, ns)
  const records = history.records || []
  const id = record.id || `${record.type || 'record'}_${Date.now()}`
  const next = { id, ns, time: record.time || new Date().toLocaleString(), createdAt: record.createdAt || Date.now(), ...record }
  const duplicated = records.findIndex(item => item.id === id)
  if (duplicated >= 0) records.splice(duplicated, 1)
  history.records = [next, ...records].slice(0, limit)
  setScopedHistory(key, history, ns)
  return next
}

export function getForwardRecords(ns = nsKey()) {
  return getScopedHistory(FORWARD_HISTORY_KEY, ns).records || []
}

export function saveForwardRecord(record, ns = nsKey()) {
  return saveScopedRecord(FORWARD_HISTORY_KEY, { type: 'forward', ...record }, ns)
}

export function findLastForwardForChat(chat, ns = nsKey()) {
  const normalized = normalizeChatKey(chat)
  return getForwardRecords(ns).find(item => normalizeChatKey(item.peer || item.to || item.targetChat) === normalized) || null
}

export function getUploadRecords(ns = nsKey()) {
  return getScopedHistory(UPLOAD_HISTORY_KEY, ns).records || []
}

export function saveUploadRecord(record, ns = nsKey()) {
  return saveScopedRecord(UPLOAD_HISTORY_KEY, { type: 'upload', ...record }, ns)
}

export function getDownloadRecords(ns = nsKey()) {
  return getScopedHistory(DOWNLOAD_HISTORY_KEY, ns).records || []
}

export function saveDownloadRecord(record, ns = nsKey()) {
  return saveScopedRecord(DOWNLOAD_HISTORY_KEY, { type: 'download', ...record }, ns)
}

export function findLastUploadForChat(chat, ns = nsKey()) {
  const normalized = normalizeChatKey(chat)
  return getUploadRecords(ns).find(item => normalizeChatKey(item.chat || item.targetChat) === normalized) || null
}

function getChatPrefs(ns = nsKey()) {
  const all = readJson(CHAT_PREFS_KEY, {})
  return all[ns] || { favorites: {}, recent: [] }
}

function setChatPrefs(prefs, ns = nsKey()) {
  const all = readJson(CHAT_PREFS_KEY, {})
  all[ns] = prefs || { favorites: {}, recent: [] }
  writeJson(CHAT_PREFS_KEY, all)
}

export function getFavoriteMap(ns = nsKey()) {
  return getChatPrefs(ns).favorites || {}
}

export function isFavoriteChat(value, ns = nsKey()) {
  const key = normalizeChatKey(value)
  return Boolean(key && getFavoriteMap(ns)[key])
}

export function toggleFavoriteChat(rowOrValue, ns = nsKey()) {
  const value = typeof rowOrValue === 'object' ? chatValueFromRow(rowOrValue) : rowOrValue
  const key = normalizeChatKey(value)
  if (!key) return false
  const prefs = getChatPrefs(ns)
  if (!prefs.favorites) prefs.favorites = {}
  if (prefs.favorites[key]) {
    delete prefs.favorites[key]
    setChatPrefs(prefs, ns)
    return false
  }
  const label = typeof rowOrValue === 'object' ? chatLabelFromRow(rowOrValue) : String(rowOrValue)
  prefs.favorites[key] = { key, value: String(value), label, updatedAt: Date.now() }
  setChatPrefs(prefs, ns)
  return true
}

export function getRecentChats(ns = nsKey()) {
  return getChatPrefs(ns).recent || []
}

export function touchRecentChat(rowOrValue, ns = nsKey()) {
  const value = typeof rowOrValue === 'object' ? chatValueFromRow(rowOrValue) : rowOrValue
  const key = normalizeChatKey(value)
  if (!key) return
  const label = typeof rowOrValue === 'object' ? chatLabelFromRow(rowOrValue) : String(rowOrValue)
  const prefs = getChatPrefs(ns)
  const recent = (prefs.recent || []).filter(item => item.key !== key)
  prefs.recent = [{ key, value: String(value), label, updatedAt: Date.now() }, ...recent].slice(0, 30)
  setChatPrefs(prefs, ns)
}

export function chatSortScore(row, ns = nsKey()) {
  const key = normalizeChatKey(chatValueFromRow(row))
  const fav = getFavoriteMap(ns)
  if (fav[key]) return 0
  const recentIndex = getRecentChats(ns).findIndex(item => item.key === key)
  if (recentIndex >= 0) return 10 + recentIndex
  return 1000
}

export function sortChatsForUse(chats, ns = nsKey()) {
  const rows = chats || []
  if (!rows.length) return []

  // 先一次性算好每行的排序键，再排序。
  // 原来在比较函数里现算 score 和 label，n 条对话要做 O(n log n) 次
  // 收藏查找 + 最近列表线性扫描 + 标签拼接，几千条时明显卡顿。
  const favorites = getFavoriteMap(ns)
  const recentRank = new Map()
  getRecentChats(ns).forEach((item, index) => {
    if (!recentRank.has(item.key)) recentRank.set(item.key, index)
  })

  const decorated = rows.map(row => {
    const key = normalizeChatKey(chatValueFromRow(row))
    let score = 1000
    if (favorites[key]) score = 0
    else if (recentRank.has(key)) score = 10 + recentRank.get(key)
    return { row, score, label: chatLabelFromRow(row) }
  })

  const collator = new Intl.Collator('zh-Hans-CN')
  decorated.sort((a, b) => (a.score - b.score) || collator.compare(a.label, b.label))
  return decorated.map(item => item.row)
}

export function formatTime(value) {
  if (!value) return ''
  if (typeof value === 'number') return new Date(value).toLocaleString()
  return String(value)
}
