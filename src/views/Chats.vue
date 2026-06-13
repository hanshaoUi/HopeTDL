<script setup>
import { ref, computed, onMounted } from 'vue'
import { message } from '../ui/naive'
import { commandText, runTask } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
import { appState } from '../state.js'
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
function selectForExport(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'export' }
function selectForForward(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'forward' }
function selectForUpload(row) { touchRecentChat(row); appState.selectedChat = row; appState.activeView = 'upload' }
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
    <n-alert
      type="info"
      
      :show-icon="true" :closable="false"
      style="margin-bottom:16px"
      :title="cacheMetaText"
    />
    <n-form label-width="100px">
      <n-form-item label="输出格式">
        <n-radio-group v-model:value="output">
          <n-radio-button value="json">json</n-radio-button>
          <n-radio-button value="table">table</n-radio-button>
        </n-radio-group>
      </n-form-item>
      <n-form-item label="过滤表达式">
        <n-input v-model:value="filter" placeholder="可选，例如 Type == 'channel'。有过滤时会实时读取，但不覆盖缓存。" />
      </n-form-item>
      <n-form-item label="搜索">
        <n-input v-model:value="search" placeholder="在当前列表中搜索标题、用户名、ID 或类型" clearable />
      </n-form-item>
    </n-form>
    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <n-button type="primary" :loading="loading" @click="run">
        {{ output === 'table' ? '输出到日志' : filter ? '按过滤读取' : '更新对话缓存' }}
      </n-button>
      <n-button v-if="output === 'json' && !filter" :loading="loading" @click="loadCachedChats({ force: false })">读取本地缓存</n-button>
      <span v-if="isFilteredLiveResult" style="color:var(--muted); font-size:13px;">当前为过滤后的实时结果，不会影响缓存。</span>
    </div>

    <div v-if="output === 'json'" style="margin-top: 24px;">
      <div class="table-meta">
        当前显示 {{ filteredChats.length }} / {{ chats.length }} 条
      </div>
      <div v-if="chats.length" class="table-scroll">
        <n-table :bordered="false" striped>
          <thead>
            <tr>
              <th style="width:70px; text-align:center;">收藏</th>
              <th style="width:190px;">ID</th>
              <th style="min-width:220px;">标题</th>
              <th style="width:120px;">类型</th>
              <th style="width:180px;">用户名</th>
              <th style="min-width:180px;">话题</th>
              <th style="width:210px;">上次导出</th>
              <th style="width:210px;">上次转发</th>
              <th style="width:190px;">上次上传</th>
              <th style="width:330px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredChats.length">
              <td colspan="10" class="empty-cell">没有匹配当前搜索条件的对话。</td>
            </tr>
            <tr v-for="row in filteredChats" :key="String(chatId(row) || chatTitle(row))">
              <td style="text-align:center;">
                <span class="favorite-button" :class="{ off: !isFavoriteChat(chatId(row)) }" @click="toggleFav(row)">★</span>
              </td>
              <td>
                <span v-if="chatId(row)" class="link-like" @click="copyId(chatId(row))">{{ chatId(row) }}</span>
              </td>
              <td>
                <div class="table-title">{{ chatTitle(row) }}</div>
                <details class="row-details">
                  <summary>详情</summary>
                  <p><strong>ID:</strong> {{ chatId(row) }}</p>
                  <p><strong>类型:</strong> {{ chatType(row) }}</p>
                  <p v-if="chatUsername(row)"><strong>用户名:</strong> {{ chatUsername(row) }}</p>
                  <div v-if="chatTopics(row).length" class="topic-list">
                    <n-tag v-for="topic in chatTopics(row)" :key="topic.id" type="info" size="small">{{ topic.title || topic.id }}</n-tag>
                  </div>
                  <p v-else><em>此会话没有话题。</em></p>
                </details>
              </td>
              <td>
                <n-tag :type="typeTagColor(chatType(row))" size="small">{{ chatType(row) }}</n-tag>
              </td>
              <td>{{ chatUsername(row) }}</td>
              <td>
                <div v-if="chatTopics(row).length" class="topic-list">
                  <n-tag v-for="topic in chatTopics(row)" :key="topic.id" type="info" size="small">{{ topic.title }}</n-tag>
                </div>
              </td>
              <td>
                <div v-if="exportStatus(row)" class="status-stack">
                  <div class="status-main">{{ exportStatus(row).maxId ? '最大ID ' + exportStatus(row).maxId : '-i ' + (exportStatus(row).input || '未记录') }}</div>
                  <div class="status-sub">{{ exportStatus(row).time || '-' }}</div>
                </div>
                <span v-else class="mini-muted">暂无</span>
              </td>
              <td>
                <div v-if="forwardStatus(row)" class="status-stack">
                  <div class="status-main">{{ forwardStatus(row).threadLabel || forwardStatus(row).thread || '无话题' }}</div>
                  <div class="status-sub">{{ forwardStatus(row).time || '-' }}</div>
                </div>
                <span v-else class="mini-muted">暂无</span>
              </td>
              <td>
                <div v-if="uploadStatus(row)" class="status-stack">
                  <div class="status-main">{{ uploadStatus(row).topic || '无话题' }}</div>
                  <div class="status-sub">{{ uploadStatus(row).time || '-' }}</div>
                </div>
                <span v-else class="mini-muted">暂无</span>
              </td>
              <td>
                <div class="action-row dense">
                  <n-button size="tiny" @click="copyId(chatId(row))">复制ID</n-button>
                  <n-button size="tiny" v-if="chatUsername(row)" @click="copyUsername(chatUsername(row))">复制用户名</n-button>
                  <n-button size="tiny" type="primary" secondary @click="selectForExport(row)">导出</n-button>
                  <n-button size="tiny" type="success" secondary @click="selectForForward(row)">转发</n-button>
                  <n-button size="tiny" type="warning" secondary @click="selectForUpload(row)">上传</n-button>
                </div>
              </td>
            </tr>
          </tbody>
        </n-table>
      </div>
      <div v-else class="empty-cell">没有数据。首次启动会自动刷新；也可以点击“更新对话缓存”。</div>
    </div>
  </div>
</template>
