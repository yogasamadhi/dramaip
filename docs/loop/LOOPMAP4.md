# Product Experience and Ecosystem Closure Loop Map 4

本文档依据 [LOOPRULE.md](./LOOPRULE.md) 编写，用于把 2026-07-19 对
`dramaip-desktop` 与 `dramaip-platform` 的功能、UI、交互和跨端闭环审计结果，
拆成可执行、可审查、可验证、可提交、可回滚的端到端能力 loop。

本地图承接：

- [LOOPMAP2.md](./LOOPMAP2.md) 已完成的 Desktop 产品能力升级基线；
- [LOOPMAP3.md](./LOOPMAP3.md) 已完成或仍在推进的平台化、安全、商业和部署基线；
- 当前代码已经具备的本地创作、Cloud AI、移动灵感、支付适配、账户和运营能力。

本地图不重做已经完成的功能，而是把产品从“能力很多、主要链路可运行”推进到：

1. 核心创作数据不会因切换、关闭、崩溃或 AI 写入而丢失；
2. 用户能理解当前阶段、阻塞原因和下一步动作；
3. Desktop 形成统一、沉浸、可访问且具有影视创作辨识度的工作室体验；
4. 小说、改编、剧本、分镜和视频形成连续的制作流水线；
5. Web、Mobile、Admin、Desktop 与平台服务之间的状态和契约保持一致；
6. 所有 P0/P1/P2 在最终 Gate 中有可复现的自动化与人工验收证据。

> 规划状态说明：本文创建时所有 LM4 loop 均为 `todo`。后续状态仅在对应 loop 完成
> `LOOPRULE.md` 第 7 节定义的实现、验证、合并、推送与清理后更新。

## 0. 目标与范围

### 0.1 总体目标

完成以下用户可见结果：

1. 建立跨章节、剧本、镜头和应用生命周期的统一保存与恢复协议。
2. 让工作流阶段、质量报告、视频产物和改编上下文反映真实、最新且可解释的状态。
3. 修复正式支付渠道契约，形成可下单、可支付、可轮询、可恢复的 Web 付费链路。
4. 建立统一 Desktop App Shell、分层导航、可调宽面板、专注模式和深链状态。
5. 将项目首页、章节管理、AI 助手、任务中心、质量闸门和版本预览重构为任务导向体验。
6. 统一改编、剧本、场景、分镜、视频和交付的制片导航与上下文。
7. 建立可复用的视觉、主题、密度、动效、键盘、无障碍和视觉回归底座。
8. 完成移动草稿生命周期、账户 read model、版本化客户端契约、Web AI 和 Admin 操作闭环。
9. 接通两个具有独立配置、测试和回滚边界的真实视频供应商。
10. 在实时云同步之前，先交付用户主动触发、端到端加密、可恢复的项目快照。

### 0.2 参考来源

- 执行规则：[LOOPRULE.md](./LOOPRULE.md)。
- 产品能力基线：[LOOPMAP2.md](./LOOPMAP2.md)。
- 平台架构与商业基线：[LOOPMAP3.md](./LOOPMAP3.md)。
- 架构边界：[技术架构.md](../技术架构.md)。
- 生态边界：[ECOSYSTEM_SYNC_MARKET_KNOWLEDGE.md](../product/ECOSYSTEM_SYNC_MARKET_KNOWLEDGE.md)。
- 工程基线：`dramaip-desktop`、`dramaip-platform/clients`、
  `dramaip-platform/services`、平台部署与验证脚本。
- 本地图前置审计涉及的关键入口：
  - Desktop Workspace、章节编辑器、AI 助手、质量闸门；
  - 改编、剧本、分镜、视频页面；
  - Platform Web checkout、账户、AI chat；
  - Mobile drafts、Desktop 灵感接续、Admin reporting；
  - Desktop BFF、Web BFF、Billing、AI Gateway、Inspiration 等服务。

### 0.3 覆盖范围

本地图覆盖：

- Desktop renderer、Electron main/preload/IPC、core、db、ai、export 和测试。
- Desktop 项目、编辑器、AI、质量、改编、剧本、分镜、视频、设置和全局导航体验。
- Platform Web、Mobile、Admin、共享 SDK 与版本化协议。
- Platform Web/Desktop/Mobile/Admin BFF 及必要的 billing、quota、AI gateway、
  inspiration、reporting、notification、auth/user 领域接线。
- UI 自动化、截图回归、无障碍检查、Electron smoke、客户端构建、Go 测试和平台 E2E。
- 与能力同一验收边界内的迁移、配置、文档、运行手册、Feature Flag 和回滚说明。

### 0.4 明确不覆盖

本地图不承诺：

- 将 Desktop 本地 SQLite 的可信创作源改为云端数据库。
- 在 LM4-30 之前实现双向实时项目同步或自动冲突合并。
- 把完整 Desktop 创作工作台复制到 Web 或 Mobile。
- 同时接通当前 UI 中列出的全部视频平台；本地图只要求两个独立真实供应商闭环。
- 为动效引入重型动画引擎、全屏 3D、持续高耗能背景或影响正文阅读的装饰。
- 绕过支付、模型、内容平台、应用商店或供应商的官方安全和审核机制。
- 将样本文本、用户正文、完整 prompt、密钥或视频二进制默认上传或写入遥测。
- 在没有独立验收、回滚和外部环境证据时，把供应商、支付或云快照标记为生产可用。

## 1. 当前基线

### 1.1 已具备能力

- Desktop 已覆盖项目、人物、大纲、长篇规划、章节、记忆、诊断、改编、剧本、场景、
  分镜、视频任务、版本、项目包、备份、导出、多 Agent、Cloud AI 和移动灵感接续。
- Desktop 已有浅色/深色主题、Radix 弹窗、Tailwind 动画插件、TipTap 编辑器、
  Toast、任务记录和内容版本能力。
- Platform 已有端专属 BFF、账号/订阅/额度、微信/支付宝适配、Cloud AI、移动草稿、
  Admin reporting、版本化 proto 和共享 Web SDK。
- LOOPMAP2/3 已建立安全凭据、PKCE、quota、幂等、支付激活、可观测性、部署等底座；
  LM4 不得回退这些边界。

### 1.2 已确认的主要问题

#### P0

- 章节 700ms 延迟保存会在卸载时丢弃尚未 flush 的正文。
- 剧本和镜头使用手动保存，切换集数或镜头时未保存草稿会被新状态重置。
- 工作流展示最新质量报告，却累计历史报告阻塞项；视频阶段未严格要求成功可用产物。
- Web 正式模式发送支付渠道 `production`，Billing 只接受 `wechat_pay`、`alipay`、
  `simulated`。

#### P1

- Workspace 有 25 个项目级入口；在 1024px 最小窗口下，固定 224px 左栏与 320px
  右栏使主创作区只剩约 480px。
- Workspace 内部 section 主要存在组件状态中，切换不稳定写回 URL，浏览器前进/后退和深链不完整。
- 章节使用单个 Select，不适合 100～300 章项目；缺少卷/单元树、搜索、排序和状态摘要。
- AI 助手平铺十余个按钮；上下文确认、执行反馈、任务恢复、费用和取消入口分散。
- AI 修稿预览、正文采用和 revision task 完成不是一个原子事务。
- Cloud AI preflight 主要用于测试连接，真实生成链路没有权威预检。
- 多个改编存在时，部分页面默认取最旧的 `adaptations[0]`，页面之间当前改编语义不一致。
- 原生 `window.confirm`/`window.prompt` 广泛存在；删除、恢复、取消和输入交互不可统一审计。
- Mobile/Cloud/Desktop 对“已采用草稿”的状态语义不一致；Mobile 缺少完整草稿管理。
- Web 账户页重复请求多个领域和聚合报告；聚合报告会把下游错误掩盖为空值。
- Web、Mobile、Admin、Desktop 分别使用 SDK、自定义 fetch 或硬编码协议，已出现参数漂移。

#### P2

- 改编、剧本、分镜、视频各自拥有独立页面壳、返回路径、上下文和导出工具栏。
- 剧本正文仍是小字号等宽 Textarea；场景、人物对白和动作缺少结构化编辑体验。
- 分镜页同时存在场景列表、镜头列表和长表单，素材仍依赖 URL/本地路径输入。
- 视频任务和结果可以工作，但缺少统一队列、自动轮询、费用预估和多结果同步对比。
- 即梦、可灵、海螺、Runway、Pika 仍是未实现 adapter；只有 Sora 和 custom 可真实路由。
- Web AI 更像技术控制台；Admin 更像报表页；项目云能力缺少低风险的手动加密快照。

### 1.3 本地图创建时的检查结果

截至 2026-07-19，本次只读审计记录：

- `dramaip-desktop`: `pnpm typecheck` 通过。
- `dramaip-desktop`: `pnpm test:unit` 通过，共 120 项测试。
- `dramaip-platform/clients`: `pnpm typecheck` 通过。
- `dramaip-platform/services`: `GOCACHE=/tmp/dramaip-go-build go test ./...` 在允许
  测试监听本机临时端口后通过。
- 当前目标分支为 `main`，与 `origin/main` 对齐；创建本文前只有 0 字节、未跟踪的
  `docs/loop/LOOPMAP4.md`。

### 1.4 尚未建立或本次未重跑的可信检查

- 当前 Electron E2E 主要验证数据与业务烟雾路径，不包含完整页面交互和视觉截图回归。
- 尚无统一 `pnpm test:ui`、axe 无障碍 Gate、关键宽度截图矩阵和 reduced-motion 截图。
- 本次未重跑 Desktop `format:check`、`test:db`、`test:e2e`、`package:smoke`。
- 本次未重跑 Platform clients `lint`、Web/Admin production build、完整 Compose E2E。
- 未使用真实支付商户、真实视频供应商或生产快照存储凭据；相关 loop 只能在取得安全
  环境、按规定交互输入凭据并完成外部证据后闭环。

## 2. 兼容、安全、数据与体验约束

所有 loop 必须遵守：

1. Desktop 本地 SQLite 仍是本地创作内容的可信写入源；云能力默认可选且最小上传。
2. 切换、关闭、崩溃、AI 采用、恢复版本或任务重试不得静默丢失或覆盖用户内容。
3. 数据写入、迁移、恢复、项目删除、revision adopt 和任务恢复必须幂等、可审计、可回滚。
4. AI 生成必须明确区分预览、快照后写入、自动写入；高影响操作不得因 UI 重构降低确认级别。
5. 支付状态只信任服务端验签 webhook 或主动查询；前端不得直接激活订单、订阅或额度。
6. API Key、refresh token、支付密钥、正文、完整 prompt、视频文件和恢复密钥不得进入日志、
   URL、截图 fixture、trace 或测试快照。
7. Web/Desktop/Mobile/Admin 继续使用端专属 BFF；不得为减少 UI 请求而让客户端跨域读库。
8. 公共协议变更必须兼容现有版本或显式升版，生成物和各端调用必须在同一 loop 收口。
9. UI 必须支持键盘、焦点可见、语义标签、颜色非唯一状态表达和 WCAG 2.2 AA 对比度。
10. 常规 UI 文本不低于 12px，正文默认不低于 16px；图表必须提供非颜色和非图形替代。
11. 动效只使用可中断的状态反馈；常规过渡 120～220ms，里程碑不超过 500ms；支持
    `prefers-reduced-motion`，不自动播放有声视频。
12. 同屏最多一个无限循环状态动画；优先 `transform`/`opacity`，不得用动效掩盖真实等待。
13. 外部支付和视频供应商分别拥有独立 Feature Flag、凭据、沙箱、运行手册和回滚边界。
14. P2 云快照只做用户主动触发的加密快照，不自动演变为实时同步、服务端可读正文或冲突合并。

## 3. 目标体验架构

### 3.1 Desktop Shell

目标布局：

```text
项目路径 / 保存状态 / 全局搜索 / 当前任务 / 云端余额
┌──────┬──────────────┬──────────────────────────┬──────────────┐
│ 56px │ 200~240px    │ 主创作画布                │ 320~420px    │
│ 模式 │ 当前上下文    │ 1320px 下保证约 680px      │ 属性/AI 面板  │
│ 导航 │ 章节/集/镜头树 │                           │ 可折叠可调宽  │
└──────┴──────────────┴──────────────────────────┴──────────────┘
```

- 全局模式：项目、资源、模板、任务、设置。
- 项目阶段：创作、世界观与记忆、诊断、改编制作、交付。
- 当前对象：章节树、集数、场景、镜头、版本或任务。
- 小窗口自动收起 Inspector；专注模式隐藏两侧；宽度、折叠和密度设置持久化。
- 项目、改编、集、场景、镜头和 section 全部可深链并支持前进/后退。

### 3.2 视觉与字体基线

- 明亮模式使用温暖纸张灰画布、白色创作表面、深墨色正文和蓝紫品牌色。
- 暗夜模式使用深墨背景、分层表面和降低亮度的 AI 光晕。
- AI 渐变只用于运行、预览和高价值入口；成功、提醒、阻塞分别使用语义色。
- UI 正文 14px，辅助信息最低 12px，创作正文 16～18px；等宽字体只用于 Prompt、JSON 和日志。
- 提供舒适/紧凑密度；创作默认舒适，表格、任务和制片列表允许紧凑。

### 3.3 统一反馈模型

- 保存：`未保存 → 保存中 → 已保存 → 保存失败/可重试`。
- AI：`准备上下文 → 权威预检 → 模型生成 → 结构校验 → 等待采用/已写入`。
- 长任务：`排队 → 运行 → 可取消 → 成功/失败/中断 → 可重试/可恢复`。
- 工作流：`未开始 → 当前 → 完成 → 内容过期/需复检 → 阻塞`。
- 删除：默认移入废纸篓或提供 Undo；最终删除才使用强确认。

### 3.4 动效验收基线

- 页面/section：淡入并上移 4px，140～180ms。
- 导航活动指示：120～160ms；侧栏展开：180～220ms。
- 保存状态图标：180～240ms；AI 阶段文字交叉淡入，不显示伪造百分比。
- 问题解决、拖拽排序、视频结果和最佳结果选择使用一次性状态动画。
- 首章、全部质检通过、首集剧本和首个视频允许 400ms 内的克制里程碑效果。
- reduced-motion 下取消位移、流光、粒子和自动动画，只保留即时状态切换。

## 4. 粒度策略与执行约定

### 4.1 粒度策略

- 以一个用户可见结果、协议能力、数据安全边界或独立 Gate 为 loop，不按文件和前后端拆分。
- 同一结果所需的 renderer、Electron、DB、服务、SDK、测试、配置和文档放在同一 loop。
- LM4-01、LM4-03、LM4-08、LM4-13、LM4-18、LM4-26/27、LM4-30 涉及独立数据、
  公共协议、外部供应商或回滚边界，必须保持独立。
- 测试不后置成“补测试 loop”；LM4-00、LM4-04、LM4-21、LM4-31 是可以独立阻断发布的 Gate。
- 动效不是独立装饰任务：LM4-05 建立底座，各页面 loop 同时交付对应状态动效与 reduced-motion。
- 若实际 diff 超出一次 30～60 分钟聚焦 review 的可理解范围，执行前先更新本地图并按
  `LOOPRULE.md` 3.3.3 拆分；不得在实现过程中私自批量推进多个 loop。

### 4.2 Git 与状态约定

- 所有规划 loop 初始状态为 `todo`。
- 每个 loop 开始时记录当前目标分支；本地图不假定永远是 `main`。
- 分支格式：`loop/lm4-<id>-<short-topic>`，例如 `loop/lm4-01-content-persistence`。
- 严格执行：检查工作区 → fetch/ff-only → loop 分支 → 实现 → 验证 → diff 审查 → 提交 →
  再同步目标分支 → 合并 → 合并后验证 → 推送 → 清理 loop 分支。
- 未推送、未清理、工作区有未解释残留或外部证据不足时，只能是 `partial`，不能是 `done`。
- 每完成一个 loop，在第 12 节追加记录，不覆盖历史记录。

