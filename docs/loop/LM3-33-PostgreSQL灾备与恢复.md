# LM3-33 PostgreSQL 灾备与恢复

状态：**partial**

本记录是 LM3-33 的工程证据索引。它区分隔离演练与生产验收；临时 Docker、kind、MinIO 或
hostPath 资源都不能被表述为生产 HA、异地备份或灾备 SLA。

## 当前可复现证据

2026-07-20，在本地 Docker 中执行了不连接业务数据库的物理 WAL/PITR 演练：

```bash
DRAMAIP_PITR_DRILL_AUTHORIZED=1 \
DRAMAIP_PITR_IMAGE=docker.m.daocloud.io/library/postgres:18-alpine \
bash dramaip-platform/deploy/recovery/postgres-pitr-drill.sh
```

演练使用随机 `dramaip-pitr-*` 网络、容器与卷，在独立 PostgreSQL 18 数据库中写入同一事务内的
payment、subscription、quota 三条账本记录，创建命名恢复点，再写入一笔应排除的后续支付。
物理 base backup 与独立 WAL archive 恢复完成于 77 秒，低于默认 3600 秒的本地 RTO 检查；恢复
断言为 `1:1:1:0`，即三条保留记录均存在、后续支付记录不存在。结束后确认没有残留
`dramaip-pitr-*` Docker 容器、卷或网络。

同轮还通过了：

```bash
bash -n dramaip-platform/deploy/recovery/*.sh
```

仓库已具备以下受限演练资产：

- `postgres-pitr-drill.sh`：本地物理 base backup、WAL archive 和命名点恢复。
- `temporary-cnpg-ha-*`：三 worker 临时 CNPG 复制/自动提升演练。
- `temporary-cnpg-object-store-*` 与 `temporary-cnpg-barman-plugin-*`：临时 MinIO、Barman
  Cloud Plugin、备份、ScheduledBackup 与独立 PITR 恢复。
- `production-cnpg-preflight.sh`：只读检查生产 CNPG 的副本数、持久存储、外部对象存储、KMS
  引用、不可变保留、计划和 RPO/RTO 配置；它拒绝 staging/temporary 目标且不打印 Secret 内容。

完整运行边界与受限资源说明见
[`dramaip-platform/deploy/recovery/README.md`](../../dramaip-platform/deploy/recovery/README.md)。

## 当前阻断

当前工作站的 `kind-dramaip` kubeconfig 指向已停止的本地 API endpoint，因而没有把历史临时 CNPG
结果重写为本轮 Kubernetes 成功。更重要的是，生产等价对象存储、KMS/Secret Manager、跨故障域
持久卷、不可变保留、真实数据集、批准的 RPO/RTO、损坏备份告警以及支付/billing/quota 三方对账
窗口均未提供。

LM3-33 只有在获授权生产等价环境完成完整恢复、目标时间点恢复、账本对账和时间记录后才能标为
`done`。在此之前，LM3-34 与 LM4-30 必须继续把这些条件视为发布阻断。
