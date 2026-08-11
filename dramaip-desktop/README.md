# DramaIP Desktop

DramaIP Desktop 是采用 React 19 界面和本地 HTTP 服务边界的 Electron 桌面应用。

```text
Electron Main
├── React + Tailwind 4 Renderer
├── DramaIP Server utilityProcess（node:sqlite + Drizzle、HTTP、SSE）
├── OpenCode Engine utilityProcess（默认）
├── Codex Host utilityProcess（测试版）
└── LangGraph.js Engine utilityProcess（稳定基线）
```

所有产品数据写入新的 `dramaip.db`，不会读取或迁移历史 `studio.db`。Renderer 的业务调用全部通过由 Effect HttpApi/OpenAPI 契约生成的 `@sdns/client` 完成。Electron IPC 仅用于初始化、窗口、文件 capability、安全凭据和其他桌面原生能力。

三个智能引擎共享同一任务目录、不可变上下文快照、只读 MCP 权限、Session/Run/Item 事件和预览确认机制。任何引擎都不能直接修改正式内容或直接发起付费媒体任务，也不会在失败后静默切换引擎。

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

`bun run package` 需要提供 `DRAMAIP_UPDATE_URL`。OpenCode 1.18.15 源码及锁定记录位于 `vendor/opencode`；Codex 0.147.0 的六平台二进制哈希和协议快照位于 `vendor/codex.lock.json` 与 `vendor/codex.protocol.lock.json`。
