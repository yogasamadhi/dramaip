# DramaIP Desktop Architecture Roadmap

> 文档类型：Execution Roadmap / Non-normative Status
>
> 路线版本：1.1
>
> 状态日期：2026-09-10
>
> 目标规范：[DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md](./DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)
>
> 当前实现：[desktop/docs/engineering/ARCHITECTURE.md](../../../desktop/docs/engineering/ARCHITECTURE.md)
>
> DSH 迁移证据：[desktop/docs/engineering/DSH_CORDIS_MIGRATION.md](../../../desktop/docs/engineering/DSH_CORDIS_MIGRATION.md)

---

# 1. 使用规则

本文只描述从当前实现到目标架构的工作顺序，不覆盖目标规范。

本次依据当前工作区代码、配置与脚本同步；DSH 迁移的已执行测试和本机打包记录日期为 2026-09-07。`done` 表示相应实现及验收证据已具备，不代表这些改动已提交合并，也不代表所有操作系统已通过正式发布验收。本次文档更新没有重新执行全量业务测试。

状态：

```text
done       = 已有代码、测试和门禁证明
partial    = 已有基础实现，但目标验收未满足
planned    = 未实现，尚不能作为产品能力宣传
deferred   = 有意延后，不进入当前主线
```

每次架构阶段完成后应同时更新：

1. 本文状态；
2. `desktop/docs/engineering/ARCHITECTURE.md` 当前事实；
3. 对应 architecture gate、故障测试和生成快照。

---

# 2. 当前能力矩阵

| 能力                                     | 状态     | 当前事实 / 缺口                                                                                                 |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `/api/v2` 独立 Core Runtime              | done     | Renderer 经 Client SDK 使用 HTTP；Runtime 可 Headless                                                           |
| `/host/v1` Desktop Host                  | done     | Runtime 与 Host token 独立；Renderer 无业务 IPC                                                                 |
| Node / Electron Core Runtime             | done     | 独立 Core、迁移 Worker、Runtime 测试用 Node 24.18.0；桌面 Core 用 Electron 内嵌 Node                            |
| DSH 框架源码与构建                       | done     | 九包取自锁定 vendor，生成 workspace，校验哈希、版本、许可证和本地解析；Bun 1.4.0 负责安装构建                   |
| First-party Plugin Graph                 | done     | 14 个原生 Cordis 插件；元数据与实现分离，Loader 动态导入 ESM                                                    |
| Bundle / Profile 配置                    | done     | 空根、六个 Bundle patch、五个 Profile patch，Include 原生解析与覆盖                                             |
| Plugin migration/event ledger            | done     | checksum、同事务事件、checkpoint；Node/Electron Worker 硬超时与恢复                                             |
| Pi/Codex/LangGraph.js Contract           | done     | Vendor-neutral lifecycle、版本锁和共享 conformance                                                              |
| ServerConnectionManager                  | done     | attach/negotiate；GET 单次安全重试、SSE replay、mutation 零重试                                                 |
| Application Supervisor                   | done     | Window/Runtime/Host/Engine/Extension supervisor 与固定 shutdown                                                 |
| Native Effect                            | done     | `ctx.effect(acquire, label)`、Fiber 诊断、独立 effect 并发清理及显式有序资源回收                                |
| Graph Revision / 开发 HMR                | done     | 请求暂停与排空、DSH 原生重载、贡献暂存、校验后原子发布；失败恢复上一成功构建或重建进程                          |
| 独立 Runtime 产物                        | done     | 模块、配置、框架及依赖闭包可脱离仓库启动；生产关闭监听                                                          |
| Generated Client                         | done     | declaration → OpenAPI/operation client；`runtimeKind` 新实例仅 node/electron-node                               |
| UI Contribution                          | done     | 随应用签名的内置 loader、动态领域入口、Profile 子集和未知 contribution 诊断                                     |
| Agent recovery                           | done     | 状态机、Host generation reconcile、持久 handle/result 与三引擎 conformance                                      |
| File/Credential grants                   | done     | opaque grant/artifact、Host capture、policy-bound Vault、nonce bootstrap                                        |
| Public Plugin API                        | done     | Public/Experimental/Internal 分层，Node conformance 与 Electron E2E；公共边界不暴露 Cordis                      |
| Extension Host                           | done     | 每 revision 独立进程 + QuickJS/WASM；第三方 bundle 不由 Node import                                             |
| Permission/Trust/Install                 | done     | Ed25519、Capability Broker、revision/grant、原子更新和 quarantine                                               |
| Third-party UI                           | done     | 仅声明式 command/menu/settings/form/table/panel；不开放任意 React                                               |
| Marketplace                              | done     | HTTPS 静态 Registry、离线 cache、preview/commit/update/rollback/uninstall                                       |
| 跨平台正式发布                           | partial  | 本机 macOS arm64 ad-hoc 目录包与仓库外启动有记录；Windows/Linux 候选包、正式签名/公证及完整升级卸载验收仍待完成 |
| Isolated Interactive UI / 远程发布者后台 | deferred | 当前不开放；不因此为 Desktop 引入 Platform 依赖                                                                 |

