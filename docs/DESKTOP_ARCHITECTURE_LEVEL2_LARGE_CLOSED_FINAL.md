# 通用桌面软件架构说明：大型封闭项目版

> Architecture Level 2  
> 适用对象：大型、长期维护、多业务域，但不向第三方开放插件的专业桌面软件  
> 核心架构：**HTTP C/S + Core Runtime + Internal Plugin Runtime**  
> 第三方插件：**不支持**

---

# 1. 架构定位

大型封闭项目的核心问题是：

> 如何避免 Runtime 随着功能增长变成 God Server？

因此采用：

# HTTP Client / Internal Plugin Runtime Architecture

总体：

```text
Clients
   │
  HTTP
   │
Core Runtime
   │
Plugin Kernel
   │
Internal Plugins
```

插件只是内部软件工程机制。

用户不感知插件，也不能安装第三方插件。

---

# 2. 适用场景

适合：

- 大型专业桌面软件；
- 企业内部平台；
- 大型 AI 工具；
- 多业务域内容生产软件；
- 多团队长期维护项目；
- 功能模块很多；
- 需要多个 Profile；
- 多 Provider / Workflow / Adapter；
- 需要插件化解耦，但产品仍是封闭式。

---

# 3. 总体架构

```text
┌──────────────────────────────────────────────────────┐
│                       Clients                        │
│                                                      │
│ Desktop / Web / CLI / Automation                     │
└─────────────────────────┬────────────────────────────┘
                          │
                          │ HTTP
                          │ REST / JSON / SSE
                          │ OpenAPI
                          ▼
┌──────────────────────────────────────────────────────┐
│                    Core Runtime                      │
│                                                      │
│  HTTP API                                            │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                Platform Kernel                 │  │
│  │                                                │  │
│  │ Plugin Registry                                │  │
│  │ Lifecycle                                      │  │
│  │ Dependency Graph                               │  │
│  │ Profile                                        │  │
│  │ Capability Registry                            │  │
│  │ Event Infrastructure                           │  │
│  │ Diagnostics                                    │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │                            │
│  ┌──────────────────────▼─────────────────────────┐  │
│  │              Internal Plugins                 │  │
│  │                                                │  │
│  │ workspace / writing / media / search / ...    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```


# 4. Runtime 运行模型

本架构中的 Core Runtime 必须是独立 Node.js / Node-compatible 服务进程，而不是 Electron Main 内部的业务模块。

桌面模式推荐：

```text
Electron Application
│
├── Main Process
│   ├── Window
│   ├── Runtime Supervisor
│   ├── Native Host
│   └── Engine Supervisor
│
├── Renderer Process
│   └── Desktop Client
│
└── Utility Process
    └── Core Runtime
        ├── HTTP Server
        ├── Platform Kernel
        ├── Internal Plugins
        ├── Database
        ├── Events
        └── Background Tasks
```

默认由 Electron Main 使用 `utilityProcess` 启动和监管 Runtime。

Runtime 本身不得：

```text
import Electron API
依赖 BrowserWindow
依赖 Renderer
假设自己只能运行在 Electron 内
```

Runtime 必须可以：

```text
Headless 启动
独立测试
独立重启
由普通 Node.js 启动
被 Desktop / Web / CLI 连接
```

架构原则：

> **Electron 负责宿主和生命周期，Runtime 负责业务运行。**

这样 Plugin Kernel 与 Internal Plugins 的崩溃、资源占用和生命周期不会直接污染 Electron Main。

---

# 5. Core Runtime

Core Runtime 由：

```text
Platform Kernel
+
Internal Plugins
```

组成。

Kernel 保持最小。

业务能力尽量进入 Internal Plugin。

---

# 6. Platform Kernel

Kernel 负责：

```text
Plugin Loader
Plugin Registry
Plugin Lifecycle
Dependency Graph
Profile
Capability Registry
Service Registry
Event Bus
Migration Coordination
Diagnostics
HTTP Route Contribution
UI Contribution Metadata
```

