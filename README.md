# HopeTDL

基于 **Vue 3 + Naive UI + Tauri 2 + Rust** 构建的 Telegram 桌面操作工具，保留并深度封装本机 [`tdl`](https://github.com/iyear/tdl) CLI，围绕「流程」而非零散表单组织日常导出、下载、转发与定时任务。

---

## 核心特性

### 1. 六页工作流界面
- **主页**：实时查看 `tdl` 运行环境、当前命名空间、并发槽位状态、最近任务与四类快速入口；支持二维码登录与状态反馈。
- **对话**：本地对话列表缓存、按本地分类/收藏管理（支持实时置顶与星标切换）、筛选表达预览，一键带入工作台各任务类型。
- **工作台（三栏联动）**：
  - 支持 **评论转发**、**导出消息**、**下载媒体**、**转发消息**、**上传文件** 五大任务及组合流程（导出后转发、评论区导出后下载）。
  - 中央展示流程步进器与完整参数表单；支持「历史参数」就地回填与「存为计划」。
  - 右侧实时展示高亮 **命令预览**（macOS/Linux 使用 POSIX 单引号安全转义，Windows 使用 PowerShell 转义）及 **过滤预览沙箱**（直接调用 Rust 原生过滤器测试文本或本地导出 JSON）。
- **任务**：按运行中 / 排队中 / 失败（含部分失败、中断）筛选，查看评论搬运分组进度、阶段指示点、`FLOOD_WAIT` 限流倒计时、尾部实时日志与失败消息列表，支持一键续跑或重试。
- **计划**：独立定时任务管理，按「活跃 / 暂停停用」分组，支持一次性、固定间隔与「频道有更新才执行」增量触发；支持全局暂停与从工作台未执行草稿直接排期。
- **设置**：支持 **跟随系统 / 深色 / 浅色** 三套主题（即时生效）、`tdl` 路径、命名空间、代理、并发任务上限（保存即生效）、全局消息/关键词过滤规则，以及迁移导出/导入。

### 2. Rust 原生后台能力
- **任务引擎 (`engine.rs`)**：Semaphore 动态并发控制（默认 2，可调 1–8）、有序排队与精确取消、子进程回收、单任务滚动日志（4 MB 轮转）。
- **评论搬运流水线 (`comments.rs`)**：`posts.json` 导出 → 逐组主消息/评论区导出 → 过滤 → 转发/仅导出 → `progress.json` 断点落盘（支持组内 `postDone` / `commentsDone` 子阶段续跑与损坏缓存自动备份重建）。
- **消息过滤 (`filter.rs`)**：按媒体类型（图片 / 视频 / 纯文本）、关键词与 ECMAScript 正则匹配/替换/删行，任务级关键词与全局规则各自独立配置。
- **后台调度 (`scheduler.rs`)**：独立于主窗口的 15 秒轮询调度，关闭窗口隐藏到系统托盘后继续执行，防重入并在任务成功后推进增量游标。
- **原子持久化 (`store.rs`)**：`runtime.json` 临时文件写盘并原子替换，异常中断任务重启后标记为「已中断」供人工确认。

### 3. 快捷键
- `1–6` / `W`：快速切换主导航页面或直达工作台
- `Ctrl / Cmd + L`：展开/收起底部任务日志抽屉
- `Esc`：按层级关闭当前弹窗、浮层或抽屉

---

## 环境要求与快速启动

运行与开发需要安装：
- **Node.js**（建议使用 lockfile 版本）
- **Rust 工具链** 与当前平台的 **Tauri 2** 系统构建依赖
- 已安装并配置好登录态的本机 **`tdl`**（可在「设置」中指定路径、命名空间与代理）

```sh
npm ci
npm run dev        # 启动 Tauri 桌面端 + Vue 开发服务
npm run dev:web    # 仅前端浏览器预览（无 Rust/tdl 原生执行能力）
```

---

## 测试与构建

```sh
npm test               # 运行前端/共享编译与校验单测
npm run test:rust      # 运行 Rust 核心引擎、过滤、调度与断点测试
npm run build          # 构建前端静态资源
npm run build:rust     # 构建当前平台的 Tauri 安装包
npm run build:mac      # 构建 macOS (.app / .dmg)
npm run build:win      # 在 Windows 上构建 NSIS 安装包
```

> 隔离测试数据目录可通过环境变量 `HOPETDL_DATA_DIR=/绝对路径` 指定；CI 构建流程见 [`.github/workflows/build.yml`](.github/workflows/build.yml)。

---

## 数据目录与旧版迁移

- Rust 版应用标识为 `com.hope.tdlgui.rust`（应用名 `HopeTDL Rust`），与旧 Electron 版数据目录相互隔离。
- macOS 数据目录位于：`~/Library/Application Support/com.hope.tdlgui.rust/`。
- 如需保留旧版入口：`npm run dev:electron` / `npm run build:electron`；可在旧版「设置」导出迁移包后导入到 Rust 版（导入前自动生成 `before-import-*.json` 备份，导入的计划默认处于暂停状态）。

---

## 相关文档

- 架构、安全边界与审计记录：[RUST-MIGRATION.md](RUST-MIGRATION.md)
- v2 界面规范与交互核对：[UI-DESIGN.md](UI-DESIGN.md)
- 系统架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)
