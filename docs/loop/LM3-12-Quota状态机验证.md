# LM3-12 Quota 原子预扣与结算状态机验证

quota 的 `used_tokens` 同时表示已结算用量与仍在保留中的上限。所有修改都由
PostgreSQL 原生 SQL 的事务完成，不能通过 GORM 覆盖写重建余额。

## 状态机

```text
reserved --(known usage)--> settled / over_quota_settled
    |
    +--(explicit cancel before settlement)--> cancelled
    +--(lease expiry)------------------------> expired
    +--(usage unknown)-----------------------> settlement_pending
                                                  |
                                                  +--(precise retry)--> settled / over_quota_settled
                                                  +--(deadline)-------> settled_estimate
```

- `reserved` 在创建时原子增加 `used_tokens`，只有它可以因租约过期或取消而释放。
- `settlement_pending` 表示 Provider 已返回成功结果但没有可信 usage；额度继续保留，
  不会被过期回收或取消接口释放。
- `settled_estimate` 在维护截止后以原始 `reserved_tokens` 结算，并写入带原因的 usage
  ledger；已经结算的 usage 不会被删除或覆盖。
- 精确 usage 小于预扣时释放差额；高于预扣时仅在余额足够时补扣。余额不足仍写入
  `over_quota_settled` usage，且绝不释放已发生 Provider 成本的预扣。

`SettleTokensRequest.usage_known` 是兼容性安全开关。新 AI Gateway 只有收到 Provider
真实 usage 时才传 `true`；旧调用方默认 `false`，因此会走保守 pending，而不是把未知
成本伪装成 1 token 或退款。

## 验证

不使用流水线。请创建一个全新、隔离的 PostgreSQL 数据库，DDL 登录必须有
`CREATEROLE`：

```bash
cd dramaip-platform/services
POSTGRES_QUOTA_STATE_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_quota_state_test?sslmode=disable' \
  make quota-state-machine-integration
```

该测试会应用全部 migration，并验证：

- 10 个并发 20-token 预扣面对 100-token 账户时只有 5 个成功；重复 request id 返回同一
  reservation，余额不再增加。
- 精确结算与重复结算幂等；超额实际用量生成 `over_quota_settled` ledger，保留原始预扣。
- 未知 usage 可在截止前由精确重试结算；否则不能被已过期租约释放，截止后生成
  `settled_estimate` ledger。
- 正常过期的 `reserved` 租约释放额度；同一周期账户重试不覆盖既有套餐快照或额度。

补充回归：

```bash
GOCACHE=/tmp/dramaip-go-build go test -race ./...
make event-contracts
```

## 回滚边界

migration 020 仅增加 settlement 元数据与索引；不删除 reservation、usage 或账户历史。
回滚应用版本时，`settlement_pending` 和 `settled_estimate` 仍必须保留。旧客户端没有
`usage_known` 字段会按 `false` 处理，属于安全的保守行为；不得把它改回自动释放或
1-token 伪结算。
