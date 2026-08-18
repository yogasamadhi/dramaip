# Client / Plugin Runtime Architecture

> DramaIP 桌面端目标技术架构与重构指导  
> 更新时间：2026-08-18  
> 状态：Accepted / Target Architecture  
> 正式重构仓库：`desktop/`  
> 产品与功能基线：当前 `desktop`  
> 架构参考：`desktop2`、OpenCode、DeepSeek Harness  
> 本文作为 Codex / Coding Agent 后续重构的高优先级架构约束。

---

# 0. 核心决策

本次重构的含义是：

> **在 `desktop/` 代码仓库中，把现有实现逐步重构为全新的 Client / Plugin Runtime Architecture。**

不是：

> 保留 `desktop` 当前技术架构，只做局部优化。

也不是：

> 把 `desktop` 的功能迁移到 `desktop2`。

更不是：

> 新建 `desktop3`。

必须明确区分：

```text
重构位置
=
desktop/
```

```text
产品 / 功能 / UI / 行为 / 验收基线
=
当前成熟 desktop
```

```text
目标技术架构
=
重新设计的 HTTP Client / Plugin Runtime Architecture
```

```text
desktop2
=
Architecture Reference
```

因此：

> **保留的是成熟产品能力，不是旧技术架构。**

现有：

```text
Effect HttpApi
/api/v1
@sdns/server 的组织方式
固定 Workspace 分层
现有 IPC / RPC 结构
现有包边界
```

都不是必须保留的最终架构。

如果它们与目标架构冲突，可以替换。

兼容仅用于控制重构风险，不构成最终架构约束。

---

# 1. 最终目标

DramaIP 最终采用：

# HTTP Client / Plugin Runtime Architecture

完整模型：

```text
┌────────────────────────────────────────────────────────────┐
│                         Clients                            │
│                                                            │
│     Electron Desktop        Web        CLI / Automation    │
└──────────────────────────────┬─────────────────────────────┘
                               │
                               │ HTTP
                               │ REST / JSON
                               │ SSE
                               │ OpenAPI
                               ▼
┌────────────────────────────────────────────────────────────┐
│                    DramaIP Runtime                         │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    HTTP API                          │  │
│  │                                                      │  │
│  │ Routing / Schema / Auth / SSE / OpenAPI             │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │                 Platform Kernel                     │  │
│  │                                                      │  │
│  │ Plugin Graph / Lifecycle / Profile                  │  │
│  │ Capability / Events / Permissions / Diagnostics     │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
│       ┌─────────────────────┼─────────────────────┐        │
│       │                     │                     │        │
│       ▼                     ▼                     ▼        │
│  First-party            Official             Third-party  │
│  Domain Plugins         Plugins               Plugins      │
│                                                            │
└────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP
                               ▼
┌────────────────────────────────────────────────────────────┐
│                   Electron Desktop Host                    │
│                                                            │
│ Window / Files / Credential / Native Capability            │
│ Runtime Supervisor / Engine Supervisor / Updater           │
└────────────────────────────────────────────────────────────┘
```

核心思想：

```text
OpenCode
    ↓
HTTP-first Client / Server Boundary

DeepSeek Harness
    ↓
Plugin-first Runtime / Capability / Ecosystem

DramaIP
    ↓
自己的成熟产品能力和业务域
```

---

# 2. 为什么仍然在 `desktop` 中重构

选择 `desktop` 作为正式重构仓库，是因为它是当前成熟产品实现，而不是因为它现有架构更正确。

`desktop` 已经拥有：

```text
成熟 UI
完整小说写作闭环
Story Bible
智能助手
改编
制作
媒体
时间线
审片
交付
反馈与洞察
六引擎接入
E2E
发布链
```

这些构成：

# Product Baseline

重构时要保护的是：

```text
功能
用户流程
内容语义
数据
安全边界
引擎行为
UI 体验
测试结果
发布能力
```

而不是：

```text
现有 Server 架构
现有 Workspace 划分
现有 HTTP Framework
现有 API 版本
现有 IPC / RPC
```

---

# 3. `desktop2` 的定位

`desktop2` 不作为最终产品代码库。

