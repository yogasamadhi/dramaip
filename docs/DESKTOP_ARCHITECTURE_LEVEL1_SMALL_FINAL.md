# 通用桌面软件架构说明：小型项目版

> Architecture Level 1  
> 适用对象：小型、单一产品目标、功能边界清晰、团队规模较小的桌面软件  
> 核心架构：**HTTP C/S + Core Runtime**  
> 插件系统：**不使用**

---

# 1. 架构定位

本架构用于小型桌面软件。

目标不是追求最大扩展性，而是：

- Client 与 Runtime 解耦；
- 架构清晰；
- Runtime 可独立运行；
- 保持后续可演进性；
- 避免 Electron Main 变成业务 Backend；
- 避免 Renderer 直接访问数据库、文件系统和外部服务；
- 不提前引入插件系统。

核心原则：

# Client != Runtime

以及：

# Client / Runtime Communication = HTTP

总体结构：

```text
Desktop Client
      │
      │ HTTP
      │ REST / JSON / SSE / OpenAPI
      ▼
Core Runtime
      │
      ├── Application Services
      ├── Domain Logic
      ├── Persistence
      ├── Background Tasks
      └── External Adapters
```

---

# 2. 适用场景

适合：

- 单人或小团队项目；
- 内部工具；
- 小型 AI 客户端；
- 小型知识库；
- 简单内容创作工具；
- 专用管理软件；
- MVP 到稳定产品早期阶段；
- 所有功能都由官方自己维护；
- 不需要第三方扩展；
- 不需要运行时动态装配业务能力。

当出现大量业务域、复杂 Provider、多人长期并行开发或明显模块生命周期问题时，应升级到 Level 2。

---

# 3. 总体架构

```text
┌─────────────────────────────────────────────┐
│                 Desktop Client              │
│                                             │
│ Electron / Tauri / Other Desktop Host       │
│ React / Vue / Svelte / Other UI             │
└──────────────────────┬──────────────────────┘
                       │
                       │ HTTP
                       │ REST / JSON
                       │ SSE
                       │ OpenAPI
                       ▼
┌─────────────────────────────────────────────┐
│                 Core Runtime                │
│                                             │
│ HTTP API                                    │
│ Application Services                        │
│ Domain Logic                                │
│ Repository / Persistence                    │
│ Background Tasks                            │
│ External Service Adapters                   │
└─────────────────────────────────────────────┘
```


# 4. Runtime 运行模型

本架构中的 Runtime 不是 Electron Main，也不是 Renderer 内的一段业务代码。

Runtime 的正式定义是：

> **独立于 Renderer 和 Electron Main 的 Node.js / Node-compatible 服务进程。**

桌面模式下，默认由 Electron Main 使用 `utilityProcess` 启动和监管：

```text
Electron Application
│
├── Main Process
│   ├── Window
│   ├── Runtime Supervisor
│   └── Native Host
│
├── Renderer Process
│   └── Desktop Client
│
└── Utility Process
    └── Core Runtime
        ├── HTTP Server
        ├── Application Services
        ├── Domain Logic
        ├── SQLite
        ├── Tasks
        └── Adapters
```

Runtime 本身必须满足：

```text
不 import Electron API
不依赖 BrowserWindow
不依赖 Renderer
可以 Headless 启动
可以独立测试
可以由普通 Node.js 启动
可以被 Web / CLI Client 连接
```

也就是说：

> **Electron 是 Runtime 的宿主方式之一，不是 Runtime 的技术依赖。**

推荐：

```text
Electron Main
   │
   │ supervise
   ▼
utilityProcess
   │
   └── Node.js Runtime
```

而不是：

```text
Electron Main
├── Window
├── HTTP Server
├── Database
├── Business Logic
└── Tasks
```

这样可以获得：

- Runtime 崩溃隔离；
- Runtime 独立重启；
- UI 不被 Runtime 崩溃直接拖垮；
- Headless 测试；
- 未来 Web / CLI 复用；
- 更清晰的资源与生命周期边界。

---

# 5. 物理进程模型

桌面模式默认：

```text
Electron Main
    │
    ├── Start Runtime via utilityProcess
    ├── Stop Runtime
    ├── Monitor / Restart Runtime
    └── Create Window
           │
           ▼
      Renderer Client
           │
           │ HTTP
           ▼
      Core Runtime
      (Node.js utilityProcess)
```

Electron Main 只负责宿主和监管；Runtime 独立承担 HTTP、业务、数据和任务。

---

# 6. HTTP 作为唯一业务边界

业务调用统一使用：

```text
REST + JSON + SSE + OpenAPI
```

禁止使用 Electron IPC 承载业务 API。

REST 负责：

```text
Command
Query
CRUD
Task Control
```

