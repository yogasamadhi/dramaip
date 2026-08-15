# DramaIP Desktop

DramaIP Desktop 是采用 React 19 界面和本地 HTTP 服务边界的 Electron 桌面应用。

```text
Electron Main
├── React + Tailwind 4 Renderer
├── DramaIP Server utilityProcess（node:sqlite + Drizzle、HTTP、SSE）
├── OpenCode Engine utilityProcess（默认）
├── Codex Host utilityProcess（测试版）
├── DSH Engine utilityProcess（测试版）→ 会话级 JSON-RPC Runtime
├── Hermes Engine utilityProcess（测试版）→ 会话级 ACP Runtime
└── LangGraph.js Engine utilityProcess（方案五稳定基线）
```

所有产品数据写入新的 `dramaip.db`，不会读取或迁移历史 `studio.db`。Renderer 的业务调用全部通过由 Effect HttpApi/OpenAPI 契约生成的 `@sdns/client` 完成。Electron IPC 仅用于初始化、窗口、文件 capability、安全凭据和其他桌面原生能力。

五个智能引擎共享同一任务目录、不可变上下文快照、只读 MCP 权限、Session/Run/Item 事件和预览确认机制。任何引擎都不能直接修改正式内容或直接发起付费媒体任务，也不会在失败后静默切换引擎。新盲测固定为方案一 OpenCode、方案二 Codex、方案三 DeepSeek Harness、方案四 Hermes Agent、方案五 LangGraph.js；评价前仍隐藏名称。历史盲测记录始终按自身已存映射解释。

## P2 机器验收边界

`LM6-25` 的 Gate 使用 `full-electron-journey`、`timeline-reference-parser`、`local-project-package-and-migration`、`series-link-and-fork` 与 `two-identity-cloud-review-fake-gateway` 组合验证本地制作、NLE 交换、项目复用和可选审片闭环。它不扩大为外部兼容性声明：`no-real-nle-import-claim`、`no-mp4-without-timeline-render-provider`、`cloud-review-is-optional-and-local-first` 与 `docker-compose-e2e-is-enhanced-evidence` 均仍是发布边界。

可复跑的最小 Gate 命令为：

```bash
bun run check:timeline-exports
bunx playwright test tests/electron/lm6-full-journey.spec.ts --reporter=list
node --import tsx --test packages/server/src/sidecar.node.test.ts
```

## 开发

```bash
bun install
bun run dev
bun run typecheck
bun run test
bun run check:generated
bun run check:engine-locks
bun run build
```

`bun run package` 需要提供 `DRAMAIP_UPDATE_URL`。OpenCode 1.18.15 源码及锁定记录位于 `vendor/opencode`；Codex 0.147.0 的六平台二进制哈希和协议快照位于 `vendor/codex.lock.json` 与 `vendor/codex.protocol.lock.json`；DSH 0.1.0-rc.5 与 Hermes 0.20.1 的冻结源码树、工具链和 lockfile 摘要位于对应的 `vendor/*.lock.json`。Hermes 打包 CPython 3.11.15，首次运行不下载依赖。