### 4.3 通用验证入口

以下命令按风险选择；`pnpm test:ui` 由 LM4-00 建立后成为后续 Desktop UI loop 的必选项。

```bash
# 通用
git status --short --branch
git diff --check

# Desktop
cd dramaip-desktop
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:db
pnpm test:ui
pnpm test:e2e
pnpm package:smoke

# Platform clients
cd dramaip-platform/clients
pnpm lint
pnpm typecheck
pnpm build:web
pnpm build:admin

# Platform services/contracts
cd dramaip-platform/services
GOCACHE=/tmp/dramaip-go-build go test ./...
make event-contracts

# Platform integrated runtime
cd dramaip-platform
make web-route-smoke
make platform-e2e
```

需要本机临时 HTTP/Redis 监听、Docker、支付沙箱、供应商沙箱或真实凭据的验证，必须在
获授权的隔离环境运行；不能把沙箱禁止端口或缺少外部账号误判成代码失败，也不能把
未运行的外部验证写成通过。

## 5. Gate 与优先级

| Gate | 目标 | 进入条件 | 通过条件 | 阻断后续 |
| --- | --- | --- | --- | --- |
| G0 基线 Gate | 固化 UI、状态和验证基线 | 本地图批准 | LM4-00 done | 全部实现 loop |
| G1 P0 Gate | 消除内容丢失、状态失真和正式支付断点 | LM4-00 | LM4-01～04 done | P1/P2 用户发布 |
| G2 P1 Core Gate | Desktop 核心创作体验与跨端状态闭环 | G1 | LM4-05～21 done | 制片重构、生态扩展 |
| G3 Production UX Gate | 改编到视频制作体验闭环 | G2 | LM4-22～25 done | 真实视频渠道发布 |
| G4 Ecosystem Gate | 外部渠道、Web AI、Admin、快照闭环 | G2/G3 | LM4-26～30 done | 全量发布 |
| G5 Full Gate | LOOPMAP4 全量可发布 | G1～G4 | LM4-31 done | 无 |

## 6. P0/P1/P2 覆盖映射

| 原优化项 | 优先级 | 对应 Loop |
| --- | --- | --- |
| 章节/剧本/镜头统一保存、离开保护、恢复草稿 | P0 | LM4-01 |
| 最新质检、内容过期、视频可用产物真值 | P0 | LM4-02 |
| 正式支付渠道、下单、支付入口、状态轮询 | P0 | LM4-03 |
| P0 自动化与端到端发布阻断 | P0 | LM4-04 |
| 视觉 Token、主题、密度、焦点、动效、reduced-motion | P1 | LM4-05 |
| App Shell、分层导航、可调宽面板、深链、专注模式 | P1 | LM4-06 |
| 项目首页、创建入口、进度与当前动作 | P1 | LM4-07 |
| 废纸篓、恢复与最终删除 | P1 | LM4-08 |
| 章节树、长篇导航、编辑器专注与快捷键 | P1 | LM4-09 |
| AI 操作分类、推荐、搜索、命令面板 | P1 | LM4-10 |
| 持续任务中心、取消、恢复、崩溃重启语义 | P1 | LM4-11 |
| Cloud AI 权威 preflight、余额和预计消耗 | P1 | LM4-12 |
| revision task 原子采用和一步撤销 | P1 | LM4-13 |
| 分段 Diff、编辑后采用、结构化部分采用 | P1 | LM4-14 |
| 当前改编/季度选择和一致导航 | P1 | LM4-15 |
| 质量闸门分组、过期、风险接受、定位和可访问图表 | P1 | LM4-16 |
| 统一确认/表单/Undo 交互，移除原生阻塞对话框 | P1 | LM4-17 |
| 版本化客户端契约和参数一致性 | P1 | LM4-18 |
| Mobile 草稿管理、采用状态、删除与保留策略 | P1 | LM4-19 |
| Web 账户 read model、局部错误和真实查询参数 | P1 | LM4-20 |
| P1 UI、无障碍、视觉回归和完整核心链路 Gate | P1 | LM4-21 |
| 统一改编制作壳与分集规划 | P2 | LM4-22 |
| 结构化剧本编辑器 | P2 | LM4-23 |
| 分镜 Storyboard、素材 Inspector、拖拽与预览 | P2 | LM4-24 |
| 视频队列、自动轮询、费用预估、多结果对比 | P2 | LM4-25 |
| 两个真实视频供应商 | P2 | LM4-26、LM4-27 |
| Web AI 作者化、模型目录、preflight、streaming | P2 | LM4-28 |
| Admin 用户/支付/通知/AI 成本操作台 | P2 | LM4-29 |
| 用户主动触发的端到端加密项目快照 | P2 | LM4-30 |
| 全量回归、打包、发布、回滚和完成证明 | P2 | LM4-31 |

## 7. Loop 总览

本节总览与第 8 节详细定义共同构成 `LOOPRULE.md` 3.2 要求的 Loop 表。

| Loop | P | Owner | 状态 | 单一目标 | 主要范围 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| LM4-00 | P0 | QA/产品体验 | done | 建立可重复的 UI、无障碍和状态基线 Gate | Desktop UI harness、fixtures、截图、审计文档 | 无 |
| LM4-01 | P0 | Desktop/数据可靠性 | done | 确保所有核心编辑内容在切换、关闭和崩溃时不丢失 | Chapter/Script/Shot、IPC、DB、Electron lifecycle | LM4-00 |
| LM4-02 | P0 | Desktop/工作流 | done | 让阶段、质检和视频完成状态反映最新真实产物 | workflow guide、readiness、quality、versions、video | LM4-00 |
| LM4-03 | P0 | Web/Billing | done | 恢复正式支付下单到结果确认的用户闭环 | Pricing、SDK、Web BFF、Billing、订单页 | LM4-00 |
| LM4-04 | P0 | Release/QA | done | 通过 P0 可靠性与交易回归 Gate | Desktop、Web、Billing、E2E、发布记录 | LM4-01～03 |
| LM4-05 | P1 | Design System/前端 | done | 建立统一视觉、主题、密度、动效和无障碍基础 | globals、Tailwind、UI primitives、Appearance | LM4-04 |
| LM4-06 | P1 | Desktop/产品体验 | done | 交付统一响应式 App Shell 和可深链导航 | App、Routes、Workspace、shell/layout/store | LM4-05 |
| LM4-07 | P1 | Desktop/项目体验 | done | 让首页和创建流程直接引导用户继续当前创作 | ProjectList、CreateProject、project summaries | LM4-06 |
| LM4-08 | P1 | Desktop/数据生命周期 | done | 交付可恢复的项目废纸篓和最终删除边界 | DB migration/repo、项目首页、导入导出 | LM4-07 |
| LM4-09 | P1 | Desktop/编辑器 | done | 交付适合长篇项目的章节树与专注写作体验 | Workspace、chapter tree、TipTap、shortcuts | LM4-01、LM4-06 |
| LM4-10 | P1 | Desktop/AI 产品 | done | 将 AI 按钮墙重构为上下文推荐和可搜索命令入口 | AI panel、command palette、task metadata | LM4-05、LM4-06 |
| LM4-11 | P1 | Desktop/任务可靠性 | done | 交付跨页面、跨重启可追踪的任务中心 | long task runtime/repo、task dock、monitor | LM4-01、LM4-10 |
| LM4-12 | P1 | Desktop/Cloud AI | done | 在真实生成前完成权威模型和额度预检 | Desktop AI IPC/provider、Desktop BFF、AI Gateway | LM4-10、LM4-11 |
| LM4-13 | P1 | Desktop/AI 数据安全 | done | 将修稿采用、版本和任务完成收口为原子事务 | creative IPC、revision repo、content versions | LM4-01、LM4-10 |
| LM4-14 | P1 | Desktop/AI 体验 | done | 支持分段比较、编辑和部分采用 AI 结果 | diff/preview/version UI、apply contracts | LM4-05、LM4-13 |
| LM4-15 | P1 | Desktop/改编上下文 | done | 让所有页面共享明确的当前改编和季度 | project/adaptation repo、Workspace、routes | LM4-02、LM4-06 |
| LM4-16 | P1 | Desktop/质量体验 | done | 将质量闸门改为可定位、可解释、可复检的行动中心 | quality dashboard、charts、diagnostics | LM4-02、LM4-05、LM4-15 |
| LM4-17 | P1 | Desktop/交互一致性 | done | 用统一可访问交互替换全部原生 confirm/prompt | dialogs、forms、toasts、renderer call sites | LM4-05、LM4-06 |
| LM4-18 | P1 | 契约治理 | done | 建立 Web/Mobile/Admin/Desktop 的版本化客户端契约 Gate | proto/OpenAPI/schema、SDK、BFF、CI | LM4-04 |
| LM4-19 | P1 | Mobile/Desktop 接续 | done | 完成移动草稿的创建、同步、采用、删除和保留生命周期 | Mobile、Inspiration、Mobile/Desktop BFF、Desktop | LM4-13、LM4-18 |
| LM4-20 | P1 | Web/Reporting | done | 交付可信、低请求数且能表达局部故障的账户 read model | Account UI、Web BFF、reporting、SDK | LM4-18 |
| LM4-21 | P1 | QA/Release | done | 通过核心体验、视觉、无障碍和跨端状态 Gate | Desktop/Platform clients/services、UI matrix | LM4-05～20、LM4-12R |
| LM4-12R | P1 | Web/Cloud AI | done | 修复 Web 同步 Chat 的权威预检绑定兼容性 | Web BFF、AI Gateway hash helper、SDK、Web Chat | LM4-12、LM4-18；LM4-21 Gate 阻断记录 |
| LM4-22 | P2 | Desktop/改编产品 | done | 统一改编到交付的生产壳和分集规划体验 | adaptation/script/shot/video routes、shell | LM4-15、LM4-16、LM4-21、LM4-12R |
| LM4-23 | P2 | Desktop/剧本编辑 | done | 交付结构化、可保存、可审稿的剧本编辑器 | ScriptWorkspace、script model/version/export | LM4-01、LM4-22 |
| LM4-24 | P2 | Desktop/分镜产品 | done | 交付 Storyboard 和分镜素材 Inspector | ShotWorkspace、assets、drag/drop、versions | LM4-05、LM4-22、LM4-23 |
| LM4-25 | P2 | Desktop/视频产品 | done | 交付可预估、可排队、自动轮询和多结果对比的视频台 | VideoGeneration、tasks/results、task center | LM4-11、LM4-24 |
| LM4-26 | P2 | Video Provider | partial | 接通首个真实国内视频供应商 | provider adapter、settings、fixtures、sandbox | LM4-25 |
| LM4-27 | P2 | Video Provider | todo | 接通第二个独立真实视频供应商 | provider adapter、settings、fixtures、sandbox | LM4-26 |
| LM4-28 | P2 | Web/AI 产品 | todo | 将 Web AI 交付为作者可用的模型、预检、流式会话体验 | Web chat、Web BFF、AI Gateway、SDK | LM4-12R、LM4-18、LM4-21 |
| LM4-29 | P2 | Admin/运营 | todo | 交付用户、支付、通知和 AI 成本运营操作台 | Admin UI/BFF、reporting、audit/RBAC | LM4-18、LM4-20、LM4-21 |
| LM4-30 | P2 | Sync/隐私 | todo | 交付端到端加密、手动触发的项目快照备份 | Desktop package/crypto、snapshot API/store、retention | LM4-08、LM4-18、LM4-21、LM3-34 |
| LM4-31 | P2 | Release | todo | 通过 LOOPMAP4 全量发布 Gate | 全仓、全端 E2E、打包、运行手册、发布说明 | LM4-22～30 |

## 8. Loop 详细定义

### LM4-00：UI、无障碍与状态基线 Gate

- **目标**：建立后续 UI 和交互 loop 可重复使用的 fixture、截图、键盘和无障碍验收入口。
- **主要范围**：Desktop UI 测试脚本、隔离 userData fixture、关键路由导航、截图目录约定、
  axe/等价扫描、`package.json` 验证入口、审计记录。
- **不在范围**：修改现有业务 UI、修复本地图列出的产品问题。
- **内部 checklist**：建立 `pnpm test:ui`；构造空项目/长篇项目/多改编/失败任务/视频结果
  fixture；覆盖 1024/1320/1600px 和 light/dark/reduced-motion；记录关键键盘路径和现状截图；
  确保 fixture 不含真实正文、凭据或个人路径。
- **验收**：单命令可在隔离数据上打开关键页面、执行基础导航、输出确定性截图和无障碍报告；
  失败能定位到页面、状态和视口；现状问题仅记录不伪装成通过。
- **验证**：`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`；人工核对
  截图矩阵和脱敏；`git diff --check`。
- **风险/回滚边界**：测试依赖和 Electron 启动基础设施；回滚整个 harness，不修改用户数据库或
  生产启动路径。

### LM4-01：统一内容持久化与离开保护

- **目标**：确保章节、剧本和镜头草稿在切换对象、切换路由、关闭窗口、保存失败和崩溃重启时不丢失。
- **主要范围**：`ChapterEditor`、Workspace、Script/Shot workspace、Electron window lifecycle、
  IPC/repositories、恢复缓冲、保存状态 UI。
- **不在范围**：章节树重构、结构化剧本、云快照。
- **内部 checklist**：定义统一 `clean/dirty/saving/saved/error/recovered` 状态机；章节卸载/关闭前
  flush 并等待 IPC ack；剧本和镜头切换使用自动保存或 Dirty Guard；实现本地恢复缓冲和重启提示；
  增加 `Cmd/Ctrl+S`、失败重试和并发写版本检查。
- **验收**：输入后立即切换章节/集/镜头或关闭应用不丢最后一次修改；模拟 IPC 失败时原草稿仍可
  复制、重试和恢复；AI 写入不能覆盖未保存人工草稿；所有编辑面显示一致保存状态。
