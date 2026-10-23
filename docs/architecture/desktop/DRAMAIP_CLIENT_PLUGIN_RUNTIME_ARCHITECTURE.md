# DramaIP Client / Plugin Runtime Architecture

> 文档类型：Accepted / Normative Target Architecture
>
> 架构版本：2.1
>
> 更新时间：2026-09-10
>
> 正式实施范围：`desktop/`
>
> 当前实现事实：[desktop/docs/engineering/ARCHITECTURE.md](../../../desktop/docs/engineering/ARCHITECTURE.md)
>
> DSH 迁移与验收：[desktop/docs/engineering/DSH_CORDIS_MIGRATION.md](../../../desktop/docs/engineering/DSH_CORDIS_MIGRATION.md)
>
> 实施路线：[DESKTOP_ARCHITECTURE_ROADMAP.md](./DESKTOP_ARCHITECTURE_ROADMAP.md)
>
> 通用基线：[DESKTOP_ARCHITECTURE_BASELINE.md](./DESKTOP_ARCHITECTURE_BASELINE.md)
>
> 通用 Level：[DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md](./DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md)
>
> 产品定位：[POSITIONING.md](../../product/POSITIONING.md)

---

# 0. 文档权威与阅读方式

本文定义 DramaIP Desktop / Runtime 的长期技术目标和不可违反的架构约束，是 `desktop/` 技术设计的最高优先级规范；市场定位与用户价值由产品定位文档统一定义。

产品层面，Desktop 承载“面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台”：小说/故事母本是重要上游核心之一、可独立完成章节和稿件交付的一等能力；改编与剧本是当前转化核心；作者意图、叙事质量、连续性、版本和来源贯穿两路；分镜与媒体是可选生产出口，不是所有项目的终点。该业务口径于 2026-09-30 校准，不改变本文的架构版本、Runtime、插件、数据所有权与安全边界，不将目标流程视为已实现。

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

产品架构决策：

> 保留 DramaIP 成熟产品行为和领域状态语义，以独立 HTTP Runtime、DSH Cordis 原生第一方插件 Graph、Desktop Host 能力边界和 Vendor-neutral Agent Contract 承载产品；第三方扩展在独立 Extension Host 中执行。

正式重构和实现只发生在：

```text
desktop/
```

源码来源与参考材料：

```text
desktop/legacy/desktop2 = 只读架构模式参考
desktop/vendor/deepseek-harness/vendor = 九个第一方框架包的锁定源码
desktop/vendor/codex-rust = Codex Engine 锁定源码
desktop/vendor/pi = Pi Engine 锁定源码
```

所有 vendor 保持只读。DSH 的九个框架包经准备脚本生成本地 workspace 后参与构建；Pi/Codex 经各自构建流程成为受管 Engine 资源。发布包使用完整构建产物，不直接引用 vendor 或仓库外 workspace。归档实现和 DSH Agent 业务实现不进入正式运行依赖；Desktop 与 Platform 保持独立。

---

# 2. 目标等级与当前成熟度

DramaIP 选择 Level 3，承载多业务域、多 Client、复杂 Agent 工作流和受隔离治理的第三方扩展。

当前实现成熟度必须准确表述为：