它的用途是：

# Architecture Reference Implementation

主要参考：

```text
Cordis Kernel
Server / Renderer Plugin Context
Profile
Plugin Dependency Graph
Plugin Lifecycle
Plugin Rollback
Plugin Migrations
Persistent / Realtime Events
Consumer Checkpoint
UI Route / Slot / Command Contribution
EngineSupervisor
Architecture Gates
```

使用方式：

```text
分析 desktop2 的设计
        ↓
提取经过验证的架构模式
        ↓
按新的统一架构重新落地到 desktop
```

禁止：

```text
直接把产品迁到 desktop2
```

也禁止：

```text
为了省事直接让 desktop 运行时依赖 desktop2 的业务代码
```

---

# 4. 架构与迁移兼容必须分开

Codex 必须区分：

## Target Architecture

描述最终应该是什么。

## Migration Compatibility

描述为了安全迁移，暂时如何兼容旧实现。

例如：

```text
旧 /api/v1
```

可以在迁移期继续存在。

但不能因此得出：

> 最终架构必须保留 `/api/v1`。

同理：

```text
Effect HttpApi
```

可以暂时承载旧接口。

但如果新的统一 Runtime 决定采用：

```text
Hono + Zod OpenAPI
```

则可以逐域迁移并最终替换 Effect。

原则：

# Compatibility is temporary; architecture is authoritative.

---

# 5. 推荐最终技术栈

以下作为 DramaIP 目标实现的默认技术选择。

| 层 | 目标选型 |
|---|---|
| Desktop Host | Electron |
| Renderer | React + TypeScript |
| Package Manager | Bun |
| Runtime HTTP | Hono |
| Schema / Validation | Zod |
| API Contract | OpenAPI |
| Client SDK | OpenAPI Generated / Typed Client |
| Realtime Event | SSE |
| Plugin Kernel | Cordis |
| Local Database | SQLite |
| ORM | Drizzle |
| UI Server State | TanStack Query |
| UI Local State | Zustand（仅 UI State） |
| Testing | Vitest + Playwright Electron |
| Runtime Process | Electron utilityProcess / independent Node-compatible process |

这些技术可以在有充分理由时调整，但不得破坏本文定义的：

```text
HTTP Client / Server Boundary
+
Plugin Runtime
+
Public Plugin Platform
```

---

# 6. C/S 规则：统一 HTTP

DramaIP 自己控制的 C/S 边界统一使用 HTTP。

不使用 IPC 作为应用架构协议。

---

## 6.1 Renderer → Runtime

统一：

```text
HTTP
```

具体：

```text
REST
JSON
SSE
OpenAPI
```

例如：

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id

POST   /api/workflows/:id/run
POST   /api/tasks/:id/cancel

GET    /api/events
```

---

## 6.2 Runtime → Electron Main

也使用本地 HTTP。

定义：

# Desktop Host API

例如：

```text
POST /host/dialog/open-file
POST /host/dialog/open-directory

POST /host/files/reveal
POST /host/shell/open-external

POST /host/credentials/store
DELETE /host/credentials/:id

POST /host/window/minimize
POST /host/window/maximize
```

结构：

```text
Renderer
   │
   │ HTTP
   ▼
DramaIP Runtime
   │
   │ HTTP
   ▼
Desktop Host
```

Renderer 不直接通过 IPC 调 Electron Main。

---

## 6.3 Bootstrap

启动时 Renderer 需要知道：

```text
Runtime Base URL
Runtime Token
Application Metadata
```

这不应发展成 IPC API。

可通过：

```text
BrowserWindow URL bootstrap
custom protocol bootstrap
immutable startup payload
```

完成。

Bootstrap 只负责：

> 告诉 Client 去哪里连接 Runtime。

---

## 6.4 IPC

目标架构原则：

# No IPC for application capabilities.

如果 Electron 内部某些实现细节确实无法避免 IPC：

- 必须封装在 Desktop Host 内部；
- 不得暴露给 Renderer；
- 不得成为业务 Contract；
- 不得绕过 HTTP Client / Runtime Boundary。

---

# 7. 第三方引擎协议例外

DramaIP 自己的边界统一 HTTP。

但外部 Vendor Runtime 不需要强制改成 HTTP。

例如：

```text
OpenCode
→ HTTP

