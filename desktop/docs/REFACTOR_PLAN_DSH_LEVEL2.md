# DramaIP Desktop 重构计划：迁移到基于 DSH 的 Level 2 架构

> 文档类型：Refactor Plan（提议，未开始）
>
> 日期：2026-10-27
>
> 目标架构：[基于 DSH 的应用架构](../../docs/architecture/desktop/DESKTOP_ARCHITECTURE_BASELINE.md) + [Level 2 大型封闭项目](../../docs/architecture/desktop/DESKTOP_ARCHITECTURE_LEVEL2_LARGE_CLOSED_FINAL.md)
>
> DSH 参照：`vendor/deepseek-harness`（锁定版本 `0.2.1-rc.3`，MIT）

本文是计划，不是实现记录。文中“目标形态”的内容都还没有实现；现状以代码为准。

---

# 0. 目标、范围与非目标

**目标**：把 `desktop/` 重构为一个 Level 2 大型封闭应用——完全参照 DSH 架构，只直接复用 DSH 的 Cordis 框架包（现有 9 个），HTTP、Remote、浏览器启动、UI 基座、存储、凭据等基础设施由 DramaIP 自己的组件提供：按 DSH 对应包的设计编写，可从 DSH 源码复制改写（MIT，保留许可声明）。在其上由第一方业务插件、组合包与 Profile 组合出产品形态。

**范围**：

- `desktop/` 的进程模型、启动器、Host、API、浏览器 UI、存储、凭据、Engine 与测试门禁。
- 现有功能平移到新架构，用户数据可无损迁入。

**非目标**：

- 不在重构期间新增产品功能；功能冻结范围以外的修复照常进行，但只落在新结构上。
- 不改动 `platform/`，不在 Desktop 与 Platform 之间新增依赖。
- 不在 DSH 上做二次开发：不以 DSH 仓库或 `dsh` CLI、`apps/*`、DSH 组合包与 Profile 为起点修改。DramaIP 的启动器、壳、Host、基础设施组件、业务插件与 UI 都是自己的代码；DSH 只以两种方式进入：Cordis 框架包作为库依赖，其余参照 DSH 编写或按 MIT 复制改写（基线 §1.3）。不依赖任何 `dsh-*` 包。
- 不修改 `vendor/*`；框架包从锁定快照构建，复制改写的代码放在 `desktop/` 自有包中。
- 不开放第三方插件（Level 3 的内容）：不编写插件管理组件，不提供 `plugin` 命令。

---

# 1. 现状（3.0.0-alpha.3）

## 1.1 进程与通信

```text
Electron Main（apps/desktop/electron，约 25.7k 行）
├── application-supervisor / supervision / windows
├── core-runtime：拉起独立 Core Runtime（Electron Node）
├── local-credential-vault（safeStorage 加密）/ credential-capture / codex-auth-bootstrap
├── engines/：EngineSupervisor 管理 Pi / Codex / LangGraph.js
├── extensions/：QuickJS/WASM 扩展宿主进程与其监督器
├── host/：媒体渲染、ffprobe、NLE 拷贝、字幕、音频、字体
├── document-import / migration-worker
└── preload-v3

Core Runtime（packages/runtime，约 82k 行）
└── HTTP /api/v2：Hono + @hono/zod-openapi，RFC 7807、ETag/If-Match、
    Idempotency-Key、游标分页、SSE；OpenAPI 745 个操作 / 539 条路径

Desktop Host（packages/desktop-host）
└── HTTP /host/v1：Main 侧本机能力的 HTTP 外观
```

## 1.2 内核与插件

- `packages/kernel`：产品图、`provideService` / `requireService`、`RouteContribution` 注册表、`partialReload` 协调器、`.last-good.json` 恢复。
- 已经使用 DSH 的 9 个 Cordis 框架包（cosmokit、cordis、loader、include、group、schemastery、timer、hmr、logger-console），由 `prepare:framework` / `build:framework` 从 vendor 构建；没有使用任何 `dsh-*` 包。这与目标一致：目标同样只依赖这 9 个框架包。
- 15 个业务插件目录：

| 插件             | 行数   | 路由 | 表  |
| ---------------- | ------ | ---- | --- |
| production       | 31 307 | 57   | 34  |
| knowledge        | 12 260 | 77   | 28  |
| agents           | 10 771 | 57   | 31  |
| media            | 8 491  | 85   | 22  |
| automation       | 8 483  | 53   | 18  |
| workspace        | 7 958  | 72   | 21  |
| timeline         | 6 585  | 44   | 8   |
| writing          | 6 045  | 56   | 9   |
| creative-quality | 6 035  | 22   | 11  |
| delivery         | 5 097  | 5    | 6   |
| insights         | 3 944  | 29   | 19  |
| review           | 2 813  | 23   | 5   |
| system           | 2 763  | 31   | 10  |
| foundation       | 53     | 0    | 0   |
| legacy-bridge    | 0      | 0    | 0   |

- 组合包与 Profile：

| 组合包             | 插件                                          |
| ------------------ | --------------------------------------------- |
| `core`             | foundation、system、workspace                 |
| `writing-suite`    | writing、knowledge、creative-quality          |
| `agents-suite`     | agents                                        |
| `automation-suite` | automation                                    |
| `production-suite` | production、media、timeline、review、delivery |
| `analytics-suite`  | insights                                      |

| Profile  | 组合                         |
| -------- | ---------------------------- |
| `studio` | 全部组合包                   |
| `server` | 全部组合包                   |
| `e2e`    | 全部组合包，`deterministic`  |
| `safe`   | 只有 `core`                  |
| `test`   | 只有 `core`，`deterministic` |

## 1.3 数据

