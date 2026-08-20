# Client / Plugin Runtime Architecture

> DramaIP 桌面端目标技术架构与重构指导  
> 更新时间：2026-08-18  
> 状态：**Accepted / Target Architecture**  
> 正式重构仓库：`desktop/`  
> 产品、功能、UI 与验收基线：当前成熟 `desktop`  
> 架构参考：`desktop2`、OpenCode、DeepSeek Harness、`DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md`  
> 本文作为 Codex / Coding Agent 后续重构、代码审查和架构决策的高优先级约束。

---

# 0. 核心决策

DramaIP 最终采用：

# HTTP Client / Plugin Runtime Architecture

完整目标不是保留当前 `desktop` 技术架构，也不是迁移到 `desktop2`，而是：

> **在当前成熟的 `desktop/` 代码仓库中，保留产品能力和行为基线，全面替换为新的 HTTP C/S + Core Runtime + Public Plugin Platform 技术架构。**

必须明确区分：

```text
重构位置
=
desktop/
```

```text
产品 / 功能 / UI / 行为 / 数据语义 / 验收基线
=
当前成熟 desktop
```

```text
目标技术架构
=
本文定义的 HTTP Client / Plugin Runtime Architecture
```

```text
desktop2
=
Architecture Reference / Pattern Library
```

因此：

# Preserve product behavior, replace technical architecture.

保留的是成熟产品能力，不是旧技术架构。

当前存在的：

```text
Effect HttpApi
/api/v1
@sdns/server 组织方式
固定 Workspace 分层
现有 IPC / RPC
现有包边界
```

都不构成最终架构约束。

迁移期可以临时兼容，但最终以本文定义的目标架构为准。

---

# 1. DramaIP 的产品定位

DramaIP 是大型开放型 AI 内容创作与生产平台，不应按普通封闭桌面软件设计。

其成熟产品能力已经覆盖：

```text
项目与工作区
小说写作
Story Bible / 知识
智能写作
智能助手
改编
制作
媒体
时间线
审片
交付
反馈与洞察
多智能引擎
```

因此 DramaIP 适用通用架构中的：

# Level 3：大型开放项目

其架构必须同时解决：

```text
HTTP C/S
Headless Runtime
多 Client
复杂业务域解耦
内部插件
官方插件
第三方插件
Plugin SDK
Permission / Trust / Isolation
长期版本兼容
插件加载与升级
```

---

# 2. 当前 `desktop` 与 `desktop2` 的角色

## 2.1 `desktop`

`desktop` 是正式重构主线。

它承担：

```text
Product Baseline
Feature Baseline
UI / UX Baseline
Data Behavior Baseline
Engine Behavior Baseline
E2E Baseline
Release Baseline
Refactoring Mainline
```

选择 `desktop` 的原因是它当前产品功能最成熟，而不是因为它现有架构最优。

---

## 2.2 `desktop2`

`desktop2` 是插件优先架构实验实现。

重点参考：

```text
Cordis Kernel
Profile
Plugin Dependency Graph
Plugin Lifecycle
Plugin Rollback
Plugin Migration
Persistent / Realtime Events
Consumer Checkpoint
UI Contribution
EngineSupervisor
Architecture Gates
```

使用方式：

```text
分析 desktop2
    ↓
提取经过验证的设计
    ↓
按本文目标架构重新落地到 desktop
```

禁止：

```text
将 desktop 功能整体迁往 desktop2
让正式 desktop Runtime 依赖 desktop2 业务代码
长期维护两套正式产品 Runtime
```

---

# 3. 最终总体架构

```text
┌────────────────────────────────────────────────────────────────┐
│                           Clients                              │
│                                                                │
│ Electron Desktop        Web        CLI        Automation       │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               │ HTTP
                               │ REST / JSON / SSE
                               │ OpenAPI
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                      DramaIP Core Runtime                       │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ HTTP API                                                 │  │
│  │ Routing / Validation / Auth / SSE / OpenAPI             │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │                                 │
│  ┌───────────────────────────▼──────────────────────────────┐  │
│  │ Platform Kernel                                          │  │
│  │                                                          │  │
│  │ Plugin Graph / Lifecycle / Profile / Bundle             │  │
│  │ Capability / Events / Permissions / Diagnostics         │  │
│  │ Reversible Effects / Loading / Migration                │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │                                 │
│              ┌───────────────┴───────────────┐                 │
│              ▼                               ▼                 │
│     First-party Plugins              Official Plugins         │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               │ Local HTTP
                               │ Capability Broker
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                         Extension Host                         │
│                                                                │
│ Permission Enforcement / Capability Proxy / Isolation         │
│ Reversible Effects / Third-party Plugin Runtime                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               ▼
                       Third-party Plugins

                               ▲
                               │ Local HTTP
                               │ Host Capability
┌──────────────────────────────┴─────────────────────────────────┐
│                      Electron Desktop Host                     │
│                                                                │
│ Window / File / Credential / Notification / Updater           │
│ Runtime Supervisor / Extension Host Supervisor / Engine       │
└────────────────────────────────────────────────────────────────┘
```

---

# 4. 最高架构原则

## Principle 1

# Client != Runtime

Electron Renderer 只是 Desktop Client。

Runtime 是真正承载业务和平台能力的独立服务。

---

## Principle 2

# Client / Runtime Communication = HTTP

DramaIP 自己控制的 C/S 边界统一使用：

```text
REST
JSON
SSE
OpenAPI
```

业务架构不使用 Electron IPC。

---

## Principle 3

# Core Runtime must run without Electron

Core Runtime 必须：