Kernel 不应包含具体业务域。

---

# 7. Internal Plugin

内部插件由官方团队维护。

插件粒度：

```text
Bounded Context
or
Replaceable Capability
```

例如：

```text
workspace
writing
knowledge
automation
media
timeline
review
search
ai-provider
exporter
```

规则：

# Everything Replaceable is a Plugin

但禁止 Plugin Everything。

错误：

```text
ButtonPlugin
DatePlugin
CharacterEntityPlugin
StringPlugin
```

---

# 8. Plugin Structure

推荐：

```text
plugins/
└── writing/
    ├── contracts/
    ├── server/
    ├── ui/
    └── migrations/
```

插件可以贡献：

```text
Contracts
Server Capability
HTTP Routes
Events
UI Contribution
Migration
```

---

# 9. Plugin Dependency

插件禁止直接导入其他插件内部实现。

允许：

```text
Stable Contract
Typed Service
Capability
Event
```

依赖图必须是 DAG。

启动前检查：

```text
Missing Dependency
Cycle
Version Conflict
```

---

# 10. Plugin Lifecycle

至少：

```text
register
activate
deactivate
dispose
```

所有副作用必须可撤销：

```text
route
event listener
timer
provider
command
panel
watcher
```

---

# 11. Critical / Optional Plugin

插件可区分：

```text
critical
optional
```

Critical 失败：

```text
Runtime startup fails
```

Optional 失败：

```text
Plugin unavailable
Runtime continues
Diagnostics visible
```

---

# 12. Profile

大型项目应支持：

```text
studio
safe
test
e2e
enterprise
```

Profile 决定哪些 Internal Plugin 被装载。

用途：

- 正式产品；
- 安全模式；
- 测试；
- 故障排查；
- 企业定制版本。

---

# 13. HTTP 边界

插件化不改变：

```text
Client
↓
HTTP
↓
Runtime
```

Renderer 不直接访问 Plugin Context。

HTTP 推荐统一：

```text
REST
JSON
SSE
OpenAPI
RFC 7807 Problem Details
ETag / If-Match
Idempotency-Key
Cursor Pagination
```

---

# 14. Event Architecture

Runtime Event 分为：

```text
Persistent Domain Event
Realtime Event
```

Persistent 适合：

```text
业务状态转换
任务状态
Workflow durable state
```

Realtime 适合：

```text
Token
进度
临时状态
健康信息
```

异步持久消费者推荐：

```text
checkpoint
retry
backoff
degraded state
diagnostics
```

---

# 15. Database

Local-first 项目推荐：

```text
SQLite
+
Drizzle
```

每个 Internal Plugin 可逐步拥有：

```text
Table Ownership
Migration
Repository
```

---

# 16. Plugin Migration

推荐：

```text
pluginId
version
dependencies
checksum
executedAt
```

数据库维护 Plugin Migration Ledger。

高风险迁移应有：

```text
backup
foreign key check
recovery strategy
```

---

# 17. UI Plugin

内部插件可以贡献：

```text
Route
Navigation
Panel
Editor
Inspector
Command
Toolbar
Settings
```

全部是官方受控插件。

不需要：

```text
第三方 UI Sandbox
Marketplace
Public UI SDK
```

---

# 18. UI Shell

Shell 只负责：

```text
App Shell
Global Navigation Host
Route Outlet
Global Drawer
Error Boundary
Extension Slots
```

具体页面由内部 Plugin Contribution 提供。

---

# 19. Desktop Host

负责：

```text
Window
File Capability
Credential
Native Dialog
Notification
Updater
Deep Link
Runtime Supervisor
Engine Supervisor
```

Runtime 通过本地 HTTP Host API 使用 Desktop Capability。

---

# 20. Renderer

Renderer 只使用：

```text
Client SDK
SSE
UI State
```

不访问：

```text
Plugin Kernel
Database
Raw Runtime Context
Electron Main
```

---

# 21. Runtime Process

推荐：

```text
Renderer
   │
  HTTP
   ▼
Runtime utilityProcess
```

