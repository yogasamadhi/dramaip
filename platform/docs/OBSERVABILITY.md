# Platform 可观测性 Runbook

Platform 的固定数据流如下，Desktop 不接入此栈：

- Metrics：Java `/actuator/prometheus` → Prometheus → Grafana。
- Logs：Compose/Kubernetes stdout 与宿主机 Java NDJSON → Alloy → Loki → Grafana。
- Traces：OpenTelemetry Java Agent → Alloy OTLP → Tempo → Grafana。

应用只通过 OTLP 发送 trace；`OTEL_METRICS_EXPORTER=none`、`OTEL_LOGS_EXPORTER=none`，避免与 Prometheus 拉取和 stdout 采集重复。传播格式为 `tracecontext,baggage`，默认 sampler 为 `always_on`。Authorization、Cookie、Set-Cookie、password/passwd、secret、API/private key、credential、token、PIN、Prompt、请求/响应正文、用户/actor/owner 标识和第三方凭据不得进入日志、Loki 标签或 structured metadata、Trace resource/span/event 属性及告警标签。数据库 instrumentation 保持 query sanitization，HTTP instrumentation 不捕获请求 header；Alloy 的 Trace processor 还会删除 URL/query、异常 message/stacktrace，以及属性名中包含上述敏感类别的属性；日志管道用更宽的敏感模式整条拒绝记录。这是纵深防御，不是允许应用先发送敏感数据。

## 本地启动与入口

```bash
cd platform
make platform-observability-up
make platform-observability-smoke
make platform-observability-down
```

首次切换到新栈时，`platform-observability-up` 使用 `--remove-orphans` 停止旧配置遗留的容器，但不会删除任何数据目录。

| 组件 | 本地入口 | 用途 |
| --- | --- | --- |
| Prometheus | `http://127.0.0.1:9090` | metrics、targets、rules |
| Alloy | `http://127.0.0.1:12345` | 采集状态；OTLP 为 `4317/4318` |
| Loki | `http://127.0.0.1:3100` | LogQL/API |
| Tempo | `http://127.0.0.1:3200` | TraceQL/API |
| Grafana | `http://127.0.0.1:3000` | 统一 Explore 与 Dashboard |

所有管理端口和 OTLP 端口只绑定 loopback。Prometheus 数据保留 15 天；本地 Loki 与 Tempo 保留 720 小时。Alloy positions/state、Loki、Tempo 和 Grafana 数据分别位于 `deploy/docker-drama/docker-data/{alloy,loki,tempo,grafana}`。本地 Docker 日志发现需要挂载 Docker socket；这是受信任开发机边界，socket 的只读挂载不等于 Docker API 只读，不能把该 Compose 配置直接用于共享或生产主机。Kubernetes 使用 namespace-scoped RBAC，不挂 Docker socket。

本地 Compose 与 Helm 内置栈没有 Alertmanager。Prometheus Rules 页面与 Grafana 是本地告警查看入口，不表示通知已经送达外部系统；生产通知只由运维平台的外部 Alertmanager 负责。

## 关联排障

Grafana 固定数据源 UID 为 `dramaip-prometheus`、`dramaip-loki` 和 `dramaip-tempo`。Loki 从 JSON `service` 生成低基数 `service_name` 索引标签；`trace_id`、`span_id`、`request_id`、`operation` 只作为 structured metadata。Loki 的 `trace_id` derived field 可直接打开 Tempo；Tempo 以 `service.name → service_name` 查询日志，并以 `service.name → service` 关联 Prometheus 指标。

Trace resource 只使用部署元数据：`service.name`、固定的 `service.namespace=dramaip-platform`、镜像 tag 对应的 `service.version`、namespace 对应的 `deployment.environment.name` 和 Helm/Compose release 对应的 `dramaip.release`。手工业务 span 只加入经过字符集和长度约束的 `dramaip.operation`、`dramaip.outcome`、`error.type` 以及同样安全的环境/版本信息；不得把 event payload、业务主键、用户标识、幂等键或自由文本变成 resource/span 属性。生产排障按低基数属性过滤，再用日志或持久化审计中的 `trace_id` 定位，不能靠扩大敏感属性采集范围。

异步与消息链路遵循两种相关机制，不能混为一谈：

