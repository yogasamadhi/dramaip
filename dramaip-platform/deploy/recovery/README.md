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

## 临时 CNPG 对象存储与 PITR 演练

在 HA 演练完成后，`temporary-cnpg-object-store-staging.sh` 仅在 worker01 创建一个 8Gi `emptyDir`
MinIO、临时 bucket 和临时 S3 Secret。它使用预导入的 `dramaip-recovery-minio:amd64` 与
`dramaip-recovery-mc:amd64`，并固定 `imagePullPolicy: Never`；因此不会从任一控制平面拉取或运行
镜像。`temporary-cnpg-object-store-backup-cluster.yaml` 才会把 HA 集群切换到包含
`barman-cloud-backup` 的 `ghcr.io/cloudnative-pg/postgresql:18.4` 完整 amd64 镜像，并启用 gzip
base backup、gzip WAL、单并发上传和临时 `7d` 策略。

完整镜像与 MinIO/MC 镜像均须先按 `linux/amd64` 导入相应 worker。恢复还需要在 worker01 预创建
`/var/lib/dramaip-recovery-staging/cnpg-restore-worker01`，设为 `26:26`、`0700`；恢复脚本随后才会
创建专用 PV。应先在 arm64 构建机运行 `prepare-cnpg-object-store-images.sh`，它固定 CNPG PostgreSQL
18.4（digest `17760…6789f`）、MinIO（`14cea…8936e`）和 MC（`a7fe3…11727`），明确以 `linux/amd64`
导出 tar；在每个需要的 worker 用 `docker load` 后，以容器运行 `uname -m` 确认 `x86_64`。三个步骤
均要求独立的显式授权变量：

```bash
export DRAMAIP_CNPG_IMAGE_PREP_AUTHORIZED=1
bash deploy/recovery/prepare-cnpg-object-store-images.sh
```

随后执行：

```bash
export DRAMAIP_CNPG_OBJECT_STORE_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-object-store-staging.sh

export DRAMAIP_CNPG_OBJECT_STORE_BACKUP_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-object-store-backup.sh

export DRAMAIP_CNPG_PITR_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-object-store-pitr.sh
```

当前 2Gi 控制平面的 VIP 曾将 `kubectl` 请求转至高负载节点而出现 TLS 握手超时。脚本可选接收
`DRAMAIP_KUBECTL_SERVER=https://<已验证且在 API 证书 SAN 中的控制平面>:6443`，只在已验证本机
API 直连正常、VIP 不可用时绕过 VIP 执行编排；这不会把任何工作负载移到 master，也不是生产
控制平面拓扑的替代方案。

2026-07-14 的本次临时验证结果：Barman base backup `20260714T100031` 完成，命名恢复点
`cnpg-pitr-20260714t10001784023230z-777` 的 WAL 已归档（`archived_count=22`）。独立的
`dramaip-recovery-restore` 集群从该 backup ID 恢复到命名点，支付、订阅和 token 三张临时账本表
断言为 `1:1:1:0`（保留事务完整、目标点后事务缺失）。随后 `ScheduledBackup` 的 `immediate: true`
自动创建并完成了 owner 为该调度对象的 `dramaip-recovery-ha-hourly-20260714100630` Backup，证明
CNPG 控制器能调度后续 base backup。

CNPG 1.30 已在本次运行中警告原生 `barmanObjectStore` 将在 1.31 移除；它仅用于这次 1.30
兼容性演练。生产实施必须迁移至 Barman Cloud Plugin，并连接独立故障域、TLS、KMS 加密、版本化/
不可变和真实保留策略的对象存储。worker01 `emptyDir` MinIO、临时 Secret、测试 `7d` 策略以及本次
on-demand Backup 都不构成异地、加密、自动计划备份、损坏告警或生产 RPO/RTO 的证据。

## 临时 CNPG Barman Cloud Plugin 演练

CloudNativePG 1.30 对原生 `barmanObjectStore` 的弃用警告已在本次演练中实际出现，因此后续恢复
路径使用官方 Barman Cloud Plugin `v0.13.0`。插件清单以 SHA-256
`d2e71e7b…13213b0` 校验；控制器和 sidecar 镜像固定为
`71589d…b6c96`、`990361…bb288`，均明确以 `linux/amd64` 拉取。arm64 构建机只负责拉取、
导出 tar 和校验，worker 才导入并实际运行镜像；不得把本机默认 arm64 镜像直接交给 worker。

```bash
# 在 arm64 构建机：导出明确的 amd64 镜像包，并记录脚本输出的 SHA-256
export DRAMAIP_CNPG_PLUGIN_IMAGE_PREP_AUTHORIZED=1
bash deploy/recovery/prepare-cnpg-barman-plugin-images.sh

# 在可访问 worker 私网的受控发布主机：短暂 HTTP 分发 + worker-only DaemonSet 导入。
# 把 <tar-sha256> 替换为上一条命令实际输出；加载器验证后会自动删除。
export DRAMAIP_CNPG_PLUGIN_PRELOAD_AUTHORIZED=1
export DRAMAIP_CNPG_PLUGIN_IMAGE_TAR_SHA256=<tar-sha256>
bash deploy/recovery/preload-cnpg-barman-plugin-images.sh
```

加载器和插件 Deployment 都选择 worker；Deployment 固定在 worker01，使用
`imagePullPolicy: Never`、128Mi request / 256Mi limit。它不在任一 master 编译、拉取或运行
镜像。官方默认安装需要 cert-manager；本演练没有新增该控制器，而是生成 7 天有效、只存在
Kubernetes Secret 中的临时 mTLS 证书。生产必须改用受审计的 CA/cert-manager 或等价证书生命周期，
不能复用这些临时自签名证书。

