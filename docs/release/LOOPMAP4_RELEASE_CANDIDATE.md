# LOOPMAP4 Release Candidate（不可发布草稿）

状态：**blocked by LM4-31 Full Gate**
更新时间：2026-07-20

这不是可发布的 release note，也不是 tag 请求。它将当前候选的发布顺序、兼容和回滚边界
与缺失证据分开记录，避免将本地验证误读为生产批准。完整审计见
[`LM4-31-AUDIT.md`](../loop/LM4-31-AUDIT.md)。

## 已验证的候选范围

- Desktop 全量测试、Electron E2E、31 个 UI/a11y 基线（0 条观察）和本机 macOS arm64 DMG/ZIP
  package smoke 已通过。
- Platform clients lint/typecheck/contracts/build、Java Maven 测试、健康 Compose E2E 和
  trace/observability smoke 已通过；`make platform-up` 会有界等待 Java Gateway 健康端点。
- 端到端加密项目快照的本地安全边界已验证：密钥仅在本机 Keychain，服务端只处理不透明密文；
  8–64 MiB 上传可续传、暂存 24 小时过期、正式快照 30 天留存。

## 发布前必需清单

1. 在获授权的 Hailuo 与 Wan sandbox 分别执行真实、可计费的官方 smoke，并记录费用、错误和
   回滚结果；不得使用 mock 代替。
2. 完成 Snapshot migration/mTLS 的受控部署、真实云账号上传/列表/下载/删除/恢复演练，以及
   存储、KMS 与备份保留审查。
3. 在生产等价环境完成 LM3-33/LM3-34 的备份、PITR/恢复、账本核对、损坏告警和 RPO/RTO
   演练；当前仅有已记录的本地隔离 PITR 和本地发布 Gate 证据，不能替代这一条件。
4. 在 macOS、Windows、Linux 的受控 CI runner 上完成 `pnpm package:smoke`；为正式 macOS/Windows
   产物注入签名凭据，并完成 macOS notarization。
5. 将所有 LM4 `partial` 变为 `done`，合入 `main`，再由获授权发布者创建 tag、上传校验和与
   经过审查的 release note。

## 数据迁移、兼容与回滚

- Snapshot migration 045 是向前发布步骤的一部分：它新增可过期的密文分片暂存表，并把正式
  密文上限从 8 MiB 扩大到 64 MiB。先在生产等价环境验证 migration、mTLS 与恢复，再部署应用。
- 发布窗口内保留已有的有界单请求快照路径；支持大包续传的客户端仍必须以兼容的 v1 API
  调用，不应把未升级客户端强制切换到新流程。
- 发生问题时停止新功能流量、保留密文对象与审计记录、维持下载/删除窗口，并先从已验证的
  备份恢复。不要把二进制降级到不能安全打开当前 schema 的版本。
- 更新元数据与至少三个已验证安装包必须可审计地保留；若未来自动更新已启用，只回退
  `latest*.yml` 指针而不删除问题版本。正式细则见
  [`RELEASE.md`](../../dramaip-desktop/docs/release/RELEASE.md)。
