# DramaIP Desktop

DramaIP Desktop 3.0 alpha 是采用 React 19、第一方插件 Runtime 和本地 HTTP 边界的 Electron 桌面应用。

```text
React Renderer
  │ HTTP /api/v2 (Bearer)
  ▼
DramaIP Runtime (Hono + Kernel + SQLite + SSE)
  │ HTTP /host/v1 (different Bearer token)
  ▼
Electron Desktop Host
  ├── window / file grants / external links / credential vault
  └── Pi / Codex / Grok Build EngineSupervisor processes
```

Renderer 只读取冻结的 `RuntimeBootstrap { baseUrl, accessToken, appVersion, apiVersion }`，业务调用统一经由生成的 `@dramaip/client` 到 `/api/v2`；preload 不暴露任何 IPC 方法。Desktop Host 的 `/host/v1` 使用独立令牌，路径和凭据明文不会返回 Renderer。

`3.0.0-alpha.3` 将 Core Runtime 置于独立进程：Electron Main 只监督窗口、Host 和 vendor runtime。Pi 是默认内嵌 Agent Harness，Codex 与 Grok Build 是外部质量基准。 `Plugin → Bundle → Profile` 解析后才启动有效 Runtime 图；Profile 为 `studio`、`server`、`safe`、`test`、`e2e`，并且只引用内置 Bundle。

首次 alpha.3 启动会验证 alpha.2 的 `dramaip.db`，并在 `userData/backups` 建立含 SHA-256 与 schema 清单的验证备份；项目、Provider 与 `credentialRef` 保留，只重置 Agent 执行和评估数据。详情见 [v3 回滚说明](./docs/release/ROLLBACK_V3.md)。

三个智能引擎共享不可变上下文快照、Capability Grant、Session/Run/Item 事件和预览确认机制。任何引擎都不能直接修改正式内容或直接发起付费媒体任务，也不会在失败后静默切换引擎。盲测固定并发运行 Pi、Codex、Grok Build，随机映射 A/B/C；用户提交评价后才可揭晓真实引擎。

## P2 机器验收边界

`LM6-25` 的 Gate 使用 `full-electron-journey`、`timeline-reference-parser`、`local-project-package-and-migration`、`series-link-and-fork` 与 `two-identity-cloud-review-fake-gateway` 组合验证本地制作、NLE 交换、项目复用和可选审片闭环。它不扩大为外部兼容性声明：`no-real-nle-import-claim`、`no-mp4-without-timeline-render-provider`、`cloud-review-is-optional-and-local-first` 与 `docker-compose-e2e-is-enhanced-evidence` 均仍是发布边界。

可复跑的最小 Gate 命令为：

```bash
bun run check:timeline-exports
bunx playwright test tests/electron/lm6-full-journey.spec.ts --reporter=list
bun run test:runtime
```

## 开发

```bash
bun install
bun run-desktop.ts
bun run typecheck
bun run test
bun run check:generated
bun run check:architecture
bun run check:engine-locks
bun run build
```

无 Electron 的 Runtime 可用 `bun run serve --profile server --runtime node --database /absolute/path/dramaip.db --port 8787` 启动。支持的 Profile 是 `studio`、`server`、`safe`、`test`、`e2e`；`--runtime bun` 同样执行数据库与事件 conformance。

`bun run package` 需要提供 `DRAMAIP_UPDATE_URL`。Pi 0.84.2、Codex 0.147.0 与 Grok Build 1.0.5 的版本与完整性记录位于 `vendor/*.lock.json`；Pi Runtime 由冻结源码直接打包，首次运行不下载依赖。OpenCode 与 DeepSeek Harness 的 vendor 内容仅用于架构参考与完整性检查。
