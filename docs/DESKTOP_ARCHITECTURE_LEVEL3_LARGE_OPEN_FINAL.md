# 通用桌面软件架构说明：大型开放项目版

> Architecture Level 3  
> 适用对象：大型开放平台、生态型桌面软件、允许第三方扩展的专业应用  
> 核心架构：**HTTP C/S + Core Runtime + Internal Plugins + Third-party Plugin Platform**

---

# 1. 架构定位

开放平台型桌面软件不仅需要内部可维护性，还需要：

```text
第三方开发
第三方安装
第三方扩展
权限隔离
版本兼容
插件生命周期
生态治理
```

因此采用：

# HTTP Client / Public Plugin Runtime Architecture

总体：

```text
Clients
   │
  HTTP
   ▼
Core Runtime
   │
Platform Kernel
   │
   ├── Internal Plugins
   └── Official Plugins
          │
          │ HTTP / Capability Broker
          ▼
    Extension Host
          │
          ▼
   Third-party Plugins
```

---

# 2. 适用场景

适合：

- AI 创作平台；
- IDE / Developer Platform；
- 内容生产平台；
- 知识工作平台；
- 专业设计工具；
- 数据分析平台；
- 自动化平台；
- 支持第三方 Provider / Tool / Workflow 的桌面产品；
- 希望建立插件市场或开发者生态的产品。

---

# 3. 与 Level 2 的区别

Level 2：

```text
HTTP C/S
+
Core Runtime
+
Internal Plugins
```

Level 3：

```text
HTTP C/S
+
Core Runtime
+
Internal Plugins
+
Public Plugin Platform
+
Third-party Plugin Isolation
+
Permission / Trust / Compatibility
```

最大变化：

> Plugin API 从内部工程 API 变成正式公共平台 API。


# 4. Runtime 与 Extension Host 运行模型

Level 3 必须明确区分两个独立运行时：

```text
Core Runtime
```

和：

```text
Third-party Extension Host
```

两者都应运行在独立 Node.js / Node-compatible 服务进程中。

推荐物理结构：

```text
Electron Application
│
├── Main Process
│   ├── Window
│   ├── Core Runtime Supervisor
│   ├── Extension Host Supervisor
│   ├── Native Host
│   └── Updater
│
├── Renderer Process
│   └── Desktop Client
│
├── Utility Process
│   └── Core Runtime
│       ├── HTTP Server
│       ├── Platform Kernel
│       ├── Internal Plugins
│       ├── Official Plugins
│       ├── Database
│       └── Events
│
└── Utility Process
    └── Extension Host
        ├── Third-party Plugin Runtime
        ├── Capability Proxy
        ├── Permission Enforcement
        └── Plugin Isolation
```

Core Runtime 默认由 Electron Main 使用 `utilityProcess` 启动和监管。

Extension Host 也推荐使用独立 `utilityProcess`。

Core Runtime 与 Extension Host 本身都不得依赖 Electron API。

必须可以：

```text
Headless 启动
独立测试
独立重启
由普通 Node.js 启动
```

关键原则：

> **Electron Main 是 Supervisor，不是业务 Runtime。**

以及：

> **Third-party Plugin 不运行在 Core Runtime 进程中。**

第三方插件崩溃时：

```text
Third-party Plugin
       ↓ crash
Extension Host
       ↓ degraded / restart
Core Runtime continues
       ↓
Desktop Client continues
```

Level 3 的进程隔离本身就是插件安全模型的一部分。

---

# 5. 总体架构

```text
┌────────────────────────────────────────────────────────┐
│                        Clients                         │
│                                                        │
│ Desktop / Web / CLI / Automation                       │
└────────────────────────────┬───────────────────────────┘
                             │
                             │ HTTP
                             │ REST / JSON / SSE
                             │ OpenAPI
                             ▼
┌────────────────────────────────────────────────────────┐
│                     Core Runtime                       │
│                                                        │
│  HTTP API                                              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                Platform Kernel                   │  │
│  │                                                  │  │
│  │ Plugin Graph / Lifecycle / Profile              │  │
│  │ Capability / Event / Permission / Diagnostics   │  │
│  └───────────────────────┬──────────────────────────┘  │
│                          │                             │
│          ┌───────────────┴───────────────┐             │
│          ▼                               ▼             │
│     Internal Plugins               Official Plugins   │
└────────────────────────────┬───────────────────────────┘
                             │
                             │ Local HTTP
                             │ Capability Broker
                             ▼
┌────────────────────────────────────────────────────────┐
│                    Extension Host                      │
│                                                        │
│ Permission Enforcement / Capability Proxy              │
│ Third-party Plugin Runtime                             │
└────────────────────────────┬───────────────────────────┘
                             │
                             ▼
                    Third-party Plugins
```