- 应用内 executor/virtual-thread 切换必须同时传播当前 OpenTelemetry `Context`，MDC 只复制已校验的 `request_id` 与 `trace_id`；不得复制任意 MDC map。当前 AI 流式输出和灵感后台任务使用该快照边界。
- Outbox 写入与业务写入同属本地事务，事件记录保留 `traceId` 用于持久化审计；`*.outbox.enqueue` 内部 span、metric 和日志只记录受限的 owner/event type/outcome，不记录 payload 或事件/聚合/用户 ID。
- RabbitMQ producer/consumer span 的父子关系依赖 Java Agent 在 AMQP message headers 中注入/提取 W3C context。事件信封中的 `traceId` 是跨存储、重试和 DLQ 的查询关联值，不代替 `traceparent`，也不得被解析成远程父上下文。消费端业务 span 必须位于提取后的 consumer context 内，重复、重试和失败只记录有限 outcome/failure class，消息正文不得成为 span 或日志属性。

常用 LogQL：

```logql
{service_name="gateway"} | json | level=~"(?i)(warn|error)"
{service_name=~"gateway|identity"} | trace_id="<trace-id>"
{service_name=~".+"} | request_id="<request-id>"
```

常用 TraceQL：

```traceql
{ resource.service.name = "gateway" && status = error }
{ trace:id = "<trace-id>" }
```

Tempo 的精确 Trace API 为 `GET /api/v2/traces/<trace-id>`；Loki 范围查询为 `GET /loki/api/v1/query_range`。不生成或承诺 service-graph metrics，本次链路入口是 Tempo Explore、日志内链和指标关联。

## Helm 环境边界

统一 values 接口为：

- `observability.enabled`
- `observability.otlp.endpoint`
- `observability.otlp.headersSecretName` / `headersSecretKey`
- `observability.traces.sampler` / `samplerArg`
- `observability.prometheus.scrape`
- `observability.alerting.enabled` / `notificationRoute`
- `observability.alerting.prometheusRule.labels`
- `observability.embedded.enabled` / `retention` / `terminationGracePeriodSeconds`
- `observability.embedded.networkPolicy.enabled`
- `observability.embedded.grafana.*`
- `observability.embedded.images.*` / `storage.*` / `resources.*`

`sampler` 只接受 `always_on`、`always_off`、`traceidratio`、`parentbased_always_on`、`parentbased_always_off`、`parentbased_traceidratio`。只有两个 ratio sampler 必须设置 `samplerArg`，取十进制字符串 `0`–`1`；其他 sampler 的 `samplerArg` 必须为空。Chart 分别映射到 `OTEL_TRACES_SAMPLER` 和（非空时）`OTEL_TRACES_SAMPLER_ARG`。修改采样率会改变 trace 完整度，但不改变 metrics/logs 采集，也不能作为敏感数据过滤措施。

`values-dev.yaml` 与经授权的 `values-staging-temporary.yaml` 启用单副本内置 Prometheus、Alloy、Loki、Tempo、Grafana。内置栈不创建 Ingress，仅创建 ClusterIP；临时 staging 使用有大小限制的 `emptyDir`，所以实际保留期不超过 namespace 生命周期。开发环境启用 persistence 时复用 `devInfra.persistence.hostPathBase/observability/*`。

内置五个组件都使用 `observability.embedded.resources.<component>.requests/limits` 和 `storage.<component>` 的显式预算；`storage` 是 `emptyDir.sizeLimit`，启用持久化 `hostPath` 后不构成磁盘配额。Prometheus 固定 TSDB 保留 15 天，Loki/Tempo 使用 `retention`，实际可用历史仍受磁盘容量、Pod/namespace 生命周期和外部平台策略限制。

内置 Grafana 禁用匿名访问，只从 Kubernetes Secret 读取管理员用户名和密码。设置 `observability.embedded.grafana.existingAdminSecret` 时，Secret 必须预先存在并包含 `adminUserKey`/`adminPasswordKey` 指定的不同 key；留空时 Chart 创建 `<release>-dramaip-platform-grafana-admin`，生成随机密码并在后续升级中复用现有值。只能通过获批的 Secret 读取流程取凭据，不能写入 values、命令行、日志或文档。

`observability.embedded.networkPolicy.enabled=true` 默认创建 ingress-only NetworkPolicy：五个观测 Pod 只接受同 namespace、同 Helm release 标签的 Pod 流量；它不限制 egress，也不替代集群级网络、身份或租户隔离。内置服务仍为 ClusterIP，操作员访问使用 `kubectl port-forward`。