Codex
→ App Server stdio

DeepSeek Harness
→ JSON-RPC

Pi
→ embedded runtime

Grok Build
→ ACP

LangGraph
→ provider runtime
```

统一由：

# Engine Adapter

封装。

```text
DramaIP Runtime
      │
Engine Contract
      │
Engine Adapter
      │
Vendor-native Protocol
      ▼
Engine
```

原则：

> 不为了形式统一破坏第三方 Runtime 的原生协议。

---

# 8. Runtime 必须独立于 Electron

最终 Runtime 必须：

```text
可以 Headless 启动
可以独立测试
可以独立运行
可以被 Web Client 连接
可以被 CLI 连接
```

理想形态：

```bash
dramaip serve
```

Electron Desktop 只是：

```text
Runtime Supervisor
+
Desktop Client
```

---

# 9. Platform Kernel

DramaIP 是平台型产品。

因此 Runtime 不应该是：

```text
巨大的 Application Service
```

而应该是：

# Minimal Platform Kernel

Kernel 只负责：

```text
Plugin Loader
Plugin Lifecycle
Dependency Graph
Profile
Capability Registry
Service Registry
Event Infrastructure
Migration Coordination
Permission Broker
Diagnostics
HTTP Route Contribution
UI Contribution Metadata
```

Kernel 不负责：

```text
小说写作业务
人物业务
Story Bible
制作业务
时间线业务
审片业务
```

这些属于 Domain Plugin。

---

# 10. Plugin Rule

采用：

# Everything Replaceable is a Plugin

同时对于 DramaIP 这种平台软件进一步规定：

# Product Bounded Context can be a First-party Plugin

正确粒度：

```text
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

错误粒度：

```text
CharacterEntityPlugin
DatePlugin
ButtonPlugin
StringPlugin
```

---

# 11. Plugin 类型

统一分三类。

---

## 11.1 Built-in Plugin

随 DramaIP 核心发布。

例如：

```text
foundation
system
workspace
writing
knowledge
```

---

## 11.2 Official Plugin

DramaIP 官方维护，但不是核心必装能力。

例如：

```text
某个特殊 AI Provider
特定平台 Exporter
云审片 Integration
```

---

## 11.3 Third-party Plugin

第三方开发者独立开发。

例如：

```text
新 AI Provider
新 Workflow
新 Tool
新 Exporter
新知识库 Integration
人物关系图
行业模板
```

---

# 12. First-party Plugin Structure

推荐：

```text
plugins/
└── writing/
    ├── contracts/
    ├── server/
    ├── ui/
    └── migrations/
```

每个插件可以贡献：

```text
contracts
server
ui
migrations
```

---

# 13. Plugin Contract

插件之间禁止导入实现。

禁止：

```ts
import { something } from "../knowledge/server/internal"
```

允许：

```text
Stable Contract
Typed Cordis Service
Capability
Domain Event
```

---

# 14. Cordis 的使用原则

Cordis 用作：

```text
Plugin Composition Kernel
```

学习 DeepSeek Harness 的：

```text
mount
unmount
replace
lifecycle
effect cleanup
service capability
```

但禁止把 Cordis Context 变成：

```text
万能 Service Locator
```

尤其公共 Plugin API 不允许：

```ts
ctx.internal.*
```

---

# 15. Profile

采用类似：

```text
studio
safe
test
e2e
```

的 Profile。

Profile 决定：

```text
First-party / Official Plugin Graph
```

例如：

```text
studio
=
完整正式产品
```

```text
safe
=
foundation + system + workspace
```

```text
test
=
最小测试 Runtime
```

Profile 是：

> Runtime Composition。

不是最终用户随便编辑核心产品拓扑的配置文件。

---

# 16. Public Plugin Platform

DramaIP 的最终目标不是只做内部插件化。

必须支持：

# Third-party Plugin Ecosystem

但需要明确分阶段。

---

# 17. Product Profile 与 Installed Extensions 分离

不要允许第三方修改正式 Profile。