```text
Level 2 收口完成
+ 第一方 DSH Cordis 源码 / Node / Loader / 开发 HMR 已迁移
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

已实现的隔离扩展边界：

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

正式交换流程：

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

```bash
# 在 desktop/ 中使用已安装、已构建的框架依赖
bun run serve serve --profile server --database /absolute/path/dramaip.db
# 独立 Node 开发模式，启用模块与配置 HMR
bun run dev:runtime serve --profile server --database /absolute/path/dramaip.db
```

上述 Bun 命令负责构建或调度，Core 由 `scripts/run-node.mjs` 启动 Node 24.18.0，报告 `runtimeKind: node`。第一个命令的前一个 `serve` 是 package script，后一个是传给 Runtime CLI 的子命令；当前 CLI 在提供参数时需要显式指定该子命令。`--profile` 接受五个正式 Profile。缺少 Desktop Host 或本地 Engine 时，相应 capability 返回 `CapabilityUnavailable`，不阻止 Runtime 启动。`server` Profile 选择功能集合，并不表示远程身份认证和部署要求已完成。

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

Runtime、Host、Pi、Codex、LangGraph.js 和 Extension Host 使用统一监督状态：

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

Bun 1.4.0 用于安装和构建。Headless/Server Core Runtime、迁移 Worker 和相关测试使用 Node 24.18.0；Desktop 受管进程使用 Electron 内嵌 Node。开发 HMR 显式传入 `--expose-internals` 并检查 DSH 内部 Loader；Bun 不再作为 Core Runtime。

```text
Headless / Server = node (24.18.0)
Desktop           = electron-node
Build / install   = bun (1.4.0)
```

Runtime-specific API 必须位于 `runtime-adapters`。业务插件不得自行判断 Node/Electron Node 或使用 Bun-only API。

独立 Node 入口必须校验精确版本，可用 `DRAMAIP_NODE_PATH` 指定可执行文件。桌面用户使用随 Electron 发布的 Node，无需额外安装系统 Node；迁移 Worker 使用对应的 Node 或 Electron-run-as-Node 子进程。新启动配置不接受 `bun`，`RuntimeKind` 响应 schema 保留该值仅用于旧响应解析，Client/OpenAPI 同步生成。

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

装配输入固定为：

```text
profiles/<name>.json                         # 选择 Bundle 和产品配置
cordis.yml                                  # 空根 []
bundles/<bundle>/cordis.patch.yml            # 依赖优先，再按 Profile 选择顺序叠加
profiles/<name>/cordis.patch.yml             # 最后一层覆盖
→ Include schema / applyEntryPatches
→ Group / Plugin entries
```

六个 Bundle 的成员在各自 patch 中声明，插件列表由展开结果得到。预检和正式 Loader 分别解析输入，避免 Include 原生就地修改插入条目污染另一棵配置树；不另写 patch 合并算法。配置只能用于受信任的第一方装配。

| Profile  | Bundle 范围 | 展开后插件数 | 产品配置                      |
| -------- | ----------- | ------------ | ----------------------------- |
| `studio` | 全部六个    | 14           | 默认桌面能力集合              |
| `server` | 全部六个    | 14           | Host 缺失时对应能力结构化降级 |
| `safe`   | `core`      | 3            | foundation、system、workspace |
| `test`   | `core`      | 3            | deterministic                 |
| `e2e`    | 全部六个    | 14           | deterministic                 |

此表解释当前配置，不作为第二份可执行注册表；实际成员以 patch 和生成图为准。

---

# 11. DSH Cordis 原生插件架构

## 11.1 框架与 Kernel 分工

Cordis 提供服务、依赖和原生生命周期。产品 Kernel 协调以下机制：

```text
graph resolution and validation
lifecycle and effect tracking
typed services and capabilities
events and migration coordination
contribution staging
diagnostics
```

第一方直接采用锁定 DSH 源码的 Cordis `Context / Service / inject / effect / Fiber`，通过 Loader、Include 和 Group 装配。九个框架包只从 `vendor/deepseek-harness/vendor` 准备到忽略提交的 `build/dsh-framework/`，保留 DSH 包名、版本、源码及许可证；不新增上游子模块，不升级快照，不加载 registry 副本。

- 第一方可导入 Cordis，公开 Plugin API、Renderer、Agent Runtime 和第三方沙箱不得暴露 Cordis 类型；
- 业务服务实例由 Cordis 注册与撤销，产品层只保留 owner、major、capability 等契约元数据；
- 所有 14 个插件为原生模块，通过 `inject` 等待服务，通过 `ctx.plugin()` 装配子能力；
- Runtime 启动入口只导入生成注册表，插件实现由 Loader 动态加载；
- 开发期启用完整 DSH HMR，发布包关闭监听。框架和启动入口变化走完整重启。

Kernel 不包含写作、Agents、媒体、制作、审片、交付或洞察业务。

## 11.2 源码、workspace 与发布产物

九个包为 Cordis、Cosmokit、Schemastery、Loader、Include、Group、Timer、HMR、Logger Console。版本与源码树以 [DSH 锁文件](../../../desktop/vendor/deepseek-harness.lock.json)为准，当前快照为 `0.2.1-rc.2`；各框架包保留各自的 DSH 名称、版本和 MIT 许可证。

安装顺序固定为：

```text
校验 Bun 1.4.0 与锁定 DSH 快照
→ prepare:framework
→ bun ci
→ build:framework
→ check:framework
```

`build/dsh-framework/` 是忽略提交的可重建产物，不维护第二份手写源码。生成包加入 Desktop workspace，内部框架依赖解析到本地包；TypeScript/esbuild 生成 ESM、所需 CJS 入口和类型声明，保持 DSH 导出语义。来源检查验证哈希、版本、许可证和引用者的真实解析路径，拒绝 registry 副本。

Runtime 构建保留 ESM 模块边界，类型导入必须在产物中擦除，不能留下仅存在于 TypeScript 的值导出。共享契约、Cordis 和基础设施保持单实例。`build/runtime/` 携带模块、配置与依赖闭包；发布包不得依赖源码目录或仓库外链接，必须复制到仓库外验证启动。根启动器、直接开发入口和 CI 复用此链路。

## 11.3 注册元数据与实现模块

工具期 `scripts/first-party-sources.ts` 汇总第一方声明；`plugins:generate` 生成 Runtime 使用的身份、版本、入口标识、迁移和 contribution 元数据，运行期注册表解析到对应模块入口。架构目录和图预检继续使用这些权威声明，生成物不能手工修改。

实际启动时机由 `inject` 服务可用性和 Fiber 决定；依赖图排序只服务于预检与迁移，不构成旧式 `activate(context)` 循环。内部类型化服务 helper 读取同一 Cordis Context，不维护另一套实例容器。原生资源注册和 `ctx.effect` 替代自有 `EffectScope`。

---

# 12. Graph Revision 与 Plugin Lifecycle

Graph revision fingerprint 至少包含：

```text
profile
bundle versions
plugin versions
contract versions
configuration fingerprint
development module/config revision (when enabled)
installed extensions use a separate Extension Graph revision
```

启动与切换流程：

```text
Resolve
→ Validate
→ Migrate
→ Loader / Include / Group Load and Stage Contributions
→ Await all enabled entries and child Fibers
→ Validate OpenAPI / UI / Event / Service Graph
→ Atomic Commit Revision
→ Ready
```

任何阶段失败不得暴露半激活 Runtime。

生产 Graph 启动后不可变。开发期业务模块和配置可重载：先停止分发新请求并等待已执行 handler 退出，再暂存路由/UI，等待所有 Fiber 稳定并校验贡献后同步发布 Router、Graph 和诊断。缺失服务导致的 pending 必须失败。导入/配置失败使用 DSH 恢复机制；异步激活失败或恢复后图不完整，supervisor 从上一成功构建快照启动新进程。Profile 成员、公共契约或迁移变化走完整重启和迁移预检，不自动重放业务写入。

## 12.1 开发期变更分类

| 变更                                                  | 处理方式                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| 第一方业务实现模块                                    | DSH 原生局部重载，并按 `inject` 关系重建依赖插件    |
| Bundle/Profile patch，启用成员不变                    | Include 原生配置更新，进入同一重载批次协调          |
| Profile 成员、共享契约、公共路由/服务/UI 元数据、迁移 | 完整 Runtime 重启并做配置、图和迁移预检             |
| 框架、共享基础设施、Runtime 启动入口                  | 完整 Runtime 重启，重新建立单实例依赖               |
| 第三方扩展版本                                        | 独立 Extension Host revision 更新，不进入第一方 HMR |

当前重载批次暂停第一方业务路由的新请求并等待已有 handler 退出，返回 RFC 7807 `503 / RUNTIME_RELOADING`；不将排空范围声称为已实现的逐能力精细调度。候选 Router/OpenAPI、UI 和服务图完成校验后，在无异步间隔的发布步骤中更新 Router、Core Graph 和诊断。只证明 DSH HMR 能启动不满足业务图验收。

## 12.2 失败恢复

DSH 保持模块导入与配置恢复机制。DramaIP 在锁定 HMR 实例的 `partialReload` 前协调业务请求排空，在重载后等待生命周期和贡献校验，不修改 vendor 实现。恢复后的有效图也必须重新验证；异步激活失败、排空失败或恢复后仍不完整时交给 supervisor 重建 Runtime，禁止发布失败图。

上一成功代码和配置记录在构建产物的 `.last-good.json`。导入失败时同时恢复构建目录，防止后续成功批次将失败模块写入快照；需要重建时由 supervisor 从恢复后的产物启动新进程。快照不覆盖开发者源码或业务数据库，不回滚已应用迁移；发布包排除该开发恢复日志并关闭监听。

受重载影响的运行任务继续使用现有中断与恢复协议，不能为了恢复 Graph 自动重放业务写入。公共元数据或迁移更改必须通过完整构建/重启预检后才可成为新成功版本。

---

# 13. Reversible Effects 与 Router

所有长期 route、service、event handler、timer、watcher、command、UI contribution、background task、stream、worker 和 child process 必须登记 effect 或 supervisor owner。

原生 acquisition API：

```ts
await ctx.effect(() => ctx.http.register(route), "route:workspace.projects");

