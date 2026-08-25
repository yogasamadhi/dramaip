# 发布检查清单

1. 运行 `bun run lint`、`bun run format:check`、`bun run typecheck`、`bun run test`、`bun run test:e2e`、`bun run check:generated`、`bun run check:architecture`、`bun run check:engine-locks`、`bun run check:provider-catalog` 和 `bun run build`。
2. 设置真实 `DRAMAIP_UPDATE_URL`，分别在 macOS、Windows、Linux 运行 `bun run package`。
3. 启动每个平台的安装包，验证 `/api/v2/runtime` 与 `/api/v2/system/diagnostics` 中的 Profile、Bundle、插件顺序、迁移、Host 和 Pi、Codex、Grok Build、LangGraph.js 四个引擎健康状态；确认 `dramaip.db` 可写，退出后没有残留进程。非 macOS arm64 仅豁免 Grok Build，LangGraph.js 仍须可用。
4. 校验 Pi 0.84.2、Codex 0.147.0、Grok Build 1.0.5 与 LangGraph.js 1.4.9 的打包资源、锁定摘要、协议快照及第三方许可证；OpenCode 和 DSH 只校验参考快照完整性，不得进入安装包。
5. 验证 Renderer 不含业务 `fetch` 或 IPC 方法、preload 只含 Runtime bootstrap、Renderer 只使用生成的 `@dramaip/client`；确认 Core Runtime 未在 Electron Main 内启动，HTTP API 为 `/api/v2`，并验证 Node 与 Bun Server Mode。
6. 发布前完成三平台代码签名；macOS 还必须完成公证。
7. GitLab 的 `desktop_macos_release` 与 `desktop_windows_release` 只在标签流水线上运行；发布前必须确认项目已配置带 `macos`、`windows` 和 `private` 标签的对应 Runner。
8. 对每个平台产出的安装应用再运行 Electron 端到端测试；可通过 `DRAMAIP_E2E_EXECUTABLE` 指定已打包应用的可执行文件。
9. 每次修改应用版本号时，都必须按目录中记录的官方来源核对常用服务商、模型标识和下线公告，并同步更新 `MODEL_PROVIDER_CATALOG_RELEASE` 与 `MODEL_PROVIDER_CATALOG_UPDATED_AT`；否则发布检查会失败。
10. 对会触发 3.0 首次启动的候选包执行数据库 cutover smoke test，并按 [v3 回滚说明](./ROLLBACK_V3.md) 验证备份 manifest 和手动回退流程。