---

# 6. 核心原则

1. **Client != Runtime**
2. **Client / Runtime Communication = HTTP**
3. **Runtime != God Server**
4. **Everything Replaceable is a Plugin**
5. **Public Plugin API is a Product API**
6. **Third-party Plugin != Trusted First-party Code**
7. **Product Profile != User Extensions**

---

# 7. Plugin 类型

## Built-in Plugin

核心功能，随产品发布，可 In-process，可标记 Critical。

## Official Plugin

官方维护的扩展，可 In-process 或运行在 Extension Host。

## Third-party Plugin

第三方提供，默认：

```text
Out-of-process
Least Privilege
Explicit Permission
Version Checked
```

---

# 8. Platform Kernel

Kernel 负责：

```text
Plugin Resolver
Plugin Registry
Lifecycle
Dependency Graph
Profile
Installed Extension Set
Capability Registry
Permission Broker
Event Infrastructure
Migration Coordination
Diagnostics
Trust Evaluation
Extension Host Management
```

---

# 9. Product Profile

描述官方产品组成：

```text
Built-in
Official Required Plugins
Critical Plugins
Default Configuration
```

第三方不能修改。

---

# 10. Installed Extension Set

用户安装插件独立记录：

```json
{
  "plugins": [
    {
      "id": "com.example.my-plugin",
      "version": "1.2.0",
      "enabled": true
    }
  ]
}
```

最终：

```text
Product Profile
+
Installed Extension Set
=
Effective Plugin Graph
```

---

# 11. Plugin Package

推荐：

```text
my-plugin/
│
├── plugin.json
├── package.json
├── server/
├── ui/
├── migrations/
└── assets/
```

---

# 12. Plugin Manifest

必须包含：

```text
Identity
Version
Plugin API Version
Product Compatibility
Dependencies
Entrypoint
Permissions
Contributions
Configuration Schema
Migration Metadata
```

示例：

```json
{
  "id": "com.example.character-graph",
  "name": "Character Graph",
  "version": "1.0.0",
  "apiVersion": "1",
  "engines": {
    "app": ">=3.0.0 <4.0.0"
  },
  "permissions": [
    "project.read",
    "data.character.read"
  ]
}
```

---

# 13. Public Plugin SDK

第三方只能依赖：

```text
@product/plugin-api
@product/contracts
```

不能依赖：

```text
kernel/internal
runtime/internal
raw database
Electron Main
private Cordis Context
```

---

# 14. Public PluginContext

应该由 Capability 构成：

```text
PluginContext
│
├── projects
├── documents
├── data
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

禁止：

```ts
ctx.internal
ctx.database.raw
ctx.runtime.private
```

---

# 15. Capability / Permission

插件只能通过明确 Capability 使用平台。

例如：

```text
PROJECT_READ
PROJECT_WRITE
AI_INVOKE
NETWORK
FILESYSTEM_PLUGIN
FILESYSTEM_WORKSPACE_READ
FILESYSTEM_WORKSPACE_WRITE
CLIPBOARD
NOTIFICATION
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

# 16. Trust Level

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
Isolation
Permission Defaults
Native Access
Network Access
Warnings
Update Policy
```

---

# 17. Extension Host

第三方插件默认不运行在 Core Runtime 内。

结构：

```text
Core Runtime
     │
     │ HTTP
     ▼
Extension Host
     │
Capability Proxy
     ▼