```text
Headless 启动
独立测试
独立运行
后台常驻
被 Web / CLI / Remote Client 连接
```

Electron 只是 Runtime 的一种宿主和 Client 形态。

---

## Principle 4

# Runtime != God Server

Runtime 由：

```text
Minimal Platform Kernel
+
First-party Domain Plugins
+
Official Plugins
```

组成。

业务不能重新堆回中央 Server。

---

## Principle 5

# Everything Replaceable is a Plugin

真正可替换、可扩展、可组合的能力插件化。

同时：

# Product Bounded Context can be a First-party Plugin

例如：

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

可以作为一级 Domain Plugin。

但：

```text
Entity
Value Object
普通函数
普通 React Component
Utility
```

不应因为“Everything is a Plugin”而机械插件化。

---

## Principle 6

# Plugin → Bundle → Profile

插件不是最终产品组合层。

正式组合层级：

```text
Plugin
  ↓
Bundle
  ↓
Profile
  +
Installed Extension Set
  ↓
Effective Runtime Graph
```

---

## Principle 7

# Reversible Effects

所有长期副作用必须被平台追踪并可逆。

# No untracked long-lived side effects.

---

## Principle 8

# Public Plugin API is a Product API

第三方 Plugin SDK 一旦发布，就必须像 HTTP API 一样：

```text
版本化
兼容
弃用
测试
文档化
```

---

## Principle 9

# Third-party Plugin != Trusted First-party Code

第三方插件默认：

```text
Out-of-process
Least Privilege
Explicit Permission
Version Checked
Capability Brokered
```

---

## Principle 10

# Product Profile != User Extensions

产品核心拓扑由 DramaIP 官方控制。

用户安装插件不能直接修改官方 Product Profile。

---

# 5. Runtime 物理运行模型

DramaIP 明确区分：

```text
Core Runtime
```

和：

```text
Third-party Extension Host
```

两者都是独立 JavaScript / TypeScript 服务运行时。

推荐物理模型：

```text
Electron Application
│
├── Main Process
│   ├── Window
│   ├── Core Runtime Supervisor
│   ├── Extension Host Supervisor
│   ├── Engine Supervisor
│   ├── Native Host
│   └── Updater
│
├── Renderer Process
│   └── DramaIP Desktop Client
│
├── Core Runtime Process
│   ├── HTTP Server
│   ├── Platform Kernel
│   ├── Built-in Plugins
│   ├── Official Plugins
│   ├── SQLite
│   └── Events / Tasks
│
└── Extension Host Process
    ├── Capability Proxy
    ├── Permission Enforcement
    ├── Third-party Plugin Runtime
    └── Isolation / Crash Boundary
```

关键原则：

> **Electron Main 是 Supervisor + Desktop Host，不是业务 Runtime。**

> **Third-party Plugin 不运行在 Core Runtime 进程中。**

---

# 6. Desktop Mode 与 Server Mode

DramaIP 必须支持两种运行模式。

## 6.1 Desktop Mode

```text
Electron Main
    │
    ├── Start / Attach Core Runtime
    ├── Start Extension Host
    ├── Start Engine Runtime
    └── Create Renderer
             │
             ▼
       Desktop Client
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
Desktop Client Host
```

---

## 6.2 Server Mode

```text
systemd / Windows Service / launchd / CLI / Container
                         │
                         ▼
                   Core Runtime
                         │
                 HTTP API / SSE
                /       |       \
               ▼        ▼        ▼
             Web       CLI    Remote Desktop
                         │
                         ▼
                  Extension Host
                         │
                  Third-party Plugins
```

Server Mode：

- 不启动 Electron；
- 不创建 BrowserWindow；
- 不依赖 Electron Main；
- Core Runtime 独立持有数据库、事件、任务和 HTTP API；
- Extension Host 仍可运行第三方插件；
- 可以长期后台运行。

推荐入口：

```bash
dramaip desktop
dramaip serve
```

可进一步：

```bash
dramaip serve --profile=server
dramaip serve --runtime=node
dramaip serve --runtime=bun
```

---

# 7. Node.js + Bun 双 Runtime

Core Runtime 的正式定义：

> **独立的 Node-compatible JavaScript / TypeScript 服务运行时。**

同一套 Runtime 代码 SHOULD 同时支持：

```text
Node.js
+
Bun
```

角色：

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
Headless / Server Mode 可选实现
```

---

## 7.1 Node 模式

Electron 默认：

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

---

## 7.2 Bun 模式

Bun 作为独立 sidecar：

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

---

## 7.3 Runtime-neutral 约束

业务代码不得到处使用：

```text
Bun.file
Bun.serve
Bun-specific API
```

Runtime-specific 能力通过：

```text
Runtime Capability
├── NodeRuntimeAdapter
└── BunRuntimeAdapter
```

隔离。

---

## 7.4 双 Runtime CI

至少：

```text
Node.js CI
├── unit
├── integration
├── HTTP
└── database

Bun CI
├── unit
├── integration
├── HTTP
└── database
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
module resolution
signal
graceful shutdown
```

兼容策略：

```text
Node.js = MUST PASS
Bun     = SHOULD PASS
```

---

## 7.5 Extension Host Runtime

第三方 Extension Host 默认：

```text
Node.js
```

只有 Public Plugin SDK 明确支持 Bun 后，才允许 Bun Extension Host。

Plugin Manifest 可声明：

```json
{
  "runtime": {
    "supported": ["node", "bun"]
  }
}
```

平台必须在安装和启用前校验。

---

# 8. Server Connection Manager

所有 Client 连接 Runtime 必须经过统一：

# Server Connection Manager

职责：

```text
discover
attach
spawn-local
authenticate
health
version negotiation
capability negotiation
profile discovery
reconnect
failover
disconnect
```

标准模型：

```text
Desktop / Web / CLI
        │
        ▼
