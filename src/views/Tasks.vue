<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { appState } from '../state'
import { retryTask, retryPending, stopTask, commandTextForSpec, commandText } from '../utils'
import { message } from '../ui/naive'
import AppIcon from '../components/AppIcon.vue'
import { isTaskFailed } from '../taskState'
import { taskProgress, progressPercent, stagesForTask } from '../taskProgress'
import { sourceChatForSpec, targetChatForSpec } from '../../shared/jobSpec.mjs'
const History = defineAsyncComponent(()=>import('./panels/HistoryPanel.vue'))
const Advanced = defineAsyncComponent(()=>import('./panels/TaskListPanel.vue'))
const tab=ref('all'),selectedId=ref(''),logs=ref(''),progress=ref({}),showAdvanced=ref(false)
const failures=ref({})
const filters=[['all','全部'],['running','运行中'],['queued','排队中'],['success','已完成'],['failed','失败'],['history','历史参数']]
const active=t=>['running','queued'].includes(t.state)
const rows=computed(()=>appState.tasks.filter(t=>tab.value==='all'||(tab.value==='failed'?isTaskFailed(t):t.state===tab.value)))
const selected=computed(()=>appState.tasks.find(t=>t.id===selectedId.value))
const runningCount=computed(()=>appState.tasks.filter(t=>t.state==='running').length)
const queuedCount=computed(()=>appState.tasks.filter(t=>t.state==='queued').length)
const failedCount=computed(()=>appState.tasks.filter(isTaskFailed).length)
watch(()=>appState.tasksTab,value=>{if(value){tab.value=value;appState.tasksTab=''}},{immediate:true})
watch(selectedId,async id=>{
  logs.value=''; if(!id||!window.tdlApi?.nativeRuntime)return
  try {
    const tail=await window.tdlApi.logTail(id); if(selectedId.value!==id)return; logs.value=tail
    const t=selected.value,dir=t?.workDir||t?.spec?.workDir
    if(dir){const p=await window.tdlApi.readCommentForwardProgress(dir);if(selectedId.value!==id)return;if(p.ok&&!active(t)){progress.value={...progress.value,[id]:{current:p.doneCount+(p.failedCount||0),total:p.totalCount,stage:'checkpoint-summary'}};failures.value={...failures.value,[id]:p.failedItems||[]}}}
  }catch(e){if(selectedId.value===id)message.error(String(e))}
},{immediate:true})
watch(()=>appState.focusedTaskId,id=>{if(id){selectedId.value=id;tab.value='all';appState.focusedTaskId=''}},{immediate:true})