Third-party Plugin
```

好处：

- 插件崩溃不直接拖垮 Runtime；
- 插件拿不到私有对象；
- Permission 更容易执行；
- 可以单独终止恶意插件。

---

# 18. Extension Host API

Extension Host 与 Runtime 使用本地 HTTP。

Runtime 负责：

```text
Capability Broker
Permission Check
Rate Limit
Plugin Identity
Audit
```

---

# 19. Third-party Database

禁止第三方：

```text
raw SQLite
修改 Core Table
任意 SQL
```

允许：

```text
Plugin-owned Storage
Namespaced Table
Public Domain API
```

---

# 20. Plugin Migration

第三方插件只能迁移自己的 Storage Namespace / Table。

必须记录：

```text
pluginId
version
checksum
executedAt
```

卸载时必须定义：

```text
Keep Data
Delete Data
Export Data
```

策略。

---

# 21. Internal Plugins

内部插件仍然遵循：

```text
Bounded Context
Replaceable Capability
```

第三方插件建立在这些公开 Capability 上。

---

# 22. Client API 与 Plugin API 分离

## Client API

面向：

```text
Desktop
Web
CLI
Automation
```

使用：

```text
HTTP + OpenAPI
```

## Plugin API

面向：

```text
Official Plugin
Third-party Plugin
```

使用：

```text
Plugin SDK
Capability Contract
```

两者不是同一个 API。

---

# 23. Plugin Route

第三方插件如需提供 HTTP Route：

推荐 namespace：

```text
/api/plugins/{pluginId}/...
```

避免污染核心 API。

---

# 24. OpenAPI

Runtime 应能构建 Effective OpenAPI，包括：

```text
Core API
Internal Plugin API
Official Plugin API
Third-party Plugin Route
```

并标记来源。

---

# 25. Event

第三方只能订阅：

```text
公开事件
+
已授权事件
```

不能监听私有 Event Bus。

---

# 26. UI Extension

开放顺序：

```text
Command
Menu
Settings
Declarative Panel
Sandboxed Interactive UI
```

---

# 27. Declarative UI

优先支持：

```text
Form Schema
Table Descriptor
Panel Metadata
Command
Toolbar
Menu
Setting
```

风险低、兼容性更容易维护。

---

# 28. Sandboxed UI

任意第三方交互 UI 不应直接注入主 Renderer。

可以使用：

```text
iframe sandbox
isolated webview
separate renderer
UI extension host
```

具体实现可变，但必须存在隔离边界。

---

# 29. Plugin Distribution

最终可支持：

```text
Local Install
Registry
Marketplace
Private Enterprise Registry
Git-based Install
```

安装来源必须经过：

```text
Manifest
Integrity
Compatibility
Permission
Trust
```

检查。

---

# 30. Plugin Signing

正式生态推荐支持：

```text
Signature
Publisher Identity
Hash Integrity
Verified Badge
```

---

# 31. Plugin Update

更新前检查：

```text
API Compatibility
Product Compatibility
Permission Change
Migration
Signature
```

权限扩大时必须重新提示用户。

---

# 32. Plugin Failure

插件崩溃：

```text
Third-party Plugin Crash
        ↓
Extension Host isolates
        ↓
Plugin degraded / unavailable
        ↓
Core Runtime continues
```

---

# 33. Core Critical Dependency

禁止：

```text
First-party Core Plugin
↓ depends on
Third-party Plugin
```

核心功能不能依赖用户可删除扩展。

---

# 34. Desktop Host

负责：

```text
Window
File
Credential
Notification
Updater
Runtime Supervisor
Extension Host Supervisor
```

Runtime 通过 HTTP 使用 Host Capability。

---

# 35. Engine / External Runtime

第三方 Agent Engine / Sidecar 可以继续自己的原生协议。

由 Adapter 隔离。

不要把：

```text
Plugin Platform
```

和：

```text
External Runtime Protocol
```

混为一谈。

---

# 36. Repository Structure

```text
project/
│
├── apps/
│   └── desktop/
│
├── packages/
│   ├── client/
│   ├── contracts/
│   ├── http/
│   ├── runtime/
│   ├── kernel/
│   ├── plugin-api/
│   ├── plugin-host/
│   ├── plugin-resolver/
│   ├── plugin-permissions/
│   ├── database/
│   ├── events/
│   ├── desktop-host/
│   ├── ui/
│   ├── ui-runtime/
│   └── ui-extension-host/
│
├── plugins/
│   ├── builtin/
│   └── official/
│
├── profiles/
│   ├── studio.json
│   ├── safe.json
│   ├── test.json
│   └── e2e.json
│
├── plugin-sdk/
│   ├── docs/
│   ├── templates/
│   └── examples/
│
└── tests/
```

---

# 37. 第三方插件开放顺序

推荐：

```text
Phase 1
Provider / Tool / Workflow / Exporter

Phase 2
Search / Integration / Data Capability

Phase 3
Command / Menu / Settings

Phase 4
Declarative Panel

Phase 5
Sandboxed Interactive UI

