<script setup>
import { computed } from 'vue'
import { appState } from '../state'
import { runTask } from '../utils'
const latestTasks = computed(() => appState.tasks.slice(0, 8))
const runningCount = computed(() => appState.tasks.filter(task => task.status === '运行中').length)
const failedCount = computed(() => appState.tasks.filter(task => task.status === '失败').length)
function checkVersion() { runTask('version', ['version'], '检测 tdl 版本') }
</script>
<template>
  <h1 class="page-title">仪表盘</h1>
  <p class="page-desc">先检测 tdl，再从左侧进入登录、对话、导出、转发、上传。</p>
  <div class="grid-3">
    <div class="stat"><div class="label">当前命名空间</div><div class="value">{{ appState.config.ns || 'default' }}</div></div>
    <div class="stat"><div class="label">运行中任务</div><div class="value">{{ runningCount }}</div></div>
    <div class="stat"><div class="label">失败任务</div><div class="value">{{ failedCount }}</div></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-title">快速检查</div>
    <div class="action-row">
      <n-button type="primary" @click="checkVersion">检测 tdl version</n-button>
      <n-button secondary @click="appState.activeView = 'taskCenter'">打开任务中心</n-button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">最近任务</div>
    <div class="table-scroll">
      <n-table :bordered="false" striped>
        <thead>
          <tr>
            <th>任务</th>
            <th style="width:140px">状态</th>
            <th style="width:190px">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!latestTasks.length">
            <td colspan="3" class="empty-cell">暂无任务</td>
          </tr>
          <tr v-for="row in latestTasks" :key="row.id">
            <td>{{ row.title }}</td>
            <td>
              <n-tag :type="row.status === '运行中' ? 'warning' : row.status === '成功' ? 'success' : row.status === '失败' ? 'error' : 'info'">
                {{ row.status }}
              </n-tag>
              <n-progress
                v-if="row.status === '运行中'"
                style="margin-top:4px;"
                :percentage="50"
                processing
                :height="2"
                color="#6aa7ff"
              />
            </td>
            <td>{{ row.createdAt }}</td>
          </tr>
        </tbody>
      </n-table>
    </div>
  </div>
</template>
