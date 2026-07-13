# LM3-13 AI 请求持久化幂等验证

AI Gateway 以 PostgreSQL `ai_gateway.request_audits` 作为幂等的唯一权威源。migration
021 增加 `idempotency_key`，回填既有 `request_id`，并建立 `(user_id, idempotency_key)`
唯一索引。旧镜像在滚动升级窗口内只写 `request_id` 时，数据库 trigger 会填充同值的
幂等键；新镜像显式写入幂等键。`request_id` 保留为追踪关联字段，不再是唯一业务身份。

Web BFF 优先读取 `Idempotency-Key` HTTP header，并将它透传至 gRPC；JSON 的
`idempotency_key` 和旧的 `request_id` 仅作兼容回退。SDK 使用同一 header，Web 对话页
在用户显式生成新的请求编号前复用同一键。

## 行为

- 首次调用通过 `INSERT ... ON CONFLICT (user_id, idempotency_key) DO NOTHING` 原子声明
  `in_progress` 审计记录，声明成功后才会预扣额度和调用 Provider。
- 同键且相同 request hash 在完成后重放最小响应摘要；处理期间返回 gRPC `Aborted`（BFF
  映射为 HTTP 409）；失败记录不会再次调用 Provider。
- 同键但 payload、Provider、模型或最大 token 数不同返回 HTTP 409。
- Redis 是五分钟的最佳努力摘要缓存，不参与原子声明。缓存键对用户和幂等键做 SHA-256，
  不含输入内容；Redis 的连接、读写均限制为 200ms 且不重试，任何故障都回落到 PostgreSQL。
- 审计和缓存仅保存响应内容、Provider/模型、额度摘要、reservation 与 request hash；不保存
  输入 messages、完整 prompt、Provider 原始响应或密钥；失败原因会截断为 512 个字节。PostgreSQL 无法声明审计记录时，
  请求会在额度和 Provider 调用前被保守拒绝。

## 验证

不使用流水线。必须使用一个全新的隔离 PostgreSQL 数据库，DDL 用户需要 `CREATEROLE`：

```bash
cd dramaip-platform/services
POSTGRES_AI_IDEMPOTENCY_TEST_DSN='postgres://ddl_user:password@localhost:5432/dramaip_ai_idempotency_test?sslmode=disable' \
  make ai-idempotency-integration
```

该集成测试会回放全部 migration，并验证：

- 并发同键请求只有首次到达 Provider，第二个请求返回 `Aborted`；完成后的超时重试回放相同
  结果，quota 的预扣和结算调用均保持一次。
- 相同幂等键配不同 payload 返回 `AlreadyExists`，不会调用 Provider。
- Redis 指向不可用地址时，完成重放仍从 PostgreSQL 成功返回。
- 审计记录存有幂等键且响应 payload 不包含输入 prompt；关闭 PostgreSQL 连接后，新的请求
  被拒绝且 Provider 调用计数不变。

补充回归：

```bash
cd dramaip-platform/services
GOCACHE=/tmp/dramaip-go-build go test -race ./...
make event-contracts

cd ../clients
pnpm typecheck
pnpm build:web
```

`dramaip-platform/scripts/platform-e2e.mjs` 也增加了带 `Idempotency-Key` 的 test Provider
重放、额度不重复扣减和不同 payload 409 断言。当前 Docker Desktop 重启后的本地 Compose
环境缺少 `postgres` 服务容器，导致现存服务无法解析该 host；本轮没有把这个环境故障当作
E2E 通过证据。隔离 PostgreSQL 集成测试、BFF HTTP 测试和 E2E 脚本静态检查是本轮的替代
证据；恢复完整 Compose 之后应执行 `make platform-e2e`。

## 回滚边界

不得删除 migration 021 的唯一索引、回填键或已有 audit。回滚应用镜像时，兼容 trigger
继续从旧 `request_id` 填充幂等键；已经声明为 `in_progress`、`succeeded` 或 `failed` 的
请求必须保持原状态，不能通过删除审计记录来“解锁”重试。Redis 可以关闭或清空，不影响
PostgreSQL 的幂等判定。