Server Connection Manager
        │
        ├── Local Runtime
        ├── Existing Background Runtime
        └── Remote Runtime
                │
                ▼
         Version Negotiation
                │
         Capability Negotiation
                │
         Authentication
                │
                ▼
          Runtime Session
```

Runtime 至少提供：

```text
/health
/version
/capabilities
/runtime
```

`/runtime` 推荐返回：

```text
runtimeId
runtimeVersion
apiVersion
pluginApiVersion
runtimeKind
mode
profile
bundles
plugins
capabilities
extensionHostStatus
engineStatus
```

Client 必须能够提前识别：

```text
Client / Runtime version incompatible
required capability missing
plugin API incompatible
server degraded
extension host unavailable
engine unavailable
```

不能连接成功后才随机暴露不兼容问题。

---

# 9. HTTP C/S 规则

DramaIP 自己拥有和控制的跨进程、跨 Client 边界统一 HTTP。

---

## 9.1 Client → Core Runtime

统一：

```text
REST
JSON
SSE
OpenAPI
```

Renderer 不得直接访问：

```text
SQLite
Repository
Cordis Server Context
Plugin Runtime internals
Engine Runtime internals
```

---

## 9.2 Core Runtime → Desktop Host

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

POST /host/notification/show
POST /host/window/minimize
POST /host/window/maximize
```

结构：

```text
Renderer
   │ HTTP
   ▼
Core Runtime
   │ HTTP
   ▼
Desktop Host
```

Renderer 不直接通过 IPC 调 Main。

---

## 9.3 Core Runtime → Extension Host

使用本地 HTTP：

```text
Core Runtime
    │
    │ Local HTTP + Plugin Identity
    ▼
Extension Host
```

由 Core Runtime 提供：

```text
Capability Broker
Permission Check
Audit
Rate Limit
Plugin Identity
```

---

## 9.4 Bootstrap

Renderer 启动只需要获得：

```text
Runtime Base URL
Runtime Token
Application Metadata
```

Bootstrap 不是业务 API。

可以通过：

```text
BrowserWindow URL bootstrap
custom protocol bootstrap
immutable startup payload
```

完成。

---

## 9.5 IPC

目标架构：

# No IPC for application capabilities.

如果 Electron 内部实现细节确实需要 IPC：

- 只能封装在 Desktop Host 内部；
- 不得暴露为 Renderer 业务 API；
- 不得成为 Runtime Contract；
- 不得绕过 HTTP 边界。

---

# 10. Desktop Capability 可选化

Core Runtime 不得把 Electron Desktop Host 作为启动硬依赖。

桌面能力建模为 Capability：

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

没有桌面能力时返回：

```text
CapabilityUnavailable
```

而不是 Runtime 启动失败。

---

# 11. 外部智能引擎协议

DramaIP 自己的 C/S 边界统一 HTTP，但 Vendor Runtime 保留原生协议。

当前活动三引擎统一通过稳定的 `@dramaip/agent-runtime`：

# Engine Adapter

接入。

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

例如：

```text
Codex
→ App Server stdio

Pi
→ embedded / adapter

Grok Build
→ ACP
```

Pi 是随产品编译、签名并由 Host utilityProcess 监督的默认内嵌 Harness；Codex 与 Grok Build 是外部高质量基准引擎。OpenCode、DeepSeek Harness 仅保留只读架构参考，LangGraph 的模型调用、输出校验和一次 JSON 修复迁入 Core Runtime 的持久重试流程，不再作为 Engine 或 Workflow Runtime。

不要为了形式统一给所有 Vendor Engine 再包一层 HTTP，也不得对不支持的原生操作模拟或回退。

---

# 12. EngineSupervisor

DramaIP 应统一由：

# EngineSupervisor

管理所有智能引擎。

职责：

```text
availability
create
run
stream
cancel
resume
fork
destroy
health
runtime path
credential resolution
```

统一逻辑模型继续保持：

```text
Session
  ↓
Run
  ↓
Item
```

选定引擎不可用时：

```text
explicit failure
```

禁止：

```text
silent fallback
```

---

# 13. Platform Kernel

Kernel 必须保持最小，只负责平台机制：

```text
Plugin Resolver
Plugin Registry
Plugin Lifecycle
Dependency Graph
Bundle Registry
Profile
Installed Extension Set
Capability Registry
Service Registry
Permission Broker
Event Infrastructure
Migration Coordination
Diagnostics
Reversible Effect Tracking
Extension Host Management
HTTP Route Contribution
UI Contribution Metadata
```

Kernel 不负责：

```text
小说写作
人物
Story Bible
制作
媒体
时间线
审片
交付
洞察
```

这些属于 Domain Plugin。

---

# 14. Plugin 类型

统一分为：

## 14.1 Built-in Plugin

核心产品能力，随 DramaIP 发布。

例如：

```text
foundation
system
workspace
automation
writing
knowledge
agents
production
```

可以是 Critical。

---

## 14.2 Official Plugin

DramaIP 官方维护，但不是核心必装能力。

例如：

```text
特殊 AI Provider
特定 Exporter
云审片 Integration
垂直行业 Workflow
```

---

## 14.3 Third-party Plugin

第三方独立开发。

例如：

```text
新 AI Provider
新 Workflow
新 Tool
新 Exporter
知识库 Integration
人物关系图
行业模板
自定义分析器
```

