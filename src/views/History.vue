<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { appState } from '../main'
import { getExportRecords, getForwardRecords, getUploadRecords } from '../historyStore'

const activeTab = ref('exports')
const refreshKey = ref(0)

const exportsRows = computed(() => { refreshKey.value; return getExportRecords() })
const forwardRows = computed(() => { refreshKey.value; return getForwardRecords() })
const uploadRows = computed(() => { refreshKey.value; return getUploadRecords() })

function refresh() { refreshKey.value++ }

function copyText(text) {
  navigator.clipboard.writeText(String(text || '')).then(() => ElMessage.success('已复制命令'))
}

function applyExport(row) {
  appState.selectedExportRecord = row
  appState.activeView = 'export'
}

function applyForward(row) {
  appState.selectedForwardRecord = row
  appState.activeView = 'forward'
}

function applyUpload(row) {
  appState.selectedUploadRecord = row
  appState.activeView = 'upload'
}

function showFile(filePath) {
  if (!filePath) {
    ElMessage.info('没有可打开的文件路径')
    return
  }
  window.tdlApi.showItemInFolder(filePath)
}

async function openPath(path) {
  if (!path) {
    ElMessage.info('没有可打开的路径')
    return
  }
  const result = await window.tdlApi.openPath(path)
  if (result && !result.ok) ElMessage.error(result.message || '打开失败')
}

onMounted(refresh)
</script>

<template>
  <h1 class="page-title">历史记录</h1>
  <p class="page-desc">集中查看导出、转发、上传记录。可以套用参数、复制命令、打开文件位置。</p>

  <div class="card">
    <div class="history-toolbar">
      <el-tabs v-model="activeTab" style="flex:1; min-width:280px;">
        <el-tab-pane :label="`导出历史 ${exportsRows.length}`" name="exports" />
        <el-tab-pane :label="`转发历史 ${forwardRows.length}`" name="forwards" />
        <el-tab-pane :label="`上传历史 ${uploadRows.length}`" name="uploads" />
      </el-tabs>
      <el-button @click="refresh">刷新历史</el-button>
    </div>

    <el-table v-if="activeTab === 'exports'" :data="exportsRows" style="width:100%" border stripe empty-text="暂无导出记录">
      <el-table-column prop="time" label="时间" width="170" />
      <el-table-column prop="chat" label="源聊天 -c" width="170" />
      <el-table-column prop="usedInput" label="本次 -i" width="150" />
      <el-table-column prop="maxId" label="最大ID" width="110" />
      <el-table-column prop="input" label="下次建议 -i" width="210" />
      <el-table-column prop="output" label="输出文件" min-width="280" show-overflow-tooltip />
      <el-table-column label="操作" width="290" fixed="right">
        <template #default="scope">
          <div class="action-row">
            <el-button size="small" type="primary" plain @click="applyExport(scope.row)">套用</el-button>
            <el-button size="small" @click="copyText(scope.row.command)">复制命令</el-button>
            <el-button size="small" @click="showFile(scope.row.output)">打开位置</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-table v-if="activeTab === 'forwards'" :data="forwardRows" style="width:100%" border stripe empty-text="暂无转发记录">
      <el-table-column prop="time" label="时间" width="170" />
      <el-table-column prop="from" label="来源" min-width="240" show-overflow-tooltip />
      <el-table-column prop="targetLabel" label="目标聊天" min-width="180" show-overflow-tooltip />
      <el-table-column prop="threadLabel" label="话题" width="170" show-overflow-tooltip />
      <el-table-column prop="mode" label="模式" width="90" />
      <el-table-column label="Dry Run" width="90">
        <template #default="scope">{{ scope.row.dryRun ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="310" fixed="right">
        <template #default="scope">
          <div class="action-row">
            <el-button size="small" type="primary" plain @click="applyForward(scope.row)">套用</el-button>
            <el-button size="small" @click="copyText(scope.row.command)">复制命令</el-button>
            <el-button size="small" @click="showFile(scope.row.from)">打开来源</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-table v-if="activeTab === 'uploads'" :data="uploadRows" style="width:100%" border stripe empty-text="暂无上传记录">
      <el-table-column prop="time" label="时间" width="170" />
      <el-table-column prop="path" label="上传路径" min-width="260" show-overflow-tooltip />
      <el-table-column prop="chat" label="目标聊天" width="170" />
      <el-table-column prop="topic" label="话题" width="120" />
      <el-table-column prop="caption" label="Caption" min-width="160" show-overflow-tooltip />
      <el-table-column label="选项" width="150">
        <template #default="scope">
          <span class="mini-muted">{{ scope.row.photo ? '图片 ' : '' }}{{ scope.row.remove ? '上传后删除' : '' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="310" fixed="right">
        <template #default="scope">
          <div class="action-row">
            <el-button size="small" type="primary" plain @click="applyUpload(scope.row)">套用</el-button>
            <el-button size="small" @click="copyText(scope.row.command)">复制命令</el-button>
            <el-button size="small" @click="openPath(scope.row.path)">打开路径</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
