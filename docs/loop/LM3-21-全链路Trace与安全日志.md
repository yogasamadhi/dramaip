# LM3-21 全链路 Trace 与安全日志

本 Loop 建立应用侧的 trace 与日志安全边界，不改变支付、订阅、额度或 AI 的业务判定。

## 已交付

- HTTP（BFF 与 Kratos）、gRPC 和 Provider HTTP 全部使用 W3C `traceparent`；响应返回
  `X-Trace-Id`、`X-Request-Id`，gRPC 同时透传 request ID。
- billing outbox 从持久化 `trace_id` 恢复远程父上下文；RabbitMQ publish、retry、consume
  都创建 span 并携带 `traceparent` 与兼容 `trace_id`，使支付 Saga 的异步 worker 不再分裂为
  无关 trace。
- 所有 Kratos 服务请求写 JSON completion log；BFF、job、MQ dead-letter/retry 和 Provider
  失败使用相同字段。日志固定包含服务、环境、操作、时间、trace/request/span ID（存在时）和
  可选 user ID。
- 日志递归删除凭据、cookie、token、API key、密码、正文、prompt、payload、content 和
  provider 原始响应；Bearer、常见 secret 片段和含密码 DSN 也会二次脱敏。
- 增加 `make observability-smoke`。在健康 Compose 环境，它以固定 trace ID 验证
  `Kong -> Web BFF -> billing`、Jaeger 多服务 trace 和 OpenSearch 结构化日志。
- Docker Compose 中的 Jaeger、Collector、Prometheus、Grafana、OpenSearch 和 Dashboards
  管理端口均只绑定 loopback。内置 OpenSearch 是明确的本地开发栈；生产后端必须使用 TLS、
  认证、最小权限、索引隔离与生命周期策略，不能沿用禁用 security plugin 的 Compose 配置。

## 自动化证据

- `GOCACHE=/tmp/dramaip-go-race-lm3-20 go test ./...` 通过。
- `GOCACHE=/tmp/dramaip-go-race-lm3-20 go test -race ./...` 通过。
- `make event-contracts` 通过；`docker compose ... config`、`helm lint` 与带
  `devInfra.persistence.enabled=false` 的 Helm render 通过；smoke 脚本语法检查通过。
- 新增回归覆盖 HTTP/Kratos、gRPC、支付 outbox/MQ、AI Provider HTTP span 以及嵌套日志脱敏。

## 尚未作为通过证据的项目

2026-07-13 执行 `make observability-smoke` 时，`localhost:8000` 返回 `ECONNREFUSED`。
这是用户已有 Compose 栈缺少 PostgreSQL 后的故障状态；本 Loop 没有停止、重建或修改任何用户
容器。因此尚未取得 Jaeger/OpenSearch 人工查询或健康 Compose trace smoke 的运行证据。

在健康的隔离 Compose 或 staging 栈恢复后，必须重跑 `make platform-e2e`、
`make observability-smoke`，并人工确认：支付 Saga 的 BFF/billing/outbox/worker trace，AI 的
预扣/Provider/结算 trace，以及按 `service + trace_id` 查询的日志均不含正文或凭据。未完成前，
不得将本记录视为生产可观测性或真实支付发布证据。

回滚时可以停止 trace 导出或日志采集，但不得关闭应用侧脱敏，也不得删除账本、outbox、审计或
既有日志数据。