- **验证**：保存状态单测；切换/关闭/失败/崩溃 Electron UI 测试；`pnpm typecheck`、
  `pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：核心本地数据写路径；迁移向后兼容，恢复缓冲在确认主数据写入前不得删除；
  回滚不得丢弃已生成恢复记录。

### LM4-02：工作流真值、最新报告与内容新鲜度

- **目标**：让项目阶段、改编就绪度、质检阻塞和视频完成状态只反映最新、有效且可解释的数据。
- **主要范围**：`projectWorkflowGuide`、`adaptationReadiness`、quality report/repo、内容版本或 revision、
  video tasks/results、项目概览和质量摘要。
- **不在范围**：质量闸门页面重设计、当前改编选择器。
- **内部 checklist**：按 target/stage 选择最新有效报告；记录或推导报告对应的源版本；源内容变化后标记
  stale；视频阶段要求成功任务和可用结果；统一所有页面的阶段计算入口并补历史数据兼容。
- **验收**：旧失败报告不阻塞最新通过结果；修改正文后旧报告明确显示过期；pending/failed 视频任务
  不会被标成完成；概览、就绪面板和质量页对同一项目给出一致状态。
- **验证**：最新报告、版本过期、视频状态组合单测；DB migration replay（如有迁移）；三类项目 fixture
  UI smoke；`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`。
- **风险/回滚边界**：工作流公共语义和可能的数据迁移；旧记录只兼容读取，不删除历史报告和任务。

### LM4-03：正式支付渠道与订单体验闭环

- **目标**：让非模拟环境从套餐页创建受支持的微信或支付宝订单，并完成支付入口展示、状态轮询和异常恢复。
- **主要范围**：Web Pricing/Order UI、runtime config、共享 SDK、Web BFF checkout、Billing provider 选择、
  订单过期/查询、契约和测试。
- **不在范围**：改变支付激活 Saga、账本规则或接入第三种渠道。
- **内部 checklist**：移除 `production` 伪渠道；由安全配置或用户明确选择 `wechat_pay/alipay`；下单后
  跳转订单页并展示二维码/支付 URL/过期时间；轮询服务端状态并提供过期重试；模拟模式继续可用；
  增加客户端/BFF/Billing 契约测试和支付失败文案。
- **验收**：正式配置不会因 unsupported provider 失败；两渠道订单创建参数正确；客户端成功提示不能
  直接激活权益；paid/expired/failed/pending 均有明确界面和恢复动作。
- **验证**：Web 单元/组件测试；Billing biz 与 BFF HTTP 测试；签名 fixture 和隔离 webhook integration；
  `pnpm lint && pnpm typecheck && pnpm build:web`；`go test ./...`；健康栈 `make platform-e2e`；
  官方沙箱证据在渠道启用前必需。
- **风险/回滚边界**：用户交易和外部渠道；按 provider Feature Flag 独立回滚，保留订单、webhook、订阅、
  quota 和审计历史；禁止通过回退到客户端确认规避故障。

### LM4-04：P0 可靠性与交易 Gate

- **目标**：以独立发布 Gate 证明内容可靠性、工作流真值和正式支付断点已经闭环。
- **主要范围**：LM4-01～03 累计 diff、Desktop/Platform 回归、故障 fixture、验收记录和回滚说明。
- **不在范围**：实现新的 UI 能力或为了通过测试修改业务规则。
- **内部 checklist**：复跑切换/关闭/崩溃草稿用例；复跑最新质检/过期/视频产物矩阵；复跑模拟支付和
  两正式渠道契约；审查迁移/日志/截图不泄密；形成 G1 验收记录。
- **验收**：P0 所有自动化和人工路径通过；任何未运行的关键外部验证明确阻断对应渠道发布；没有以豁免
  方式宣称生产闭环。
- **验证**：Desktop `pnpm test`、`pnpm test:ui`、`pnpm test:e2e`、必要时 `package:smoke`；Platform
  clients lint/typecheck/build；Go 全量测试；支付 integration；健康栈 E2E；累计 diff 审查。
- **风险/回滚边界**：发布 Gate；失败回到对应能力 loop，不在 Gate 内混入功能修复。

### LM4-05：视觉、主题、密度、动效与无障碍基础

- **目标**：建立所有后续页面共享的影视化编辑工作室视觉和可访问交互基础。
- **主要范围**：`globals.css`、Tailwind tokens、UI primitives、Theme provider、Appearance 设置、
  typography、focus、motion utilities、component examples/tests。
- **不在范围**：逐页重排业务信息架构、复杂 Storyboard 或视频页面。
- **内部 checklist**：定义 canvas/surface/brand/AI/success/warn/block 语义 token；支持 light/dark/system；
  提供舒适/紧凑密度和编辑字体；统一焦点、最小字号、暗色 diff/chart 色；建立页面/导航/保存/AI/列表
  动效 primitive；实现 reduced-motion 和对比度检查。
- **验收**：基础组件不再依赖固定浅色语义色；主题切换无明显白屏；键盘焦点清晰；12px 以下业务文字
  仅允许有明确豁免；动效规范可在 reduced-motion 下静态使用。
- **验证**：UI primitive tests、axe/等价扫描、light/dark/system/reduced-motion 截图、键盘 smoke、
  对比度人工检查；`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：全局样式和基础组件；通过 token 兼容旧 class，禁止一次性机械改写全 renderer。

### LM4-06：统一 App Shell、响应式布局与深链

- **目标**：让 Desktop 在不同窗口宽度下保留可用创作画布，并提供一致导航、面包屑和可恢复页面状态。
- **主要范围**：App/Routes、Workspace shell、全局 rail、context sidebar、Inspector、splitter/store、
  project/adaptation breadcrumbs、theme/task/account placement。
- **不在范围**：各业务页面内部内容重构、章节树数据能力。
- **内部 checklist**：交付全局 rail 和项目阶段导航；左右栏可折叠/调宽并持久化；<1180px 自动隐藏
  Inspector，<1050px 收缩 context sidebar；实现专注模式；section/chapter/adaptation/episode/scene/shot
  写入 URL；统一 loading/error/empty shell；主题入口移出固定左下角。
- **验收**：1024px 无关键操作横向溢出；1320px 正文有效区约 680px 以上；前进/后退恢复当前对象；
  刷新深链不丢 section；专注模式和面板状态重启后可恢复。
- **验证**：三宽度×两主题×reduced-motion 截图；深链/前进后退/拖拽 splitter UI 测试；键盘 smoke；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：全局路由和布局；保留旧 URL redirect，按 shell Feature Flag 可整体回退，不删除页面能力。

### LM4-07：项目首页与渐进式创建体验

- **目标**：让用户从首页直接识别最近项目、当前阶段、阻塞项和唯一下一步动作。
- **主要范围**：ProjectList、CreateProject、项目摘要 query/repo、全局搜索入口、项目卡和空状态。
- **不在范围**：项目最终删除、章节树、完整模板市场。
- **内部 checklist**：顶部收束为搜索和单一“新建”主动作；导入/创建改编进入下拉；项目卡展示阶段、
  最近章节、字数/章节、质量阻塞、当前改编和更新时间；支持搜索/排序/置顶；创建页提供空白/灵感/导入
  入口和类型快速选择；加入克制的卡片 hover、渐进展开和 skeleton。
- **验收**：用户 5 秒内能判断至少一个项目的当前阶段和下一步；常用继续写作一次点击可达；空列表有
  可执行引导；1024px 首页不拥挤，键盘可完成搜索与创建。
- **验证**：空/单项目/多项目/长标题/阻塞项目 UI tests 和截图；项目摘要单测；`pnpm typecheck`、
  `pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：项目读取性能；摘要优先本地聚合且可缓存，回滚 UI 不改变项目数据。

### LM4-08：项目废纸篓与可恢复删除

- **目标**：把不可恢复项目删除改为可撤销、可恢复、可审计的数据生命周期。
- **主要范围**：DB migration/repository、项目首页废纸篓、导入/导出/搜索过滤、最终删除、恢复和清理策略。
- **不在范围**：云端账号删除、移动草稿删除、实时同步墓碑。
- **内部 checklist**：新增 soft-delete 元数据；默认列表/搜索隐藏废纸篓；删除后 Undo；废纸篓支持恢复；
  最终删除显示依赖规模并强确认；定义自动保留期限但默认不在后台无提示清空；项目包导出/导入明确行为。
- **验收**：普通删除不会立即丢数据；恢复后关联章节、改编、资产和版本完整；最终删除不可绕过确认；
  migration replay 和旧库读取通过。
- **验证**：repository/foreign-key/restore/purge tests；DB replay/smoke；UI Undo/restore/final delete 测试；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`。
- **风险/回滚边界**：本地项目生命周期；软删除字段可向后兼容，最终清理必须事务化，回滚不得错误清空废纸篓。

### LM4-09：长篇章节树与专注编辑体验

- **目标**：让 100～300 章项目可以快速定位、分组、排序和持续写作。
- **主要范围**：Workspace context sidebar、chapter/arc data、TipTap toolbar、编辑显示设置、快捷键、状态摘要。
- **不在范围**：新增长篇业务模型、结构化剧本编辑。
- **内部 checklist**：用卷/单元/章节树替换单 Select；支持搜索、折叠、拖拽排序、批量选择和虚拟化；
  显示字数、保存、记忆和质检状态；增加字号/行距/正文宽度、字数目标、打字机滚动和专注模式；提供
  Cmd/Ctrl+N、S、K、上下切章；选中文本显示上下文 AI 入口。
- **验收**：300 章 fixture 下滚动/搜索/切章流畅；拖拽后顺序持久化；快捷键和焦点无冲突；编辑区默认
  16px 以上且不会因侧栏压缩到不可写；保存状态来自 LM4-01 真值。
- **验证**：排序/分组/搜索单测；300 章性能 smoke；键盘与 screen reader smoke；三宽度截图；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`（如变更排序模型）、`pnpm test:ui`。
- **风险/回滚边界**：章节顺序写入；拖拽必须事务化/幂等，旧顺序字段兼容，UI 可回退为列表而不丢顺序。

### LM4-10：上下文 AI 助手与命令面板

- **目标**：把平铺 AI 按钮收束为当前推荐、分类、搜索和快捷命令，同时保留全部既有任务能力。
- **主要范围**：AiAssistantPanel、Agent command console、全局 command palette、task metadata、快捷键和文案。
- **不在范围**：长任务持久化、权威 Cloud AI preflight、分段 Diff。
- **内部 checklist**：定义继续创作/语言风格/冲突爽点/短剧化/结构修复分类；每个上下文只显示最多
  三个推荐；支持搜索、收藏、最近使用和 Cmd/Ctrl+K；明确预览/快照/自动写入策略；普通操作使用紧凑
  预检摘要并可展开详情；AI 运行使用可访问的阶段流光/静态 reduced-motion 状态。
- **验收**：所有旧任务仍可达；当前章节的常用任务两次操作内启动；一个表面最多一个主 CTA；键盘可搜索、
  查看写入策略并退出；无章节时不会只用 Toast 解释阻塞。
- **验证**：任务目录完整性测试、推荐规则单测、命令面板键盘 UI 测试、上下文摘要截图；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：任务可达性和写入策略；保留完整任务注册表，UI 回滚不能改变 `TASK_WRITE_POLICIES`。

### LM4-11：持续任务中心与崩溃恢复

- **目标**：让 AI、批处理和视频长任务跨页面、跨窗口和跨重启可追踪、可取消、可恢复。
- **主要范围**：long task runtime/repository、Electron startup reconciliation、Task Monitor、全局 task dock、
  provider polling、通知和恢复策略。
- **不在范围**：视频生产台重设计、供应商 adapter 实现。
- **内部 checklist**：启动时将失联 `running` 转为 interrupted/retryable 或恢复远端 polling；统一排队/阶段/
  进度/错误/重试/取消语义；全局 task dock 显示当前与最近任务；切页不丢运行反馈；重试幂等并防重复写；
  任务完成/失败使用持久记录和一次性状态动效。
- **验收**：模拟崩溃重启后没有永久 running；远端任务可重新查询；本地 AI 任务明确中断且可安全重试；
  用户在任何页面都能找到、取消或理解任务；失败不会只存在于 Toast。
- **验证**：runtime/repository/reconciliation 单测；崩溃重启 Electron test；并发/取消/幂等测试；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：持久任务状态与重复写；旧状态兼容，恢复策略以保守中断为默认，禁止盲目重放已写任务。

### LM4-12：真实生成前的 Cloud AI 权威预检

- **目标**：在 Desktop 真实 Cloud AI 请求前确认模型可用、输入规模、预计消耗和剩余额度。
- **主要范围**：AI IPC/workflow/provider、prompt 构建、Desktop BFF preflight、AI Gateway/quota、UI 摘要和错误语义。
- **不在范围**：改变用户 quota 计费规则、Web AI streaming。
- **内部 checklist**：在最终 prompt 构建后调用权威 preflight；绑定 provider/model/request hash；展示预计 token、
  余额和模型能力；模型不可用/额度不足在 Provider 调用前阻断；本地 BYOK 保留本地估算；处理预检后到执行前
  的竞态并以服务端预扣为最终真值。
- **验收**：连接测试不再是唯一 preflight 入口；实际生成可在发送前显示权威信息；额度不足不会调用 Provider；
  preflight 与 Chat 使用同一模型和输入边界；敏感正文不进入日志。
- **验证**：Desktop provider/IPC tests、Desktop BFF HTTP tests、AI Gateway/quota tests、竞态/余额不足 fixture、
  Cloud AI E2E；Desktop/Go 全量相关测试和脱敏扫描。
- **风险/回滚边界**：Cloud AI 商业写路径；可通过 Cloud AI Feature Flag 回退，但不得绕过 quota/幂等/预扣。

### LM4-13：修稿任务原子采用与一步撤销

- **目标**：将 AI 修稿的内容版本、目标写入、revision task 完成和撤销信息作为一个原子业务操作。
- **主要范围**：creative IPC、revision/content version repositories、chapter/script/shot apply、并发版本检查、UI 状态。
- **不在范围**：分段采用 UI、任意历史版本管理重写。
- **内部 checklist**：预览状态改为 preview_ready；实现单一 `adoptRevisionTask` main-process command；事务内检查
  target revision、保存前快照、应用内容和完成任务；重复调用幂等；采用后提供一步撤销并记录审计；失败返回可恢复状态。
- **验收**：不存在“正文已改但任务未完成”或反向不一致；重复采用不会重复生成版本；并发编辑会被检测并要求
  重新预览；撤销恢复采用前内容且保留审计。
- **验证**：事务/幂等/并发/故障注入 DB tests；IPC contract tests；章节/剧本/镜头采用 UI smoke；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`。
- **风险/回滚边界**：核心内容和任务数据原子写；迁移/新 command 向后兼容，已采用版本不得因代码回滚被删除。

### LM4-14：可编辑、可分段采用的 AI 预览

- **目标**：让用户能理解并选择 AI 的具体修改，而不是只能整份采用或丢弃。
- **主要范围**：TextDiffPreview、GeneratePreview、ContentVersionPanel、diff 算法/worker、结构化 selection、主题和快捷键。
- **不在范围**：改变模型 prompt、revision 原子事务。
- **内部 checklist**：提供 inline/side-by-side/结果三视图；按段落或结构项采用/拒绝；允许编辑候选再采用；
  跳转上/下改动并显示原因；人物/章节/分集生成支持部分选择和冲突提示；长文本 diff 移出阻塞 UI；采用后高亮
  变更并提供 Undo。
- **验收**：中文长段落不会因逐行算法变成不可读整页红绿块；可只采用一个段落或一个结构项；暗色模式语义色
  可读；键盘和 screen reader 能理解添加/删除而不依赖颜色。
