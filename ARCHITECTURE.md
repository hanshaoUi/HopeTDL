# HopeTDL 架构现状与调整建议

## 一句话结论

现在的 HopeTDL 是「渲染进程当大脑，主进程当跑腿」：任务状态、调度器、历史记录全在
Vue 的 localStorage 里，主进程只负责 `spawn`。内存和 CPU 的问题不是某几行代码写差了，
而是这个分工本身逼着窗口必须常驻、必须关掉节流、必须把所有输出都灌进渲染进程。

---

## 一、现状的分层

```
渲染进程 (Vue)                          主进程 (Electron)
├─ appState.tasks      ← localStorage   ├─ activeTdlChildren  Map<taskId, child>
├─ appState.schedules  ← localStorage   ├─ currentCommentForwardWorker（单例）
├─ appState.logs                        ├─ config.json        (userData)
├─ 4 套 history        ← localStorage   ├─ chats-cache.json   (userData)
├─ startTaskScheduler() setInterval     └─ progress.json      (输出目录)
└─ 11 个页面各自拼 tdl 参数
```

### 问题 1：编排层放在了会被系统节流的进程里

`startTaskScheduler()` 是渲染进程里的 `setInterval(15s)`。窗口关闭时程序并不退出
（`close` 被 `preventDefault` 掉，隐藏到托盘），于是为了让定时任务在隐藏后还能跑，
`webPreferences` 里写了 `backgroundThrottling: false`。

代价是：**窗口隐藏时渲染进程仍然满速运行**——日志面板继续 diff、继续重排、继续
持有全部 DOM，一个后台常驻的托盘应用因此长期占着几百 MB。而收益其实是假的：
用户在托盘里点「退出」，或者渲染进程崩了，定时任务照样全没。托盘菜单上写着
「定时任务：已启用 3/5」，这个数字的真实来源却是一个可能已经被浏览器内核挂起的
`setInterval`。

**建议**：任务队列、调度器、任务状态迁到主进程。渲染进程降级为纯展示层，
通过 IPC 订阅快照。之后 `backgroundThrottling` 可以恢复默认（true），
窗口隐藏 = 渲染进程几乎零消耗，而定时任务由主进程的 timer 保证。

### 问题 2：两套执行路径没有共同抽象

| | 普通 tdl 任务 | 评论区转发 |
|---|---|---|
| 入口 | `tdl:run` | `comment-forward:start` |
| 并发 | **无上限**，点几次就 spawn 几个 | 单例，第二个直接拒绝 |
| 进度 | 只有日志 | 独立的 `progress` 事件 |
| 停止 | `tdl:stop(taskId)` | `stopCommentForward()` |
| 断点续跑 | 无 | progress.json |
| 能否定时 | 能 | `createScheduleFromTask` 里显式抛错禁止 |

同一个产品里两种任务的语义完全不同，用户能感知到：「为什么这个能定时那个不能」
「为什么这个能同时跑十个把 Telegram 限流了」。

**建议**：统一到一个 `TaskRunner` 抽象。

```
Task {
  id, type, spec, state, progress, createdAt, finishedAt, error
  run(ctx)   → 可中断
  resume(ctx)→ 可选，有 checkpoint 的任务实现它
}
TaskQueue { maxConcurrency, enqueue, cancel, snapshot }
```

普通 tdl 任务是「只有一个步骤的 Task」，评论区转发是「有 N 个步骤 + checkpoint 的 Task」。
并发上限统一控制（tdl 本身对 Telegram 有限流，同时跑多个只会更慢更容易被封）。
断点续跑、定时重放、进度上报这些能力自动对两者都成立。

### 问题 3：存储散在四个地方，没有版本和迁移

- `config.json`（userData）— 手写 fs 读写
- `chats-cache.json`（userData）— 手写 fs 读写
- `localStorage`：`tasks.v1`、`schedules.v1`、`export.memory.v1`、`forward.history.v1`、
  `upload.history.v1`、`download.history.v1`、`chat.prefs.v1` —— 七个 key，
  其中四个 history 的读写代码几乎逐字重复
- `progress.json`（跟着输出目录走，换目录就丢）

localStorage 还有个硬限制：5MB，且是同步 API。任务记录里存着完整 `args` 数组，
100 条任务 + 4 套历史各 80 条，接近上限时 `setItem` 会直接抛异常，
现在的代码是 `catch {}` 静默吞掉——用户会遇到「任务记录莫名其妙不保存了」。

**建议**：收敛成主进程里一个 store（JSON 文件足够，量再大换 SQLite），
带 `schemaVersion` 和迁移函数。四套 history 合并成一张 `records` 表用 `type` 区分。
渲染进程不再直接读写持久化。

### 问题 4：没有「任务描述」这一层模型

