# 尽意 DramaIP Desktop

> **尽作者之意，成万象之作**
>
> 面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台

尽意 DramaIP Desktop 3.0 alpha 是本地权威创作与生产环境：支持从创意、小说或已有剧本进入，持续维护作者意图、故事母本、分集改编、叙事连续性、版本与来源，并把已采用内容推进为分镜、媒体试制和专业交付。小说创作是上游核心之一，不是所有项目的强制入口；图片、TTS 和视频 Provider 是可替换的生产出口。

统一产品口径见[产品定位](../docs/product/POSITIONING.md)。Desktop 采用 React 19、第一方插件 Runtime 和本地 HTTP 边界。

```text
React Renderer
  │ HTTP /api/v2 (Bearer)
  ▼
DramaIP Runtime (Hono + Kernel + SQLite + SSE)
  │ HTTP /host/v1 (different Bearer token)
  ▼
Electron Desktop Host
  ├── window / file grants / external links / credential vault
  └── Pi / Codex / LangGraph.js EngineSupervisor processes
```

Renderer 只读取冻结的 `RuntimeBootstrap { baseUrl, accessToken, appVersion, apiVersion }`，业务调用统一经由生成的 `@dramaip/client` 到 `/api/v2`；preload 不暴露任何 IPC 方法。Desktop Host 的 `/host/v1` 使用独立令牌，路径和凭据明文不会返回 Renderer。

`3.0.0-alpha.3` 将 Core Runtime 置于独立进程：Electron Main 只监督窗口、Host 和 vendor runtime。Pi 是默认内嵌 Agent Harness，Codex 与 LangGraph.js 是外部质量基准。LangGraph.js 只负责固定的模型调用与输出校验图，不是 Core Runtime 的工作流运行时。 `Plugin → Bundle → Profile` 解析后才启动有效 Runtime 图；Profile 为 `studio`、`server`、`safe`、`test`、`e2e`，并且只引用内置 Bundle。

首次 alpha.3 启动会验证 alpha.2 的 `dramaip.db`，并在 `userData/backups` 建立含 SHA-256 与 schema 清单的验证备份；项目、Provider 与 `credentialRef` 保留，只重置 Agent 执行和评估数据。详情见 [v3 回滚说明](./docs/release/ROLLBACK_V3.md)。

三个智能引擎共享不可变上下文快照、Capability Grant、Session/Run/Item 事件和预览确认机制。任何引擎都不能直接修改正式内容或直接发起付费媒体任务，也不会在失败后静默切换引擎。新盲测固定并发运行 Pi、Codex、LangGraph.js，随机映射 A/B/C；用户提交评价后才可揭晓真实引擎。

## P2 机器验收边界

`LM6-25` 的 Gate 使用 `full-electron-journey`、`timeline-reference-parser`、`local-project-package-and-migration`、`series-link-and-fork` 与 `two-identity-cloud-review-fake-gateway` 组合验证本地制作、NLE 交换、项目复用和可选审片闭环。它不扩大为外部兼容性声明：`no-real-nle-import-claim`、`no-mp4-without-timeline-render-provider`、`cloud-review-is-optional-and-local-first` 与 `docker-compose-e2e-is-enhanced-evidence` 均仍是发布边界。

可复跑的最小 Gate 命令为：

```bash
bun run check:timeline-exports
bun scripts/run-electron-playwright.ts test tests/electron/lm6-full-journey.spec.ts --reporter=list
bun run test:runtime
```

## 开发

桌面工作区只接受 Bun 1.4.0，用于依赖管理和构建。独立 Core Runtime、迁移 Worker 与 Runtime 测试使用 Node 24.18.0；Electron 桌面模式使用 Electron 内嵌 Node。开发期 Cordis HMR 由启动器显式传入 `--expose-internals`，启动时检查内部 Loader。

```bash
git submodule update --init
bun run prepare:framework
bun ci
bun run build:framework
bun run check:framework
bun ../run-desktop.ts
bun run typecheck
bun run test
bun run check:generated
bun run check:architecture
bun run check:engine-locks
bun run build
```

无 Electron 的 Runtime 可用 `bun run serve --profile server --database /absolute/path/dramaip.db --port 8787` 启动。支持的 Profile 是 `studio`、`server`、`safe`、`test`、`e2e`，运行时固定为 Node 24.18.0，可用 `DRAMAIP_NODE_PATH` 指定可执行文件。`bun run dev:runtime` 启用开发 HMR 和 supervisor。

`bun run package` 需要提供 `DRAMAIP_UPDATE_URL`。Pi 0.84.2、Codex 0.147.0 与 LangGraph.js 1.4.9 的版本与完整性记录位于 `vendor/*.lock.json`；桌面受管进程还校验 Electron 内嵌 Node 版本。Pi Runtime 由冻结源码直接打包，首次运行不下载依赖。LangGraph.js 依赖由 Bun 锁文件固定且不引入源码 submodule 或 `better-sqlite3`；OpenCode 保持参考用途。DeepSeek Harness 的锁定快照提供九个框架包源码：Cordis、Cosmokit、Schemastery、Loader、Include、Group、Timer、HMR 和 Logger Console。准备脚本只复制到忽略提交的 `build/dsh-framework/`，不修改 vendor。

第一方插件通过六个 Bundle 的 `cordis.patch.yml` 和五个 Profile patch 交给 DSH Loader/Include/Group 装配。开发时业务模块局部重载，框架、公共元数据和迁移变化重启 Runtime。重载期间业务请求返回结构化 `RUNTIME_RELOADING`，待生命周期与贡献校验成功后原子发布新图；失败图不会发布。

`build/runtime/` 是可独立复制的 ESM 发布目录，包含模块、配置、框架许可证及内部相对依赖链接。发布包关闭监听。运行 `bun run test:runtime:hmr` 和 `bun run test:runtime:hmr:electron` 验证脱离仓库后的加载与恢复。实施细节见 [Cordis 迁移说明](docs/engineering/DSH_CORDIS_MIGRATION.md)。