await ctx.effect(() => {
  const timer = setInterval(tick, interval);
  return () => clearInterval(timer);
}, "timer:automation.scheduler");
```

每个 effect 记录：

```text
owner
plugin version
graph revision
label
acquiredAt
```

采用 DSH 原生清理语义：独立 effect 可以并发回收，有顺序依赖的资源须放进同一个 effect 并显式 await。异步激活失败会清理已取得资源；重复 dispose 幂等，清理异常不能阻止其他资源回收。诊断从真实 Fiber/effect 元数据关联 owner 和版本；当前 `acquiredAt` 是首次观察到该原生 effect 的时间，不是另一个资源容器记录的精确创建时刻。

删除 route registry metadata 不代表底层 Hono handler 已卸载。正式策略：

```text
Production
= immutable Router for a running Core Graph

Development HMR
= gate requests → drain → native reload → validate candidate → atomic publish
```

不得操作 Hono 私有路由表实现逐条删除。

---

# 14. Typed Services 与跨插件协作

正式服务 API：

```ts
// @dramaip/plugin-api/internal: typed product contracts over native Cordis
provideService(ctx, contract, implementation);
requireService(ctx, contract);
optionalService(ctx, contract);
```

Contract 包含 id、major、capabilities、输入输出类型、错误类型和 owner。必需服务在原生 `inject` 中声明；实例从 Cordis 取得，产品层不另建 ServiceRegistry。持久事件使用 `ctx.domainEvents`，HTTP、UnitOfWork 和 UI contribution 作为基础服务注入。

注册与发布前校验唯一提供者、owner、major 和 capability；必需服务缺失、插件循环依赖、错误归属或重复提供都阻止图发布。服务撤销/重建由原生注入关系控制依赖插件生命周期。`optionalService` 仅接受声明为可降级的契约，不能将必需依赖的 pending 隐藏为成功。

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

迁移在独占数据库的 Node/Electron-run-as-Node 子进程中执行。超时终止 Worker，由新进程完成 WAL recovery 与 integrity check；已经应用的 owner/version/checksum 不可变。开发 HMR 不修改已应用迁移。

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

正式 Platform OpenAPI 只覆盖稳定 `/api/v2`；这里的 Platform OpenAPI 指 Desktop 官方 API，不指独立的 `platform/` 产品。第三方 Extension Route 进入 Instance Effective OpenAPI，不直接改变编译期生成的官方 Client surface。

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

未知 ID 永不执行代码。第一方 UI 按领域 lazy load，重载时 contribution 随有效图发布；第三方 React bundle 永不进入主 Renderer。第三方声明式 Command/Menu/Settings/Form/Table/Panel 已实现，Isolated Interactive UI 仍为后续方向。

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

Renderer 通过 `revealGrant(grantId)`、`revealArtifact(artifactRef)` 使用能力；不得新增以 `revealPath(path)` 等形式传递不必要绝对路径的公共接口。

## 18.2 Credential

正式边界：

```text
Renderer requests capture session
→ Host-owned credential capture
→ encrypted Host storage
→ Renderer / Runtime receive credentialRef only
```

Credential capture 已由 Host-owned sandbox modal 承担。主业务 Renderer 只发起 capture session 并接收 `credentialRef`；明文只允许出现在安全输入流程及 Host 私有存储/调用边界，不能写入 Runtime 数据库、公共响应或日志。

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
Pi 1.4.0
Codex 0.163.0
LangGraph.js 1.4.9
```

