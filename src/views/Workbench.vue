<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { appState } from "../state";
import { message } from "../ui/naive";
import { defaultOutputDir, runJob, commandTextForSpec } from "../utils";
import { findChatByValue, chatTitle, chatUsername } from "../chatCache";
import { touchRecentChat } from "../historyStore";
import storage from "../storage";
import {
  ACTIONS,
  emptyDraft,
  validateDraft,
  buildWorkflow,
} from "../../shared/workflow.mjs";
import ChatSelect from "../components/ChatSelect.vue";
import AppIcon from "../components/AppIcon.vue";

const key = "hopetdl.workbench.draft.v1";
function stored() {
  try {
    return JSON.parse(storage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
const d = reactive({ ...emptyDraft(), ...stored() });
if (!ACTIONS[d.action]) Object.assign(d, emptyDraft());
const step = ref(Math.min(2, Math.max(0, Number(d.step) || 0)));
const error = ref(""),
  starting = ref(false),
  submittedId = ref("");
const task = computed(() =>
  appState.tasks.find((t) => t.id === submittedId.value),
);
const action = computed(() => ACTIONS[d.action]);
const transfer = computed(() => d.action === "transfer");
const hasTarget = computed(() => ["transfer", "upload"].includes(d.action));
const steps = computed(() => [
  "选择来源",
  hasTarget.value ? "目标与规则" : "保存与规则",
  "确认执行",
]);
const kinds = computed(() =>
  d.action === "upload"
    ? [["file", "本地文件"]]
    : d.action === "export"
      ? [["chat", "频道 / 群组"]]
      : transfer.value
        ? [
            ["chat", "频道 / 群组"],
            ["file", "已有消息记录"],
          ]
        : [
            ["chat", "频道 / 群组"],
            ["url", "消息链接"],
            ["file", "已有消息记录"],
            ["comments", "评论区"],
          ],
);
const sourceRow = computed(() =>
  findChatByValue(d.sourceChat, appState.cachedChats),
);
const targetRow = computed(() =>
  findChatByValue(d.targetChat, appState.cachedChats),
);
const sourceLabel = computed(() =>
  ["chat", "comments"].includes(d.sourceKind)
    ? chatTitle(sourceRow.value) || d.sourceChat || "尚未选择来源"
    : d.sourceKind === "url"
      ? `${d.links.split(/\r?\n/).filter((s) => s.trim()).length} 条消息链接`
      : d.sourcePath.split(/[\\/]/).pop() || "尚未选择文件",
);
const targetLabel = computed(() =>
  hasTarget.value
    ? chatTitle(targetRow.value) || d.targetChat || "尚未选择目标"
    : d.action === "export"
      ? d.exportFile || "尚未选择保存位置"
      : d.outputDir || "尚未选择保存目录",
);
const topics = computed(() => [
  { label: "默认聊天", value: "" },
  ...(targetRow.value?.topics || []).map((t) => ({
    label: t.title || String(t.id),
    value: String(t.id),
  })),
]);
const topicLabel = computed(
  () =>
    topics.value.find((t) => t.value === d.topic)?.label ||
    d.topic ||
    "默认聊天",
);
const rangeLabel = computed(() =>
  d.sourceKind === "chat"
    ? d.range === "id"
      ? `${d.startId || "起始"} — ${d.endId || "结束"}`
      : "全部消息"
    : d.sourceKind === "comments"
      ? d.mainIds
      : "按来源内容",
);
const contentLabel = computed(() =>
  transfer.value && d.sourceKind === "chat"
    ? [d.includeMain && "主消息", d.includeComments && "评论区"]
        .filter(Boolean)
        .join(" + ") || "尚未选择"
    : d.action === "download"
      ? "图片、视频及其他媒体"
      : d.action === "upload"
        ? "所选本地文件"
        : "消息记录",
);
const preview = computed(() => {
  try {
    const spec = buildWorkflow(d, "preview");
    return spec.kind === "comment-forward"
      ? "后台依次读取主消息与评论，应用过滤规则，再执行搬运。"
      : commandTextForSpec(spec);
  } catch {
    return "";
  }
});
let timer;
watch(
  d,
  () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => storage.setItem(key, JSON.stringify({ ...d, step: step.value })),
      300,
    );
  },
  { deep: true },
);
watch(step, (value) => {
  d.step = value;
  error.value = "";
  nextTick(() => {
    for (const el of document.querySelectorAll(".content, .flow-form-content"))
      el.scrollTop = 0;
  });
});

function chooseAction(value) {
  if (d.action === value) return;
  d.action = value;
  d.sourceKind = value === "upload" ? "file" : "chat";
  step.value = 0;
  submittedId.value = "";
  error.value = "";
}
function applyChat(row) {
  const kind = appState.newTaskKind;
  chooseAction(
    ["commentForward", "forward", "transfer"].includes(kind)
      ? "transfer"
      : ACTIONS[kind]
        ? kind
        : "transfer",
  );
  const id = String(
    row.id || row.dialog_id || row.dialogID || row.username || "",
  );
  if (d.action === "upload") d.targetChat = id;
  else {
    d.sourceKind = "chat";
    d.sourceChat = id;
  }
  if (kind === "forward") d.includeComments = false;
  if (kind === "commentForward") d.includeComments = true;
  step.value = d.action === "upload" ? 0 : 1;
}
watch(
  () => appState.selectedChat,
  (row) => {
    if (row) {
      appState.selectedChat = null;
      applyChat(row);
    }
  },
  { immediate: true },
);
watch(
  () => appState.workbenchRequest,
  (value) => {
    if (value) {
      appState.workbenchRequest = null;
      Object.assign(d, emptyDraft(), value);
      step.value = 0;
      submittedId.value = "";
    }
  },
  { immediate: true },
);
for (const [field, kind] of [
  ["selectedExportRecord", "export"],
  ["selectedForwardRecord", "transfer"],
  ["selectedDownloadRecord", "download"],
  ["selectedUploadRecord", "upload"],
  ["selectedCommentForwardRecord", "transfer"],
]) {
  watch(
    () => appState[field],
    (row) => {
      if (!row) return;
      appState[field] = null;
      Object.assign(d, emptyDraft(), {
        action: kind,
        sourceKind:
          field === "selectedForwardRecord" || kind === "upload"
            ? "file"
            : kind === "download"
              ? row.sourceType === "file"
                ? "file"
                : "url"
              : "chat",
        sourceChat: String(
          row.sourceChat || (kind === "upload" ? "" : row.chat) || "",
        ),
        sourcePath: row.from || row.path || row.files?.[0] || "",
        targetChat: String(
          row.targetChat ||
            row.peer ||
            (kind === "upload" ? row.chat : "") ||
            "",
        ),
        topic: String(row.targetTopicId || row.thread || row.topic || ""),
        outputDir: row.dir || appState.config.defaultDownloadDir || "",
        exportFile: row.output || "",
        links: (row.urls || []).join("\n"),
        runMode: row.dryRun === false ? "live" : "rehearsal",
        workDir: row.workDir || "",
        resume: !!row.resume,
        includeMain: row.forwardMain !== false,
        includeComments: row.includeComments !== false && row.forwardComments !== false,
        transferMode: row.mode || 'clone',
        keywords: row.blockKeywordsText || '',
        caseSensitive: !!row.keywordCaseSensitive,
        regexMode: !!row.keywordRegexMode,
        skipNoComments: !!row.skipPostWhenNoComments,
        skipBlockedComments: row.skipCommentsWhenPostBlocked !== false,
        continueOnError: row.continueOnError !== false,
        skipExisting: !!row.skipExistingExport,
        delayMs: row.delayMs ?? 1500,
        desc: !!row.desc,
        caption: row.caption || '',
        photo: !!row.photo,
        remove: !!row.remove,
        include: row.include || row.includeExt || '',
        exclude: row.exclude || row.excludeExt || '',
        template: row.template || '',
        group: row.group !== false,
        skipSame: row.skipSame !== false,
        rewriteExt: !!row.rewriteExt,
        takeout: !!row.takeout,
        resumeMode: row.resumeMode || 'continue',
        raw: !!row.raw,
      });
      if (row.startId || row.endId)
        Object.assign(d, {
          range: "id",
          startId: String(row.startId || ""),
          endId: String(row.endId || ""),
        });
      if (row.input && /^\d+,\d+$/.test(row.input)) {
        const [a, b] = row.input.split(",");
        Object.assign(d, { range: "id", startId: a, endId: b });
      }
      step.value = 0;
    },
    { immediate: true },
  );
}
function next() {
  error.value = validateDraft(d, step.value);
  if (!error.value) step.value++;
}
async function pickSource(directory = false) {
  if (!window.tdlApi) {
    error.value = "请在桌面应用中选择文件";
    return;
  }
  const p = directory
    ? await window.tdlApi.openDirectory()
    : await window.tdlApi.openFile({
        filters: [
          {
            name: d.action === "upload" ? "所有文件" : "消息记录",
            extensions: d.action === "upload" ? ["*"] : ["json"],
          },
        ],
      });
  if (p) d.sourcePath = p;
}
async function pickDir(field = "outputDir") {
  const p = await window.tdlApi?.openDirectory({
    defaultPath: d[field] || d.outputDir,
  });
  if (p) d[field] = p;
}
async function pickExport() {
  const p = await window.tdlApi?.saveFile({
    defaultPath: d.exportFile,
    filters: [{ name: "消息记录", extensions: ["json"] }],
  });
  if (p) d.exportFile = p;
}
async function submit() {
  error.value = validateDraft(d);
  if (error.value) return;
  if (!window.tdlApi) {
    error.value = "请在桌面应用中执行任务";
    return;
  }
  starting.value = true;
  try {
    const spec = buildWorkflow(
      d,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    if (!window.tdlApi.nativeRuntime && spec.kind === "workflow")
      throw new Error("多步流程需要在 Rust 桌面版运行");
    const result = await runJob(
      spec,
      `${action.value.title} · ${sourceLabel.value}`,
      {
        workflowDraft: JSON.parse(JSON.stringify(d)),
        sourceLabel: sourceLabel.value,
        targetLabel: targetLabel.value,
        outputPath: spec.workDir || spec.output || d.outputDir,
        dryRun: transfer.value && d.runMode === "rehearsal",
      },
    );
    submittedId.value = result.taskId;
    message.success("已加入后台任务队列");
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    starting.value = false;
  }
}
onMounted(async () => {
  const configured = await window.tdlApi?.getConfig();
  if (!d.outputDir) d.outputDir = configured?.defaultDownloadDir || await defaultOutputDir();
  if (!d.exportFile)
    d.exportFile = `${d.outputDir}${d.outputDir.includes("\\") ? "\\" : "/"}messages.json`;
});
</script>

<template>
  <div class="workbench">
    <header class="workflow-header">
      <div>
        <h1>{{ action.title }}</h1>
        <p>{{ action.description }}</p>
      </div>
      <button class="text-action" @click="appState.activeView = 'tasks'">
        查看任务队列<AppIcon name="chevron" :size="16" />
      </button>
    </header>
    <nav class="action-tabs" aria-label="操作类型">
      <button
        v-for="(item, key) in ACTIONS"
        :key="key"
        :class="{ active: d.action === key }"
        @click="chooseAction(key)"
      >
        <AppIcon :name="item.icon" />{{ item.title }}
      </button>
    </nav>
    <template v-if="!submittedId">
      <ol class="flow-steps" aria-label="执行步骤">
        <li
          v-for="(label, i) in steps"
          :key="i"
          :class="{ active: step === i, complete: step > i }"
        >
          <button
            :disabled="i > step"
            :aria-current="step === i ? 'step' : undefined"
            @click="step = i"
          >
            <span class="step-circle"
              ><AppIcon v-if="step > i" name="check" :size="18" /><template
                v-else
                >{{ i + 1 }}</template
              ></span
            >{{ label }}</button
          ><span v-if="i < 2" class="step-line" />
        </li>
      </ol>
      <div class="flow-columns">
        <section class="flow-form" :aria-label="steps[step]">
          <div class="flow-form-content">
            <template v-if="step === 0">
              <h2>
                {{
                  d.action === "upload" ? "选择要上传的文件" : "从哪里开始？"
                }}
              </h2>
              <p class="section-help">
                {{
                  transfer
                    ? "选好源频道，下一步设置目标群和评论规则。"
                    : "选择来源后，软件会自动衔接需要的处理步骤。"
                }}
              </p>
              <div
                v-if="kinds.length > 1"
                class="source-tabs"
                role="group"
                aria-label="来源类型"
              >
                <button
                  v-for="[value, label] in kinds"
                  :key="value"
                  :class="{ active: d.sourceKind === value }"
                  @click="d.sourceKind = value"
                >
                  {{ label }}
                </button>
              </div>
              <div
                v-if="['chat', 'comments'].includes(d.sourceKind)"
                class="field-stack"
              >
                <label>源频道 / 群组</label
                ><ChatSelect
                  v-model="d.sourceChat"
                  placeholder="选择或输入源频道 @username / ID"
                  :show-refresh="false"
                  @select="(row) => row && touchRecentChat(row)"
                />
                <p class="field-help">
                  可输入频道用户名或 ID，也可以从已缓存的对话中选择。
                </p>
                <button
                  class="text-action"
                  @click="appState.activeView = 'chats'"
                >
                  打开对话库<AppIcon name="chevron" :size="15" />
                </button>
              </div>
              <div v-if="d.sourceKind === 'file'" class="field-stack">
                <label for="source-file">{{
                  d.action === "upload" ? "本地文件 / 文件夹" : "已有消息记录"
                }}</label>
                <div class="input-with-action">
                  <input
                    id="source-file"
                    v-model="d.sourcePath"
                    :placeholder="
                      d.action === 'upload'
                        ? '选择本地文件或文件夹'
                        : '选择之前导出的 .json 文件'
                    "
                  /><button class="secondary-button" @click="pickSource()">
                    选择文件</button
                  ><button
                    v-if="d.action === 'upload'"
                    class="secondary-button"
                    @click="pickSource(true)"
                  >
                    文件夹
                  </button>
                </div>
                <p class="field-help">
                  {{
                    d.action === "upload"
                      ? "下一步选择上传到的对话。"
                      : "直接使用已有记录。需要连同评论搬运时，请选择频道来源。"
                  }}
                </p>
              </div>
              <div v-if="d.sourceKind === 'url'" class="field-stack">
                <label for="source-links">Telegram 消息链接</label
                ><textarea
                  id="source-links"
                  v-model="d.links"
                  rows="6"
                  placeholder="https://t.me/channel/123&#10;每行一条消息链接"
                />
              </div>
              <div v-if="d.sourceKind === 'comments'" class="field-stack">
                <label for="main-ids">主消息 ID</label
                ><textarea
                  id="main-ids"
                  v-model="d.mainIds"
                  rows="3"
                  placeholder="例如 1200, 1201, 1202"
                />
                <p class="field-help">
                  先读取这些主消息的评论，再下载其中媒体。
                </p>
              </div>
              <div class="workflow-note">
                <AppIcon name="info" :size="18" /><span
                  >这一步只选择来源，不会开始发送或下载。</span
                >
              </div>
            </template>
            <template v-else-if="step === 1">
              <h2>
                {{
                  hasTarget
                    ? transfer
                      ? "搬运到哪里？"
                      : "上传到哪里？"
                    : "保存到哪里？"
                }}
              </h2>
              <p class="section-help">
                {{
                  hasTarget
                    ? "选择要处理内容的目标群组和话题。"
                    : "设置保存位置与内容范围，后台会连续完成处理。"
                }}
              </p>
              <template v-if="hasTarget"
                ><div class="field-row">
                  <label>目标群组</label
                  ><ChatSelect
                    v-model="d.targetChat"
                    @select="d.topic = ''"
                    placeholder="选择或输入目标群组 @username / ID"
                    :show-refresh="false"
                  />
                </div>
                <div class="field-row">
                  <label for="target-topic">目标话题</label
                  ><n-select
                    v-if="targetRow?.topics?.length"
                    v-model:value="d.topic"
                    :options="topics"
                    filterable
                    tag
                  /><input
                    v-else
                    id="target-topic"
                    v-model="d.topic"
                    placeholder="默认聊天；有话题时填写 ID"
                    inputmode="numeric"
                  /></div
              ></template>
              <template v-if="transfer && d.sourceKind === 'chat'"
                ><div class="section-divider" />
                <h3>搬运内容</h3>
                <div class="check-stack">
                  <n-checkbox v-model:checked="d.includeMain">主消息</n-checkbox
                  ><n-checkbox v-model:checked="d.includeComments"
                    >评论区</n-checkbox
                  >
                </div>
                <p class="field-help">
                  依次处理：主消息 → 评论区 → 下一条主消息。
                </p></template
              >
              <template
                v-if="
                  ['transfer', 'export', 'download'].includes(d.action) &&
                  d.sourceKind === 'chat'
                "
                ><div class="section-divider" />
                <h3>消息范围</h3>
                <n-radio-group v-model:value="d.range"
                  ><n-radio-button value="all">全部消息</n-radio-button
                  ><n-radio-button value="id"
                    >指定 ID 范围</n-radio-button
                  ></n-radio-group
                >
                <div v-if="d.range === 'id'" class="range-inputs">
                  <label
                    >起始 ID<input
                      v-model="d.startId"
                      aria-label="起始 ID"
                      inputmode="numeric"
                      placeholder="例如 1200" /></label
                  ><span>—</span
                  ><label
                    >结束 ID<input
                      v-model="d.endId"
                      aria-label="结束 ID"
                      inputmode="numeric"
                      placeholder="例如 1500"
                  /></label>
                </div>
                <p v-else class="field-help">
                  处理来源中全部可访问的消息。
                </p></template
              >
              <template v-if="d.action !== 'upload' && !transfer"
                ><div class="section-divider" />
                <div class="field-stack">
                  <label
                    :for="d.action === 'export' ? 'export-file' : 'output-dir'"
                    >{{
                      d.action === "export"
                        ? "导出文件"
                        : transfer
                          ? "本地工作目录"
                          : "保存目录"
                    }}</label
                  >
                  <div class="input-with-action">
                    <input
                      v-if="d.action === 'export'"
                      id="export-file"
                      v-model="d.exportFile"
                      placeholder="messages.json 的保存位置"
                    /><input
                      v-else
                      id="output-dir"
                      v-model="d.outputDir"
                      placeholder="选择本地保存目录"
                    /><button
                      class="secondary-button"
                      @click="d.action === 'export' ? pickExport() : pickDir()"
                    >
                      选择
                    </button>
                  </div>
                </div></template
              >
              <div v-if="d.action === 'upload'" class="field-stack">
                <label for="caption">附带说明（可选）</label
                ><textarea
                  id="caption"
                  v-model="d.caption"
                  rows="3"
                  placeholder="为上传的文件添加说明"
                />
              </div>
              <details class="advanced-rules">
                <summary>
                  更多规则
                  <span>{{
                    transfer
                      ? "关键词过滤、顺序与断点续跑"
                      : "文件类型与处理选项"
                  }}</span>
                </summary>
                <template v-if="transfer"
                  ><div class="field-stack">
                    <label for="transfer-work-dir">本地工作目录</label>
                    <div class="input-with-action">
                      <input
                        id="transfer-work-dir"
                        v-model="d.outputDir"
                        placeholder="保存中间记录与进度的目录"
                      /><button class="secondary-button" @click="pickDir()">
                        选择
                      </button>
                    </div>
                  </div>
                  <div class="field-stack">
                    <label for="keywords">本次屏蔽关键词</label
                    ><textarea
                      id="keywords"
                      v-model="d.keywords"
                      rows="3"
                      placeholder="每行一个；命中时跳过整条消息"
                    />
                  </div>
                  <div class="check-stack">
                    <n-checkbox v-model:checked="d.caseSensitive"
                      >区分大小写</n-checkbox
                    ><n-checkbox v-model:checked="d.regexMode"
                      >使用正则表达式</n-checkbox
                    ><n-checkbox v-model:checked="d.desc"
                      >按 ID 倒序处理</n-checkbox
                    >
                  </div>
                  <template v-if="d.includeComments && d.sourceKind === 'chat'"
                    ><div class="check-stack">
                      <n-checkbox v-model:checked="d.skipNoComments"
                        >无评论时跳过整组</n-checkbox
                      ><n-checkbox v-model:checked="d.skipBlockedComments"
                        >主消息被屏蔽时跳过其评论</n-checkbox
                      ><n-checkbox v-model:checked="d.continueOnError"
                        >单条出错后继续后续消息</n-checkbox
                      ><n-checkbox v-model:checked="d.resume"
                        >继续上次未完成的搬运</n-checkbox
                      >
                    </div>
                    <div v-if="d.resume" class="input-with-action">
                      <input
                        v-model="d.workDir"
                        aria-label="原工作目录"
                        placeholder="选择包含 progress.json 的原工作目录"
                      /><button
                        class="secondary-button"
                        @click="pickDir('workDir')"
                      >
                        选择
                      </button>
                    </div>
                    <div class="field-stack">
                      <label>消息间隔（毫秒）</label
                      ><n-input-number
                        v-model:value="d.delayMs"
                        :min="0"
                        :max="600000"
                      /></div
                  ></template>
                  <div class="field-stack">
                    <label>转发方式</label
                    ><n-select
                      v-model:value="d.transferMode"
                      :options="[
                        { label: '复制消息（clone）', value: 'clone' },
                        { label: '保留来源（direct）', value: 'direct' },
                      ]"
                    /></div
                ></template>
                <template v-if="d.action === 'download'"
                  ><div class="field-row">
                    <label for="include">仅下载格式</label
                    ><input
                      id="include"
                      v-model="d.include"
                      placeholder="例如 mp4,jpg；留空不限"
                    />
                  </div>
                  <div class="field-row">
                    <label for="exclude">排除格式</label
                    ><input
                      id="exclude"
                      v-model="d.exclude"
                      placeholder="例如 zip"
                    />
                  </div>
                  <div class="field-row">
                    <label for="template">文件名模板</label
                    ><input
                      id="template"
                      v-model="d.template"
                      placeholder="留空使用默认命名"
                    />
                  </div>
                  <div class="check-stack">
                    <n-checkbox v-model:checked="d.group">按来源分组</n-checkbox
                    ><n-checkbox v-model:checked="d.skipSame"
                      >跳过相同文件</n-checkbox
                    ><n-checkbox v-model:checked="d.rewriteExt"
                      >修正扩展名</n-checkbox
                    ><n-checkbox v-model:checked="d.takeout"
                      >使用 Takeout 模式</n-checkbox
                    >
                  </div></template
                >
                <n-checkbox v-if="d.action === 'export'" v-model:checked="d.raw"
                  >保留原始消息结构</n-checkbox
                >
                <div v-if="d.action === 'upload'" class="check-stack">
                  <n-checkbox v-model:checked="d.photo"
                    >以图片形式上传</n-checkbox
                  ><n-checkbox v-model:checked="d.remove"
                    >成功后删除本地文件</n-checkbox
                  >
                </div>
              </details>
            </template>
            <template v-else>
              <h2>确认本次{{ action.title }}</h2>
              <p class="section-help">
                检查来源、目标和范围，然后选择执行方式。
              </p>
              <div
                v-if="transfer"
                class="run-modes"
                role="group"
                aria-label="执行方式"
              >
                <button
                  :class="{ active: d.runMode === 'rehearsal' }"
                  @click="d.runMode = 'rehearsal'"
                >
                  <span class="mode-radio" />
                  <div>
                    <strong>先演练一次</strong>
                    <p>读取来源并检查流程，不向目标群发送消息。</p>
                  </div></button
                ><button
                  :class="{ active: d.runMode === 'live' }"
                  @click="d.runMode = 'live'"
                >
                  <span class="mode-radio" />
                  <div>
                    <strong>正式搬运</strong>
                    <p>
                      向「{{ targetLabel }}」的{{ topicLabel }}发送选定内容。
                    </p>
                  </div>
                </button>
              </div>
              <div class="confirmation-list">
                <div>
                  <AppIcon name="check" :size="18" /><span>{{
                    transfer && d.includeComments && d.sourceKind === "chat"
                      ? "主消息与评论按组顺序处理，进度保存在工作目录。"
                      : "导出与处理步骤会自动连续执行。"
                  }}</span>
                </div>
                <div>
                  <AppIcon name="check" :size="18" /><span
                    >加入队列后可关闭窗口，在任务队列中停止或查看结果。</span
                  >
                </div>
                <div v-if="d.keywords">
                  <AppIcon name="check" :size="18" /><span
                    >关键词：{{
                      d.keywords.split(/\r?\n/).filter(Boolean).join("、")
                    }}</span
                  >
                </div>
              </div>
              <details v-if="preview" class="advanced-rules">
                <summary>查看执行细节</summary>
                <pre class="command-preview">{{ preview }}</pre>
              </details>
            </template>
            <div v-if="error" class="field-error" role="alert">
              <AppIcon name="info" :size="17" />{{ error }}
            </div>
          </div>
          <footer class="flow-actions">
            <button v-if="step > 0" class="secondary-button" @click="step--">
              <AppIcon name="back" :size="17" />上一步</button
            ><span v-else class="field-help">共 3 步，执行前可随时修改</span
            ><button v-if="step < 2" class="primary-button" @click="next">
              {{ step === 0 ? `下一步：${steps[1]}` : "下一步：确认执行"
              }}<AppIcon name="arrow" :size="18" /></button
            ><button
              v-else
              class="primary-button"
              :disabled="starting"
              @click="submit"
            >
              {{
                starting
                  ? "正在提交…"
                  : transfer
                    ? d.runMode === "rehearsal"
                      ? "开始演练"
                      : "确认并正式搬运"
                    : `开始${action.title}`
              }}<AppIcon name="play" :size="17" />
            </button>
          </footer>
        </section>
        <aside class="flow-review">
          <h2>本次{{ transfer ? "搬运" : "任务" }}</h2>
          <div class="review-route">
            <span class="review-label">来源</span>
            <div>
              <strong>{{ sourceLabel }}</strong><small
                v-if="sourceRow && chatUsername(sourceRow)"
                >@{{ chatUsername(sourceRow) }}</small
              >
            </div>
          </div>
          <div class="route-arrow">↓</div>
          <div class="review-route">
            <span class="review-label">{{
              hasTarget ? "目标" : "保存到"
            }}</span>
            <div>
              <strong>{{ targetLabel }}</strong><small v-if="hasTarget">{{
                topicLabel
              }}</small>
            </div>
          </div>
          <div class="section-divider" />
          <dl class="review-details">
            <dt>内容</dt>
            <dd>{{ contentLabel }}</dd>
            <template v-if="d.action !== 'upload'"
              ><dt>范围</dt>
              <dd>{{ rangeLabel }}</dd></template
            ><template v-if="step === 2 && transfer"
              ><dt>方式</dt>
              <dd :class="{ 'live-text': d.runMode === 'live' }">
                {{ d.runMode === "live" ? "正式搬运" : "演练，不发送" }}
              </dd></template
            >
          </dl>
          <div class="workflow-note">
            <AppIcon name="info" :size="18" /><span>{{
              step < 2
                ? "执行前还可以检查并选择演练。"
                : transfer && d.runMode === "rehearsal"
                  ? "演练不会写入已完成的搬运进度。"
                  : "执行后可在任务队列中查看进度。"
            }}</span>
          </div>
        </aside>
      </div>
    </template>
    <section v-else class="submission-result">
      <div class="result-mark" :class="task?.state">
        <AppIcon
          :name="
            ['queued', 'running'].includes(task?.state)
              ? 'queue'
              : task?.state === 'success'
                ? 'check'
                : 'info'
          "
          :size="32"
        />
      </div>
      <h2>{{ task?.status || "已加入队列" }}</h2>
      <p>
        {{
          task?.errorMessage ||
          (["queued", "running"].includes(task?.state)
            ? "任务在后台执行，你可以继续处理其他内容。"
            : task?.state === "success"
              ? "本次任务已完成。"
              : "可在任务队列中查看结果与日志。")
        }}
      </p>
      <div v-if="task?.currentStep" class="mini-muted">
        步骤 {{ task.currentStep }} / {{ task.stepTotal }}
      </div>
      <div class="result-route">
        {{ sourceLabel }}<AppIcon name="arrow" />{{ targetLabel }}
      </div>
      <div class="action-row">
        <button
          class="primary-button"
          @click="
            appState.focusedTaskId = submittedId;
            appState.activeView = 'tasks';
          "
        >
          查看任务详情<AppIcon name="arrow" :size="18" /></button
        ><button
          class="secondary-button"
          @click="
            submittedId = '';
            step = 0;
          "
        >
          继续新建任务
        </button>
      </div>
    </section>
  </div>
</template>
