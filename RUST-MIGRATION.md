# HopeTDL 0.3：Rust 后台与 v2 界面

界面按用户提供的 `hopetdl-v2.html` 实现：折叠图标导航、主页、三栏工作台、任务卡片、独立计划与设置。五种任务保留经原版核对的完整参数，默认进入常用的评论搬运。详见 `UI-DESIGN.md`。

## 架构

- Vue + Naive UI：v2 布局、完整任务参数、历史、任务与计划界面。
- Tauri 2：系统 WebView、文件对话框、托盘与本地 Rust IPC。
- `src-tauri/src/engine.rs`：默认 2 个任务并发（设置即时生效，降低上限不终止已有任务）、排队、取消、子进程回收、多步流程和任务状态。继续使用外部 `tdl`，不重写 Telegram 协议。
- `comments.rs`：主消息→评论顺序、过滤、话题错误降级、`progress.json`、演练与续跑。
- `scheduler.rs`：独立于窗口的 15 秒检测周期、同一计划防重入、任务完成后推进增量游标。评论搬运与多步流程支持按时间执行；旧的导出/转发增量计划仍可执行。
- `filter.rs`：原生消息识别、内容类型过滤、关键词与 ECMAScript 风格正则替换。
- `store.rs`：有版本的 `runtime.json`，临时文件落盘并原子替换；已损坏的数据会报错，不静默清空。

关闭窗口只隐藏，后台继续处理。退出时先取消进程并等待收尾。上次未完成的任务在下次启动标记为中断，不自动重发。隐藏时停止高频日志 IPC，日志保存在本机；每个任务日志当前/上一份分别约 4 MB，详情按需读取尾部 32 KB。

## 数据与旧版

Rust 版标识为 `com.hope.tdlgui.rust`，应用名 `HopeTDL Rust`，与旧版独立。macOS 数据目录为 `~/Library/Application Support/com.hope.tdlgui.rust/`。

首次启动尝试复制旧 Electron 配置与对话缓存。任务、计划、收藏、分类和历史参数在旧版的 localStorage 中，使用这次源码中的 Electron 兼容入口运行后，从「设置 → 导出备份 / 迁移文件」导出，再在 Rust 版设置中导入。旧程序和原数据均保留。

导入前会生成 `before-import-<uuid>.json` 备份。导入的任务不会自动重放，计划统一暂停。导入后重启应用读取历史参数，再自行恢复需要的计划。

## 开发与构建

需要 Node.js、Rust、Tauri 平台工具链和已安装的 `tdl`。

```sh
npm ci
npm run dev             # Tauri + Vue
npm run dev:web         # 仅界面预览，无原生执行能力
npm run build:rust      # 在当前操作系统打包
npm test                # 原有逻辑与流程编译测试
npm run test:rust       # Rust 核心测试；其中跨语言参数比对需要 node
```

macOS 使用 `npm run build:mac`；Windows 在 Windows 上运行 `npm run build:win`。此轮已验证 macOS，Windows / Linux 还需要各自构建与真机回归。

旧 Electron 开发入口为 `npm run dev:electron`，打包入口为 `npm run build:electron`。迁移导出使用旧入口。原版表单中的导出后转发、评论媒体下载仍由界面串联；已启动的单步任务和评论搬运由 Rust 后台执行。

`HOPETDL_DATA_DIR=/绝对路径` 可启用隔离测试数据目录，此时不会自动复制旧配置。测试使用假的 tdl 子进程，避免测试流程向真实对话发送消息。

## 验证边界

自动测试覆盖参数与旧 JS 实现一致、流程编译、过滤、队列取消、失败输出、演练不写完成标记、流程失败后停止下一步、定时增量游标、原子存储和评论断点恢复。界面测试覆盖完整搬运演练路径、任务详情、计划创建和窄窗口。真实 Telegram 正式发送与多平台打包需要后续验收。


## 与原版逐项核对

先恢复原版作为核对基线，再按 v2 参考调整导航、布局与表单展示。五种任务的仅导出、独立主消息/评论开关、direct 默认模式、单边 ID、缓存/续跑/失败处理、下载多来源及上传标签均保留。

通过真实原版 worker 和 Rust worker 执行同一个假 tdl，比较 17 组场景的完整 argv 顺序、过滤 JSON 与完成/失败 ID。原版当前源码漏导入 `parseKeywords`，比对时仅在内存补上该 import；原版的 `delayMs || 1500` 在测试构造后改为 0 以省去等待，其他业务逻辑未修改。运行命令：

```sh
HOPETDL_ORIGINAL_ROOT=/path/to/original/HopeTDL cargo test --manifest-path src-tauri/Cargo.toml --no-default-features comment_worker_matches_original -- --ignored --nocapture
```

已知保留的安全差异：演练不写入已完成断点，避免正式续跑漏发；损坏 JSON 直接报错。上述模拟对比不代表已验证真实 Telegram 权限、话题可用性或实际发送。

## GitHub 自动构建

`.github/workflows/build.yml` 使用 npm 锁文件和 Rust 工具链构建 Rust/Tauri 版。PR 运行 JS / Rust 核心测试；推送 main、手动运行或推送 v 开头的版本标签时，在测试通过后分别构建 macOS Apple Silicon、macOS Intel、Windows x64 和 Linux x64。安装包在 Actions 页面的 Artifacts 中保留 14 天；版本标签还会生成 GitHub Release 并附上安装包。

macOS 提供 DMG 和 app.zip，Windows 提供 NSIS exe，Linux 提供 deb 和 AppImage。构建机无需 Telegram 账号或聊天数据；tdl 仍为用户单独安装的外部工具。macOS 当前采用本地临时签名，未配置 Apple 公证；Windows 未配置发行证书。构建成功不等同于完成各平台真实业务验收。