- **验证**：diff/selection/long-text 性能 tests；light/dark/reduced-motion screenshots；键盘和 axe；章节/剧本/镜头/
  分集人工 smoke；`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：候选合并语义；最终写入仍走 LM4-13 原子 command，UI 可整体回退为全量采用。

### LM4-15：当前改编、季度与上下文一致性

- **目标**：让多改编、多季度项目在所有页面拥有明确、持久且一致的当前上下文。
- **主要范围**：project/adaptation repository、project preference、Workspace、workflow snapshot、adaptation/script/shot/video routes。
- **不在范围**：生产页面布局重构、自动合并多个改编数据。
- **内部 checklist**：定义 active adaptation/season 选择规则；首次兼容迁移采用明确默认并提示；项目头/面包屑提供
  选择器；所有进度、episodes/scripts/shots/video 查询使用同一上下文；删除/归档当前改编时安全回退；深链覆盖 context id。
- **验收**：页面不再隐式依赖 `adaptations[0]`；切换改编后所有下游数据一致刷新；重启和深链保持选择；概览不会
  把不同改编的数据混算。
- **验证**：多改编/多季度 repository 和 workflow tests；路由/重启 UI smoke；`pnpm typecheck`、
  `pnpm test:unit`、`pnpm test:db`（如迁移）、`pnpm test:ui`。
- **风险/回滚边界**：项目偏好与上下文路由；保留旧 route redirect，选择字段可回退但不得删除改编内容。

### LM4-16：质量闸门行动中心与可访问分析

- **目标**：让质量问题可分组、可定位、可解释、可接受风险并在修复后自动复检。
- **主要范围**：QualityGateDashboard、diagnosis sections、charts、issue actions、stale status、routing 和审计。
- **不在范围**：新增模型评分维度、改变内容审核政策。
- **内部 checklist**：按阶段/目标/严重度分组过滤；展示 stale 和阻塞下一阶段原因；支持接受风险/忽略/备注并审计；
  点击定位具体章节/场景/镜头并高亮；修复后自动刷新/复检；图表增加 tooltip、数据点、图例筛选和数据表；解决卡片
  使用一次性成功折叠动画。
- **验收**：用户能从每个阻塞项直接到目标并理解解除条件；已过期报告不能显示为当前通过；风险接受有操作者和时间；
  图表不依赖颜色且无 8px 标签。
- **验证**：issue grouping/action/audit tests；stale integration；路由定位 UI tests；axe/chart data table；截图矩阵；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：质量门禁语义；接受风险只追加审计，不删除原问题，UI 可回退但真值逻辑保持 LM4-02。

### LM4-17：统一确认、表单、Undo 与反馈交互

- **目标**：移除 renderer 中原生阻塞式 `confirm/prompt`，统一所有危险操作、输入和恢复反馈。
- **主要范围**：ConfirmDialog、Prompt/FormDialog、UndoToast、live region、所有 renderer call sites、错误展示规范。
- **不在范围**：项目废纸篓数据模型、AI 预览、平台浏览器原生交互。
- **内部 checklist**：建立可访问确认和表单 primitive；迁移删除/取消/恢复/结构替换/平台选择等 call sites；危险确认
  展示对象、影响和可恢复性；短期可撤销操作使用 Undo；错误不只存在于 Toast 并关联任务/目标；移除所有
  `window.confirm/window.prompt`。
- **验收**：renderer 搜索不到业务 `window.confirm/prompt`；Escape、Tab、Enter、焦点恢复和 screen reader label 正确；
  平台选择使用结构化 Select 和能力提示；连续错误可在页面或任务中心重新找到。
- **验证**：primitive unit/UI tests；全 renderer 静态检查；键盘/axe smoke；删除、恢复、取消任务、结构替换、平台选择
  人工 smoke；`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`。
- **风险/回滚边界**：危险操作确认；迁移逐调用点审查，不能因替换 UI 降低确认或错误处理级别。

### LM4-18：版本化客户端契约与参数一致性 Gate

- **目标**：让 Web、Mobile、Admin、Desktop 通过可生成、可校验、可版本化的端专属协议调用平台。
- **主要范围**：proto/OpenAPI/JSON schema、SDK generation、BFF schemas、Mobile/Admin clients、Desktop BFF contract、CI。
- **不在范围**：合并端专属 BFF、把完整 Desktop core types 暴露给平台。
- **内部 checklist**：为端外部 HTTP 契约建立权威 schema；生成或校验 Web/Mobile/Admin clients；发布窄版 Desktop
  models/preflight/chat/inspiration 协议；统一 limit/days/provider/error/trace 字段；增加 breaking/generated-diff Gate；
  记录版本和废弃窗口。
- **验收**：SDK 参数在 BFF 真实生效；不存在 Web SDK 有参数但服务端硬编码忽略；Mobile/Admin 不再手写关键响应解析；
  Desktop 协议有版本、限制和错误码；不兼容变化会在 CI 失败。
- **验证**：contract generation/diff、buf lint/generate、BFF schema tests、各端 typecheck、端到端 request fixture、
  `make event-contracts`、`go test ./...`、clients lint/typecheck/build。
- **风险/回滚边界**：公共兼容协议；新增版本并保留旧版本窗口，禁止覆盖已发布 schema 或一次性破坏所有端。

### LM4-19：移动草稿与 Desktop 接续生命周期

- **目标**：让移动灵感草稿从创建、离线、同步、采用到删除具有清晰、可控和一致状态。
- **主要范围**：Expo Mobile UI/storage、Mobile BFF、Inspiration service/schema、Desktop BFF、Desktop InspirationDesk、retention。
- **不在范围**：完整项目双向同步、Desktop 项目 ID 上传、移动端完整编辑器。
- **内部 checklist**：Mobile 增加草稿列表、编辑、删除、同步/失败/待同步计数和手动重试；超 100 条不静默截断；
  API 返回 adoption count/last adopted；Desktop 区分未采用/当前项目已采用/可用于其他项目；增加分页和幂等；定义云端
  删除、导出、保留和本地已同步清理策略。
- **验收**：已采用草稿重载后不会再次伪装为“待采用”；同一 idempotency key 不重复记录；离线创建和恢复网络后同步可见；
  用户能删除和导出自己的云草稿；不上传 Desktop 本地 project id。
- **验证**：Mobile storage/queue tests、Inspiration repo/biz/BFF tests、Desktop adopt tests、离线/重连/重复采用/删除 E2E、
  clients lint/typecheck、Go tests、Desktop UI tests。
- **风险/回滚边界**：用户云内容生命周期；删除使用软删除/保留窗口或明确不可恢复确认，adoption 审计不被级联误删。

### LM4-20：可信账户 Read Model 与局部故障表达

- **目标**：让账户首页以少量请求展示可信数据，并区分真实零值、未加载和下游局部故障。
- **主要范围**：Web Account UI、Web BFF aggregator、reporting/read model、SDK、usage/trend query、缓存/更新时间。
- **不在范围**：Admin 运营操作、改变 billing/quota 权威数据所有权。
- **内部 checklist**：定义 account bootstrap/read model；移除首页重复领域请求或按 tab 懒加载；下游错误返回 section status、
  trace id 和 last updated，不再吞错变零；让 limit/days 参数真实生效且有上限；空数组/null 语义稳定；增加缓存与失效规则。
- **验收**：首页网络请求数量显著收敛；billing/quota/notification 任一故障不会显示虚假零余额/零订单；30 天趋势返回 30 天
  语义；局部失败不阻塞其他可用板块。
- **验证**：aggregator partial-failure tests、HTTP query tests、SDK contract tests、Web component tests、浏览器 network smoke、
  clients lint/typecheck/build、Go tests、健康栈 E2E。
- **风险/回滚边界**：跨域聚合和缓存；BFF 只调用领域 API/read model，回滚不能恢复跨 schema 直连或吞错行为。

### LM4-21：P1 核心体验、视觉与无障碍 Gate

- **目标**：证明 Desktop 核心创作体验和跨端状态在目标宽度、主题、键盘和故障条件下可发布。
- **主要范围**：LM4-05～20 累计 diff、UI matrix、Desktop/Platform 回归、性能与无障碍记录。
- **不在范围**：实现新页面或在 Gate 中顺手修复业务代码。
- **内部 checklist**：执行首页→项目→章节→AI→Diff→质检→改编接续；验证 300 章、多个改编、失败任务、额度不足、
  移动草稿、账户局部故障；完成 1024/1320/1600、light/dark/reduced-motion 截图；完成键盘、axe、性能和敏感信息扫描；
  审查所有旧入口仍可达。
- **验收**：保存丢失为 0；1024px 无关键溢出；常用 AI 两次操作内可达；核心页面无阻断级 axe 问题；全部 P1 状态有
  自动化或可复现人工证据；未通过项明确阻断进入 P2 发布。
- **验证**：Desktop 全量 test/UI/E2E/package smoke；Platform clients lint/typecheck/build；Go 全量；contract Gate；健康栈 E2E；
  截图和人工 checklist；累计 diff 审查。
- **风险/回滚边界**：发布 Gate；失败回到对应 LM4-05～20 loop，不在 Gate 直接实现修复。

### LM4-12R：Web Cloud AI 预检绑定兼容修复

- **目标**：恢复既有 Web 同步 Chat 与 LM4-12 权威预检契约的兼容性，使其在调用 Provider 前完成同一最终请求的额度和模型预检。
- **主要范围**：Web BFF 的同步 preflight/chat 边界、复用的 Go 请求 hash helper、Web SDK 和现有 Chat 页面；与 HTTP/SDK/健康栈回归。
- **不在范围**：模型目录重构、作者任务 starter、会话历史、stream/cancel/reconnect 或新的计费规则；这些仍归 LM4-28。
- **内部 checklist**：将 canonical request hash 抽成 Gateway/Web BFF 共用实现；提供受认证、无日志正文的 Web preflight；预检返回估算、余额和请求绑定；SDK 先预检再提交同一 hash；Chat 继续由 Gateway 做最终 hash、幂等和 quota 预扣校验；补齐 HTTP、SDK 和健康栈断言。
- **验收**：原有 Web Chat 不再返回 `cloud_preflight_request_mismatch`；模型不可用或额度不足在 Provider 调用前可复现地失败；改变 provider/model/messages/max tokens 后旧 hash 不能执行；prompt 和凭据不进入新日志或持久化。
- **验证**：Gateway/Web BFF hash vector、preflight/chat HTTP tests、SDK/Web Chat tests、`pnpm lint`、`pnpm typecheck`、`pnpm build:web`、`GOCACHE=/tmp/dramaip-go-build go test ./...`、`make platform-e2e`；修复后重跑 LM4-21 Gate。
- **风险/回滚边界**：Cloud AI 商业路径和共享 hash 协议；可整体回退本兼容层，但不得恢复裸 Chat 或绕过 AI Gateway 的 hash、幂等、预扣和脱敏边界。

### LM4-22：统一改编生产壳与分集规划

- **目标**：让用户在一个连续上下文中从改编策略推进到分集、剧本、分镜、视频和交付。
- **主要范围**：Adaptation/Script/Shot/Video routes 和 shell、breadcrumb、stepper、episode overview、exports、active context。
- **不在范围**：结构化剧本、Storyboard 内部、视频供应商实现。
- **内部 checklist**：建立共享生产 stepper 和 project→adaptation→episode→scene→shot 面包屑；统一返回/下一步；导出收进
  单一菜单；分集支持卡片/表格/节奏线、筛选、批量选择和缺失状态；显示每阶段阻塞与完成；当前阶段连接线使用克制流光并
  支持 reduced-motion。
- **验收**：用户无需回首页即可走完生产导航；切换集数保留阶段和当前对象；每页只有一个主 CTA；导出仍全部可达；多季度
  不混数据；生产 stepper 状态与 LM4-02 一致。
- **验证**：route/context/stepper tests；多季度和缺失阶段 UI smoke；三宽度/主题截图；导出回归；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：跨页面导航；保留旧 routes redirect，生产 shell 可 Feature Flag 回退，不改变底层交付数据。

### LM4-23：结构化剧本编辑器

- **目标**：让短剧剧本以场景标题、动作、人物和对白结构编辑，同时保持 Markdown/JSON 兼容导出和可靠保存。
- **主要范围**：ScriptWorkspace、script content/schema or derived AST、editor extensions、scene synchronization、versions、export/import。
- **不在范围**：镜头 Storyboard、自动导演排练、多人实时协作。
- **内部 checklist**：定义兼容的剧本 block 模型或可逆解析；实现场景标题/人物/对白/动作样式和大纲导航；统一 autosave/dirty；
  AI 修改定位到 block 并复用 LM4-14；场景拆分前后保持版本和冲突提示；Markdown/JSON 往返不丢语义；提供纯文本回退。
- **验收**：用户能键盘完成常用剧本结构；切集不丢草稿；旧 Markdown 剧本可打开；结构化编辑后现有交付导出仍可用；
  AI 修改可定位并撤销。
- **验证**：parser/serializer roundtrip、migration replay、editor keyboard/UI、AI diff integration、export fixtures；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：剧本持久化格式；优先双读/兼容写和可逆迁移，回滚时必须保留原 Markdown/版本快照。

### LM4-24：分镜 Storyboard 与素材 Inspector

- **目标**：让场景和镜头通过可排序 Storyboard 管理，并在 Inspector 中完成 Prompt、视觉、音频、字幕、审查和版本操作。
- **主要范围**：ShotWorkspace、shot ordering、asset picker/drop zone、thumbnails、Inspector tabs、versions/reviews、exports。
- **不在范围**：视频任务队列、真实图片生成、供应商 adapter。
- **内部 checklist**：用 Storyboard 网格/时间线替代双重列表和长表单；镜头卡展示缩略图、景别、运动、时长、人物、风险和状态；
  拖拽排序/batch selection；Inspector 分信息/Prompt/资产/旁白字幕/审查/版本；URL/路径输入升级为文件选择和拖拽预览；AI 动作
  进入上下文菜单；实现 FLIP 排序和 reduced-motion 回退。
- **验收**：用户在一个画布内完成选镜、排序、编辑和资产检查；缺失资产可见且可定位；拖拽后顺序持久化；本地文件不上传；
  CSV/JSON/MD 导出顺序一致。
- **验证**：ordering/asset sync tests、drag/drop UI、缺失/远端/本地资产 fixture、导出回归、性能/截图/axe；
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`（如迁移）、`pnpm test:ui`。
- **风险/回滚边界**：镜头顺序和本地资产引用；排序事务化，文件操作不删除原文件，旧列表视图可回退。

### LM4-25：视频生产台、任务队列与结果对比

- **目标**：让镜头视频生成具备提交前预估、自动状态更新、批量队列和可解释的最佳结果选择。
- **主要范围**：VideoGeneration、video tasks/results、provider capability UI、task center、polling、batch、comparison player、exports。
- **不在范围**：实现新的 Provider adapter、视频剪辑合成。
- **内部 checklist**：提交前显示 provider/model/能力/参考图/预计费用/耗时；支持单个和批量排队、取消、重试；自动轮询并与 LM4-11
  恢复一致；结果支持 2-up/3-up 同步播放和全屏比较；最佳结果作为交付状态；骨架到结果和星标使用一次性动效；不可用 Provider
  明确禁用。
- **验收**：用户无需手动刷新即可看到任务最终状态；失败可重试且不重复计费/写结果；多个结果可同步对比；最佳结果在项目流程和
  导出中一致；未实现 provider 不能提交。
- **验证**：mock/custom/Sora task lifecycle、polling/cancel/retry/batch tests、崩溃恢复 integration、video UI tests、费用/能力 fixture、
  `pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`。
- **风险/回滚边界**：外部计费任务和本地归档；提交幂等、取消语义按 provider 能力，回滚 UI 不删除远端任务/结果。

### LM4-26：首个真实国内视频供应商

- **目标**：选择并完整接通一个国内视频供应商，覆盖提交、查询、取消/重试、结果归档和错误规范化。
- **主要范围**：provider ADR、adapter、settings、capability discovery、credentials、fixtures/sandbox、运行手册和 Feature Flag。
- **不在范围**：第二供应商、客户端模拟成功、把官方 SDK 凭据下发 renderer。
- **内部 checklist**：依据 API 可用性/成本/竖屏/图生视频/取消/回调能力选型；实现 adapter 和能力声明；Keychain 保存凭据；
  提交/轮询/取消/限流/错误归一；保存远端 id 和本地归档；建立签名 fixture、sandbox E2E、额度/成本提示和禁用开关。
- **验收**：在官方测试或获授权环境完成一个镜头从提交到本地可播放结果；重复提交幂等；无凭据/限流/超时/内容拒绝均可解释；
  renderer 不获得明文密钥。
- **验证**：adapter contract tests、签名/错误 fixture、Keychain boundary、官方 sandbox E2E、归档 smoke、Desktop 全量相关测试和脱敏扫描。
- **风险/回滚边界**：外部账号、费用、内容与凭据；独立 Feature Flag，可停路由/提交但保留任务、结果和审计；缺官方环境不得 done。

### LM4-27：第二个独立真实视频供应商

- **目标**：接通第二个具有独立账号和发布边界的视频供应商，并证明公共视频台不依赖首个供应商特例。
- **主要范围**：第二 provider adapter、settings、capabilities、fixtures/sandbox、运行手册和 Feature Flag。
- **不在范围**：第三及更多供应商、统一最低公分母而删除供应商高级能力。
- **内部 checklist**：独立选型和能力映射；实现提交/查询/取消或明确不支持；错误/限流/内容拒绝归一；验证多 provider 切换、结果并存和
  默认 provider；完成 sandbox E2E、成本提示和独立回滚手册。
- **验收**：同一镜头可选择两个真实 provider 且结果并存比较；供应商 A 故障不阻断 B；能力不支持时 UI 预先阻止；明文凭据不进入 DB/renderer。
- **验证**：公共 adapter contract suite、第二 provider fixture/sandbox、多 provider isolation tests、Keychain/脱敏扫描、Desktop UI/E2E。
- **风险/回滚边界**：第二外部渠道独立风险；Feature Flag、凭据、任务和回滚与 LM4-26 分离，缺外部证据不得 done。