最终：

```text
Product Profile
+
Installed Extension Set
=
Effective Runtime Graph
```

---

## Product Profile

由 DramaIP 发布并维护。

---

## Installed Extension Set

存储用户安装：

```text
plugin id
version
enabled
configuration
permission grant
```

---

# 18. Plugin Manifest

第三方插件必须有 Manifest。

示例：

```json
{
  "id": "com.example.character-graph",
  "name": "Character Graph",
  "version": "1.0.0",
  "apiVersion": "1",

  "engines": {
    "dramaip": ">=2.0.0 <3.0.0"
  },

  "permissions": [
    "project.read",
    "character.read"
  ],

  "contributes": {
    "commands": [],
    "panels": [],
    "settings": []
  }
}
```

---

# 19. Public Plugin SDK

第三方只能依赖：

```text
@dramaip/plugin-api
@dramaip/contracts
```

禁止依赖：

```text
@dramaip/kernel/internal
@dramaip/runtime/internal
Drizzle Schema internals
Raw SQLite
Electron Main
Cordis private objects
```

---

# 20. Plugin Permission

至少定义：

```text
project.read
project.write

writing.read
writing.write

knowledge.read
knowledge.write

asset.read
asset.write

ai.invoke

network

filesystem.plugin
filesystem.workspace.read
filesystem.workspace.write

clipboard
notification
```

---

# 21. Plugin Trust

至少：

```text
Built-in
Official
Verified Third-party
Unverified Third-party
Development
```

信任等级影响：

```text
Permission
Isolation
Native Capability
Network
Warning
Update Policy
```

---

# 22. Third-party Plugin Isolation

第一方插件：

```text
In-process Cordis
```

第三方插件默认：

# Extension Host Process

结构：

```text
DramaIP Runtime
       │
       │ HTTP
       ▼
Extension Host
       │
Capability Proxy
       ▼
Third-party Plugin
```

第三方插件不能直接拿 Runtime 内存对象。

---

# 23. Database

继续采用：

```text
SQLite
+
Drizzle
```

因为它符合 DramaIP Local-first 产品形态。

但数据库结构可以按新架构重新整理。

---

## 23.1 Plugin Migration Ledger

最终每个 Plugin 拥有：

```text
pluginId
version
dependency
checksum
migration history
```

---

## 23.2 Table Ownership

逐步建立：

```text
which plugin owns which tables
```

---

## 23.3 Third-party Storage

第三方插件：

```text
不得直接修改 Core Tables
不得获得 Raw SQLite Connection
```

使用：

```text
Plugin-owned Tables
Plugin Storage API
Public Domain Capability
```

---

# 24. Event Architecture

正式采用：

```text
Persistent Domain Events
+
Realtime Events
```

---

## 24.1 Persistent

例如：

```text
project.created
chapter.updated
workflow.completed
asset.approved
review.decided
plugin.enabled
```

需要：

```text
global cursor
replay
consumer checkpoint
```

---

## 24.2 Realtime

例如：

```text
ai.token
task.progress
runtime.health
temporary.status
```

无需全部落库。

---

## 24.3 Transaction

业务状态和 Persistent Event：

```text
same transaction
```

避免：

```text
state committed
event lost
```

---

# 25. HTTP API

新的目标 Runtime API 应统一按新的 Contract 设计。

不要求保留：

```text
/api/v1
```

也不要求复制：

```text
/api/v2
```

API Version 由新的正式 Contract 决定。

可以：

```text
/api/v1
```

重新定义为最终稳定版本；

也可以：

```text
/api/v2
```

承载 Breaking Change。

关键不是数字，而是：

```text
OpenAPI
Consistency
Versioning
Compatibility Policy
```

---

# 26. HTTP Standard

统一：

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

# 27. Client SDK

所有 Client 使用：

```text
@dramaip/client
```

建议从 OpenAPI 生成。

Electron / Web / CLI 共用。

禁止 Renderer 到处手写：

```ts
fetch(...)
```

---

# 28. UI Architecture

保留当前成熟 UI 的产品设计和行为。

但代码架构可以重构。

最终：

