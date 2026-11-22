<script setup>
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { appState } from "../state";
import { retryTask, stopTask, commandText, commandTextForSpec } from "../utils";
import { message } from "../ui/naive";
import AppIcon from "../components/AppIcon.vue";
const History = defineAsyncComponent(() => import("./panels/HistoryPanel.vue"));
const tab = ref("all"),
  selectedId = ref(""),
  showLogs = ref(false),
  diskLog = ref(""),
  progress = ref(null);
watch(
  () => appState.focusedTaskId,
  (id) => {
    if (id) {
      selectedId.value = id;
      tab.value = "all";
      appState.focusedTaskId = "";
    }
  },
  { immediate: true },
);
const active = (t) => ["running", "queued"].includes(t.state);
const activeCount = computed(() => appState.tasks.filter(active).length);
const rows = computed(() =>
  appState.tasks.filter((t) => (tab.value === "active" ? active(t) : true)),
);
const selected = computed(() =>
  appState.tasks.find((t) => t.id === selectedId.value),
);
watch(
  rows,
  (list) => {
    if (!list.some((t) => t.id === selectedId.value))
      selectedId.value = list[0]?.id || "";
  },
  { immediate: true },
);
function time(s) {
  if (!s) return "—";
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? s : date.toLocaleString();
}
function route(t) {
  const d = t.workflowDraft;
  return d
    ? `${t.sourceLabel || d.sourceChat || d.sourcePath} → ${t.targetLabel || d.targetChat || d.outputDir || d.exportFile}`
    : t.spec?.sourceChat
      ? `${t.spec.sourceChat} → ${t.spec.targetChat || "本地导出"}`
      : t.title || t.type;
}
function output(t) {
  return (
    t.outputPath || t.spec?.workDir || t.spec?.output || t.spec?.directory || ""
  );
}
function command(t) {
  try {
    return t.spec?.kind === "comment-forward"
      ? "主消息 → 评论区 → 下一条主消息"
      : t.spec
        ? commandTextForSpec(t.spec)
        : commandText(t.args || []);
  } catch {
    return "";
  }
}
async function retry(t) {
  try {
    const r = await retryTask(t);
    tab.value = "all";
    selectedId.value = r.taskId;
    message.success("任务已重新加入队列");
  } catch (e) {
    message.error(String(e));
  }
}
async function stop(t) {
  try {
    await stopTask(t);
  } catch (e) {
    message.error(String(e));
  }
}
function edit(t) {
  if (t.workflowDraft)
    appState.workbenchRequest = JSON.parse(JSON.stringify(t.workflowDraft));
  else {
    const s = t.spec || {};
    appState.workbenchRequest = {
      action:
        s.kind === "comment-forward" || s.kind === "forward"
          ? "transfer"
          : s.kind === "download"
            ? "download"
            : s.kind === "upload"
              ? "upload"
              : "export",
      sourceKind: s.kind === "forward" || s.kind === "upload" ? "file" : "chat",
      sourceChat: s.sourceChat || s.chat || "",
      targetChat: s.targetChat || s.target?.peer || "",
      sourcePath: s.from || s.path || "",
      workDir: s.workDir || "",
      outputDir: appState.config.defaultDownloadDir || "",
      includeComments: s.kind === "comment-forward",
      runMode: s.dryRun ? "rehearsal" : "live",
    };
  }
  appState.activeView = "newTask";
}
function plan(t) {
  appState.planTaskId = t.id;
  appState.activeView = "plans";
}
async function openOutput(t) {
  const p = output(t);
  if (!p) return;
  const r = await window.tdlApi.openPath(p);
  if (r?.ok === false) message.error(r.message);
}
async function refreshLogs() {
  if (!showLogs.value || !selectedId.value || !window.tdlApi?.nativeRuntime)
    return;
  diskLog.value = await window.tdlApi.logTail(selectedId.value);
}
watch([selectedId, showLogs, () => selected.value?.state], async () => {
  progress.value = null;
  await refreshLogs();
  const dir = selected.value?.spec?.workDir;
  if (dir) {
    const p = await window.tdlApi?.readCommentForwardProgress(dir);
    if (p?.ok)
      progress.value = {
        current: p.doneCount,
        total: p.totalCount,
        stage: "saved",
      };
  }
});
let offLog, offProgress;
onMounted(() => {
  offLog = window.tdlApi?.onLog((data) => {
    if (showLogs.value && data.taskId === selectedId.value)
      diskLog.value = (diskLog.value + data.text).slice(-32768);
  });
  offProgress = window.tdlApi?.onCommentForwardProgress((data) => {
    if (data.taskId === selectedId.value) progress.value = data;
  });
  window.addEventListener("focus", refreshLogs);
});
onUnmounted(() => {
  offLog?.();
  offProgress?.();
  window.removeEventListener("focus", refreshLogs);
});
</script>
<template>
  <div class="queue-page">
    <header class="workflow-header">
      <div>
        <h1>任务队列</h1>
        <p>查看正在处理的内容，接着处理失败或未完成的任务。</p>
      </div>
      <button class="primary-button" @click="appState.activeView = 'newTask'">
        <AppIcon name="plus" :size="17" />新建流程
      </button>
    </header>
    <nav class="queue-tabs" aria-label="任务筛选">
      <button :class="{ active: tab === 'active' }" @click="tab = 'active'">
        进行中 <span>{{ activeCount }}</span></button
      ><button :class="{ active: tab === 'all' }" @click="tab = 'all'">
        全部任务 <span>{{ appState.tasks.length }}</span></button
      ><button :class="{ active: tab === 'history' }" @click="tab = 'history'">
        历史参数
      </button>
    </nav>
    <History v-if="tab === 'history'" />
    <div v-else-if="!rows.length" class="flow-empty">
      <AppIcon name="queue" :size="38" />
      <h2>
        {{
          tab === "active" ? "队列空闲，可以开始下一次搬运" : "还没有任务记录"
        }}
      </h2>
      <p>
        {{
          tab === "active"
            ? "完成的任务和处理结果会保留在「全部任务」。"
            : "在工作台选择来源、目标和范围，任务会在这里持续显示进度。"
        }}
      </p>
      <div class="action-row">
        <button class="primary-button" @click="appState.activeView = 'newTask'">
          前往工作台<AppIcon name="arrow" :size="18" /></button
        ><button
          v-if="appState.tasks.length"
          class="secondary-button"
          @click="tab = 'all'"
        >
          查看已完成任务
        </button>
      </div>
    </div>
    <div v-else class="queue-layout">
      <section class="task-list" aria-label="任务列表">
        <button
          v-for="t in rows"
          :key="t.id"
          class="task-row"
          :class="{ selected: selectedId === t.id }"
          @click="selectedId = t.id"
        >
          <span class="task-status-dot" :class="t.state" />
          <div class="task-row-copy">
            <strong>{{ t.title || t.type }}</strong
            ><span>{{ route(t) }}</span
            ><small>{{ time(t.createdAt) }}</small>
          </div>
          <span class="state-label" :class="t.state">{{ t.status }}</span>
        </button>
      </section>
      <aside v-if="selected" class="task-inspector">
        <div class="inspector-title">
          <h2>处理详情</h2>
          <span class="state-label" :class="selected.state">{{
            selected.status
          }}</span>
        </div>
        <h3>{{ selected.title || selected.type }}</h3>
        <p class="task-route-text">{{ route(selected) }}</p>
        <div v-if="progress?.total" class="task-progress">
          <n-progress
            type="line"
            :percentage="
              Math.round(((progress.current || 0) / progress.total) * 100)
            "
            :show-indicator="false"
          /><span>{{ progress.current || 0 }} / {{ progress.total }} 组</span>
        </div>
        <div v-if="selected.currentStep" class="mini-muted">
          流程步骤 {{ selected.currentStep }} / {{ selected.stepTotal }}
        </div>
        <dl class="task-facts">
          <dt>开始时间</dt>
          <dd>{{ time(selected.startedAt || selected.createdAt) }}</dd>
          <dt>结束时间</dt>
          <dd>{{ time(selected.finishedAt) }}</dd>
          <template v-if="selected.dryRun"
            ><dt>执行方式</dt>
            <dd>演练，未发送消息</dd></template
          ><template v-if="output(selected)"
            ><dt>结果位置</dt>
            <dd>{{ output(selected) }}</dd></template
          >
        </dl>
        <div v-if="selected.errorMessage" class="field-error" role="alert">
          {{ selected.errorMessage }}
        </div>
        <div v-if="selected.failedCount" class="field-error">
          有 {{ selected.failedCount }} 条未处理成功，可选择原工作目录续跑。
        </div>
        <div class="inspector-actions">
          <button
            v-if="active(selected)"
            class="secondary-button"
            @click="stop(selected)"
          >
            <AppIcon name="stop" :size="16" />停止任务</button
          ><button v-else class="primary-button" @click="retry(selected)">
            重试此任务</button
          ><button class="secondary-button" @click="edit(selected)">
            修改后新建</button
          ><button
            v-if="output(selected)"
            class="secondary-button"
            @click="openOutput(selected)"
          >
            <AppIcon name="folder" :size="16" />打开结果</button
          ><button class="text-action" @click="plan(selected)">
            设为计划任务<AppIcon name="chevron" :size="15" />
          </button>
        </div>
        <details class="advanced-rules">
          <summary @click="showLogs = !showLogs">运行日志</summary>
          <pre class="task-log">{{ diskLog || "暂无已保存的日志。" }}</pre>
        </details>
        <details class="advanced-rules">
          <summary>执行细节</summary>
          <pre class="command-preview">{{ command(selected) }}</pre>
        </details>
      </aside>
    </div>
  </div>
</template>