### LM4-28：Web AI 作者化与流式会话

- **目标**：把 Web AI 从 provider/model 技术控制台升级为面向作者的任务入口和可信流式会话。
- **主要范围**：Web chat UX/history、model catalog、preflight、Web BFF、AI Gateway streaming/cancel、quota settlement、SDK。
- **不在范围**：复制 Desktop 全项目编辑器、匿名无限对话、绕过额度预扣。
- **内部 checklist**：使用服务端模型目录而非自由 provider 输入；提供作者任务 starter 和会话历史；执行前显示权威 preflight；实现流式输出、取消、
  断线恢复和最终结算；隐藏 idempotency/provider 内部字段；错误关联 trace/request；提供 reduced-motion 打字反馈而非伪造逐字动画。
- **验收**：普通用户无需理解 provider 即可发起任务；流式取消不会悬挂额度；重连不重复调用 Provider；模型不可用/额度不足在调用前提示；历史不泄露到其他账号。
- **验证**：Web component/E2E、stream/cancel/reconnect/idempotency tests、quota reservation/settlement tests、SDK contract、clients lint/typecheck/build、Go tests、健康栈 E2E。
- **风险/回滚边界**：流式计费、内容和会话隐私；可回退到同步 Chat，但不得绕过预扣、幂等或最小上下文。

### LM4-29：Admin 运营操作台

- **目标**：让授权运营人员从异常报表进入用户、订单、订阅、额度、通知和 AI 成本的可审计处理动作。
- **主要范围**：Admin UI/BFF、reporting/read model、principal search/suspend、reconciliation/refund actions、notification delivery、AI cost alerts、RBAC/audit。
- **不在范围**：绕过领域服务直接改表、通用数据库管理器、无审计批量修数。
- **内部 checklist**：实体检索/详情和关联 trace；用户冻结/恢复；订单/支付/订阅/额度对账动作；退款/重试/人工确认按既有领域 API；通知投递和成本告警；
  分页/筛选/深链；危险动作二次确认、权限分级和完整审计。
- **验收**：异常项能定位到用户、订单、额度、通知和 trace；所有写动作通过领域 API、幂等且记录 operator/reason；低权限账号不可见或不可执行高风险动作；列表不再固定前 20 条。
- **验证**：Admin RBAC/audit tests、BFF/service tests、UI component/E2E、对账/退款/冻结 fixture、clients lint/typecheck/build:admin、Go tests、健康栈 smoke。
- **风险/回滚边界**：运营高权限和财务动作；功能按 action Feature Flag/permission 独立关闭，已执行审计不可删除或覆盖。

### LM4-30：端到端加密的手动项目快照

- **目标**：在不改变本地可信源的前提下，让用户主动创建、查看、下载和恢复端到端加密项目快照。
- **主要范围**：Desktop project package、客户端加密/密钥恢复、snapshot API/storage/metadata、retention/quota/delete、UI 和运行手册。
- **不在范围**：实时同步、协同编辑、服务端全文搜索、服务端解密、自动冲突合并。
- **内部 checklist**：定义版本化快照 envelope 和客户端加密；密钥只由用户/系统安全存储持有；上传前生成项目包并最小化元数据；支持进度、取消、校验、列表、下载、恢复前预览；
  保留策略、额度、删除和服务端不可读证明；故障续传和不完整对象清理；依赖 LM3-34 的生产灾备 Gate。
- **验收**：服务端和日志无法读取项目正文；错误密钥不能恢复；上传中断不会覆盖本地项目；恢复创建新项目或显式覆盖并先备份；用户能删除远端快照并验证不可再下载；版本向后兼容。
- **验证**：crypto test vectors、package roundtrip、wrong-key/tamper tests、upload resume/delete tests、Desktop UI/E2E、服务端权限/retention tests、备份恢复演练、敏感信息扫描。
- **风险/回滚边界**：用户内容、加密密钥和远端存储；Feature Flag 关闭上传但保留下载/删除窗口；禁止服务端持有可解密密钥；未通过 LM3-34 不得生产发布。

### LM4-31：LOOPMAP4 全量发布 Gate

- **目标**：证明所有 P0/P1/P2 用户结果、外部边界、文档、回滚和发布条件已经完整闭环。
- **主要范围**：全仓、全部 LM4 累计 diff、Desktop packages、Platform clients/services/deploy、供应商/支付/快照运行证据、发布说明。
- **不在范围**：在 Gate 内实现遗漏功能、把外部验证改写成豁免后宣告完成。
- **内部 checklist**：逐项核对第 6 节覆盖矩阵；执行 Desktop 全量和跨平台 package smoke；执行 clients lint/build 和 Go/contract/平台 E2E；完成支付、两个视频 provider、
  Cloud AI、移动草稿、Admin、加密快照运行验证；完成视觉/键盘/axe/三宽度/主题/reduced-motion 截图；审查迁移、凭据、日志、文档、Feature Flag、回滚和发布顺序。
- **验收**：LM4-00～30 全部满足 `done`；没有未解释的 todo/partial、未推送 commit、保留分支或工作区残留；所有外部生产声明有官方或获授权环境证据；发布说明包含数据迁移、兼容窗口和回滚步骤。
- **验证**：所有项目约定全量命令；健康 Compose/部署 E2E；真实或官方 sandbox 外部渠道 smoke；跨平台 Desktop package smoke；人工产品验收；`git diff --check` 和目标分支累计 diff 审查。
- **风险/回滚边界**：全量发布 Gate；失败回到对应能力 loop，禁止为了过 Gate 放宽数据、安全、支付、quota、无障碍或隐私规则。

## 9. 推荐执行批次

### Batch A：基线与 P0 可靠性

1. LM4-00：UI、无障碍与状态基线。
2. LM4-01：统一内容持久化。
3. LM4-02：工作流真值与新鲜度。
4. LM4-03：正式支付闭环。
5. LM4-04：P0 Gate。

阻塞条件：LM4-04 未通过，不应把视觉重构或 P2 页面作为正式版本发布；LM4-01 未完成前不得扩大自动写入面。

### Batch B：设计底座与核心 Shell

1. LM4-05：视觉、主题、动效和无障碍基础。
2. LM4-06：统一 App Shell。
3. LM4-07：项目首页与创建体验。
4. LM4-08：项目废纸篓。
5. LM4-09：章节树与专注编辑。
6. LM4-17：统一确认和反馈交互。

阻塞条件：LM4-05 未完成，不要在多个页面分别发明颜色、动效和对话框；LM4-06 未完成，不要重复建立业务页面壳。

### Batch C：可信 AI 与质量闭环

1. LM4-10：上下文 AI 助手。
2. LM4-11：任务中心与恢复。
3. LM4-12：权威 Cloud AI preflight。
4. LM4-13：原子修稿采用。
5. LM4-14：分段 AI 预览。
6. LM4-15：当前改编上下文。
7. LM4-16：质量行动中心。

阻塞条件：LM4-13 未完成，不应上线部分采用；LM4-11 未完成，不应把更多批量任务迁入后台执行。

### Batch D：契约与跨端状态

1. LM4-18：版本化客户端契约。
2. LM4-19：移动草稿生命周期。
3. LM4-20：账户 read model。
4. LM4-21：P1 Core Gate（当前 `partial`，已完成的检查见第 12 节）。
5. LM4-12R：仅修复 Gate 暴露的 Web Chat 预检兼容性。
6. 重跑并完成 LM4-21：P1 Core Gate。

阻塞条件：LM4-18 未完成，Mobile/Account 不应继续新增手写协议；LM4-12R 和 LM4-21 未通过，不进入制片工作区正式切换。LM4-12R 是已完成 LM4-12 的范围受限回归修复，不提前交付 LM4-28 的作者化功能。

### Batch E：制片体验

1. LM4-22：统一改编生产壳。
2. LM4-23：结构化剧本编辑器。
3. LM4-24：分镜 Storyboard。
4. LM4-25：视频生产台。

阻塞条件：LM4-22 未完成，不要让剧本/分镜/视频各自重复实现导航和上下文；LM4-24 未完成前，视频台只消费现有镜头数据。

### Batch F：生态与外部能力

1. LM4-26：首个真实国内视频供应商。
2. LM4-27：第二真实视频供应商。
3. LM4-28：Web AI 作者化。
4. LM4-29：Admin 运营操作台。
5. LM4-30：加密手动快照。
6. LM4-31：全量发布 Gate。

阻塞条件：缺少官方/获授权外部账号、沙箱、回调或安全凭据时，对应 loop 保持 `todo/partial`；不得用 mock 结果标记真实渠道完成。

## 10. 验证策略矩阵

| 变更类型 | 最小自动验证 | 扩大验证 | 人工证据 |
| --- | --- | --- | --- |
| 全局 UI primitive/shell | typecheck、unit、test:ui | Electron E2E、package smoke | 3 宽度、2 主题、reduced-motion、键盘 |
| 内容写入/DB migration | unit、test:db、replay | Electron crash/restore E2E | 切换、关闭、失败、恢复 |
| AI apply/任务状态 | unit、IPC/DB tests | task crash、Cloud AI E2E | 预览、采用、撤销、重试 |
| 公共协议/BFF | generated diff、typecheck、Go tests | platform E2E、breaking Gate | 错误/trace/版本人工核对 |
| 支付 | biz/HTTP/signature/integration | 健康栈与官方沙箱 | 下单、过期、支付、激活、回滚 |
| Mobile lifecycle | storage/queue/BFF tests | 离线/重连跨端 E2E | 创建、同步、采用、删除 |
| 剧本/分镜/视频 | roundtrip、ordering、task tests | Electron E2E、package smoke | 结构编辑、拖拽、对比、导出 |
| 视频 Provider | adapter contract/fixtures | 官方 sandbox E2E | 费用、错误、结果归档、独立回滚 |
| Admin 高风险动作 | RBAC/audit/service tests | 健康栈 Admin E2E | 双人审查、审计、权限拒绝 |
| 加密快照 | crypto vectors、tamper、roundtrip | 存储/恢复/灾备演练 | 错密钥、删除、恢复预览 |
| Release Gate | 全量命令、累计 diff | Compose/部署/跨平台包 | 发布说明、回滚、外部证据 |

UI 人工 smoke 至少记录：

- 入口 URL/route；
- fixture 名称；
- 窗口尺寸、主题、密度和 reduced-motion 状态；
- 操作步骤与通过标准；
- 截图或录屏文件名；
- 是否涉及真实账号、费用或用户内容；
- 失败时关联的 loop、trace/request/task id（不得含敏感正文）。

## 11. 本地图完成定义

除 `LOOPRULE.md` 第 7 节外，LM4 loop 还必须满足：

1. 第 6 节对应优化项全部有实现、测试和人工证据。
2. UI loop 同时交付 loading/empty/error/disabled/success 状态，不只交付理想路径。
3. 所有新增动效有 reduced-motion 行为，且不以动画代替真实状态。
4. 所有新增危险操作说明可恢复性、影响对象和失败路径。
5. Desktop 业务页面不新增原生 `confirm/prompt`。
6. 关键数据写入有幂等、版本检查、失败恢复或明确事务边界。
7. 公共协议生成物、调用端、BFF 和兼容说明在同一 loop 收口。
8. 外部渠道只有在官方或获授权环境验证后才能宣称真实可用。
9. 完成记录必须包含实际验证、截图/人工 smoke、远端同步、推送和分支清理信息。
10. LM4-31 完成前，不得宣称“以上所有 P0/P1/P2 已完成”。

## 12. 完成记录区

每完成一个 loop，在本节末尾追加记录，不覆盖历史。

```text
Loop:
Target branch:
Loop branch:
Commit(s):
Merge commit:
Verification:
UI/manual evidence:
Diff review:
Remote sync:
Push:
Loop branch cleanup:
Current branch/worktree:
Notes:
```

### Gate 阻断与续做审计

```text
Loop: LM4-21 (partial)
Target branch: main
Loop branch: loop/lm4-21-core-experience-gate
Verification: Desktop pnpm format:check; pnpm test (typecheck, 144 unit tests and DB checks); pnpm test:ui (21 screenshots, 0 axe observations); pnpm test:e2e; pnpm package:smoke:dir; and the retained lm4-21 UI baseline matrix all passed. Platform clients pnpm lint; pnpm typecheck; pnpm build:web; pnpm build:admin; pnpm contracts:check and services GOCACHE=/tmp/dramaip-go-build go test ./... all passed. make platform-e2e reached and passed its account-bootstrap assertions, then failed only at the existing Web Chat request with HTTP 409 / cloud_preflight_request_mismatch.
UI/manual evidence: Retained light/dark/reduced-motion screenshots cover 1024, 1320 and 1600 widths; visual inspection found no critical shell overflow. Keyboard, 300-chapter, task recovery, autosave and package smoke paths passed through Desktop E2E. The Web Chat provider call remains blocked rather than fabricating success.
Diff review: Gate branch has no product-code diff. Reviewed cumulative LM4-05–20 evidence and confirmed the failing path is the Web BFF/SDK's bare Chat request after LM4-12 made the AI Gateway require a matching preflight hash. Sensitive-file scan found no tracked .env, PEM, key or id_rsa file.
Remote sync: Started from and remains aligned with origin/main at 9b7f464; no remote divergence observed.
Push: Not applicable: LM4-21 is not complete and is deliberately not marked done.
Loop branch cleanup: Deferred while the Gate's documented repair (LM4-12R) is completed and this same Gate is rerun.
Current branch/worktree: loop/lm4-21-core-experience-gate; tracked worktree contains only this audit/map adjustment.
Notes: This is a real P1 release blocker. The repair is split from LM4-28 because restoring an already shipped synchronous Web Chat contract has an independent acceptance path and a smaller rollback boundary than model catalog, author UX and streaming. LM4-22–30 remain blocked until LM4-12R succeeds and LM4-21 is rerun.
```

```text
Loop: LM4-00
Target branch: main
Loop branch: loop/lm4-00-ui-baseline
Commit(s): 3436fa9 loop: add desktop UI baseline gate
Merge commit: cf2d97e loop: merge LM4-00 UI baseline gate
Verification: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (120/120); pnpm test:ui (5 screenshots, 11 recorded a11y observations); git diff --check origin/main...HEAD
UI/manual evidence: Reviewed project list, 1024 light and 1320 dark workspace, 1600 script workspace, and reduced-motion video failure fixture. Fixture/report paths are documented in docs/loop/LM4-00-UI基线.md.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, or runtime artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 0bda497 before branch creation and again before merge.
Push: cf2d97e pushed to origin/main successfully on 2026-07-19.
Loop branch cleanup: Local loop/lm4-00-ui-baseline deleted after successful main push.
Current branch/worktree: main; clean at record creation (ignored local UI artifacts excluded).
Notes: 11 existing missing accessible-name observations are recorded as baseline evidence, not waived; LM4-19 owns corrective a11y gates.
```

```text
Loop: LM4-01
Target branch: main
Loop branch: loop/lm4-01-content-persistence
Commit(s): 8289809 loop: protect core editor drafts
Merge commit: 1b11dcc merge: LM4-01 core editor draft persistence
Verification: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (121/121); pnpm test:db; pnpm test:e2e (includes draft-autosave-on-immediate-route-leave); pnpm test:ui (5 screenshots, 11 recorded a11y observations); git diff --check origin/main...HEAD.
UI/manual evidence: Reviewed the script editor saved-state badge in the LM4-01 UI baseline run. Production Electron E2E typed into Script and Shot editors and immediately navigated away; restricted IPC reads confirmed the latest content had reached SQLite. docs/loop/LM4-01-内容持久化.md records the local recovery and close-flush behavior.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, or runtime artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 878af64 before branch creation and again before merge.
Push: 1b11dcc pushed to origin/main successfully on 2026-07-19; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-01-content-persistence deleted after successful main push.
Current branch/worktree: main; clean before completion-record commit (ignored local UI artifacts excluded).
Notes: Recovery data stays only in renderer localStorage and is cleared after a confirmed SQLite save. Native close waits for registered renderer flushes; the existing preview/adopt path continues to protect unsaved manual text from AI overwrite.
```

