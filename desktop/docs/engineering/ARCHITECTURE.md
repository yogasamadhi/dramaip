# DramaIP Desktop 3.0 alpha 架构

> 文档类型：Descriptive Current Implementation
>
> 状态日期：2026-08-23
>
> 目标规范：[DRAMAIP Client / Plugin Runtime Architecture](../../../docs/architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)

本文只描述已经进入当前代码路径的事实。当前实现是完成 Level 2 进程、连接、插件和安全边界后，启用 Level 3 首版 Extension Platform；第三方 React、任意网页 UI、Node API、Raw SQLite、直连文件/网络仍未开放。

## 进程与信任边界

```text
Desktop / Web / CLI
  │ ServerConnectionManager → RuntimeTransport → @dramaip/client
  │ HTTP /api/v2 + SSE + OpenAPI
  ▼
Independent Core Runtime（Desktop: Electron Node；Headless/Server: Bun）
  ├── Effective Core Graph / Atomic RuntimeRouteRegistry
  ├── first-party Plugin Kernel / typed services / tracked effects
  ├── SQLite migration worker / events / checkpoints
  ├── Extension Capability Broker / Instance Effective OpenAPI
  └── HTTP /host/v1
       ▼
Electron Desktop Host
  ├── file grants / credential vault / SafeHttpTransport
  ├── EngineSupervisor → Pi / Codex / Grok Build / LangGraph.js
  └── ExtensionProcessSupervisor
       └── one utility process + one QuickJS/WASM runtime per active revision
```

Electron 入口 `electron/main.ts` 只装配桌面应用。窗口、shutdown、Host transport、Credential Capture、Safe HTTP、Engine event channel、Extension process 和 migration worker 已分别放入对应 supervisor/provider 模块；旧 `main-v3.ts` 不再存在。受管进程使用 generation、健康快照、pending 数、指数退避、jitter 和五分钟崩溃预算。Runtime generation 变化时轮换 Runtime/Engine token、结束旧 stream，停止旧扩展进程并用新 nonce 重建 BrowserWindow。

Renderer 的业务代码只使用 `@dramaip/client`。Preload 仅有绑定 `webContents`、30 秒有效、一次消费的 bootstrap nonce exchange；Credential 明文只在独立 sandbox modal 与 Host 私有通道中出现。

## Core Runtime 与第一方插件

组合固定为：

```text
Plugin → Bundle → Product Profile → Effective Core Graph Revision
```

14 个 bounded-context 插件拥有各自 route、migration、table、event、service 与 UI contribution。Kernel 只负责 graph、lifecycle、effect、service、event、migration 和 diagnostics。`ctx.effect(label, acquire)` 记录 owner、plugin version、graph revision 和 acquiredAt；activation 失败及 dispose 都逆序清理。

agents 的 `index.ts` 与 `plugin.ts` 只做 descriptor/migration/service/route/effect 组合；原聚合实现已拆为 `internal/shared`、`providers/routes`、`sessions/routes`、`runs/task-runner`、`runs/recovery` 和 `experiments/routes`。组合入口禁止 SQL 并受行数门禁保护。

第一方 HTTP route 已全部是声明式 `RouteContribution`。插件不接触 Hono app；同一 declaration 驱动 Router、OpenAPI、Catalog 和生成 Client，并声明认证、body limit、timeout、idempotency 与 concurrency policy。Router 采用 staged build 和 active reference 原子发布。

数据库迁移由独占数据库的子进程执行。Headless/Server 的 Bun Worker 与 Desktop 的 Electron-run-as-Node Worker 使用同一 IPC 协议；单项 60 秒、总计 10 分钟，超时精确终止 Worker，再由新进程完成 WAL recovery 与 integrity check。现有文件数据库在迁移前做验证备份和临时副本 dry-run。

`SqliteUnitOfWork` 在业务写入和 Domain Event 同一事务提交后才触发 `afterCommit`。Domain Event 使用数字 cursor、schema/upcaster 和 durable checkpoint；Realtime Event 不使用持久 cursor。SSE 限制每订阅者 1,000 event/4 MiB，并有 heartbeat、慢消费者断开和 replay。

## Client 与 Renderer

Client 分为 connection、transport、events、errors、generated 和 domains，并由单一 `RuntimeTransport` 构造 `StudioClient`。安全 GET 最多重连重试一次；mutation 永不自动重发。

Renderer 入口分为 bootstrap、`studio-shell`、routing、runtime-connection、contribution registry 与领域 feature。`studio-shell` 不静态导入领域 runtime；原 17k 行 Studio 合集已拆为 `studio-shared`、受控 cross-feature widgets 和十个 feature implementation，`studio-runtime.tsx` 只保留兼容导出。workspace、writing、creative、automation、production、media、review/delivery、insights、settings 和 agents 都通过固定动态 import loader 装载。Runtime 只返回启用的 contribution ID/metadata，Renderer 与构建期 canonical hash 取交集。未知或篡改 ID 只进入诊断。`safe/test` profile 不暴露未启用 contribution，chunk 门禁同时检查领域动态入口、禁止入口依赖 aggregate barrel，并拒绝重新生成 `studio-runtime` 聚合 chunk。

