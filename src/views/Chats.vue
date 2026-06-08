<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { commandText, runTask } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
import { appState } from '../main.js'
import { loadChatCache, chatId, chatTitle, chatUsername, chatType, chatTopics } from '../chatCache'
import { findExportMemoryForChat, findLastForwardForChat, findLastUploadForChat, isFavoriteChat, toggleFavoriteChat, touchRecentChat } from '../historyStore'

const output = ref('json')
const filter = ref('')
const search = ref('')
const chats = ref([])
const loading = ref(false)
const isFilteredLiveResult = ref(false)

const args = computed(() => {
  const a = ['chat', 'ls', '-o', output.value === 'table' ? 'table' : 'json']
  if (filter.value) a.push('--filter', filter.value)
  return a
})

const cacheMetaText = computed(() => {
  const meta = appState.chatCacheMeta || {}
  if (!meta.updatedAtText) return '暂无缓存；首次启动或点击更新缓存后会生成。'
  return `当前缓存：${meta.count || 0} 条；更新时间：${meta.updatedAtText}；自动刷新周期：${meta.ttlDays || 7} 天。`
})

const filteredChats = computed(() => {
  let rows = chats.value || []
  if (!search.value) return rows
  const kw = search.value.toLowerCase()
  return rows.filter(row => {
    const title = String(chatTitle(row)).toLowerCase()
    const username = String(chatUsername(row)).toLowerCase()
    const id = String(chatId(row)).toLowerCase()
    const type = String(chatType(row)).toLowerCase()
    return title.includes(kw) || username.includes(kw) || id.includes(kw) || type.includes(kw)
  })
})

