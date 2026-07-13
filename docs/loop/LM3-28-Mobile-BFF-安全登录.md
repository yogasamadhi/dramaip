# LM3-28 Mobile BFF 与安全登录

## 交付边界

移动端通过独立的 `mobile-bff` 登录和读取精简账户摘要，不复用 Web BFF 的 Cookie 会话。
Mobile BFF 只依赖 Auth、Billing 和 Quota 的受 mTLS 保护 gRPC 接口，不持有 PostgreSQL、Redis、
支付或 AI Provider 凭据。

## 外部接口

| 路径 | 用途 | 凭据和数据边界 |
| --- | --- | --- |
| `POST /v1/mobile/auth/login` | 使用邮箱、密码与移动设备标识创建会话 | 仅响应给应用进程；`Cache-Control: no-store` |
| `POST /v1/mobile/auth/refresh` | 使用 SecureStore 中的 refresh token 轮换会话 | refresh token 不写入 AsyncStorage、URL 或日志 |
| `POST /v1/mobile/auth/logout` | 远程撤销并清除本地安全会话 | 弱网时仍清除本地 SecureStore 条目 |
| `GET /v1/mobile/me/brief` | 返回 `display_name`、`plan`、`remaining_tokens` | 需要 Bearer access token；不返回订单、账单、邮箱或完整用量 |

Expo 使用 `expo-secure-store`：iOS 使用 Keychain，Android 使用 Keystore 支撑的安全存储。access token
只在 `mobile-session.ts` 的运行内存保存；应用重启后只用 SecureStore 中的 refresh token 换取新会话。
网络错误保留 refresh token 并显示可重试状态；仅认证失败会清除该条目并要求重新登录。

## 回滚和验证

- 从 Kong、Compose 和 Helm 移除或关闭 `mobile-bff` 即可停止移动云端入口，不影响 Web 或 Desktop。
- Mobile BFF 不变更支付、订阅或 quota 领域状态；它只调用既有认证/查询 RPC。
- 本 loop 不调用真实付款、支付渠道或真实 AI Provider。健康环境恢复后，按“登录 → 重启应用 → refresh →
  brief → logout → 网络断开重试”的路径补做设备真机 smoke。
