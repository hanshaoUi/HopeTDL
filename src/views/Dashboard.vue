<script setup>
import { computed } from 'vue'
import { appState } from '../main'
import { runTask } from '../utils'
const latestTasks = computed(() => appState.tasks.slice(0, 8))
function checkVersion() { runTask('version', ['version'], '检测 tdl 版本') }
</script>
<template>
  <h1 class="page-title">仪表盘</h1>
  <p class="page-desc">先检测 tdl，再从左侧进入登录、对话、导出、转发、上传。</p>
  <div class="grid-3">
    <div class="stat"><div class="label">当前命名空间</div><div class="value">{{ appState.config.ns || 'default' }}</div></div>
    <div class="stat"><div class="label">代理</div><div class="value" style="font-size:16px">{{ appState.config.proxy || '未设置' }}</div></div>
    <div class="stat"><div class="label">并发</div><div class="value">{{ appState.config.limit || 1 }}</div></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-title">快速检查</div>
    <el-button type="primary" @click="checkVersion">检测 tdl version</el-button>
  </div>
  <div class="card">
    <div class="card-title">最近任务</div>
    <el-table :data="latestTasks" empty-text="暂无任务" style="width:100%">
      <el-table-column prop="title" label="任务" />
      <el-table-column label="状态" width="140">
        <template #default="{ row }">
          <!-- 使用标签颜色表示状态，并在运行中时显示进度条 -->
          <el-tag
            :type="row.status === '运行中' ? 'warning' : row.status === '成功' ? 'success' : row.status === '失败' ? 'danger' : 'info'"
            disable-transitions
          >{{ row.status }}</el-tag>
          <template v-if="row.status === '运行中'">
            <el-progress
              style="margin-top:4px;"
              :percentage="50"
              :indeterminate="true"
              stroke-width="2"
              color="#409eff"
            />
          </template>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="时间" width="190" />
    </el-table>
  </div>
</template>