Pi 是默认签名第一方 utility-process harness；Codex 使用 native stdio App Server；LangGraph.js 在 Electron utility process 中运行固定的“模型调用 → 文本/JSON 校验 → 最多一次修复”基线图。LangGraph.js 是活动 external-benchmark Engine，但不是 Core Runtime 的 Workflow Runtime，也不运行自主模型工具循环。DeepSeek Harness 提供只读的 Cordis 框架源码快照；其 Agent 业务实现不作为运行依赖。

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

代码核对日期：2026-09-10。以下状态描述当前工作区；迁移测试和本机打包的已执行记录日期为 2026-09-07，详见 [DSH Cordis 迁移验收](../../../desktop/docs/engineering/DSH_CORDIS_MIGRATION.md)。本次文档同步不构成重新执行全量测试或正式发布的声明。

## 22.1 已实现并应保留

```text
Renderer → generated client → /api/v2 Runtime
Runtime → /host/v1 Desktop Host
one-time nonce bootstrap exchange without business IPC
independent Electron Node Runtime and Node 24.18.0 Headless mode
Node / Electron utility-process runtime and HMR conformance
14 native first-party Cordis plugins; no legacy activation/service/effect container
Plugin → Bundle → Profile → Effective Graph Revision
DSH native Cordis Loader / Include / Group / HMR
9 source-built DSH framework workspaces, source/license/resolution checks
Bundle/Profile native patches and detached ESM Runtime artifact
native concurrent effect cleanup and explicit ordered resource groups
development reload drain / staged contributions / atomic graph publication
last-good code/config recovery and supervised Runtime rebuild
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
Node/Electron migration worker with hard timeout and integrity recovery
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
complete remote deployment authentication and revocable Host sessions
cross-platform signed install / upgrade / uninstall and formal GA acceptance
```

