# Desktop 3.0 数据库回滚

恢复目标是保全 [产品定位](../../../docs/product/POSITIONING.md) 中作者拥有的故事/IP 权威资产，包括独立小说稿件、剧本、版本与来源，不以媒体或云能力是否可用判断成果有效性。本次定位校准不改变下述数据库格式和恢复操作，也不构成新的升级/回退验收。

alpha.3 不会重置项目数据。首次启动会对 alpha.2 的 `dramaip.db` 执行 WAL checkpoint 与 integrity check，并把验证副本写入 `userData/backups/architecture-upgrade/`。 `alpha2-agent-to-alpha3.json` 保存 SHA-256、大小、alpha.2 版本、SQLite `user_version`、表清单和 cutover 阶段；随后只清空 Agent 会话、Run、Item、检查点和旧盲测记录，Provider、`credentialRef` 与 Codex 登录状态保留。

## 用户回退到 2.x

1. 完全退出 DramaIP，确认没有 Runtime、Electron 或旧 sidecar 正在使用 `userData`。
2. 保留 v3 `dramaip.db`，不要覆盖或删除它；它可能包含升级后新建的空工作区。
3. 在 `backups/architecture-upgrade` 找到最近一个有完整 manifest 且 SHA-256 匹配的备份数据库。
4. 将该备份复制回 `userData/dramaip.db`，并仅使用与 manifest 中旧版本相符的 2.x 应用启动。
5. 若 v3 数据库需要保留，先将它重命名为单独文件；2.x 不能读取 v3 schema。

不要从 3.0 自动恢复任何数据到旧库，也不要删除备份的 `-wal`/`-shm` 以外的文件。升级中断、备份校验失败或迁移失败时，cutover state 会变为 `failed` 并阻止自动重试；先保全备份，再由支持人员检查 manifest 和 SQLite integrity check。

## 发布前验证

候选包至少验证：空安装、普通旧库、带 WAL 的旧库、损坏旧库、备份写入失败、迁移失败、中断后的二次启动和 migration checksum drift。正常路径只有在 Runtime、Profile 和 `/api/v2/health` 都成功后才将状态写为 `complete`。