## Agent Engine 与恢复

Runtime 永远拥有 Session、Run、Item、checkpoint、Preview/Commit 和恢复状态；vendor thread/turn 只是执行句柄。Run 状态为：

```text
created / queued / preparing / running / waiting_approval / committing / completed
interrupted / failed / aborted / orphaned / recoverable
```

Pi、Codex、Grok Build、LangGraph.js 实现同一 vendor-neutral contract 和 conformance。LangGraph.js 在 Electron utility process 中执行固定提示图，只是 external-benchmark Engine，不接管 Core Runtime workflow。Engine 退出立即拒绝 pending、结束 stream、发送 `RUN_INTERRUPTED` 并清理队列。Host generation reconciler 恢复 Provider 配置并扫描 recoverable/running/committing：持久结果幂等 Commit；Codex 和 LangGraph.js 还能从私有快照读取已完成结果；句柄缺失转 orphaned；临时不可用保持 recoverable；不支持恢复转 interrupted。旧 generation、重复 cursor 和迟到 terminal event 被拒绝。

## Extension Platform v1

`@dramaip/plugin-api` 根导出是 Public Plugin API v1；第一方 Kernel API 只从 `/internal` 使用。扩展 bundle 在打包时拒绝 Node builtin、dynamic dependency、native addon 和未声明依赖，运行时从不由 Node `import()`。

每个 active revision 使用独立 Electron utility process 与 QuickJS/WASM runtime。默认限制为 64 MiB heap、1 MiB stack、同步 2 秒、完整调用 30 秒、4 并发、100 次/分钟、请求和响应各 1 MiB。五分钟五次崩溃进入 quarantine；retry 必须显式清除预算。QuickJS revision 失败会退出隔离进程，候选更新只有在启动与健康握手成功后才替换旧 revision。

Capability token 由 Runtime 生成并绑定 plugin ID、content revision、permission revision、scope、expiry 和 trace；插件 payload 中自报 identity 被忽略。当前 capability 包括 namespaced storage、manifest-declared event subscription、command、declarative UI、namespaced route、scoped projects/documents/assets、`ai.invoke`、受限 network 与 notification。网络同时经过签名 manifest origin、用户 grant 和 Host SafeHttpTransport；路径、Credential 明文和 vendor object 不进入沙箱。

System 插件拥有 installed revision、grant、publisher、registry source、audit、storage document/index 与 event checkpoint 表。第三方没有 SQLite 连接。存储按签名 manifest 的 JSON Schema 子集校验，并由通用 index-value 表维护声明索引。事件订阅使用 durable consumer 和 checkpoint。

扩展包是确定性 `.dramaip-extension` ZIP。验证拒绝绝对路径、`..`、symlink、重复文件、超限文件数/压缩/解压体积；Registry root 与 publisher package 都使用 Ed25519 canonical signature。`extension:pack`、`extension:verify` 和 `extension:registry:build` 生成可部署到 HTTPS 静态站点的产物。

Marketplace API 位于 `/api/v2/system/extensions`，提供 verified/offline-cached catalog、preview/commit、enable/disable/retry、rollback、uninstall keep/export/delete。权限扩大及 publisher/key 变化必须重新确认；失败更新保留上一 revision。扩展启停只改变独立 Extension Graph revision，不改变官方 Product Profile/Core Graph。

第三方 UI 只有 command、menu、settings、form、table 和 panel 严格 schema。主 Renderer 只使用平台组件、纯文本、固定 icon、受控字段和 slot allowlist；不解释 HTML，不加载脚本、iframe、URL 或第三方 React/Vue bundle。

## 安全和诊断

Renderer/Runtime 公共接口只处理 `FileGrantId`、`DirectoryGrantId`、`ArtifactRef` 与 `credentialRef`。Provider/Extension 网络经过 DNS 固定、IP 分类、redirect 重验、跨源去凭据、大小、类型与 timeout 策略。日志和 diagnostics 递归去除 Authorization、secret、prompt 和绝对路径。

诊断包含 Core/Extension graph revision、active/in-flight router、effect owner、migration、consumer、Host/Engine/Extension generation、restart budget、pending、Run recovery 和 trace。架构 Catalog 从真实注册源生成，不是第二套手写配置。

## 发布边界

Level 3 首版已实现并进入 conformance；仍明确属于未来的能力只有：

- 任意第三方 React/Vue 或网页代码；
- isolated interactive UI 容器；
- 远程 Marketplace 发布者后台；
- 多 Runtime SQLite consumer lease；
- 未通过 macOS、Windows、Linux 候选包签名/升级/卸载验证的正式 GA 声明。

本地质量门除原有门禁外增加：

```text
test:extension-host-conformance
test:extension-security
test:marketplace
check:extension-packages
check:renderer-chunks
```