function copyToClipboard(text) {
  navigator.clipboard.writeText(String(text)).then(() => {
    ElMessage.success('已复制')
  }).catch(() => {
    ElMessage.error('复制失败')
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
function selectForExport(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'export' }
function selectForForward(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'forward' }
function selectForUpload(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'upload' }
function toggleFav(row) {
  const next = toggleFavoriteChat(row)
  ElMessage.success(next ? '已收藏' : '已取消收藏')
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
    if (force) ElMessage.success('对话列表缓存已更新')
  } catch (err) {
    chats.value = []
    ElMessage.error('读取对话列表失败：' + (err?.message || err))
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
    ElMessage.error('按过滤条件读取失败：' + (err?.message || err))
  } finally {
    loading.value = false
  }
}

function run() {
  if (output.value === 'table') {
    runTask('chat-ls', ['chat', 'ls', '-o', 'table', ...(filter.value ? ['--filter', filter.value] : [])], '获取对话列表')
    chats.value = []
    return
  }
  if (filter.value) {
    // 有 tdl filter 时，执行一次实时读取，但不覆盖中央缓存。
    loadFilteredLiveChats()
  } else {
    // 没有 filter 时，手动刷新中央缓存；导出/转发/上传页面都会读取这份缓存。
    loadCachedChats({ force: true })
  }
}

onMounted(() => {
  if (output.value === 'json') loadCachedChats({ force: false })
})
</script>

<template>
  <h1 class="page-title">对话列表</h1>
  <p class="page-desc">
    第一次启动会自动刷新一次对话列表并写入缓存；缓存未过期前不会自动重复刷新。导出、转发、上传页面都会直接读取这里生成的缓存。
  </p>
  <div class="card">
    <el-alert
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom:16px"
      :title="cacheMetaText"
    />
    <el-form label-width="100px">
      <el-form-item label="输出格式">
        <el-radio-group v-model="output">
          <el-radio-button label="json">json</el-radio-button>
          <el-radio-button label="table">table</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="过滤表达式">
        <el-input v-model="filter" placeholder="可选，例如 Type == 'channel'。有过滤时会实时读取，但不覆盖缓存。" />
      </el-form-item>
      <el-form-item label="搜索">
        <el-input v-model="search" placeholder="在当前列表中搜索标题、用户名、ID 或类型" clearable />
      </el-form-item>
    </el-form>
    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <el-button type="primary" :loading="loading" @click="run">
        {{ output === 'table' ? '输出到日志' : filter ? '按过滤读取' : '更新对话缓存' }}
      </el-button>
      <el-button v-if="output === 'json' && !filter" :loading="loading" @click="loadCachedChats({ force: false })">读取本地缓存</el-button>
      <span v-if="isFilteredLiveResult" style="color:var(--muted); font-size:13px;">当前为过滤后的实时结果，不会影响缓存。</span>
    </div>

    <div v-if="output === 'json'" style="margin-top: 24px;">
      <el-table v-if="chats.length" :data="filteredChats" border stripe style="width: 100%;">
        <el-table-column type="expand">
          <template #default="scope">
            <div style="padding: 10px 20px;">
              <p><strong>ID:</strong> {{ chatId(scope.row) }}</p>
              <p><strong>类型:</strong> {{ chatType(scope.row) }}</p>
              <p><strong>显示名:</strong> {{ chatTitle(scope.row) }}</p>
              <p v-if="chatUsername(scope.row)"><strong>用户名:</strong> {{ chatUsername(scope.row) }}</p>
              <div v-if="chatTopics(scope.row).length">
                <p><strong>话题列表:</strong></p>
                <el-table :data="chatTopics(scope.row)" size="small" border stripe style="width: 100%; margin-left: 20px;">
                  <el-table-column prop="id" label="ID" width="100" />
                  <el-table-column prop="title" label="标题" />
                </el-table>
              </div>
              <div v-else>
                <p><em>此会话没有话题。</em></p>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="收藏" width="70" align="center">
          <template #default="scope">
            <span class="favorite-button" :class="{ off: !isFavoriteChat(chatId(scope.row)) }" @click="toggleFav(scope.row)">★</span>
          </template>
        </el-table-column>
        <el-table-column label="ID" width="200" sortable>
          <template #default="scope">
            <span v-if="chatId(scope.row)" style="cursor: pointer; color: #409EFF;" @click="copyId(chatId(scope.row))">
              {{ chatId(scope.row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="标题" sortable>
          <template #default="scope">{{ chatTitle(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="scope">
            <el-tag :type="typeTagColor(chatType(scope.row))" size="small" disable-transitions>
              {{ chatType(scope.row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用户名" width="200">
          <template #default="scope">{{ chatUsername(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="话题">
          <template #default="scope">
            <div v-if="chatTopics(scope.row).length" style="display:flex; flex-wrap:wrap; gap:4px;">
              <el-tag v-for="topic in chatTopics(scope.row)" :key="topic.id" type="info" size="small" disable-transitions>
                {{ topic.title }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="上次导出" width="210">
          <template #default="scope">
            <div v-if="exportStatus(scope.row)" class="status-stack">
              <div class="status-main">{{ exportStatus(scope.row).maxId ? '最大ID ' + exportStatus(scope.row).maxId : '-i ' + (exportStatus(scope.row).input || '未记录') }}</div>
              <div class="status-sub">{{ exportStatus(scope.row).time || '-' }}</div>
            </div>
            <span v-else class="mini-muted">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="上次转发" width="210">
          <template #default="scope">
            <div v-if="forwardStatus(scope.row)" class="status-stack">
              <div class="status-main">{{ forwardStatus(scope.row).threadLabel || forwardStatus(scope.row).thread || '无话题' }}</div>
              <div class="status-sub">{{ forwardStatus(scope.row).time || '-' }}</div>
            </div>
            <span v-else class="mini-muted">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="上次上传" width="190">
          <template #default="scope">
            <div v-if="uploadStatus(scope.row)" class="status-stack">
              <div class="status-main">{{ uploadStatus(scope.row).topic || '无话题' }}</div>
              <div class="status-sub">{{ uploadStatus(scope.row).time || '-' }}</div>
            </div>
            <span v-else class="mini-muted">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330">
          <template #default="scope">
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              <el-button size="mini" @click="copyId(chatId(scope.row))">复制ID</el-button>
              <el-button size="mini" v-if="chatUsername(scope.row)" @click="copyUsername(chatUsername(scope.row))">复制用户名</el-button>
              <el-button size="mini" type="primary" plain @click="selectForExport(scope.row)">导出</el-button>
              <el-button size="mini" type="success" plain @click="selectForForward(scope.row)">转发</el-button>
              <el-button size="mini" type="warning" plain @click="selectForUpload(scope.row)">上传</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else style="padding: 16px; color: #888;">没有数据。首次启动会自动刷新；也可以点击“更新对话缓存”。</div>
    </div>
  </div>
</template>
