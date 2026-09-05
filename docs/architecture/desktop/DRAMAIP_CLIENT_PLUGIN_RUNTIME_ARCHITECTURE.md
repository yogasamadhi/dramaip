# DramaIP Client / Plugin Runtime Architecture

> 文档类型：Accepted / Normative Target Architecture
>
> 架构版本：2.0
>
> 更新时间：2026-08-23
>
> 正式实施范围：`desktop/`
>
> 当前实现事实：[desktop/docs/engineering/ARCHITECTURE.md](../../../desktop/docs/engineering/ARCHITECTURE.md)
>
> 实施路线：[DESKTOP_ARCHITECTURE_ROADMAP.md](./DESKTOP_ARCHITECTURE_ROADMAP.md)
>
> 通用基线：[DESKTOP_ARCHITECTURE_BASELINE.md](./DESKTOP_ARCHITECTURE_BASELINE.md)
>
> 通用 Level：[DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md](./DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md)

---

# 0. 文档权威与阅读方式

本文定义 DramaIP Desktop / Runtime 的长期目标和不可违反的架构约束，是 `desktop/` 技术设计的最高优先级产品规范。

文档职责：

```text
本文
= 目标架构、红线、Contract 和完成标准

desktop/docs/engineering/ARCHITECTURE.md
= 当前代码已经实现的事实

DESKTOP_ARCHITECTURE_ROADMAP.md
= 目标与当前之间的实施顺序和状态

Level 1 / 2 / 3 文档
= 通用架构选择参考
```

当文档发生冲突时：

- 判断“应该如何设计”以本文为准；
- 判断“当前代码是否已经做到”以当前实现说明和代码为准；
- 不得把 Roadmap 中的计划描述成已完成事实。

---

# 1. 核心决策

DramaIP 采用：

# HTTP Client / First-party Plugin Runtime / Isolated Extension Platform

目标不是复制 OpenCode、DeepSeek Harness、Codex 或归档实现，而是：

> 保留 DramaIP 成熟产品行为和领域状态语义，以独立 HTTP Runtime、第一方插件 Graph、Desktop Host 能力边界和 Vendor-neutral Agent Contract 承载产品；第三方扩展最终进入独立 Extension Host。

正式重构和实现只发生在：

```text
desktop/
```

参考材料：

```text
desktop/legacy/desktop2 = 只读架构模式参考
desktop/vendor/opencode = 只读 C/S 与多 Client 参考
desktop/vendor/deepseek-harness = 只读生命周期参考
desktop/vendor/codex-rust = 只读 Agent/App Server 参考
```

这些目录不得成为正式 Runtime 的构建或运行依赖。

---

# 2. 目标等级与当前成熟度

DramaIP 的长期产品目标是 Level 3，因为它具备多业务域、多 Client、复杂 Agent 工作流和未来第三方扩展价值。

当前实现成熟度必须准确表述为：

```text
Level 2 收口完成
+ Level 3 Extension Platform v1 beta 已启用
+ QuickJS/WASM 隔离、签名 Registry、声明式 UI 与 Marketplace
- isolated interactive UI / 远程发布者后台
```

因此：

- 当前第一方插件架构是真实产品架构，不是等待推翻的临时方案；
- 第三方代码只允许从受信签名包进入独立 Extension Host，不得进入 Core 或主 Renderer；
- Public Plugin API v1 从 Extension Platform beta 开始承担兼容承诺；
- Marketplace 只消费静态签名 Registry，不建设 `platform/` 远程发布后台。

---

# 3. 最终总体架构