Phase 6
Registry / Marketplace
```

不要第一天就开放任意 UI 和 Native 权限。

---

# 38. 安全

必须：

- Core Runtime Loopback；
- Client Token；
- Extension Host 独立 Token；
- Permission Broker；
- Plugin Identity；
- Capability Audit；
- 无 Raw DB；
- 无 Raw Electron；
- 无 Raw Runtime Context；
- 文件系统分 Namespace；
- 网络显式权限；
- 插件隔离；
- Crash Boundary。

---

# 39. 测试

开放平台额外需要：

```text
Plugin SDK Compatibility Test
Manifest Validation Test
Permission Test
Isolation Test
Malicious Plugin Test
Migration Ownership Test
Plugin Crash Recovery Test
Plugin Update Test
Plugin Disable Test
Plugin Uninstall Test
```

---

# 40. Architecture Gates

自动检查：

```text
Private API Import
Raw Database Access
Missing Permission
Dependency Cycle
Manifest Invalid
API Version Conflict
Plugin Route Collision
Core -> Third-party Dependency
Unsafe UI Injection
Migration Namespace Violation
```

---

# 41. MUST

1. MUST 使用 HTTP Client / Runtime 边界。
2. MUST 将 Core Runtime 运行在独立 Node.js / Node-compatible 服务进程中。
3. MUST 将 Third-party Extension Host 运行在独立进程中。
4. MUST 保持 Core Runtime 与 Extension Host 不依赖 Electron API。
5. MUST 使用 Internal Plugin Runtime。
6. MUST 提供 Public Plugin SDK。
7. MUST 分离 Product Profile 与 User Extension Set。
8. MUST 为第三方插件定义 Manifest。
9. MUST 为第三方插件定义 Permission。
10. MUST 为第三方插件定义 Compatibility。
11. MUST 为第三方插件提供隔离。
12. MUST 禁止第三方 Raw Database。
13. MUST 禁止第三方 Raw Runtime Context。
14. MUST 保持 Core 不依赖 Third-party Plugin。
15. MUST 让 Plugin 可 Disable / Uninstall。
16. MUST 让 Plugin Failure 不拖垮 Core。
17. MUST 维护公共 Plugin API Version。
18. MUST 对第三方 UI 建立隔离边界。

---

### Runtime 独立运行补充约束

- MUST 保证 Core Runtime 可以在完全不启动 Electron 的情况下独立运行。
- MUST 保证 Third-party Extension Host 可以在完全不启动 Electron 的情况下独立运行。
- MUST 支持 Desktop Mode 与 Server Mode 使用同一套 Core Runtime 和 Plugin Platform。
- MUST 将 Desktop Capability 作为可选环境 Provider，不得作为平台启动硬依赖。

### Node.js / Bun 兼容补充约束

- MUST 保证 Core Runtime 在 Node.js 下完整可运行，Node.js 是默认兼容基线。
- MUST 保持 Core Runtime 代码不依赖 Electron API。
- MUST 不把 Bun-only API 直接扩散到业务代码中。
- MUST 在声明支持 Bun 时运行 Bun CI。
- MUST 保持 Node.js 与 Bun 使用同一套 HTTP Contract、数据模型和业务逻辑。
- MUST 分别管理 Core Runtime 与 Third-party Extension Host 的 Runtime Compatibility。
- MUST 要求第三方插件显式声明其支持的 JavaScript Runtime。

### 新增开放平台硬约束

- MUST 使用 Server Connection Manager 统一处理本地和远程 Runtime 的 discovery、版本协商、能力协商和重连。
- MUST 使用 Plugin → Bundle → Profile + Installed Extension Set 的组合模型。
- MUST 将 Reversible Effects 作为 Public Plugin SDK 的核心语义。
- MUST 禁止第三方插件产生平台无法追踪的长期副作用。
- MUST 为第三方插件定义 eager / lazy 加载策略。
- MUST 为已安装插件维护 revision / content hash。
- MUST 在插件 reload / update 时使用 dependency-aware reload plan。
- MUST 在插件反复崩溃时支持 degraded / disabled / quarantined 状态。
# 42. SHOULD

1. SHOULD 在 Electron 桌面模式下使用 `utilityProcess` 承载 Core Runtime。
2. SHOULD 使用独立 `utilityProcess` 承载 Extension Host。
3. SHOULD 允许 Core Runtime 与 Extension Host 使用普通 Node.js 方式 Headless 启动。
4. SHOULD 使用 Extension Host。
5. SHOULD 使用 Capability Broker。
6. SHOULD 支持 Plugin Signing。
7. SHOULD 支持 Trust Level。
8. SHOULD Declarative UI First。
9. SHOULD 分阶段开放能力。
10. SHOULD 提供 Example Plugin。
11. SHOULD 提供 Plugin CLI / Template。
12. SHOULD 建立兼容性测试矩阵。
13. SHOULD 最后才建设 Marketplace。

---

### Node.js / Bun 兼容建议

- SHOULD 同时支持 Node.js 与 Bun 运行同一套 Core Runtime。
- SHOULD 在 Electron Desktop 的 Node 模式下使用 `utilityProcess`。
- SHOULD 在 Electron Desktop 的 Bun 模式下由 Runtime Supervisor 使用 `child_process.spawn()` 启动 Bun sidecar。
- SHOULD 将 Runtime-specific 能力封装到 NodeRuntimeAdapter / BunRuntimeAdapter。
- SHOULD 将 Package Manager 与 Runtime 作为两个独立技术决策。

### 开放平台加载策略建议

- SHOULD 允许插件声明 hot / restart-extension-host / restart-runtime 等 reloadPolicy。
- SHOULD 在插件更新失败时自动回滚到上一可用 revision。
- SHOULD 让 Bundle 可以分发，但 Bundle 不得绕过插件级权限与兼容性检查。
- SHOULD 仅在产品确实需要时引入完整 Client-side Plugin Runtime。
# 43. MUST NOT

1. MUST NOT 把内部 Plugin API 原样暴露给第三方。
2. MUST NOT 给第三方万能 Context。
3. MUST NOT 让第三方插件直接进入主 Renderer。
4. MUST NOT 让第三方插件直接访问 Electron Main。
5. MUST NOT 让第三方修改 Core Tables。
6. MUST NOT 让 Third-party 成为 Critical Core Dependency。
7. MUST NOT 在没有 Permission Model 前开放插件。
8. MUST NOT 在没有 Isolation 前运行任意第三方 Node 代码。
9. MUST NOT 一开始就开放所有 Extension Point。
10. MUST NOT 把 Marketplace 当成 Plugin Platform 本身。

---

# 44. 与 Level 2 的共同点

两者共同拥有：

```text
HTTP C/S
Core Runtime
Plugin Kernel
Internal Plugins
Profile
Capability
Event
Migration
UI Contribution
```

Level 3 只是额外增加：

```text
Public SDK
Third-party
Permission
Trust
Isolation
Compatibility
Distribution
```

因此 Level 2 可以平滑升级到 Level 3。

---


# 45. 独立 Server Mode

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

# 46. Desktop Capability 可选化

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


## Extension Host 的 Server Mode

Level 3 在不启动 Electron 时，第三方插件平台仍然可以运行：

```text
systemd / Windows Service / launchd
              │
              ├── Core Runtime
              │      │
              │     HTTP
              │      ▼
              └── Extension Host
                     │
                     └── Third-party Plugins
