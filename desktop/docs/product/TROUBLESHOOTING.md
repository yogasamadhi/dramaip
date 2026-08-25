# Troubleshooting

| Symptom                          | Action                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| “Server 未能启动”                | Choose retry. If it repeats, collect the desktop logs and verify the `userData` directory is writable.                                                                         |
| Agent reports engine unavailable | Project, chapter and production features remain available. Restart the app to restart the Pi, Codex, Grok Build or LangGraph.js Host adapter; it will not silently switch to another engine. Complete four-engine comparisons require macOS arm64 because Grok Build is unavailable elsewhere; LangGraph.js ordinary tasks remain available. |
| A save returns a conflict        | Reload the project or chapter and reapply the edit to the latest version.                                                                                                      |
| An asset cannot be imported      | Choose the file again. Capability tokens are read-only, renderer-bound and expire after ten minutes.                                                                           |
| 服务商密钥无法保存               | 检查应用数据目录是否可写；密钥仅保存到本地加密凭据库，业务记录中只保存 `credentialRef`。                                                                                       |
| 升级后旧密钥无法使用             | 本版本不会访问或迁移 macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service；请在“设置 → 安全凭据”重新保存服务商密钥，并重新登录 Codex。                                      |

There is no `better-sqlite3` rebuild step and no historical database migration path in v3.