Runtime 应：

```text
Headless
Restartable
Testable
Independent
```

---

# 22. External Runtime

外部引擎、Python、FFmpeg、Agent Runtime 等通过 Adapter 管理。

Vendor 原生协议可以是：

```text
HTTP
stdio
JSON-RPC
ACP
embedded
```

不强制全部 HTTP。

---

# 23. Repository Structure

```text
project/
│
├── apps/
│   └── desktop/
│
├── packages/
│   ├── client/
│   ├── contracts/
│   ├── runtime/
│   ├── kernel/
│   ├── plugin-api/
│   ├── database/
│   ├── events/
│   ├── http/
│   ├── desktop-host/
│   ├── ui/
│   └── ui-runtime/
│
├── plugins/
│   ├── foundation/
│   ├── system/
│   ├── workspace/
│   ├── writing/
│   ├── media/
│   └── ...
│
├── profiles/
│   ├── studio.json
│   ├── safe.json
│   ├── test.json
│   └── e2e.json
│
└── tests/
```

---

# 24. 内部 Plugin API

即使不开放第三方，也应明确：

```text
Stable Contract
vs
Internal Implementation
```

避免插件之间随意 import。

但不需要承担真正第三方 SDK 的长期兼容成本。

---

# 25. 不需要建设的东西

封闭项目不需要：

```text
Plugin Marketplace
Public Plugin Registry
Third-party Manifest
Plugin Signing
Third-party Compatibility Guarantee
Untrusted Extension Host
Third-party Permission UX
```

---

# 26. 安全

必须：

- Runtime 只监听 Loopback；
- Client 使用启动 Token；
- Renderer 不直接访问 DB；
- Credential 不进入 Renderer；
- Plugin 依赖图受控；
- Plugin Migration 可审计；
- 外部引擎隔离；
- 文件 Capability 最小授权。

---

# 27. 测试

大型封闭项目应增加：

```text
Plugin Unit Test
Plugin Integration Test
Profile Test
Dependency Graph Test
Migration Test
HTTP Contract Test
Runtime Integration Test
Electron E2E
Architecture Check
```

---

# 28. Architecture Gates

建议自动检查：

```text
Cross-plugin Internal Import
Dependency Cycle
Forbidden Renderer Node Import
Business IPC
Generated OpenAPI Drift
Migration Checksum
Profile Validity
Critical Plugin Availability
```

---

# 29. MUST

1. MUST 保持 HTTP Client / Runtime 边界。
2. MUST 将 Core Runtime 运行在独立 Node.js / Node-compatible 服务进程中。
3. MUST 保持 Runtime 不依赖 Electron API。
4. MUST 保持 Runtime 可 Headless。
5. MUST 引入 Internal Plugin Kernel。
6. MUST 保持 Kernel 最小。
7. MUST 让业务域进入 Internal Plugin。
8. MUST 保持 Plugin Dependency DAG。
9. MUST 禁止插件直接导入其他插件内部实现。
10. MUST 定义 Plugin Lifecycle。
11. MUST 保持插件副作用可撤销。
12. MUST 支持 Profile。
13. MUST 保持数据库迁移可追踪。
14. MUST 保持 UI Shell 与业务 UI 分离。
15. MUST 让 Client 不感知 Plugin Kernel。
16. MUST 保持 Desktop Host 不承担业务逻辑。

---

### Runtime 独立运行补充约束

- MUST 保证 Core Runtime 可以在完全不启动 Electron 的情况下独立运行。
- MUST 支持 Desktop Mode 与 Server Mode 共享同一套 Core Runtime、Plugin Kernel 和 Internal Plugins。
- MUST 将 Desktop Capability 作为可选 Provider，而不是 Core Runtime 的硬依赖。
- MUST 允许通过 Profile 控制 Desktop-only Capability 是否装载。

### Node.js / Bun 兼容补充约束