默认：

```text
Out-of-process
Least Privilege
Explicit Permission
Version Checked
```

---

# 15. Plugin 粒度

正确：

```text
Bounded Context
Replaceable Capability
Platform Extension
```

DramaIP 可参考：

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

错误：

```text
CharacterEntityPlugin
DatePlugin
ButtonPlugin
StringPlugin
```

---

# 16. First-party Plugin 结构

推荐：

```text
plugins/
└── writing/
    ├── contracts/
    ├── server/
    ├── ui/
    └── migrations/
```

四类 Contribution：

```text
contracts
server
ui
migrations
```

---

# 17. Plugin Contract

插件之间禁止 import 对方实现。

禁止：

```ts
import { something } from "../knowledge/server/internal";
```

允许：

```text
Stable Contract
Typed Cordis Service
Capability
Domain Event
```

最终依赖必须形成：

```text
DAG
```

启动前验证：

```text
Missing Dependency
Dependency Cycle
Version Conflict
Runtime Compatibility
Critical Plugin Failure
```

---

# 18. Cordis 使用原则

Cordis 作为：

# Plugin Composition Kernel

主要吸收：

```text
mount
unmount
replace
lifecycle
effect cleanup
service capability
plugin graph
```

但禁止把 Cordis Context 变成万能 Service Locator。

尤其第三方不能访问：

```ts
ctx.internal;
ctx.database.raw;
ctx.runtime.private;
```

---

# 19. Reversible Effects

Reversible Effect 是 Plugin Kernel 和 Public Plugin SDK 的核心语义。

所有长期注册行为必须：

```text
返回 disposer
或
被 SDK 自动跟踪
```

包括：

```text
route
event
service
capability
timer
watcher
command
menu
panel
settings
background task
network listener
```

推荐 API：

```ts
ctx.effect(() => {
  const resource = acquire();
  return () => release(resource);
});
```

Kernel / Extension Host 必须：

- 自动记录 effect ownership；
- Plugin 激活失败时自动 rollback；
- deactivate 时逆序释放；
- reload 前清理旧 revision；
- crash recovery 后清理残留资源。

原则：

# Effects unwind in reverse order.

以及：

# No untracked long-lived side effects.

---

# 20. Bundle Layer

DramaIP 正式采用：

```text
Plugin
  ↓
Bundle
  ↓
Profile
  +
Installed Extension Set
  ↓
Effective Runtime Graph
```

---

## 20.1 Plugin

最小可装载能力单元。

---

## 20.2 Bundle

一组可复用、可分发、有明确产品意义的 Plugin 组合。

例如：

```text
writing-suite
├── writing
├── knowledge
├── revision
└── style-tools
```

```text
production-suite
├── production
├── media
├── timeline
└── review
```

Bundle 只负责：

```text
composition
dependency declaration
defaults
configuration aggregation
```

Bundle 不拥有独立业务状态。

---

## 20.3 Profile

官方 Runtime 运行形态。

例如：

```text
studio
server
safe
test
e2e
enterprise
```

---

## 20.4 Installed Extension Set

用户安装：

```text
Official Optional Plugin
Third-party Plugin
Third-party Bundle
```

独立记录。

最终：

```text
Product Profile
+
Built-in / Official Bundles
+
Installed Extension Set
+
User Configuration
=
Effective Runtime Graph
```

第三方 Bundle 不得绕过单个 Plugin 的：

```text
Manifest
Permission
Compatibility
Trust
```

---

# 21. Product Profile 与 User Extensions

Product Profile 由 DramaIP 官方发布。

第三方不能直接修改。

用户安装扩展单独存储：

```json
{
  "plugins": [
    {
      "id": "com.example.character-graph",
      "version": "1.2.0",
      "enabled": true
    }
  ]
}
```

Kernel 启动：

```text
Product Profile
      +
Installed Extensions
      ↓
Dependency Validation
      ↓
Permission Validation
      ↓
Compatibility Validation
      ↓
Effective Runtime Graph
```

---

# 22. Plugin Manifest

第三方插件必须拥有 Manifest。

示例：

```json
{
  "id": "com.example.character-graph",
  "name": "Character Graph",
  "version": "1.2.0",
  "apiVersion": "1",

  "engines": {
    "dramaip": ">=3.0.0 <4.0.0"
  },

  "runtime": {
    "supported": ["node", "bun"]
  },

  "load": "lazy",

  "reloadPolicy": "restart-extension-host",

  "permissions": ["project.read", "character.read"],

  "dependencies": {},

  "optionalDependencies": {},

  "contributes": {
    "commands": [],
    "panels": [],
    "settings": []
  }
}
```

至少描述：

```text
Identity
Version
Plugin API Version
DramaIP Compatibility
Runtime Compatibility
Entrypoints
Dependencies
Permissions
Contributions
Configuration Schema
Load Policy
Reload Policy
Migration Metadata
```

---

# 23. Public Plugin SDK

第三方只能依赖：

```text
@dramaip/plugin-api
@dramaip/contracts
```

禁止：

```text
@dramaip/kernel/internal
@dramaip/runtime/internal
Drizzle internals
Raw SQLite
Electron Main
Cordis private objects
```

公共 API 分层：

```text
Public
Experimental
Internal
```

第三方只能依赖：

```text
Public
```

---

# 24. Public PluginContext

第三方 Context 必须是明确 Capability：

```text
PluginContext
│
├── projects
├── writing
├── knowledge
├── assets
├── ai
├── tasks
├── workflows
├── commands
├── ui
├── storage
├── settings
├── events
└── diagnostics
```