```text
Desktop / Web / CLI / Automation Client
        │
        │ ServerConnectionManager
        │ REST / JSON / SSE / OpenAPI
        │ Bearer / deployment-specific authentication
        ▼
┌────────────────── DramaIP Core Runtime ──────────────────┐
│ Runtime Gateway / Auth / Version / Diagnostics           │
│                                                          │
│ Effective Core Graph Revision                            │
│   Plugin → Bundle → Product Profile                      │
│                                                          │
│ Minimal Kernel                                           │
│   Graph / Lifecycle / Effects / Services / Events        │
│   Migration / Capability / Contributions                 │
│                                                          │
│ First-party bounded-context plugins                      │
│ SQLite / UoW / Migration Ledger / Event Ledger           │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP /host/v1
                       ▼
┌────────────────── Electron Desktop Host ─────────────────┐
│ File / Credential / Window / Notification / Updater      │
│ Provider HTTP / Capability Broker                        │
│ Runtime / Engine / Extension supervisors                 │
│                                                          │
│ EngineSupervisor                                         │
│   Pi / Codex / LangGraph.js Adapters                     │
└──────────────────────────────────────────────────────────┘

未来：

Core Runtime Capability Broker
        │ authenticated local protocol + plugin identity
        ▼
Independent Extension Host(s)
        │
        ▼
Effective Extension Graph
        └── Official isolated / third-party plugins
```

最终逻辑组合：

```text
Product Profile
+ Installed Extension Set
+ Configuration
        │
        ▼
Effective Product Graph
├── Core Graph Revision
└── Extension Graph Revision
```

第三方扩展属于逻辑 Product Graph，但不进入 Core Runtime 进程。

---

# 4. 长期红线

以下规则不因重构阶段改变：

1. Renderer 不访问 Electron 业务 IPC。
2. Renderer 业务请求只通过 `@dramaip/client` 和连接/传输层访问 Runtime。
3. Core Runtime 不依赖 Electron 才能启动。
4. Electron Main 不承担领域业务、领域路由或业务工作流。
5. 插件不导入其他插件实现。
6. 每张业务表、路由、事件和迁移有唯一 owner。
7. Vendor Engine 不拥有 DramaIP 业务状态和工作流。
8. 第三方代码不进入 Core Runtime 和主 Renderer。
9. Renderer、Runtime DB、日志和诊断不持有 Credential plaintext 或不必要的绝对路径。
10. 不支持的 Engine 操作返回结构化错误，绝不静默 fallback。

---

# 5. Client、Runtime 与 Host 边界

## 5.1 Client → Runtime

正式业务 API 固定为：

```text
/api/v2
REST / JSON / fetch-based SSE / OpenAPI
```

无认证发现端点：

```text
GET /health
```

已认证协商端点：

```text
GET /api/v2/version
GET /api/v2/capabilities
GET /api/v2/runtime
```

## 5.2 Runtime → Desktop Host

正式 Host API 固定为：

```text
/host/v1
```

Runtime token 与 Host token 独立生成、独立轮换、互不复用。

## 5.3 Renderer bootstrap

Preload 只暴露冻结的 bootstrap metadata，不暴露 `invoke`、`send`、文件、Credential 或窗口业务方法。

长期目标：

```text
one-time nonce
    ↓ isolated bootstrap exchange
Runtime metadata / short-lived session token
```

该一次性通道不得演化为业务 IPC。Runtime generation 或 token 改变时，旧 Client session、旧 SSE、旧 pending response 全部失效。

---

# 6. Desktop、Headless 与 Remote Mode

## 6.1 Desktop Local Mode

Core Runtime 固定使用 Electron Node `utilityProcess`，并报告 `runtimeKind: electron-node`。Runtime 与 Host 监听 loopback，使用每次启动生成的 token。

## 6.2 Headless Mode

```text
dramaip serve --profile <studio|server|safe|test|e2e>
```

不启动 Electron。缺少 Desktop Host 或本地 Engine 时，相应 capability 返回 `CapabilityUnavailable`，不阻止 Runtime 启动。

## 6.3 Remote Server Mode

Remote Mode 是未来独立部署形态，必须使用：

```text
TLS / trusted reverse proxy
durable identity and session authentication
CORS / Origin policy
rate and body limits
audit / revocation
deployment-specific secret provider
```

