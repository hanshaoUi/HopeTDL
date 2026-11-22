<script setup>
import { computed, defineAsyncComponent, provide, ref, shallowRef, unref } from 'vue'
import { appState } from '../state'
import AppIcon from '../components/AppIcon.vue'
import { message } from '../ui/naive'
const kinds = [
  { key:'export', title:'导出消息', short:'元数据 → JSON', icon:'download', component:defineAsyncComponent(()=>import('./forms/ExportForm.vue')) },
  { key:'download', title:'下载媒体', short:'图片视频 → 本地', icon:'media', component:defineAsyncComponent(()=>import('./forms/DownloadForm.vue')) },
  { key:'forward', title:'转发消息', short:'JSON / 链接 → 目标', icon:'arrow', component:defineAsyncComponent(()=>import('./forms/ForwardForm.vue')) },
  { key:'commentForward', title:'评论转发', short:'主消息 + 评论搬运', icon:'comments', component:defineAsyncComponent(()=>import('./forms/CommentForwardForm.vue')) },
  { key:'upload', title:'上传文件', short:'本地 → 对话', icon:'upload', component:defineAsyncComponent(()=>import('./forms/UploadForm.vue')) }
]
const current = computed(()=>kinds.find(k=>k.key===appState.newTaskKind)||kinds[3])
const command = ref(''), spec = shallowRef(null), execution = shallowRef({})
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
    if(token.startsWith('-')&&current.length){lines.push(current.join(' '));current=['  '+token]}
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
  if(current.value.key==='commentForward') return [
    ['导出主消息列表','读取来源消息 ID，保存 posts.json'],
    ['循环每个主消息',exportOnly.value?'导出主消息与评论 → 过滤 → 保存':isRehearsal.value?'演练：不逐条导出，不实际转发':'导出评论区 → 过滤 → 按顺序转发'],
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
  if(actualStatus.value==='done')return 3
  if(actualProgress.value?.stage==='done' || actualProgress.value?.stage==='failed')return 2
  return actualProgress.value?.total ? 1 : 0
})
async function copy() {try{await navigator.clipboard.writeText(command.value);message.success('命令已复制')}catch(e){message.error(String(e))}}
function history() {appState.tasksTab='history';appState.activeView='tasks'}
function plan() {
  if(!spec.value) return
  const s=spec.value
  const source=s.sourceChat||s.chat||s.from||s.path||s.source?.items?.length||(s.kind==='download'&&s.resumeMode!=='none')
  if(!source){message.error('请先填写任务来源');return}
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
    <button class="btn sm" @click="history"><AppIcon name="history" :size="14" />历史参数</button>
  </header>
  <div class="wb-layout">
    <nav class="wb-picker kind-picker" aria-label="任务类型">
      <button v-for="kind in kinds" :key="kind.key" class="wb-pick kind-item" :class="{active:current.key===kind.key}" @click="appState.newTaskKind=kind.key">
        <AppIcon :name="kind.icon" class="icon" :size="18" /><span class="wb-pick-text"><span class="wb-pick-title">{{kind.title}}</span><span class="wb-pick-short">{{kind.short}}</span></span>
      </button>
    </nav>
    <div class="wb-form kind-body">
      <div class="pipeline" aria-label="执行流程">
        <div v-for="(step,i) in pipeline" :key="step[0]" class="pipeline-step" :class="{active:i===stageIndex,done:actualStatus==='done'||(actualStatus==='running'&&i<stageIndex)}">
          <div class="pipeline-num">{{i+1}}</div><div class="pipeline-body"><div class="pipeline-title">{{step[0]}}</div><div class="pipeline-desc">{{step[1]}}</div></div>
        </div>
      </div>
      <component :is="current.component" />
      <button v-if="current.key!=='commentForward'" class="btn sm ghost plan-from-form" @click="plan"><AppIcon name="clock" :size="14" />存为计划</button>
    </div>
    <aside class="preview-wrap" aria-label="实时预览"><div class="preview-panel">
      <section class="preview-box"><div class="preview-head"><span>命令预览</span><button class="btn sm ghost" :disabled="!command" @click="copy"><AppIcon name="copy" :size="12" />复制</button></div><pre class="preview-body"><template v-for="(line,i) in previewLines" :key="i"><span :class="line.kind">{{line.text}}</span>{{'\n'}}</template></pre>
        <div class="preview-foot"><span v-if="isRehearsal" class="dry-badge">演练 · 不发送</span><span v-else-if="exportOnly" class="dry-badge">仅导出</span><span v-else>{{['forward','commentForward','upload'].includes(spec?.kind)?'执行时实际发送':'本地保存'}}</span><span>{{actualStatus==='running'?'处理中':'提交前请核对参数'}}</span></div>
      </section>
      <section v-if="['commentForward','forward'].includes(current.key)" class="filter-preview">
        <div class="filter-preview-head">过滤预览<span>{{spec?.blockKeywordsText?'本任务规则':'全局规则'}}</span></div>
        <div class="filter-rules-summary"><template v-if="spec?.blockKeywordsText"><span class="filter-tag block">屏蔽词</span><p>{{spec.blockKeywordsText}}</p></template><template v-if="appState.config.forwardFilterEnabled"><p>全局过滤已启用</p><p v-if="appState.config.filterKeywordsText">{{appState.config.filterKeywordsText}}</p><p v-if="appState.config.removeLinks">移除链接</p><p v-if="appState.config.blockImages">过滤图片</p><p v-if="appState.config.blockVideos">过滤视频</p><p v-if="appState.config.blockTextOnly">过滤纯文本</p></template><p v-else-if="!spec?.blockKeywordsText">未启用关键词或类型过滤</p><p class="mini-muted">尚未载入消息样本；真实命中数量以执行结果为准。</p></div>
      </section>
      <section class="preview-box"><div class="preview-head">本次任务</div><dl class="preview-facts"><dt>账号空间</dt><dd>{{appState.config.ns||'hope'}}</dd><template v-if="spec?.sourceChat||spec?.chat"><dt>来源</dt><dd>{{spec.sourceChat||spec.chat}}</dd></template><template v-if="spec?.targetChat||spec?.target?.peer"><dt>目标</dt><dd>{{spec.targetChat||spec.target.peer}}</dd></template><dt>操作</dt><dd>{{current.title}}</dd><dt>执行顺序</dt><dd>{{current.key==='commentForward'?'主消息 → 评论 → 下一条':'按表单参数执行'}}</dd></dl></section>
    </div></aside>
  </div>
</template>