不能存在万能：

```text
ctx.internal
```

---

# 25. Permission Model

至少：

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

权限必须：

```text
Declared
Displayed
Granted
Revocable
Enforced
Auditable
```

---

# 26. Trust Model

至少：

```text
Built-in
Official
Verified Third-party
Unverified Third-party
Development
```

Trust Level 影响：

```text
Isolation
Permission Default
Native Capability
Network Access
UI Warning
Update Policy
Signing Requirement
```

---

# 27. Extension Host

第三方插件默认不运行在 Core Runtime。

结构：

```text
Core Runtime
     │
     │ Local HTTP
     ▼
Extension Host
     │
Capability Proxy
     ▼
Third-party Plugin
```

Extension Host 负责：

```text
Plugin Loading
Permission Enforcement
Capability Proxy
Effect Tracking
Crash Boundary
Plugin Health
Reload
Quarantine
```

---

# 28. Plugin Loading Policy

第三方插件必须有明确加载策略。

```text
load:
  eager
  lazy
```

---

## 28.1 Eager

启动 Runtime / Extension Host 时加载。

适合：

```text
全局 Integration
always-on provider
关键扩展
```

---

## 28.2 Lazy

首次请求 Capability / UI Contribution 时加载。

适合：

```text
大型可选 Integration
低频 Exporter
垂直专业 Tool
```

---

# 29. Revision / Content Hash

每个已安装 Plugin 必须有：

```text
plugin id
version
revision
content hash
publisher / signature
```

不能只用：

```text
version string
```

判断插件是否变化。

---

# 30. Dependency-aware Reload

插件更新或 reload 时：

```text
Changed Plugin
      │
      ▼
Dependents
      │
      ▼
Reload Plan
```

标准流程：

```text
1. validate new revision
2. calculate dependency impact
3. stop affected dependents
4. unwind reversible effects
5. load new revision
6. reactivate dependencies / dependents
7. run health checks
8. rollback if activation fails
```

禁止：

```text
覆盖磁盘文件后继续运行旧内存实例
```

---

# 31. Hot Update Policy

插件可声明：

```text
reloadPolicy:
  hot
  restart-extension-host
  restart-runtime
```

平台根据能力选择：

```text
Hot Reload
Extension Host Restart
Core Runtime Restart
```

不要求所有插件都支持零停机热更新。

---

# 32. Crash Recovery / Quarantine

第三方插件崩溃：

```text
Plugin Crash
   ↓
Extension Host identifies owner
   ↓
cleanup tracked effects
   ↓
mark degraded
   ↓
restart plugin / extension host
   ↓
dependency-aware health check
```

反复崩溃：

```text
degraded
↓
disabled
↓
quarantined
```

核心 Runtime 继续运行。

---

# 33. Database

DramaIP 继续采用 Local-first：

```text
SQLite
+
Drizzle
```

但数据库所有权按新插件架构组织。

---

## 33.1 Plugin Migration Ledger

每个 Plugin 维护：

```text
pluginId
version
dependency
checksum
migration history
executedAt
```

---

## 33.2 Table Ownership

必须能够回答：

```text
which plugin owns which tables
```

---

## 33.3 Third-party Storage

第三方：

```text
不得 raw SQLite
不得修改 Core Tables
```

使用：

```text
Plugin-owned Storage
Namespaced Table
Plugin Storage API
Public Domain Capability
```

卸载时定义：

```text
Keep Data
Delete Data
Export Data
```

---

# 34. Event Architecture

正式区分：

```text
Persistent Domain Events
+
Realtime Events
```

---

## 34.1 Persistent Event

例如：

```text
project.created
chapter.updated
workflow.completed
asset.approved
review.decided
plugin.enabled
```

必须支持：

```text
global cursor
replay
consumer checkpoint
```

---

## 34.2 Realtime Event

例如：

```text
ai.token
task.progress
runtime.health
engine.health
temporary.status
```

不要求全部持久化。

---

## 34.3 Transaction

业务状态与 Persistent Event：

```text
same transaction
```

防止：

```text
state committed
event lost
```

---

## 34.4 Consumer Checkpoint

异步消费者：

```text
独立 checkpoint
retry
backoff
degraded diagnostics
```

成功后才推进 checkpoint。

---

# 35. HTTP API Standard

新的正式 Runtime API 使用：

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

API 版本由正式 Contract 决定。

不要求永久保留旧 `/api/v1`，也不机械复制 `desktop2` 的 `/api/v2`。

---

# 36. OpenAPI 与 Client SDK

Runtime 构建 Effective OpenAPI。

包含：

```text
Core API
First-party Plugin API
Official Plugin API
Third-party Plugin Routes
```

所有 Client 使用：

```text
@dramaip/client
```

统一 SDK。

Renderer 不到处手写：

```ts
fetch(...)
```

---

# 37. Plugin HTTP Route

第三方插件自定义 HTTP Route 推荐：

```text
/api/plugins/{pluginId}/...
```

避免污染 Core API Namespace。

被平台正式提升为公共 Capability 后，才进入标准 Core API。

---

# 38. UI Architecture

保留成熟 DramaIP 产品 UI 行为，但代码组合方式重构为：

```text
Stable UI Shell
+
First-party UI Contributions
+
Official UI Contributions
+
Sandboxed Third-party UI
```

---

## 38.1 UI Shell

只负责：

```text
App Shell
Global Navigation Host
Route Outlet
Global Drawer
Error Boundary
Global Extension Slots
```

---

## 38.2 First-party Contribution

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

## 38.3 Third-party UI