- MUST 保证 Core Runtime 在 Node.js 下完整可运行，Node.js 是默认兼容基线。
- MUST 保持 Core Runtime 代码不依赖 Electron API。
- MUST 不把 Bun-only API 直接扩散到业务代码中。
- MUST 在声明支持 Bun 时运行 Bun CI。
- MUST 保持 Node.js 与 Bun 使用同一套 HTTP Contract、数据模型和业务逻辑。

### 新增架构硬约束

- MUST 使用 Server Connection Manager 统一处理 Runtime discovery / attach / spawn / reconnect。
- MUST 使用 Plugin → Bundle → Profile 三层组合模型。
- MUST 让所有 Plugin 注册产生的副作用都可逆，并由 Kernel 统一跟踪。
- MUST 在 Plugin 卸载或启动回滚时按逆序释放 Reversible Effects。
- MUST 让 Internal Plugin 加载和卸载遵守依赖图。
# 30. SHOULD

1. SHOULD 在 Electron 桌面模式下使用 `utilityProcess` 承载 Core Runtime。
2. SHOULD 允许同一 Runtime 使用普通 Node.js 方式 Headless 启动。
3. SHOULD 使用 Cordis 或类似 Microkernel。
4. SHOULD 使用 Plugin Migration Ledger。
5. SHOULD 区分 Persistent / Realtime Event。
6. SHOULD 使用 Consumer Checkpoint。
7. SHOULD 使用 Architecture Gates。
8. SHOULD 通过 Plugin Contribution 组织复杂 UI。
9. SHOULD 让 Optional Plugin 可降级。

---

### Node.js / Bun 兼容建议

- SHOULD 同时支持 Node.js 与 Bun 运行同一套 Core Runtime。
- SHOULD 在 Electron Desktop 的 Node 模式下使用 `utilityProcess`。
- SHOULD 在 Electron Desktop 的 Bun 模式下由 Runtime Supervisor 使用 `child_process.spawn()` 启动 Bun sidecar。
- SHOULD 将 Runtime-specific 能力封装到 NodeRuntimeAdapter / BunRuntimeAdapter。
- SHOULD 将 Package Manager 与 Runtime 作为两个独立技术决策。

### Bundle / Loading 建议

- SHOULD 让 Bundle 只承担 composition，不承载独立业务状态。
- SHOULD 支持 Internal Plugin 的 eager / lazy 加载策略。
- SHOULD 在开发环境支持 dependency-aware reload。
# 31. MUST NOT

1. MUST NOT 开放第三方插件。
2. MUST NOT 为未来可能开放插件提前建设 Marketplace。
3. MUST NOT 给 Renderer Runtime Context。
4. MUST NOT 让 Kernel 变成新的 God Server。
5. MUST NOT Plugin Everything。
6. MUST NOT Runtime 内部微服务化。
7. MUST NOT 让插件依赖无法追踪的全局 Context。
8. MUST NOT 用统一 CRUD 抹平真实业务域。

---

# 32. 升级到 Level 3 的触发条件

出现：

```text
第三方开发者需求
插件生态价值
官方团队无法覆盖所有垂直需求
需要用户安装扩展
需要第三方 AI Provider / Workflow / Tool / UI
```

则升级到：

# Level 3：大型开放项目版

增加：

```text
Public Plugin SDK
Manifest
Permission
Trust
Isolation
Compatibility
Extension Host
Distribution
```

---


# 33. 独立 Server Mode

Core Runtime 必须能够在完全不启动 Electron 的情况下独立运行。

标准运行模式分为两种。

## Desktop Mode

```text
Electron Main
    │
    ├── Start Runtime
    ├── Monitor Runtime
    ├── Restart Runtime
    ├── Provide Desktop Host Capabilities
    └── Create Desktop Window
             │
             ▼
        Renderer Client
             │
            HTTP
             ▼
        Core Runtime
```

此时：

```text
Electron
=
Desktop Host
+
Runtime Supervisor
+
Desktop Client
```

Electron 不是 Core Runtime 本身。

## Server Mode

