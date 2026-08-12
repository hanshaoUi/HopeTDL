<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { appState } from '../state'
import { isTaskFailed, isTaskInterrupted, isTaskRunning } from '../taskState'

// 「任务中心」和「历史记录」原本是两个页面，同一次导出会在两边各出现一次、
// 字段和操作还不一样。这里并成一页两个视图：正在发生的事 / 已经发生的事。
const TaskListPanel = defineAsyncComponent(() => import('./panels/TaskListPanel.vue'))
const HistoryPanel = defineAsyncComponent(() => import('./panels/HistoryPanel.vue'))

const tab = ref('live')

const runningCount = computed(() => appState.tasks.filter(isTaskRunning).length)
const failedCount = computed(() => appState.tasks.filter(isTaskFailed).length)
const interruptedCount = computed(() => appState.tasks.filter(isTaskInterrupted).length)
const scheduleCount = computed(() => appState.schedules.filter(item => item.enabled).length)
</script>

<template>
  <header class="page-head">
    <h1 class="page-title">任务</h1>
    <p class="page-desc">运行中和已完成的任务在「任务与计划」，可套用参数重跑的历史参数在「历史参数」。</p>
  </header>

  <div class="stat-row">
    <div class="stat"><div class="label">运行中</div><div class="value">{{ runningCount }}</div></div>
    <div class="stat" :class="{ warn: failedCount }"><div class="label">失败</div><div class="value">{{ failedCount }}</div></div>
    <div class="stat" :class="{ warn: interruptedCount }"><div class="label">已中断</div><div class="value">{{ interruptedCount }}</div></div>
    <div class="stat"><div class="label">启用的计划</div><div class="value">{{ scheduleCount }}</div></div>
  </div>

  <div class="segmented">
    <button type="button" :class="{ active: tab === 'live' }" @click="tab = 'live'">任务与计划</button>
    <button type="button" :class="{ active: tab === 'history' }" @click="tab = 'history'">历史参数</button>
  </div>

  <TaskListPanel v-if="tab === 'live'" />
  <HistoryPanel v-else />
</template>
