<script setup>
import { ref, computed, onMounted } from 'vue'
import { message } from '../../ui/naive'
import { appState } from '../../state'
import { getCommentForwardRecords, getDownloadRecords, getExportRecords, getForwardRecords, getUploadRecords } from '../../historyStore'

const activeTab = ref('exports')
const refreshKey = ref(0)

const exportsRows = computed(() => { refreshKey.value; return getExportRecords() })
const forwardRows = computed(() => { refreshKey.value; return getForwardRecords() })
const downloadRows = computed(() => { refreshKey.value; return getDownloadRecords() })
const uploadRows = computed(() => { refreshKey.value; return getUploadRecords() })
const commentForwardRows = computed(() => { refreshKey.value; return getCommentForwardRecords() })
const currentNamespace = computed(() => String(appState.config?.ns || 'hope'))

function refresh() { refreshKey.value++ }

function copyText(text) {
  navigator.clipboard.writeText(String(text || '')).then(() => message.success('已复制命令'))
}

function applyExport(row) {
  appState.selectedExportRecord = row
  appState.newTaskKind = 'export'
  appState.activeView = 'newTask'
}

function applyForward(row) {
  appState.selectedForwardRecord = row
  appState.newTaskKind = 'forward'
  appState.activeView = 'newTask'
}

function applyUpload(row) {
  appState.selectedUploadRecord = row
  appState.newTaskKind = 'upload'
  appState.activeView = 'newTask'
}

function applyCommentForward(row) {
  appState.selectedCommentForwardRecord = row
  appState.newTaskKind = 'commentForward'
  appState.activeView = 'newTask'
}

function applyDownload(row) {
  appState.selectedDownloadRecord = row
  appState.newTaskKind = 'download'
  appState.activeView = 'newTask'
}

