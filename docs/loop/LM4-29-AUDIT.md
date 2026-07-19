# LM4-29 Admin 运营操作台审计

状态：`partial`

## 已交付

- Admin BFF 通过 mTLS 调用 Auth、User、Billing、Quota、Notification、AI Gateway；没有领域数据库连接。
- 用户详情把 profile、订单、订阅、额度、用量、通知和 trace 汇集为受控只读视图。
- 冻结/恢复、退款、恢复订阅、额度调整和发送通知均须二次确认、理由、权限校验、领域幂等键和不可变 Admin 审计。
- Auth 与 User profile 的状态变更有各自领域内幂等 ledger；重试会先复用领域结果，再补齐 Admin 审计。
- 报表有受限游标与服务端查询；管理界面提供检索、续页和 `?user=<uuid>` 深链。
- AI 成本告警只包含 ledger 派生的金额、阈值和 trace，不包含 prompt、响应、真实 IP 或供应商凭据。

## 不能安全交付的项

1. Billing Job 的 reconciliation 仍依赖静态 `RECONCILIATION_OPERATOR_TOKEN`。Admin BFF 不会持有或转发该令牌。
2. Notification 领域没有 delivery-attempt 查询、重试或人工确认 RPC；当前可安全执行的仅是创建运营通知和读取通知状态。

需要由对应领域先提供仅限 `admin-bff` mTLS 身份、带 operator/reason、幂等键、完整审计和状态机校验的 API。未具备这些条件前，不得用 Admin 直连表、静态令牌转发或伪造“已重试”来填补功能。

## 验证摘要

`buf generate/lint`、全量 Go 测试、客户端 lint/typecheck/Admin build/test/contract、Compose 配置与重建、平台 E2E 都已通过。完整命令与证据见 `LOOPMAP4.md` 的 LM4-29 记录。
