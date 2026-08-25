# Desktop 3.0 alpha.3 实施状态

状态日期：2026-08-23。架构事实以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准，目标规范以根目录 `docs/architecture/desktop/` 为准。

## 已落地

- Level 2 的独立 Core Runtime、`/api/v2`、`/host/v1`、ServerConnectionManager、Graph Revision、声明式 Route、typed service、tracked effect、事务事件和安全 Host capability 已进入唯一生产代码路径。
- `main-v3.ts` 已删除；Electron 入口只装配 lifecycle。Renderer bootstrap/`studio-shell` 不静态引入领域 runtime，原 17k 行聚合实现已拆成 shared/widgets 与十个 feature implementation，构建期 loader registry 产生真实动态 chunk；agents 原 4.2k 行聚合实现也已拆为 providers、sessions、runs、experiments 与 internal shared，93 行 `plugin.ts` 只负责组合。
- Bun 与 Electron-run-as-Node 使用同一强制终止 Migration Worker 协议；测试覆盖正常迁移、卡死 SQL、`SIGKILL`、WAL rollback 和独立 integrity worker。
- Pi、Codex、Grok Build、LangGraph.js 共享 vendor-neutral contract/conformance。Host generation reconciler、持久 run result/handle、确定性启动扫描和幂等 Commit 已启用。
- Level 3 Public Plugin API v1、独立 Extension Host、QuickJS/WASM sandbox、Capability Broker、namespaced storage/index、durable event subscription、namespaced route/command 和声明式 UI 已实现。
- 确定性扩展 ZIP、Ed25519 Registry/package trust、pack/verify/registry-build CLI、安装 preview/commit、原子 revision、rollback、quarantine、offline catalog 与 keep/export/delete 已实现。
- Marketplace 是 settings 的独立 lazy chunk；第三方 UI 只支持 command/menu/settings/form/table/panel，不执行 HTML、iframe、URL、React、Vue 或任意网页代码。
- `official-isolated-extension` 是 SDK、storage、event、route、command、effect 和 panel 的 conformance fixture。

## 发布边界

- 活动 Agent Engine 为 Pi 0.84.2、Codex 0.147.0、Grok Build 1.0.5、LangGraph.js 1.4.9，无静默 fallback；LangGraph.js 不是 Core Runtime workflow runtime。
- Extension Platform 当前是 beta 兼容起点；Public Plugin API v1 从此承担兼容承诺，Internal Plugin API 不对第三方承诺。
- 正式 GA 仍要求 macOS、Windows、Linux 分别完成安装、升级、离线 Registry cache、扩展安装/回滚、签名、公证和卸载 smoke。单机开发门禁不能替代三平台发布签核。
- isolated interactive UI、第三方可执行 UI、远程发布者后台与多 Runtime lease 不在本版。

## 质量门

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run test:runtime
bun run test:plugin-api-conformance
bun run test:engine-conformance
bun run test:extension-host-conformance
bun run test:extension-security
bun run test:marketplace
bun run check:architecture
bun run check:generated
bun run check:migration:complete
bun run check:engine-locks
bun run check:provider-catalog
bun run check:extension-packages
bun run build
bun run check:renderer-chunks
bun run test:e2e
bun run package
```

权威复验使用 Bun 1.4.0、规定的 Node/Electron ABI 和签名工具链。
