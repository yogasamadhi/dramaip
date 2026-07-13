# LM3-20 账本与支付安全 Gate

本 Gate 不改变支付或额度规则；它确认已有 billing、quota、AI 和对账写路径在并发、重放和失败时仍
遵守账本边界，并把未完成的外部验证明确保留为发布阻断项。

## 已验证证据

- `GOCACHE=/tmp/dramaip-go-race-lm3-20 go test -race ./...` 通过。
- 全新的本机 PostgreSQL 16 实例分别运行了 `billing-saga`、`billing-lifecycle`、微信 webhook、支付宝
  webhook、quota state-machine 和 reconciliation integration 测试；每个测试数据库从空库迁移至 027。
- 覆盖支付确认/Saga 重放、outbox 租约恢复、订阅激活失败、支付 webhook 伪造/重放/金额不符、10 并发
  quota 预扣、重复结算、未知 usage 的保守结算、过期租约、额度超额、周期账户幂等、跨账本差异建案、
  cursor 翻页和人工审计动作。
- `make event-contracts`、Docker Compose 配置渲染、Helm lint/template 均通过。

这些检查证明账本领域代码的自动化 Gate 为绿色；真实支付开关默认仍关闭，且不应因为这些测试而开启。

## 未作为通过证据的项目

当前 Compose 栈是用户已有的故障状态：billing、quota、auth 和各 job 因其 PostgreSQL 服务缺失而
重启。为避免停止或重建用户容器，本 Gate 没有运行 `make platform-e2e`。恢复健康的隔离 stack 后，
必须运行该 E2E，作为部署证据。

项目所有者已在 2026-07-13 明确要求跳过真实付款。因此微信/支付宝真实沙箱付款、渠道账单下载和
真实退款没有执行，也不能被替代测试宣称为通过。未来启用任一渠道前，必须完成各自 LM3-17/LM3-18
运行手册中的官方沙箱演练，并将 payment 订单、webhook/query、subscription、quota、outbox 的证据
关联到一次对账运行。

## 发布判定

任何下列条件不满足时，禁止开启真实支付或把此 Gate 当作生产就绪：

1. 全量 race、全部领域集成和 event contract 检查仍为绿色。
2. 健康 Compose/staging 环境的 `make platform-e2e` 已通过。
3. 获授权的每个支付渠道均有真实沙箱 webhook/query/Saga/对账证据。
4. 对账存在未处理 critical case 时，运营方已完成受控人工处置或明确维持关闭支付开关。

回滚不删除 orders、payments、subscriptions、quota ledger、outbox 或 reconciliation 审计；关闭渠道和
`BILLING_RECONCILIATION_ENABLED` 可停止新的外部支付/定时对账工作，随后按运行记录排查。
