# LM3-33 PostgreSQL 灾备与恢复进展记录

LM3-33 交付了可重复的隔离恢复演练入口和生产边界说明，但**尚未完成**：当前没有生产等价
持久卷、独立故障域对象存储、KMS/Secret Manager、不可变保留策略或生产等价数据集，不能把
临时 MinIO/hostPath 验证称为生产验收。本记录防止将已取得的机制证据与尚未取得的生产 SLA
证据混淆。

## 已验证的隔离能力（2026-07-14）

- 本地 PostgreSQL 18 物理 base backup + WAL + 命名恢复点：75 秒恢复，payment、subscription、
  token 临时账本断言 `1:1:1:0`。
- CloudNativePG 1.30 / PostgreSQL 18.4 的三 worker HA：两次 primary 删除后分别在 23 秒和
  6 秒内自动提升并重新达到 `3/3 Ready`。
- 临时 worker01 MinIO 上的原生 Barman 兼容性演练：base backup `20260714T100031`、WAL 与
  命名恢复点恢复均通过；这条路径只用于确认 1.30 兼容性，CNPG 已警告它会在 1.31 移除。
- 官方 Barman Cloud Plugin v0.13.0：官方清单 SHA-256 已校验；插件和 sidecar 以明确的
  `linux/amd64` 镜像导入三个 worker。插件控制器运行在 worker01；三个 source Pod 经受控
  逐个重建后均为 `2/2`，其 native sidecar 为 `plugin-barman-cloud`。
- 插件切换后的 HA：删除旧 primary `dramaip-recovery-ha-1` 后，worker02 上的
  `dramaip-recovery-ha-2` 自动成为 primary，source 集群恢复 `3/3`。
- Plugin backup/PITR：`method: plugin` Backup
  `dramaip-recovery-ha-plugin-backup-20260714t10391784025547z-2890`（ID
  `20260714T103909`）完成，命名恢复点
  `cnpg-plugin-pitr-20260714t10391784025547z-2890` 的 WAL 已归档；即时 plugin
  ScheduledBackup 已派发。独立 worker02 restore Cluster 以 Plugin `externalClusters` 恢复到该点，
  三账本断言 `1:1:1:0`。

所有演练仅使用 `dramaip-recovery-staging`、临时数据和临时凭据；没有连接真实支付、业务库或
生产 Secret。构建发生在 arm64 工作站（明确 `linux/amd64` 拉取/导出），镜像导入和数据库
workload 仅在 amd64 worker；master 仅执行 Kubernetes API 编排。API VIP 或单个 control-plane
节点超时时，以 `/readyz` 选择 master03、master02、master01 中可用的直连端点，不重启或修改
任何 control-plane 组件。

本次继续验证时 master03 的 `/readyz` 已恢复为 `ok`，因此优先使用
`https://192.168.2.203:6443`；`dramaip-platform/deploy/recovery/select-kube-api.sh` 已将该顺序
固化为只读预检，并在 master03 失败时自动尝试 master02、master01。

## 仍阻断 LM3-33 完成的条件

1. 由平台/安全团队提供生产等价的受支持 PV、跨故障域 S3 兼容对象存储、TLS CA、KMS/加密、
   版本化/不可变保留和 Secret Manager 注入；禁止把 worker-local hostPath、emptyDir 或临时
   自签名 mTLS 提升为生产方案。
2. 在隔离账户中从生产等价备份执行恢复，记录真实 backup ID、恢复目标、开始/结束时间、RPO、
   RTO、数据校验、支付渠道/内部账本/额度的三方对账，以及损坏备份和归档失败告警测试。
3. 将恢复窗口与容量压测纳入变更单，并修复 control-plane API/etcd 容量与 HA 路由问题；
   `DRAMAIP_KUBECTL_SERVER` 直连仅是临时编排绕过。
4. 经负责人批准后，完成一次不覆盖权威库的生产等价演练，再更新
   `LOOPMAP3.md` 中 LM3-33 状态为 `done`。在此前 LM3-34 生产 Gate 继续阻断。

生产资源准备好后，先运行 [production-cnpg-preflight.sh](../../dramaip-platform/deploy/recovery/production-cnpg-preflight.sh)
完成只读形态检查，再执行生产等价备份恢复和三方对账；预检本身不能替代恢复验收。

具体脚本、固定镜像摘要、运行顺序及安全边界见
[`dramaip-platform/deploy/recovery/README.md`](../../dramaip-platform/deploy/recovery/README.md)。
