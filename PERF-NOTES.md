# 本轮内存与性能改动

按「影响从大到小」排列。所有改动不改变功能行为。

## 1. 日志管线（最主要的内存来源）

**原来**：主进程每收到一块 tdl 的 stdout 就发一次 IPC，渲染进程每收到一条就
`appState.logs.push()` 一个响应式对象，并在 `v-for` 里渲染一个 `<div><pre>` + 一个按钮。
数组没有上限，DOM 也没有回收。

tdl 下载/导出时进度条用 `\r` 原地重绘，每秒能刷几十到上百次。跑十几分钟就是
**几十万条响应式记录 + 几十万个 DOM 节点**，而且每次 push 都会触发
`filteredLogs`（全量 filter）、`errorCount`（全量 filter）、以及一次滚动到底。
push 是 O(n)，整体 O(n²)。

**现在**：
- `electron/main.cjs` 新增 `sendLog()`：按 `taskId + level` 聚合，最多每 120ms 发一帧，
  单帧超 64KB 立即冲刷。任务结束前强制 flush，保证日志不丢。IPC 消息数降两个数量级。
- `src/logStore.js` 新增：按行合并；同一行内的 `\r` 重绘只保留最后一次结果；
  未换行的「活动行」（进度条）单独放 `appState.liveLines`，每个任务只占一行，
  不进历史缓冲；历史行做环形缓冲，上限 1500 行，超出批量丢弃。
  每条记录 `Object.freeze`，Vue 会跳过深层响应式包装。
- `src/components/TaskLog.vue`：只渲染尾部 400 行 DOM（复制/搜索仍覆盖整个缓冲区）；
  错误计数改为增量维护，不再每次变更全量 filter；滚动跟随每帧最多一次。

## 2. 对话列表

- `appState.cachedChats` 改为 `markRaw`。原来上千条对话（每条还带 `topics` 数组）
  被 `reactive()` 深层代理，每行、每个嵌套数组都是一个 Proxy。
- `sortChatsForUse` 改为「先算排序键再排序」。原来比较函数里现算 score，
  每次比较都要 `JSON.parse(localStorage)` 读收藏和最近列表，再线性扫描最近列表 ——
  n 条对话就是 O(n log n) 次 JSON.parse。
- `historyStore.readJson` 加了带失效的解析缓存。
- `ChatSelect` 有缓存时不再重复走 IPC。原来每次下拉展开 + 每次聚焦都会把整份列表
  重新序列化传一遍。
- 主进程 `readChatCacheStore()` 按 mtime 记忆解析结果，不再每次 `chats:cache:get`
  都整份 readFileSync + JSON.parse。

## 3. 评论区转发 worker

- `filterJsonByKeywords` 原来为整棵 JSON 建了一份完整深拷贝（每个数组、每个对象都新建），
  等于把已经很大的解析结果再翻一倍。改为原地过滤：数组读写双指针就地压缩，对象直接删键。
- 过滤后的条数原来是「写文件 → 再读回来 → 再走一遍全树」统计的，等于同一份数据
  解析两次、遍历两次。现在在过滤那一趟里顺便统计，省掉第二次。
- `runCommand` 里的 `stdout`/`stderr` 累积原来无上限（只用于失败时拼错误信息），
  导出大频道时能堆到几百 MB。现在只保留尾部 32KB。

## 4. 其他

- `KeepAlive` 加 `:max="3"`。原来 11 个页面访问过就永久常驻，组件树和 watcher 都不释放。
- `persistTasks` / `persistSchedules` 改为 250ms 合并写入，页面卸载前强制冲刷。
  原来每次任务状态变更都同步序列化 100 条记录写 localStorage。
- `App.vue` 的托盘状态 watcher 原来每次变更都把全部任务和计划拼成字符串再比较，
  改为只盯几个计数。
- `App.vue` 里 `onLog` / `onDone` 的取消订阅函数原来被丢弃，现在正确注销。

## 5. 打包

- `vite`、`@vitejs/plugin-vue`、`naive-ui`、`vue` 从 `dependencies` 移到 `devDependencies`。
  渲染端代码已经被 vite 打包进 `dist/`，运行时不需要这些包，但 electron-builder 会把
  production 依赖原样塞进安装包。
- 移除完全没被引用的 `electron-store`。
- `chats-cache.json` 不再用 `JSON.stringify(…, null, 2)` 缩进写盘。

## 6. 一个正确性修复

打包后 `defaultOutputDir()` 原来解析到 `HopeTDL.app/Contents/MacOS/output`——
写进应用包内部会破坏签名、可能被 Gatekeeper 拦，且升级时整个目录被替换导致数据丢失。
改为写 `~/Documents/HopeTDL/output`。开发模式行为不变。

---

## 还没做，但值得做

`webPreferences.backgroundThrottling: false` 目前必须保持关闭，因为定时任务调度器
跑在渲染进程里。这意味着窗口隐藏到托盘后，渲染进程仍然满速运行。
把调度器迁到主进程之后就能恢复默认节流，那是下一个数量级的收益 ——
详见 [ARCHITECTURE.md](ARCHITECTURE.md) 阶段 4。
