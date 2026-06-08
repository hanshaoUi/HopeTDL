# HopeTDL Prototype

这是一个 `tdl` 图形化操作原型，基于 Electron + Vue 3 + Element Plus。

## 当前功能

- 检测 `tdl version`
- 二维码 / 验证码 / Desktop 登录入口
- 对话列表 `tdl chat ls`
- 导出消息 `tdl chat export`
- 转发消息 `tdl forward`
- 上传文件 `tdl upload`
- 全局设置：`ns`、`proxy`、`delay`、`limit`、`threads`、`tdlPath`
- 命令预览
- 实时任务日志

## 安装依赖

```bash
npm install
```

## 启动开发版

```bash
npm run dev
```

## 使用前准备

确保系统已经安装 `tdl`，终端可执行：

```bash
tdl version
```

如果命令不在 PATH，可在软件「设置」里把 `tdl 路径`改成完整路径。

## 建议配置

国内环境可以在「设置」里填写代理：

```text
socks5://127.0.0.1:7890
```

命名空间建议使用你当前已经登录的：

```text
hope
```

## 注意

转发页面默认开启 `dry-run`，只演练不真正发送。确认命令没问题后，再取消勾选正式转发。
