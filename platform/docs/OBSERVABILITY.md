# 本地指标、告警与错误聚合

本 runbook 只适用于本地 Java 开发环境。Prometheus 保存 15 天，Jaeger Badger 保存 30 天；Elasticsearch、Grafana、Filebeat 与基础设施数据位于 `deploy/docker-drama/docker-data/`，保留到开发者显式执行 `make platform-observability-down` 或清理卷目录为止。没有 Alertmanager：告警在 Prometheus 和 Grafana 中查看。

排障的固定入口是 Prometheus `http://127.0.0.1:9090`、Jaeger `http://127.0.0.1:16686`、Kibana `http://127.0.0.1:5601`、Grafana `http://127.0.0.1:3000`。先按 `service`、`trace_id` 或 `request_id` 关联，再查看安全化的 JSON 日志；不得把请求正文、Prompt、Cookie、认证头或用户标识加入查询、指标标签或日志字段。

## target-down

`DramaipTargetDown` 表示 Java、RabbitMQ 或 Collector 的 scrape target 已连续两分钟不可达。先检查 Prometheus Targets，再检查对应 `/actuator/health` 或容器日志；宿主机模式确认 `server/target/local-dev/prometheus-targets/` 只包含实际启动的服务。

## request-error-rate

`DramaipHighRequestErrorRate` 表示某服务五分钟错误比例超过 5%，且流量足够。按 `service`、`operation` 查 `dramaip_requests_total` 和 `dramaip_errors_total`，用 trace ID 跳转 Jaeger，再在 Kibana 查同一 trace 的安全错误类别。

## payment-confirmation

`DramaipPaymentConfirmationFailed` 表示 billing 的模拟付款确认失败。检查 `dramaip_business_events_total{event="payment_confirmation"}`、订单状态和 billing outbox；不要重放未知订单，先由业务流程确认幂等键和对账状态。

## quota-rejections

`DramaipQuotaRejectionsHigh` 表示十分钟内超过 20 个 quota 拒绝。查看 `accepted`、`rejected`、`replayed` 三个有限 outcome，并核对 token account、余额和并发预留；`replayed` 不是新的业务成功。

## outbox-backlog

`DramaipOutboxBacklog` 表示 `billing.outbox_events` 中 `published_at is null` 超过 100。先查 RabbitMQ 与 billing 的消费者，再检查事件投递失败；该 Gauge 在 scrape 时查询持久化状态，服务重启不会把积压清零。

## rabbitmq-backlog

`DramaipRabbitMQQueueBacklog` 表示 ready 消息超过 1000。打开 RabbitMQ 管理台确认具体 queue、消费者数和死信情况；不要通过删除队列来恢复开发环境，先定位生产者/消费者版本兼容性。

## database-pool

`DramaipDatabasePoolSaturated` 表示 Hikari 活跃连接占最大连接数超过 80%。比较 `dramaip_db_connections`、`dramaip_db_max_open_connections` 和 `dramaip_db_wait_count`，然后使用 trace 和慢 SQL 诊断；SQL 参数不会被 OTel 导出。

## provider-failure

`DramaipProviderFailureRate` 表示 AI provider 失败比例超过 10%。按 provider 检查 `dramaip_provider_requests_total`、服务健康与上游可用性，随后核对 quota 补偿和 request audit 状态；日志中不应包含 Prompt 或 provider 凭据。

## provider-latency

`DramaipProviderLatencyHigh` 表示平均 provider 时延超过 15 秒。查看 `dramaip_provider_request_duration_seconds` 的 count/sum 和 Jaeger 外部调用 span，区分上游网络、provider 排队和本地 quota 处理。

## provider-cost

`DramaipProviderCostAlert` 表示出现新的 provider 成本防护事件。计数来自 `ai_gateway.provider_cost_alerts` 的持久化聚合，因此重启不会误触发；按 `event` 查审计记录，但不要在告警标签或日志中暴露用户与 Prompt。

## error-aggregation

`DramaipErrorAggregationHigh` 表示十分钟内某个 `service`/错误 `class` 超过 10 次。先用 `dramaip_errors_total` 聚合确认类别，再以请求 ID 和 trace ID 在 Kibana/Jaeger 中定位；异常信息应仅包含安全描述，任何敏感载荷都是缺陷而不是排障依据。
