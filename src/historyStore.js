import { appState } from './state'
import { chatId, chatTitle, chatUsername } from './chatCache'
import localStorage from './storage'

export const EXPORT_MEMORY_KEY = 'hopetdl.export.memory.v1'
export const FORWARD_HISTORY_KEY = 'hopetdl.forward.history.v1'
export const UPLOAD_HISTORY_KEY = 'hopetdl.upload.history.v1'
export const DOWNLOAD_HISTORY_KEY = 'hopetdl.download.history.v1'
export const COMMENT_FORWARD_HISTORY_KEY = 'hopetdl.commentforward.history.v1'
export const CHAT_PREFS_KEY = 'hopetdl.chat.prefs.v1'
export const CHAT_CATEGORIES_KEY = 'hopetdl.chat.categories.v1'

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
  const memory = all[ns] || { last: null, chats: {}, records: [] }
  return { ...memory, records: dedupeExportRecords(memory.records || []) }
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
  const history = all[ns] || { records: [] }
  return { ...history, records: dedupeScopedRecords(history.records || []) }
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
  history.records = [next, ...records.filter(item => item.id !== id && scopedRecordKey(item) !== scopedRecordKey(next))].slice(0, limit)
  setScopedHistory(key, history, ns)
  return next
}

function scopedRecordKey(record) {
  return record.command ? `command:${record.command}` : `id:${record.id || ''}`
}

function dedupeScopedRecords(records) {
  const seen = new Set()
  return records.filter(record => {
    const key = scopedRecordKey(record)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function dedupeExportRecords(records) {
  const seen = new Set()
  return records.filter(record => {
    const key = record.output ? `output:${record.output}` : `command:${record.command || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeExportRecord(records, record, limit = 30) {
  return dedupeExportRecords([record, ...(records || [])]).slice(0, limit)
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

// 评论区顺序转发的参数最多（二十来个开关），却是原来唯一不留历史的任务，
// 每次都得从头重填。
export function getCommentForwardRecords(ns = nsKey()) {
  return getScopedHistory(COMMENT_FORWARD_HISTORY_KEY, ns).records || []
}

export function saveCommentForwardRecord(record, ns = nsKey()) {
  return saveScopedRecord(COMMENT_FORWARD_HISTORY_KEY, { type: 'comment-forward', ...record }, ns)
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
  appState.chatPrefsVersion += 1
}

function getChatCategoryState(ns = nsKey()) {
  const all = readJson(CHAT_CATEGORIES_KEY, {})
  const state = all[ns] || { categories: [], assignments: {} }
  return {
    categories: Array.isArray(state.categories) ? state.categories : [],
    assignments: state.assignments && typeof state.assignments === 'object' ? state.assignments : {}
  }
}

function setChatCategoryState(state, ns = nsKey()) {
  const all = readJson(CHAT_CATEGORIES_KEY, {})
  all[ns] = state || { categories: [], assignments: {} }
  writeJson(CHAT_CATEGORIES_KEY, all)
}

function categoryName(value) {
  return String(value || '').trim()
}

function categoryId() {
  if (globalThis.crypto?.randomUUID) return `category_${globalThis.crypto.randomUUID()}`
  return `category_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function chatCategoryKey(rowOrValue) {
  const value = typeof rowOrValue === 'object' ? chatValueFromRow(rowOrValue) : rowOrValue
  return normalizeChatKey(value)
}

export function getChatCategories(ns = nsKey()) {
  return getChatCategoryState(ns).categories.slice()
}

export function createChatCategory(value, ns = nsKey()) {
  const name = categoryName(value)
  if (!name) throw new Error('分类名称不能为空')
  const state = getChatCategoryState(ns)
  if (state.categories.some(item => categoryName(item.name).toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('分类名称已存在')
  }
  const item = { id: categoryId(), name, createdAt: Date.now() }
  state.categories.push(item)
  setChatCategoryState(state, ns)
  return item
}

export function renameChatCategory(id, value, ns = nsKey()) {
  const name = categoryName(value)
  if (!name) throw new Error('分类名称不能为空')
  const state = getChatCategoryState(ns)
  const item = state.categories.find(category => category.id === id)
  if (!item) return null
  if (state.categories.some(category => category.id !== id && categoryName(category.name).toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('分类名称已存在')
  }
  item.name = name
  item.updatedAt = Date.now()
  setChatCategoryState(state, ns)
  return { ...item }
}

export function deleteChatCategory(id, ns = nsKey()) {
  const state = getChatCategoryState(ns)
  const nextCategories = state.categories.filter(category => category.id !== id)
  if (nextCategories.length === state.categories.length) return false
  const assignments = {}
  for (const [key, ids] of Object.entries(state.assignments)) {
    const nextIds = (Array.isArray(ids) ? ids : []).filter(categoryIdValue => categoryIdValue !== id)
    if (nextIds.length) assignments[key] = nextIds
  }
  setChatCategoryState({ categories: nextCategories, assignments }, ns)
  return true
}

export function getChatCategoryIds(rowOrValue, ns = nsKey()) {
  const key = chatCategoryKey(rowOrValue)
  if (!key) return []
  const state = getChatCategoryState(ns)
  const validIds = new Set(state.categories.map(item => item.id))
  return (Array.isArray(state.assignments[key]) ? state.assignments[key] : []).filter(id => validIds.has(id))
}

export function setChatCategoryIds(rowOrValue, ids, ns = nsKey()) {
  const key = chatCategoryKey(rowOrValue)
  if (!key) return []
  const state = getChatCategoryState(ns)
  const validIds = new Set(state.categories.map(item => item.id))
  const nextIds = Array.from(new Set(Array.isArray(ids) ? ids : [])).filter(id => validIds.has(id))
  if (nextIds.length) state.assignments[key] = nextIds
  else delete state.assignments[key]
  setChatCategoryState(state, ns)
  return nextIds
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
