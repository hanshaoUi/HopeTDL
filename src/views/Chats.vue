<script setup>
import { ref, computed, onMounted } from 'vue'
import { dialog, message } from '../ui/naive'
import { commandTextForSpec, runJob } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
import { appState } from '../state.js'
import { loadChatCache, chatId, chatTitle, chatUsername, chatType, chatTopics } from '../chatCache'
import {
  createChatCategory,
  deleteChatCategory,
  findExportMemoryForChat,
  findLastForwardForChat,
  findLastUploadForChat,
  getChatCategories,
  getChatCategoryIds,
  isFavoriteChat,
  renameChatCategory,
  setChatCategoryIds,
  toggleFavoriteChat,
  touchRecentChat
} from '../historyStore'

const output = ref('json')
const filter = ref('')
const search = ref('')
const chats = ref([])
const loading = ref(false)
const isFilteredLiveResult = ref(false)
// 过滤表达式和 table 输出是低频的高级用法，默认收起，不占主界面。
const showAdvanced = ref(false)
const showCategoryManager = ref(false)
const categoryFilter = ref('all')
const categoryDraft = ref('')
const editingCategoryId = ref('')
const editingCategoryName = ref('')
const categoryRevision = ref(0)

const categories = computed(() => {
  categoryRevision.value
  return getChatCategories()
})

const categoryOptions = computed(() => categories.value.map(category => ({
  label: category.name,
  value: category.id
})))

const spec = computed(() => ({
  kind: 'chat-list',
  output: output.value === 'table' ? 'table' : 'json',
  filter: filter.value
}))

const cacheMetaText = computed(() => {
  const meta = appState.chatCacheMeta || {}
  if (!meta.updatedAtText) return '暂无缓存；首次启动或点击更新缓存后会生成。'
  return `当前缓存：${meta.count || 0} 条；更新时间：${meta.updatedAtText}；自动刷新周期：${meta.ttlDays || 7} 天。`
})

const filteredChats = computed(() => {
  let rows = chats.value || []
  if (categoryFilter.value === 'uncategorized') {
    rows = rows.filter(row => !chatCategoryIds(row).length)
  } else if (categoryFilter.value !== 'all') {
    rows = rows.filter(row => chatCategoryIds(row).includes(categoryFilter.value))
  }
  if (search.value) {
    const kw = search.value.toLowerCase()
    rows = rows.filter(row => {
      const title = String(chatTitle(row)).toLowerCase()
      const username = String(chatUsername(row)).toLowerCase()
      const id = String(chatId(row)).toLowerCase()
      const type = String(chatType(row)).toLowerCase()
      return title.includes(kw) || username.includes(kw) || id.includes(kw) || type.includes(kw)
    })
  }
  return rows
})

const emptyFilterText = computed(() => {
  if (search.value) return `没有匹配「${search.value}」的对话。`
  if (categoryFilter.value === 'uncategorized') return '目前没有未分类的对话。'
  const category = categories.value.find(item => item.id === categoryFilter.value)
  return category ? `「${category.name}」分类中还没有对话。` : '没有符合条件的对话。'
})

function chatCategoryIds(row) {
  categoryRevision.value
  return getChatCategoryIds(row)
}

function categoryChatCount(categoryId) {
  categoryRevision.value
  return chats.value.filter(row => getChatCategoryIds(row).includes(categoryId)).length
}

function addCategory() {
  try {
    const category = createChatCategory(categoryDraft.value)
    categoryDraft.value = ''
    categoryRevision.value += 1
    message.success(`已创建分类「${category.name}」`)
  } catch (err) {
    message.error(err?.message || String(err))
  }
}

function beginRename(category) {
  editingCategoryId.value = category.id
  editingCategoryName.value = category.name
}

function cancelRename() {
  editingCategoryId.value = ''
  editingCategoryName.value = ''
}

function saveRename() {
  try {
    renameChatCategory(editingCategoryId.value, editingCategoryName.value)
    cancelRename()
    categoryRevision.value += 1
    message.success('分类已重命名')
  } catch (err) {
    message.error(err?.message || String(err))
  }
}