```text
systemd / Windows Service / launchd / CLI
                 │
                 ▼
            Core Runtime
                 │
              HTTP API
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
       Web      CLI    Remote Client
```

Server Mode 下：

- 不启动 Electron；
- 不创建 BrowserWindow；
- 不依赖 Electron Main；
- Runtime 独立持有业务状态、数据库、任务和 HTTP API；
- 可以长期在后台运行；
- 可以被 Web、CLI、自动化程序或远程 Desktop Client 连接。

推荐提供统一入口，例如：

```bash
myapp desktop
myapp serve
```

或者：

```bash
myapp serve --profile=server
```

---

# 34. Desktop Capability 可选化

Core Runtime 不得把 Electron Desktop Host 视为启动必需条件。

桌面能力必须建模为可选 Capability，例如：

```text
Desktop Capability
├── File Picker
├── Native Notification
├── Open External
├── Reveal File
├── Credential Host
└── Window Control
```

Desktop Mode：

```text
Core Runtime
    │
Desktop Capability
    │
Electron Desktop Host
```

Server Mode：

```text
Core Runtime
    │
Desktop Capability
    │
Unavailable / Alternative Provider
```

当某个 Client 请求只在桌面环境存在的能力时，Runtime 应返回明确的：

```text
CapabilityUnavailable
```

而不是导致 Runtime 启动失败。

如果某项能力存在非桌面实现，可以提供替代 Provider，例如：

```text
File Picker
├── Electron Native Picker
└── Browser Upload Flow
```

原则：

> **Runtime 的核心业务能力必须独立于 Desktop Capability。**

> **Desktop Capability 是环境能力，不是 Runtime 的硬依赖。**


## Profile 与运行模式

Level 2 推荐显式区分：

```text
desktop profile
server profile
safe profile
test profile
e2e profile
```

例如：

```text
desktop profile
=
Core Runtime
+
Internal Plugins
+
Desktop Capability Provider
```

```text
server profile
=
Core Runtime
+
Internal Plugins
-
Desktop-only Capability
```

Server Mode 仍然使用同一套 Plugin Kernel 与 Internal Plugins，不维护第二套业务 Runtime。


# Runtime 双运行时兼容

Core Runtime 的正式定义升级为：

> **独立的 Node-compatible JavaScript / TypeScript 服务运行时。**

同一套 Core Runtime 代码 SHOULD 同时支持：

```text
Node.js
+
Bun
```

但两者角色不同：

```text
Node.js
=
默认兼容基线
+
Electron Desktop 默认 Runtime
```

```text
Bun
=
可选 Runtime
+
Headless / Server Mode 可选高性能实现
```

核心原则：

# Same Runtime Codebase, Multiple JavaScript Runtimes

推荐模型：

```text
                 Core Runtime Code
                        │
                 TypeScript / ESM
                        │
              Runtime-neutral APIs
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
          Node.js                  Bun
             │                     │
             └──────────┬──────────┘
                        │
                  Same HTTP API
```

---

## Node.js 作为兼容基线

Core Runtime 必须优先保证 Node.js 正常运行。

原因：

- Electron `utilityProcess` 原生提供 Node.js 环境；
- Node.js 兼容性和生态稳定性更高；
- Native Addon 风险更低；
- 大量第三方库默认以 Node.js 为基线；
- Desktop Mode 下进程管理最自然。

---

## Bun 作为可选 Runtime

同一套 Runtime 代码也应支持 Bun。

Bun 适合：

```text
Headless Server
后台常驻 Runtime
快速启动
性能敏感场景
开发环境
CI / Test
```

但 Bun 不应成为 Core Runtime 的唯一依赖。

---

## Core Runtime 代码约束

Core Runtime SHOULD 优先使用 Node.js 和 Bun 都支持的标准能力：

```text
TypeScript
ESM
fetch
Request / Response
URL
AbortController

node:fs
node:path
node:crypto
node:events
node:stream
node:buffer
node:child_process
```

不要在 Core Runtime 业务代码中到处直接使用：

```text
Bun.file
Bun.serve
Bun.password
Bun-specific socket API
```