- `packages/database` 基于 `node:sqlite` 的 `DatabaseSync`；全仓 222 条 `CREATE TABLE`，迁移由各插件拥有且不可变。
- `SqliteUnitOfWork` 提供跨表事务；`ctx.domainEvents` 是持久领域事件，带游标、upcaster 与 checkpoint，经 SSE 重放给客户端。

## 1.4 浏览器 UI

- `packages/app`（`@dramaip/ui` 渲染器，约 108k 行，176 个顶层源文件/目录），由 electron-vite 以 `packages/app` 为 renderer root 构建。
- 技术栈：React 18.3.1、react-router-dom、@tanstack/react-query、zustand、Tailwind 4、Radix、shadcn、cva、tailwind-merge、sonner、tiptap、lucide。
- `packages/client`（`@dramaip/client`，约 186k 行）是从 OpenAPI 生成的 openapi-fetch 客户端。

## 1.5 其他包与遗留

- 有内容的包：contracts 27.4k、ai 4.7k、desktop-host 4.3k、database 2.3k、extension-host 1.3k、ui（`@dramaip/ui-shared`）1.1k、http 1.1k、kernel 0.9k、plugin-api 0.5k，以及 server-connection、events、bundles、runtime-adapters、agent-runtime、ui-runtime。注意 `packages/ui` 的包名是 `@dramaip/ui-shared`，而同名目录 `packages/ui-shared` 是空的。
- 空目录：`packages/{ai-legacy,client-v3,core,db,engine-runtime,export,mcp,protocol,schema,server,tasks,ui-shared}`、`plugins/legacy-bridge`。
- 生成物与门禁：`plugins:generate`、`architecture:generate`、`migration:generate`、`check:generated`、`check:architecture`、`check:migration:complete` 等 61 个脚本。

## 1.6 与目标架构的主要差距

| 方面     | 现状                                      | 目标（基线 / Level 2）                                       |
| -------- | ----------------------------------------- | ------------------------------------------------------------ |
| 内核     | 自有 `packages/kernel`、RouteRegistry     | 只有 Cordis 树，无特权内核（基线 MUST 1）                    |
| 进程     | Main + Core Runtime + /host/v1 + 扩展宿主 | Main（壳）+ 一个私有 Host 子进程（基线 §5.1）                |
| Main     | 拥有引擎监督、凭据库、媒体能力、扩展宿主  | 只拥有窗口、协议、更新与恢复（基线 MUST NOT 3）              |
| API      | Hono /api/v2 + OpenAPI 生成客户端         | `@Remote` / `@RemoteScope` + 生成 descriptor 与 codec        |
| 传输     | 每个服务一个 HTTP 面                      | 一个 Host、一个端口、页面 + 插件脚本 + API（基线 MUST 8）    |
| UI       | 单体 React 应用、Tailwind/Radix/shadcn    | 客户端插件经 Slots 组合，CSS Modules + 主题 token（MUST 12） |
| 存储     | node:sqlite 关系表 + UnitOfWork           | 存储组件的 `ctx.storage` + `defineDomain`（基线 §8.1，D1）   |
| 凭据     | Main 中 safeStorage 加密库                | 凭据组件的 `ctx.credentials` 与可替换提供方（D2）            |
| Engine   | Main 中 EngineSupervisor                  | `ctx.engines` 的 Provider 插件，进程经 `ctx.subprocess`      |
| Profile  | `safe` / `test` / `e2e` 是独立 Profile    | 只有 `web` / `headless` / `desktop`，其余是 overlay          |
| 扩展     | QuickJS 扩展平台与市场                    | Level 2 不开放安装                                           |
| 基础设施 | Hono、OpenAPI 生成链、自有 Kernel         | `packages/infra/*` 组件，参照 DSH 对应包（基线 §1.2）        |
| 主目录   | Electron userData                         | `DRAMAIP_HOME`，默认 `~/.dramaip`                            |

---

# 2. 目标形态

```text
desktop/
├── apps/
│   ├── cli/                 # @dramaip/cli：启动器（复制改写 DSH runProfile）
│   ├── desktop/             # Electron 壳：窗口、dramaip-app:// 协议、更新、恢复
│   └── web/                 # Vite Web 壳：引导 __DRAMAIP_BOOT__ 与渲染器根
├── packages/
│   ├── infra/               # 基础设施组件 @dramaip/infra-*（见下表）
│   ├── boot/                # bundle-base、bundle-web、bundle-headless
│   ├── seams/               # engines、媒体能力等业务层 Service Definition
│   ├── engines/             # engine-pi、engine-codex、engine-langgraph
│   ├── host/                # 本机能力插件：media-render、ffprobe、nle、document-import
│   ├── <domain>/            # 每个业务域：<domain>（Host face）、<domain>-client（Client face）
│   └── ui/                  # 产品 UI：品牌、首页布局、跨域共享的产品控件
├── profiles/                # 应用自己的 Profile 模板：web、headless、desktop
└── tests/                   # 组合、Profile 快照、Electron E2E
```

- 包名 `@dramaip/<group>-<pkg>`（Level 2 §3.1）；每个包在 `package.json` 声明 `dramaip.profile` / `dramaip.bundle.patch` / `dramaip.client`。
- 运行时只有一个 Host 进程运行 `desktop` Profile；Electron 主进程以 `ELECTRON_RUN_AS_NODE=1`、`--expose-internals` 拉起它，监听 `127.0.0.1` 系统分配端口，只经 Node IPC 与 Main 通信。
- `prepare:framework` / `build:framework` / `check:framework` 仍只处理 9 个框架包；新增依赖检查，拒绝框架包以外的 `@deepseek-ai/*` 依赖。

