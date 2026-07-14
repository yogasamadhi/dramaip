# PostgreSQL 灾备与恢复（LM3-33）

本目录定义生产 PostgreSQL 的备份恢复边界，并提供一个不连接业务库的物理
WAL/PITR 演练脚本。它不替代生产数据库运维平台，也不会生成、保存或提交任何
数据库、对象存储或 KMS 凭据。

## 默认恢复目标

在正式生产变更单另行批准前，DramaIP 采用以下不可放宽的默认目标：

- RPO：不超过 15 分钟；连续 WAL 归档必须在 60 秒内尝试一次，并在连续 5 分钟失败时告警。
- RTO：不超过 60 分钟；每个生产等价数据集至少每季度完成一次隔离恢复演练。
- 恢复范围：订单/支付账本、订阅周期和 quota 账本必须恢复到同一时间点；恢复后运行三方对账。

这些是 LM3-33 的工程默认值，不表示目前临时 staging 已达到生产 SLA。若业务需要
更严格目标，必须在启用真实支付前以变更单更新本文件和容量估算。

## 生产拓扑要求

1. 使用受支持的 PostgreSQL HA 方案（云托管 HA 或经平台团队批准的 operator）；不得使用
   chart 的 `devInfra`、`emptyDir` 或单节点 `hostPath` PostgreSQL。
2. 全量/差异备份和连续 WAL 必须写入独立故障域的 S3 兼容对象存储；对象存储凭据、KMS
   key reference 和 TLS CA 只由 Secret Manager 注入。
3. 备份须启用仓库端加密（KMS 或等价的已审计客户端加密）、保留策略和不可变/版本化配置；
   不得把 bucket、access key、私钥或恢复数据提交到 Git。
4. 恢复只能在隔离 namespace/账户执行，先验证账本一致性，再经明确批准切换流量；禁止用
   未验证恢复库覆盖权威生产库。

当前集群没有生产持久卷方案、独立故障域对象存储或 KMS/Secret Manager 集成；唯一的
`dramaip-recovery-local` StorageClass 和 PV/PVC 是本目录创建的临时 worker-local hostPath。
2026-07-14 按 Secret 名称进行的只读审计未发现对象存储、Barman、KMS 或备份凭据引用。
因此它只能运行本目录的隔离演练，不能作为生产 HA 或异地存储的证据。

## 原生 PITR 演练

在 Docker 可用的**本地工作站或 worker**运行：

```bash
export DRAMAIP_PITR_DRILL_AUTHORIZED=1
export DRAMAIP_PITR_DOCKER_SUDO=1 # 仅当 docker 需要 sudo
export DRAMAIP_PITR_IMAGE=docker.m.daocloud.io/library/postgres:18-alpine
# 可选；默认 3600（60 分钟），脚本会以非零状态报告超时
export DRAMAIP_PITR_RTO_SECONDS=3600
bash deploy/recovery/postgres-pitr-drill.sh
```

脚本会创建独立 Docker network、四个随机命名的 volumes 与两个 PostgreSQL 容器：先生成
物理 base backup 和独立 WAL archive，再恢复到第二笔支付写入之前。脚本记录源库的墙钟时间，
并在保留事务提交后立即创建 PostgreSQL 命名恢复点（同时输出其 WAL LSN）；它要求恢复库保留
同一事务内的 payment/subscription/quota 三条记录，并排除后续记录。任何失败都会返回非零，所有
临时容器和 volumes 在退出时删除。

该演练固定使用 PostgreSQL 18 镜像；其数据卷必须挂载在 `/var/lib/postgresql`，不能沿用
旧镜像的 `/var/lib/postgresql/data` 挂载方式。升级主版本时必须先重新验证并更新演练脚本，
不能以复用旧卷代替受控的 `pg_upgrade` 或恢复流程。

## 最近隔离验证

2026-07-14 在本机 Docker 上完成一次 PostgreSQL 18 隔离演练：物理 base backup、独立 WAL
归档和命名恢复点均成功；恢复用时 75 秒（RTO 上限 3600 秒），`payment_ledger`、
`subscription_periods` 与 `token_ledger` 的保留事务均存在，目标点后的支付事务不存在。脚本退出后
检查确认没有残留 `dramaip-pitr-*` 容器、卷或网络。

