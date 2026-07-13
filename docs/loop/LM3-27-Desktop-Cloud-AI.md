# LM3-27 Desktop Cloud AI

## 交付边界

桌面端新增 `DramaIP Cloud` 虚拟模型配置。它只保存 `cloud://<provider>` 的非敏感路由标识，
不保存平台 API Key、access token 或 refresh token。Electron main process 读取 Keychain 会话并经
Kong 调用 Desktop BFF；renderer 只能查询模型列表、登录状态、套餐和余额，不能取得长期凭据或发起
携带 token 的 AI 请求。

## 请求路径

```text
Renderer (model selection/public balance)
  -> Electron preload IPC (cloudAI:models only)
  -> Electron main (Cloud LLM Provider)
  -> Kong /v1/desktop/ai/*
  -> Desktop BFF (validate token + bounded request)
  -> AI Gateway (idempotency audit -> quota reserve -> provider -> cost log -> quota settle)
```

每次 Cloud chat 在主进程生成 UUID `request_id` 与相同的 `idempotency_key`。Desktop BFF 不接受
用户 ID；它验证 access token 后才把用户身份写入受 mTLS 保护的 gRPC metadata。AI Gateway 只允许
`web-bff` 与 `desktop-bff` 作为 gRPC 调用方，继续以 `ai_gateway.request_audits`、quota 账本和
`provider_cost_logs` 作为审计与结算权威。

## 外部 API

| 路径 | 含义 | 内容边界 |
| --- | --- | --- |
| `GET /v1/desktop/ai/models` | 当前已配置、可计费的 Provider/model | 不返回 base URL 或 API Key |
| `POST /v1/desktop/ai/preflight` | 校验模型、消息数、字符数、输出 token 并返回余额 | 只含计数，不含创作文本 |
| `POST /v1/desktop/ai/chat` | 受限调用与结算 | 至多 8 条消息、24,000 Unicode 字符、8,192 输出 token |

Cloud chat 的原始创作文本不会由 Desktop BFF 写日志；AI Gateway 为幂等重放保留完成回复，
但不保存 prompt、Provider raw output 或凭据。浏览器、renderer、SQLite、诊断包和 URL 均没有
Cloud access/refresh token。

## 降级与回滚

- `DESKTOP_CLOUD_LOGIN_ENABLED` 默认不是 `true`，关闭后 Cloud 登录与模型发现失效，但本地项目和
  BYOK 模型配置不受影响。
- 网络、超时、Provider、余额不足和预检失败均只失败本次 Cloud AI 任务；不会写入或回滚本地项目内容。
- 本 loop 使用现有 test/sandbox Provider 作为可验证的 AI 路径；没有调用真实 Provider、真实付款或
  真实支付渠道。生产启用前需要受控 Provider 凭据、价格/汇率配置和健康的 Kong/Compose 或 staging 环境。