11 个页面各自手拼 `['chat','export','-c',chat,'-T','id',...]`，
然后 `utils.js` 里又反过来用 `findIndex(item => ['-i','--input'].includes(item))`
把参数解析回来，好在定时任务里改写范围。**把结构化数据拍平成字符串数组、
再用字符串匹配解析回来**，这是 bug 的温床——`argsForIncrementalRange`、
`outputPathForRange`、`inputRangeFromArgs` 这一整套都是在做这件事。

而且 `buildGlobalArgs`（main.cjs）和 `globalArgs`（utils.js）是两份一模一样的实现，
`looksLikeMessageObject` / `collectMessageIds` 在 main.cjs 和 worker.cjs 里也各有一份
（后者已在阶段 2 合并到 `electron/shared/messageJson.cjs`）。

> **关于 `buildGlobalArgs` / `globalArgs` 这一对重复**：没有把它抽成跨进程共享模块。
> 主进程是 CJS、渲染端是 vite 打包的 ESM，为一个函数搭跨运行时的共享层不划算；
> 更重要的是阶段 4 之后渲染端根本不该再拼命令行参数——那份实现会被整个删掉。
> 现在为它建共享模块，等于给一个注定要消失的东西加基础设施。

**建议**：引入 JobSpec 作为唯一的任务描述。

```js
// 结构化的，可存、可改、可重放、可定时
{ kind: 'export', chat: '@foo', range: { start: 101, end: 500 },
  withContent: true, output: '/path/x.json' }
```

`toArgs(spec)` 单向生成命令行；预览、执行、重试、定时全部消费同一个 spec。
增量调度只需要改 `spec.range.start`，不再需要解析字符串数组。
共享逻辑抽到 `shared/`，主进程和渲染进程都从这里 import。

### 问题 5：日志被当成了状态

`appState.logs` 过去是一个无上限的响应式数组，tdl 的每一个 stdout 块都 push 一条
并渲染一个 DOM 节点。这是本轮内存问题最直接的来源（详见 PERF-NOTES.md）。

本轮已经做了缓冲和裁剪，但结构上更合理的是：**日志是流，不是状态**。
主进程按任务写盘（`logs/<taskId>.log`）+ 内存里只留尾部若干行，
渲染端要看历史就按需拉取一个窗口。好处是任务日志可以在应用重启后回看，
现在重启就全没了。

---

## 二、建议的目标结构

```
electron/
  main.cjs              仅：窗口、托盘、IPC 注册
  shared/
    messageJson.cjs     ✅ 消息 JSON 的识别与 ID 提取（已落地）
  runtime/
    taskQueue.cjs       并发控制、状态机、快照
    tasks/
      tdlTask.cjs       单条 tdl 命令
      commentForward.cjs 多步 + checkpoint
    scheduler.cjs       主进程 timer，读 store，投递到 queue
    logSink.cjs         落盘 + 尾部缓冲 + 批量推送
    store.cjs           单一持久化入口，带 schemaVersion
shared/
  jobSpec.js            JobSpec 定义 + toArgs
  messageJson.js        collectMessageIds / looksLikeMessageObject
src/                    纯展示：订阅快照，提交 JobSpec
```

## 三、落地顺序

| 阶段 | 内容 | 风险 |
|---|---|---|
| ✅ 1 | 内存与性能止血（见 PERF-NOTES.md） | 低，无行为变更 |
| ✅ 2 | `electron/shared/messageJson.cjs`：消息 JSON 解析逻辑合并为唯一实现 | 低 |
| 3 | JobSpec 模型 + 各页面改为提交 spec | 中，要逐页改 |
| 4 | 主进程 TaskQueue + scheduler 迁移，渲染端改订阅 | 中高，收益最大 |
| 5 | store 收敛与 localStorage 数据迁移 | 中，需要迁移代码 |
| 6 | 日志落盘 + 按需窗口拉取 | 低 |

阶段 4 做完之后就可以把 `backgroundThrottling` 改回 `true`，
托盘常驻时的内存和 CPU 会再降一个台阶——那是这套调整最实在的收益。

---

## 四、顺带发现的两个正确性问题

1. **打包后往 .app 内部写文件**。`projectRoot()` 在打包模式下返回 `dirname(exe)`，
   在 macOS 上是 `HopeTDL.app/Contents/MacOS`，`output/` 就建在应用包里：
   破坏代码签名、可能被 Gatekeeper 拦、升级时整个目录被替换导致数据丢失。
   本轮已改为写用户文档目录。

2. **构建工具被打进了安装包**。`vite`、`@vitejs/plugin-vue` 放在 `dependencies` 里，
   electron-builder 会把 production 依赖原样复制进 asar，而渲染端代码其实已经被
   vite 打包进 `dist/` 了，运行时根本不需要它们。`electron-store` 更是完全没被引用过。
   本轮已全部移到 devDependencies。