---

# 3. 实施原则

优先顺序：

```text
机器化架构不变量
→ 稳定进程与连接边界
→ 原子 Graph 与生命周期
→ 拆分大模块和 UI
→ 数据/事件/Engine 恢复
→ Host 安全能力
→ Extension Host
→ 第三方 UI 和分发
```

每个阶段必须：

- 保持现有产品和 E2E 行为；
- 产品代码只在 `desktop/` 实施；根启动器、文档和 CI 只协调 Desktop，不与 Platform 共享构建或运行依赖；
- 不激活 legacy package 或兼容桥；
- 不引入新的顶级业务插件，除非经过 Bounded Context ADR；
- 在进入下一阶段前补齐故障测试。

---

# 4. P0：架构成熟化

## P0.0 架构门禁和生成 Catalog

状态：done

建立由代码生成的审计快照：

```text
architecture/table-owners.json
architecture/route-owners.json
architecture/event-owners.json
architecture/ui-contributions.json
architecture/engine-capabilities.json
architecture/service-contracts.json
```

源真相来自 descriptor、migration、route/event/UI contribution、Agent Contract 和 typed service contract。生成物只用于审计和漂移检查。

门禁增加：

- Renderer 只能通过连接层和 `@dramaip/client` 使用 Runtime；
- Renderer 禁止 Electron business IPC、直接 `fetch`、Host/Server 实现 import；
- Electron Main 禁止插件实现 import 和领域业务调用；
- 每张表、路由、事件拥有唯一 owner；
- `/api/v2` operationId 全局唯一；
- `@dramaip/agent-runtime` 禁止 Electron/SQLite/Hono/Cordis/Vendor 类型；
- public contracts 禁止 Credential plaintext 和绝对路径；
- 第三方代码不得进入 Core/Renderer；
- 受控资源 API 与 runtime leak test 共同验证长期副作用。

验收：新增表、路由、事件或 Engine capability 无 owner 时 CI 失败。

## P0.1 拆分 Electron Main

状态：done

已完成统一进程状态、generation 丢弃、500ms–30s jitter restart budget、Host/Runtime
`port: 0` listening ready handshake、Runtime 重启 token/MCP token 轮换、窗口重建和固定 shutdown 顺序。`windows/`、`host/`、
`engines/`、`extensions/`、`supervision/` 与 `application-supervisor.ts` 已建立；
`main-v3.ts` 已删除，`electron/main.ts` 只装配 lifecycle。

目标结构：

```text
electron/
├── main.ts
├── application-supervisor.ts
├── runtime/
├── host/
├── engines/
└── windows/
```

建立统一 supervisor 状态、generation、系统分配端口、ready handshake、restart backoff/jitter/budget 和有序 shutdown。

移除 Main 对插件业务路由的直接调用；Main 只监督和提供 Host capability。

验收：

- kill Runtime/任一 Engine 后没有僵尸进程、悬挂 stream 或旧 generation 事件；
- Runtime restart 轮换 token；
- shutdown 完成后全部 child/utility process 退出。

## P0.2 Renderer 接入 ServerConnectionManager

状态：done

Renderer bootstrap 流程改为：

```text
bootstrap metadata
→ attach
→ authenticate
→ negotiate
→ generated client
→ SSE replay
```

UI 显示 discovering、attaching、authenticating、negotiating、ready、reconnecting、degraded、disconnected、incompatible。

验收：

- Runtime restart 后 Client 安全恢复；
- incompatible 显示升级提示；
- 非幂等 mutation 不自动重试；
- 旧 generation 事件不进入 UI cache。

## P0.3 Graph Revision、Effect 与 Router

状态：done

当前启动链路：

```text
resolve / preflight → migrate → Loader / Include / Group + stage
→ await enabled entries and child Fibers → validate → atomic publish
```

第一方已使用原生 `ctx.effect(acquire, label)`，effect 从 Fiber 元数据生成 owner/version/revision/label 诊断；独立 effect 并发清理，有先后依赖的资源集中在一个 effect 内显式等待。