该证据只证明可重复的本地/worker 演练，不证明当前临时 staging 或集群已经具备生产 HA、异地
备份、加密、保留或生产恢复能力。

## 临时 K8s HA 演练

`temporary-cnpg-ha-staging.sh` 使用固定的 CloudNativePG 1.30.0 和 PostgreSQL 18.4，在三个
worker 的独立 hostPath PV 上创建三实例流复制集群。控制平面节点带 `NoSchedule` taint，集群
清单也显式选择 `node-role.kubernetes.io/worker=worker` 并要求 hostname 反亲和。

```bash
export DRAMAIP_CNPG_STAGING_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-ha-staging.sh
```

执行前应在每个 worker 导入已审核的 `ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0` 和
`ghcr.io/cloudnative-pg/postgresql:18.4-minimal-trixie` 镜像，或确认节点可可靠拉取它们。脚本只
安装并等待 HA 集群就绪；故障切换与对象存储恢复仍需分别执行和记录。

构建机是 arm64 而 worker 是 amd64 时，必须显式拉取并导入 `linux/amd64` 镜像，不能复用本机
默认拉取的 arm64 层。导入完成后应在每个 worker 以镜像运行 `uname -m`，确认输出为 `x86_64`，
再启动 CNPG。此次演练使用的 operator 和 PostgreSQL 镜像均已按该方式验证。

在首次创建 PV 前，须在每个对应 worker 预创建目录，并设为 CNPG PostgreSQL 运行的数字
UID/GID `26:26`、权限 `0700`；例如对 `cnpg-worker01` 执行
`sudo mkdir -p /var/lib/dramaip-recovery-staging/cnpg-worker01 && sudo chown 26:26 /var/lib/dramaip-recovery-staging/cnpg-worker01 && sudo chmod 0700 /var/lib/dramaip-recovery-staging/cnpg-worker01`。
清单使用 `hostPath.type: Directory`，会在缺少该前置条件时失败，而不是由 kubelet 生成一个
root 所有的目录后让 initdb 以模糊的权限错误失败。

如控制平面不能可靠访问 GitHub，可先在可信构建机下载并校验官方 `cnpg-1.30.0.yaml`，同步到
release 工作区后设置 `DRAMAIP_CNPG_OPERATOR_MANIFEST_PATH=/path/to/cnpg-1.30.0.yaml`；脚本将使用
该本地固定清单而不再联网下载。临时演练脚本只在自己的临时副本中把 Operator 的
`imagePullPolicy` 从 `Always` 改为 `IfNotPresent`，以使用预导入的 amd64 镜像；不会修改该官方
清单文件，也不应把该策略复制到生产配置。

`temporary-cnpg-ha-infra.yaml` 的 hostPath PV 只用于临时演练，不能作为生产持久化层或异地备份。
`temporary-cnpg-ha-failover.sh` 在该临时 namespace 写入一条专用账本标记、等待两个 streaming
副本后删除当前 primary Pod，只有新 primary 可读到该标记才通过。它不会触碰 `dramaip-staging`
或任何业务数据库：

```bash
export DRAMAIP_CNPG_FAILOVER_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-ha-failover.sh
```

2026-07-14 的隔离验证使用 CNPG 1.30.0 与 PostgreSQL 18.4：三实例分别在 worker03、worker02、
worker01 就绪。写入专用账本标记并确认两个 streaming 副本后，删除 worker03 上的 primary；23 秒内
worker02 自动成为新 primary，且读取到了原 primary 写入的标记。强化后的脚本又删除了 worker02
主库，worker03 在 6 秒内接管、读取到了标记，并等待 worker02 重新加入至集群 3/3 Ready。这证明
当前临时 worker 环境中的流复制、自动提升、重新加入和已复制数据连续性；它不证明异地备份、加密、
备份保留、目标 RPO/RTO 或生产 HA。

正式环境必须以受支持的持久卷方案、跨故障域对象存储和 Secret Manager 注入替换它们。

生产演练还必须记录：备份 ID、目标时间、开始/结束时间、恢复数据校验、三方对账结果、
告警状态和批准人。真实 bucket、KMS、HA endpoint 和生产恢复窗口未提供前，不得把本地
演练称为异地备份或生产 PITR 验收。
