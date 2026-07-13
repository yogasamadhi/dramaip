# LM3-15 支付激活 Saga 与 Outbox 验证

支付成功、订阅可用和异步副作用不是跨服务事务。本 loop 固化如下顺序：

```text
服务端确认支付
  → billing 本地事务：order=paid + payment + subscription=quota_pending + payment.succeeded outbox
  → 事务提交后同步、幂等调用 quota CreatePeriodAccount
  → 成功：billing 本地事务写 subscription=active + subscription.activated outbox
  → 失败：subscription=activation_failed，billing-job 重试
  → relay 在 RabbitMQ publisher confirm 后标记 outbox published
```

`subscription.activated.v1` 与 `subscription=active` 由同一 PostgreSQL 事务写入；因此不会
出现用户已可用却没有激活事件，或产生幽灵激活事件的双写窗口。重复支付确认锁定同一 order
并返回既有 subscription；quota period account 使用 `subscription_id + period_start` 的自然键
保持幂等。用户在 `quota_pending` 时选择周期结束取消只设置取消标记，不会错误跳过额度创建而
写成 active；立即取消则终止待激活状态。

## Relay 与补偿

migration 023 为 `billing.outbox_events` 增加租约、下次重试时间和激活事件的唯一索引。每个
billing-job 用 `FOR UPDATE SKIP LOCKED` 领取未投递事件；进程在发布后崩溃时，租约到期后由
任一实例以完全相同的 `event_id` 重发。消费者已有 inbox/领域唯一键，按至少一次投递、效果
幂等处理。发布使用 RabbitMQ publisher confirm 和 mandatory 路由：没有已绑定的消费者队列时
不会误标 `published_at`，而是保留 outbox 记录重试。

额度不可达或激活事务失败时，状态为 `activation_failed` 并保留错误文本、payment、order、
subscription、quota 请求和未投递事件；billing-job 会以同一快照再次调用 quota。该 loop 不做
退款、续期、升降级或真实支付渠道，它们分别属于 LM3-16、LM3-17 和 LM3-18。

配置项：`OUTBOX_LEASE`（默认 `30s`）和 `OUTBOX_RETRY_DELAY`（默认 `5s`）。Compose、Helm
和 `.env.example` 均提供该配置；生产环境应依据最长 publisher confirm 和下游可用性设置租约。

## 验证

在一个全新隔离 PostgreSQL 数据库（DDL 用户需要 `CREATEROLE`）中执行：

```bash
cd dramaip-platform/services
POSTGRES_BILLING_SAGA_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_billing_saga?sslmode=disable' \
  make billing-saga-integration
```

该验证回放全部 migration，并覆盖 quota 不可达补偿、重复支付确认、待激活取消、幂等激活、
activation outbox 唯一性、publisher confirm 丢失后的相同 event ID 重放、过期租约接管和空
outbox 不重复投递。补充回归：

```bash
GOCACHE=/tmp/dramaip-go-build go test -race ./...
make event-contracts
cd ../clients && pnpm typecheck && pnpm build:web
```

## 回滚边界

023 仅新增 outbox 调度字段和唯一索引，不删除订单、支付、订阅、额度或历史事件。回滚应用
版本时不得把 `activation_failed` 乐观改回 active，且不得删除未投递 outbox；恢复版本必须继续
保留补偿任务，直到所有待激活订阅有可审计的终态。