生产不监听文件，Profile 变更通过完整 Runtime restart。开发业务模块和配置使用 DSH HMR；先暂停新业务请求并等待 handler 退出，再做原生重载和贡献校验，同步发布 Router、Core Graph、UI 和诊断。公共契约、迁移、框架或 Profile 成员变化走完整重启。

验收：

- activation 任一点失败不暴露半激活 Runtime；
- teardown 后 effect 数归零；
- route metadata 与实际 Router/OpenAPI 一致；
- staging 失败继续使用旧 revision 或安全终止启动。
- pending、子 Fiber 异步失败或缺失贡献不能发布为成功图；失败恢复必须重新通过图校验。

## P0.4 拆分大文件与大插件

状态：done

Client 已拆出 connection/transport/events/errors/domains；agents 已抽出 descriptor、
migrations 与 runs/recovery，组合入口不包含 SQL；Electron 已抽出 Window/Application/
Extension Supervisor。`studio-app.tsx` 和 agents `index.ts` 仅为组合入口，构建产物由
`check:renderer-chunks` 验证顶级领域动态入口。

优先目标：

```text
apps/desktop/electron/main.ts
packages/app/src/studio-app.tsx
plugins/agents/src/index.ts
packages/client/src/generated.ts
```

`agents` 按 providers、sessions、runs、items、experiments、capability-grants、conversations 拆分；Route handler、Repository、Service、Orchestrator 分层。

Renderer 按 bootstrap、shell、runtime-connection、routing、contribution-registry 和 features/domain 拆分。

Client 按 transport、generated、events、errors 和 domains 拆分。

验收：功能和 E2E 不退化；跨领域 import 仍通过 Contract；入口文件只负责组合。

## P0.5 事件提交与故障测试

状态：done

增加：

```text
afterCommit dispatcher wakeup
explicit Domain/Realtime SSE envelope
exact + owner-bound template event catalog
handler idempotency tests
schema version / upcaster
dead-letter / degraded diagnostics
```

当前不实现多 Runtime consumer lease，除非另有共享数据库部署 ADR。

验收：状态与事件不会单边提交；SSE 重连不混用 cursor；consumer crash 后从 checkpoint 恢复。

## P0.6 Engine 恢复与 Conformance

状态：done

Run 状态、cursor/generation/checkpoint、启动恢复扫描、1,000 event/4 MiB 背压、
`RUN_INTERRUPTED` 终态、Host generation reconciler、持久 run handle/result 和
Pi/Codex/LangGraph.js 共同 conformance 已完成。

建立 Run 状态机和启动扫描：

```text
created / queued / preparing / running
waiting_approval / committing / completed
interrupted / failed / aborted / orphaned / recoverable
```

Pi/Codex/LangGraph.js 运行同一套 crash、duplicate/delayed event、abort、resume/fork、unsupported、Host unavailable 测试。LangGraph.js 是 external-benchmark Engine，不接管 Core Runtime workflow。

增加 stream 最大事件/字节、慢消费者、AbortSignal、heartbeat、timeout 和 crash final event。

验收：Runtime restart 后不存在永久 `running` 的 Run；不支持操作显式失败；Vendor session 不替代业务状态。

## P0.7 DSH Cordis 原生迁移

状态：done（实现与本机验收；跨平台发布另见第 9 节）

按以下五段记录交付范围：

| 阶段             | 已进入代码的结果                                                                                               | 验收入口                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 源码与 Node 链路 | 九包来自锁定 DSH；准备 → 冻结安装 → 框架构建；Core/Worker 使用 Node/Electron Node；ESM 产物可脱离仓库启动      | `prepare:framework`、`check:framework`、独立产物启动                  |
| 原生插件迁移     | 14 个原生插件，`inject` 驱动生命周期；服务在 Cordis 中注册；移除旧 activate 循环、ServiceRegistry、EffectScope | `test:runtime:node`、`check:architecture`                             |
| Loader 配置      | 空根、六个 Bundle 和五个 Profile patch；原生 `applyEntryPatches`；配置、依赖和贡献预检                         | Bundle/Profile 测试、五 Profile 装载                                  |
| HMR              | Timer/HMR、模块/配置重载、依赖重建、请求排空、原子业务图；失败快照恢复和 supervisor 重建；生产无监听           | `test:runtime:watch`、`test:runtime:hmr`、`test:runtime:hmr:electron` |
| 业务与边界验证   | SQLite、SSE、幂等写入、ETag、任务恢复、第三方隔离、生成目录、Electron E2E 与目录包                             | Runtime/conformance/E2E、生成门禁和本机包记录                         |