```

因此：

```text
Core Runtime
```

和：

```text
Extension Host
```

都必须能够脱离 Electron 独立运行。

Electron Main 在 Desktop Mode 中只是它们的 Supervisor。

在 Server Mode 中，可以由：

```text
systemd
Windows Service
launchd
Docker / Process Supervisor
CLI Parent Process
```

负责生命周期管理。

## Platform Profile

推荐至少存在：

```text
desktop profile
server profile
safe profile
test profile
e2e profile
```

`server profile` 不装载 Desktop-only Capability，但可以继续装载：

```text
Internal Plugins
Official Plugins
Third-party Plugins
Extension Host
HTTP API
Event System
Database
Background Tasks
```

从而使开放平台能够作为真正的后台服务长期运行。


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


## Level 3 约束

Core Runtime 和 Third-party Extension Host 的 Runtime Compatibility 必须分别管理。

推荐：

```text
Core Runtime
=
Node.js + Bun
```

第三方 Extension Host 默认以：

```text
Node.js
```

作为最稳定兼容基线。

只有当 Public Plugin SDK 明确声明 Bun Compatibility 后，才允许：

```text
Extension Host Runtime = Bun
```

第三方插件 Manifest 可增加：

```json
{
  "runtime": {
    "supported": ["node", "bun"]
  }
}
```

平台必须在安装和启用前检查兼容性。

核心原则：

> **Core Runtime 可以双运行时，第三方插件运行时兼容性必须显式声明，不能猜测。**


# Server Connection Manager

Level 3 的 Client 不应该默认 Runtime 与自己在同一台机器。

正式定义：

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

标准连接模型：

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

Runtime 至少暴露：

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
profile
bundles
plugins
capabilities
extensionHostStatus
```

