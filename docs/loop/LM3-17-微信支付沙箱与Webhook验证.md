# LM3-17 微信支付沙箱与 Webhook 验证

## 信任边界与状态流

微信支付回调只经由 `POST /v1/webhooks/wechat-pay` 到 billing-service；它不经过 Web BFF，
也不使用浏览器 JWT。Kong 只做路由、限流与 1 MiB 请求体限制，不能修改 body。billing-service
以收到的原始字节构造 V3 签名串：

```text
Wechatpay-Timestamp + "\n" + Wechatpay-Nonce + "\n" + raw body + "\n"
```

验签、5 分钟时间窗与 AES-256-GCM resource 解密均通过后，服务先把 `event.id` 写入
`billing.webhook_events`。`provider + provider_event_id` 是收件箱幂等键，`raw_body`、签名元数据、
`out_trade_no`、`transaction_id` 和查询结果供审计和后续对账使用。

回调本身不激活任何权益。服务使用商户私钥签名调用
`GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid=...`，并且只在查询到相同的
`out_trade_no`、相同的 `transaction_id` 和 `trade_state=SUCCESS` 后，才复用 LM3-15 的支付激活
Saga。查询的 `appid`、`mchid`、金额（分）与币种还必须和本地 checkout 相符；随后
`order=paid`、payment、`subscription=quota_pending` 和 `payment.succeeded` outbox 才会在 billing
本地事务中写入，再幂等创建 quota period 并激活订阅。客户端的“支付成功”提示没有写状态的路径。

重复已处理事件直接返回成功；尚未处理的重复事件可以安全重试查询。验签失败、时间戳过期或 body
被篡改时，在写入收件箱之前以 `401` 拒绝。查询失败保留 `query_pending` 和错误，返回非 2xx 使
支付平台重试；订单、回调和审计记录不会被删除。

## 沙箱配置与上线前检查

本地 Compose 默认关闭渠道。复制 `services/.env.example` 后，仅在受控的本地密钥目录或密钥
挂载中提供以下变量；不要提交私钥、APIv3 key、商户号或平台证书：

```bash
WECHAT_PAY_ENABLED=true
WECHAT_PAY_APP_ID=...
WECHAT_PAY_MCH_ID=...
WECHAT_PAY_API_V3_KEY=...                 # 恰好 32 字节
WECHAT_PAY_CERT_SERIAL=...
WECHAT_PAY_PRIVATE_KEY_PATH=/secure/apiclient-key.pem
WECHAT_PAY_PLATFORM_CERT_SERIAL=...        # 与 Wechatpay-Serial 对应
WECHAT_PAY_PLATFORM_CERT_PATH=/secure/platform-cert.pem
WECHAT_PAY_NOTIFY_URL=https://<public-host>/v1/webhooks/wechat-pay
# 沙箱网关由运营方按微信支付文档提供时才覆盖；默认生产 API 地址。
WECHAT_PAY_API_BASE_URL=https://api.mch.weixin.qq.com
```

Helm 通过 `payment.wechat.enabled=true` 开启。必须设置
`payment.wechat.credentialsSecret`，其中包含 `api-v3-key`、`apiclient-key.pem` 和
`platform-cert.pem`（键名可由 values 覆盖），并设置 `payment.wechat.platformCertificateSerial`；该
Secret 仅挂载到 billing workload。`Wechatpay-Serial` 必须和此配置完全匹配，才能使用该证书验签。
启用后 chart
会创建只匹配 `/v1/webhooks/wechat-pay` 的 billing Ingress，并附加独立限流和大小限制插件；不附加
CORS 或 JWT 插件。

官方沙箱操作顺序：创建可用的 native-payment 沙箱商户配置 → 通过已认证的 Web checkout 选择
`provider=wechat_pay` → 扫描返回的 `code_url` 完成付款 → 在支付平台侧确认 callback 为 2xx → 核对
`billing.orders`、`billing.payments`、`billing.webhook_events`、`billing.subscriptions`、
`quota.token_accounts` 与 outbox/消费者记录。付款页或前端回跳不能作为成功证据；只有上述服务端查询
和 Saga 终态才可判定成功。

## 自动验证

```bash
cd dramaip-platform/services

# 协议签名、篡改、过期、native 下单请求签名、服务端查询和 handler replay/mismatch。
GOCACHE=/tmp/dramaip-go-build go test ./app/billing/internal/wechat \
  ./app/billing/service/internal/server

# 必须是全新隔离 PostgreSQL，DDL 用户需要 CREATEROLE。
POSTGRES_WECHAT_WEBHOOK_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_wechat_webhook?sslmode=disable' \
  make billing-wechat-webhook-integration
```

该自动集成测试完整回放 migration 026，覆盖 webhook 收件箱、query-confirmed 审计、重复回调、一次
payment/订阅/outbox 写入与 `processed` 终态。它不替代持有真实微信支付沙箱商户凭据后的官方端到端
演练；在该外部凭据可用前，不得把结果当作真实渠道开通或生产支付证据。

## 回滚

关闭 `WECHAT_PAY_ENABLED` 并撤销 webhook Ingress/Kong route 可停止新微信请求；不要删除
`billing.webhook_events`、orders、payments、subscriptions 或 outbox。026 只新增审计列和索引，回滚
应用版本时仍应保留历史回调和 `query_pending` 记录，交由后续对账或人工处理流程处理。