SSE 负责：

```text
任务进度
AI Token
后台任务状态
资源变化
Runtime 健康状态
```

WebSocket 不是默认方案，只有真正需要持续双向实时通信时才引入。

---

# 7. Core Runtime

小型项目不使用 Plugin Kernel。

推荐内部结构：

```text
runtime/
├── http/
├── application/
├── domain/
├── repositories/
├── services/
├── adapters/
└── tasks/
```

Application Layer 负责 Use Case、Workflow、Transaction Boundary。

Domain Layer 负责 Entity、Value Object、Business Rule、Domain Service。

Infrastructure / Adapter 负责 SQLite、Filesystem、AI Provider、Secret Store、Export 等具体实现。

---

# 8. Desktop Host

Desktop Host 负责：

```text
Window
Menu
Tray
Notification
Auto Update
Deep Link
Runtime Lifecycle
Native Dialog
Credential
Filesystem Capability
```

但不负责业务逻辑。

如果 Runtime 需要桌面原生能力，推荐通过本地 Host HTTP API：

```text
Runtime
   │ HTTP
   ▼
Desktop Host
```

Renderer 不直接绕过 Runtime 调 Main。

---

# 9. Renderer

Renderer 只负责：

```text
UI
Interaction
Presentation
UI State
HTTP Client
SSE Subscription
```

不得：

```text
直接访问数据库
直接调用 AI SDK
直接访问 Runtime 内部对象
直接获得明文 Credential
直接读写任意业务文件
```

---

# 10. 数据与状态

原则：

# Runtime is the source of truth.

推荐：

```text
SQLite / Runtime State
        │
        ▼
       HTTP
        │
        ▼
Client Cache
        │
        ▼
UI State
```

Renderer 中的 Zustand / Redux / React State 只管理 UI 状态和缓存，不作为业务事实源。

---

# 11. 长任务

统一抽象为 Task：

```text
queued
running
succeeded
failed
canceled
```

任务执行可以使用 Worker Thread、Utility Process、Child Process 或 Sidecar，不阻塞 Electron Main。

---

# 12. 推荐目录

```text
project/
│
├── apps/
│   └── desktop/
│       ├── main/
│       └── renderer/
│
├── packages/
│   ├── runtime/
│   ├── contracts/
│   ├── client/
│   ├── database/
│   ├── desktop-host/
│   └── ui/
│
├── docs/
├── scripts/
└── tests/
```

---

# 13. 安全原则

必须：

- Runtime 只监听 `127.0.0.1`；
- 本地 Client 使用随机启动 Token；
- Renderer 不获得数据库连接；
- Renderer 不获得明文 Credential；
- Renderer 不拥有任意 Node 权限；
- 外部输入必须做 Schema Validation；
- 文件系统访问经过明确 Capability。

---

# 14. 测试

至少包括：

```text
Unit Test
Runtime Integration Test
HTTP Contract Test
Electron E2E
```

关键功能应支持 Headless Runtime Test。

---

# 15. MUST

1. MUST 分离 Client 与 Runtime。
2. MUST 将 Runtime 运行在独立 Node.js / Node-compatible 服务进程中。
3. MUST 保持 Runtime 不依赖 Electron API。
4. MUST 使用 HTTP 作为业务通信边界。
5. MUST 保持 Runtime 可 Headless 启动。
6. MUST 保持 Renderer 不直接访问数据库。
7. MUST 保持 Renderer 不直接调用外部 Provider SDK。
8. MUST 保持 Desktop Host 不承载业务逻辑。
9. MUST 使用明确 HTTP Contract。
10. MUST 将长任务移出 Electron Main。
11. MUST 明确业务状态事实源。
12. MUST 保持模块依赖方向清晰。

---

### Runtime 独立运行补充约束

- MUST 保证 Core Runtime 可以在完全不启动 Electron 的情况下独立运行。
- MUST 支持至少一种 Headless / Server Mode 启动方式。
- MUST 将 Desktop Capability 视为可选环境能力，而不是 Runtime 启动硬依赖。
- MUST 在 Desktop Capability 不存在时返回明确的 CapabilityUnavailable，而不是使 Runtime 启动失败。

### Node.js / Bun 兼容补充约束

- MUST 保证 Core Runtime 在 Node.js 下完整可运行，Node.js 是默认兼容基线。
- MUST 保持 Core Runtime 代码不依赖 Electron API。
- MUST 不把 Bun-only API 直接扩散到业务代码中。
- MUST 在声明支持 Bun 时运行 Bun CI。
- MUST 保持 Node.js 与 Bun 使用同一套 HTTP Contract、数据模型和业务逻辑。

### Connection / Cleanup 补充约束