```text
UI Shell
+
First-party UI Contributions
+
Third-party UI Contributions
```

---

## 28.1 Shell

只负责：

```text
App Shell
Route Outlet
Project Navigation Host
Global Drawer
Error Boundary
Global Slots
```

---

## 28.2 First-party UI Plugin

可以贡献：

```text
Route
Navigation
Command
Panel
Editor
Inspector
Settings
Toolbar
```

---

## 28.3 Third-party UI

按顺序开放：

```text
Command
Menu
Settings
Declarative Panel
Sandboxed Interactive UI
```

不允许任意第三方 React Bundle 直接运行在主 Renderer。

---

# 29. Engine Architecture

继续保留成熟的 DramaIP 统一 Engine 抽象：

```text
Session
↓
Run
↓
Item
```

引擎统一由：

# EngineSupervisor

监管。

---

## EngineSupervisor

负责：

```text
availability
create
run
stream
cancel
resume
fork
destroy
```

---

# 30. AI Safety Boundary

这是产品行为基线，不能因为技术架构重构而破坏。

必须：

```text
Engine only receives authorized context
Engine cannot directly modify formal content
AI change first enters Preview / ChangeSet
Commit uses optimistic version protection
No silent engine fallback
Paid provider action requires confirmation
```

---

# 31. File Capability

保留产品安全语义：

```text
Client 不获得任意文件系统权限
```

改造成正式 Capability：

```text
File Capability Service
```

通过 HTTP 使用。

---

# 32. Credential

Renderer 永远只看：

```text
credentialRef
```

明文凭据由：

```text
Desktop Host Credential Service
```

持有。

存储实现可以：

```text
AES-256-GCM
OS Keychain
Enterprise Secret Store
```

架构不绑定具体实现。

---

# 33. 目标仓库结构

重构发生在现有：

```text
desktop/
```

最终可以演进为：

```text
desktop/
│
├── apps/
│   └── desktop/
│       ├── main/
│       └── renderer/
│
├── packages/
│   ├── client/
│   ├── contracts/
│   ├── database/
│   ├── events/
│   ├── http/
│   ├── kernel/
│   ├── plugin-api/
│   ├── plugin-host/
│   ├── plugin-resolver/
│   ├── runtime/
│   ├── engine-runtime/
│   ├── desktop-host/
│   ├── ui/
│   ├── ui-runtime/
│   └── ui-shared/
│
├── plugins/
│   ├── foundation/
│   ├── system/
│   ├── workspace/
│   ├── automation/
│   ├── writing/
│   ├── knowledge/
│   ├── agents/
│   ├── creative-quality/
│   ├── production/
│   ├── media/
│   ├── timeline/
│   ├── review/
│   ├── delivery/
│   └── insights/
│
├── profiles/
│   ├── studio.json
│   ├── safe.json
│   ├── test.json
│   └── e2e.json
│
├── plugin-sdk/
│   ├── docs/
│   ├── examples/
│   └── templates/
│
├── generated/
├── scripts/
├── docs/
└── tests/
```

该目录是目标形态。

允许在重构过程中进行较大结构调整。

---

# 34. 重构策略

仍然采用：

# Incremental Refactoring

但“渐进式”只表示：

> 控制风险、保持软件持续可运行。

不表示：

> 最终保留旧架构。

最终旧架构应被彻底替换。

---

# 35. 重构阶段

---

## Phase 0：产品基线冻结

记录：

```text
功能
UI
E2E
数据库数据
OpenAPI
六引擎行为
生成结果
生产闭环
发布行为
```

---

## Phase 1：建立新 Kernel

在 `desktop` 中引入：

```text
Cordis
Plugin Lifecycle
Dependency Graph
Capability Registry
Profile
Diagnostics
Rollback
```

---

## Phase 2：建立新 HTTP Runtime

目标：

```text
Hono
Zod
OpenAPI
SSE
Problem Details
```

迁移期允许旧 Effect API 与新 Runtime 并存。

---

## Phase 3：建立新 Client SDK

统一：

```text
@dramaip/client
```

逐步让 Renderer 从：

```text
@sdns/client
```

迁移到新 Client。

---