详细顺序以 Roadmap 为准。

---

# 23. 质量与发布门槛

在 `desktop/` 使用 `bun run <script>`。常规门禁为：

```text
lint
format:check
test                 # 包含 typecheck、unit/Runtime 与 conformance
check:framework
check:architecture
check:generated
check:migration:complete
check:engine-locks
check:provider-catalog
check:licenses
check:extension-packages
build
check:renderer-chunks # 读取实际 build manifest
test:e2e
```

框架、装配、构建和生命周期变更额外运行 `test:runtime:watch`、`test:runtime:hmr`、`test:runtime:hmr:electron`。`test:runtime:node` 使用 Node 24.18.0，Electron HMR 测试必须使用真实 utility process；两者从脱离仓库的 Runtime 产物启动五个 Profile，验证重载后的业务图和资源数量。

契约变更使用 Client `generate`；注册元数据、owner 和 contribution 变更使用 `plugins:generate` / `architecture:generate`；迁移证据使用 `migration:generate`。随后运行对应 `check:*`，不手工修改生成文件。初始化子模块、框架准备和冻结安装顺序见第 11 节。

故障测试必须覆盖：

```text
Runtime / Host / Engine startup failure and crash
stale generation event
SSE disconnect and replay
mutation timeout after commit
duplicate Idempotency-Key
If-Match conflict
plugin activation rollback and effect leak
delayed inject / service withdrawal and rebuild / missing or circular dependency
duplicate or wrong-owner service / async activation failure
cleanup exception / repeated dispose / ordered resource cleanup
invalid module/config / repeated HMR events / last-good process recovery
Router / OpenAPI / UI / diagnostics consistency after reload
migration checksum and backup recovery
credential store failure
invalid Origin / token
headless CapabilityUnavailable
alpha data upgrade and rollback
```

