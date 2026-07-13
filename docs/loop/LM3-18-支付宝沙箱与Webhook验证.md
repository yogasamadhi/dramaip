# LM3-18 支付宝沙箱与 Webhook 验证

## 信任边界与状态流

支付宝当面付使用 `alipay.trade.precreate` 创建二维码订单；浏览器只得到 `qr_code`，不能确认或
激活支付。异步通知仅可通过 `POST /v1/webhooks/alipay` 到 billing-service，绕过 Web BFF、浏览器
JWT 和 CORS。Kong 对该精确路径只施加独立限流与 1 MiB 请求体限制，不能改写原始表单 body。

billing-service 把原始 `application/x-www-form-urlencoded` body 解析为无重复参数的表单，要求
`sign_type=RSA2`，对除 `sign` 外的所有非空参数按键名排序并使用支付宝公钥验签。验签、`app_id`、
`seller_id`、`notify_id`、金额和 `TRADE_SUCCESS` 均通过后，才把 `notify_id` 作为幂等键写入
`billing.webhook_events`。原始 body 保留在 `raw_body`；JSON 审计列只存订单、交易、状态和金额，避免
复制不需要的买方字段。

回调不直接激活订阅。服务以商户私钥签名调用 `alipay.trade.query`，仅在查询的 `out_trade_no`、
`trade_no`、`seller_id`、金额和 `TRADE_SUCCESS` 全部匹配回调及本地 checkout 后，才调用 LM3-15
支付激活 Saga。重复已处理的 `notify_id` 直接返回 `success`；伪造、重复字段、金额不符或查询不符
都不会激活权益。支付宝成功确认响应为 HTTP 200 文本 `success`，其他结果保持非 2xx，触发其重试。

协议依据：支付宝官方的 [`alipay.trade.precreate`](https://developer.alibaba.com/docs/api.htm?apiId=862&docType=4)
与[交易查询/订单号说明](https://developer.alibaba.com/docs/doc.htm?articleId=106448&docType=1&treeId=204)。

## 沙箱配置与上线前检查

Compose、Helm 和服务配置均默认关闭。复制 `services/.env.example` 后，只在受控密钥目录或
operator-managed Secret 挂载里配置下列变量，绝不提交私钥、公钥、App ID、seller ID、付款记录或
实际回调参数：

```bash
ALIPAY_ENABLED=true
ALIPAY_APP_ID=...
ALIPAY_SELLER_ID=...
ALIPAY_PRIVATE_KEY_PATH=/secure/alipay/app-private-key.pem
ALIPAY_PUBLIC_KEY_PATH=/secure/alipay/alipay-public-key.pem
ALIPAY_NOTIFY_URL=https://<public-host>/v1/webhooks/alipay
# 仅在运营方提供的沙箱网关下覆盖；默认生产网关。
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
```

Helm 通过 `payment.alipay.enabled=true` 开启。必须同时设置
`payment.alipay.credentialsSecret`，其中包含商户应用私钥和支付宝公钥（默认键名
`app-private-key.pem`、`alipay-public-key.pem`）；该 Secret 仅挂载到 billing workload。启用 chart
会创建只匹配 `/v1/webhooks/alipay` 的 billing Ingress，并附加独立限流/大小限制插件；不附加 CORS
或 JWT 插件。

实际沙箱验收顺序：创建已签约的当面付沙箱应用和密钥 → 使用已认证 checkout 请求
`provider=alipay` → 扫描 `payment_url` 对应二维码付款 → 在支付宝侧确认通知返回 `success` → 核对
`billing.orders`、`billing.payments`、`billing.webhook_events`、`billing.subscriptions`、
`quota.token_accounts` 与 outbox/消费者记录。前端跳转或付款页提示不能作为付款成功证据；只有主动
查询和 Saga 终态可以确认。

2026-07-13，项目所有者明确要求跳过真实付款后继续后续 loop。因此仓库中没有也不应加入支付宝
沙箱密钥、付款记录或公网回调记录；现有实现、自动化测试和部署接线可以交付，但不能据此宣称真实
支付宝渠道已经开通。任何未来把 `ALIPAY_ENABLED` 设为 `true` 的环境，都必须先执行上述演练。

## 自动验证

```bash
cd dramaip-platform/services

# RSA2 请求签名、预下单、交易查询、通知验签、金额精度及 handler 的伪造/重放/查询不符场景。
GOCACHE=/tmp/dramaip-go-build go test ./app/billing/internal/alipay \
  ./app/billing/service/internal/server

# 必须是全新隔离 PostgreSQL，DDL 用户需要 CREATEROLE。
POSTGRES_ALIPAY_WEBHOOK_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_alipay_webhook?sslmode=disable' \
  make billing-alipay-webhook-integration
```

自动测试验证入站审计、query-confirmed 状态、金额不符拒绝、一次 payment/订阅/outbox 写入和
`processed` 重放。它不替代持有真实支付宝沙箱凭据后的官方端到端演练，也不构成真实渠道开通或
生产支付证据。

## 回滚

关闭 `ALIPAY_ENABLED` 并撤销支付宝 webhook Ingress/Kong route 可停止新请求；不要删除
`billing.webhook_events`、orders、payments、subscriptions 或 outbox。保留 `query_pending` 审计记录，
交由 LM3-19 的对账和人工处理流程处理。