基础设施组件（`packages/infra/*`，沿用 DSH 的 `ctx` 服务键与契约，按依赖闭包挂载）：

| 组件                                                                    | 参照的 DSH 包                                                                                 | 说明                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `infra-boot`                                                            | `dsh-app-boot`、`dsh-home-paths`、`dsh-launch-environment`、`dsh-cmdline`、`dsh-http-proxy`   | Profile 装载、patch 叠加、`profileContext`、命令行与代理      |
| `infra-hmr`                                                             | `dsh-hmr`                                                                                     | 配置 HMR，基于框架的 HMR 与 Timer                             |
| `infra-settings`                                                        | `dsh-settings`、`dsh-config-editor`                                                           | 设置分节与配置编辑                                            |
| `infra-webserver`                                                       | `dsh-host-webserver`                                                                          | `ctx.webServer`                                               |
| `infra-web-runtime`                                                     | `dsh-web-app`、`dsh-host-frontend-static`                                                     | Web 启动参数与静态页面                                        |
| `infra-connection`                                                      | `dsh-client-connection`                                                                       | 令牌换签名 cookie、Host/Origin 信任、Peer                     |
| `infra-typert`、`infra-gateway`、`infra-remotes`、`infra-remote-access` | `dsh-typert-*`（含 generator）、`dsh-api-gateway`、`dsh-api-remotes`、`dsh-api-remote-access` | `@Remote`、descriptor/codec 生成、`/api` 与 `/api/remote.mux` |
| `infra-client-modules`、`infra-client-hmr`                              | `dsh-client-modules`、`dsh-client-hmr`                                                        | `/plugins` 与开发期热更新                                     |
| `infra-client-web`                                                      | `dsh-client-web`                                                                              | 浏览器两阶段启动                                              |
| `infra-ui-*`、`infra-locale`                                            | `dsh-client-ui-slots/renderer/theme/primitives/layout`、`dsh-client-locale`                   | Slots、唯一 React 根、主题 token、控件、文案                  |
| `infra-storage`                                                         | `dsh-storage`、`dsh-storage-domain`、`dsh-storage-sqlite`                                     | 文档型领域 + 关系型后端（D1）                                 |
| `infra-credentials`                                                     | `dsh-credentials`、`dsh-credentials-local`                                                    | `ctx.credentials` 与提供方（D2）                              |
| `infra-subprocess`                                                      | `dsh-subprocess`、`dsh-subprocess-local`                                                      | `ctx.subprocess`                                              |

基础设施组件不含 DramaIP 的产品内容；复制时把 DSH 的包字段、home 变量、cookie 前缀、启动全局变量、Profile 模板与组合包目录换成 DramaIP 的（基线 §1.3）。

---

# 3. 关键决策

每条决策在 P0 阶段确认；标注“需批准”的项会改变用户可见行为。

## D1 存储

**问题**：DSH 的 SQLite 存储是每条记录一行的文档模型，没有跨表事务、二级索引和多段键；DramaIP 有 222 张表、跨表事务与按外键和时间的查询。

**方案**：`infra-storage` 参照 DSH storage 编写 `ctx.storage` 与 `defineDomain`，并提供两类后端（基线 §8.1 已允许）：

1. 文档型领域（设置、单文档状态、UI 偏好、缓存）沿用 DSH 的记录模型。
2. 关系型领域由 `node:sqlite` 后端提供：领域声明自己的表与不可变前向迁移，写入经事务提交，查询以只读投影公开。现有 `packages/database`、表结构、迁移与 `SqliteUnitOfWork` 迁入这个后端。

每个领域仍由唯一插件声明和写入，格式只以版本命名的后继代际演进。

## D2 凭据

**问题**：DSH 的本地凭据提供方把凭据存为 home 下的私有明文文件；DramaIP 现在用 Main 中的 Electron safeStorage 加密。

**方案**：`infra-credentials` 参照 DSH credentials 提供 `ctx.credentials`，带两个提供方：Desktop 用 safeStorage 提供方，加解密请求经一条专用 Node IPC 通道交给 Main，Main 只做加解密、不接触业务；Web/headless Profile 没有 Main，用本地文件提供方。配置与 Remote 只携带 `CredentialRef`。

## D3 API：从 /api/v2 到 Remote

745 个 OpenAPI 操作不能一次重写。

- **过渡**：`@dramaip/compat-api-v2` 插件把现有 Hono 路由器挂在 `ctx.webServer` 的 `/api/v2` 前缀下，经 `infra-connection` 的 Host/Origin 检查与签名 cookie 认证。它是过渡插件，带删除期限，不接受新路由。
- **收敛**：按业务域（§4 的 P4/P5）把路由改写为该域 controller 包的 `@Remote` 方法，Client face 使用 `infra-typert` 生成的 descriptor 与 codec；改完一个域即从 compat 插件移除该域的路由。
- ETag/If-Match 与 Idempotency-Key 改为 Remote 方法参数中显式的版本比较与幂等键，由 Host face 校验；SSE 改为 Remote 的 baseline + 增量流。
- `packages/client`（生成的 openapi-fetch 客户端）、`server-connection` 与 OpenAPI 生成链在最后一个域迁移后删除。

## D4 浏览器 UI

- **过渡**：`@dramaip/legacy-studio-client` 是一个客户端插件，在 `infra-ui-renderer` 的根 Slot 里渲染现有 React 应用，因此 React 根仍只有渲染器包挂载一个；它继续使用 compat API。
- **收敛**：按业务域把页面拆成 `<domain>-client` 插件，经 Slots 注册，样式改为 CSS Modules + `clsx` + 主题 token，控件使用 `infra-ui-primitives`，文案进入各插件的类型化语言字典。
- Tailwind、Radix、shadcn、cva、tailwind-merge 在最后一个页面迁移后删除；react-query、zustand 由 Client model 取代（Client model 不复制业务真相）。tiptap 等特定编辑器可作为单个功能插件内部的依赖保留，lucide 图标可保留或改为 UI 基座提供的图标。
- react-router 由渲染器的导航 Slot 取代；深链接路径在迁移期保持不变。

