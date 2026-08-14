# DramaIP Desktop v3 架构

DramaIP Desktop 使用 React 19 Renderer，并且只有一条业务传输通道：带启动期随机凭据的本地 HTTP。

```text
Electron Main
├── React Renderer（dramaip://renderer）
├── DramaIP Server utilityProcess
│   ├── /api/v1 HTTP + SSE
│   ├── node:sqlite + Drizzle Schema
│   ├── Task / Session / Run / Item / Preview
│   └── Agent Router + 只读 MCP
├── OpenCode Engine utilityProcess
├── Codex Host utilityProcess → 固定 Codex App Server stdio
├── DSH Engine utilityProcess → 会话级 Headless JSON-RPC Runtime
└── LangGraph.js Engine utilityProcess
```

Renderer 只获得 DramaIP Server 地址和每次启动随机生成的 Basic Auth 凭据。四个引擎的地址、进程凭据、MCP 令牌和 Provider 密钥都不会进入 Renderer。

## 原生 IPC 白名单

Electron IPC 不是业务 API。Preload 只提供初始化、重试、窗口、文件选择 capability、打开/定位文件、安全凭据引用及崩溃日志。内容、任务、预览、服务商和智能会话全部使用 `/api/v1`。

## 数据与凭据

Server 独占 Electron `userData` 下的新 `dramaip.db`，不会打开或迁移旧数据库。SQLite 启用 WAL、外键、busy timeout 和 NORMAL synchronous。OpenCode、Codex 和 DSH 使用各自隔离的运行目录，不能读取 DramaIP 数据库；DSH 不挂载自身会话持久化，DramaIP 数据库仍是唯一权威状态。

Provider 密钥与 Codex API Key 只进入 Electron `userData/credentials` 下的本地加密凭据库。该实现使用应用自己的 AES-256-GCM 文件封装，不调用 macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service；数据库仅保存 `credentialRef`，Server 会拒绝在业务负载、厂商预览和日志中出现密钥、Token、密码或任意本地路径。凭据库密钥同样位于应用数据目录，因此应结合操作系统账户保护和全盘加密使用。

常用模型服务商及模型由 `packages/schema/src/provider-catalog.ts` 提供版本化目录。Renderer 只能从该目录选择预设接口地址和协议，连接后可合并服务商返回的账号可用模型；“其他”配置才允许用户完整手填。目录版本必须与桌面应用版本一致，核对日期不得超过发布门禁规定的时限。

旧版本如果曾将凭据保存到系统钥匙串，升级后必须由用户重新输入：DramaIP 不会读取、解密或迁移该类记录，以确保本版本完全不访问系统凭据服务。

## 四引擎协议

OpenCode、Codex、DeepSeek Harness（DSH）、LangGraph.js 统一映射为 Session → Run → Item。Server 负责路由、持久化、检查点、SSE 重放、用量、费用和失败映射；引擎只负责生成。项目可设置默认引擎和模型，每次任务可覆盖；引擎故障不会触发自动回退。

- OpenCode 固定 1.18.15，默认引擎，禁用 shell、编辑、任意文件读取、网络工具和子代理。
- Codex 固定 0.147.0 并显示“测试版”，使用独立 `CODEX_HOME`、App Server stdio、`read-only + never`，关闭网页搜索、命令、补丁、插件、Skills、应用和子代理。
- DSH 固定 0.1.0-rc.5 并显示“测试版”。Sidecar 由 Electron utility process 管理，每个实际运行的会话使用 `process.execPath + ELECTRON_RUN_AS_NODE=1` 启动独立 JSON-RPC Runtime。受控 Cordis 配置只挂载 JSON-RPC Server、`dsh-llm-pi-ai`、Agent Spine 和 DramaIP MCP Client，不挂载 Bash、文件系统、Web、Skills、子代理、工作流或本地持久化。
- LangGraph.js 是方案四稳定基线，使用 Vercel AI SDK 远程 Provider，并恢复 69 份旧版中文 Prompt；不访问数据库或本地文件。

每次运行获得绑定项目、会话、运行、上下文快照、工具白名单、结果大小和有效期的 MCP 授权。四种引擎均只能调用 DramaIP 只读 MCP。DSH Runtime 只在本轮授权写入 Server 后启动；Provider 切换不会改变正在运行的会话，后续运行按新配置重建 Runtime。

新建盲测固定映射为方案一 OpenCode、方案二 Codex、方案三 DSH、方案四 LangGraph.js。评价前隐藏引擎名，评价后揭示；旧三候选记录继续按自身 `candidate_order_json` 的实际数量完成和展示。

## 任务、修改与媒体调用

任务状态为 `queued → running → succeeded|failed|canceled|interrupted`。SSE 使用全局单调事件编号和 `Last-Event-ID` 重放。中断运行通过持久化检查点恢复；重试创建带 `parentTaskId` 的新任务。

内容修改只能创建通用 `ChangePreview`。用户确认后，Server 在事务中核对所有目标版本；冲突返回 HTTP 409。图片、音频、视频和成片渲染只能创建远程 `ProviderActionPreview`，用户确认费用后才创建正式 Provider 任务。项目不存在本地小说、图片、音频、视频生成或本地视频渲染路径。

## 本地质量门禁

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run check:generated
bun run check:engine-locks
bun run check:provider-catalog
bun run build
DRAMAIP_UPDATE_URL=https://updates.example.invalid bun run package
```

Node 进程验证 `node:sqlite`，Bun 进程验证 `bun:sqlite`，两者运行同一 Repository conformance suite。生成门禁同时检查 Effect OpenAPI Client、旧版 Prompt 目录、OpenCode/Codex 固定版本、六平台二进制哈希、Codex 协议快照，以及 DSH 版本、许可证、pnpm lockfile 和排除构建产物后的完整源码树摘要。