## Phase 4：建立 Desktop Host HTTP API

消除业务和 Native Capability IPC。

---

## Phase 5：迁移 Foundation / System

先验证：

```text
Plugin lifecycle
HTTP route contribution
events
migration
```

---

## Phase 6：迁移 Workspace / Automation

验证第一批完整业务域插件。

---

## Phase 7：迁移 Writing / Knowledge

保护成熟写作闭环。

---

## Phase 8：迁移 Agents

同时完成：

```text
EngineSupervisor
```

统一六引擎控制。

---

## Phase 9：迁移 Creative / Production / Media / Timeline / Review / Delivery / Insights

逐域迁移。

---

## Phase 10：迁移 UI Composition

最终从中心 Router / 页面注册方式迁移为：

```text
UI Shell
+
Plugin Contributions
```

---

## Phase 11：迁移数据库所有权

建立：

```text
plugin migration ledger
table ownership
persistent events
consumer checkpoint
```

---

## Phase 12：删除旧 Runtime

当所有业务域迁移完成：

```text
Effect HttpApi legacy
旧 @sdns/server 结构
旧业务 IPC / RPC
旧业务包边界
```

全部删除。

---

## Phase 13：稳定 First-party Plugin Platform

完成：

```text
Public
Experimental
Internal
```

API 分层。

---

## Phase 14：第三方 Plugin SDK

加入：

```text
Manifest
Resolver
Permission
Trust
Compatibility
Extension Host
Capability Broker
```

---

## Phase 15：开放第三方插件

顺序：

```text
AI Provider
Tool
Workflow
Exporter
Importer
Search
Integration
↓
Declarative UI
↓
Sandboxed UI
```

---

## Phase 16：归档 desktop2

当 `desktop` 已经完整采用目标架构：

```text
desktop2
=
historical architecture experiment
```

停止作为产品轨道维护。

---

# 36. 每次迁移必须遵循

```text
1. Freeze current behavior
2. Define target architecture
3. Implement new module/plugin
4. Add compatibility adapter if needed
5. Move Client to new API
6. Run unit tests
7. Run integration tests
8. Run Electron E2E
9. Check DB behavior
10. Check engine behavior
11. Check UI behavior
12. Remove old implementation
```

关键：

> **Compatibility Adapter 必须最终删除。**

---

# 37. Codex MUST

1. MUST 只在 `desktop/` 正式代码主线上进行重构。
2. MUST 把 `desktop2` 当架构参考，而不是迁移目标。
3. MUST 以本文定义的新技术架构为最终真相。
4. MUST 不把当前 `desktop` 技术架构当成兼容约束。
5. MUST 保持当前成熟产品功能和行为。
6. MUST 使用 HTTP 作为 DramaIP 自有 C/S 边界。
7. MUST 使用 REST + JSON + SSE + OpenAPI。
8. MUST 最终删除 Renderer 业务 IPC。
9. MUST 最终让 Desktop Host Capability 通过 HTTP 暴露。
10. MUST 让 Runtime Headless 可运行。
11. MUST 使用 Plugin Kernel 组织 Runtime。
12. MUST 以 Bounded Context / Capability 作为 Plugin 粒度。
13. MUST 让 Plugin Dependency Graph 可验证。
14. MUST 让 Plugin 生命周期可回滚。
15. MUST 让 First-party Plugin 之间只经 Contract / Service / Event 协作。
16. MUST 建立 Profile。
17. MUST 建立 Persistent / Realtime Event 区分。
18. MUST 建立 Plugin Migration Ledger。
19. MUST 建立 EngineSupervisor。
20. MUST 保持六引擎产品行为。
21. MUST 保持 AI Preview / Commit 安全模型。
22. MUST 最终提供第三方 Plugin SDK。
23. MUST 给第三方插件 Permission / Trust / Isolation。
24. MUST 保持 Third-party Plugin 不依赖 Runtime 私有对象。
25. MUST 在最终迁移完成后删除旧技术架构。

---

# 38. Codex SHOULD