## D5 Engine

- 在应用自有 `@dramaip/seams-engines` 中定义 `ctx.engines`（基线 §9.1）。
- Pi、Codex、LangGraph.js 各成为一个 Provider 插件，分别放在 `bundle-engine-pi` / `bundle-engine-codex` / `bundle-engine-langgraph`；外部进程经 `ctx.subprocess` 启动，进程登记在 effect 中。
- EngineSupervisor 从 Main 移到 Host 侧的插件中，Main 不再监督引擎。
- Codex 登录引导（`codex-auth-bootstrap`）归 Codex Engine 插件所有；需要原生窗口时经壳桥接请求 Main。
- 现有 `packages/ai`（ai-sdk / langgraph 适配）与 `packages/agent-runtime` 拆入对应 Engine 插件。参照 DSH Agent 栈另写 Engine，或把独立安装的 DSH 作为外部进程 Engine，都不在本计划内。

## D6 Profile 与组合包

| 现在                          | 之后                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `studio`                      | `desktop`（由 `web` 模板初始化，Desktop 独占）                                                 |
| `server`                      | `web`（浏览器访问）与 `headless`（一次性运行）                                                 |
| `safe`                        | `--patch overlays/safe.yml`：禁用可选业务域组合包条目                                          |
| `test` / `e2e`                | `--patch overlays/test.yml` / `overlays/e2e.yml`：`deterministic` 等确定性设置                 |
| `core`                        | 并入 `bundle-base`（foundation 合并进 system）                                                 |
| `writing-suite` 等 5 个 suite | `bundle-writing`、`bundle-agents`、`bundle-automation`、`bundle-production`、`bundle-insights` |

每个 Profile 的 `--dump-config` 进入快照测试（Level 2 §3.3）。

## D7 扩展平台

Level 2 不开放安装。QuickJS/WASM 扩展宿主、Extension Graph、市场、`extension:*` 脚本与 `check:extension-packages`、`test:extension-*`、`test:marketplace` 全部删除。已有用户扩展的数据保留在原位置不动，不再加载；发布说明写明这一点。

## D8 本机能力（/host/v1）

- 媒体渲染、ffprobe、NLE 拷贝、字幕、音频、字体、文档导入各成为 Host 侧插件（`packages/host/*`），外部二进制经 `ctx.subprocess`。
- 文件访问授权、原生打开/保存对话框需要 Main：经 preload 暴露的壳桥接（只有壳动作，没有业务方法）请求 Main，结果作为路径或授权句柄交回 Host。
- `packages/desktop-host` 与 `/host/v1` 在 P3 删除。

## D9 用户数据迁移

- `DRAMAIP_HOME` 默认 `~/.dramaip`（启动器负责，基线 MUST 5）；Profile 在 `~/.dramaip/profiles/desktop`。
- 首次启动新版本时，一个迁移插件把旧 Electron userData 中的数据库、凭据库与项目包**复制**进新位置，并写入完成标记；旧文件不移动、不删除（基线 MUST NOT 10）。迁移失败时显式报错并保持旧数据可用。
- 凭据在 D2 选定的 Provider 中重新加密存储。

## D10 领域事件

- 持久领域事件改为应用存储（D1）中的 outbox 表，消费方以 checkpoint 读取，upcaster 保留。
- 跨插件通知使用 Cordis 类型化事件（声明合并，文档化 `@mode`）；对客户端的推送经 `$events` allowlist 与 Remote 增量流，不再使用 SSE。

## D11 内核与恢复

- `packages/kernel`、`RouteContribution` 注册表、`partialReload` 协调器全部由 Cordis + Loader/Include/Group + `infra-hmr` 取代。
- `.last-good.json` 恢复改为：Host 无法启动时由 Electron 壳的原生恢复界面提供“以 safe overlay 启动”与“备份并重置 Profile patch”；`--dump-config` 快照保证组合可审查。

---

# 4. 阶段

## 4.1 总体规则

- 阶段严格按顺序：P0 → P1-a → P1-b → P2 → P3 → P4 → P5 → P6。P4-a 可在 P2 完成后先在 `web` Profile 上开发，但要等 P3 完成才能退出。
- 每个阶段由一组合并请求组成；阶段之间不并行改同一组文件。
- 一个阶段**退出**的条件是：§7 的通用门禁全部通过，该阶段“验收”中每一步都有可重复执行的证据（命令输出、测试名或快照），并且维护者在合并请求中逐项确认。
- 用户可见的切换只有 P3 一次。P3 发布之前，用户使用的仍是现有 Desktop（Electron Main + Core Runtime）；P0–P2 的新结构只在开发与测试中运行。

| 阶段完成后 | 用户实际运行的 Desktop | 新结构的运行方式                    |
| ---------- | ---------------------- | ----------------------------------- |
| P0–P1      | 现有 Desktop           | CLI 启动 `web` / `headless` Profile |
| P2         | 现有 Desktop           | `web` Profile 跑通全部现有功能      |
| P3 起      | 新 Electron 壳 + Host  | `desktop` Profile                   |

## 4.2 P0 准备

**交付物**

