# LM3-24 Web 账号与付费体验运行手册

## 已交付闭环

- 注册后进入 `/verify-email`，由认证后的 BFF 请求一次性邮箱验证码并确认。
- `/forgot-password` 与 `/reset-password` 使用不暴露账号存在性的请求语义；验证码为 8 位、15 分钟有效、一次性消费，数据库只存 SHA-256 哈希。
- 未验证邮箱不能创建订单或确认模拟支付；验证后可按既有账本/Saga 流程完成模拟支付。
- `/account` 可取消/恢复订阅、提交套餐变更和退款申请；`/billing` 汇总订单、订阅周期和额度；错误界面显示可用于支持排查的 `trace_id`。
- `/download` 指向官方 Gitee Release 与安装/发布说明，而不提供第三方包或占位下载按钮。

## 邮件投递配置

在受控环境中设置下列变量，且不要把投递 token 写入仓库、浏览器或日志：

```bash
AUTH_EMAIL_DELIVERY_URL=https://mail-gateway.example.test/deliver
AUTH_EMAIL_DELIVERY_TOKEN=operator-managed-secret
AUTH_EMAIL_FROM=noreply@example.test
AUTH_EMAIL_TIMEOUT=10s
```

网关接收 JSON `to`、`from`、`template`、`subject`、`text`。生产环境拒绝非 HTTPS endpoint。验证码只能存在于邮件请求正文，禁止被拼入 URL、trace、结构化日志或前端状态。

## 恢复健康栈后的验证

1. 恢复用户自己的 Compose 栈后，确认 `http://localhost:8000/v1/healthz` 可用。
2. 配置隔离的邮件投递测试网关，注册新测试账号；在浏览器完成邮箱验证码确认。
3. 在桌面和移动宽度检查注册、验证、找回密码、套餐、账单、订单详情、下载页和 trace_id 错误显示。
4. 用已验证账号创建订单，验证未验证账号收到 `email_verification_required`；仅在 `ENV=dev/test` 使用模拟支付确认，并检查 pending/failed/expired 的订单展示和恢复入口。
5. 执行 `make platform-e2e`。默认脚本使用已验证的开发账号；邮件验证流必须通过真实的隔离投递网关和浏览器代码输入验证，禁止添加返回验证码的测试后门。

## 回滚边界

回滚本 loop 的 Web 与认证代码时，保留 `auth.email_actions` 和 `session_invalidated_at` 数据，不要恢复已消费验证码、旧密码哈希、refresh token 或账本状态。禁用公开注册或未配置的投递网关比绕过邮箱验证更安全；真实支付仍保持关闭。