async function showFile(filePath) {
  if (!filePath) {
    message.info('没有可打开的文件路径')
    return
  }
  if(/^https?:\/\//i.test(filePath)){message.info('此来源是消息链接，没有本地文件');return}
  try{await window.tdlApi?.showItemInFolder(filePath)}catch(error){message.error(String(error))}
}

async function openPath(path) {
  if (!path) {
    message.info('没有可打开的路径')
    return
  }
  const result = await window.tdlApi.openPath(path)
  if (result && !result.ok) message.error(result.message || '打开失败')
}

onMounted(refresh)
</script>

<template>

  <div class="card">
    <div class="history-toolbar">
      <n-tabs v-model:value="activeTab" style="flex:1; min-width:280px;">
        <n-tab-pane :tab="`导出历史 ${exportsRows.length}`" name="exports" />
        <n-tab-pane :tab="`转发历史 ${forwardRows.length}`" name="forwards" />
        <n-tab-pane :tab="`下载历史 ${downloadRows.length}`" name="downloads" />
        <n-tab-pane :tab="`上传历史 ${uploadRows.length}`" name="uploads" />
        <n-tab-pane :tab="`评论区转发 ${commentForwardRows.length}`" name="commentForwards" />
      </n-tabs>
      <n-tag size="small" :bordered="false">ns: {{ currentNamespace }}</n-tag>
      <n-button @click="refresh">刷新历史</n-button>
    </div>

    <div v-if="activeTab === 'exports'" class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="width:170px;">源对话</th>
            <th style="width:150px;">本次范围</th>
            <th style="width:110px;">最大ID</th>
            <th style="width:210px;">下次建议范围</th>
            <th style="min-width:280px;">输出文件</th>
            <th style="width:290px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!exportsRows.length"><td colspan="7" class="empty-cell">暂无导出记录</td></tr>
          <tr v-for="row in exportsRows" :key="`${row.time}-${row.output}`">
            <td>{{ row.time }}</td>
            <td>{{ row.chat }}</td>
            <td>{{ row.usedInput }}</td>
            <td>{{ row.maxId }}</td>
            <td>{{ row.input }}</td>
            <td class="truncate-cell link-like" title="点击复制路径" @click="copyText(row.output)">{{ row.output }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" type="primary" secondary @click="applyExport(row)">套用</n-button>
                <n-button size="small" @click="copyText(row.command)">复制命令</n-button>
                <n-button size="small" @click="showFile(row.output)">打开位置</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>

    <div v-if="activeTab === 'forwards'" class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="min-width:240px;">来源</th>
            <th style="min-width:180px;">目标聊天</th>
            <th style="width:170px;">话题</th>
            <th style="width:90px;">模式</th>
            <th style="width:90px;">Dry Run</th>
            <th style="width:310px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!forwardRows.length"><td colspan="7" class="empty-cell">暂无转发记录</td></tr>
          <tr v-for="row in forwardRows" :key="`${row.time}-${row.from}`">
            <td>{{ row.time }}</td>
            <td class="truncate-cell link-like" title="点击复制来源" @click="copyText(row.from)">{{ row.from }}</td>
            <td class="truncate-cell">{{ row.targetLabel }}</td>
            <td class="truncate-cell">{{ row.threadLabel }}</td>
            <td>{{ row.mode }}</td>
            <td>{{ row.dryRun ? '是' : '否' }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" type="primary" secondary @click="applyForward(row)">套用</n-button>
                <n-button size="small" @click="copyText(row.command)">复制命令</n-button>
                <n-button size="small" @click="showFile(row.from)">打开来源</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>

    <div v-if="activeTab === 'downloads'" class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="width:100px;">来源</th>
            <th style="min-width:220px;">目录</th>
            <th style="min-width:280px;">摘要</th>
            <th style="width:310px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!downloadRows.length"><td colspan="5" class="empty-cell">暂无下载记录</td></tr>
          <tr v-for="row in downloadRows" :key="row.id">
            <td>{{ row.time }}</td>
            <td>{{ row.sourceType === 'file' ? '导出文件' : '消息链接' }}</td>
            <td class="truncate-cell link-like" title="点击复制路径" @click="copyText(row.dir)">{{ row.dir || '-' }}</td>
            <td class="truncate-cell">{{ row.command }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" type="primary" secondary @click="applyDownload(row)">套用</n-button>
                <n-button size="small" @click="copyText(row.command)">复制命令</n-button>
                <n-button size="small" @click="openPath(row.dir)" :disabled="!row.dir">打开目录</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>

    <div v-if="activeTab === 'commentForwards'" class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="min-width:150px;">源对话</th>
            <th style="min-width:150px;">目标</th>
            <th style="width:110px;">话题</th>
            <th style="width:150px;">范围</th>
            <th style="width:120px;">关键词</th>
            <th style="width:200px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!commentForwardRows.length"><td colspan="7" class="empty-cell">暂无评论区转发记录</td></tr>
          <tr v-for="row in commentForwardRows" :key="row.id">
            <td>{{ row.time }}</td>
            <td class="truncate-cell">{{ row.sourceChat }}</td>
            <td class="truncate-cell">{{ row.targetChat || '-' }}</td>
            <td>{{ row.targetTopicId || '-' }}</td>
            <td>{{ row.startId || '起' }} - {{ row.endId || '止' }}</td>
            <td>{{ row.blockKeywordsText ? '有' : '无' }}</td>
            <td>
              <div class="action-row dense">
                <n-button size="small" type="primary" secondary @click="applyCommentForward(row)">套用</n-button>
                <n-button size="small" @click="copyText(row.command)">复制命令</n-button>
                <n-button size="small" :disabled="!row.workDir" @click="openPath(row.workDir)">打开目录</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>

    <div v-if="activeTab === 'uploads'" class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th style="width:170px;">时间</th>
            <th style="min-width:260px;">上传路径</th>
            <th style="width:170px;">目标聊天</th>
            <th style="width:120px;">话题</th>
            <th style="min-width:160px;">Caption</th>
            <th style="width:150px;">选项</th>
            <th style="width:310px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!uploadRows.length"><td colspan="7" class="empty-cell">暂无上传记录</td></tr>
          <tr v-for="row in uploadRows" :key="`${row.time}-${row.path}`">
            <td>{{ row.time }}</td>
            <td class="truncate-cell link-like" title="点击复制路径" @click="copyText(row.path)">{{ row.path }}</td>
            <td>{{ row.chat }}</td>
            <td>{{ row.topic }}</td>
            <td class="truncate-cell">{{ row.caption }}</td>
            <td><span class="mini-muted">{{ row.photo ? '图片 ' : '' }}{{ row.remove ? '上传后删除' : '' }}</span></td>
            <td>
              <div class="action-row dense">
                <n-button size="small" type="primary" secondary @click="applyUpload(row)">套用</n-button>
                <n-button size="small" @click="copyText(row.command)">复制命令</n-button>
                <n-button size="small" @click="openPath(row.path)">打开路径</n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>
</template>