- 本文 §3 的 D1–D11 逐条标记“已确认”或给出修改。
- 逐个基础设施组件决定从 DSH 复制改写还是自写；默认复制改写，连同 DSH 对应的测试。
- 删除空目录（§1.5）与 `plugins/legacy-bridge`。
- 新增 `check:deps`：拒绝 Cordis 框架包以外的 `@deepseek-ai/*` 依赖。
- 把现有 `check:architecture` 中仍然有效的所有权门禁迁成不依赖 Kernel 的版本。
- 冻结新功能。
- **重构对照账本**（新增，见 §7.2），冻结 P0 时的 745 个 OpenAPI 操作、54 个 Electron E2E spec 与 15 个插件。
- **基准用户数据**：一份由 3.0.0-alpha.3 生成的 userData（含项目、扩展数据与测试用假凭据），供数据迁移测试使用。
- **性能基线**：§7.4 的指标在同一台参考机器上各测 5 次，记录中位数。

**验收**

1. `git status` 中不再有 §1.5 的空目录；`pnpm run build` 与 `pnpm run test` 通过。
2. `pnpm run check:deps` 通过；它的测试里有一个依赖 `@deepseek-ai/dsh-host-webserver` 的样例包，检查必须拒绝它。
3. 账本生成器在当前代码上生成 745 个操作条目，状态全部为 `legacy`；`check:refactor-ledger` 对它通过。
4. 性能基线与基准用户数据已提交，路径记入本文。

## 4.3 P1-a 启动与 HTTP

**交付物**

- `infra-boot`、`infra-hmr`、`infra-settings`、`infra-subprocess`、`infra-credentials`（本地文件提供方）、`infra-storage`（文档型后端）。
- `apps/cli`：复制改写 DSH `apps/cli/src/profile-boot.ts` 的 `runProfile`，保留 DSH 的 MIT 版权与许可，记录源路径与版本；实现基线 §4.1 的五项职责、`--dump-config`、`--patch` 与 Profile 别名。
- 应用自己的 Profile 模板 `web` / `headless` / `desktop`。
- `infra-webserver`、`infra-web-runtime`、`infra-connection`。
- `bundle-base` / `bundle-web` / `bundle-headless`，按依赖闭包挂载这些组件。

**验收**（以 `dramaip` 指代 `apps/cli` 的启动命令）

1. `dramaip --profile web --dump-config` 与 `dramaip --profile headless --dump-config` 的输出与提交的快照一致。
2. `dramaip --profile web --host 127.0.0.1 --port 0 --no-open` 打印一个带 `?token=` 的地址。
3. 对这个地址：
   - `GET /?token=<令牌>` 返回 303，`Set-Cookie` 的名称以 `dramaip-auth-` 开头；
   - 带 cookie 的 `GET /` 返回 200，`index.html` 含 `<base href="./">`；
   - 不存在的路径返回空 404，越出 dist 返回 403，`DELETE /` 返回 405；
   - 未认证的 `GET /api/...` 被拒绝；`Host` 不受信或 `Origin` 跨 authority 的请求被拒绝。
4. `--host 0.0.0.0` 与 `--host ::` 都在启动时以非零码退出。
5. 运行中收到 SIGTERM 退出码为 0，收到 SIGINT 为 130。
6. `headless` Profile 运行一次后退出，期间不监听任何端口。
7. 修改 Profile 的 `cordis.patch.yml` 禁用一个条目，`web` Profile 不重启即卸载该条目（配置 HMR）。
8. 每个新组件的契约测试通过；`check:deps` 通过；`check:licenses` 列出每个复制自 DSH 的文件及其来源。

## 4.4 P1-b Remote 与浏览器侧

**交付物**

- `infra-typert`（含 descriptor/codec 生成器）、`infra-gateway`、`infra-remotes`、`infra-remote-access`。
- `infra-client-modules`、`infra-client-hmr`、`infra-client-web`、`infra-ui-*`、`infra-locale`。
- `apps/web`：Vite Web 壳与渲染器根。
- 一个只用于测试的示例插件：一个一元 `@Remote` 方法、一个流方法、一个未标记方法和一个 Slot 贡献。
- Level 2 §10 的架构门禁：所有权唯一、不导入同级实现、裸插件名在解析清单、启动入口分类。

**验收**

1. 示例一元方法经 `/api` 调用成功；未标记的方法不在生成的 Client 类型中，直接调用返回结构化错误。
2. 示例流方法经 `/api/remote.mux` 返回数据；`$events` 首帧是 `ready`；断开 WebSocket 后自动重连，Client model 被新 baseline 替换。
3. 浏览器中 `window.__DRAMAIP_BOOT__` 存在；`/plugins` 下的资源带 `Cache-Control: public, max-age=31536000, immutable`。
4. 示例 Slot 贡献显示在页面上；在 Profile patch 中禁用示例插件后，它的 Slot 贡献与 Remote 方法都被撤销。
5. 测试断言 `renderSlot('root')` 只被调用一次，页面只有一个 React 根。
6. 每个架构门禁都有一个违规样例，门禁必须拒绝它。

## 4.5 P2 业务插件进入同一棵树

**交付物**

- 现有 15 个插件改为 Cordis 插件包，以 `inject` 声明依赖，挂进 `bundle-base` 与各业务组合包；`provideService` / `requireService` 改为 `ctx.<key>` 服务。
- `infra-storage` 的关系型后端（D1），沿用现有表与迁移。
- `compat-api-v2`（D3）与 `legacy-studio-client`（D4）。
- 现有 Runtime 测试套件（`packages/runtime` 的测试）改为启动新的 `web` Profile 组合，而不是 Kernel。
- 新增浏览器端冒烟测试（Playwright，针对 `web` Profile），覆盖 §7.3 的核心流程。

**验收**