不得把 Desktop Local Mode 的随机启动 token 和 Host 回调模型直接暴露到远程网络。远程 Runtime 默认无权控制 Client 本机 Desktop Host；未来若提供该能力，必须使用 Desktop 主动建立、用户可见、可撤销的 capability session。

---

# 7. Application Supervisor

Electron Main 是 Application Supervisor + Desktop Host，不是业务 Runtime。

建议拆分职责：

```text
electron/
├── main.ts
├── application-supervisor.ts
├── runtime/
├── host/
├── engines/
└── windows/
```

Runtime、Host、Pi、Codex、LangGraph.js 和未来 Extension Host 使用统一监督状态：

```text
created → starting → ready → degraded → restarting → stopping → stopped
```

每个实例记录：

```text
generation
pid
startedAt
health
restartCount
lastExit
pendingRequestCount
configured / authenticated
```

要求：

- 监听端口由系统分配，通过 ready handshake 返回；
- restart 使用 backoff、jitter、时间窗口和总预算；
- generation 不匹配的迟到响应和事件被拒绝；
- Engine 崩溃立即终止对应 stream 和 pending request；
- Runtime 重启生成新 token，不复用旧 bootstrap；
- shutdown 先停止新 UI 工作，再停止 Engine、Runtime，最后关闭 Host；
- E2E kill Runtime/Engine 后不存在僵尸进程和悬挂 Promise。

Electron Main 不得直接调用插件业务路由完成领域恢复；恢复逻辑由 Runtime 自身或正式系统 Contract 驱动。

---

# 8. ServerConnectionManager

Desktop、Web、CLI 必须共享连接状态机：

```text
idle
discovering
attaching
authenticating
negotiating
ready
reconnecting
degraded
disconnected
incompatible
```

标准流程：

```text
discover /health
→ attach existing or spawn local Runtime
→ authenticate /api/v2/runtime
→ negotiate HTTP API / Plugin API / capabilities
→ bind runtime id and generation
→ establish generated client and SSE cursor
→ ready
```

连接层负责：

```text
explicit endpoint / existing local / spawned local selection
protocol incompatibility reporting
runtime id and generation detection
SSE heartbeat and cursor replay
safe GET reconnection
disconnect and cancellation
```

连接层绝不自动重试普通非幂等 mutation。mutation 超时但服务端可能已提交时，由 `Idempotency-Key` 查询/重放语义解决。

Runtime token 改变时，近期安全方案是重建 BrowserWindow 并注入新 bootstrap；以后可以建立仅用于 bootstrap 更新的一次性 MessagePort，但不得承载业务 API。

---

# 9. Runtime 兼容基线

Bun 1.4.0 是开发、构建、测试、打包和 Headless/Server 的唯一运行时；Desktop 受管进程使用 Electron 内嵌 Node。系统 Node 不是受支持的工具链或部署依赖。

```text
Headless / Server = bun
Desktop           = electron-node
System Node       = forbidden dependency
```

Runtime-specific API 必须位于 `runtime-adapters`。业务插件不得自行判断 Bun/Electron Node 或使用 Bun-only API。

Extension Host supervisor 使用 Electron 内嵌 Node；第三方代码仍只在 QuickJS/WASM 沙箱中执行，不能据此获得 Node API。

---

# 10. First-party Plugin Graph

正式第一方 bounded-context plugins：

```text
foundation
system
workspace
automation
writing
knowledge
agents
creative-quality
production
media
timeline
review
delivery
insights
```

`legacy-bridge` 只代表迁移时代的唯一桥接边界，不是可重新激活的正式业务插件；不得拥有独立 package 或进入 Profile。

正式 Bundle：

```text
core
automation-suite
writing-suite
agents-suite
production-suite
analytics-suite
```

正式 Profile：

```text
studio
server
safe
test
e2e
```

组合：

```text
Plugin → Bundle → Product Profile → Effective Core Graph Revision
```

Profile 只引用 Bundle，不能复制插件列表。Bundle 不拥有业务表、迁移、状态或事件。

---

# 11. Minimal Kernel 与 Cordis