源码来源保持唯一：`vendor/deepseek-harness/vendor` → 忽略提交的 `build/dsh-framework/` → `build/runtime/`。原始 vendor 不写入，不新增上游 Cordis 子模块，不升级当前快照，不解析 registry 副本。原始版本、源码哈希与许可证由来源检查验证。

必需依赖使用 `inject`；`provideService/requireService/optionalService` 只在同一 Cordis Context 上校验产品契约，不维护第二套实例。HTTP、UoW、`ctx.domainEvents`、UI contribution 为基础注入服务，Cordis `ctx.events` 保留框架语义。

失败导入/配置沿用 DSH 恢复，并恢复构建目录上一成功代码/配置；异步激活失败或恢复后不完整时由 supervisor 新建 Runtime。恢复不覆盖源码和数据库，不修改已应用迁移，也不自动重放业务写入。源码类型导入必须在 ESM 中擦除，`AgentRouteDraft` 缺少值导出这类启动错误由构建与实际装载回归覆盖。

2026-09-07 本机记录包括 95 项 Runtime 测试、27 项 conformance、51 项 Electron E2E，以及 Node/真实 Electron utility process 的五 Profile HMR 与恢复验收。完整命令、环境和限制见 [迁移证据](../../../desktop/docs/engineering/DSH_CORDIS_MIGRATION.md)；测试数量是该次记录，不是后续版本固定门槛。

---

# 5. P1：主架构完成度

## P1.1 内置 UI Loader Registry

状态：done

把已有 loader resolver 接入实际路由和 feature chunk。Runtime metadata 与构建期签名 registry 取交集，未知 ID 不执行。

验收：`safe/test` 仅有 `core` 三个插件对应的 contribution；`studio/server/e2e` 选择全部六个 Bundle、14 个插件。能力范围以 Profile 展开结果为准；功能域可以独立 lazy load，缺少 Host 的能力结构化降级。

## P1.2 Typed Service Contract

状态：done

已实现原生 Cordis 上的 `provideService/requireService/optionalService` 和版本化 Contract。必需服务声明 `inject`；owner/major/capability、重复提供和缺失依赖在发布前校验，`optionalService` 只接受声明可降级的契约。

验收：不再依赖无约束字符串 Service Locator；跨插件交互只能使用稳定 Contract/Event/Projection。

## P1.3 Client 与 HTTP 完整契约

状态：done

所有 2xx/4xx/5xx 具有 schema；统一 timeout、cancellation、trace、CORS/origin、body limit、SSE backpressure。

验收：Client 不大量 `unknown` 强转；API 变化必然触发 `check:generated`；mutation unknown-result 有 Idempotency 查询路径。

## P1.4 File/Credential/Bootstrap 安全收敛

状态：done

迁移到：

```text
revealGrant / revealArtifact
Host-owned credential capture
one-time bootstrap nonce exchange
Provider HTTP SSRF / DNS rebinding policy
```

验收：Renderer/Runtime Contract 不出现绝对路径或 secret；Runtime restart 后旧 token 无效；安全日志不记录 Credential。

## P1.5 诊断、Trace 与恢复演练

状态：done

诊断显示 graph revision、effect owner、migration、consumer、Host/Engine generation、restart budget、Run recovery 和 trace ID，全部脱敏。

验收：常见启动/恢复失败可以仅凭诊断定位；恢复演练覆盖备份、迁移、Runtime/Engine crash。

---

# 6. P2：Extension Platform

进入条件：P0/P1 验收完成，且 Public Plugin API 通过独立 conformance suite。

## P2.1 Extension Host Core

状态：done

每 active revision 使用独立 Electron utility process 和 QuickJS/WASM，完成 Manifest、Identity、Compatibility、Lifecycle、资源回收、Capability Client、Audit、Rate Limit、Crash Isolation。Node 只承载受信 bridge，第三方 bundle 不由 Node `import()`。

已支持经签名和兼容性校验的第三方包，更新通过候选进程健康握手和 revision 切换完成；第三方公开 API 不暴露 Cordis 或第一方开发 HMR。

## P2.2 Permission、Trust 与 Sandbox Policy

状态：done

在 Core/Host 权威边界执行 permission；限制 module、native addon、environment、filesystem、network、child process 和资源。

当前按 active revision 独立进程隔离，QuickJS/WASM 限制第三方执行能力；不能把普通 Cordis Fiber 描述为安全沙箱。

## P2.3 Storage 与 Server Contribution

状态：done