1. `web` Profile 启动后，15 个业务插件的 Fiber 全部为 `ACTIVE`，由诊断接口或测试断言。
2. 改造后的 Runtime 测试套件全部通过。
3. 账本中 745 个操作全部为 `compat`：每个操作都能经 `compat-api-v2` 调通，由账本检查逐条验证。
4. 用 P0 的基准用户数据启动，读出的基准项目内容与现有 Desktop 读出的一致（对比快照）。
5. 浏览器冒烟测试通过 §7.3 的全部核心流程。
6. 现有 Electron E2E 在现有 Desktop 上仍然全部通过（用户路径没有变化）。
7. 业务插件不再导入 `packages/kernel`，由门禁检查。

## 4.6 P3 新 Electron 壳与 Desktop Host

**交付物**

- 新 `apps/desktop`：单实例锁、窗口、`dramaip-app://` 协议、更新器、原生恢复；以 Electron Node 拉起 Host 运行 `desktop` Profile，经 Node IPC 交换就绪与地址，按基线 §5 加载页面。
- D2 safeStorage 凭据提供方、D8 本机能力插件、D5 三个 Engine 插件。
- D9 用户数据迁移。
- 删除：Core Runtime 进程、application-supervisor、EngineSupervisor、extension-process-supervisor、`packages/desktop-host` 与 `/host/v1`、preload-v3 中的业务方法、扩展平台（D7）。

**验收**（Electron 测试一律后台运行，手动调试使用 `DRAMAIP_DEBUG_BACKGROUND=1`）

1. 全部 Electron E2E spec 在新壳上通过。
2. 进程断言：运行中只有 Main、渲染进程、一个 Host 进程与 Engine 子进程；没有 Core Runtime 和扩展宿主。
3. Host 只监听 `127.0.0.1` 上系统分配的端口；测试枚举 preload 暴露的键，只有壳桥接，没有业务方法。
4. 故障恢复：测试中让 Host 进程崩溃，恢复界面出现，并提供重启、以 safe overlay 启动、备份 Profile patch 三项。
5. 凭据：基准用户数据中的假凭据迁移后能被 Engine 正常解析；测试扫描 Remote 响应与日志，不出现凭据明文。
6. 数据迁移，五个用例都通过：
   - 全新安装，没有旧数据；
   - 从基准用户数据升级，项目、设置与凭据都可用；
   - 迁移重复执行，结果不变；
   - 迁移中途失败，错误可见，旧数据未被修改；
   - 升级后再打开旧版 3.0.0-alpha.3，旧数据仍可用。
7. Engine：三个 Engine 都能注册与运行；选择未注册的 Engine 返回结构化错误；禁用 Engine 插件时运行中的任务被停止并排空；`engine-runtime.spec.ts` 通过。
8. 打包：设置 `DRAMAIP_UPDATE_URL` 后 `pnpm run package` 成功，`desktop-runtime.json` 校验通过；在 macOS 上完成安装、首次启动、从 3.0.0-alpha.3 升级与卸载（Windows、Linux 按发布范围执行）。
9. §7.4 的性能指标不超过阈值。

## 4.7 P4 / P5 按业务域纵向迁移

每个域一次完成一个纵向切片：

1. controller 包：`@Remote` / `@RemoteScope` 方法的 Host face 与 Client face；
2. 从 `compat-api-v2` 移除该域路由；
3. `<domain>-client` 插件：页面经 Slots 注册，CSS Modules + 主题 token + 语言字典；从 `legacy-studio-client` 移除对应页面；
4. 该域的 Electron E2E 改为走新 UI。

顺序从小到大、从基础到上层：

| 批次 | 域                                   | 理由                                  |
| ---- | ------------------------------------ | ------------------------------------- |
| P4-a | system（含 foundation）              | 设置与诊断，验证整条链路              |
| P4-b | review、delivery、insights           | 路由少，依赖面窄                      |
| P4-c | workspace                            | 项目与工作区，是其他域的前提          |
| P4-d | writing、creative-quality、knowledge | 小说写作与知识，产品核心              |
| P5-a | agents、automation                   | 依赖 Engine seam 与会话日志           |
| P5-b | timeline、media                      | 依赖本机能力插件                      |
| P5-c | production                           | 最大的域（31k 行、34 张表），最后迁移 |

**每个域的完成定义**

1. 账本中该域的操作全部为 `migrated` 或 `retired`；`retired` 的每一项写明理由并经维护者确认。`check:refactor-ledger --domain <域>` 通过。
2. `compat-api-v2` 中该域的路由数为 0；`legacy-studio-client` 中该域的页面数为 0。
3. controller 配对测试覆盖：baseline、增量、重连、版本冲突（原 ETag/If-Match 的场景）与幂等重放（原 Idempotency-Key 的场景）。
4. 该域的 Electron E2E spec 经新 UI 通过；视觉快照（`lm7-ui-visual.spec.ts`）的变化经维护者评审。
5. 该域的 Client 插件没有 Tailwind class、Radix/shadcn 组件、react-query 或 zustand，没有硬编码文案，由 lint 规则检查。
6. 所有权门禁通过；`--dump-config` 快照的变化经评审。
7. 该域相关的 §7.4 指标不超过阈值。

## 4.8 P6 收尾

**交付物**

- 删除 `compat-api-v2`、`legacy-studio-client`、`packages/client`、`server-connection`、`packages/kernel`、`packages/http`、OpenAPI 生成链与旧生成目录。
- 删除 Tailwind、Radix、shadcn、cva、tailwind-merge、react-query、zustand、react-router-dom、hono 相关依赖。
- 重写 `desktop/docs/engineering/ARCHITECTURE.md`（实现事实）；更新 `AGENTS.md` 与 `desktop/package.json` 中的命令和门禁；删除失效的 `plugins:generate`、`architecture:generate`、`migration:generate` 或改为面向新结构的版本。
- 第三方声明（含复制改写的 DSH 代码）进入 `check:licenses`。