```text
Loop: LM4-02
Target branch: main
Loop branch: loop/lm4-02-workflow-freshness
Commit(s): b05ebaa loop: make workflow status reflect current outputs
Merge commit: a8fa612 merge: LM4-02 workflow truth
Verification: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (123/123); pnpm test:db (migration v19 replay and SQLite smoke); pnpm test:e2e; pnpm test:ui (6 screenshots, 13 recorded a11y observations); git diff --check origin/main...HEAD.
UI/manual evidence: Reviewed the light 1320px stale-quality fixture at #/projects/<fixture>?section=overview. After changing source chapter content, the workflow card displayed “源内容已变化，报告已过期，请重新检查” without clipping or layout breakage. The fixture matrix also keeps current-quality, failed-video, reduced-motion and dark-mode paths under UI baseline coverage; details are in docs/loop/LM4-02-工作流真值.md.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, or runtime artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at c408c32 before branch creation and again before merge.
Push: a8fa612 pushed to origin/main successfully on 2026-07-19; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-02-workflow-freshness deleted after successful main push.
Current branch/worktree: main; clean before completion-record creation (ignored local UI artifacts excluded).
Notes: Quality reports now carry a deterministic source fingerprint (schema migration v19). Legacy reports lacking one are deliberately shown as needing recheck. A video stage only completes when a successful task has a usable local or remote output; a successful task alone is not delivery proof.
```

```text
Loop: LM4-03
Target branch: main
Loop branch: loop/lm4-03-payment-checkout
Commit(s): 2348110 loop: complete payment checkout flow
Merge commit: 8e0d1b5 merge: LM4-03 payment checkout
Verification: dramaip-platform make test (Go ./..., client typecheck, Web route smoke); clients pnpm lint; clients pnpm build:web; services buf generate; local healthy-stack migration 036; make platform-e2e; git diff --check. All passed after merge.
UI/manual evidence: Browser verified the unauthenticated local pricing shell at localhost:3009, but its existing dev process did not load public plans, so it is not counted as a positive checkout-UI assertion. API GET /v1/plans and CORS for that origin were independently healthy. Pricing/order UI behavior is covered by production build, route assertions, explicit-provider BFF HTTP tests, and local-stack simulated checkout E2E; details and the limitation are in docs/loop/LM4-03-支付闭环.md.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, local images, build outputs, or runtime artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 51f4eab before branch creation and again before merge.
Push: 8e0d1b5 pushed to origin/main successfully on 2026-07-19; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-03-payment-checkout deleted after successful main push.
Current branch/worktree: main; clean before completion-record creation (local health-stack state and ignored build output excluded).
Notes: Migration 036 persists real provider payment URLs and expiry; pending orders become expired only after their configured provider-validity window. WeChat/Alipay signature fixtures, BFF forwarding, simulated E2E, and false-client-activation prevention passed. Official-channel release remains blocked: no isolated PostgreSQL DSN (webhook integration resets cluster-wide role passwords) and no authorized official sandbox merchant/callback evidence were supplied. Provider Feature Flags therefore stay disabled; this is not claimed as real-money channel validation.
```

```text
Loop: LM4-04
Target branch: main
Loop branch: loop/lm4-04-p0-release-gate
Commit(s): bcf57d1 loop: record P0 reliability release gate
Merge commit: b4c9748 merge: LM4-04 P0 reliability release gate
Verification: Desktop pnpm format:check; pnpm test (123 unit tests plus DB migration replay); pnpm test:e2e; pnpm test:ui (6 screenshots, 13 baseline a11y observations); pnpm package:smoke; Platform make test; clients pnpm lint && pnpm build:web; make platform-e2e; cumulative git diff --check. All executed checks passed.
UI/manual evidence: Reviewed stale-quality and reduced-motion failed-video screenshots from an isolated UI fixture. The stale warning and failed-task retry state were visible. The dark workspace contrast/loading-state weakness and 13 unnamed controls remain documented P1 inputs for LM4-05/LM4-19, not waived accessibility claims. docs/loop/LM4-04-P0-Gate.md records the evidence and release boundary.
Diff review: Cumulative LM4-00～04 diff reviewed; no whitespace errors, secrets, build outputs, or runtime artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 1723118 before branch creation and again before merge.
Push: b4c9748 pushed to origin/main successfully on 2026-07-19; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-04-p0-release-gate deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: WeChat/Alipay webhook integrations correctly refused to run without dedicated fresh PostgreSQL DSNs. No authorized official sandbox merchant/callback evidence or signed/notarized macOS release environment exists. Provider Feature Flags remain disabled; real payment and external macOS distribution are explicitly not declared complete.
```

```text
Loop: LM4-05
Target branch: main
Loop branch: loop/lm4-05-design-foundation
Commit(s): 0e99155 loop: build desktop design system foundation
Merge commit: 5db6954 merge: LM4-05 design system foundation
Verification: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (125/125); pnpm test:ui (7 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e; git diff --check. All passed before commit.
UI/manual evidence: Reviewed 1320 dark workspace, system-theme Appearance page, and compact reduced-motion video fixture. Semantic canvas/surface/AI/status colors, clear focus styles, persistent density/font preferences and static reduced-motion behavior are documented in docs/loop/LM4-05-设计系统基础.md.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, generated UI artifacts or local preferences committed.
Remote sync: Fetched and fast-forward checked origin/main at 2f459f7 before branch creation and again before merge.
Push: 5db6954 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-05-design-foundation deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: Zero AX observations apply only to the seven fixed baseline pages. Theme-toggle placement and page-level information architecture intentionally remain for LM4-06+; native confirm/prompt replacement remains LM4-17.
```

```text
Loop: LM4-06
Target branch: main
Loop branch: loop/lm4-06-app-shell-deep-links
Commit(s): 8d60968 loop: add responsive desktop app shell
Merge commit: eb37df0 merge: LM4-06 responsive desktop app shell
Verification: dramaip-desktop pnpm typecheck; pnpm format:check; pnpm test (127 unit tests plus DB migration replay); pnpm test:ui (11 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e (includes workspace-shell-deep-link-history-and-panels); git diff --check origin/main...HEAD. All passed again after merge.
UI/manual evidence: Reviewed isolated 1024 light compact shell and 1320 dark full shell screenshots. At 1024 the inspector is absent and the context panel becomes an accessible compact stage menu; at 1320 the resizable context, 680px+ authoring canvas and inspector coexist. The screenshot matrix covers 1024/1179/1320 in light/dark, including a reduced-motion desktop fixture. The shell smoke creates a chapter, verifies section/chapter deep-link writing, browser-back restoration, keyboard splitter persistence, and focus-mode panel restoration.
Diff review: Cumulative LM4-06 diff reviewed; no whitespace errors, secrets, build outputs, local preference data, or temporary screenshots committed.
Remote sync: Fetched and fast-forward checked origin/main at ec870f4 before branch creation and again before merge.
Push: eb37df0 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-06-app-shell-deep-links deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: The shared WorkspaceShell persists panel widths/collapse/focus state locally; legacy project/adaptation paths remain valid while chapter, section, episode, scene and shot selections are URL-addressable. App-wide project-home redesign, complete chapter-tree work, and replacement of native confirm/prompt remain assigned to later loops LM4-07/09/17.
```

```text
Loop: LM4-07
Target branch: main
Loop branch: loop/lm4-07-project-home-creation
Commit(s): 2a30446 loop: improve project home and creation flow
Merge commit: eed5960 merge: LM4-07 project home and creation flow
Verification: dramaip-desktop pnpm test (127 unit tests plus DB migration replay and projectHomeSummary smoke); pnpm test:ui (12 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e; git diff --check. All passed before merge.
UI/manual evidence: Reviewed the isolated 1320 project-home fixture: each card now surfaces current stage, next action, recent chapter, chapter/word counts, adaptation state and blocking count; long titles retain a usable layout. The 1024 create fixture verifies blank/inspiration/import entry choices and quick type selection without crowding.
Diff review: Staged cumulative diff reviewed; no whitespace errors, secrets, build outputs, local preference data, or temporary screenshots committed.
Remote sync: Fetched and fast-forward checked origin/main at 407368a before branch creation and again before merge.
Push: eed5960 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-07-project-home-creation deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: Project summaries are read-only local aggregates exposed through a narrow IPC route; list rendering does not alter project content. Soft deletion and replacement of native delete confirmation remain LM4-08 and LM4-17 work.
```

```text
Loop: LM4-08
Target branch: main
Loop branch: loop/lm4-08-project-trash
Commit(s): 485906d loop: add recoverable project trash
Merge commit: cead911 merge: LM4-08 recoverable project trash
Verification: dramaip-desktop pnpm test (127 unit tests plus DB migration v20 replay and soft-delete/restore/purge/search/export smoke); pnpm test:ui (12 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e (includes project-trash-undo-restore-and-strong-purge); pnpm format:check; git diff --check origin/main...HEAD. All passed again after merge.
UI/manual evidence: The project list has an accessible direct project-trash control. Moving a project to the trash offers Undo; the trash dialog explicitly states that no background automatic purge occurs, and provides restore. Permanent deletion presents direct dependency counts and keeps the destructive action disabled until the exact project title is entered. Electron E2E creates an isolated project and executes Undo, restore, and final typed confirmation.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, local project data, or temporary UI artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 158d148 before merge.
Push: cead911 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-08-project-trash deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: Migration v20 adds nullable project deleted_at without dropping data. Active project reads, search, and export exclude trashed projects; the legacy project delete IPC now maps only to trash. There is no silent time-based purge. Final purge requires the exact title and cleans direct project content plus adaptation video task/result records.
```

```text
Loop: LM4-09
Target branch: main
Loop branch: loop/lm4-09-chapter-tree
Commit(s): 4ae85d3 loop: build long-form chapter tree editor
Merge commit: de06f44 merge: LM4-09 chapter tree editor
Verification: dramaip-desktop pnpm test (130 unit tests plus DB migration replay and transactional chapter-reorder smoke); pnpm test:ui (15 screenshots, 0 fixed-fixture AX observations, including 300-chapter tree at 1060/1179/1320 widths); pnpm test:e2e (includes chapter-tree-300-performance-order-and-keyboard); pnpm format:check; git diff --check origin/main...HEAD. All passed again after merge.
UI/manual evidence: Reviewed the 1060 light and 1320 reduced-motion 300-chapter fixtures. The context sidebar presents a searchable volume/unit/chapter tree with compact status signals, batch selection and visible sort affordances; only visible rows are mounted. The authoring canvas keeps 18px text by default and exposes font size, line height, content width, chapter goal/progress, typewriter scrolling, save truth and a selected-text AI entry. The inspector disappears at the narrower desktop width without compressing the writing canvas.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, local project data, or temporary UI artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 7455717 before merge.
Push: de06f44 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-09-chapter-tree deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: No new long-form business model or migration was added. The existing chapter orderIndex remains authoritative; chapter:reorder accepts the complete, unique project id set only and rewrites it in one SQLite transaction. Existing volume/unit/stage ranges are a display projection, so the UI can revert to a plain list without losing order. Cmd/Ctrl+N creates, Cmd/Ctrl+S uses LM4-01 draft-save truth, Cmd/Ctrl+K focuses tree search, and Alt+Up/Down changes chapters without taking ordinary cursor arrows from the editor.
```

```text
Loop: LM4-10
Target branch: main
Loop branch: loop/lm4-10-ai-command-palette
Commit(s): e157581 loop: unify AI command discovery
Merge commit: b0b47a4 merge: LM4-10 AI command palette
Verification: dramaip-desktop pnpm test (133 unit tests plus DB migration replay); pnpm test:ui (17 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e (includes ai-command-palette-search-policy-and-shortcut); pnpm format:check; git diff --check origin/main...HEAD. All passed again after merge.
UI/manual evidence: Reviewed isolated 1320px light command-palette and compact preflight-summary fixtures. The palette keeps only three contextual recommendations by default, searches the complete 66-task registry, supports category/favorite/recent filters, displays each write policy, and retains a visible no-chapter explanation. The preflight opens with a compact five-context summary and an explicit detail expander; reduced motion uses the existing static state treatment. E2E verifies search, policy visibility, favorites, compact context expansion, Cmd/Ctrl+K, and a task deep-link to the original character workspace.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, local preference data, or temporary UI artifacts committed.
Remote sync: Fetched and fast-forward checked origin/main at 4b0ae74 before branch creation and again before merge.
Push: b0b47a4 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-10-ai-command-palette deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and temporary UI artifacts excluded).
Notes: The catalog is generated from every TASK_WRITE_POLICIES entry, preserving all existing task reachability and write-policy semantics. Direct chapter actions retain their preflight confirmation; non-chapter entries deep-link to the exact existing workspace, while tasks requiring an adaptation direct to adaptation creation if none exists. Cmd/Ctrl+K intentionally keeps chapter-tree search on the writing page and opens the global command palette elsewhere to avoid a shortcut conflict.
```

```text
Loop: LM4-11
Target branch: main
Loop branch: loop/lm4-11-task-recovery
Commit(s): a4e7a04 feat: recover interrupted long tasks
Merge commit: 22c9ee9 merge: LM4-11 task recovery
Verification: dramaip-desktop pnpm format:check; pnpm test (135 unit tests plus DB migration replay/SQLite smoke); pnpm test:ui (18 screenshots, 0 fixed-fixture AX observations); pnpm test:e2e (includes global-task-dock-is-available-across-workspace and long-task-crash-restart-recovery-and-remote-requery); pnpm package:smoke; git diff --check. All passed again after merge.
UI/manual evidence: Reviewed the isolated 1320px Task Monitor recovery fixture and the 1320px workspace fixture. The task center retains failure/retry evidence instead of relying on Toast, while the fixed task dock remains available without reducing the writing canvas. The dock exposes current/recent tasks, direct cancellation, remote-video polling, and one-shot completion/failure feedback; the new task-monitor baseline preserves this state under visual and accessibility checks.
Diff review: Staged and merged cumulative diff reviewed; no whitespace errors, secrets, build outputs, local database files, or temporary screenshots committed.
Remote sync: Fetched and fast-forward checked origin/main at d70aa35 before branch creation and again before merge.
Push: 22c9ee9 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-11-task-recovery deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: Startup reconciliation only restores polling for video tasks that already have a persisted remote-task record. Pending/running local AI and batch work, and video work without a recoverable remote record, are conservatively marked failed with a safe retry path; no prompt or write operation is blindly replayed. A per-task in-memory retry claim rejects concurrent duplicate retry submissions.
```

```text
Loop: LM4-12
Target branch: main
Loop branch: loop/lm4-12-cloud-ai-preflight
Commit(s): 0d17d62 feat: preflight cloud AI generation authoritatively
Merge commit: d763599 merge: LM4-12 cloud AI authoritative preflight
Verification: Before and after merge: dramaip-desktop pnpm format:check; pnpm test (typecheck, 136 unit tests and DB checks); pnpm test:ui (18 screenshots, 0 a11y observations); pnpm test:e2e; pnpm package:smoke; dramaip-platform/services GOCACHE=/tmp/dramaip-go-build go test ./...; git diff --check. All passed.
UI/manual evidence: The global task dock and task monitor display the authoritative provider/model, estimated tokens and remaining balance after preflight, without persisting prompt content. The isolated 1320px task-monitor recovery fixture and the full light/dark/reduced-motion UI matrix completed with no accessibility findings.
Diff review: Reviewed the Desktop final-prompt hash, BFF summary recheck, Gateway hash validation, balance guard and quota reservation path. Cross-runtime fixed-vector tests verify Desktop and Go compute the same SHA-256 base64url request hash. No prompt body, credential, or build artifact is written by the new metadata/log path.
Remote sync: Fetched and fast-forward checked origin/main at 44f447e before the loop branch and again before merge; main had no intervening remote commits.
Push: d763599 pushed to origin/main successfully on 2026-07-20.
Loop branch cleanup: Local loop/lm4-12-cloud-ai-preflight deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record commit.
Notes: Every Cloud provider chat now preflights the exact final messages/model/token cap, binds the response to a request hash, and rechecks it server-side before calling a provider. Insufficient balance is rejected by Desktop BFF before Chat; Gateway pre-reservation remains final truth for the preflight-to-execution race. Local/BYOK providers retain their existing local estimate behavior.
```

