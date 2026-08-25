# DramaIP Desktop Architecture Roadmap

> 文档类型：Execution Roadmap / Non-normative Status
>
> 路线版本：1.0
>
> 状态日期：2026-08-23
>
> 目标规范：[DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md](./DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)
>
> 当前实现：[desktop/docs/engineering/ARCHITECTURE.md](../../../desktop/docs/engineering/ARCHITECTURE.md)

---

# 1. 使用规则

本文只描述从当前实现到目标架构的工作顺序，不覆盖目标规范。

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

| 能力                          | 状态 | 当前事实 / 缺口                                                                   |
| ----------------------------- | ---- | --------------------------------------------------------------------------------- |
| `/api/v2` 独立 Core Runtime   | done | Renderer 经 Client SDK 使用 HTTP；Runtime 可 Headless                             |
| `/host/v1` Desktop Host       | done | Runtime 与 Host token 独立；Renderer 无业务 IPC                                   |
| Bun/Electron Node Runtime     | done | Headless/Server 固定 Bun；Desktop 固定 Electron `utilityProcess`                  |
| First-party Plugin Graph      | done | 14 个 bounded-context plugin；Bundle/Profile 已建立                               |
| Plugin migration/event ledger | done | checksum、事务事件、checkpoint 已存在                                             |
| Pi/Codex/Grok Contract        | done | Vendor-neutral lifecycle 和版本锁已存在                                           |
| ServerConnectionManager       | done | Renderer 统一 attach/negotiate；GET 单次安全重试、SSE replay、mutation 零重试     |
| Application Supervisor        | done | 纯入口、Window/Runtime/Host/Engine/Extension supervisor 与固定 shutdown           |
| Reversible Effect             | done | acquisition API、owner/version/revision、逆序回滚、zero-effect conformance 已完成 |
| Graph Revision                | done | canonical revision、阶段构建、staged validation、atomic router publish 已完成     |
| Generated Client              | done | declaration → OpenAPI/operation client；connection/transport/events/domains 分层  |
| UI Contribution               | done | 签名内置 loader、动态领域入口、profile 子集和未知 contribution 诊断               |
| Agent recovery                | done | 状态机、Host generation reconcile、持久 handle/result 与三引擎 conformance        |
| File/Credential grants        | done | opaque grant/artifact、Host capture、policy-bound Vault、nonce bootstrap 已完成   |
| Public Plugin API             | done | Public/Experimental/Internal 已分层，Bun conformance 与 Electron E2E 已建立       |
| Extension Host                | done | 每 revision 独立进程 + QuickJS/WASM；第三方 bundle 不由 Node import               |
| Permission/Trust/Install      | done | Ed25519、Capability Broker、revision/grant、原子更新和 quarantine                 |
| Third-party UI                | done | 仅声明式 command/menu/settings/form/table/panel；不开放任意 React                 |
| Marketplace                   | done | HTTPS 静态 Registry、离线 cache、preview/commit/update/rollback/uninstall         |

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
- 只在 `desktop/` 实施；
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

先落地安全的不可变生产 Graph：

```text
resolve → validate → migrate → stage → activate → validate → publish
```

将 `ctx.effect(cleanup, label)` 逐步升级为 acquisition-style API，记录 owner/version/revision/label。

短期禁止运行期 first-party route unload；Profile 变化通过 Runtime restart。随后实现 Router B 构建、验证和原子切换。

验收：

- activation 任一点失败不暴露半激活 Runtime；
- teardown 后 effect 数归零；
- route metadata 与实际 Router/OpenAPI 一致；
- staging 失败继续使用旧 revision 或安全终止启动。

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
Pi/Codex/Grok 共同 conformance 已完成。

建立 Run 状态机和启动扫描：

```text
created / queued / preparing / running
waiting_approval / committing / completed
interrupted / failed / aborted / orphaned / recoverable
```

Pi/Codex/Grok 运行同一套 crash、duplicate/delayed event、abort、resume/fork、unsupported、Host unavailable 测试。

增加 stream 最大事件/字节、慢消费者、AbortSignal、heartbeat、timeout 和 crash final event。

验收：Runtime restart 后不存在永久 `running` 的 Run；不支持操作显式失败；Vendor session 不替代业务状态。

---

# 5. P1：主架构完成度

## P1.1 内置 UI Loader Registry

状态：done

把已有 loader resolver 接入实际路由和 feature chunk。Runtime metadata 与构建期签名 registry 取交集，未知 ID 不执行。

验收：safe/server/test Profile 真正减少可用前端能力；功能域可以独立 lazy load。

## P1.2 Typed Service Contract

状态：done

实现 `provide/require/optional` 和版本化 Contract。`require` 在 activation 阶段失败，`optional` 只用于可降级环境 capability。

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

独立 Node 进程，完成 Manifest、Identity、Compatibility、Lifecycle、Effect、Capability Client、Audit、Rate Limit、Crash Isolation。

初期只运行官方 isolated example plugin，不开放任意第三方安装。

## P2.2 Permission、Trust 与 Sandbox Policy

状态：done

在 Core/Host 权威边界执行 permission；限制 module、native addon、environment、filesystem、network、child process 和资源。

按 trust group 决定进程隔离，不能把普通 fiber 描述为安全沙箱。

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
不要搬入完整 Cordis/DSH HMR
不要开放第三方 React 或任意 Node 权限
不要让 Vendor Engine 拥有 Workflow 状态
不要为未决定的多实例 SQLite 引入 lease
不要在 Extension Host 之前做 Marketplace
```

---

# 9. 阶段发布门槛

每个 P0/P1 里程碑完成必须通过：

```text
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run test:runtime
bun run check:architecture
bun run check:generated
bun run check:migration:complete
bun run check:engine-locks
bun run check:provider-catalog
bun run build
bun run test:e2e
```

涉及 Electron、Runtime、Engine、迁移或安全边界时增加对应 package/upgrade/fault-injection 测试。

---

# 10. 完成定义

某项只能在同时满足以下条件后标记 `done`：

1. 目标 Contract 已合并；
2. 正常路径与故障路径测试通过；
3. architecture/generated catalog 不漂移；
4. 当前实现文档已更新；
5. 不存在为通过门禁而添加的空 route、泛化 CRUD 或兼容旁路；
6. E2E 仍证明成熟产品行为未退化。
