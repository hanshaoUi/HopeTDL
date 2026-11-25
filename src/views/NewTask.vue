<script setup>
import { computed, defineAsyncComponent, provide, ref, shallowRef, unref, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import { appState } from '../state'
import AppIcon from '../components/AppIcon.vue'
import { invalidNumbers } from '../../shared/specKey.mjs'
import { message } from '../ui/naive'
import { getCommentForwardRecords, getDownloadRecords, getExportRecords, getForwardRecords, getUploadRecords } from '../historyStore'
const showHistory = ref(false), historyRows = ref([])
const historyGetters = {export:getExportRecords,forward:getForwardRecords,download:getDownloadRecords,upload:getUploadRecords,commentForward:getCommentForwardRecords}
function history() { showHistory.value=!showHistory.value; historyRows.value=historyGetters[current.value.key]().slice(0,20) }
function applyHistory(row) {
  const field={export:'selectedExportRecord',forward:'selectedForwardRecord',download:'selectedDownloadRecord',upload:'selectedUploadRecord',commentForward:'selectedCommentForwardRecord'}[current.value.key]
  appState[field]=row; showHistory.value=false
}
watch([()=>appState.newTaskKind,()=>appState.config.ns],()=>{showHistory.value=false})
function closeHistory(event) { if(appState.activeView==='newTask' && event.key==='Escape')showHistory.value=false }
onMounted(()=>window.addEventListener('keydown',closeHistory))
onUnmounted(()=>window.removeEventListener('keydown',closeHistory))
onDeactivated(()=>{showHistory.value=false;window.removeEventListener('keydown',closeHistory)})
onActivated(()=>window.addEventListener('keydown',closeHistory))
const windowApiFile = !!window.tdlApi?.readFilterSample
const filterAvailable = !!window.tdlApi?.previewFilter
const sample = ref(''), sampleResult = ref(null), sampleBusy = ref(false)
let sampleRevision = 0
async function loadSample() {
  try{const file=await window.tdlApi?.openFile({filters:[{name:'JSON',extensions:['json']}]});if(!file)return;const json=await window.tdlApi.readFilterSample(file);sample.value=JSON.stringify(json,null,2);await nextTick();await previewFilter()}catch(error){message.error(String(error))}
}
async function previewFilter() {
  if(!window.tdlApi?.previewFilter)return
  sampleBusy.value=true
  const revision=sampleRevision
  try {
    const input=sample.value.trim()
    const json=input.startsWith('{')||input.startsWith('[')?JSON.parse(input):{messages:[{id:1,text:sample.value}]}
    const result=await window.tdlApi.previewFilter({json,spec:JSON.parse(JSON.stringify(spec.value||{}))})
    if(revision===sampleRevision)sampleResult.value=result
  } catch(e) { message.error(String(e)) } finally { sampleBusy.value=false }
}
const kinds = [
  { key:'export', title:'导出消息', short:'元数据 → JSON', icon:'download', component:defineAsyncComponent(()=>import('./forms/ExportForm.vue')) },
  { key:'download', title:'下载媒体', short:'图片视频 → 本地', icon:'media', component:defineAsyncComponent(()=>import('./forms/DownloadForm.vue')) },
  { key:'forward', title:'转发消息', short:'JSON / 链接 → 目标', icon:'arrow', component:defineAsyncComponent(()=>import('./forms/ForwardForm.vue')) },
  { key:'commentForward', title:'评论转发', short:'主消息 + 评论搬运', icon:'comments', component:defineAsyncComponent(()=>import('./forms/CommentForwardForm.vue')) },
  { key:'upload', title:'上传文件', short:'本地 → 对话', icon:'upload', component:defineAsyncComponent(()=>import('./forms/UploadForm.vue')) }
]
const current = computed(()=>kinds.find(k=>k.key===appState.newTaskKind)||kinds[3])
const command = ref(''), spec = shallowRef(null), execution = shallowRef({})
watch([sample,()=>spec.value,()=>appState.config],()=>{sampleRevision++;sampleResult.value=null},{deep:true})
let specOwner, commandOwner
provide('workbenchPreview', {
  plan,
  setSpec(owner,value,state) { specOwner=owner; spec.value=value; execution.value=state },
  clearSpec(owner) { if(specOwner===owner) { spec.value=null; execution.value={} } },
  setCommand(owner,value) { commandOwner=owner; command.value=value },
  clearCommand(owner) { if(commandOwner===owner) command.value='' }
})
const previewLines = computed(() => (command.value || '等待表单参数…').split('\n').flatMap(line => {
  if(line.startsWith('#')) return [{text:line,kind:'preview-comment'}]
  const tokens = line.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) || []
  const lines=[];let current=[]
  for(const token of tokens) {
    if(/^--?[A-Za-z][A-Za-z0-9-]*$/.test(token)&&current.length){lines.push(current.join(' '));current=['  '+token]}
    else current.push(token)
  }
  if(current.length)lines.push(current.join(' '))
  return lines.map(text=>({text,kind:text.startsWith('  -')?'preview-flag':''}))
}))
const isRehearsal = computed(()=>spec.value?.dryRun===true)
const exportOnly = computed(()=>spec.value?.exportOnly===true)
const actualProgress = computed(()=>unref(execution.value.progress))
const actualStatus = computed(()=>unref(execution.value.status)||'idle')
const pipeline = computed(()=>{
  if(current.value.key==='export' && spec.value?.kind==='workflow')return [['导出消息','按所选范围导出 JSON'],['转发导出结果','导出成功后按目标、模式和演练设置执行']]
  if(current.value.key==='download' && spec.value?.kind==='workflow')return [['导出评论区','按主消息 ID 导出为本地 JSON'],['下载评论区媒体','沿用全部下载参数']]
  if(current.value.key==='commentForward') return [
    ['导出主消息列表','读取来源消息 ID，保存 posts.json'],
    ['循环每个主消息',isRehearsal.value?'演练：不逐条导出，不实际转发':exportOnly.value?'导出主消息与评论 → 过滤 → 保存':'导出评论区 → 过滤 → 按顺序转发'],
    ['写入断点',isRehearsal.value?'演练不写已完成断点':'progress.json · 下次从此继续']
  ]
  return {
    export:[['导出消息','按所选范围导出 JSON'],['分析导出记录','保存参数与下次起始 ID']],
    download:[['准备来源','消息链接 / JSON / 评论区'],['下载媒体','应用后缀、命名和续传规则']],
    forward:[['读取与过滤','读取 JSON 或消息链接'],['转发到目标','应用话题、模式和演练设置']],
    upload:[['准备本地文件','文件或目录 · 生成标签'],['上传到对话','应用话题、说明和媒体选项']]
  }[current.value.key]
})
const stageIndex = computed(()=>{
  if(actualStatus.value==='done')return pipeline.value.length
  if(actualProgress.value?.stage==='checkpoint')return 2
  return actualProgress.value?.stage && actualProgress.value.stage!=='export-list' ? 1 : 0
})
async function copy() {try{await navigator.clipboard.writeText(command.value);message.success('命令已复制')}catch(e){message.error(String(e))}}
function plan() {
  if(!spec.value) return
  const s=spec.value
  if(invalidNumbers(s)){message.error('ID、话题和延迟必须是非负安全整数');return}
  for(const step of s.steps||[s]){if(step.kind==='export'&&(!step.chat?.trim()||!step.output?.trim())){message.error('请填写导出来源和输出文件');return}if(step.kind==='forward'&&!step.target?.peer?.trim()&&!step.target?.routerFile?.trim()){message.error('请填写转发目标');return}if(step.kind==='download'&&!step.directory?.trim()&&!step.serve){message.error('请选择下载目录');return}}
  const source=s.steps?.length||s.sourceChat||s.chat||s.from||s.path||s.source?.items?.length||(s.kind==='download'&&s.resumeMode!=='none')
  if(s.kind==='download'&&s.source?.items?.some(item=>String(item).includes('<workDir>'))){message.error('评论区下载需先准备真实导出文件，不能保存占位路径为计划');return}
  if(!String(source||'').trim()){message.error('请先填写任务来源');return}
  if(s.kind==='comment-forward'&&!s.dryRun&&!s.exportOnly&&(s.forwardMain||s.forwardComments)&&!s.targetChat){message.error('正式转发需要目标对话');return}
  if(s.kind==='upload'&&!s.chat){message.error('请先填写目标聊天');return}
  if(s.kind==='download'&&!s.directory&&!s.serve){message.error('请选择下载目录');return}
  if(s.kind==='forward'&&!s.target?.peer){message.error('请先填写目标对话');return}
  appState.planDraft={title:current.value.title,spec:JSON.parse(JSON.stringify(s))}
  appState.activeView='plans'
}
</script>
<template>
  <header class="page-head wb-header">
    <div><h1 class="page-title">工作台</h1><p class="page-desc">选择任务类型，参数会实时转换为 tdl 命令。</p></div>
    <div class="history-anchor"><button class="btn sm" :aria-expanded="showHistory" @click="history"><AppIcon name="history" :size="14" />历史参数</button><section v-if="showHistory" class="history-popover" aria-label="历史参数"><div class="action-row"><strong>{{current.title}} · 当前空间</strong><button class="btn sm ghost" @click="showHistory=false">关闭</button></div><p v-if="!historyRows.length" class="mini-muted">暂无历史参数</p><button v-for="row in historyRows" :key="row.id||row.output" class="history-record" @click="applyHistory(row)"><span>{{row.time||row.createdAt||'历史参数'}}</span><p class="mini-muted">{{row.sourceChat||row.chat||row.peer||row.from||row.path||row.command}}</p><span>回填参数</span></button><button class="btn sm ghost" @click="appState.tasksTab='history';appState.activeView='tasks';showHistory=false">查看全部历史</button></section></div>
  </header>
  <div class="wb-layout">
    <nav class="wb-picker kind-picker" aria-label="任务类型">
      <button v-for="kind in kinds" :key="kind.key" class="wb-pick kind-item" :class="{active:current.key===kind.key}" @click="appState.newTaskKind=kind.key">
        <AppIcon :name="kind.icon" class="icon" :size="18" /><span class="wb-pick-text"><span class="wb-pick-title">{{kind.title}}</span><span class="wb-pick-short">{{kind.short}}</span></span>
      </button>
    </nav>
    <div class="wb-form kind-body">
      <div class="pipeline" aria-label="执行流程">
        <div v-for="(step,i) in pipeline" :key="step[0]" class="pipeline-step" :class="{skipped:isRehearsal&&i>0,active:actualStatus==='running'&&i===stageIndex&&!(isRehearsal&&i>0),done:!(isRehearsal&&i>0)&&(actualStatus==='done'||(actualStatus==='running'&&i<stageIndex))}">
          <div class="pipeline-num">{{isRehearsal&&i>0?'—':i+1}}</div><div class="pipeline-body"><div class="pipeline-title">{{step[0]}}</div><div class="pipeline-desc">{{step[1]}}</div></div>
        </div>
      </div>
      <component :is="current.component" />
      <button v-if="current.key!=='commentForward'" class="btn sm ghost plan-from-form" @click="plan"><AppIcon name="clock" :size="14" />存为计划</button>
    </div>
    <aside class="preview-wrap" aria-label="实时预览"><div class="preview-panel">
      <section class="preview-box"><div class="preview-head"><span>命令预览</span><button class="btn sm ghost" :disabled="!command" @click="copy"><AppIcon name="copy" :size="12" />复制</button></div><pre class="preview-body"><template v-for="(line,i) in previewLines" :key="i"><span :class="line.kind">{{line.text}}</span>{{'\n'}}</template></pre>
        <div class="preview-foot"><span v-if="isRehearsal" class="dry-badge">演练 · 不发送</span><span v-else-if="exportOnly" class="dry-badge">仅导出</span><span v-else>{{['forward','comment-forward','upload'].includes(spec?.kind)?'执行时实际发送':'本地保存'}}</span><span>{{actualStatus==='running'?'处理中':'提交前请核对参数'}}</span></div>
      </section>
      <section v-if="['commentForward','forward'].includes(current.key)" class="filter-preview">
        <div class="filter-preview-head">过滤预览<span>{{spec?.blockKeywordsText?'本任务规则':'全局规则'}}</span></div>
        <div class="filter-rules-summary"><template v-if="spec?.blockKeywordsText"><span class="filter-tag block">屏蔽词</span><p>{{spec.blockKeywordsText}}</p></template><template v-if="appState.config.forwardFilterEnabled"><p>全局过滤已启用</p><p v-if="appState.config.filterKeywordsText">{{appState.config.filterKeywordsText}}</p><p v-if="appState.config.removeLinks">移除链接</p><p v-if="appState.config.blockImages">过滤图片</p><p v-if="appState.config.blockVideos">过滤视频</p><p v-if="appState.config.blockTextOnly">过滤纯文本</p></template><p v-else-if="!spec?.blockKeywordsText">未启用关键词或类型过滤</p><p v-if="!sampleResult" class="mini-muted">尚未载入消息样本；真实命中数量以执行结果为准。</p><p v-else class="mini-muted">结果仅适用于粘贴样本，频道实际消息以执行结果为准。</p></div>
        <div class="filter-rules-summary"><label for="filter-sample">粘贴测试文本或导出 JSON</label><button class="btn sm ghost" :disabled="!filterAvailable||!windowApiFile" @click="loadSample">读取 JSON 样本</button><textarea id="filter-sample" v-model="sample" class="sandbox-input" placeholder="样本仅用于本地过滤，不发送消息" /><button class="btn sm" :disabled="!sample.trim()||sampleBusy||!filterAvailable" @click="previewFilter">{{sampleBusy?'计算中…':'测试过滤'}}</button><p v-if="!filterAvailable" class="mini-muted">请在 Rust 应用中使用原生过滤预览。</p><template v-if="sampleResult"><p>保留 {{sampleResult.count}} 条 · 删除 {{sampleResult.removed}} 条 · 移除链接 {{sampleResult.linksRemoved}} 处</p><pre class="filter-result">{{JSON.stringify(sampleResult.json,null,2)}}</pre></template></div>
      </section>
      <section class="preview-box"><div class="preview-head">本次任务</div><dl class="preview-facts"><dt>账号空间</dt><dd>{{appState.config.ns||'hope'}}</dd><template v-if="spec?.sourceChat||spec?.chat"><dt>来源</dt><dd>{{spec.sourceChat||spec.chat}}</dd></template><template v-if="spec?.targetChat||spec?.target?.peer"><dt>目标</dt><dd>{{spec.targetChat||spec.target.peer}}</dd></template><dt>操作</dt><dd>{{current.title}}</dd><dt>执行顺序</dt><dd>{{current.key==='commentForward'?'主消息 → 评论 → 下一条':'按表单参数执行'}}</dd></dl></section>
    </div></aside>
  </div>
</template>