1. SHOULD 采用 Hono 作为新 Runtime HTTP Host。
2. SHOULD 采用 Zod 定义 Runtime / Plugin / HTTP Schema。
3. SHOULD 采用 Cordis 作为 Plugin Kernel。
4. SHOULD 采用 `@dramaip/client` 作为新的统一 Client SDK。
5. SHOULD 参考 desktop2 的 Profile、Plugin API、Event、Migration 和 EngineSupervisor。
6. SHOULD 迁移期间使用 Adapter 保证功能连续。
7. SHOULD 逐域迁移，而不是一次停服式重写。
8. SHOULD 保留现有 E2E 作为黑盒产品验收。
9. SHOULD 在迁移后删除旧 Adapter。
10. SHOULD 让第三方插件默认运行在 Extension Host Process。

---

# 39. Codex MUST NOT

1. MUST NOT 把“在 desktop 重构”理解成“保留 desktop 架构”。
2. MUST NOT 把正式开发迁往 `desktop2`。
3. MUST NOT 新建 `desktop3`。
4. MUST NOT 为了兼容永久保留旧 Effect / Server 架构。
5. MUST NOT 为了兼容永久保留旧 IPC / RPC。
6. MUST NOT 把 `/api/v1` 视为不可改变的架构规则。
7. MUST NOT 把 `@sdns/*` 包边界视为不可改变。
8. MUST NOT 把所有代码插件化。
9. MUST NOT 让 Kernel 变成新的 God Server。
10. MUST NOT 让 Plugin 导入其他 Plugin 实现。
11. MUST NOT 给 Third-party Plugin raw Cordis Context。
12. MUST NOT 给 Third-party Plugin raw SQLite。
13. MUST NOT 强制 Vendor Engine 使用 HTTP。
14. MUST NOT 用新架构为理由破坏成熟产品功能。
15. MUST NOT 用 generic CRUD UI 替换成熟业务 UI。
16. MUST NOT 在迁移完成后继续维护两套正式 Runtime。

---

# 40. 成功标准

最终 `desktop` 应满足：

## C/S

```text
Renderer
↓ HTTP
Runtime
```

并且：

```text
Runtime
↓ HTTP
Desktop Host
```

业务架构中不存在 IPC。

---

## Runtime

```text
HTTP Host
+
Cordis Kernel
+
Profile
+
Domain Plugins
+
Events
+
Plugin Migrations
```

---

## Client

```text
Electron
Web
CLI
```

都可以使用同一：

```text
OpenAPI + Client SDK
```

---

## Plugin

能够：

```text
install
enable
activate
deactivate
disable
uninstall
```

并支持：

```text
Built-in
Official
Third-party
```

---

## Product

当前成熟 DramaIP：

```text
写作
知识
AI
改编
制作
媒体
时间线
审片
交付
洞察
```

能力不得因架构重构退化。

---

# 41. 最终 Architecture Decision Record

## Refactoring Repository

```text
desktop/
```

---

## Product Baseline

```text
desktop current product behavior
```

---

## Architecture Baseline

不是：

```text
desktop current architecture
```

而是：

# HTTP Client / Plugin Runtime Architecture

---

## Architecture Reference

```text
desktop2
```

只用于借鉴：

```text
Cordis
Profile
Plugin model
Migration
Events
UI contribution
EngineSupervisor
Architecture gates
```

---

## Target HTTP Model

```text
REST
JSON
SSE
OpenAPI
```

---

## Target Plugin Model

```text
Cordis-style Plugin Kernel
+
First-party Domain Plugins
+
Official Plugins
+
Third-party Plugin Platform
```

---

## Target Desktop Model

```text
Electron Renderer
      │
      │ HTTP
      ▼
DramaIP Runtime
      │
      │ HTTP
      ▼
Electron Desktop Host
```

---

## Migration Philosophy

```text
Preserve product behavior
Replace technical architecture
```

---

## End State

`desktop/` 最终成为唯一正式 DramaIP Desktop 代码主线：

# DramaIP HTTP Client / Plugin Runtime Platform

旧的集中式 Server、旧技术包边界、旧业务 IPC / RPC 和其他与目标架构冲突的实现，在迁移完成后全部删除。

`desktop2/` 最终只保留为：

```text
architecture reference / historical experiment
```
