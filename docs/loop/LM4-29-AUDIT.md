# LM4-29 Admin 运营操作台审计

状态：`done`

## 已交付

- Admin BFF 通过 mTLS 调用 Auth、User、Billing、Quota、Notification、AI Gateway；没有领域数据库连接。
- 用户详情把 profile、订单、订阅、额度、用量、通知和 trace 汇集为受控只读视图。
- 冻结/恢复、退款、恢复订阅、额度调整和发送通知均须二次确认、理由、权限校验、领域幂等键和不可变 Admin 审计。
- Auth 与 User profile 的状态变更有各自领域内幂等 ledger；重试会先复用领域结果，再补齐 Admin 审计。
- 报表有受限游标与服务端查询；管理界面提供检索、续页和 `?user=<uuid>` 深链。
- AI 成本告警只包含 ledger 派生的金额、阈值和 trace，不包含 prompt、响应、真实 IP 或供应商凭据。
- Billing Job 已移除静态令牌 HTTP 对账入口，改为仅限 `admin-bff` mTLS 的 gRPC 对账操作服务；发起对账和修复动作都传递 operator、reason 和确认 ID 幂等键，并持久化运行/动作结果。
- Notification Job 已提供仅限 `admin-bff` mTLS 的失败投递查询与重试操作；重试仅复用原始 inbox 事件重新进入既有投递链路，并以确认 ID 持久化幂等结果，不能伪造投递成功。
- Admin 控制台现可按权限查看对账项、发起对账、执行受限的额度修复或人工确认，并查看/重试失败通知投递；每个写操作仍必须二次确认并写入不可变审计。

## 明确边界

- Admin 仍不具备任何 Billing 或 Notification 的数据库连接，也不暴露通用数据库管理能力。
- 对账动作仅允许既有安全修复 `retry_quota_provision` 或 `manual_confirm`；退款、冻结等跨财务/权益动作必须走其原有领域工作流。
- 重试仅针对未完成的失败 delivery attempt。已完成、正在处理或无原始 inbox payload 的事件会拒绝重放。
- mTLS、部署迁移与外部生产演练仍按 LM4-31 发布 Gate 单独验证；本 loop 不以本地测试冒充生产运行证据。

## 验证摘要

`buf generate/lint`、全量 Go 测试、Admin BFF 业务/HTTP 测试、Notification retry 测试、客户端 typecheck/Admin build/test、Compose 配置和 Helm lint/template 均已通过。完整命令与证据见 `LOOPMAP4.md` 的 LM4-29 记录。