Kernel 只负责：

```text
graph resolution and validation
lifecycle and effect tracking
typed services and capabilities
events and migration coordination
contribution staging
diagnostics
```

Cordis 可以继续作为私有 composition root，但：

- 不进入 `@dramaip/plugin-api` public surface；
- 不暴露给第三方；
- 不成为插件间万能 Context；
- 不要求把完整 Cordis HMR/fiber 模型搬进生产 Core Runtime；
- DramaIP Contract 和测试定义语义，Cordis 只是可替换实现细节。

Kernel 不包含写作、Agents、媒体、制作、审片、交付或洞察业务。

---

# 12. Graph Revision 与 Plugin Lifecycle

Graph revision fingerprint 至少包含：

```text
profile
bundle versions
plugin versions
contract versions
configuration fingerprint
future installed extension set revision
```

启动与切换流程：

```text
Resolve
→ Validate
→ Migrate
→ Stage Contributions
→ Activate Plugins
→ Validate OpenAPI / UI / Event / Service Graph
→ Atomic Commit Revision
→ Ready
```

任何阶段失败不得暴露半激活 Runtime。

当前第一方生产 Graph 默认启动后不可变，Profile 切换可通过 Runtime restart 完成。只有原子 Router/Graph 机制和故障测试完成后才开放运行期 reload。

---

# 13. Reversible Effects 与 Router

所有长期 route、service、event handler、timer、watcher、command、UI contribution、background task、stream、worker 和 child process 必须登记 effect 或 supervisor owner。

目标 API：

```ts
await ctx.effect("route:workspace.projects", () => ctx.http.register(route));

await ctx.effect("timer:automation.scheduler", () => {
  const timer = setInterval(tick, interval);
  return () => clearInterval(timer);
});
```

每个 effect 记录：

```text
owner
plugin version
graph revision
label
acquiredAt
```

同一 owner 逆序清理，activation 失败清理当前 revision，测试结束 effect 数归零，诊断接口列出所有活跃 effect。

删除 route registry metadata 不代表底层 Hono handler 已卸载。正式策略：

```text
Current safe mode
= immutable Router for a running Core Graph

Future dynamic mode
= build Router B → validate → atomic swap → dispose Router A
```

不得操作 Hono 私有路由表实现逐条删除。

---

# 14. Typed Services 与跨插件协作

正式服务 API：

```ts
ctx.services.provide<T>(contract, implementation);
ctx.services.require<T>(contract);
ctx.services.optional<T>(contract);
```

Contract 包含 id、version、capabilities、输入输出类型、错误类型和 owner。

插件只能通过以下方式协作：

```text
@dramaip/contracts/<domain>
typed service
capability
public domain event
explicit read-only projection
```

Repository 只访问本插件拥有的表。Route handler 不直接堆积 SQL；Service 承担领域规则；Orchestrator 承担多步骤工作流。

---

# 15. 数据、迁移与事件

DramaIP 使用 SQLite + Drizzle，保持单一 authoritative writer。

每个插件导出：

```text
forward-only migrations
table / index ownership
event schemas and versions
retention policy
read-only projections
```

迁移账本记录：

```text
plugin id
migration id
plugin version
dependency
checksum
executedAt
duration / result
```

迁移支持 preflight、verified backup、integrity check、timeout、dry-run diagnostics 和失败后可诊断状态。不得自动导入未知 legacy 数据；历史 cutover 使用正式备份与一次性迁移流程。

## 15.1 Domain Event

```text
business write + persistent event = same transaction
```

commit 后立即唤醒 durable dispatcher。Consumer 使用全局数字 cursor、checkpoint、at-least-once、幂等 handler、retry/backoff、dead-letter/degraded diagnostics、schema version 和 upcaster。

## 15.2 Realtime Event

Token、进度、健康和临时状态不作为业务事实。Realtime ID 与持久 Domain Event cursor 是不同语义，SSE envelope 必须显式区分。