**验收**

1. 账本中没有 `legacy` 或 `compat` 状态的条目。
2. 上面列出的包与目录不存在；`pnpm why` 查不到上面列出的依赖。
3. AGENTS.md 中“Broad local verification”的全部命令通过。
4. AGENTS.md 与 `desktop/package.json` 中出现的每个脚本名都存在，由检查脚本验证。
5. 发布候选：全部 Electron E2E 通过，三个平台打包，从最近一个已发布版本升级成功。

## 4.9 回滚

- P0–P2 不改变用户路径；任何一步出问题直接回退对应的合并请求。
- P3 是唯一的用户切换。回滚方式是发布上一个版本：因为迁移只复制、不修改旧数据，旧版仍能打开旧数据；但用户在新版中新写入的数据旧版看不到，发布说明须写明。
- P4/P5 每个域在一个合并请求中同时删除 compat 路由与旧页面；回滚即回退这个合并请求。

---

# 5. 插件与组合包映射

| 现有插件         | 目标包                                       | 组合包              |
| ---------------- | -------------------------------------------- | ------------------- |
| foundation       | 并入 `@dramaip/system-system`                | `bundle-base`       |
| system           | `@dramaip/system-system` / `-client`         | `bundle-base`       |
| workspace        | `@dramaip/workspace-workspace` / `-client`   | `bundle-base`       |
| writing          | `@dramaip/writing-writing` / `-client`       | `bundle-writing`    |
| knowledge        | `@dramaip/writing-knowledge` / `-client`     | `bundle-writing`    |
| creative-quality | `@dramaip/writing-quality` / `-client`       | `bundle-writing`    |
| agents           | `@dramaip/agents-agents` / `-client`         | `bundle-agents`     |
| automation       | `@dramaip/automation-automation` / `-client` | `bundle-automation` |
| production       | `@dramaip/production-production` / `-client` | `bundle-production` |
| media            | `@dramaip/production-media` / `-client`      | `bundle-production` |
| timeline         | `@dramaip/production-timeline` / `-client`   | `bundle-production` |
| review           | `@dramaip/production-review` / `-client`     | `bundle-production` |
| delivery         | `@dramaip/production-delivery` / `-client`   | `bundle-production` |
| insights         | `@dramaip/insights-insights` / `-client`     | `bundle-insights`   |

| 现有包                              | 去向                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| kernel、http、bundles               | 删除，由 Cordis、`infra-webserver` 与组合包包取代                                    |
| runtime                             | 拆入各业务插件与 `boot-*`；最后删除                                                  |
| contracts                           | 拆入各 controller 包的类型；跨域共享的放进 seam 包                                   |
| database                            | `infra-storage` 的关系型后端（D1）                                                   |
| events                              | outbox 与类型化事件声明（D10）                                                       |
| ai、agent-runtime、runtime-adapters | 各 Engine 插件（D5）                                                                 |
| desktop-host                        | `packages/host/*` 插件（D8）                                                         |
| extension-host                      | 删除（D7）                                                                           |
| plugin-api                          | 删除，插件直接依赖 Cordis 与 seam 包                                                 |
| app、ui、ui-runtime                 | 过渡期为 `legacy-studio-client`；最终拆入各 `-client`、`infra-ui-*` 与 `@dramaip/ui` |
| client、server-connection           | 删除（D3）                                                                           |

---

# 6. 数据兼容

- 现有 SQLite 表与已提交迁移原样沿用（D1），不改写已提交迁移；新结构需要的变化以新迁移追加。
- 迁移到新主目录只复制，不移动或删除（D9）；旧版本仍能打开旧位置的数据。
- 项目包格式（v4）的读写归 workspace 插件；格式不在本次重构中变化。
- 凭据迁移后旧凭据库保留，直到用户在设置中显式清理。

---

# 7. 验收方法

## 7.1 通用门禁

每个阶段退出时都要通过：

| 类别     | 命令或检查                                                                                | 状态       |
| -------- | ----------------------------------------------------------------------------------------- | ---------- |
| 静态检查 | `pnpm run lint`、`pnpm run format:check`、`pnpm run typecheck`                            | 现有       |
| 测试     | `pnpm run test`（Vitest 是唯一运行器；组合测试启动真实的 Profile 组合，不模拟 Cordis 树） | 现有       |
| 构建     | `pnpm run build && pnpm run check:renderer-chunks`                                        | 现有       |
| 框架包   | `pnpm run check:framework`                                                                | 现有       |
| DSH 依赖 | `check:deps`：只允许 9 个 Cordis 框架包                                                   | P0 新增    |
| 架构门禁 | 所有权唯一、不导入同级实现、裸插件名在解析清单、启动入口分类；每个门禁带一个违规样例      | P0/P1 新增 |
| Profile  | 每个 Profile 与 overlay 的 `--dump-config` 快照，以及启动冒烟测试                         | P1 新增    |
| 对照账本 | `check:refactor-ledger`（§7.2）                                                           | P0 新增    |
| 基础设施 | 每个组件的服务契约测试；从 DSH 复制的组件一并复制或改写 DSH 的测试                        | P1 起      |
| Engine   | 每个 Engine 插件的注册、卸载排空、不支持操作与进程失败测试（Level 2 §11）                 | P3 起      |
| Electron | `pnpm run test:e2e`，串行、后台运行，窗口保持隐藏                                         | 现有       |
| 许可     | `pnpm run check:licenses`，含复制自 DSH 的文件                                            | 现有，扩展 |

新增的检查都以 Node 脚本写在 `desktop/scripts/` 中，并加入 `desktop/package.json`。

## 7.2 重构对照账本