```text
Loop: LM4-13
Target branch: main
Loop branch: loop/lm4-13-atomic-revision-adoption
Commit(s): 44b5838 feat: adopt revision tasks atomically
Merge commit: 6d17917 merge: LM4-13 atomic revision adoption
Verification: Before and after merge: dramaip-desktop pnpm format:check; pnpm test (typecheck, 136 unit tests, migration replay and DB smoke); pnpm test:ui (18 screenshots, 0 accessibility observations); pnpm test:e2e (including revision-task-atomic-adopt-and-undo-ipc); pnpm package:smoke; git diff --check. All passed.
UI/manual evidence: The diagnosis panel exposes a persisted “查看预览” state, a single adopt action, and “撤销采用” after success. The renderer IPC smoke verifies that the one-step undo entry remains available from the packaged Electron bridge; UI fixtures completed in light, dark and reduced-motion variants with no accessibility findings.
Diff review: Reviewed the v21 migration, persisted preview fingerprint, transactional target revision check, before/after content-version audit, task-state transition and conservative undo guard. No prompt bodies, user content, credentials, database files or build artifacts were committed. Failed/stale candidates roll back entirely, repeated adopt is idempotent, and post-adoption manual edits prevent silent undo overwrite.
Remote sync: Fetched and fast-forward checked origin/main at 67372ae before the loop branch and again before merge; main had no intervening remote commits.
Push: 6d17917 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-13-atomic-revision-adoption deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: The legacy separate complete/apply IPC channels now delegate to the same atomic adoption command for compatibility. One-step undo restores the precise pre-adoption snapshot for chapter, script and all three shot prompt fields, while retaining immutable audit evidence.
```

```text
Loop: LM4-14
Target branch: main
Loop branch: loop/lm4-14-segmented-diff-adoption
Commit(s): 0a4eab4 feat: add segmented AI preview adoption
Merge commit: 00770e2 merge: LM4-14 segmented AI preview adoption
Verification: Before and after merge: dramaip-desktop pnpm format:check; pnpm test (typecheck, 139 unit tests, 7 migration/transaction tests and DB smoke); pnpm test:ui (21 screenshots, including segmented diff in light/dark/reduced-motion, 0 accessibility observations); pnpm test:e2e (including revision-task-edited-preview-adopt-and-undo-ipc); pnpm package:smoke; git diff --check. All passed.
UI/manual evidence: Text previews now use paragraph-level inline, side-by-side and result/editor views. Users can select or reject individual changes, jump with Alt+Up/Down, edit the final candidate and retain non-colour text labels for additions/removals. Characters, chapter outlines, story arcs and episodes expose item selection; partial episode adoption preserves unselected existing episodes. The version panel also uses paragraph-level comparison instead of the quadratic line matrix.
Diff review: Reviewed the bounded paragraph-anchor diff and Worker handoff for large previews, structured script/shot candidate normalization, the validated updatePreview IPC boundary, LM4-13 atomic adoption handoff, and partial episode upsert semantics. No prompt bodies, user content, credentials, databases, screenshots or build artifacts were committed. Edited revision candidates retain the original baseline fingerprint, so stale content remains rejected before the transaction writes.
Remote sync: Fetched and fast-forward checked origin/main at 9bcbffe before the loop branch and again before merge; main had no intervening remote commits.
Push: 00770e2 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-14-segmented-diff-adoption deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: Large text uses a Worker-backed, bounded paragraph diff rather than a line-by-line dynamic-programming matrix. For revision tasks the chosen/edited candidate is persisted through revisionTask:updatePreview and then applied only through LM4-13’s atomic command; generic preview writes retain their existing content-version audit path.
```

```text
Loop: LM4-15
Target branch: main
Loop branch: loop/lm4-15-active-adaptation-context
Commit(s): 358a46f feat: persist active adaptation context
Merge commit: 5e712b4 merge: LM4-15 active adaptation context
Verification: Before merge: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (141 tests); pnpm test:db (8 migration/transaction tests plus DB smoke); pnpm test:ui (21 screenshots, 0 accessibility observations); pnpm test:e2e. After merge: pnpm typecheck; pnpm test:unit (141 tests); pnpm test:db; git diff --check. All passed.
UI/manual evidence: Workspace header now exposes the current-season selector and breadcrumb. Switching it updates the project preference and refreshes only that season’s episodes, scripts, scenes, shots, video tasks, workflow progress, AI command targets, creative workflows and quality issues. Opening any adaptation/script/shot/video deep link persists that route’s adaptation as the active project context; the Electron E2E route/restart smoke passed.
Diff review: Reviewed v22 active_adaptation_id migration, validated project-scoped IPC, deterministic compatibility fallback (highest season, then latest update), transactional deletion fallback, renderer query scoping and the guards against mixed-season workflow progress. Invalid cross-project deep-link IDs are ignored. No prompts, content, credentials, database files, screenshots or build artifacts were committed.
Remote sync: Fetched and fast-forward checked origin/main at d4c0482 before the loop branch and again before merge; main had no intervening remote commits.
Push: 5e712b4 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-15-active-adaptation-context deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: Existing projects choose a default only on first contextual access rather than mass-writing during migration. The generic project update path cannot set activeAdaptationId; only the validated context APIs can do so.
```

```text
Loop: LM4-16
Target branch: main
Loop branch: loop/lm4-16-quality-action-center
Commit(s): 9783a7e feat: add quality gate action center
Merge commit: 3418a24 merge: LM4-16 quality gate action center
Verification: Before merge: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (142 tests); pnpm test:db (9 migration/transaction tests plus DB smoke); pnpm test:ui (21 screenshots, 0 accessibility observations); pnpm test:e2e. After merge: pnpm typecheck; pnpm test:unit (142 tests); pnpm test:db; pnpm test:ui (21 screenshots, 0 accessibility observations); pnpm test:e2e; git diff --check. All passed.
UI/manual evidence: The quality action center groups issues by production stage and filters by stage, target entity, severity and disposition. Each card explains the blocking or stale condition and deep-links to its chapter, episode script, scene/shot or task target. Successful quality-gate reruns refresh the Workspace truth. Trend and radar charts expose keyboard-focusable data points, an announced reading, legend filtering where applicable and an expandable data table; chart labels are at least 10px. Reduced-motion users receive no motion-dependent result.
Diff review: Reviewed v23 append-only quality_issue_acknowledgements migration, exact IPC schema, audited local actor/timestamp/note behavior, project purge cleanup, stale-report treatment, active-adaptation scoping, route query selection and accessible chart alternatives. Risk acceptance never changes or deletes the original report. No prompts, content, credentials, database files, screenshots or build artifacts were committed.
Remote sync: Fetched and fast-forward checked origin/main at ae5ce54 before the loop branch and again before merge; main had no intervening remote commits.
Push: 3418a24 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-16-quality-action-center deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: Issue dispositions are immutable audit rows; the latest row changes the displayed action state but historic decisions remain reviewable. Reverting the UI does not alter LM4-02 quality truth semantics or remove audit evidence.
```

```text
Loop: LM4-17
Target branch: main
Loop branch: loop/lm4-17-accessible-dialogs
Commit(s): c0985ef feat: unify accessible action dialogs
Merge commit: c32f545 merge: LM4-17 accessible action dialogs
Verification: Before merge: dramaip-desktop pnpm format:check; pnpm typecheck; pnpm test:unit (144 tests); pnpm test:ui (21 screenshots, 0 accessibility observations); pnpm test:e2e. After merge: pnpm format:check; pnpm typecheck; pnpm test:unit (144 tests); pnpm test:ui (21 screenshots, 0 accessibility observations); pnpm test:e2e; git diff --check. All passed.
UI/manual evidence: A single global ConfirmActionDialog now uses Radix focus trapping, labelled descriptions, Escape and keyboard navigation for confirmations and single-field forms. All 23 renderer window.confirm/window.prompt call sites were replaced, including destructive delete, task cancel, backup restore, AI command execution and video-platform input. Existing project-trash Undo toast remains available. Electron E2E verifies deletion confirmation receives focus, has an impact description, closes with Escape and leaves the chapter unchanged.
Diff review: Reviewed provider initialization and cancellation behavior, concurrent-dialog cancellation, destructive copy, all renderer call-site migrations, strong project deletion confirmation retention and the static guard against native blocking calls. No data model, IPC authorization, content, credentials, database files, screenshots or build artifacts were changed or committed.
Remote sync: Fetched and fast-forward checked origin/main at a7b8b0b before the loop branch and again before merge; main had no intervening remote commits.
Push: c32f545 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-17-accessible-dialogs deleted after main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored package and temporary UI artifacts excluded).
Notes: The confirmation provider intentionally rejects calls before app initialization instead of falling back to native dialogs. Destructive permanent project purge retains its stronger project-name confirmation from LM4-08.
```

```text
Loop: LM4-18
Target branch: main
Loop branch: loop/lm4-18-versioned-client-contracts
Commit(s): 8824707 feat: add versioned client contract gate
Merge commit: 4e1ab2a merge: LM4-18 versioned client contracts
Verification: Before and after merge: dramaip-platform/clients pnpm contracts:check; pnpm typecheck; Admin test; Web/Admin production builds; dramaip-platform/services make event-contracts; buf lint/generate; GOCACHE=/tmp/dramaip-go-build go test ./...; dramaip-desktop pnpm typecheck and pnpm test:unit (144/144); git diff --check. All executed checks passed.
UI/manual evidence: This is an API-contract loop with no renderer layout change. HTTP fixtures prove v1 response declaration, unsupported-version HTTP 426 with code/message/trace_id, and Web limit=23/days=31 forwarding into the quota client; full Desktop typecheck/unit coverage verifies the Cloud account, AI and handoff callers send the v1 header.
Diff review: Reviewed the shared v1 JSON schema/Zod models, Admin/Mobile parser migration, Desktop narrow header boundary, all four BFF middleware registrations, uniform failure body, server-side bounds, CI schema-diff guard and compatibility document. No Desktop core types, user content, credentials, generated build output or local data were committed.
Remote sync: Fetched and fast-forward checked origin/main at 435820c before branch creation and again before merge; main had no intervening remote commits.
Push: 4e1ab2a pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-18-versioned-client-contracts deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build artifacts excluded).
Notes: v1 retains headerless requests during the migration window. Explicit unsupported versions receive HTTP 426. Any future published schema change against origin/main must change the contract version; v1 is documented to remain for two released Desktop/Mobile versions and at least 90 days after v2 production release.
```

```text
Loop: LM4-19
Target branch: main
Loop branch: loop/lm4-19-mobile-draft-lifecycle
Commit(s): a65e48c feat: complete mobile draft lifecycle
Merge commit: a9008d0 merge: LM4-19 mobile draft lifecycle
Verification: Before and after merge: services buf lint/generate; GOCACHE=/tmp/dramaip-go-build go test ./...; clients pnpm contracts:check and pnpm typecheck; dramaip-desktop pnpm typecheck and pnpm test:unit (144/144); git diff --check. All executed checks passed.
UI/manual evidence: Mobile now exposes every retained local draft with edit/delete and synchronized/pending/failed status rather than silently slicing at 100 records. Desktop shows not adopted/current-project adopted/other-project adopted after reload. No Desktop project id is sent to the platform; project-specific adoption is stored only in local SQLite.
Diff review: Reviewed append-only server adoption audit, soft cloud deletion migration 037, cursor pagination, idempotent upsert/adoption behavior, queue retry/deletion retention, narrow Desktop BFF models, local adoption projection and generated proto diff. No user content, credentials, local database or build output was committed.
Remote sync: Fetched and fast-forward checked origin/main at f21759d before branch creation and again before merge; main had no intervening remote commits.
Push: a9008d0 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-19-mobile-draft-lifecycle deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build artifacts excluded).
Notes: Cloud deletion is a soft delete so adoption evidence remains auditable. Retention cleanup is intentionally deferred to a guarded future job; no automatic purge or cascading adoption deletion is performed.
```

```text
Loop: LM4-20
Target branch: main
Loop branch: loop/lm4-20-account-read-model
Commit(s): 518bdac feat: add trustworthy account read model
Merge commit: c641dcb merge: LM4-20 account read model
Verification: Before and after merge: dramaip-platform/services GOCACHE=/tmp/dramaip-go-build go test ./...; dramaip-platform/clients pnpm contracts:check, pnpm lint, pnpm typecheck and pnpm build:web; dramaip-platform make test; node --check for both smoke scripts; make web-route-smoke; git diff --check. All listed checks passed. The rebuilt Compose stack executed the new account-bootstrap assertion (windows, cache policy, section states and 30 points) before the existing platform E2E later stopped in the unrelated Web AI request at cloud_preflight_request_mismatch.
UI/manual evidence: AccountDashboard now makes one account-bootstrap request instead of nine independent account/report requests; plans are lazy-loaded only after opening the subscription tab. BillingOverview shares that query. Each unavailable section visibly says it was not replaced by zero, includes its last checked timestamp and trace id. The BFF HTTP test verifies a quota failure leaves orders available while token balance has unavailable/error_code/trace/last_updated and no data payload. The Compose request confirmed the 30-day read model returns 30 dated points.
Diff review: Reviewed concurrent BFF section isolation, safe generic error codes, legacy report no longer swallowing errors, SDK Zod parsing, query bounds/cache invalidations, stable empty arrays, zero-filled date series and Web's unavailable-state rendering. No credentials, cookies, prompts, user content, local databases, images or build output were committed.
Remote sync: Fetched and fast-forward checked origin/main at a06dca2 before branch creation and again before merge; main had no intervening remote commits.
Push: c641dcb pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-20-account-read-model deleted after successful main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build artifacts excluded).
Notes: The full platform E2E script's new account assertions executed successfully; it later exposes that the Web chat endpoint lacks the required AI preflight binding. That pre-existing Web AI flow is P2 work owned by LM4-28, so this loop does not bypass, weaken or misclassify it as an account failure.
```