Consumer lease 只有在未来明确支持多个 Runtime 共享同一数据库时才引入，当前单 Runtime 模型不提前承担 HA 复杂度。

---

# 16. HTTP、OpenAPI 与 Client

Runtime API 统一处理：

```text
RFC 7807
Authorization
ETag / If-Match
Idempotency-Key
cursor pagination
trace id
Origin / CORS
body limit
timeout / cancellation
SSE heartbeat / replay / backpressure
```

插件声明 route Contract 和策略，不重复实现底层机制。

`@dramaip/client` 目标结构：

```text
transport / connection / events / errors
generated OpenAPI paths and operation clients
domain clients
small handwritten workflow conveniences
React Query adapters
```

正式 Platform OpenAPI 只覆盖稳定 `/api/v2`。未来第三方 Extension Route 进入 Instance Effective OpenAPI，不直接改变编译期生成的官方 Client surface。

所有 route 必须具有唯一 `operationId`，API 或 schema 变化必须导致生成检查失败。

---

# 17. Renderer 与 UI Contribution

目标结构：

```text
app/
├── bootstrap/
├── shell/
├── routing/
├── runtime-connection/
├── contribution-registry/
└── features/<domain>/
```

构建期生成签名内置 loader registry：

```ts
const builtinLoaders = {
  "workspace.route.home": () => import("./features/workspace/home"),
  "writing.route.home": () => import("./features/writing/home"),
  "agents.slot.assistant": () => import("./features/agents/assistant"),
};
```

Runtime 只返回启用 ID 和 metadata：

```text
Runtime contribution IDs
       ∩
signed builtin loader registry
       ↓
actual routes / components
```

未知 ID 永不执行代码。第一方 UI 按领域 lazy load；第三方 React bundle 永不进入主 Renderer。未来第三方 UI 按 Command/Settings → Declarative Panel → Isolated Interactive UI 的顺序开放。

---

# 18. Desktop Host 安全能力

## 18.1 File

正式 Contract 使用：

```text
fileGrant
directoryGrant
exportGrant
artifactRef
```

逐步淘汰 Renderer 可见的绝对路径和 `revealPath(path)`，改为 `revealGrant(grantId)`、`revealArtifact(artifactRef)`。

## 18.2 Credential

最终边界：

```text
Renderer requests capture session
→ Host-owned credential capture
→ encrypted Host storage
→ Renderer / Runtime receive credentialRef only
```

在 Host-owned capture 完成前，Renderer 输入 API Key 属于明确记录的过渡缺口，不能声称“Renderer 永远未见明文”。

## 18.3 Provider HTTP

必须校验：

```text
URL scheme
DNS rebinding
private network policy
redirect count
provider domain allowlist
request / response size
content type
timeout
credential scope
audit without secret
```

## 18.4 Bootstrap

避免长期 Runtime token 出现在进程命令行。使用一次性 nonce/内部交换；token 仅保存在隔离 Renderer 内存，Runtime restart 后旧 token 立即失效。

---

# 19. Agent Runtime 与 EngineSupervisor

活动 Engine：

```text
Pi 0.84.2
Codex 0.147.0
LangGraph.js 1.4.9
```

Pi 是默认签名第一方 utility-process harness；Codex 使用 native stdio App Server；LangGraph.js 在 Electron utility process 中运行固定的“模型调用 → 文本/JSON 校验 → 最多一次修复”基线图。LangGraph.js 是活动 external-benchmark Engine，但不是 Core Runtime 的 Workflow Runtime，也不运行自主模型工具循环。OpenCode 与 DeepSeek Harness 仅为只读参考。

`@dramaip/agent-runtime` 是 Vendor-neutral Contract，不得暴露 Electron、SQLite、Hono、Cordis 或 Vendor 类型。

统一生命周期：

```text
availability
create / createSession
prompt
steer
abort
resume
fork
subscribe
dispose
health
```

Runtime 中的 `agents` 插件只通过 `/host/v1` 使用 EngineSupervisor。

## 19.1 事实源