提供 namespaced storage/声明式 schema。第三方不能执行任意 SQL；Server route 经 `/api/v2/extensions/{pluginId}` proxy 暴露。

## P2.4 安装、更新、禁用、卸载

状态：done

实现 staging、integrity/signature、permission review、atomic revision、rollback、quarantine 和数据 keep/export/delete。

---

# 7. P3：生态与 UI

## P3.1 第三方声明式 UI

状态：done

顺序：Command/Menu/Settings → Form/Table/Panel。主 Renderer 只渲染声明，不执行第三方 React。

## P3.2 Isolated Interactive UI

状态：deferred

仅在声明式 UI 无法覆盖真实场景时建设隔离 Renderer/严格 sandbox 容器和 capability message protocol。

## P3.3 Registry / Marketplace

状态：done

使用 Ed25519 签名的 HTTPS 静态 Registry；Desktop CLI 生成 index/package 目录，
Runtime 提供离线 cache、搜索、preview/commit、update、rollback 与三种卸载数据策略。
远程发布者后台仍不在 `desktop/` 范围内。

---

# 8. 暂时不要做

```text
不要把 Runtime 合回 Electron Main
不要恢复 Renderer 业务 IPC / direct fetch
不要激活 legacy packages 或 desktop/legacy
不要增加缺乏 Bounded Context 理由的顶级插件
发布包关闭第一方文件监听；开发期使用 DSH HMR 并校验业务图一致性
不要开放第三方 React 或任意 Node 权限
不要让 Vendor Engine 拥有 Workflow 状态
不要为未决定的多实例 SQLite 引入 lease
不要将静态 Registry Marketplace 扩展成依赖 Platform 的发布者后台
```

---

# 9. 阶段发布门槛

常规架构里程碑完成必须通过（从 `desktop/` 执行）：

```text
bun run lint
bun run format:check
bun run test
bun run check:framework
bun run check:architecture
bun run check:generated
bun run check:migration:complete
bun run check:engine-locks
bun run check:provider-catalog
bun run check:licenses
bun run check:extension-packages
bun run build
bun run check:renderer-chunks
bun run test:e2e
```

`test` 已包含 typecheck、unit/Runtime 与 conformance；聚焦 Core 可用 `test:runtime:node`，不要用 Bun 直接运行 Core 测试。Loader/HMR 和构建变更额外执行 `test:runtime:watch`、`test:runtime:hmr`、`test:runtime:hmr:electron`，Linux Electron 需要 display 或 `xvfb-run`。

从无依赖环境开始，先初始化子模块，再执行 `prepare:framework → bun ci → build:framework → check:framework`。根 `bun run-desktop.ts` 协调准备、安装、框架与 Engine 构建；独立 Runtime 通过 `scripts/run-node.mjs` 校验 Node 24.18.0。

契约变更先运行 Client `generate`；插件声明和 ownership 变更运行 `plugins:generate` / `architecture:generate`；迁移证据运行 `migration:generate`。所有生成命令完成后运行相应检查，禁止手工编辑生成目录、OpenAPI 或迁移矩阵。

## 9.1 发布验收仍待完成

状态：partial

当前已记录 macOS arm64 ad-hoc `.app` 目录包构建和仓库外启动，验证生产 HMR 关闭、依赖链接不越出包和九个许可证齐全。此记录不替代正式分发签名、公证或完整多平台升级/卸载验收。

后续优先完成：

1. 在 macOS、Windows、Linux 候选包上执行安装、首次启动、离线启动、升级、数据迁移和卸载验证；Windows/Linux CI 已配置，本机未执行。
2. 完成对应分发签名与 macOS 公证，验证 Engine binary integrity、Runtime 资源和更新链路。Windows 目录包构建还需具备目录符号链接权限或启用开发者模式。
3. 设置 `DRAMAIP_UPDATE_URL` 后运行 `package`，生成 `release:metadata` 并保存各平台可追溯证据，再评估正式 GA。

Isolated Interactive UI、远程发布者后台、多 Runtime SQLite consumer lease 与完整远程身份认证/Host session 继续延期；`server` Profile 已存在不代表远程部署安全模型已验收。

---

# 10. 完成定义

某项只能在同时满足以下条件后标记 `done`：

1. 目标 Contract 与正常代码路径已实现；提交、合并及正式发布状态另行记录；
2. 正常路径与故障路径测试通过；
3. architecture/generated catalog 不漂移；
4. 当前实现文档已更新；
5. 不存在为通过门禁而添加的空 route、泛化 CRUD 或兼容旁路；
6. E2E 仍证明成熟产品行为未退化。