```text
Loop: LM4-12R
Target branch: main
Loop branch: loop/lm4-12r-web-preflight-binding
Commit(s): 5c85942 fix: bind web chat to cloud AI preflight
Merge commit: 4d6388d merge: LM4-12R web chat preflight binding
Verification: Before merge: platform services targeted Web BFF/Gateway/platform hash tests and full `GOCACHE=/tmp/dramaip-go-build go test ./...`; clients `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, and `pnpm build:web`; `make test`; `make web-route-smoke`; `node --check scripts/platform-e2e.mjs`; rebuilt Compose `make platform-e2e`. After merge: `make test`, `make platform-e2e`, and `git diff --check origin/main...HEAD`. All passed. The health E2E confirmed that preflight succeeds before the test Provider call, quota is consumed once, the idempotency replay does not consume again, and a changed payload with the old binding is rejected.
UI/manual evidence: The existing Web Chat form now sends its provider/model/messages/token cap to preflight before submitting a generated request id and the returned hash to Chat. The UI remains intentionally synchronous; model catalog, history, streaming and cancellation remain LM4-28 work.
Diff review: Reviewed the shared Go SHA-256 base64url vector, Web BFF two-stage default-model resolution, preflight response validation, strict bounded JSON/message validation, execution-time recheck, Gateway final hash/amount reservation, SDK contract and E2E sequence. New paths log no prompt body and persist no credential. No secret, local database, screenshot or build artifact was committed.
Remote sync: Fetched and fast-forward checked origin/main at 28e582c before the loop branch and again before merge; main had no intervening remote commits.
Push: 4d6388d pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-12r-web-preflight-binding deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build artifacts excluded).
Notes: This is a P1 compatibility repair reopened from LM4-12 after LM4-21 exposed a Web-only broken synchronous Chat path. It does not advance LM4-28; LM4-21 must still be rerun before any P2 production-workspace loop can begin.
```

```text
Loop: LM4-21
Target branch: main
Loop branch: loop/lm4-21-core-experience-gate-rerun
Commit(s): b9102d6 docs: rerun LM4-21 core gate
Merge commit: 6cbbae2 merge: LM4-21 core experience gate
Verification: On the rerun branch, Desktop `pnpm format:check`, `pnpm test` (144 unit tests plus migration/repository smoke), `pnpm test:ui` (21 screenshots, 0 fixed-fixture accessibility observations), `pnpm test:e2e:skip-build`, `pnpm package:smoke:dir`, and signed-artifact-independent `pnpm package:smoke` (macOS DMG and ZIP) all passed. Platform clients `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm build:web`, and `pnpm build:admin`; services `GOCACHE=/tmp/dramaip-go-build go test ./...`; `make platform-e2e`; and `make web-route-smoke` all passed. The Gate's post-merge Desktop E2E and Platform health E2E passed again; the latter reports `ok: true` and one 22-token charge. `git diff --check` and the tracked secret-name scan were clean.
UI/manual evidence: Retained isolated UI output at `dramaip-desktop/artifacts/lm4-21-rerun/` covers 1024/1320/1600px, light/dark and reduced-motion scenarios. Manual review of 1024px dark, 1320px light and 1600px script-workspace images found no critical horizontal overflow or unreadable primary action. Automated Electron E2E covers the 300-chapter keyboard/performance path, deep-link history and panels, global task dock, command palette shortcut, atomic preview adoption/undo, immediate-route-leave autosave, failed-task crash/restart/requery, project package roundtrip, mobile-draft adoption state and cloud account boundaries. The Web AI health sequence now preflights before the Provider call, charges once, keeps idempotency replay free of a second charge and rejects a changed request using an old hash.
Diff review: This Gate contains no product-code workaround: it revalidated the cumulative P1 surface after LM4-12R repaired the detected Web preflight incompatibility. Reviewed the cumulative test evidence, retained screenshots, build output boundary and sensitive-file scan; no credential, prompt, local database, screenshot, package output or other ignored artifact was committed. The full DMG build intentionally skipped signing/notarization because no Apple signing identity or notarization environment was configured; the packaged app smoke nevertheless passed.
Remote sync: Fetched and fast-forward checked origin/main at 4b0e928 before the rerun branch and again before merge; main had no intervening remote commits.
Push: 6cbbae2 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-21-core-experience-gate-rerun and the previously retained audit branch loop/lm4-21-core-experience-gate were deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and retained UI artifacts excluded).
Notes: The first LM4-21 attempt truthfully remains recorded above as partial: it exposed the Web Cloud AI binding defect, which was repaired as LM4-12R under the same Gate's block-P2 rule. This rerun closes that blocker; P2 may now start with LM4-22.
```

```text
Loop: LM4-22
Target branch: main
Loop branch: loop/lm4-22-production-shell-planning
Commit(s): a5ad80a feat: add adaptation production shell
Merge commit: b694135 merge: LM4-22 adaptation production shell
Verification: Before merge, Desktop `pnpm format:check`; `pnpm test` (typecheck, 146 unit tests, DB migrations/repository smoke); `pnpm test:ui` (23 screenshots, 0 accessibility observations); `pnpm test:e2e`; full `pnpm package:smoke` (DMG, ZIP and packaged-app smoke); and a final-source `pnpm package:smoke:dir` all passed. After merge, `pnpm test:e2e:skip-build`, `pnpm test:unit` (146/146), and `git diff --check` all passed. The full package build intentionally skipped code signing and notarization because no Apple identity/notarization environment is configured; the packaged app itself initialized its smoke database successfully.
UI/manual evidence: Retained UI output at `dramaip-desktop/artifacts/lm4-22/` includes production-planning 1024px light and 1320px dark plus a 1600px script workspace review. Manual review found the shell, stage stepper, toolbar, planner density and primary actions readable with no critical horizontal overflow. The screenshot matrix covers 23 cases with zero fixed-fixture accessibility observations. Electron E2E covers episode-to-script-to-shots-to-video stage navigation and preserves the selected episode context.
Diff review: Reviewed the shared production shell, breadcrumbs, stage navigation, unified export menu, responsive planner views/filters/bulk script generation, and route-context preservation. Stage summaries are renderer-local read models and do not mutate LM4-02 workflow truth: scripts complete only from the full adaptation script list, while shots and video deliberately remain in progress or blocked rather than deriving false completion from a page-local slice. The active connector has restrained flow animation and the existing global reduced-motion preference disables it. No user content, credentials, local database, retained screenshot, package artifact or other ignored output was committed; tracked secret-name scan found no .env, PEM, key or id_rsa file.
Remote sync: Fetched and fast-forward checked origin/main at 37966d8 before branch creation and again before merge; main had no intervening remote commits.
Push: b694135 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-22-production-shell-planning deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and retained UI artifacts excluded).
Notes: This loop establishes the shared production navigation/context layer only. Structured script internals, Storyboard editing and video production behavior remain isolated to LM4-23, LM4-24 and LM4-25 respectively.
```

```text
Loop: LM4-23
Target branch: main
Loop branch: loop/lm4-23-structured-script-editor
Commit(s): 0a703ff feat: add structured script editor
Merge commit: cdb2461 merge: LM4-23 structured script editor
Verification: Before merge, Desktop `pnpm format:check`; `pnpm typecheck`; `pnpm test` (149 unit tests plus DB migration/repository smoke); targeted structured parser/export tests; `pnpm test:ui` (25 screenshots, 0 accessibility observations); `pnpm test:e2e`; and current-source `pnpm package:smoke:dir` all passed. After merge, `pnpm test:e2e:skip-build`, `pnpm test:unit` (149/149), and `git diff --check` all passed. The packaged app smoke initialized its database successfully; macOS signing/notarization remains intentionally skipped because no Apple identity/notarization environment is configured.
UI/manual evidence: Retained UI output at `dramaip-desktop/artifacts/lm4-23/` covers the structured script workspace at 1024px light, 1320px dark, and 1600px light. Manual review found no critical overflow; after review, the mode, import and block-insert controls were changed from low-contrast ghost controls to outlined controls so the dark workflow has explicit readable entry points. The final 25-image matrix has zero fixed-fixture accessibility observations. Electron E2E creates a scene block, uses Cmd/Ctrl+Enter to add an action block, and verifies the saved content remains compatible Markdown; the established immediate-route-leave draft test still passes.
Diff review: `script.content` remains the only persisted source of truth and existing Markdown/AI outputs open without a database migration. The new core model derives scene heading, action, character, dialogue and transition blocks, serializes them back to canonical Markdown, offers a plain Markdown fallback and accepts pasted Markdown, structured JSON or existing script-export JSON into a local draft before save. Script JSON now includes a derived `structuredDocument` while retaining the unchanged `script.content` contract. Checkpoints flush the current draft before snapshotting; scene replacement flushes and explicitly confirms before invoking the existing snapshot-before-write path. AI preview continues to use LM4-14's atomic adoption flow and now displays structured block locations. No user content, credentials, local DB, retained screenshot, package artifact or ignored output was committed; tracked secret-name scan was clean.
Remote sync: Fetched and fast-forward checked origin/main at 9bc22f0 before branch creation and again before merge; main had no intervening remote commits.
Push: cdb2461 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-23-structured-script-editor deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build, package and retained UI artifacts excluded).
Notes: This is a compatibility-first structure layer, not a new database format. It preserves the old plain-text exit hatch and avoids changing Storyboard, provider or collaboration semantics, which remain LM4-24–27 work.
```

```text
Loop: LM4-24
Target branch: main
Loop branch: loop/lm4-24-storyboard-asset-inspector
Commit(s): bf597e1 feat: add storyboard asset inspector
Merge commit: f4fe7e8 merge: LM4-24 storyboard asset inspector
Verification: Before merge: Desktop `pnpm typecheck`; `pnpm format:check`; `pnpm test:unit` (151/151); targeted IPC, Storyboard ordering and delivery export tests; Electron-runtime DB migration replay (9/9) and DB smoke; `pnpm test:e2e`; `pnpm test:ui` (27 screenshots, including Storyboard at 1024px light and 1320px dark, 0 accessibility observations); and `git diff --check`. After merge: `pnpm typecheck`; `pnpm test:unit` (151/151); Electron-runtime DB migration replay (9/9) and DB smoke; `pnpm test:e2e`; and `git diff --check`. All listed checks passed. The aggregate `pnpm test` wrapper was attempted but its Node 22 native rebuild could not download headers because the execution environment rejected HTTPS protocol handling; the same migration and DB smoke tests passed under the Electron runtime after its native modules rebuilt successfully.
UI/manual evidence: The Shot workspace now presents a card-grid Storyboard with source-asset thumbnail/fallback visual, sequence, camera, motion, duration, risk and status cues. Native drag/drop, visible nudge buttons and Alt+Left/Right support reordering; a short FLIP transition is disabled by reduced-motion preference. The Inspector uses named Info, Prompt, Assets, Review and Versions tab panels. Asset cards support HTTPS/local-reference input, safe local-file selection or local-file drop, reference-only save, status/missing visibility and image previews; the interface explicitly states it never uploads, copies or deletes source files. Manual review of retained light 1024px and dark 1320px Storyboard screenshots found no critical overflow or unreadable primary action.
Diff review: Reviewed the validated IPC additions, complete-sequence transactional reorder validation, persisted `shotNumber` as the existing export/video ordering truth, duplicate-action lock, shared IPC contract, reference-only asset persistence, and delivery JSON/CSV sorting regression. No new migration or provider/video queue behavior was introduced. No user content, credentials, local databases, retained screenshots, package output or other ignored artifacts were committed.
Remote sync: Fetched and fast-forward checked origin/main at 0b8d231 before branch creation and again before merge; main had no intervening remote commits.
Push: f4fe7e8 pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-24-storyboard-asset-inspector deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build, package and retained UI artifacts excluded).
Notes: Asset selection is deliberately a reference boundary only. Video generation queues and real provider submission remain LM4-25–27 work.
```

```text
Loop: LM4-25
Target branch: main
Loop branch: loop/lm4-25-video-production-console
Commit(s): ed664b0 feat: add video production console
Merge commit: cc4ef5b merge: LM4-25 video production console
Verification: Before merge: Desktop `pnpm format:check`; `pnpm typecheck`; `pnpm test:unit` (154/154); targeted video capability/estimate, workflow guide, IPC contract and delivery-export tests; Electron-runtime DB migration replay (9/9) and DB smoke; `pnpm test:e2e`; `pnpm test:ui` (28 screenshots, 0 accessibility observations); and `git diff --check`. After merge: `pnpm typecheck`; `pnpm test:unit` (154/154); `pnpm test:e2e:skip-build`; `pnpm test:ui:skip-build -- --output=artifacts/lm4-25` (28 screenshots, 0 accessibility observations); and `git diff --check origin/main...HEAD`. All listed checks passed. The aggregate `pnpm test` wrapper remains unsuitable in this environment because its Node 22 native rebuild cannot download headers through the available HTTPS path; the Electron-runtime migration and DB smoke alternatives passed.
UI/manual evidence: The Video workspace presents a provider/model preflight with duration, expected wait, reference count, local cost estimate and plain-language cancellation semantics. It blocks unconfigured real providers before submission, supports one-shot and duplicate-safe batch queues, automatically refreshes active work from one global polling loop, and keeps a manual refresh escape hatch. Successful results can be compared in synchronized 2-up/3-up players, viewed fullscreen and explicitly marked as the one best delivery result. The retained `video-production-console-1024-light` and `video-failed-task-1320-reduced` images show the comparison, selection, retry, local-stop-tracking and reduced-motion states; manual review found no critical overflow or unreadable primary action. Result entry and best-selection use one-shot motion; repeating motion is restricted to the global refresh state and is disabled under reduced motion.
Diff review: Reviewed provider capability preflight, bounded estimate parsing and cost rounding, persisted task/long-task linkage, stale-response guard, duplicate-safe batch queue, task polling, honest local-only cancellation, result comparison and best-result selection. Delivery export only retains the selected successful result as a narrow pointer and excludes raw provider metadata. No remote provider cancellation claim, credential, user content, local database, retained screenshot, package artifact or ignored output was committed.
Remote sync: Fetched and fast-forward checked origin/main before branch creation and again before merge; main had no intervening remote commits.
Push: cc4ef5b pushed to origin/main successfully on 2026-07-20; this completion record is pushed immediately after its own commit.
Loop branch cleanup: Local loop/lm4-25-video-production-console deleted after the main push; no remote loop branch was created.
Current branch/worktree: main; clean before completion-record creation (ignored local build and retained UI artifacts excluded).
Notes: This loop provides capability-gated production plumbing and a fully testable mock path, not a false claim of a real domestic provider. LM4-26 and LM4-27 remain separately accountable for sandbox-verified provider adapters, credentials and rollback behavior.
```

```text
Loop: LM4-26 (partial)
Target branch: main
Loop branch: loop/lm4-26-seedance-provider
Commit(s): 762a450 feat: add Hailuo video provider adapter
Verification: Desktop `pnpm typecheck`; `pnpm test:unit` (156/156); `pnpm format:check`; `pnpm test:e2e`; and `pnpm test:ui:skip-build -- --output=artifacts/lm4-26` (29 screenshots, 0 accessibility observations) all passed. `git diff --check` passed before the implementation commit. Adapter contract coverage verifies the MiniMax Hailuo create → query → official file-retrieval lifecycle, reference safety, resolution fallback and normalized rate-limit error. Service and capability tests prove an API key plus the default-off `featureEnabled` flag are required outside the renderer.
UI/manual evidence: The 1024px Hailuo settings baseline shows provider-specific MiniMax defaults, a default-off production-channel switch, Keychain-only credential guidance and explicit local-only cancellation semantics; manual review found no critical overflow. The page now has explicit labels for its return, provider fields, selector and destructive action, and the baseline reported no accessibility observations.
Sandbox evidence: Full official sandbox E2E is NOT RUN. `pnpm test:hailuo:sandbox` correctly stopped before any network request because `HAILUO_SANDBOX_ALLOW_BILLING=1` was absent. No authorized MiniMax Hailuo credential or explicit billable-run authority was provided, so no external task, result archive or local playback assertion is claimed.
Diff review: Reviewed the provider-only extension points, server-side feature gate, API-key boundary, Hailuo request/state/error mappings, result-URL resolver, restricted reference input and the safety-gated sandbox runner. Provider metadata excludes API keys; no credential, user content, local database, screenshot, build output or ignored artifact was committed. Hailuo cancellation is documented and exposed as local stop-tracking because the selected official API surface has no verified remote-cancel endpoint.
Remote sync: Fetched and fast-forward checked origin/main at cc4ef5b before creating the loop branch. The required pre-merge sync, merge and target-branch post-merge validation are deliberately deferred until sandbox evidence makes this loop eligible for `done`.
Push: The loop branch is retained and pushed after this audit record so an authorized sandbox runner can continue from the exact reviewed code; it is not merged into main.
Current branch/worktree: loop/lm4-26-seedance-provider; clean before this audit-record creation (ignored local build and retained UI artifacts excluded).
Blocking next action: Run `HAILUO_SANDBOX_ALLOW_BILLING=1 HAILUO_SANDBOX_API_KEY=<securely-injected-key> pnpm test:hailuo:sandbox` only in an approved, billable MiniMax sandbox. Record the redacted result, then complete the mandatory sync/merge/post-merge verification and branch cleanup. Until then LM4-26 remains `partial`, LM4-27 must not start, and no P0/P1/P2 full-completion claim is valid.
```