```text
DramaIP Session / Run / Item = persistent business truth
Vendor Thread / Turn          = resumable execution handle
```

Vendor session 不能成为隐式业务事实源。

## 19.2 Run 状态

```text
created → queued → preparing → running
        → waiting_approval → committing → completed

exception:
interrupted / failed / aborted / orphaned / recoverable
```

Runtime 启动扫描不一致 Run，确定性决定 resume、recover、fail 或 orphan，不允许永久停留 `running`。

## 19.3 Engine Conformance

Pi、Codex、LangGraph.js 运行共享测试：

```text
availability / authentication
create / prompt / subscribe
steer / abort / resume / fork
stream cursor and backpressure
duplicate / delayed event
crash during run
unsupported operation
dispose
Host unavailable
```

## 19.4 Streaming

队列必须具有最大事件数、最大字节数、慢消费者策略、AbortSignal、heartbeat、分级 timeout 和 engine-crash final event。

## 19.5 Vendor capability request

Vendor 主动 approval/tool request 必须由 Adapter normalize，经 Runtime Capability Broker 转成 DramaIP approval/event，再由用户或 Host 决定。不得直接穿透 Renderer 或 Electron Main。

Core Runtime 继续拥有 Preview/Commit、checkpoint、retry、idempotency、workflow 和 capability grant；Engine 只拥有 reasoning、model interaction、tools 和 session execution。

---

# 20. Extension Platform v1（已实现）

Extension Platform 在 Core Graph、连接、恢复和安全能力收口后启用，并维护独立 Extension Graph revision。

每个 active extension revision 使用独立 Electron utility process 和独立 QuickJS/WASM runtime，提供：

```text
manifest loader
compatibility check
plugin identity
permission resolver/client
lifecycle and effect tracking
capability client
audit / rate accounting
crash isolation and quarantine
```

第三方只依赖：

```text
@dramaip/plugin-api public exports
@dramaip/contracts public exports
granted capabilities
```

禁止 Raw SQLite、Runtime internals、Electron Main、任意文件/网络、主 Renderer 注入和 Vendor native object。

Node 进程只承担 supervisor/bridge，不加载第三方 bundle；实际第三方代码在 QuickJS/WASM 中执行。平台限制模块加载、native addon、环境、文件、网络、child process、CPU/内存、并发和速率；权限在 Core/Host 权威边界再次执行。

第三方存储使用 namespace storage 或声明式 schema capability，不提交任意 SQL。第三方 Server Contribution 经 `/api/v2/extensions/{pluginId}` 稳定代理，不能直接注册 Core Router handler。

已实现的分发和 UI 边界：

```text
deterministic .dramaip-extension ZIP
Ed25519 registry root + publisher package signature
HTTPS static Registry + verified offline cache
preview / commit / update / rollback / quarantine / uninstall
command / menu / settings / form / table / panel declarative UI
```

第三方 React/Vue、HTML/script、外部 iframe/URL、任意网页代码、isolated interactive UI 和远程发布者后台仍属于 future。

---

# 21. Architecture Catalog 与生成门禁

架构清单应从代码事实生成并提交可审计快照：

```text
architecture/table-owners.json
architecture/route-owners.json
architecture/event-owners.json
architecture/ui-contributions.json
architecture/engine-capabilities.json
architecture/service-contracts.json
```

源真相分别是 Plugin Descriptor、Migration、Route Contribution、Event Schema、UI Contribution、Agent Contract 和 typed service contract。JSON 快照不得成为第二套手写配置。

门禁至少检查：

```text
Renderer only uses @dramaip/client / connection layer
Renderer no Electron business IPC, direct fetch or server implementation import
Electron Main no plugin implementation or domain orchestration
unique table / route / event owner
unique operationId
no cross-plugin implementation import
no forbidden dependency in @dramaip/agent-runtime
no plaintext credential / absolute path in public contracts
no untracked long-lived side effect
no third-party code in Core or main Renderer
migration / OpenAPI / generated client drift
```