如果确实需要 Runtime-specific 能力，应通过 Runtime Adapter：

```text
Core Runtime
     │
Runtime Capability / Adapter
     │
     ├── NodeRuntimeAdapter
     └── BunRuntimeAdapter
```

---

## Runtime 检测

如果确实需要区分 Runtime，可以通过受控 Runtime Environment 层判断：

```ts
const isBun = Boolean(process.versions.bun)
```

业务模块不应自行重复判断运行时。

---

## Electron Desktop 下的启动方式

Electron Desktop 下，两种 Runtime 的启动方式不同。

### Node.js Mode

推荐：

```text
Electron Main
      │
 Runtime Supervisor
      │
 utilityProcess
      │
      ▼
 Core Runtime
   Node.js
```

这是默认桌面模式。

### Bun Mode

Electron `utilityProcess` 不是 Bun 容器。

因此 Bun 模式应：

```text
Electron Main
      │
 Runtime Supervisor
      │
 child_process.spawn()
      │
      ▼
     bun
      │
      ▼
 Core Runtime
```

即把 Bun 作为独立 sidecar executable 启动。

完整模型：

```text
                  Electron Main
                        │
                Runtime Supervisor
                  /             \
                 /               \
          Node Runtime         Bun Runtime
              │                    │
       utilityProcess        spawn bun
              │                    │
              └─────────┬──────────┘
                        ▼
                  Core Runtime
                        │
                       HTTP
                        │
                        ▼
                   Renderer
```

---

## Headless / Server Mode

不启动 Electron 时，同一套 Runtime 可以：

```bash
node dist/server.js
```

也可以：

```bash
bun dist/server.js
```

推荐产品级入口：

```bash
myapp serve --runtime=node
myapp serve --runtime=bun
```

如果不指定：

```text
default = node
```

---

## Package Manager 与 Runtime 解耦

必须区分：

```text
Package Manager
```

和：

```text
JavaScript Runtime
```

例如完全可以：

```text
bun install
+
Node.js Runtime
```

因此：

```text
Bun Package Manager
```

不代表：

```text
必须使用 Bun Runtime
```

推荐把二者作为独立技术决策。

---

## 双 Runtime CI

只要项目宣称支持：

```text
Node.js + Bun
```

CI 必须双跑。

最低测试矩阵：

```text
                 Runtime Tests
                  /          \
                 /            \
           Node.js CI        Bun CI
               │                │
          unit tests        unit tests
          integration       integration
          HTTP tests        HTTP tests
          DB tests          DB tests
```

重点验证：

```text
SQLite
Native Addon
Filesystem
child_process
stream
crypto
HTTP
Module Resolution
Signals
Graceful Shutdown
```

不能因为 Bun 高度兼容 Node.js 就省略 Bun CI。

---

## Runtime Compatibility Rule

正式兼容策略：

```text
Node.js
=
MUST PASS
```

```text
Bun
=
SHOULD PASS
```

如果某个第三方依赖暂时阻止 Bun 运行：

- 不得破坏 Node.js 基线；
- 必须在兼容矩阵中明确标记；
- 应通过 Adapter / Capability 隔离；
- 不应让 Runtime 大量绑定 Bun-only API。

最终目标是：

> **Node.js 负责稳定基线，Bun 提供可选运行时能力；两者共享同一套 Core Runtime、HTTP Contract、数据模型和业务逻辑。**


## Level 2 约束

Internal Plugin 不应假设自己运行在 Node.js 或 Bun 中。

插件应依赖：

```text
Platform Capability
```

而不是：

```text
Node-only Implementation
Bun-only Implementation
```

如果某个内部插件确实只支持单一 Runtime，应在 Profile / Capability Metadata 中明确声明：

```text
runtimeCompatibility:
  - node
```

或：

```text
runtimeCompatibility:
  - node
  - bun
```


# Server Connection Manager

Level 2 必须正式引入：

# Server Connection Manager

它是所有 Client 连接 Runtime 的统一入口。

