<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { appState } from '../state'
import { retryTask, stopTask, commandTextForSpec, commandText } from '../utils'
import { message } from '../ui/naive'
import AppIcon from '../components/AppIcon.vue'
const History = defineAsyncComponent(()=>import('./panels/HistoryPanel.vue'))
const Advanced = defineAsyncComponent(()=>import('./panels/TaskListPanel.vue'))
const tab=ref('all'),selectedId=ref(''),logs=ref(''),progress=ref({}),showAdvanced=ref(false)
const filters=[['all','全部'],['running','运行中'],['queued','排队中'],['success','已完成'],['failed','失败'],['history','历史参数']]
const active=t=>['running','queued'].includes(t.state)
const rows=computed(()=>appState.tasks.filter(t=>tab.value==='all'||(tab.value==='failed'?['failed','partial','interrupted'].includes(t.state):t.state===tab.value)))
const selected=computed(()=>appState.tasks.find(t=>t.id===selectedId.value))
const runningCount=computed(()=>appState.tasks.filter(t=>t.state==='running').length)
const queuedCount=computed(()=>appState.tasks.filter(t=>t.state==='queued').length)
const failedCount=computed(()=>appState.tasks.filter(t=>['failed','partial'].includes(t.state)).length)
watch(()=>appState.tasksTab,value=>{if(value){tab.value=value;appState.tasksTab=''}},{immediate:true})
watch(()=>appState.focusedTaskId,id=>{if(id){selectedId.value=id;tab.value='all';appState.focusedTaskId=''}},{immediate:true})
watch(selectedId,async id=>{logs.value='';if(!id||!window.tdlApi?.nativeRuntime)return;try{logs.value=await window.tdlApi.logTail(id);const t=selected.value;const dir=t?.workDir||t?.spec?.workDir;if(dir){const p=await window.tdlApi.readCommentForwardProgress(dir);if(p.ok)progress.value={...progress.value,[id]:{current:p.doneCount,total:p.totalCount,stage:'已保存断点'}}}}catch(e){message.error(String(e))}})
function route(t){const s=t.spec||{};return s.sourceChat?`${s.sourceChat} → ${s.targetChat||'本地导出'}`:s.chat?`${s.chat} → ${s.output||s.path||'本地'}`:s.from?`${s.from} → ${s.target?.peer||''}`:t.summary||'—'}
function output(t){return t.workDir||t.spec?.workDir||t.spec?.output||t.spec?.directory||t.outputPath}
function percent(t){const p=progress.value[t.id];return p?.total?Math.min(100,Math.round(p.current/p.total*100)):null}
function command(t){try{return t.command||(t.spec?commandTextForSpec(t.spec):commandText(t.args||[]))}catch{return '评论区顺序转发流程'}}
async function retry(t){try{await retryTask(t);message.success('已加入后台队列')}catch(e){message.error(String(e))}}
async function stop(t){try{await stopTask(t)}catch(e){message.error(String(e))}}
function plan(t){appState.planTaskId=t.id;appState.activeView='plans'}
async function open(t){const r=await window.tdlApi.openPath(output(t));if(r?.ok===false)message.error(r.message)}
let offProgress,offLog
onMounted(()=>{offProgress=window.tdlApi?.onCommentForwardProgress(p=>{progress.value={...progress.value,[p.taskId]:p}});offLog=window.tdlApi?.onLog(p=>{if(p.taskId===selectedId.value)logs.value=(logs.value+p.text).slice(-32768)})})
onUnmounted(()=>{offProgress?.();offLog?.()})
</script>
<template>
  <header class="page-head wb-header"><div><h1 class="page-title">任务</h1><p class="page-desc">正在执行和已完成的任务。</p></div><button class="btn primary" @click="appState.activeView='newTask'"><AppIcon name="plus" :size="14" />新建任务</button></header>
  <div class="stat-row"><div class="stat-card info"><div class="stat-label">运行中</div><div class="stat-value">{{runningCount}}</div></div><div class="stat-card"><div class="stat-label">排队中</div><div class="stat-value">{{queuedCount}}</div></div><div class="stat-card warn"><div class="stat-label">失败</div><div class="stat-value">{{failedCount}}</div></div><div class="stat-card"><div class="stat-label">任务总数</div><div class="stat-value">{{appState.tasks.length}}</div></div></div>
  <nav class="task-filter" aria-label="任务筛选"><button v-for="f in filters" :key="f[0]" class="pill" :class="{active:tab===f[0]}" @click="tab=f[0]">{{f[1]}}</button></nav>
  <History v-if="tab==='history'" />
  <template v-else><div v-if="!rows.length" class="flow-empty"><AppIcon name="tasks" :size="32" /><h2>暂无{{tab==='all'?'':filters.find(f=>f[0]===tab)?.[1]}}任务</h2><p>在工作台提交任务后，这里显示后台的实际状态和处理结果。</p><button class="btn" @click="appState.activeView='newTask'">前往工作台</button></div>
  <div v-else class="task-list"><article v-for="t in rows" :key="t.id" class="task-row" :class="{selected:selectedId===t.id}"><span class="state-label" :class="t.state">{{t.status}}</span><button class="task-info" @click="selectedId=selectedId===t.id?'':t.id" :aria-expanded="selectedId===t.id"><span class="task-name">{{t.title||t.type}}</span><span class="task-meta">{{route(t)}}</span><span class="task-meta">{{t.createdAt||'—'}}</span></button><div v-if="percent(t)!==null" class="task-progress"><div class="progress-bar"><div class="progress-fill" :style="{width:percent(t)+'%'}" /></div><div class="progress-text">{{progress[t.id]?.current}} / {{progress[t.id]?.total}} 组 · {{percent(t)}}%</div></div><div class="task-actions"><button v-if="active(t)" class="btn sm danger" @click="stop(t)">停止</button><button v-else class="btn sm" @click="retry(t)">重试</button><button class="btn sm ghost" @click="selectedId=selectedId===t.id?'':t.id">详情</button><button class="btn sm ghost" @click="plan(t)">存为计划</button></div></article></div>
  <section v-if="selected" class="card task-detail"><div class="card-head"><h2 class="card-title">{{selected.title||selected.type}} · 处理详情</h2><button class="btn sm ghost" @click="selectedId=''">收起</button></div><p class="mini-muted">{{route(selected)}}</p><p v-if="selected.errorMessage" class="field-error" role="alert">{{selected.errorMessage}}</p><p v-if="selected.failedCount" class="field-error">失败 {{selected.failedCount}} 条，请查看失败记录并选择原目录续跑。</p><div class="action-row"><button v-if="output(selected)" class="btn sm" @click="open(selected)">打开结果目录</button><span class="mini-muted">{{selected.startedAt||'未开始'}} · {{selected.finishedAt||'未结束'}}</span></div><details class="advanced-rules"><summary>执行命令</summary><pre class="command-preview">{{command(selected)}}</pre></details><details class="advanced-rules" open><summary>运行日志</summary><pre class="task-log">{{logs||'暂无日志输出'}}</pre></details></section>
  <details class="advanced-rules" @toggle="showAdvanced=$event.target.open"><summary>高级任务管理（清理、完整详情与增量计划）</summary><Advanced v-if="showAdvanced" /></details></template>
</template>
