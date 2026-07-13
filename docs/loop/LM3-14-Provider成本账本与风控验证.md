# LM3-14 Provider 成本账本与风控验证

用户 quota 与平台 Provider 成本是两本独立账。`quota` 仍是唯一的用户额度扣减权威；
`ai_gateway.provider_cost_logs` 只追加平台成本快照，供毛利、异常成本与 Provider 对账使用，
不参与用户额度的重算。

## 成本快照与预算保护

- migration 022 为每个 request audit 建立唯一的成本日志，记录 provider、实际 model、
  request/reservation 关联、输入/输出 token、每百万 token 单价、币种、CNY 汇率、原币及
  CNY 成本、计价来源、计价时间和 actual/estimated 状态。
- 网关在调用非 test Provider 前要求 provider/model 的价格和汇率配置；未知价格不会按零
  成本放行。test Provider 使用明确标识的固定 fixture 价格，仅供自动化验证。
- 调用前，以“已追加成本 + 未完成请求的保守成本预估”计算用户和 IP 的短窗口预算；PostgreSQL
  advisory lock 与 `cost_limit_reservations` 防止并发绕过上限。quota 预扣失败会释放该预算；
  Provider 失败则保留预估至窗口结束，避免不确定上游成本被过早放行。
- Provider 成功后先追加成本日志、释放预算预留，再调用 quota 结算。因此 quota 结算异常也
  不会丢失已发生的 Provider 成本。未知 usage 记录为 `estimated`，不会伪装为真实成本。
- 超限拒绝与单请求高成本会追加 `provider_cost_alerts`；该表是 LM3-22 指标/告警集成前的
  可审计告警源，不会由 notification 领域代写。

Web BFF 以 Kong 右侧追加的 `X-Forwarded-For` 地址作为 IP 预算键，且仅作为风控维度，
不能作为身份或资源授权依据。Kong CORS 已允许并暴露 `Idempotency-Key`，确保 LM3-13 的
浏览器重放契约可实际使用。

## 价格配置与套餐校准

非 test Provider 必须配置例如：

```bash
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_INPUT_PRICE_PER_MILLION='...'
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_OUTPUT_PRICE_PER_MILLION='...'
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_CURRENCY='USD'
AI_PROVIDER_OPENAI_COMPATIBLE_GPT_4O_MINI_EXCHANGE_RATE_TO_CNY='...'
AI_COST_WINDOW='5m'
AI_USER_COST_LIMIT_CNY='5'
AI_IP_COST_LIMIT_CNY='20'
AI_REQUEST_COST_ALERT_CNY='1'
```

模型级配置优先于 provider 级和全局 fallback；日志总是保存本次实际采用的价格快照。当前
套餐的参考 prompt 链、计算公式和额度/上下文/RPM 对照见
[AI 套餐成本校准](../product/AI套餐成本校准.md)。套餐变更必须以真实成本日志重新计算，
通过新套餐版本生效，绝不重写已购买权益快照。

## 验证

不使用流水线。创建一个全新的隔离 PostgreSQL 数据库（DDL 用户需要 `CREATEROLE`）后运行：

```bash
cd dramaip-platform/services
POSTGRES_AI_IDEMPOTENCY_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_ai_cost_test?sslmode=disable' \
  make ai-idempotency-integration
```

该测试回放全部 migration 并验证：并发幂等不重复调用 Provider/Quota、Provider 成本日志与
request/reservation 关联、Redis 不可达时 PostgreSQL 回放、极低用户成本上限在 Provider 前
拒绝且追加 `user_cost_limit_rejected` 告警、持久化源不可达时不调用 Provider。数据层单测以
model 级 USD 价格和 CNY 汇率验证输入/输出成本快照；BFF 测试验证 IP 与幂等键透传。

补充回归：

```bash
GOCACHE=/tmp/dramaip-go-build go test -race ./...
make event-contracts
cd ../clients && pnpm typecheck
```

## 回滚边界

022 只新增成本日志、风控预留和告警记录。不得删除已追加成本记录或以覆盖写改变历史价格；
回滚应用版本时，活动风险预留自然在窗口后失效，成本日志继续用于对账。价格配置缺失保持
保守拒绝，不应通过关闭成本预算或将成本置零绕过。