Client 必须能识别：

```text
Client / Runtime version incompatible
required capability missing
plugin API incompatible
server degraded
extension host unavailable
```

而不是连接成功后再随机报错。

---

# Bundle Layer

Level 3 正式采用：

```text
Plugin
  ↓
Bundle
  ↓
Profile
  +
Installed Extension Set
```

定义：

## Plugin

最小可装载能力单元。

来源可以是：

```text
Built-in
Official
Third-party
```

## Bundle

可分发、可复用的插件组合。

例如：

```text
writing-suite
├── writing
├── knowledge
├── revision
└── style-tools
```

Official Bundle 可以由官方发布。

Third-party Bundle 也可以存在，但不能绕过单个 Plugin 的：

```text
Manifest
Permission
Compatibility
Trust
```

Bundle 只是组合，不自动继承更高权限。

## Profile

官方产品运行形态。

例如：

```text
studio
server
safe
enterprise
```

最终有效运行图：

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

---

# Reversible Effects

Level 3 将 Reversible Effect 作为 Plugin SDK 的核心语义。

所有注册 API 必须返回 disposer，或由 SDK 自动跟踪：

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

Plugin SDK 推荐提供：

```ts
ctx.effect(() => {
  const resource = acquire()
  return () => release(resource)
})
```

Kernel / Extension Host 必须：

- 自动记录 effect ownership；
- 激活失败时自动 rollback；
- deactivate 时逆序释放；
- crash recovery 后清理残留资源；
- reload 前完成旧 revision 的 effect cleanup。

原则：

# No untracked long-lived side effects.

第三方插件不得创建平台无法识别和清理的长期资源。

---

# Plugin Loading Policy

Level 3 必须正式定义公共加载策略。

每个插件 Manifest 可以声明：

```text
load:
  eager
  lazy
```

以及：

```text
revision
contentHash
dependencies
optionalDependencies
runtimeCompatibility
```

## Eager

启动 Runtime / Extension Host 时立即加载。

适合：

```text
critical platform extension
global integration
always-on provider
```

## Lazy

只有首次请求 Capability / UI Contribution 时加载。

适合：

```text
large optional integration
rarely used exporter
specialized tool
```

---

# Revision / Content Hash

每个已安装插件必须有可验证 revision。

推荐：

```text
plugin id
version
content hash
publisher/signature
```

Runtime 不应仅依赖：

```text
version string
```

判断插件是否发生变化。

---

# Dependency-aware Reload

插件更新或 reload 时必须计算影响图：

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
6. reactivate dependencies/dependents
7. run health checks
8. rollback if activation fails
```

禁止：

```text
覆盖磁盘文件后直接继续运行旧内存实例
```

---

# Hot Update Policy

正式产品不要求所有插件都支持零停机热更新。

插件可以声明：

```text
reloadPolicy:
  hot
  restart-extension-host
  restart-runtime
```

平台根据插件能力选择：

```text
hot reload
Extension Host restart
Core Runtime restart
```

而不是强迫所有插件支持热更新。

---

# Crash Recovery

第三方插件崩溃时：

```text
Plugin Crash
   ↓
Extension Host identifies owner
   ↓
cleanup tracked effects
   ↓
mark plugin degraded
   ↓
restart plugin or extension host
   ↓
dependency-aware health check
```

重复崩溃应进入：

```text
disabled / quarantined
```

状态。

---

# Client-side Plugin Tree：有意简化

本通用架构不要求像 DeepSeek Harness 一样把整个 Renderer 都变成完整 Plugin Runtime。

默认保留：

```text
Stable UI Shell
+
Contribution Registry
+
Sandboxed Third-party UI
```

只有当产品本身高度依赖动态 UI Composition 时，才可进一步引入：

```text
Client-side Plugin Runtime
```

这是可选高级能力，不是 Level 3 的强制基础设施。

# 47. 最终模型
```text
               Clients
                  │
                 HTTP
                  │
             Core Runtime
                  │
            Platform Kernel
        ┌─────────┼───────────┐
        │         │           │
   Internal    Official   Extension Host
   Plugins     Plugins         │
                              ▼
                         Third-party
                           Plugins
```

对于大型开放项目：

> **插件不仅是内部架构手段，而是产品生态的一部分。**