持久化内置栈使用 `<hostPathBase>/observability/{prometheus,alloy,loki,tempo,grafana}`，是单节点开发存储，不是共享卷。在多节点集群必须用 chart 顶层 `nodeSelector`/`affinity` 将整个单副本 release 固定到准备了该路径的同一节点，并配置相容 toleration；否则重调度会看到另一台机器的空目录或旧数据。该模式不能作为普通 staging/production 的高可用或灾备方案。

内置 Alloy 使用 namespace-scoped ServiceAccount/Role/RoleBinding，只通过 Kubernetes API发现当前 namespace、当前 release 标签下的 Pod 并读取日志。它不需要节点日志目录或特权权限。

普通 staging/production 不渲染第三方观测工作负载。应用 Pod 只输出结构化 stdout、暴露带 Prometheus annotations 的 Actuator metrics，并发送 OTLP trace；外部 Alloy、Prometheus、Loki、Tempo、Grafana 的可用性、高可用和对象存储由运维平台负责。非临时发布必须设置：

```bash
export DRAMAIP_OTEL_ENDPOINT='https://alloy.example.internal:4318'
export DRAMAIP_ALERT_NOTIFICATION_ROUTE='platform-primary'
# 可选；Secret 的值不进入 values、命令输出或仓库
export DRAMAIP_OTEL_HEADERS_SECRET_NAME='dramaip-otel-headers'
export DRAMAIP_OTEL_HEADERS_SECRET_KEY='OTEL_EXPORTER_OTLP_HEADERS'
```

`DRAMAIP_OTEL_ENDPOINT` 必须是无空白的绝对 `http://` 或 `https://` URL，authority 必须含合法的 DNS/IP host，可选端口必须在 `1-65535`，且不得包含 `user:password@` 等 userinfo；发布脚本拒绝空 host、`.`、非法 DNS label、非法端口或 userinfo 时不会回显原值。OTLP 认证只允许通过 `DRAMAIP_OTEL_HEADERS_SECRET_NAME`/`DRAMAIP_OTEL_HEADERS_SECRET_KEY` 指向的 Kubernetes Secret 注入，不得放入 endpoint、values、命令行或普通环境变量。Secret 的键值内容应是 Java Agent 接受的 OTLP header 字符串。第三方观测镜像不属于 `deploy/release/images.tsv`。

## 生产告警通知契约

DramaIP Helm chart 只发布 `monitoring.coreos.com/v1` `PrometheusRule`，不安装 Prometheus Operator、Prometheus 或 Alertmanager。普通 staging/production 发布前，集群必须已经安装 `prometheusrules.monitoring.coreos.com` CRD，且外部 Prometheus 的 selector 必须选择带有 `observability.dramaip.io/rule-set=platform` 标签的规则资源。发布脚本要求 `DRAMAIP_ALERT_NOTIFICATION_ROUTE`，并在每条规则上固定加入：

- `team=dramaip-platform`
- `dramaip_release=<Helm release>`
- `notification_route=<DRAMAIP_ALERT_NOTIFICATION_ROUTE>`

外部 Alertmanager 必须有基于 `notification_route` 标签的路由，并把该值转交给经批准的 receiver。路由名称只允许字母、数字、点、下划线、冒号和连字符。receiver、通知凭据、静默、抑制和高可用均由运维平台管理，不进入业务 Helm chart。存在 `PrometheusRule` 只证明规则已发布；外部 Prometheus 已加载规则且 Alertmanager 已加载对应路由，才构成通知链路验收。验收是只读的，不发送测试告警。

发布后由操作员运行：

```bash
export DRAMAIP_SMOKE_AUTHORIZED=1
export SMOKE_BASE_URL='https://api.staging.example.com'
export DRAMAIP_ALERT_NOTIFICATION_ROUTE='platform-primary'
export SMOKE_PROMETHEUS_URL='https://prometheus.example.internal'
export SMOKE_ALERTMANAGER_URL='https://alertmanager.example.internal'
export SMOKE_RATE_LIMIT_TEST=1
export SMOKE_RATE_LIMIT_ATTEMPTS='<大于已配置每分钟限额的次数>'
platform/deploy/release/staging-smoke.sh staging
```

