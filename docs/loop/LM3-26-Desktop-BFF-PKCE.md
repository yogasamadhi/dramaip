# LM3-26 Desktop BFF 与 PKCE 登录

## 已交付边界

Desktop Cloud 登录由独立的 `desktop-bff` 承担，不复用 Web BFF：

- `POST /v1/desktop/auth/token`：以一次性授权码、PKCE verifier、回环 redirect URI 和设备 id 换取会话；
- `POST /v1/desktop/auth/refresh`、`POST /v1/desktop/auth/logout`：刷新或撤销桌面会话；
- `GET /v1/desktop/me/cloud-context`：通过已验证 access token 返回套餐和 Token 余额；
- `GET /v1/auth/desktop/authorize`：只由已登录浏览器调用，向 `127.0.0.1:<随机端口>/callback` 回传一次性 code 与 state。

Desktop BFF 的 gRPC 身份为 `desktop-bff`。Auth 服务逐 RPC 限制：只有
`web-bff` 可以创建授权码，只有 `desktop-bff` 可以换码；Billing 和 Quota 仅额外接受
`desktop-bff` 查询当前已验证用户的订阅/额度。生产 mTLS 证书必须使用
`desktop-bff` Common Name，不能复用 Web BFF 客户端证书。

## 授权码与回调安全语义

`auth.desktop_authorization_codes`（migration `029`）仅存储 code SHA-256 hash、S256
challenge、严格回环 redirect URI、设备 id、过期与消费审计字段。原始 code 和 verifier
都不会落库。code 有效期 60 秒；消费 SQL 在同一事务中锁定记录，并同时匹配 hash、challenge、URI
和设备 id，成功后写入 `consumed_at=now()` / `consumed_reason=exchanged`。再次使用、过期、state
错误、verifier 错误或 redirect URI 不匹配均不会产生会话。

Electron 仅在 main process：

1. 生成 S256 `code_verifier`、`code_challenge` 和随机 `state`；
2. 在 `127.0.0.1` 的随机端口创建仅接收 `GET /callback` 的临时 HTTP server；
3. 用 `shell.openExternal` 打开 Web `/desktop/authorize`，不使用 WebView；
4. 回调对 state 做 constant-time 比较后，将 code + verifier 交给 Desktop BFF；
5. access token 只驻留主进程内存；refresh token 和 device id 以 JSON 条目写入系统
   Keychain (`com.sdns.studio.cloud-session/current`)；SQLite、renderer、日志和诊断包均不保存 token。

桌面 renderer 只有 `cloudAuth.status/login/logout/context` IPC。所有通道零参数，受共享 IPC
契约校验；renderer 得到的状态和套餐信息没有 access token、refresh token、code 或 verifier。

## 启用与回滚

Cloud 登录默认关闭，以保证离线/本地创作不依赖平台。开发环境显式设置：

```bash
DESKTOP_CLOUD_LOGIN_ENABLED=true
DESKTOP_CLOUD_WEB_ORIGIN=http://127.0.0.1:3009
DESKTOP_CLOUD_BFF_ORIGIN=http://127.0.0.1:8000
```

生产环境两个 Origin 必须为 HTTPS；HTTP 仅允许 electron-vite 的回环开发环境。将
`DESKTOP_CLOUD_LOGIN_ENABLED` 设回 `false` 就会隐藏/禁用该路径，不影响 SQLite 项目、BYOK
模型配置或任何本地创作工作流。显式退出会先请求远端撤销（失败不阻止本地退出），随后删除
Keychain 会话。

本 loop 不调用实际 AI Provider，也不创建或确认任何付款。

## 验证覆盖

- Auth PKCE 单元测试：S256 verifier/challenge 与回环 URI 负向校验；
- Web BFF 测试：回调只含 code/state，非回环 redirect URI 被拒绝；
- Desktop BFF HTTP 测试：换码、套餐/余额、Bearer 身份传播和非法 payload；
- Desktop 单元测试：state/verifier/token URL 安全边界；共享 IPC schema 扫描；
- Electron E2E：renderer cloudAuth 只能读公开状态，不出现 token/verifier/code/secret 字段；
- 手工静态扫描：不出现 WebView，回调不携带长期 token。