```bash
export DRAMAIP_CNPG_PLUGIN_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-barman-plugin-staging.sh

# 创建与原生配置等价的 ObjectStore，并以一次 Cluster patch 切换为 plugin。
export DRAMAIP_CNPG_PLUGIN_MIGRATION_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-barman-plugin-migration.sh

# CNPG 1.30 已存在的 Pod 不会仅因这项配置立刻重建；受控重建两个 standby、再重建 primary。
# 每个新 Pod 必须有 restartable initContainer `plugin-barman-cloud`，最后一步验证 HA 提升。
export DRAMAIP_CNPG_PLUGIN_ROLLOUT_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-barman-plugin-rollout.sh

# 同一备份脚本保留 native 默认值；显式 method=plugin 时不会重新应用 native Cluster 清单。
export DRAMAIP_CNPG_OBJECT_STORE_BACKUP_AUTHORIZED=1
export DRAMAIP_CNPG_BACKUP_METHOD=plugin
bash deploy/recovery/temporary-cnpg-object-store-backup.sh

# 独立 worker02 恢复卷和 plugin PITR；绝不覆盖 source 或原生 PITR restore Cluster。
export DRAMAIP_CNPG_PLUGIN_RESTORE_STORAGE_AUTHORIZED=1
bash deploy/recovery/prepare-cnpg-plugin-pitr-restore-storage.sh
export DRAMAIP_CNPG_PLUGIN_PITR_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-barman-plugin-pitr.sh
```

2026-07-14 的隔离 plugin 证据：插件在 worker01 Ready 并被 CNPG operator 注册；受控重建后，三个
source Pod 均为 `2/2`（PostgreSQL + `plugin-barman-cloud` native sidecar），删除原 primary
worker03 的实例后，worker02 自动提升且集群回到 `3/3`。`method: plugin` Backup
`dramaip-recovery-ha-plugin-backup-20260714t10391784025547z-2890` 完成（backup ID
`20260714T103909`）；命名恢复点 `cnpg-plugin-pitr-20260714t10391784025547z-2890` 的 WAL 已归档，
plugin `ScheduledBackup` 亦即时派发。独立 worker02 Cluster 恢复到该点后，临时 payment、
subscription、token 账本断言为 `1:1:1:0`。

控制平面只有 2Gi 内存时，VIP 或某个 API 实例可能 TLS 握手超时。每个临时脚本均接受
`DRAMAIP_KUBECTL_SERVER`；仅在先用 `/readyz` 确认后，依次尝试 master03、master02、master01 的
直连端点。例如 master03 不可用而 master02 正常时使用
`DRAMAIP_KUBECTL_SERVER=https://192.168.2.202:6443`。这只是 kubectl 编排的故障绕过，不移动
control-plane 工作负载，也不替代生产 VIP/etcd/容量治理。

可用只读预检脚本自动选择第一个健康端点，并将结果传给后续脚本；默认顺序是
`master03 → master02 → master01`：

```bash
export DRAMAIP_KUBECTL_SERVER="$(bash deploy/recovery/select-kube-api.sh)"
echo "$DRAMAIP_KUBECTL_SERVER"
export DRAMAIP_CNPG_PLUGIN_AUTHORIZED=1
bash deploy/recovery/temporary-cnpg-barman-plugin-staging.sh
```

预检只访问各控制平面的 `/readyz`，不创建或删除资源。若需临时覆盖候选列表，可设置逗号分隔的
`DRAMAIP_KUBECTL_API_CANDIDATES`；端点必须是 `https://host:port`，仍按给定顺序检查。所有候选
均失败时脚本返回非零，调用方不得退回 VIP 盲目重试。

正式环境必须以受支持的持久卷方案、跨故障域对象存储和 Secret Manager 注入替换它们。

正式资源接入前可运行只读准入检查；它拒绝 `dramaip-staging`/`dramaip-recovery-staging`，不打印
Secret 内容，并检查 CNPG 至少三实例、生产 StorageClass/PVC、Barman Cloud Plugin、外部
ObjectStore、KMS 引用、不可变保留和 RPO/RTO。所有生产资源名与 KMS 引用必须由批准的运维环境
注入，不能写进 Git：

```bash
export DRAMAIP_CNPG_PRODUCTION_PREFLIGHT_AUTHORIZED=1
export DRAMAIP_CNPG_PRODUCTION_NAMESPACE=dramaip-production
export DRAMAIP_CNPG_PRODUCTION_CLUSTER=dramaip-postgres
export DRAMAIP_CNPG_PRODUCTION_STORAGE_CLASS=<approved-storage-class>
export DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE=<object-store-name>
export DRAMAIP_CNPG_PRODUCTION_OBJECT_STORE_SECRET=<secret-manager-secret-name>
export DRAMAIP_CNPG_PRODUCTION_KMS_KEY_REF=<kms-key-reference>
export DRAMAIP_CNPG_PRODUCTION_RETENTION_DAYS=30
export DRAMAIP_CNPG_PRODUCTION_IMMUTABLE_RETENTION=true
export DRAMAIP_CNPG_PRODUCTION_BACKUP_SCHEDULE='0 */6 * * *'
export DRAMAIP_KUBECTL_SERVER="$(bash deploy/recovery/select-kube-api.sh)"
bash deploy/recovery/production-cnpg-preflight.sh
```

该检查通过只是生产资源形态准入，不替代真实恢复、RPO/RTO、损坏备份告警和支付/billing/quota
三方对账证据。

生产演练还必须记录：备份 ID、目标时间、开始/结束时间、恢复数据校验、三方对账结果、
告警状态和批准人。真实 bucket、KMS、HA endpoint 和生产恢复窗口未提供前，不得把本地
演练称为异地备份或生产 PITR 验收。