发布还需覆盖 macOS、Windows、Linux 的安装、首次启动、升级、迁移、签名/公证、卸载、Engine binary integrity 和离线启动。

打包先设置 `DRAMAIP_UPDATE_URL`，运行 `package` 准备 Engine 和 Runtime 资源，再生成 `release:metadata`。当前本机证据包含 macOS arm64 ad-hoc 目录包和仓库外启动；Windows/Linux 对应 CI 已配置但本机未执行，Apple 正式分发签名和公证未执行，不能据此宣称 GA。

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
9. MUST 原子发布有效 Graph，按 Cordis 原生语义清理 effect，并显式表达有序资源依赖。
10. MUST 保持表、迁移、路由、事件和 UI Contribution 唯一 owner。
11. MUST 使用 RFC 7807、ETag、Idempotency-Key、cursor pagination 和可恢复 SSE。
12. MUST 保持持久状态与 Domain Event 同事务。
13. MUST 使用 `credentialRef`、grant 和 artifact reference 隔离敏感能力。
14. MUST 保持 Pi、Codex、LangGraph.js 的统一 Agent Contract 和无静默 fallback；LangGraph.js 只作为 Engine，不能接管 Core Runtime workflow。
15. MUST 让 Runtime 拥有 Session/Run/Item、workflow、Preview/Commit 和恢复状态。
16. MUST 保持 `@dramaip/agent-runtime` Vendor-neutral。
17. MUST 只通过受验证的 Extension Host 边界执行第三方代码。
18. MUST 将第三方 Extension Graph 与 Core Graph 物理隔离。
19. MUST 维护 Engine lock 和 Provider Catalog release 一致性。
20. MUST 让架构违规在 CI 和故障测试中失败。
21. MUST 使用锁定 DSH 的九个框架源码包和原生 Cordis 插件架构，保持 vendor 只读及公开契约框架中立。
22. MUST 使用 Node 24.18.0 / Electron 内嵌 Node 执行 Core，Bun 1.4.0 承担依赖管理和构建。
23. MUST 使用原生 Include patch 语义和开发 HMR，等待所有启用条目及子 Fiber 完整后发布；生产关闭文件监听。
24. MUST 交付可脱离仓库启动的 Runtime 模块、配置、依赖和许可证，并验证失败恢复不会发布不完整业务图。

---

# 25. SHOULD

1. SHOULD 按 transport/generated/domain 分拆 `@dramaip/client`。
2. SHOULD 按 bootstrap/shell/features 分拆 Renderer。
3. SHOULD 按 providers/sessions/runs/items 等子域分拆 `agents` 插件。
4. SHOULD 使用构建期生成、随应用签名的内置 UI loader registry。
5. SHOULD 持续扩充 Engine recovery 和共享 conformance 的故障样本。
6. SHOULD 优先以声明式 UI 满足扩展需求；交互代码容器需单独论证和验收。

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
16. MUST NOT 从 registry 解析九个框架包、修改原始 vendor，或维护第二份手写框架源码。
17. MUST NOT 恢复 Bun Core Runtime、旧 `activate(context)` 启动循环或独立服务/effect 实例容器。
18. MUST NOT 在 HMR 中修改已应用迁移、自动重放业务写入或发布失败图。

---

# 27. 成功标准

目标完成时：

```text
Clients
→ one connection state machine
→ versioned generated HTTP client
→ independent Core Runtime

Core Runtime
→ native DSH Cordis services / effects / Loader / development HMR
→ atomic first-party graph revision
→ owned data/events/migrations
→ recoverable workflows and engines
→ capability-only Host boundary

Renderer
→ small shell
→ domain feature chunks
→ signed built-in contribution loaders
→ no business IPC / direct fetch / secrets / arbitrary paths

Extension Platform v1
→ public stable SDK
→ independent Extension Host
→ enforced identity / permission / trust / compatibility
→ strict declarative UI; interactive code containers require future acceptance
→ safe install / update / disable / uninstall
```

架构验收同时覆盖 DSH 原生生命周期、DramaIP 业务图一致性、领域状态所有权、Preview/Commit 工作流和 Desktop Host 安全边界。框架接入成功不能替代产品行为与恢复链路验收。