`staging-smoke.sh` 依次只读确认 release 的唯一 `PrometheusRule` 精确包含预期 21 条告警、两组 DramaIP rules 已出现在外部 Prometheus `/api/v1/rules` 且每条都是 `type=alerting`、`health=ok`、`lastError` 为空并带正确 labels，再通过 `/api/v1/alertmanagers` 确认 Prometheus 至少发现一个 active Alertmanager。最后它确认 Alertmanager `/-/ready` 可用，并把 `/api/v2/status` 中的原始配置作为 YAML 解析，递归确认获批 `notification_route` 的精确 matcher 与一个实际定义的 receiver 位于同一路由路径（子路由可继承父 receiver）；配置中分别出现 route 字符串和 receiver 名称不足以通过。它不会创建 silence、写入 Alertmanager API 或发送真实/合成告警。速率限制探测仍会生成真实 HTTP 流量，必须单独显式授权。

Prometheus 或 Alertmanager 需要认证时，只支持 curl header 文件注入；不得把 token、用户名/密码放入 URL、命令参数或普通环境变量：

```bash
# 文件内容示例：Authorization: Bearer <token>
export SMOKE_PROMETHEUS_AUTH_HEADER_FILE='/run/secrets/prometheus-smoke-header'
export SMOKE_ALERTMANAGER_AUTH_HEADER_FILE='/run/secrets/alertmanager-smoke-header'
```

两个文件必须可读且非空。smoke 只把文件路径交给 curl，禁止读取用户 curl 配置，不回显文件内容或 Alertmanager 原始配置。TLS 私有 CA 继续通过 `SMOKE_CA_FILE` 以文件方式提供。

仅当 staging 使用已授权的 `DRAMAIP_TEMPORARY_STAGING_INFRA=1` 内置临时观测栈时，smoke 才跳过外部 Prometheus/Alertmanager 通知检查；production 不允许该例外。内置栈仍加载同源规则用于页面查看，但没有 Alertmanager，因此不具备通知送达保证。

## 旧本地数据

新栈不会读取、转换或自动删除旧 Jaeger/Filebeat/Elasticsearch 目录，回滚到旧提交时它们仍可使用。确认不再需要并自行备份后，可在 Compose 已停止时逐目录删除；以下操作不可恢复：

```bash
rm -rf platform/deploy/docker-drama/docker-data/jaeger
rm -rf platform/deploy/docker-drama/docker-data/filebeat
rm -rf platform/deploy/docker-drama/docker-data/elasticsearch
```

## 告警处置

### target-down

`DramaipTargetDown` 表示 Java、RabbitMQ、Alloy、Loki 或 Tempo target 连续两分钟不可达。先看 Prometheus Targets；宿主机局部服务模式下确认 `server/target/local-dev/prometheus-targets/` 只包含实际启动的 JVM。

### request-error-rate

`DramaipHighRequestErrorRate` 表示某服务五分钟错误比例超过 5% 且有足够流量。按 `service` 查看 `dramaip_requests_total` 和 `dramaip_errors_total`，再从错误日志的 `trace_id` 打开 Tempo。

### payment-confirmation

`DramaipPaymentConfirmationFailed` 表示 billing 付款确认失败。检查 `dramaip_business_events_total{event="payment_confirmation"}`、订单状态和 billing outbox；不要在未确认幂等键和对账状态前重放订单。

### quota-rejections

`DramaipQuotaRejectionsHigh` 表示十分钟内 quota 拒绝超过阈值。比较 `accepted`、`rejected`、`replayed` 的有限 outcome，并核对 token account、余额与并发预留。

### outbox-backlog

`DramaipOutboxBacklog` 表示 billing 未发布 outbox 事件超过 100。先看 RabbitMQ 与 billing 消费者，再检查事件投递失败；服务重启不会清空该持久化积压。

### rabbitmq-backlog

`DramaipRabbitMQQueueBacklog` 表示 ready 消息超过 1000。核对 queue、消费者数和死信，不要通过删除队列掩盖兼容性问题。

### database-pool

`DramaipDatabasePoolSaturated` 表示 Hikari 活跃连接超过上限的 80%。比较 `dramaip_db_connections`、`dramaip_db_max_open_connections`、`dramaip_db_wait_count`，再用 trace 诊断慢调用；SQL 参数不应被导出。

### provider-failure

`DramaipProviderFailureRate` 表示 AI provider 失败比例超过 10%。按 provider 查看 `dramaip_provider_requests_total`、服务健康、quota 补偿和 request audit；日志中不得包含 Prompt 或凭据。

### provider-latency

