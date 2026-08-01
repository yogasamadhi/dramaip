# Web AI 作者会话运行手册

## 用户路径

1. Web 只从 `GET /v1/ai/models` 读取已配置、已计价的模型目录；页面不展示服务商、密钥、请求绑定或预留编号。
2. 作者选择任务或输入创作要求后，客户端先调用 `POST /v1/ai/preflight`。预检的 request hash 绑定最终消息、模型和 token 上限。
3. 同一 payload 带着该 hash 和一个不透明的 `Idempotency-Key` 调用 `POST /v1/ai/chat/stream`。Gateway 先持久化幂等 claim、预留额度和成本预算，之后才连接模型。
4. Gateway 对 OpenAI-compatible 上游转发真实 SSE delta；测试或非流式适配器只发送一个已经验证的完整结果，前端不伪造逐字动画。
5. 浏览器断线时，Web BFF 会继续排空已认证的 Gateway 流。作者使用 `GET /v1/ai/chat/status?idempotency_key=…` 恢复同一审计结果，不能以恢复动作重复调用模型。
6. 作者点击取消时调用 `POST /v1/ai/chat/cancel`。Gateway 取消活动上下文，取消 quota reservation 和短窗口成本预算，然后将审计状态写为 `canceled`。

## 隐私与支持边界

- Gateway 审计只保存完成结果、用量、模型、状态和请求关联；不保存消息、提示词、API Key 或上游原始事件。
- Web 会话历史仅保存在浏览器 `localStorage`，并以当前账号 ID 为命名空间。退出或切换账号不会读取另一账号的本地会话；“新会话”只删除本地便利记录，不删除可审计的服务端结果。
- SSE 失败事件包含请求关联和 `trace_id`，不包含提示词或 provider 原始响应。支持排障时以 trace/request 关联日志，不要求作者发送内容正文。

## 发布与回滚

- 先发布 Java AI 服务（SSE streaming/status/cancel），再发布 Web 与 SDK；切换后仅支持契约 2 的 `/api/v1/**`，旧 `/v1/**` 客户端必须升级。
- 回滚 Web 可直接回到同步 Chat；回滚 BFF 前必须确认 Gateway 仍能完成或取消已在途的 stream。不得绕过 preflight、幂等 claim、预扣或最终结算。
- 若上游不支持 `text/event-stream`，Gateway 以明确错误停止并释放 reservation；不要在客户端把本地打字动画伪装成模型流。

## 验证

```bash
cd dramaip-platform/clients
pnpm lint && pnpm typecheck && pnpm contracts:check && pnpm build:web
node ../scripts/web-route-smoke.mjs

cd ../legacy/go-services
GOCACHE=/tmp/dramaip-go-build go test ./...

cd ..
make platform-up
make platform-e2e
```

平台 E2E 覆盖模型目录、预检绑定、同步兼容路径、SSE delta/completed、状态恢复和完成请求的幂等取消。服务级测试覆盖 SSE 上游 delta/用量解析与取消传播；BFF HTTP 测试覆盖目录、流、状态和取消的认证边界。