function removeCategory(category) {
  dialog.warning({
    title: '删除分类',
    content: `确定删除「${category.name}」吗？对话不会被删除，只会移除这个分类。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      deleteChatCategory(category.id)
      if (categoryFilter.value === category.id) categoryFilter.value = 'all'
      if (editingCategoryId.value === category.id) cancelRename()
      categoryRevision.value += 1
      message.success('分类已删除')
    }
  })
}

function updateChatCategories(row, ids) {
  setChatCategoryIds(row, ids)
  categoryRevision.value += 1
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(String(text)).then(() => {
    message.success('已复制')
  }).catch(() => {
    message.error('复制失败')
  })
}

function typeTagColor(type) {
  switch ((type || '').toLowerCase()) {
    case 'channel': return 'success'
    case 'group':
    case 'supergroup': return 'warning'
    case 'private': return 'info'
    default: return 'info'
  }
}

function copyId(id) { copyToClipboard(id) }
function copyUsername(username) { if (username) copyToClipboard(username) }
// 对话列表是发起操作的入口：选中对话后带着它跳到「新建任务」的对应类型。
function startTask(row, kind) {
  touchRecentChat(row)
  appState.selectedChat = row
  appState.newTaskKind = kind
  appState.activeView = 'newTask'
}
function selectForExport(row) { startTask(row, 'export') }
function selectForForward(row) { startTask(row, 'forward') }
function selectForUpload(row) { startTask(row, 'upload') }
function selectForCommentForward(row) { startTask(row, 'commentForward') }
function selectForDownload(row) { startTask(row, 'download') }
function toggleFav(row) {
  const next = toggleFavoriteChat(row)
  message.success(next ? '已收藏' : '已取消收藏')
}
function exportStatus(row) {
  return findExportMemoryForChat(chatId(row))
}
function forwardStatus(row) {
  return findLastForwardForChat(chatId(row))
}
function uploadStatus(row) {
  return findLastUploadForChat(chatId(row))
}

async function loadCachedChats({ force = false } = {}) {
  loading.value = true
  try {
    const result = await loadChatCache({ ensure: !force, refresh: force })
    chats.value = result
    isFilteredLiveResult.value = false
    if (force) message.success('对话列表缓存已更新')
  } catch (err) {
    chats.value = []
    message.error('读取对话列表失败：' + (err?.message || err))
  } finally {
    loading.value = false
  }
}

async function loadFilteredLiveChats() {
  loading.value = true
  try {
    const result = await window.tdlApi.listChats({ filter: filter.value })
    chats.value = Array.isArray(result) ? result : []
    isFilteredLiveResult.value = true
  } catch (err) {
    chats.value = []
    message.error('按过滤条件读取失败：' + (err?.message || err))
  } finally {
    loading.value = false
  }
}

// 把 tdl 的 table 输出打到任务日志，不动这里的列表。
function runTableOutput() {
  runJob({ ...spec.value, output: 'table' }, '获取对话列表')
}

onMounted(() => {
  if (output.value === 'json') loadCachedChats({ force: false })
})
</script>

<template>
  <header class="page-head">
    <h1 class="page-title">对话</h1>
    <p class="page-desc">从这里找到对话，直接发起导出、下载、转发或上传。列表来自本地缓存，不会每次都去问 tdl。</p>
  </header>

  <div class="chats-toolbar">
    <n-input v-model:value="search" placeholder="搜索标题、用户名、ID 或类型" clearable size="large" class="chats-search" />
    <n-button :loading="loading" @click="loadCachedChats({ force: true })">更新缓存</n-button>
    <n-button quaternary @click="showAdvanced = !showAdvanced">{{ showAdvanced ? '收起' : '过滤表达式' }}</n-button>
  </div>
  <div class="chats-meta">{{ cacheMetaText }}</div>

  <div class="chat-category-bar">
    <div class="chat-category-filters" role="group" aria-label="按本地分类筛选">
      <n-button size="small" :type="categoryFilter === 'all' ? 'primary' : 'default'" :secondary="categoryFilter === 'all'" @click="categoryFilter = 'all'">
        全部
      </n-button>
      <n-button size="small" :type="categoryFilter === 'uncategorized' ? 'primary' : 'default'" :secondary="categoryFilter === 'uncategorized'" @click="categoryFilter = 'uncategorized'">
        未分类
      </n-button>
      <n-button
        v-for="category in categories"
        :key="category.id"
        size="small"
        :type="categoryFilter === category.id ? 'primary' : 'default'"
        :secondary="categoryFilter === category.id"
        @click="categoryFilter = category.id"
      >
        {{ category.name }} · {{ categoryChatCount(category.id) }}
      </n-button>
    </div>
    <n-button size="small" @click="showCategoryManager = !showCategoryManager">
      {{ showCategoryManager ? '收起管理' : '管理分类' }}
    </n-button>
  </div>

  <section v-if="showCategoryManager" class="card chat-category-manager" aria-labelledby="chat-category-title">
    <div class="chat-category-manager-head">
      <div>
        <h2 id="chat-category-title" class="chat-category-title">本地分类</h2>
        <p class="mini-muted">分类只保存在当前设备，并跟随当前 namespace。</p>
      </div>
      <div class="chat-category-create">
        <n-input
          v-model:value="categoryDraft"
          maxlength="24"
          placeholder="输入分类名称"
          @keyup.enter="addCategory"
        />
        <n-button type="primary" :disabled="!categoryDraft.trim()" @click="addCategory">新建</n-button>
      </div>
    </div>

    <div v-if="!categories.length" class="chat-category-empty">还没有分类，先在右侧新建一个。</div>
    <ul v-else class="chat-category-list">
      <li v-for="category in categories" :key="category.id" class="chat-category-item">
        <template v-if="editingCategoryId === category.id">
          <n-input v-model:value="editingCategoryName" maxlength="24" size="small" @keyup.enter="saveRename" @keyup.esc="cancelRename" />
          <n-button size="small" type="primary" :disabled="!editingCategoryName.trim()" @click="saveRename">保存</n-button>
          <n-button size="small" quaternary @click="cancelRename">取消</n-button>
        </template>
        <template v-else>
          <span class="chat-category-item-name">{{ category.name }}</span>
          <span class="mini-muted">{{ categoryChatCount(category.id) }} 个对话</span>
          <n-button size="tiny" quaternary @click="beginRename(category)">重命名</n-button>
          <n-button size="tiny" quaternary type="error" @click="removeCategory(category)">删除</n-button>
        </template>
      </li>
    </ul>
  </section>

  <div v-if="showAdvanced" class="card chats-advanced">
    <div class="field-row">
      <label class="field-label">过滤表达式</label>
      <n-input v-model:value="filter" placeholder="例如 Type == 'channel'。有过滤时实时读取，不覆盖缓存。" />
      <n-button :loading="loading" :disabled="!filter" @click="loadFilteredLiveChats">按过滤读取</n-button>
    </div>
    <div class="field-row">
      <label class="field-label">输出为 table</label>
      <span class="mini-muted">把 tdl 的表格输出打到任务日志里，不改变这里的列表。</span>
      <n-button @click="runTableOutput">输出到日志</n-button>
    </div>
    <CommandPreview :command="commandTextForSpec(spec)" />
  </div>

  <div class="chats-count">
    显示 {{ filteredChats.length }} / {{ chats.length }} 条
    <span v-if="isFilteredLiveResult" class="mini-muted">· 当前是过滤后的实时结果，未写入缓存</span>
  </div>

  <div v-if="!chats.length" class="empty-cell card">还没有对话数据。点「更新缓存」拉取一次。</div>
  <div v-else-if="!filteredChats.length" class="empty-cell card">{{ emptyFilterText }}</div>

  <ul v-else class="chat-list">
    <li v-for="row in filteredChats" :key="String(chatId(row) || chatTitle(row))" class="chat-card">
      <button
        type="button"
        class="chat-fav"
        :class="{ off: !isFavoriteChat(chatId(row)) }"
        :title="isFavoriteChat(chatId(row)) ? '取消收藏' : '收藏'"
        @click="toggleFav(row)"
      >★</button>

      <div class="chat-main">
        <div class="chat-line">
          <span class="chat-name">{{ chatTitle(row) || '未命名对话' }}</span>
          <n-tag size="small" :type="typeTagColor(chatType(row))">{{ chatType(row) || 'unknown' }}</n-tag>
          <span v-if="chatUsername(row)" class="chat-username">@{{ chatUsername(row) }}</span>
          <span v-if="chatTopics(row).length" class="chat-topics">话题 {{ chatTopics(row).length }}</span>
        </div>
        <div class="chat-line chat-sub">
          <span class="link-like" title="点击复制 ID" @click="copyId(chatId(row))">{{ chatId(row) }}</span>
          <span v-if="exportStatus(row)" class="chat-stat">
            上次导出 {{ exportStatus(row).maxId ? '到 ' + exportStatus(row).maxId : exportStatus(row).input || '' }}
          </span>
          <span v-if="forwardStatus(row)" class="chat-stat">
            上次转发 {{ forwardStatus(row).threadLabel || '无话题' }}
          </span>
          <span v-if="uploadStatus(row)" class="chat-stat">上次上传 {{ uploadStatus(row).time }}</span>
        </div>
      </div>

      <div class="chat-category-picker">
        <n-select
          multiple
          clearable
          size="small"
          :max-tag-count="1"
          :options="categoryOptions"
          :value="chatCategoryIds(row)"
          :placeholder="categories.length ? '添加分类' : '先建分类'"
          :disabled="!categories.length"
          @update:value="ids => updateChatCategories(row, ids)"
        />
      </div>

      <div class="chat-actions">
        <n-button size="small" secondary type="primary" @click="selectForExport(row)">导出</n-button>
        <n-button size="small" secondary @click="selectForDownload(row)">下载</n-button>
        <n-button size="small" secondary type="success" @click="selectForForward(row)">转发</n-button>
        <n-button size="small" secondary type="info" @click="selectForCommentForward(row)">评论区</n-button>
        <n-button size="small" secondary type="warning" @click="selectForUpload(row)">上传</n-button>
      </div>
    </li>
  </ul>
</template>