副作用门禁需要受控 API + AST/依赖规则 + runtime leak test，不能只使用文本搜索。

---

# 22. 当前实现状态

截至 2026-08-23：

## 22.1 已实现并应保留

```text
Renderer → generated client → /api/v2 Runtime
Runtime → /host/v1 Desktop Host
one-time nonce bootstrap exchange without business IPC
independent Electron Node Runtime and Bun Headless mode
Bun / Electron utility-process runtime conformance
14 first-party plugins
Plugin → Bundle → Profile → Effective Graph Revision
private Cordis composition root
acquisition-style tracked effects and atomic route registry
typed service contracts
plugin migration ledger and checksums
transactional afterCommit events, schema/upcaster and realtime distinction
Pi / Codex / LangGraph.js vendor-neutral contract
Pi / Codex / LangGraph shared engine conformance
opaque file/artifact grants and Host-owned credential capture
policy-bound credential vault and SafeHttpTransport
Public / Experimental / Internal plugin-api surfaces
architecture / generated / engine lock / provider catalog gates
```

## 22.2 Level 2 收口实现

```text
pure Electron entry + Runtime/Host/Engine/Extension/Window supervision
fully declarative first-party RouteContribution; no install(app)
signed builtin UI loader registry and dynamic domain entries
Host-generation Agent recovery with persisted run handle/result
Bun/Electron migration worker with hard timeout and integrity recovery
Core and Extension graph diagnostics
```

## 22.3 Level 3 v1 已实现

```text
per-revision Extension Host process + QuickJS/WASM sandbox
Public Plugin API v1 + Capability Broker + scoped grant token
signed package / registry trust and compatibility/dependency checks
namespaced storage/index, durable event, command and route contributions
install / update / disable / retry / rollback / uninstall
strict declarative UI and static Registry Marketplace
```

## 22.4 Future

```text
isolated interactive UI
arbitrary third-party executable UI
remote publisher/Marketplace backend
multi-Runtime SQLite consumer lease
```

详细顺序以 Roadmap 为准。

---

# 23. 质量与发布门槛

每次相关变更至少运行：

```text
lint
format:check
typecheck
test
test:runtime          # Bun; Electron environment is covered by E2E
check:architecture
check:generated
check:migration:complete
check:engine-locks
check:provider-catalog
build
test:e2e
package
```

故障测试必须覆盖：

```text
Runtime / Host / Engine startup failure and crash
stale generation event
SSE disconnect and replay
mutation timeout after commit
duplicate Idempotency-Key
If-Match conflict
plugin activation rollback and effect leak
migration checksum and backup recovery
credential store failure
invalid Origin / token
headless CapabilityUnavailable
alpha data upgrade and rollback
```

发布还需覆盖 macOS、Windows、Linux 的安装、首次启动、升级、迁移、签名/公证、卸载、Engine binary integrity 和离线启动。

---

# 24. MUST

1. MUST 只在 `desktop/` 正式主线实施。
2. MUST 保留成熟产品、UI 行为、数据语义、安全模型和 E2E 基线。
3. MUST 使用 `/api/v2` HTTP C/S 和 `/host/v1` Host API。
4. MUST 让所有 Client 使用 ServerConnectionManager 和生成 Client 边界。
5. MUST 保持 Core Runtime 可脱离 Electron 启动。
6. MUST 保持 Electron Main 为 Supervisor/Host，而非业务 Runtime。
7. MUST 使用 14 个第一方 bounded-context plugin 的所有权边界。
8. MUST 使用 Plugin → Bundle → Product Profile → Graph Revision。
9. MUST 原子发布有效 Graph 并逆序清理全部 effect。
10. MUST 保持表、迁移、路由、事件和 UI Contribution 唯一 owner。
11. MUST 使用 RFC 7807、ETag、Idempotency-Key、cursor pagination 和可恢复 SSE。
12. MUST 保持持久状态与 Domain Event 同事务。
13. MUST 使用 `credentialRef`、grant 和 artifact reference 隔离敏感能力。
14. MUST 保持 Pi、Codex、LangGraph.js 的统一 Agent Contract 和无静默 fallback；LangGraph.js 只作为 Engine，不能接管 Core Runtime workflow。
15. MUST 让 Runtime 拥有 Session/Run/Item、workflow、Preview/Commit 和恢复状态。
16. MUST 保持 `@dramaip/agent-runtime` Vendor-neutral。
17. MUST 在 Extension Host 完成前拒绝第三方代码加载。
18. MUST 将第三方 Extension Graph 与 Core Graph 物理隔离。
19. MUST 维护 Engine lock 和 Provider Catalog release 一致性。
20. MUST 让架构违规在 CI 和故障测试中失败。

