# 发布检查清单

1. 运行 `bun run lint`、`bun run format:check`、`bun run typecheck`、`bun run test`、`bun run test:e2e`、`bun run check:generated`、`bun run check:engine-locks`、`bun run check:provider-catalog` 和 `bun run build`。
2. 设置真实 `DRAMAIP_UPDATE_URL`，分别在 macOS、Windows、Linux 运行 `bun run package`。
3. 启动每个平台的安装包，验证 DramaIP Server、OpenCode、Codex、DSH 和 LangGraph.js Sidecar 均按预期启动，DSH 会话 Runtime 可运行并退出，`dramaip.db` 可写，退出后没有残留进程。
4. 校验 OpenCode 1.18.15、Codex 0.147.0 和 DSH 0.1.0-rc.5 的打包资源、锁定摘要、协议快照及第三方许可证。
5. 验证 Renderer 不含业务 `fetch`，Electron 不含业务 IPC，产物不含旧数据库代码、本地媒体生成器或本地视频渲染器。
6. 发布前完成三平台代码签名；macOS 还必须完成公证。
7. GitLab 的 `desktop_macos_release` 与 `desktop_windows_release` 只在标签流水线上运行；发布前必须确认项目已配置带 `macos`、`windows` 和 `private` 标签的对应 Runner。
8. 对每个平台产出的安装应用再运行 Electron 端到端测试；可通过 `DRAMAIP_E2E_EXECUTABLE` 指定已打包应用的可执行文件。
9. 每次修改应用版本号时，都必须按目录中记录的官方来源核对常用服务商、模型标识和下线公告，并同步更新 `MODEL_PROVIDER_CATALOG_RELEASE` 与 `MODEL_PROVIDER_CATALOG_UPDATED_AT`；否则发布检查会失败。
