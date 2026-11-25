<script setup>
import { NModal } from 'naive-ui';
import { computed, ref, watch } from "vue";
import { appState } from "../state";
import {
  createScheduleFromTask,
  commandTextForSpec,
  deleteSchedule,
  toggleSchedule,
  runScheduledTaskNow,
} from "../utils";
import { message, dialog } from "../ui/naive";
import { toArgs, sourceChatForSpec } from '../../shared/jobSpec.mjs';
import { validateJob } from '../../shared/validateJob.mjs';
import AppIcon from "../components/AppIcon.vue";
const showCreate = ref(false),
  taskId = ref(null),
  mode = ref("once"),
  minutes = ref(60),
  busy = ref(false),
  draft = ref(null),
  triggerMode = ref("time"), watchChat = ref('');
function localTime() {
  const d = new Date(Date.now() + 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const runAt = ref(localTime());
watch(showCreate,show=>{if(show && new Date(runAt.value).getTime()<=Date.now())runAt.value=localTime()});
const groups = computed(() => [
  {title:'活跃计划', rows:appState.schedules.filter(s=>s.enabled && !appState.schedulerPaused)},
  {title:'暂停 / 停用', rows:appState.schedules.filter(s=>!s.enabled || appState.schedulerPaused)}
].filter(g=>g.rows.length));
const templates = computed(() => draft.value ? [draft.value, ...appState.tasks] : appState.tasks);
const options = computed(() =>
  templates.value
    .filter((t) => t.spec || t.args?.length)
    .map((t) => ({ label: t.title || t.type, value: t.id })),
);
watch(
  () => appState.planTaskId,
  (id) => {
    if (id) {
      taskId.value = id;
      showCreate.value = true;
      appState.planTaskId = "";
    }
  },
  { immediate: true },
);
watch(() => appState.planDraft, value => {
  if (!value) return;
  appState.planDraft = null;
  try {
  const spec = JSON.parse(JSON.stringify(value.spec));
  validateJob(spec);
  draft.value = {id:'workbench-draft', title:value.title, type:spec.kind, spec, args:['comment-forward','workflow'].includes(spec.kind)?[]:toArgs(spec)};
  taskId.value = draft.value.id;
  triggerMode.value = 'time';
  showCreate.value = true;
  } catch(error) { message.error(error.message); }
}, {immediate:true});
const selectedTemplate = computed(() => templates.value.find(t=>t.id===taskId.value));
watch(selectedTemplate, task => {watchChat.value=sourceChatForSpec(task?.spec)||task?.watchChat||''}, {immediate:true});
const incrementalAllowed = computed(() => ['export','forward'].includes(templates.value.find(t=>t.id===taskId.value)?.spec?.kind));
watch(incrementalAllowed, allowed => {if(!allowed) triggerMode.value='time'});
function time(v) {
  return v ? new Date(v).toLocaleString() : "—";
}
async function save() {
  const t = templates.value.find((t) => t.id === taskId.value);
  if (!t) {
    message.error("请选择一个已有任务作为模板");
    return;
  }
  const at = new Date(runAt.value).getTime();
  if (mode.value === "once" && (!at || at <= Date.now())) {
    message.error("请选择未来的执行时间");
    return;
  }
  busy.value = true;
  try {
    await createScheduleFromTask(t, {
      name: t.title,
      mode: mode.value,
      runAt: at,
      intervalMinutes: minutes.value,
      triggerMode: triggerMode.value,
      watchChat: watchChat.value.trim(),
    });
    showCreate.value = false;
    message.success("计划已创建");
  } catch (e) {
    message.error(String(e));
  } finally {
    busy.value = false;
  }
}
async function pause() {
  try {
    if (window.tdlApi?.nativeRuntime)
      await window.tdlApi.pauseScheduler(!appState.schedulerPaused);
    else appState.schedulerPaused = !appState.schedulerPaused;
  } catch (e) {
    message.error(String(e));
  }
}
async function toggle(s) {
  try {
    await toggleSchedule(s);
  } catch (e) {
    message.error(String(e));
  }
}
async function run(s) {
  try {
    message.info("已开始执行此计划");
    await runScheduledTaskNow(s);
  } catch (e) {
    message.error(String(e));
  }
}
function remove(s) {
  dialog.warning({
    title: "删除计划",
    content: `删除「${s.name}」？已产生的任务和文件会保留。`,
    positiveText: "删除计划",
    negativeText: "保留",
    onPositiveClick: async () => {
      try {
        await deleteSchedule(s.id);
      } catch (e) {
        message.error(String(e));
      }
    },
  });
}
</script>
<template>
  <div class="plans-page">
    <header class="workflow-header">
      <div>
        <h1>计划</h1>
        <p>定时执行任务，或在频道更新后自动处理。</p>
      </div>
      <div class="action-row">
        <button
          v-if="appState.schedules.length"
          class="secondary-button"
          @click="pause"
        >
          {{
            appState.schedulerPaused ? "恢复所有计划" : "暂停所有计划"
          }}</button
        ><button class="primary-button" @click="showCreate = true">
          <AppIcon name="plus" :size="17" />新建计划
        </button>
      </div>
    </header>
    <div class="workflow-note plan-note">
      <AppIcon name="info" :size="18" /><span>{{
        appState.schedulerPaused
          ? "所有计划已暂停。恢复后，已到时间的计划会继续检查。"
          : "应用在后台运行时会按时执行；关闭主窗口不影响计划，退出应用后停止检测。"
      }}</span>
    </div>
    <div class="sched-status"><span class="sched-dot" :class="{paused:appState.schedulerPaused}" />{{appState.schedulerPaused?'调度器已暂停':'调度器运行中'}} · {{appState.schedules.filter(s=>s.enabled).length}} 个启用的计划<button class="btn sm ghost" @click="pause">{{appState.schedulerPaused?'恢复':'暂停全部'}}</button></div>
    <div v-if="!appState.schedules.length" class="flow-empty">
      <AppIcon name="calendar" :size="38" />
      <h2>把确认过的流程安排到稍后</h2>
      <p>选择任务队列中的一个任务作为模板，设置执行时间即可。</p>
      <button class="primary-button" @click="showCreate = true">
        创建第一个计划
      </button>
    </div>
    <div v-else class="plan-list">
      <template v-for="group in groups" :key="group.title"><h2 class="plan-group-title">{{group.title}} · {{group.rows.length}}</h2>
      <article v-for="s in group.rows" :key="s.id" class="plan-row">
        <div class="plan-icon"><AppIcon name="calendar" :size="22" /></div>
        <div class="plan-copy">
          <h3>{{ s.name || s.type }}</h3>
          <p>
            {{s.triggerMode==='chat-update'?'频道更新后执行 · ':''}}{{
              s.mode === "once" ? "一次性" : `每 ${s.intervalMinutes} 分钟`
            }}
            · {{ s.enabled ? `下次 ${time(s.nextRunAt)}` : "已停用" }}
          </p>
          <small>{{ s.lastDecision || s.lastStatus || "尚未执行" }}</small>
        </div>
        <span
          class="state-label"
          :class="
            s.enabled && !appState.schedulerPaused ? 'success' : 'stopped'
          "
          >{{
            s.enabled
              ? appState.schedulerPaused
                ? "已暂停"
                : "等待执行"
              : "已停用"
          }}</span
        >
        <div class="action-row">
          <button class="text-action" @click="toggle(s)">
            {{ s.enabled ? "停用" : "启用" }}</button
          ><button class="text-action" @click="run(s)">立即运行</button
          ><button class="text-action muted-action" @click="remove(s)">
            删除
          </button>
        </div>
      </article></template>
    </div>
    <n-modal v-model:show="showCreate">
      <section
        class="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
      >
        <h2 id="plan-title">安排一个流程</h2>
        <p class="section-help">沿用任务的来源、目标、范围和演练设置。</p>
        <div class="field-stack">
          <label>选择任务模板</label
          ><n-select
            v-model:value="taskId"
            :options="options"
            :disabled="!options.length"
            :placeholder="options.length ? '选择一个已有任务' : '暂无可用任务模板'"
            filterable
          />
        </div>
        <div v-if="!options.length" class="workflow-note">
          还没有可用的任务。请先在工作台确认并执行一次流程。
        </div>
        <div v-if="selectedTemplate" class="plan-template-summary"><span class="dry-badge">{{selectedTemplate.spec?.dryRun?'演练 · 不发送':selectedTemplate.spec?.exportOnly?'仅导出':(['forward','comment-forward','upload'].includes(selectedTemplate.type)?'实际发送':'本地保存')}}</span><p class="mini-muted">沿用以下参数执行，请确认来源、目标和范围。</p><pre class="command-preview">{{selectedTemplate.spec?.kind==='comment-forward'?`${selectedTemplate.spec.sourceChat} → ${selectedTemplate.spec.targetChat||'本地'} · ${selectedTemplate.spec.startId||'起'} — ${selectedTemplate.spec.endId||'止'} · ${selectedTemplate.spec.mode||'direct'}`:selectedTemplate.spec?commandTextForSpec(selectedTemplate.spec):selectedTemplate.args?.join(' ')}}</pre></div>
        <div class="field-stack">
          <label>执行频率</label
          ><n-radio-group v-model:value="mode"
            ><n-radio-button value="once">执行一次</n-radio-button
            ><n-radio-button value="interval"
              >重复执行</n-radio-button
            ></n-radio-group
          >
        </div>
        <div v-if="incrementalAllowed" class="field-stack"><label>触发方式</label><n-radio-group v-model:value="triggerMode"><n-radio-button value="time">到点执行</n-radio-button><n-radio-button value="chat-update">频道有更新才执行</n-radio-button></n-radio-group></div>
        <div v-if="incrementalAllowed && triggerMode==='chat-update'" class="field-stack"><label for="plan-watch-chat">检测来源对话</label><input id="plan-watch-chat" v-model="watchChat" class="field-input" placeholder="源频道 / 群组 ID 或 @用户名" /><p class="field-help">检测此来源的新消息，再导出增量范围；转发目标沿用任务模板。</p></div>
        <div v-if="draft && taskId===draft.id" class="workflow-note">当前表单草稿 · 未执行。创建计划后会按当前演练 / 正式设置运行。</div>
        <div v-if="mode === 'once'" class="field-stack">
          <label for="plan-time">执行时间</label
          ><input id="plan-time" v-model="runAt" type="datetime-local" />
        </div>
        <div v-else class="field-stack">
          <label>间隔（分钟）</label
          ><n-input-number v-model:value="minutes" :min="1" :max="525600" />
          <p class="field-help">
            每次会重跑模板指定的范围。需要断点续跑时，请先在模板中选择原工作目录并启用续跑。
          </p>
        </div>
        <div class="flow-actions">
          <button type="button" class="secondary-button" @click="showCreate = false">
            取消</button
          ><button
            type="button"
            class="primary-button"
            :disabled="busy || !taskId"
            @click="save"
          >
            {{ busy ? "正在保存…" : "创建计划" }}
          </button>
        </div>
      </section>
    </n-modal>
  </div>
</template>
