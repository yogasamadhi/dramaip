# Desktop 3.0 alpha.3 实施状态（功能迁移收口）

本文件记录当前工作树的实际状态，架构目标以根目录的 `docs/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` 为准。

## 已落地

- 版本、Provider Catalog 与 Runtime metadata 已统一到 `3.0.0-alpha.3`；HTTP API 为 v2，Public Plugin API 为 v1。
- Electron Main 通过 `core-runtime` utilityProcess 启动 Node Runtime，不再在 Main 中直接调用 `bootRuntime()`；Main 用 Server Connection Manager 的发现、认证和协商流程附着 Runtime。
- Core Runtime 提供最小无敏感的 `/health`，以及认证后的 `/api/v2/version`、`/api/v2/capabilities`、`/api/v2/runtime` 和 profile-effective `/api/v2/openapi.json`。
- `Plugin → Bundle → Profile → Effective Runtime Graph` 已实施。Profile 仅引用 Bundle，新增 `server` Profile。
- Kernel 使用 owner/revision-aware `ctx.effect()`，支持依赖版本检查、激活失败逆序清理与 effect 诊断。
- `@dramaip/plugin-api` 已分为 public、experimental、internal；第一方实现显式使用 internal 子路径。
- 数据库入口在 `@dramaip/database/sqlite` 隔离 Node `node:sqlite` 与 Bun `bun:sqlite`；Node/Bun 都运行同一 database、event、kernel、profile 和 connection 测试。
- `alpha2-agent-to-alpha3` cutover 会备份并二次校验 alpha.2 的 `dramaip.db`，保留项目与 Provider，只重置 Agent 执行/评估数据。
- `legacy-bridge` 工作区与 Electron sidecar 构建入口已移除；架构门禁会拒绝其重新出现。
- Desktop Host 扩展了目录 grant、通知、窗口聚焦、更新能力状态和 Pi、Codex、Grok Build 三引擎 operation HTTP surface；headless 下返回结构化 capability unavailable。
- 14 个第一方 bounded-context 插件均拥有实际 Route Contribution、forward-only migration、事务事件和声明式 UI Contribution；`studio/e2e` Effective Graph 当前生成 443 个唯一 OpenAPI 操作。
- 冻结的 217 项旧版 API 基线已形成机器可读迁移账本：211 项由类型化 v2 路由实现、1 项由新 Agent Run 接口替代、5 项按架构决定退役，`not_migrated` 为 0。
- Renderer 导航和路由由 Runtime 返回的 UI Contribution 与内置 loader registry 交集装配；`DomainWorkspace` 已删除，资源工作区按插件 owner 校验，不能跨域混用。
- 旧 `@sdns/server|db|mcp|protocol|tasks|ai-legacy` 源包、workspace、默认测试依赖和旧源码结构测试已删除；旧版只保留在 `legacy/desktop` 归档中供产品行为对照。
- Electron Vite 明确将第一方源码契约编译进 Main/Core Runtime，避免 utilityProcess 在启动时直接解析 workspace TypeScript；Runtime 启动失败会输出经过脱敏和长度限制的 stderr 诊断。

## 当前发布边界

- `@dramaip/agent-runtime`、三引擎 Host adapter、Session/Run/Item 持久化、Capability Grant 与 A/B/C 盲测均已落在 `agents` 插件；活动引擎严格为 Pi、Codex、Grok Build且无静默回退。
- 本机开发候选已通过全部 35 项 Electron E2E（其中包含 12 个明暗视觉基线）。正式发布仍需在 macOS、Windows、Linux 分别完成候选包、签名、公证和安装包 smoke；单一开发机结果不能替代三平台发布签核。
- 第三方 Extension Host、Permission/Trust、动态 React、Registry 与 Marketplace 仍属于 Phase 17+，本轮不加载任意第三方代码。

## 已验证

```bash
bun run typecheck
bun run test
bun run test:runtime       # Node 与 Bun
bun run check:generated
bun run check:architecture
bun run check:provider-catalog
bun run check:engine-locks
bun run build
bun run test:e2e           # 35/35（本机开发候选）
```