职责：

```text
discover
attach
spawn
authenticate
health
version
capabilities
reconnect
disconnect
```

标准流程：

```text
Client
  │
  ▼
Server Connection Manager
  │
  ├── Connect existing Runtime
  ├── Spawn local Runtime
  ├── Validate version
  ├── Validate profile
  ├── Fetch capabilities
  └── Maintain SSE connection
```

必须支持：

```text
GET /health
GET /version
GET /capabilities
GET /runtime
```

建议 `/runtime` 返回：

```text
runtime id
runtime version
profile
runtime kind: node | bun
server mode: desktop | headless
loaded bundles
loaded plugins
capabilities
```

Client 不应绑定 Runtime 的启动方式。

同一个 Client 应可以连接：

```text
Electron Main 启动的 Runtime
systemd 启动的 Runtime
用户手动执行 myapp serve 的 Runtime
测试 Runtime
```

---

# Bundle Layer

Level 2 不应让 Profile 直接管理大量 Plugin。

正式采用三层组合：

```text
Plugin
  ↓
Bundle
  ↓
Profile
```

定义：

## Plugin

最小能力或业务边界上下文。

例如：

```text
writing
knowledge
search
export
```

## Bundle

一组有明确产品意义的 Plugin 组合，是内部功能分发与装配单位。

例如：

```text
writing-suite
├── writing
├── knowledge
├── revision
└── search
```

或：

```text
media-suite
├── asset
├── image
├── audio
└── video
```

## Profile

决定一个 Runtime 实例最终运行哪些 Bundle 和少量独立 Plugin。

例如：

```text
studio
├── core-bundle
├── writing-suite
├── media-suite
└── analytics-suite
```

规则：

```text
Plugin = 最小扩展单位
Bundle = 功能组合单位
Profile = 产品运行形态
```

Bundle 不拥有独立业务状态。

Bundle 只负责：

```text
composition
defaults
dependency declaration
configuration aggregation
```

---

# Reversible Effects

Level 2 把可逆副作用设为 Plugin Kernel 硬规则。

所有 Plugin 注册行为都必须返回 disposer / cleanup handle。

例如：

```ts
const dispose = ctx.routes.register(...)
const dispose = ctx.events.on(...)
const dispose = ctx.services.provide(...)
const dispose = ctx.commands.register(...)
const dispose = ctx.ui.registerPanel(...)
```

Kernel 必须跟踪这些 effect：

```text
Plugin Activate
    │
    ├── Effect 1
    ├── Effect 2
    ├── Effect 3
    └── Effect 4
```

卸载时：

```text
Plugin Deactivate
    │
    ▼
dispose Effect 4
dispose Effect 3
dispose Effect 2
dispose Effect 1
```

要求：

# Effects unwind in reverse order.

这样：

- 插件启动失败可以完整回滚；
- Safe Profile 切换更可靠；
- 测试之间不残留全局状态；
- Runtime 可以动态重建 Plugin Graph；
- Optional Plugin 可以独立失效。

禁止插件：

```text
直接修改全局单例
注册无法移除的监听
创建无法追踪的 Timer
长期持有未登记的资源
```

---

# Internal Plugin Loading Policy

Level 2 只需要内部插件加载策略，不需要第三方热更新生态。

每个 Internal Plugin / Bundle 可以声明：

```text
load: eager | lazy
```

默认：

```text
critical platform plugin = eager
large optional feature = lazy
```

Lazy Plugin 首次使用时装载。

必须：

- 依赖先于插件加载；
- unload 前检查依赖者；
- reload 时按依赖图确定影响范围；
- Plugin 失败时记录 diagnostics；
- critical plugin 不允许静默跳过。

内部开发环境可以支持 reload，但正式生产环境不要求无缝热更新。

# 35. 最终模型
```text
Clients
   │
  HTTP
   ▼
Runtime
   │
Platform Kernel
   │
Internal Plugins
```

对于大型封闭项目：

> **插件用于内部解耦，不承担生态开放责任。**