现有的功能迁移账本（`docs/engineering/functional-migration-matrix.json` 与 `legacy-functional-baseline.json`）在当前工作区中已被删除，且它对照的是旧版 `legacy/desktop`，不适合衡量本次重构。P0 新建一份重构对照账本：

- 条目来自 P0 冻结的三类清单：745 个 OpenAPI 操作、54 个 Electron E2E spec、15 个插件。
- 每个操作条目记录：所属域、目标 controller 包与 Remote 方法、目标 Client 插件、对应的测试，以及状态 `legacy` → `compat` → `migrated` 或 `retired`。
- `retired` 必须写明理由。
- 账本由生成器维护，不手工编辑；`check:refactor-ledger` 检查条目与代码一致，并支持 `--domain <域>` 只检查一个域。

账本是 P2、P4/P5 与 P6 验收的计量依据。

## 7.3 核心流程

P2 的浏览器冒烟、P3 的 Electron E2E 与每次发布都必须覆盖以下流程，各自对应现有的 E2E spec：

| 流程                          | 现有 spec                                                   |
| ----------------------------- | ----------------------------------------------------------- |
| 启动、认证、进入项目首页      | `abc-smoke.spec.ts`、`project-home-progress.spec.ts`        |
| 新建项目并保持项目身份        | `project-identity.spec.ts`                                  |
| 小说创作全流程                | `novel-creation-journey.spec.ts`                            |
| 从创作到交付的完整旅程        | `lm6-full-journey.spec.ts`                                  |
| Engine 运行（确定性 overlay） | `engine-runtime.spec.ts`                                    |
| 媒体播放与时间线渲染          | `media-playback.spec.ts`、`timeline-render-sources.spec.ts` |
| 后台调试模式不抢焦点          | `background-debug.spec.ts`                                  |

## 7.4 性能

P0 在同一台参考机器上测量以下指标，各测 5 次取中位数作为基线：

| 指标                                  | 阈值（P0 确认） |
| ------------------------------------- | --------------- |
| 冷启动到首页可交互                    | 不超过基线 110% |
| 打开基准项目                          | 不超过基线 110% |
| 保存一章正文                          | 不超过基线 110% |
| 一次确定性 Engine 运行（e2e overlay） | 不超过基线 110% |
| 一段基准时间线的渲染                  | 不超过基线 110% |
| Host 空闲内存（Main + Host 合计）     | 不超过基线 120% |

阈值是建议值，在 P0 与基线数字一起确认。

## 7.5 签收

- 每个阶段在合并请求中附上验收清单，逐项给出证据：命令输出、测试名或快照差异。
- 维护者逐项确认后，阶段才算退出，下一阶段才开始。
- 本文 §3 与 §4 的变化随对应阶段一起更新；实现事实写进 `desktop/docs/engineering/ARCHITECTURE.md`，不写进本文。

---

# 8. 风险

| 风险                           | 影响                   | 缓解                                                       |
| ------------------------------ | ---------------------- | ---------------------------------------------------------- |
| 745 个 API 操作、108k 行 UI    | 工期长，长期双轨       | compat 插件与 legacy-studio 过渡，按域纵向切片，每批可发布 |
| 自写基础设施组件的工作量       | P1 变长，出现自有缺陷  | 默认从 DSH 复制改写，连同 DSH 的测试；P1 分两步验收        |
| 关系型存储超出 DSH 记录模型    | 需要自己设计后端       | D1 沿用现有 node:sqlite 表、迁移与 UnitOfWork              |
| 凭据安全降级                   | 用户凭据以明文落盘     | D2 Desktop 使用 safeStorage 提供方                         |
| ETag / 幂等语义丢失            | 并发编辑覆盖、重复提交 | Host face 显式版本比较与幂等键，配对测试覆盖               |
| DSH 仍是 `0.2.1-rc.3` 预发布版 | 框架包升级时接口变化   | 只依赖 9 个框架包；升级快照作为单独变更，带组合快照对比    |
| 复制改写的 DSH 代码与上游漂移  | 修复无法自动获得       | 第三方声明记录源路径与版本，需要时对照来源合并             |
| 现有生成器与门禁依赖 Kernel    | 中途门禁失效           | P0 先迁移门禁；生成器在 P6 删除或重写                      |
| 删除扩展平台影响已有用户       | 用户扩展不再加载       | 数据保留，发布说明告知                                     |
| 用户数据迁移失败               | 首次启动无法打开项目   | 只复制不移动，失败可见且旧数据可用，E2E 覆盖               |

---

# 9. 不做的事

- 不开放第三方插件、不编写插件管理组件、不提供 `plugin` 命令。
- 不 fork 或修改 Cordis 框架包与 `vendor/*`。
- 不依赖 Cordis 框架包以外的任何 DSH 包：`dsh-*` 组件包、DSH 组合包、`dsh` CLI 包与 `apps/*`。
- 不在重构中改变小说写作、改编与媒体生产的产品范围。
- 不把计划中的阶段描述为已完成；实现事实只写进 `desktop/docs/engineering/ARCHITECTURE.md`。

---

# 10. 待决问题

1. 基础设施组件放在 `desktop/packages/infra/`，还是作为可跨项目共享的独立包集维护？
2. D7：扩展平台是直接删除，还是先在一个版本中标为弃用？
3. 是否保留 `web` Profile 作为正式产品形态（浏览器访问本机 Host），还是只用于开发与测试？
4. 重构期间的发布节奏：每个阶段发布 alpha，还是 P3 之后才发布？
5. §7.4 的性能阈值与参考机器。
6. P3 与 P6 的打包验收覆盖哪些平台：只有 macOS，还是 macOS、Windows、Linux 都覆盖？