`DramaipProviderLatencyHigh` 表示 provider 平均时延超过 15 秒。比较 duration count/sum 与 Tempo 外部调用 span，区分网络、provider 排队和本地 quota 处理。

### provider-cost

`DramaipProviderCostAlert` 表示出现新的 provider 成本防护事件。按有限 `event` 查看审计记录，不得在告警标签或日志中暴露用户和 Prompt。

### error-aggregation

`DramaipErrorAggregationHigh` 表示十分钟内某个 `service`/错误 `class` 超过 10 次。用 `dramaip_errors_total` 确认类别，再以 request/trace ID 在 Loki 和 Tempo 定位；任何敏感载荷出现在日志中都应作为缺陷处理。

### alloy-trace-export-failures

`DramaipAlloyTraceExportFailures` 表示 Alloy 向 Tempo 发送 span 的失败计数增加。先检查 Tempo `/ready`、Alloy 的 `otelcol_exporter_queue_size` 和 Alloy 日志，再确认 `tempo:4317` 可达。不要仅通过重启 Alloy 清空内存队列来掩盖持续的网络或 Tempo 写入故障。

### alloy-trace-queue

`DramaipAlloyTraceQueueSaturated` 表示 Alloy trace exporter 队列连续五分钟超过容量的 80%。比较 `otelcol_exporter_queue_size` 与 `otelcol_exporter_queue_capacity`，同时查看 `otelcol_exporter_send_failed_spans_total`。队列接近容量意味着 Tempo 故障或吞吐不足即将转化为 span 丢失。

### alloy-log-write-drops

`DramaipAlloyLogWriteDrops` 表示 Alloy 在重试耗尽后永久丢弃了日志。检查 `loki_write_dropped_entries_total`、Loki `/ready` 和 Alloy 日志，确认 Loki 写入端点与本地磁盘状态；计数器增加即代表对应日志无法补回。

### alloy-log-write-retries

`DramaipAlloyLogWriteRetriesHigh` 表示五分钟内 Loki batch 写入重试超过 10 次。短暂重试不一定造成数据丢失，但持续增长通常是 Loki 不可达、响应过慢或限流的前兆；结合 `loki_write_sent_entries_total` 和 dropped entries 判断是否已经影响数据完整性。

### sensitive-log-rejected

`DramaipSensitiveLogRejected` 表示 Alloy 检测到包含已知凭据、Cookie、Prompt、请求正文或用户标识字段的日志，并在进入 Loki 前拒绝了整条记录。按生产者服务检查应用日志代码并移除敏感字段；不要通过放宽 Alloy 过滤规则来让告警消失。被拒绝的内容不应复制到工单、聊天或其他日志中。

### loki-discards

`DramaipLokiDiscardingLogs` 表示 Loki 拒绝或丢弃了日志。按 `reason` 查看 `loki_discarded_samples_total`，检查行大小、时间戳、速率及 stream 限制。修复产生异常日志的源头或容量限制，不要把 `trace_id`、`request_id` 等高基数字段提升为索引标签。

### loki-wal-corruption

`DramaipLokiWalCorruption` 表示 Loki 在 WAL 中检测到损坏。立即保留 Loki 日志和数据目录的副本，确认宿主机文件系统、非正常终止和剩余空间；Loki 可能只能恢复未损坏部分，因此需要用上游日志源与业务事件评估数据缺口。

### loki-wal-disk-pressure

`DramaipLokiWalDiskPressure` 表示 WAL 所在文件系统使用率连续五分钟超过 90%。本地阈值会在 98% 时拒绝写入，应在达到该保护线前释放非观测数据、扩大磁盘或缩短本地保留期。不要直接删除活动 WAL 文件。

### loki-wal-write-failures

`DramaipLokiWalWriteFailures` 表示 Loki 因磁盘满而拒绝或无法持久化 WAL 写入。先停止额外写入压力并恢复可用空间，再观察 `/ready` 和 `loki_ingester_wal_disk_usage_percent`；该计数器增加时必须按日志缺失事件处理。

### tempo-discards

`DramaipTempoDiscardingSpans` 表示 Tempo 丢弃了 span。按 `reason` 查看 `tempo_discarded_spans_total`：常见原因包括速率限制、非法 trace/span ID 或单条 trace 过大。再比较 Alloy 已发送 span 与 `tempo_distributor_spans_received_total`，定位丢弃发生在 Alloy→Tempo 传输还是 Tempo 入库阶段。
