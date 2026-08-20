# DramaIP Desktop 3.0 alpha 架构

`3.0.0-alpha.3` 的唯一产品边界如下。每一条来自 Renderer 的业务请求都经过 Runtime；Electron IPC 不是可调用的业务通道。

```text
Renderer
  │  generated @dramaip/client, HTTP /api/v2, Bearer runtime token
  ▼
Core Runtime Process（Node utilityProcess；Bun 为独立子进程）
  ├── Hono / OpenAPI / RFC 7807 / ETag / idempotency / cursor SSE
  ├── Cordis Kernel（私有）+ first-party plugins
  ├── SQLite migrations + durable event ledger/checkpoints
  └── HTTP /host/v1, Bearer host token
       ▼
Electron Desktop Host
  ├── window, file grant, validated external link, encrypted credentials
  └── EngineSupervisor → Pi / Codex / Grok Build
```

Preload 只将冻结的 `RuntimeBootstrap` 注入窗口：

```ts
type RuntimeBootstrap = Readonly<{
  baseUrl: string;
  accessToken: string;
  appVersion: string;
  apiVersion: "2";
}>;
```

它没有 `invoke`、`send`、文件系统、凭据或窗口方法。Runtime token 与 Host token 每次启动独立生成，互不复用。

## Runtime 与插件

Runtime 使用 Hono、`@hono/node-server`、`@hono/zod-openapi` 和 Zod。Client 由 Effective Graph OpenAPI 生成链和 `openapi-fetch` 提供；Renderer 不得直接调用 `fetch`。错误统一为 RFC 7807 Problem Details。写入端点使用 `ETag`/`If-Match`、`Idempotency-Key` 与 cursor pagination；SSE 同时接收 `Last-Event-ID` 和显式 cursor。

Kernel 将 Cordis、原始 SQLite 连接和其他插件实现封装在内部。插件 API 仅提供 descriptor、迁移、事务工作单元、事件、路由、UI contribution、capability 与 cleanup。启动会验证 Profile、重复项、缺失/循环依赖，并在激活失败时反向清理已激活插件。

目前登记的第一方插件为：

- `foundation`、`system`、`workspace`、`automation`、`writing`、`knowledge`、`agents`
- `creative-quality`、`production`、`media`、`timeline`、`review`、`delivery`、`insights`

组合严格遵循 `Plugin → Bundle → Profile → Effective Runtime Graph`。内置 Bundle 是 `core`、`automation-suite`、`writing-suite`、`agents-suite`、`production-suite` 与 `analytics-suite`；Profile 固定为 `studio`、`server`、`safe`、`test`、`e2e`，只可引用 Bundle，不能复制插件列表。任何 Profile 文件都不能引用归档目录。

Public Plugin API 独立为 v1：根导出仅是稳定 public surface，实验 API 使用 `@dramaip/plugin-api/experimental`，第一方 Runtime 实现显式使用 `@dramaip/plugin-api/internal`。Cordis、Hono、Raw SQLite 与迁移执行接口不会进入 public API。所有长期行为经 `ctx.effect()` 登记，并按 owner/revision 逆序清理。

## 数据、事件和升级

Runtime 的 SQLite 迁移账本包含插件归属和 checksum。业务写入与持久 `DomainEvent` 在同一个 SQLite 事务中提交；token、进度等短时状态使用 realtime event，不进入 durable ledger。consumer checkpoint 按全局 event cursor 记录。

首次 alpha.3 启动会在旧 Runtime 停止后，对 alpha.2 的 `dramaip.db` 执行 WAL checkpoint 和 integrity check，并生成 SHA-256、大小、版本和表清单的验证备份。独立的 `alpha2-agent-to-alpha3` state 会阻止中断后重复执行重置；项目、服务商配置、`credentialRef` 与 Codex 登录状态保留，只重置 Agent 会话、Run、Item、检查点与旧盲测数据。任何失败都停止启动且不覆盖源库。

Provider 与 Codex 凭据只存放在 Electron `userData/credentials` 的 AES-256-GCM 本地加密文件中。数据库只保存 `credentialRef`；Host 和 Runtime 不将明文凭据、绝对路径或 token 写入诊断或日志。

## 引擎

Pi、Codex 与 Grok Build 使用同一个 `Session → Run → Item` 模型和 `@dramaip/agent-runtime` 的 `createSession/prompt/steer/abort/resume/fork/subscribe/dispose` 生命周期。Pi 是默认第一方内嵌 Harness；Codex（stdio/App Server）和 Grok Build（ACP）是外部基准。Runtime 仅经 Host HTTP 调用监督器；vendor-native 协议和 utilityProcess 细节不进入 Renderer 或插件 API。所有引擎只获得本次运行的 Capability Grant；不支持的操作返回结构化错误，绝不静默回退。

活动锁定版本为 Pi 0.84.2、Codex 0.147.0、Grok Build 1.0.5。OpenCode 与 DeepSeek Harness 仅作为经过完整性校验的参考快照。Provider catalog 的 release 必须和应用版本一致。

## Headless 和诊断

`dramaip serve --profile <studio|server|safe|test|e2e> --runtime node|bun` 可以在没有 Electron 的环境启动。Headless Profile 仍提供 HTTP、数据库、插件、事件和 Web/CLI Client；依赖 Desktop Host 或本地引擎的 capability 必须明确报告 unavailable。`/health` 是无敏感的连接发现端点；认证后的 `/api/v2/version`、`/api/v2/capabilities` 与 `/api/v2/runtime` 提供协议协商与 Effective Graph。

`GET /api/v2/system/diagnostics` 是 alpha 退出指标，显示脱敏的 Profile、插件顺序/状态、迁移、事件消费者、Host/Engine 健康和剩余 bridge 路由数。

## 本地质量门禁

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run check:generated
bun run check:architecture
bun run check:engine-locks
bun run check:provider-catalog
bun run build
bun run test:e2e
DRAMAIP_UPDATE_URL=https://updates.example.invalid bun run package
```

`check:architecture` 会拒绝 Renderer IPC/直接 `fetch`、活动 `@sdns/*`、`/api/v1`、旧 workspace、中央 `{domain}` Router、`DomainWorkspace`、重复/缺失 OpenAPI operationId、迁移账本漂移、插件使用 Effect HTTP/Cordis 或跨插件实现导入。它与生成 Client、引擎锁和 Provider catalog 检查一起构成每个 alpha 的发布门槛。
