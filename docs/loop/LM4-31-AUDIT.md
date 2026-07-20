# LM4-31 全量发布 Gate 审计

审计日期：2026-07-20
状态：**partial — 不得发布或宣称所有 P0/P1/P2 已完成**

本审计只记录已实际执行的本地/Compose 证据，以及必须由获授权环境补齐的发布证据。它不把
mock、fixture、本机 macOS 打包或缺失的环境变量替换成生产验证。

## 已通过的本地 Gate

| 范围 | 实际命令或证据 | 结果 |
| --- | --- | --- |
| Desktop 全量 | `pnpm test`、`pnpm test:e2e` | 通过；包含类型、162 个单元测试、SQLite 迁移/备份 smoke 与 Electron 主流程。 |
| Desktop UI/a11y | `pnpm test:ui:skip-build -- --output=artifacts/lm4-31-current` | 通过；31 个 fixture/路由/主题/reduced-motion 截图，0 条无障碍观察。 |
| Desktop 打包 | `pnpm package:smoke`、`pnpm format:check` | 通过；本机 macOS arm64 的 DMG/ZIP 生成、包内容边界检查、已打包应用启动与临时数据库初始化均通过。该构建未签名、未公证。 |
| Platform clients | `pnpm lint`、`pnpm typecheck`、`pnpm contracts:check`、`pnpm build:web`、`pnpm build:admin` | 通过。Admin 构建仅给出既有 ECharts 大于 500 kB 的 Vite 性能提示，不是构建失败。 |
| Platform services | `make test`、`make observability-config-smoke`、`make web-route-smoke` | 通过；Go 服务测试、客户端契约检查、7 条 Web 路由和 11 条告警/12 个面板配置均可验证。 |
| 健康 Compose | `make platform-up` 后 `make platform-e2e && make observability-smoke` | 通过；Kong `/v1/healthz`、基础用量链路和 trace（3 spans）均正常。首次紧接 `platform-up` 的请求在 web-bff 监听前收到 502；迁移日志为 `migrations_applied`，服务就绪后复跑通过，故这是启动就绪时序而不是功能失败。 |
| 迁移/部署静态检查 | Snapshot migration 045 在本地 Compose 成功应用；此前已通过 `buf lint`、全量 Go 测试、Compose config 与 Helm lint/template。 | 通过本地范围；不等同于生产迁移批准。 |
| 版本库卫生 | `git diff --check`、受跟踪 `.env`/构建包扫描、远端 fetch | 通过；未发现受跟踪凭据、环境文件或安装包。当前 Gate 分支未合入 `origin/main`，且支撑 LM4-26～30 的保留分支/提交均有下列明确原因。 |

## 发布阻断与所需证据

| 阻断项 | 当前事实 | 解除条件 |
| --- | --- | --- |
| LM4-26：Hailuo 真实渠道 | `HAILUO_SANDBOX_API_KEY` 与 `HAILUO_SANDBOX_ALLOW_BILLING` 在本环境均不存在；该 smoke 是显式计费操作，未执行。 | 经批准的 Hailuo sandbox 注入密钥与计费授权，保留提交、轮询、归档、费用和错误路径证据。 |
| LM4-27：Wan 真实渠道 | `WAN_SANDBOX_API_KEY` 与 `WAN_SANDBOX_ALLOW_BILLING` 在本环境均不存在；该 smoke 是显式计费操作，未执行。 | 经批准的 Wan sandbox 注入密钥与计费授权，保留独立提交、轮询、取消/归档、费用和错误路径证据。 |
| LM4-28：Web AI 作者化发布链 | 该 loop 仍为 `partial`；同时，LM4-26/27 的真实渠道证据也独立阻断 Full Gate。 | 按 LM4-28 自身验收补齐端到端发布验证；Full Gate 还须分别完成两项 provider 证据并合入主线。 |
| LM4-30：加密快照生产准入 | 本地的加密、8–64 MiB 可续传、留存和删除测试已通过；尚无批准的生产 migration/mTLS、真实 Desktop 云账号恢复演练、存储/KMS/备份保留审查。 | 在受控环境完成 migration 与 mTLS 部署，执行上传/列表/下载/删除/恢复，审查存储与密钥保留，并保存不含内容/密钥的记录。 |
| LM3-33/LM3-34 灾备 | `LOOPMAP3.md` 中 LM3-33、LM3-34 仍为 `todo`；LM4-30 明确依赖此 Gate。 | 完成生产等价备份、PITR/恢复、账本核对、RPO/RTO 与演练记录。 |
| 跨平台与正式分发 | 本机仅验证 macOS arm64；现有 `package-smoke` 支持 Windows/Linux，但未获得三平台 CI runner 的本轮结果。正式签名/公证凭据也未被授权注入。 | macOS、Windows、Linux 的 CI package-smoke 全绿；macOS/Windows 签名和 macOS notarization 的受控发布证据齐全。 |
| 主线与发布标签 | `git merge-base --is-ancestor HEAD origin/main` 返回非零；保留的 LM4-26～29 远端链尚未满足 Full Gate。 | 所有 partial loop 均变为 `done`、父链正常合入 `main`，再由获授权人员创建并推送发布标签。 |

## 发布与回滚边界

在上述阻断解除之前，任何候选说明都只能是草稿，不能发布二进制、切换更新元数据或创建
release tag。生产执行时必须先验证向后兼容迁移与恢复路径，再部署应用；快照迁移 045 会新增
暂存分片表并将密文上限扩大到 64 MiB，生产操作需保留迁移前备份和演练记录。发布说明必须
包含数据迁移、受支持客户端窗口、人工回退路径、保留旧安装包/更新元数据以及“未知 schema
不得降级二进制”的限制；通用打包和回滚规则见 `dramaip-desktop/docs/release/RELEASE.md`。

## 结论

本地代码、Compose、可观测性、UI/a11y 和本机安装包已经形成可复现证据，但 G5 Full Gate
没有通过。后续工作应回到表中对应的 LM4-26、LM4-27、LM4-28、LM4-30 及 LM3-33/34，而不是
在 LM4-31 放宽授权、隐私、灾备、签名或跨平台要求。
