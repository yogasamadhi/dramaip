# Admin 运营操作台运行手册

## 边界

管理台仅能读取 reporting 投影和领域服务公开的受控视图；它没有任何客户、账务、额度、通知或 AI 数据库权限。`admin-bff` 以 mTLS 调用 Auth、User、Billing、Quota、Notification 和 AI Gateway，服务端仅将新增敏感 RPC 限制给 `admin-bff` 证书主体。

每个写动作遵循同一序列：管理员输入处置原因（4–300 字）→ 创建 5 分钟的一次性 confirmation → 使用 confirmation ID 作为领域幂等键 → 领域成功后消费 confirmation 并追加不可变 Admin 审计。若网络在领域成功后中断，使用相同 confirmation 重试；领域幂等键会返回原结果，Admin 随后补齐审计。不要直接修改任何领域表。

## 角色

| 角色 | 权限 |
| --- | --- |
| `viewer` | `audit.read`，仅看报表、链路和审计 |
| `operator` | 另含 `reporting.write`、`customer.write`、`notification.write` |
| `finance_admin` | `audit.read`、`billing.write`、`quota.write` |
| `security_admin` | 上述全部权限及 `principal.write` |

低权限账号不会获得冻结、退款、恢复订阅、额度调整或通知投递入口；服务端也会再次拒绝这些请求。

## 可执行动作

- 用户冻结/恢复：先写 Auth 的账户状态与会话失效记录，再镜像到 User profile；冻结的访问令牌和刷新令牌会在身份校验时失效。
- 退款与恢复订阅：只调用 Billing 的 `RequestRefund`/`ResumeSubscription`。退款仍服从 Billing 的额度冻结和人工复核状态机。
- 额度调整：只调用 Quota 的幂等 `AdjustPeriodQuota`；confirmation ID 是 ledger adjustment ID，原因附带操作员 ID。
- 通知：只调用 Notification 的 `CreateNotification`；`admin:<confirmation-id>` 是 source event，重复投递不会生成第二条通知。
- AI 成本：只读 AI Gateway 的脱敏 cost-alert 视图；不返回 prompt、响应正文、真实客户端 IP 或供应商凭据。
- 投影异常：确认只关闭 reporting 异常，不会篡改源事件、账务或额度 ledger。

账务对账项仍由 Billing Job 的领域工作流管理。Admin UI 可以从订单/订阅/trace 进入调查，但不得使用静态 reconciliation token 绕过领域审批。

## 部署与回滚

先执行 038/039 迁移，再部署领域服务，最后部署 `admin-bff` 与 Admin UI。Admin BFF 需要 `AUTH_GRPC_ENDPOINT`、`USER_GRPC_ENDPOINT`、`BILLING_GRPC_ENDPOINT`、`QUOTA_GRPC_ENDPOINT`、`AI_GATEWAY_GRPC_ENDPOINT`、`NOTIFICATION_GRPC_ENDPOINT`、`REPORTING_GRPC_ENDPOINT`；Docker Compose 已提供默认内部地址。

需要紧急关闭时，先从 Admin BFF 的 mTLS allow-list 或入口路由撤掉对应动作；不要删除审计记录。已经执行的领域操作不可通过回滚迁移“撤销”，应在相应领域服务内发起新的、已审计的补偿操作。