function route(t){const s=t.spec||{};const from=sourceChatForSpec(s)||s.from||s.path;const last=s.kind==='workflow'?s.steps?.at(-1):s;const to=targetChatForSpec(s)||last?.directory||last?.output||'本地';return from?`${from} → ${to}`:t.summary||'—'}
function output(t){return t.workDir||t.spec?.workDir||t.spec?.output||t.spec?.directory||t.outputPath}
function percent(t){return progressPercent(t, progress.value[t.id])}
function command(t){try{return t.command||(t.spec?commandTextForSpec(t.spec):commandText(t.args||[]))}catch{return '评论区顺序转发流程'}}
async function retry(t){try{await retryTask(t);message.success('已加入后台队列')}catch(e){message.error(String(e))}}
function taskFailedIds(t){return t?.failedIds?.length?t.failedIds:(failures.value[t?.id]||[]).map(x=>x.id).filter(Boolean)}
async function retryFailed(t){try{await retryTask(t,{onlyFailed:true,failedIds:taskFailedIds(t)});message.success('已发起失败项重试')}catch(e){message.error(String(e))}}
async function stop(t){try{await stopTask(t)}catch(e){message.error(String(e))}}
function plan(t){appState.planTaskId=t.id;appState.activeView='plans'}
async function open(t){const r=await window.tdlApi.openPath(output(t));if(r?.ok===false)message.error(r.message)}
const now = ref(Date.now())
let countdown
function waitText(t) { if(t.state!=='running'||!t.floodWaitUntil)return '';const seconds=Math.ceil((t.floodWaitUntil-now.value)/1000);return seconds>0?`Telegram 限流 · 约 ${seconds} 秒（由 tdl 处理等待）`:'' }
let offProgress,offLog
onMounted(()=>{countdown=setInterval(()=>now.value=Date.now(),1000);offProgress=window.tdlApi?.onCommentForwardProgress(p=>{progress.value={...progress.value,[p.taskId]:p}});offLog=window.tdlApi?.onLog(p=>{if(p.taskId===selectedId.value)logs.value=(logs.value+p.text).slice(-32768)})})
onUnmounted(()=>{clearInterval(countdown);offProgress?.();offLog?.()})
</script>
<template>
  <header class="page-head wb-header"><div><h1 class="page-title">任务</h1><p class="page-desc">正在执行和已完成的任务。</p></div><button class="btn primary" @click="appState.activeView='newTask'"><AppIcon name="plus" :size="14" />新建任务</button></header>
  <div class="stat-row"><button class="stat-card info" @click="tab='running'"><div class="stat-label">运行中</div><div class="stat-value">{{runningCount}}</div></button><button class="stat-card" @click="tab='queued'"><div class="stat-label">排队中</div><div class="stat-value">{{queuedCount}}</div></button><button class="stat-card warn" @click="tab='failed'"><div class="stat-label">失败</div><div class="stat-value">{{failedCount}}</div></button><button class="stat-card" @click="tab='all'"><div class="stat-label">任务总数</div><div class="stat-value">{{appState.tasks.length}}</div></button></div>
  <nav class="task-filter" aria-label="任务筛选"><button v-for="f in filters" :key="f[0]" class="pill" :class="{active:tab===f[0]}" @click="tab=f[0]">{{f[1]}}</button></nav>
  <History v-if="tab==='history'" />
  <template v-else><div v-if="!rows.length" class="flow-empty"><AppIcon name="tasks" :size="32" /><h2>暂无{{tab==='all'?'':filters.find(f=>f[0]===tab)?.[1]}}任务</h2><p>在工作台提交任务后，这里显示后台的实际状态和处理结果。</p><button class="btn" @click="appState.activeView='newTask'">前往工作台</button></div>
  <div v-else class="task-list"><article v-for="t in rows" :key="t.id" class="task-row" :class="{selected:selectedId===t.id}"><span class="state-label" :class="t.state">{{t.status}}</span><button class="task-info" @click="selectedId=selectedId===t.id?'':t.id" :aria-expanded="selectedId===t.id"><span class="task-name">{{t.title||t.type}}</span><span class="task-meta">{{route(t)}}</span><span v-if="waitText(t)" class="task-meta">{{waitText(t)}}</span><span class="task-meta">{{t.createdAt||'—'}}</span><span v-if="t.state==='queued'" class="task-meta">等待并发位（{{appState.runtimeSlots?.active ?? runningCount}} / {{appState.runtimeSlots?.limit ?? appState.config.maxConcurrentTasks ?? 2}} 已占用）</span><span v-if="stagesForTask(t,progress[t.id]).length" class="stage-indicator" :aria-label="stagesForTask(t,progress[t.id]).map(s=>s.label+':'+s.state).join('，')"><span v-for="s in stagesForTask(t,progress[t.id])" :key="s.label" class="stage-dot" :class="s.state" :title="s.label" /></span></button><div v-if="percent(t)!==null" class="task-progress"><div class="progress-bar"><div class="progress-fill" :style="{width:percent(t)+'%'}" /></div><div class="progress-text">{{taskProgress(t,progress[t.id])?.current}} / {{taskProgress(t,progress[t.id])?.total}} 组 · {{percent(t)}}%</div></div><div class="task-actions"><button v-if="active(t)" class="btn sm danger" @click="stop(t)">停止</button><template v-else><button v-if="t.type==='comment-forward'&&taskFailedIds(t).length" class="btn sm" :disabled="retryPending(t)" @click="retryFailed(t)">重跑失败项</button><button class="btn sm" :disabled="retryPending(t)" @click="retry(t)">重试</button></template><button class="btn sm ghost" @click="selectedId=selectedId===t.id?'':t.id">详情</button><button class="btn sm ghost" @click="plan(t)">存为计划</button></div></article></div>
  <section v-if="selected" class="card task-detail"><div class="card-head"><h2 class="card-title">{{selected.title||selected.type}} · 处理详情</h2><button class="btn sm ghost" @click="selectedId=''">收起</button></div><p class="mini-muted">{{route(selected)}}</p><p v-if="selected.errorMessage" class="field-error" role="alert">{{selected.errorMessage}}</p><p v-if="selected.failedCount" class="field-error">失败 {{selected.failedCount}} 条，请查看失败记录并选择原目录续跑。</p><ul v-if="failures[selected.id]?.length" class="failure-list"><li v-for="item in failures[selected.id]" :key="item.id">消息 {{item.id}}：{{item.error}}</li></ul><div class="action-row"><button v-if="selected.type==='comment-forward'&&!active(selected)&&taskFailedIds(selected).length" class="btn sm primary" :disabled="retryPending(selected)" @click="retryFailed(selected)">仅重试失败 {{taskFailedIds(selected).length}} 项</button><button v-if="output(selected)" class="btn sm" @click="open(selected)">打开结果目录</button><span class="mini-muted">{{selected.startedAt||'未开始'}} · {{selected.finishedAt||'未结束'}}</span></div><details class="advanced-rules"><summary>执行命令</summary><pre class="command-preview">{{command(selected)}}</pre></details><details class="advanced-rules" open><summary>运行日志</summary><pre class="task-log">{{logs||'暂无日志输出'}}</pre></details></section>
  <details class="advanced-rules" @toggle="showAdvanced=$event.target.open"><summary>高级任务管理（清理、完整详情与增量计划）</summary><Advanced v-if="showAdvanced" /></details></template>
</template>