按顺序开放：

```text
Command
Menu
Settings
Declarative Panel
Sandboxed Interactive UI
```

不允许任意第三方 React Bundle 直接进入主 Renderer。

---

## 38.4 Client-side Plugin Runtime

本架构有意不强制把整个 Renderer 变成完整 Cordis Plugin Tree。

默认：

```text
Stable UI Shell
+
Contribution Registry
+
Sandboxed Third-party UI
```

只有产品未来确实需要高度动态 UI Composition 时，才进一步引入：

```text
Client-side Plugin Runtime
```

---

# 39. File Capability

Client 不获得任意本机路径权限。

文件能力统一通过：

```text
File Capability Service
```

并遵循：

```text
short-lived capability
least privilege
explicit operation
```

Server Mode 没有桌面 File Picker 时，可使用 Browser Upload / Server-side Path Policy 等替代 Provider。

---

# 40. Credential

Renderer 永远只看到：

```text
credentialRef
```

明文凭据由：

```text
Desktop Host Credential Service
或
Server Credential Provider
```

持有。

存储实现可以：

```text
AES-256-GCM
OS Keychain
Enterprise Secret Store
```

但 Contract 不绑定具体实现。

---

# 41. AI / Engine Safety Boundary

当前 DramaIP 成熟安全语义必须保留。

必须：

```text
Engine only receives authorized context
Engine cannot directly modify formal content
AI change first enters Preview / ChangeSet
Commit uses optimistic version protection
No silent engine fallback
Paid provider action requires confirmation
```

这些属于产品安全边界，不因为底层架构重构而改变。

---

# 42. Plugin Distribution

平台最终可支持：

```text
Local Install
Official Registry
Marketplace
Private Enterprise Registry
Git-based Install
```

安装前必须：

```text
Manifest Validation
Integrity Check
API Compatibility
DramaIP Compatibility
Runtime Compatibility
Dependency Resolution
Permission Review
Trust Evaluation
Signature Check
Migration Validation
```

---

# 43. Plugin Signing / Update

正式生态 SHOULD 支持：

```text
Signature
Publisher Identity
Hash Integrity
Verified Publisher
```

更新前检查：

```text
API Compatibility
Product Compatibility
Runtime Compatibility
Permission Change
Migration
Signature
Content Hash
```

权限扩大时必须重新获得用户授权。

---

# 44. Architecture Gates

自动检查至少包括：

```text
Private Plugin API Import
Cross-plugin Internal Import
Raw Database Access
Missing Permission
Dependency Cycle
Manifest Invalid
API Version Conflict
Runtime Compatibility Conflict
Plugin Route Collision
Core -> Third-party Dependency
Unsafe UI Injection
Migration Namespace Violation
Untracked Reversible Effect
Generated OpenAPI Drift
Bundle / Profile Invalid
Content Hash Drift
```

---

# 45. Target Repository Structure

重构发生在现有：

```text
desktop/
```

