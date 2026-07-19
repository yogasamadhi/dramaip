# LM4-04：P0 可靠性与交易 Gate（G1）

状态：内部 P0 Gate 通过；真实支付渠道和对外 macOS 分发仍被明确阻断，不能据此宣称生产支付或已签名桌面发行闭环。

## Gate 范围与结论

本 Gate 只复核 LM4-01～03 的累计结果，不修改业务规则、不以放宽断言换取通过，也不引入新的 UI 功能。

- 内容可靠性：通过。Desktop 全量回归包含立即离页自动保存、恢复草稿、关闭/崩溃保护及 SQLite 迁移回放。
- 工作流真值：通过。固定 fixture 覆盖最新/过期质检、失败任务和可用视频产物；过期报告不会继续作为可用质量结论。
- 内部交易链路：通过。模拟下单、服务端确认、订单状态恢复和 quota 扣减在健康栈中通过；Web 与 Billing 的 provider/过期时间契约已回归。
- 正式支付渠道：未通过发布验证。微信和支付宝的真实 webhook、官方沙箱 merchant 和回调环境均没有可用证据，两个 Feature Flag 必须继续关闭。

因此，G1 允许继续实施后续 P1/P2 改造，但不授权发布真实支付渠道，也不授权把未签名的 macOS 构建当作对外正式包。

## 自动化验证

| 领域 | 实际命令/证据 | 结果 |
| --- | --- | --- |
| Desktop 静态与核心回归 | `pnpm format:check && pnpm test` | 通过：类型检查、123 项单测、2 项迁移回放测试和 DB smoke 均通过。 |
| Desktop 端到端 | `pnpm test:e2e` | 通过：包含 `draft-autosave-on-immediate-route-leave`、P0 fixture、工作流引导、项目包 roundtrip。 |
| Desktop UI 基线 | `pnpm test:ui`；保留输出后再次运行 `pnpm test:ui -- --skip-build --output=<temp>` | 通过：6 张截图、13 项既有无障碍观察；截图/报告来自隔离临时 userData，未提交。 |
| Desktop 安装包 | `pnpm package:smoke` | 通过：构建 arm64 DMG/zip，并从 `app.asar` 启动，隔离数据库初始化成功。构建未签名、未公证，见阻断项。 |
| Platform 服务与契约 | `make test` | 通过：Go `./...`、客户端 typecheck、Web route smoke。 |
| Platform Web | `cd clients && pnpm lint && pnpm build:web` | 通过：lint、类型检查、Next 生产构建通过，订单详情为动态路由。 |
| 健康栈交易 E2E | `make platform-e2e` | 通过：`http://localhost:8000` 健康栈中 basic plan、模拟 checkout 和 22 token 消耗断言均成功。 |
| 正式 provider webhook 集成 | `make billing-wechat-webhook-integration`；`make billing-alipay-webhook-integration` | 未运行：前者要求 `POSTGRES_WECHAT_WEBHOOK_TEST_DSN`，后者要求 `POSTGRES_ALIPAY_WEBHOOK_TEST_DSN`；两者都必须指向新鲜、隔离且有 DDL 权限的 PostgreSQL。 |
| 累计审查 | `git diff --check cf2d97e..HEAD`；累计 diff 与凭据模式人工审查 | 通过：没有空白错误、凭据、构建产物或运行时截图进入 Git。 |

## 人工 UI 与状态复核

- 浅色 1320px 过期质检 fixture 明确显示“源内容已变化，报告已过期，请重新检查”；质量步骤停留在当前阶段，不能误当成已通过。
- reduced-motion 视频 fixture 同时呈现失败任务、重试入口和一个已完成的本地 fixture 结果；失败状态没有被“完成”语义覆盖。
- 深色工作台截图仍暴露低对比文本与编辑器加载态；基线报告还记录 13 个缺少可访问名称的控件。这些是可复现的既有设计系统问题，不把它们计为已通过的无障碍能力：LM4-05 处理主题/对比度/动效底座，LM4-19 将无名称控件转为阻断门禁。
- LM4-03 所见的既有 `localhost:3009` 前端进程无法加载公开套餐，因而不作为正向支付 UI 证据；生产 build、路由契约、BFF HTTP 与模拟健康栈 E2E 是本 Gate 的自动化依据。部署环境须在渠道启用前重新进行登录后人工下单验证。

## 发布阻断项与解除条件

| 阻断范围 | 当前原因 | 解除条件 |
| --- | --- | --- |
| 微信支付发布 | 缺少隔离 PostgreSQL DSN 以运行 inbox/replay/exactly-once 集成；缺少官方沙箱 merchant 与可达 webhook 回调证据。 | 提供专用空 PostgreSQL 实例后运行 webhook integration；在获授权官方 sandbox 完成下单、签名回调、重放和过期订单验证，留存脱敏证据。 |
| 支付宝发布 | 同上，且缺少支付宝官方 sandbox merchant/callback 证据。 | 提供专用空 PostgreSQL 实例并运行对应 integration；在官方 sandbox 完成下单、异步通知、重放和过期验证。 |
| Web 正式 checkout 发布 | 本机已有开发进程的套餐加载异常，且没有登录态/正式渠道环境的人工订单证据。 | 在目标部署配置中完成公开套餐、登录、下单、订单轮询及失败/过期重试的人工 smoke；不允许浏览器确认权益。 |
| macOS 对外分发 | `package:smoke` 已验证包可启动，但环境未提供签名和公证配置，构建日志明确跳过二者。 | 在发布身份、Apple notarization 凭据和目标发行配置齐备后，签名、公证并在干净用户目录安装验证。 |

## 回滚边界

- 本 Gate 没有功能改动，回滚应回到对应能力 loop，而不是降低 Gate 标准。
- 任何支付异常先保持 `wechat_pay`/`alipay` Feature Flag 为关闭；订单、webhook inbox、订阅、quota 和审计记录保留，不通过客户端跳转或确认绕过服务端状态机。
- 如 LM4-01 的保存/恢复回归失败，整体回退该持久化能力并保留已有恢复草稿；如 LM4-02 的真值判定回归失败，回退工作流展示但不删除历史报告、任务或视频结果。