---

# 25. SHOULD

1. SHOULD 保持 Cordis 为隐藏、可替换的 composition root。
2. SHOULD 使用 acquisition-style `ctx.effect(label, acquire)`。
3. SHOULD 采用 immutable Core Graph，直到 atomic router/graph swap 完成。
4. SHOULD 按 transport/generated/domain 分拆 `@dramaip/client`。
5. SHOULD 按 bootstrap/shell/features 分拆 Renderer。
6. SHOULD 按 providers/sessions/runs/items 等子域分拆 `agents` 插件。
7. SHOULD 使用构建期生成的签名内置 UI loader registry。
8. SHOULD 建立 Engine recovery state machine 和共享 conformance suite。
9. SHOULD 通过 Host-owned capture 获得 Credential。
10. SHOULD 在 Extension Host 中 Declarative UI First。
11. SHOULD 最后才建设 Marketplace。

---

# 26. MUST NOT

1. MUST NOT 把 Runtime 合回 Electron Main。
2. MUST NOT 恢复 Renderer 业务 IPC 或直接 `fetch`。
3. MUST NOT 新建 `desktop3` 或把正式实现迁往归档参考目录。
4. MUST NOT 恢复 `@sdns/*`、Effect HttpApi、`/api/v1`、中央 Domain Router 或已退役包。
5. MUST NOT 继续增加缺少 Bounded Context 理由的顶级插件。
6. MUST NOT 让插件导入其他插件实现或写其他 owner 的表。
7. MUST NOT 让 Bundle 拥有业务状态。
8. MUST NOT 把 Cordis、Hono、SQLite 或 Vendor 类型暴露给 Public Plugin API。
9. MUST NOT 声称 Registry metadata 删除等于真实路由卸载。
10. MUST NOT 自动重试非幂等 mutation。
11. MUST NOT 让 Vendor Engine 拥有 DramaIP Workflow 或隐式 fallback。
12. MUST NOT 把第三方代码加载进 Core Runtime 或主 Renderer。
13. MUST NOT 在没有 Permission、Isolation、Compatibility 和 Uninstall 前开放插件。
14. MUST NOT 给第三方任意 SQL、文件、网络、child process 或 native addon。
15. MUST NOT 在 Extension Host 之前建设 Marketplace。

---

# 27. 成功标准

目标完成时：

```text
Clients
→ one connection state machine
→ versioned generated HTTP client
→ independent Core Runtime

Core Runtime
→ atomic first-party graph revision
→ owned data/events/migrations
→ recoverable workflows and engines
→ capability-only Host boundary

Renderer
→ small shell
→ domain feature chunks
→ signed built-in contribution loaders
→ no business IPC / direct fetch / secrets / arbitrary paths

Future Extensions
→ public stable SDK
→ independent Extension Host
→ enforced identity / permission / trust / compatibility
→ declarative or isolated UI
→ safe install / update / disable / uninstall
```

最终目标不是代码“看起来像”某个参考项目，而是：

> OpenCode 的多 Client C/S 边界、DeepSeek Harness 的可靠生命周期、Codex 的富 Agent 执行能力，加上 DramaIP 自己的领域状态所有权、Preview/Commit 工作流和 Desktop Host 安全边界。