- MUST 通过 Server Connection Manager 统一处理 Runtime 连接、健康检查、版本检查和重连。
- MUST 让 Client 能连接已经存在的 Runtime，而不是只能启动自己的 Runtime。
- MUST 为所有长期资源提供确定性的 cleanup / dispose 路径。
# 16. SHOULD

1. SHOULD 使用 REST + JSON + SSE + OpenAPI。
2. SHOULD 使用 SQLite 作为 Local-first 默认数据库。
3. SHOULD 在 Electron 桌面模式下使用 `utilityProcess` 承载 Runtime。
4. SHOULD 允许同一 Runtime 使用普通 Node.js 方式 Headless 启动。
5. SHOULD 为外部依赖定义 Adapter。
6. SHOULD 使用类型安全 Client SDK。
7. SHOULD 保留未来 Web / CLI Client 的可能性。

---

### Node.js / Bun 兼容建议

- SHOULD 同时支持 Node.js 与 Bun 运行同一套 Core Runtime。
- SHOULD 在 Electron Desktop 的 Node 模式下使用 `utilityProcess`。
- SHOULD 在 Electron Desktop 的 Bun 模式下由 Runtime Supervisor 使用 `child_process.spawn()` 启动 Bun sidecar。
- SHOULD 将 Runtime-specific 能力封装到 NodeRuntimeAdapter / BunRuntimeAdapter。
- SHOULD 将 Package Manager 与 Runtime 作为两个独立技术决策。

### Connection Manager 建议

- SHOULD 提供 `/health`、`/version`、`/capabilities` 等基础端点。
- SHOULD 支持 explicit URL → existing local runtime → spawn local runtime 的连接策略。
# 17. MUST NOT

1. MUST NOT 引入插件系统，除非真实复杂度需要。
2. MUST NOT 使用 IPC 作为业务 API。
3. MUST NOT 把 Electron Main 做成 Backend。
4. MUST NOT 把 Renderer 做成业务层。
5. MUST NOT 为“未来可能需要”提前建设 Plugin Marketplace。
6. MUST NOT 把小项目设计成微服务系统。

---

# 18. 升级路径

当 Core Runtime 开始出现：

```text
模块数量快速增长
大量 Provider
复杂 Dependency
独立生命周期
不同 Product Profile
多人并行开发
```

升级到：

# Level 2：大型封闭项目版

即：

```text
HTTP C/S
+
Core Runtime
+
Internal Plugin Runtime
```

---


# 19. 独立 Server Mode

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

# 20. Desktop Capability 可选化

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


## Level 1 约束

小型项目不需要为了双 Runtime 支持额外引入插件系统。

Runtime Adapter 只用于少数 Runtime-specific 能力，不演化为 Plugin Kernel。


# Server Connection Manager

即使是小型项目，也应把“如何连接 Runtime”从具体 UI 中抽出来。

定义统一：

# Server Connection Manager

职责：

```text
discover
connect
authenticate
health
version
capabilities
reconnect
disconnect
```

标准启动流程：

```text
Desktop Client Start
        │
        ▼
Server Connection Manager
        │
        ├── Existing Runtime available?
        │       ├── Yes → attach
        │       └── No  → ask Runtime Supervisor to start local Runtime
        │
        ▼
Health / Version / Capability Check
        │
        ▼
Authenticated HTTP Client
```

最低必须支持：

```text
GET /health
GET /version
GET /capabilities
```

其中：

- `health` 判断 Runtime 是否可用；
- `version` 用于 Client / Runtime 兼容性检查；
- `capabilities` 告诉 Client 当前 Runtime 能提供哪些环境能力。

Desktop Client 不应假设：

```text
Runtime 永远由自己刚刚启动
```

而应该能够连接：

```text
已存在的本地 Runtime
后台运行的 Runtime
由用户手动启动的 Runtime
```

小型项目不需要复杂的网络发现协议。

默认发现顺序可以是：

```text
explicit URL
→ local saved endpoint
→ spawn local Runtime
```

---

# Resource Cleanup Rule

Level 1 不引入完整 Plugin Reversible Effect System，但所有长期资源都必须有明确释放路径。

例如：

```text
HTTP Listener
SSE Subscription
Timer
File Watcher
Worker
Child Process
Database Handle
```

初始化代码必须成对提供：

```text
start / stop
open / close
subscribe / unsubscribe
```

避免 Runtime Restart 后产生资源泄漏。

# 21. 最终模型
```text
Desktop / Web / CLI
        │
       HTTP
        │
   Core Runtime
        │
   Domain / App
        │
   Adapters / DB
```

对于小型桌面软件：

> **保持简单，先建立正确的 Client / Runtime 边界，不提前引入插件复杂度。**