目标可演进为：

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
│   ├── http/
│   ├── runtime/
│   ├── runtime-adapters/
│   ├── kernel/
│   ├── bundles/
│   ├── plugin-api/
│   ├── plugin-host/
│   ├── plugin-resolver/
│   ├── plugin-permissions/
│   ├── database/
│   ├── events/
│   ├── agent-runtime/
│   ├── desktop-host/
│   ├── server-connection/
│   ├── ui/
│   ├── ui-runtime/
│   └── ui-extension-host/
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
├── bundles/
│   ├── core/
│   ├── writing-suite/
│   ├── production-suite/
│   └── analytics-suite/
│
├── profiles/
│   ├── studio.json
│   ├── server.json
│   ├── safe.json
│   ├── test.json
│   ├── e2e.json
│   └── enterprise.json
│
├── plugin-sdk/
│   ├── docs/
│   ├── templates/
│   └── examples/
│
├── generated/
├── scripts/
├── docs/
└── tests/
```

目录是目标结果，不要求一次搬完。

---

# 46. 重构哲学

采用：

# Incremental Refactoring

但必须明确：

> **渐进式只用于控制风险，不代表保留旧技术架构。**

最终旧架构必须被目标架构替换。

---

# 47. 重构阶段

## Phase 0：冻结产品基线

记录：

```text
功能
UI
E2E
数据行为
当前 OpenAPI
三引擎（Pi 默认、Codex、Grok Build）行为
安全边界
生产闭环
发布行为
```

---

## Phase 1：建立新 Platform Kernel

引入：

```text
Cordis
Plugin Lifecycle
Dependency Graph
Capability Registry
Reversible Effect Tracking
Diagnostics
Rollback
```

---

## Phase 2：建立 Server Connection Manager

统一：

```text
discover
attach
spawn-local
health
version
capabilities
reconnect
```

使 Desktop 能连接已存在 Runtime。

---

## Phase 3：建立新 HTTP Runtime

目标：

```text
Hono
Zod
OpenAPI
SSE
Problem Details
```

迁移期允许旧 Effect API 与新 Runtime 暂时并存。

---

## Phase 4：建立新 `@dramaip/client`

统一 Desktop / Web / CLI Client Contract。

---

## Phase 5：建立 Desktop Host HTTP API

消除 Renderer 业务 / Native Capability IPC。

---

## Phase 6：建立 Runtime Adapter

支持：

```text
NodeRuntimeAdapter
BunRuntimeAdapter
```

并建立双 Runtime CI。

---

## Phase 7：迁移 Foundation / System

验证：

```text
Plugin lifecycle
Reversible effects
HTTP route contribution
events
migration
```

---

## Phase 8：建立 Bundle / Profile

建立：

```text
Plugin
↓
Bundle
↓
Profile
```

并添加：

```text
studio
server
safe
test
e2e
```

---

## Phase 9：迁移 Workspace / Automation

验证第一批完整 Domain Plugin。

---

## Phase 10：迁移 Writing / Knowledge

保护写作和 Story Bible 核心闭环。

---

## Phase 11：迁移 Agents

同时完成：

```text
EngineSupervisor
```

统一 Pi、Codex 与 Grok Build 三引擎控制；Pi 是默认内嵌 Harness，外部基准引擎不支持的操作必须显式拒绝。

---

## Phase 12：迁移 Production / Media / Timeline / Review / Delivery / Insights

逐域迁移。

---

## Phase 13：迁移 UI Composition

从中心式 Router / 页面注册逐步变成：

```text
Stable UI Shell
+
Plugin Contributions
```

---

## Phase 14：迁移数据库所有权与事件体系

建立：

```text
Plugin Migration Ledger
Table Ownership
Persistent Events
Realtime Events
Consumer Checkpoint
```

---

## Phase 15：删除旧 Runtime 技术架构

删除：

```text
旧 Effect HttpApi Runtime
旧 @sdns/server 中央组织方式
旧业务 IPC / RPC
旧业务包边界
迁移期 Compatibility Adapter
```

---

## Phase 16：稳定 Public Plugin API

划分：

```text
Public
Experimental
Internal
```

---

## Phase 17：建立 Extension Host

加入：

```text
Manifest
Resolver
Permission
Trust
Compatibility
Capability Broker
Reversible Effects
Crash Recovery
```

---

## Phase 18：建立 Plugin Loading / Update Policy

加入：

```text
eager / lazy
revision
content hash
reloadPolicy
dependency-aware reload
rollback
quarantine
```

---

## Phase 19：开放第三方 Server Capability

优先：

```text
AI Provider
Tool
Workflow
Exporter
Importer
Search
Integration
```

---

## Phase 20：开放第三方 UI

顺序：

```text
Command / Menu / Settings
↓
Declarative Panel
↓
Sandboxed Interactive UI
```

---

## Phase 21：建设插件分发

最后再建设：

```text
Registry
Marketplace
Signing
Publisher Verification
```

---

## Phase 22：归档 `desktop2`

当 `desktop` 完整采用目标架构：

```text
desktop2
=
historical architecture experiment / reference
```

停止作为第二正式产品轨道。

---

# 48. Codex MUST

1. MUST 只在 `desktop/` 正式主线实施重构。
2. MUST 把 `desktop2` 作为 Architecture Reference，而不是迁移目标。
3. MUST 以本文目标技术架构为最终真相。
4. MUST 保留成熟产品功能、UI 行为、安全语义和验收基线。
5. MUST 使用 HTTP 作为 DramaIP 自有 Client / Runtime 边界。
6. MUST 使用 REST + JSON + SSE + OpenAPI。
7. MUST 最终删除 Renderer 业务 IPC。
8. MUST 最终让 Desktop Host Capability 通过 HTTP 暴露。
9. MUST 让 Core Runtime 在完全不启动 Electron 时独立运行。
10. MUST 支持 Desktop Mode 与 Server Mode。
11. MUST 使用 Server Connection Manager。
12. MUST 支持连接已存在的本地或远程 Runtime。
13. MUST 保证 Node.js Runtime 完整可运行。
14. MUST 不让 Bun-only API 扩散到业务代码。
15. MUST 在声明 Bun 支持时运行 Bun CI。
16. MUST 使用 Plugin Kernel 组织 Runtime。
17. MUST 保持 Kernel 最小。
18. MUST 以 Bounded Context / Capability 作为 Plugin 粒度。
19. MUST 使用 Plugin → Bundle → Profile + Installed Extension Set 组合模型。
20. MUST 保持 Plugin Dependency Graph 可验证。
21. MUST 将 Reversible Effects 作为 Kernel / Plugin SDK 核心语义。
22. MUST 在 Plugin 卸载时逆序释放 Effects。
23. MUST 禁止未追踪长期副作用。
24. MUST 建立 Persistent / Realtime Event 区分。
25. MUST 建立 Plugin Migration Ledger。
26. MUST 建立 EngineSupervisor。
27. MUST 保持 Pi、Codex、Grok Build 三引擎行为和无静默 fallback。
28. MUST 保持 Preview / ChangeSet / Commit 安全模型。
29. MUST 提供 Public Plugin SDK。
30. MUST 分离 Public / Experimental / Internal Plugin API。
31. MUST 为第三方 Plugin 定义 Manifest。
32. MUST 为第三方 Plugin 定义 Permission / Trust / Compatibility。
33. MUST 默认把第三方 Plugin 放入独立 Extension Host。
34. MUST 禁止第三方 Raw SQLite / Raw Runtime Context / Electron Main Access。
35. MUST 为第三方 Plugin 定义 eager / lazy。
36. MUST 为安装插件维护 revision / content hash。
37. MUST 使用 dependency-aware reload。
38. MUST 支持 Plugin degraded / disabled / quarantined 状态。
39. MUST 保持 Core / First-party Critical Plugin 不依赖 Third-party Plugin。
40. MUST 在迁移完成后删除旧技术架构和迁移适配层。

---

# 49. Codex SHOULD

1. SHOULD 使用 Hono 作为新 Runtime HTTP Host。
2. SHOULD 使用 Zod 定义 HTTP / Plugin / Runtime Schema。
3. SHOULD 使用 Cordis 作为 Plugin Kernel。
4. SHOULD 使用 `@dramaip/client` 作为统一 Client SDK。
5. SHOULD 使用 Bun 作为 Package Manager，但与 Runtime 选择解耦。
6. SHOULD 在 Electron Node 模式使用 `utilityProcess`。
7. SHOULD 在 Bun 模式使用独立 Bun sidecar。
8. SHOULD 参考 `desktop2` 的 Profile、Plugin API、Event、Migration、UI Contribution 和 EngineSupervisor。
9. SHOULD 对所有 Plugin 注册 API 返回 disposer 或自动 effect tracking。
10. SHOULD 支持 Bundle 作为官方功能组合和分发单位。
11. SHOULD 允许插件声明 `reloadPolicy`。
12. SHOULD 在插件更新失败时回滚上一可用 revision。
13. SHOULD 采用 Declarative UI First。
14. SHOULD 最后才建设 Marketplace。
15. SHOULD 保留现有 E2E 作为黑盒产品验收。

---

# 50. Codex MUST NOT

1. MUST NOT 把“在 desktop 重构”理解成“保留 desktop 当前技术架构”。
2. MUST NOT 把正式开发迁往 `desktop2`。
3. MUST NOT 新建 `desktop3`。
4. MUST NOT 为兼容永久保留旧 Effect / Server 架构。
5. MUST NOT 为兼容永久保留旧业务 IPC / RPC。
6. MUST NOT 把 `/api/v1` 或现有 `@sdns/*` 包边界视为不可改变。
7. MUST NOT 把 Electron Main 做成业务 Runtime。
8. MUST NOT 让 Renderer 直接访问数据库或 Plugin Runtime。
9. MUST NOT 把所有 Entity / Utility / Component 做成 Plugin。
10. MUST NOT 让 Kernel 变成新的 God Server。
11. MUST NOT 让 Plugin 导入其他 Plugin 的内部实现。
12. MUST NOT 给第三方万能 `ctx.internal`。
13. MUST NOT 给第三方 Raw SQLite。
14. MUST NOT 让第三方 Plugin 直接进入主 Renderer。
15. MUST NOT 在没有 Permission / Isolation 前运行任意第三方代码。
16. MUST NOT 让 Third-party Plugin 成为 Critical Core Dependency。
17. MUST NOT 让 Bundle 绕过 Plugin 级 Permission / Trust / Compatibility。
18. MUST NOT 覆盖插件文件后继续运行旧内存 revision。
19. MUST NOT 强迫所有插件支持 Hot Reload。
20. MUST NOT 强制 Vendor Engine 改用 HTTP。
21. MUST NOT 在 Core Runtime 内部拆成大量 localhost 微服务。
22. MUST NOT 因架构重构破坏成熟 DramaIP 产品功能。

---

# 51. 成功标准

最终 `desktop/` 应满足：

## C/S

```text
Desktop / Web / CLI
        │
       HTTP
        ▼
Core Runtime
```

并且：

```text
Core Runtime
    │ HTTP
    ├── Desktop Host
    └── Extension Host
```

---

## Runtime

```text
Headless
Desktop Mode
Server Mode
Node.js
Bun-compatible
HTTP API
SSE
OpenAPI
Server Connection Manager
```

---

## Plugin Platform

```text
Cordis Kernel
Reversible Effects
Plugin Dependency Graph
Bundle
Profile
Installed Extension Set
Plugin Migration
Persistent / Realtime Events
```

---

## Third-party

```text
Public Plugin SDK
Manifest
Permission
Trust
Compatibility
Extension Host
eager / lazy
revision / content hash
dependency-aware reload
crash recovery
quarantine
```

---

## Client

```text
Electron
Web
CLI
Automation
```

共享：

```text
OpenAPI
+
@dramaip/client
```

---

## Product

成熟 DramaIP：

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

不能因架构重构退化。

---

# 52. 最终 Architecture Decision Record

## Refactoring Repository

```text
desktop/
```

---

## Product Baseline

```text
current desktop product behavior
```

---

## Architecture Baseline

# HTTP Client / Plugin Runtime Architecture

---

## Architecture Reference

```text
desktop2
OpenCode
DeepSeek Harness
DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md
```

---

## Target C/S Model

```text
HTTP
REST
JSON
SSE
OpenAPI
```

---

## Target Runtime Model

```text
Core Runtime
=
Independent Node-compatible Service
+
Node.js baseline
+
Bun optional runtime
+
Desktop / Server dual mode
+
Server Connection Manager
```

---

## Target Composition Model

```text
Plugin
↓
Bundle
↓
Profile
+
Installed Extension Set
=
Effective Runtime Graph
```

---

## Target Plugin Model

```text
Cordis-style Platform Kernel
+
First-party Domain Plugins
+
Official Plugins
+
Public Third-party Plugin Platform
+
Reversible Effects
+
Explicit Loading / Reload Policy
```

---

## Target Third-party Model

```text
Core Runtime
      │ HTTP
      ▼
Extension Host
      │
Capability Broker
Permission / Trust / Isolation
      │
      ▼
Third-party Plugins
```

---

## Migration Philosophy

```text
Preserve product behavior
Replace technical architecture
```

---

## End State

`desktop/` 最终成为唯一正式 DramaIP Desktop / Runtime 主线：

# DramaIP HTTP Client / Plugin Runtime Platform

它既可以作为 Electron Desktop 运行，也可以作为独立后台 Server 运行，并提供完整的内部插件、官方插件和第三方插件生态。

`desktop2/` 最终仅作为：

```text
architecture reference
historical experiment
```

保留。
