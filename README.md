# HopeTDL

一个以操作流程组织的 Telegram 桌面工具，使用 Vue 3、Tauri 2 和 Rust 后台，继续调用本机 `tdl`。

- 默认流程：源频道 → 目标群，主消息与评论按组顺序搬运。
- 三步完成：选择来源 → 目标与规则 → 确认执行。
- 支持演练、关键词过滤、ID 范围、话题、断点续跑。
- 下载媒体、导出记录、上传本地文件使用同一工作台。
- 任务队列、结果日志和计划任务由本机后台管理，隐藏窗口后继续执行。

```sh
npm ci
npm run dev
```

需要安装 Rust、当前平台的 Tauri 构建依赖，以及本机 `tdl`。在「设置」中配置账号命名空间、代理和 tdl 路径。

```sh
npm test
npm run test:rust
npm run build:rust
```

迁移方式、架构、构建和验证边界见 [RUST-MIGRATION.md](RUST-MIGRATION.md)。界面规范见 [UI-DESIGN.md](UI-DESIGN.md)。

旧 Electron 兼容入口：`npm run dev:electron`。Rust 版和旧版使用独立数据目录，导入时保留备份，导入的计划默认暂停。
