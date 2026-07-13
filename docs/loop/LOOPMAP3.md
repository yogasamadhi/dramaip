# Platform Architecture Convergence Loop Map 3

本文档依据 [LOOPRULE.md](./LOOPRULE.md) 编写，用于把
[技术架构.md](../技术架构.md) 定义的目标架构和
[差异演进.md](../差异演进.md) 记录的 D-001～D-011 差距，拆成可执行、可审查、
可验证、可提交、可回滚的小闭环。

本地图承接 [LOOPMAP2.md](./LOOPMAP2.md) 已完成的桌面端产品升级基线，重点从
“桌面端本地能力完整、平台端开发骨架可运行”推进到“安全、可对账、可观测、可部署、
可由 Web/Desktop/Mobile/Admin 分端使用的商业平台”。

## 0. 目标与范围

### 0.1 总体目标

完成以下总体结果：

1. 让版本化 API、端专属 BFF、事件契约和 SDK 生成边界与目标架构一致。
2. 让认证、长期凭据、服务间身份、数据库权限和内容隐私达到生产安全门槛。
3. 让支付、订阅、额度、AI 请求和 Provider 成本形成可审计、可幂等、可补偿、可对账的闭环。
4. 打通 Web 付费、桌面端安全登录、Cloud AI 调用、额度结算和用量展示的商业纵切。
5. 建立 trace、指标、日志、告警、故障降级、备份恢复和生产部署能力。
6. 在核心闭环稳定后，依次交付移动轻创作、管理后台、云同步、资源市场、私有知识库和团队账号。

### 0.2 参考来源

- 执行规则：[LOOPRULE.md](./LOOPRULE.md)。
- 目标架构：[技术架构.md](../技术架构.md)，其中“必须 / 禁止 / 只能”为架构红线。
- 当前差距：[差异演进.md](../差异演进.md) 中的 D-001～D-011。
- 产品基线：[ROADMAP.md](../product/ROADMAP.md)、[LOOPMAP2.md](./LOOPMAP2.md)。
- 工程基线：`dramaip-desktop`、`dramaip-platform`、根级启动脚本和 CI 配置。

### 0.3 覆盖范围

本地图覆盖：

- 根仓库文档、CI、验证入口与契约治理。
- Web/Desktop/Mobile/Admin 四端及对应 BFF。
- auth、user、billing、quota、ai-gateway、notification、各领域 job。
- PostgreSQL、Redis、RabbitMQ、Kong、Docker Compose、Kubernetes、Helm 和可观测性栈。
- 支付、订阅、额度、AI 成本、对账、灾备和生产发布 Gate。
- 核心闭环完成后的云同步、资源市场、私有知识库、团队租户和隐私合规能力。

### 0.4 明确不覆盖

本地图不直接承诺：

- 改变桌面端“本地 SQLite 为可信写入源”的本地优先原则。
- 把完整桌面创作工作台复制到移动端。
- 在没有真实用户和合规设计前开放公共资源市场或公共知识库。
- 绕过支付平台、模型 Provider、应用商店或内容平台的审核与安全机制。
- 为了追求目录形式而拆分没有独立业务、协议、安全或回滚价值的微服务。
- 一次性重写桌面端现有创作功能；本地图只处理平台接入所必需的桌面端改动。

## 1. 当前基线

### 1.1 已具备能力

- 桌面端已经覆盖本地项目、小说、改编、剧本、分镜、视频前置、导出、备份、项目包和 AI 工作流。
- 桌面端已有类型检查、单元测试、DB migration replay、DB smoke、Electron E2E 和打包 smoke 入口。
- 平台端已有 auth、user、billing、quota、ai-gateway、notification、billing-job、quota-job、migration-job 和 Web BFF 骨架。
- Compose、Kong、PostgreSQL、Redis、RabbitMQ、Prometheus、Jaeger、OpenSearch、Grafana 等目录已存在。
- Web 已有登录、注册、套餐、账号、订单、用量和 Cloud AI 页面骨架；Mobile 已有 Expo Router 骨架。
- SDK、proto、Go 单模块 monorepo 和 `/v1/...` 路由已部分落地。

### 1.2 本地图创建时已通过的检查

截至 2026-07-13，本地审计结果为：

- `dramaip-desktop`: `pnpm typecheck` 通过。
- `dramaip-desktop`: `pnpm test:unit` 通过，共 115 个测试。
- `dramaip-desktop`: `pnpm test:db` 通过，包含 migration replay 和 DB smoke。
- `dramaip-desktop`: `pnpm format:check` 通过。
- `dramaip-platform/clients`: `pnpm typecheck` 通过。
- `dramaip-platform/clients`: `pnpm build:web` 通过。
- 根目录三个 Python 启动脚本通过 `python3 -m py_compile`。

### 1.3 已知失败与不可信检查

- `dramaip-platform/services`: `go test ./...` 已通过；BFF 路由和测试均使用 `/v1/...`。
- `dramaip-platform/services`: `make event-contracts` 已通过，执行 protobuf 格式、`buf lint`、相对 `origin/main` 的 breaking 检查和生成物一致性检查；历史同步 API 的 lint 例外被限制在既有 `api/` 路径，新 `events/` 契约继续使用完整 STANDARD 规则。
- `dramaip-platform/clients`: `pnpm lint` 已使用显式 ESLint CLI 配置，无交互通过；Web/Mobile lint 可作为 CI Gate。
- 平台完整 Compose E2E 已分流到根级 workflow 的夜间、发布标签或手动触发，PR 运行轻量 Web route smoke；仓库所有者已选择普通 Gitee 使用方式，未启用 Gitee Go 托管门禁。
- 桌面端 workflow 已迁移到根 `.github/workflows/desktop-ci.yml`，并显式设置 `dramaip-desktop` 工作目录。
- 平台客户端没有稳定的自动化测试基线；Go 领域层测试覆盖不足。
- 尚未在本地图创建时重跑桌面 Electron E2E、跨平台 package smoke、平台完整 Compose E2E、Kubernetes 部署或恢复演练。
- LM3-00 负责将当前活动文档链接从 `docs/process` 收口到 `docs/loop`；历史完成记录中的旧路径字符串保留为审计事实。
- [差异演进.md](../差异演进.md) 的 D-001（Web BFF 路径迁移）、D-003（事件契约）和 D-004（`/v1` 测试契约）已完成并保留记录；其余 D 项仍待后续 loop 闭环。

### 1.4 差异映射

| 差异 | 对应 Loop | 目标结果 |
| --- | --- | --- |
| D-001 通用 BFF 未分端 | LM3-02、LM3-25、LM3-27、LM3-29 | Web/Desktop/Mobile/Admin 使用独立 BFF |
| D-002 BFF 直连 notification schema | LM3-08（done）、LM3-10 | BFF 只调用 notification API，DB role 强制边界 |
| D-003 缺少事件契约 | LM3-04 | 事件 schema 版本化并由 CI 校验 |
| D-004 BFF 测试使用无版本路径 | LM3-01 | API、SDK、测试统一 `/v1/...` |
| D-005 套餐快照不完整 | LM3-11（done） | 订单、订阅、周期账户可重建历史权益 |
| D-006 Provider 成本快照不完整 | LM3-14（done） | request 级成本可追踪、可对账 |
| D-007 DB role 未隔离 | LM3-10 | 服务只能访问自己 schema |
| D-008 生产仍使用 HS256 | LM3-05（done） | RS256 + JWKS + key rotation |
| D-009 Web token 存 localStorage | LM3-06（done） | HttpOnly Cookie + CSRF，长期 token 不进 localStorage |
| D-010 notification 无独立 service/job | LM3-08（service done）、LM3-09 | notification 同步和异步边界完整 |
| D-011 缺少独立管理后台 | LM3-29、LM3-30 | Admin 独立认证、BFF、RBAC、审计和 UI |

## 2. 兼容、安全、数据与产品约束

以下约束在所有 loop 中不得回退：

1. 外部 API、SDK 和 E2E 只调用版本化路径；不兼容变更升主版本并保留明确废弃窗口。
2. Web/Desktop/Mobile/Admin 各自使用独立 BFF service 定义；BFF 只聚合和裁剪，不承载领域规则或直接读写领域表。
3. 每个领域服务独占自己的 schema 和 DB role；跨域读取只走 API、事件投影或 reporting/read-model。
4. 平台 API Key 永不下发客户端；桌面本地 BYOK 与平台 Cloud AI 两种模式相互独立。
5. 没有 quota 原子预扣、结算、幂等审计和补偿路径时，禁止开放平台 API Key 托管的云端 AI。
6. 支付状态只信任验签后的服务端 webhook 或服务端主动查询；客户端不得直接改变订单、订阅或额度状态。
7. 写库与发事件使用 outbox；consumer 必须幂等；支付激活链路使用 Saga，不使用 2PC 或 dual-write。
8. Web refresh token 使用 HttpOnly Cookie；Desktop 使用 Keychain + PKCE；Mobile 使用 Keychain/Keystore；所有端 access token 优先只存内存。
9. token、API Key、密码哈希、支付敏感数据、正文和完整 prompt 不得进入日志、trace、URL、崩溃上报或不必要的审计字段。
10. 本地创作内容默认不上传；云端 AI 只接收完成当前请求所需的最小上下文。
11. Redis 只做缓存、限流和短期幂等加速，不作为订单、订阅、额度或 AI 请求的唯一权威源。
12. 账本类数据保留可审计历史，不以覆盖写掩盖过去状态。
13. 关键并发写使用原生 SQL 和事务，禁止 GORM `Save()` 并避免隐式零值更新。
14. 新旧路径、认证方案、数据迁移和部署切换必须有替代路径、回滚方案、兼容说明和验证证据。

## 3. 粒度策略与执行约定

### 3.1 粒度策略

- 以用户可见结果、公共协议、安全边界、数据迁移边界和生产 Gate 为 loop 单位。
- 同一能力所需的代码、测试、配置、接线和文档放在同一 loop 内，不后置“补测试”或“补文档”loop。
- 认证、支付渠道、账本迁移、端专属 BFF、生产发布和灾备具有独立风险与回滚边界，必须拆分。
- 两个外部支付渠道具有独立账号、SDK、验签、沙箱和上线窗口，因此分别成 loop。
- 实施时若预计 diff 无法在一次聚焦 review 中理解，必须按 `LOOPRULE.md` 3.3.3 重新拆分，并先更新本地图。
- 若相邻 loop 在执行中被证明共享同一验收和回滚边界，应合并为一个能力 loop 的内部 checklist，避免碎片化。

### 3.2 Git 与状态约定

- 规划中的所有 loop 初始状态均为 `todo`。
- 目标分支默认是 loop 开始时记录的当前稳定分支；本地图不预设永远是 `main`。
- 分支格式：`loop/<loop-id>-<short-topic>`，例如 `loop/lm3-05-jwks-auth`。
- 严格执行：检查工作区 → fetch/ff-only 同步 → 新建 loop 分支 → 实现与验证 → diff 审查 → 提交 → 再同步目标分支 → 合并 → 合并后验证 → 推送 → 清理分支。
- 未推送、未清理分支或工作区有未解释残留时，只能标为 `partial`，不能标为 `done`。
- 每完成一个 loop，在第 10 节追加完成记录，不覆盖历史记录。

### 3.3 通用验证命令

按变更范围选择，不要求无关 loop 重跑全部命令；公共协议、安全、账本、迁移、发布 Gate 需扩大验证。

```bash
# 通用 diff
git diff --check

# 桌面端
cd dramaip-desktop
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:db
pnpm test:e2e
pnpm package:smoke

# 平台 Go
cd dramaip-platform/services
GOCACHE=/tmp/dramaip-go-build go test ./...
buf lint
buf generate

# 平台客户端
cd dramaip-platform/clients
pnpm lint
pnpm typecheck
pnpm build:web

# 平台集成
cd dramaip-platform
make test
make platform-up
make platform-e2e
make platform-down
```

如果命令依赖未安装工具、真实支付沙箱、真实 Provider、Kubernetes 或生产权限，完成记录必须写明环境、替代验证和仍未消除的风险；缺少必须环境时不得把生产 Gate 标为 `done`。

## 4. Gate 与优先级

| Gate | 目标 | 包含 Loop | 通过后允许 |
| --- | --- | --- | --- |
| G0 绿色主干 | 路径、BFF、CI、文档可信 | LM3-00～LM3-03 | 稳定推进平台收敛 |
| G1 契约与安全底座 | 事件、JWKS、Cookie、内部身份可信 | LM3-04～LM3-07 | 进入生产数据边界改造 |
| G2 数据自治 | Notification 和 DB 权限闭环 | LM3-08～LM3-10 | 收紧跨服务写权限 |
| G3 账本与支付 | 订阅、quota、AI、支付、对账闭环 | LM3-11～LM3-20 | 真实付费内测 |
| G4 运行可靠性 | trace、指标、日志、弹性策略可用 | LM3-21～LM3-23 | 扩大内测流量 |
| G5 多端商业纵切 | Web/Desktop/Mobile/Admin 分端可用 | LM3-24～LM3-31 | 进入生产部署验收 |
| G6 生产就绪 | 部署、灾备、E2E、压测、恢复通过 | LM3-32～LM3-34 | 正式生产发布 |
| G7 平台化 | 同步、市场、知识库、团队、合规闭环 | LM3-35～LM3-40 | 平台化能力正式发布 |

阻断规则：

- G0 未通过，不开始公共协议或高风险数据迁移。
- G1 未通过，不开放生产登录态或真实长期凭据。
- LM3-12～LM3-16 未完成，不开放平台 API Key 托管的 Cloud AI。
- LM3-11、LM3-15、LM3-18～LM3-20 未完成，不开放真实支付。
- G6 未通过，不对外宣称生产可用。
- G7 能力不得反向阻塞桌面本地模式和 G6 的核心商业闭环。

## 5. Loop 总览

| Loop | P | Owner | 状态 | 单一目标 | 主要范围 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| LM3-00 | P0 | 工程负责人 | done | 固化基线并收口文档入口 | 根文档、`docs/loop`、验证记录 | 无 |
| LM3-01 | P0 | API/平台 | done | 恢复统一 `/v1` 契约与测试 | BFF router/test、SDK、E2E、Kong | LM3-00 |
| LM3-02 | P0 | 平台架构 | done | 将通用 BFF 迁移为 Web BFF | proto、Go app、Compose、Kong、SDK | LM3-01 |
| LM3-03 | P0 | DevEx/CI | done | 建立根级非交互绿色 CI | workflows、lint、build、smoke | LM3-02 |
| LM3-04 | P0 | 契约治理 | done | 建立版本化事件契约与生成 Gate | `services/events`、buf/CI、producer/consumer | LM3-03 |
| LM3-05 | P0 | Auth/安全 | done | 生产认证迁移到 JWKS | auth、Kong、key set、会话 | LM3-03 |
| LM3-06 | P0 | Web/Auth | done | Web 长期凭据迁移到安全 Cookie | Web、Web BFF/Auth、CSRF | LM3-05 |
| LM3-07 | P0 | 平台安全 | done | 建立可信边缘身份和服务间授权 | Kong、gRPC middleware、资源归属 | LM3-05 |
| LM3-08 | P0 | Notification | done | 建立通知服务并切断 BFF 直连表 | notification service、BFF | LM3-02、LM3-04 |
| LM3-09 | P1 | Notification | done | 建立通知事件消费与投递闭环 | notification job、inbox、MQ | LM3-08 |
| LM3-10 | P0 | 数据平台 | done | 用 DB role 强制数据自治 | PostgreSQL roles、服务配置、手工权限 Gate | LM3-08 |
| LM3-11 | P0 | Billing | done | 补齐套餐和权益历史快照 | migrations、billing、quota contract | LM3-10 |
| LM3-12 | P0 | Quota | done | 完成原子预扣与结算状态机 | quota schema/biz/data/job | LM3-10、LM3-11 |
| LM3-13 | P0 | AI Gateway | done | 完成 AI 请求持久化幂等 | request audit、BFF/SDK、Redis fallback | LM3-12 |
| LM3-14 | P0 | AI FinOps | done | 建立 Provider 成本账本与风控 | cost log、pricing、alerts、plans | LM3-13 |
| LM3-15 | P0 | Billing/Quota | done | 完成支付激活 Saga 和 Outbox | billing、quota、jobs、MQ | LM3-04、LM3-11、LM3-12 |
| LM3-16 | P1 | Billing | done | 完成订阅全生命周期 | 升降级、续期、取消、退款 | LM3-15 |
| LM3-17 | P1 | 支付 | done | 接入微信支付沙箱与 webhook | billing ingress、Kong、SDK | LM3-15 |
| LM3-18 | P1 | 支付 | done | 接入支付宝沙箱与 webhook | billing ingress、Kong、SDK | LM3-15 |
| LM3-19 | P0 | 财务/平台 | done | 建立支付、订阅、额度三方对账 | billing/quota jobs、reporting | LM3-16～LM3-18 |
| LM3-20 | P0 | 架构验证 | done | 通过账本与支付并发安全 Gate | 领域测试、并发测试、沙箱 E2E | LM3-11～LM3-19 |
| LM3-21 | P1 | Observability | done | 打通全链路 trace 与安全日志 | OTel、Jaeger、Fluent Bit、OpenSearch | LM3-07、LM3-15 |
| LM3-22 | P1 | SRE/FinOps | done | 建立指标、看板、告警和错误聚合 | Prometheus、Grafana、Sentry/同类 | LM3-14、LM3-21 |
| LM3-23 | P1 | 平台可靠性 | todo | 落地超时、重试、熔断、降级和舱壁 | gRPC、BFF、AI Gateway、jobs | LM3-21 |
| LM3-24 | P1 | Web 产品 | todo | 完成 Web 账号与付费体验 | Web、Web BFF、下载/订单/用量 | LM3-06、LM3-16～LM3-20 |
| LM3-25 | P0 | Desktop 安全 | todo | 将桌面本地凭据迁移到系统 Keychain | Electron secrets、模型/视频配置、迁移 | LM3-03 |
| LM3-26 | P0 | Desktop/Auth | todo | 建立 Desktop BFF 与 PKCE 登录 | Desktop BFF、Web auth callback、Electron | LM3-05、LM3-07、LM3-25 |
| LM3-27 | P0 | Desktop/AI | todo | 打通桌面 Cloud AI 与本地降级 | Cloud Provider、预检、余额、AI Gateway | LM3-13、LM3-14、LM3-26 |
| LM3-28 | P2 | Mobile | todo | 交付移动端安全登录与精简账户视图 | Mobile BFF、Expo、安全存储 | LM3-05、LM3-07、LM3-24 |
| LM3-29 | P2 | Mobile | todo | 交付移动灵感、草稿和桌面接续 | Mobile、同步 API、Desktop 导入 | LM3-28 |
| LM3-30 | P1 | Admin/安全 | todo | 建立 Admin BFF、独立认证和 RBAC | admin contracts/service/audit | LM3-07、LM3-19 |
| LM3-31 | P2 | Admin/Web | todo | 交付管理后台与 reporting/read-model | admin app、报表、运维查询 | LM3-30 |
| LM3-32 | P1 | Platform/SRE | todo | 建立生产部署、密钥和发布流水线 | Docker、K8s、Helm、Kong、CI/CD | G1～G5 |
| LM3-33 | P0 | DBA/SRE | todo | 建立 PostgreSQL 灾备与恢复能力 | HA、backup、WAL、PITR、演练 | LM3-32 |
| LM3-34 | P0 | Release | todo | 通过核心平台生产就绪 Gate | 全端 E2E、压测、故障/恢复演练 | LM3-20～LM3-33 |
| LM3-35 | P2 | Sync | todo | 交付本地优先云同步与冲突处理 | sync service、Desktop/Mobile、审计 | LM3-27、LM3-29、LM3-34 |
| LM3-36 | P3 | Marketplace | todo | 交付受控资源市场 | package、审核、版本、授权 | LM3-30、LM3-35 |
| LM3-37 | P3 | Knowledge | todo | 交付私有知识库与语义检索 | ingestion、index、privacy、Desktop | LM3-35 |
| LM3-38 | P3 | Enterprise | todo | 交付团队租户、成员和计费归属 | tenant、membership、RBAC、billing | LM3-31、LM3-34 |
| LM3-39 | P1 | Privacy/Legal | todo | 建立内容与个人数据生命周期合规 | retention、delete/export、provider policy | LM3-24～LM3-38 |
| LM3-40 | P0 | Release | todo | 通过 LOOPMAP3 全量平台化 Gate | 全仓、文档、生产检查、发布说明 | LM3-35～LM3-39 |

## 6. Loop 详细定义

### LM3-00：基线与文档入口收口

- **目标**：形成后续 loop 可共同依赖的可信仓库、文档和验证基线。
- **主要范围**：根 README、`docs/README.md`、`docs/loop`、`技术架构.md`、`差异演进.md`、验证命令说明。
- **不在范围**：业务代码、API 行为、部署状态。
- **内部 checklist**：完成 `docs/process` → `docs/loop` 迁移；修复重复/失效活动链接；新增根级项目入口和验证索引；记录当前通过/失败检查；确认 D-001～D-011 状态和日期。
- **验收**：文档入口无失效路径；根 README 能定位两端启动、验证、架构和 Loop 文档；差异状态与代码一致。
- **验证**：`git diff --check`；扫描活动 Markdown 链接中不再含 `docs/process` 或 `./process/`；人工检查根级、通用和桌面文档入口；审查 `git status --short` 不混入用户无关改动。
- **风险/回滚边界**：仅文档路径与内容；整体回滚该文档迁移，不删除来源不明文件。

### LM3-01：统一 `/v1` 外部契约

- **目标**：让真实路由、SDK、测试和 E2E 对同一 `/v1/...` 契约达成一致并恢复 Go 绿色基线。
- **主要范围**：BFF HTTP router/test、SDK、Web 调用、Kong、platform E2E、API 文档。
- **不在范围**：BFF 目录迁移、`/v2` 新能力。
- **内部 checklist**：修复 BFF 单测路径；清除客户端无版本路径；覆盖 `/v1/metrics`、认证、套餐、账户、支付和 AI；定义 deprecated 路径策略；增加防止无版本路径回归的检查。
- **验收**：`go test ./...` 通过；SDK/Web/E2E 不再调用无版本业务路径；重复请求和错误响应仍带 trace 信息。
- **验证**：`GOCACHE=/tmp/dramaip-go-build go test ./...`；`rg` 扫描无版本路径；`make web-route-smoke`；必要时 `make platform-e2e`。
- **风险/回滚边界**：公共 HTTP 兼容边界；若保留旧路径，必须是明确标记且可单独删除的薄兼容层。

### LM3-02：通用 BFF 迁移为 Web BFF

- **目标**：使现有 BFF 以 Web 端专属契约和实现路径运行，不再作为未来各端共享入口。
- **主要范围**：`api/bff/web/interface/v1`、`app/bff/web/interface`、Go import、Docker/Compose、Kong、Makefile、SDK。
- **不在范围**：Desktop/Mobile/Admin BFF 功能实现。
- **内部 checklist**：迁移 proto 和 app 路径；更新生成代码与服务注册；更新构建 TARGET 和运行脚本；更新 Kong upstream；删除或限时保留旧路径；更新架构差异记录。
- **验收**：Web BFF 从目标路径构建并运行；旧通用路径不再新增能力；Web 账号主流程不回退。
- **验证**：`buf lint`、`buf generate` 后工作区无意外 diff；`go test ./...`；`pnpm typecheck`；`make platform-e2e`。
- **风险/回滚边界**：公共 proto package 和容器 target 迁移；回滚时恢复整套路径/生成物/部署引用，不保留混合 import。

### LM3-03：根级 CI 与非交互质量 Gate

- **目标**：让父仓库的每个 PR 自动验证桌面端和平台端的核心可构建状态。
- **主要范围**：根 `.github/workflows`、客户端 ESLint、Makefile/脚本、缓存策略。
- **不在范围**：真实支付和生产 K8s 环境。
- **内部 checklist**：迁移桌面 workflow 到根目录并设置 working-directory；配置 Web/Mobile 非交互 ESLint；平台 CI 加 Web build；PR 运行轻量路由 smoke；完整 Compose/Electron/package smoke 按 PR、nightly、release 分层。
- **验收**：全新 CI runner 无交互完成 lint/typecheck/test/build；桌面端 workflow 在父仓库可见；失败能阻断合并。
- **验证**：本地执行两端 lint/typecheck/test/build；校验 workflow YAML；触发测试 PR 或 workflow_dispatch 并记录运行链接。
- **风险/回滚边界**：CI 配置与开发依赖；回滚不得删除既有有效平台验证。

### LM3-04：事件契约与兼容性 Gate

- **目标**：让 RabbitMQ producer/consumer 共享版本化、可生成、可检查的事件契约。
- **主要范围**：`services/events/<domain>/v1`、event envelope、生成脚本、CI、producer/consumer 接线。
- **不在范围**：每个业务 consumer 的完整功能。
- **内部 checklist**：定义统一 envelope；建立 payment/subscription/quota/notification 事件 schema；补示例 payload；producer 使用生成类型；CI 执行 lint、breaking 和生成物一致性检查。
- **验收**：新增 MQ 事件必须先有 schema；不兼容修改会被 CI 阻断；旧 consumer 面对兼容新增字段不崩溃。
- **验证**：`buf lint`；针对基线的 `buf breaking`；生成后 `git diff --exit-code`；schema 示例解析测试；相关 Go 测试。
- **风险/回滚边界**：公共异步协议；已发布事件不得原地做不兼容修改，回滚以新版本停止发布为边界。

### LM3-05：JWKS 生产认证

- **目标**：用可轮换的非对称签名替代生产共享 HMAC 密钥。
- **主要范围**：auth token 签发/校验、JWKS endpoint、Kong/OIDC 配置、key storage、refresh 会话。
- **不在范围**：Web Cookie UI、Desktop PKCE。
- **内部 checklist**：实现 RS256/ES256 key set 和 `kid`；发布 JWKS；Kong 校验 issuer/audience/expiry/kid；实现 key rotation；完善 refresh rotation/reuse detection、设备撤销和登录失败限流。
- **验收**：生产 profile 不读取共享 `JWT_ACCESS_SECRET`；轮换期间新旧合法 token 按策略工作；撤销和 reuse detection 可审计。
- **验证**：auth 单测；JWKS/Kong 集成测试；过期、错误 issuer/audience/kid、旧 refresh 重放测试；`go test ./...`；安全配置审查。
- **风险/回滚边界**：认证上线边界；使用双 key 验证窗口回滚，禁止回退为生产共享 HS256 默认值。

### LM3-06：Web Cookie 会话与 CSRF

- **目标**：让 Web 长期登录态不暴露给 JavaScript，并保护 Cookie 模式下的状态变更。
- **主要范围**：Web api client、Web BFF/Auth 登录刷新登出、Cookie、CSRF、CORS。
- **不在范围**：Desktop/Mobile token 存储。
- **内部 checklist**：refresh token 迁移到 HttpOnly/Secure/SameSite Cookie；access token 改内存或 BFF session；实现 Cookie rotation/clear；状态变更增加 CSRF；删除 localStorage token 兼容代码和数据。
- **验收**：浏览器 localStorage 无长期 token；刷新、登出、多标签和过期流程正确；CSRF 请求被拒绝。
- **验证**：Web 单元/集成测试；浏览器 smoke；Cookie 属性检查；XSS/CSRF/refresh reuse 测试；`pnpm lint && pnpm typecheck && pnpm build:web`。
- **风险/回滚边界**：登录态迁移；需定义旧 localStorage 会话一次性失效或安全换取策略，禁止双写长期 token。

### LM3-07：可信身份传播与资源授权

- **目标**：让边缘、BFF 和内部服务都能验证调用方，并阻止伪造内部身份和横向越权。
- **主要范围**：Kong header transform、gRPC middleware、mTLS/service token、claims/metadata、领域授权。
- **不在范围**：管理员 RBAC 业务模型。
- **内部 checklist**：剥离不可信内部头；注入最小可信身份；建立服务间 mTLS 或短期 service token；领域服务校验调用方；为 user/subscription/token_account 等资源补归属检查。
- **验收**：伪造 `X-User-*` 无法越权；非授权内部服务调用失败；合法请求 trace/user 上下文可透传。
- **验证**：Kong 配置测试；gRPC middleware 测试；横向越权用例；平台 E2E；安全 diff 审查。
- **风险/回滚边界**：全平台鉴权边界；按 edge injection 与 service verification 的兼容窗口部署，不能留下“只验网关不验服务”的半成品。

### LM3-08：Notification Service 与 BFF 切换

- **目标**：让通知查询和已读操作归属 notification 领域，并移除 BFF 的跨 schema 数据访问。
- **主要范围**：notification proto/service、迁移、repository、BFF downstream client、SDK。
- **不在范围**：MQ 消费、邮件/短信投递。
- **内部 checklist**：实现通知查询/未读/标记已读 API；迁移现有读写逻辑；BFF 改调 gRPC；删除 BFF `*gorm.DB` 通知访问；补契约和领域测试。
- **验收**：BFF 不再查询/更新 `notification.notifications`；Web 通知功能不回退；notification service 独占同步写路径。
- **验证**：`rg 'notification\.notifications|gorm\.DB' app/bff` 无跨域命中；`go test ./...`；Web BFF E2E。
- **风险/回滚边界**：同步通知 API 和数据所有权；回滚应整体恢复调用路径，不允许 BFF 与 service 双写。

### LM3-09：Notification Job 与事件 Inbox

- **目标**：让用户通知由版本化领域事件幂等生成并可重试投递。
- **主要范围**：notification job、event_inbox、RabbitMQ consumer、站内信/邮件渠道抽象。
- **不在范围**：账单、额度和报表等非通知副作用。
- **内部 checklist**：实现 inbox 去重；消费 payment/subscription/quota 事件；`source_event_id` 唯一；失败重试和死信；通知渠道适配与审计。
- **验收**：重复事件只生成一条通知；失败可重试且不丢失；非通知副作用不进入 notification。
- **验证**：consumer 幂等测试；RabbitMQ 集成测试；重启续消费/死信 smoke；`go test ./...`；Compose E2E。
- **风险/回滚边界**：异步至少一次投递；回滚停止 consumer，不删除 inbox 和已生成通知。

### LM3-10：数据库角色与 Schema 隔离

- **目标**：用 PostgreSQL 权限强制执行领域数据自治。
- **主要范围**：数据库 roles/grants、服务连接配置、migration role、启动自检、CI。
- **不在范围**：独立数据库实例拆分。
- **内部 checklist**：为各领域创建独立 role；只授予自身 schema；migration 使用 DDL role；BFF 移除业务 DB 权限；增加跨 schema 失败测试和启动检查。
- **验收**：普通服务无法读写其他 schema；BFF 无领域写权限；migration 仍可升级全部 schema。
- **验证**：权限矩阵 SQL 测试；使用各服务凭据执行允许/拒绝用例；migration replay；平台 E2E。
- **风险/回滚边界**：生产数据访问边界；先在 dev/test 验证并保留 grant 回滚脚本，禁止临时授予超级用户绕过。

### LM3-11：套餐与权益快照

- **目标**：让订单、订阅和周期额度账户能够独立于可变套餐配置重建历史权益。
- **主要范围**：billing/quota migrations、proto、repository、checkout/renewal、历史回填。
- **不在范围**：真实支付渠道、成本账本。
- **内部 checklist**：补 plan code/name/price/currency/quota/RPM/context/model 快照；下单和续期写快照；quota 只消费快照；制定旧数据回填；补改价回归测试。
- **验收**：修改/停用 plans 后历史订单、订阅和额度仍可准确对账；quota 不跨域读取 plans。
- **验证**：migration replay；repository/biz 测试；“下单后改价”集成测试；`go test ./...`。
- **风险/回滚边界**：账本 schema 迁移；新增字段先兼容读写，回滚不得丢弃已产生的快照历史。

### LM3-12：Quota 原子预扣与结算

- **目标**：让并发 AI 请求在额度范围内完成预扣、多退少补和异常补偿。
- **主要范围**：token_accounts、token_reservations、usage logs、quota service/job、原生 SQL。
- **不在范围**：模型 Provider 调用和平台成本定价。
- **内部 checklist**：实现原子条件更新或行锁；唯一 request_id；完整 reservation 状态机；usage 未知 fallback；租约过期和 settlement_pending 补偿；周期账户幂等创建。
- **验收**：并发不超扣；重复请求不重复占用；已产生成本的失败结算不被错误释放；月度账户保留历史。
- **验证**：竞态/并发测试；额度不足、重复结算、超额 usage、过期租约测试；`go test -race ./...`；数据库集成测试。
- **风险/回滚边界**：核心账本写路径；迁移和状态机整体回滚，已结算记录只能追加修正不能删除。

### LM3-13：AI 请求持久化幂等

- **目标**：确保客户端重试不会重复调用模型或重复扣减额度。
- **主要范围**：ai-gateway request audit、idempotency header、request hash、Redis cache、BFF/SDK。
- **不在范围**：Provider 成本定价、UI 套餐展示。
- **内部 checklist**：持久化 `user_id + idempotency_key`；相同 payload 重放；不同 payload 返回 409；处理中返回 202/409；Redis 失效时回退 PostgreSQL；审计只保存最小响应摘要。
- **验收**：超时重试不会产生第二次 Provider 调用或额度扣减；持久化源不可达时保守拒绝。
- **验证**：重复/并发请求测试；Redis 故障测试；Provider 调用计数断言；平台 AI E2E；`go test ./...`。
- **风险/回滚边界**：非天然幂等接口；回滚不能删除持久化唯一约束或已存在的 request audit。

### LM3-14：Provider 成本账本、套餐校准与风控

- **目标**：让每次 AI 请求的真实成本可追踪，并以真实工作流数据校准套餐和预算保护。
- **主要范围**：provider cost log、pricing snapshot、plan calibration、AI Gateway 限流/成本熔断。
- **不在范围**：用户 quota 扣费规则替换。
- **内部 checklist**：记录输入/输出单价、币种、汇率和成本；关联 request/reservation；按真实 prompt 链重算套餐额度；增加用户/IP 短窗口成本上限；定义异常成本告警。
- **验收**：单个 request 可同时查询用户额度和平台成本；套餐额度与上下文/RPM/典型步骤有可复算依据；异常成本会被阻断或告警。
- **验证**：价格快照测试；汇率/模型切换测试；成本上限测试；脱敏审计；真实或沙箱 Provider fixture。
- **风险/回滚边界**：财务与风控数据；成本账本只追加，套餐调整通过新版本生效，不改写历史价格。

### LM3-15：支付激活 Saga 与 Outbox

- **目标**：让支付成功到订阅激活、额度账户创建和事件投递具备明确状态机与补偿路径。
- **主要范围**：billing transaction/outbox、relay、quota RPC、activation states、jobs、events。
- **不在范围**：具体微信/支付宝 SDK。
- **内部 checklist**：事务内写 order/payment/subscription/outbox；事务外同步幂等创建 token account；成功标 active；失败标 quota_pending/activation_failed；relay 重启续投；consumer 幂等和补偿。
- **验收**：不存在 DB/MQ dual-write 窗口；付费成功后额度可用或进入可追踪异常；重复回调/事件不重复激活。
- **验证**：Saga 状态机测试；outbox 崩溃重启测试；quota 不可达故障测试；重复事件测试；Compose 集成测试。
- **风险/回滚边界**：跨服务核心交易；按状态机版本兼容部署，禁止跨服务事务和删除异常记录。

### LM3-16：订阅全生命周期

- **目标**：完整支持续期、取消、恢复、升级、降级和退款，并保留权益调整审计。
- **主要范围**：billing/quota biz、quota_adjustments、scheduled change、jobs、API/SDK。
- **不在范围**：支付渠道验签实现。
- **内部 checklist**：升级立即生效并记 adjustment；降级下周期生效；取消与退款分离；续期创建新周期快照；退款已用额度规则显式建模；失败补偿和人工入口。
- **验收**：所有状态转换可追溯、幂等；历史周期不被覆盖；退款不会留下无法解释的 quota 状态。
- **验证**：状态转换表测试；时间边界测试；重复续期/退款测试；billing-quota 集成测试；`go test ./...`。
- **风险/回滚边界**：订阅和额度双账本；新状态先向后兼容，回滚不得篡改历史调整。

### LM3-17：微信支付沙箱

- **目标**：通过独立 webhook ingress 完成微信支付下单、验签、幂等和服务端确认。
- **当前状态（2026-07-13）**：实现、迁移、测试、Kong/Compose/Helm 接线和运行手册已合入并以默认关闭的 feature flag 发布。项目所有者已明确授权跳过真实微信支付沙箱的付款→回调→额度激活演练，因此本 loop 按已交付的软件边界标记为 `done`；没有使用或记录真实商户证书、APIv3 key、付款或回调。该豁免不构成真实渠道开通、真实付款或生产支付证据；若未来开启该渠道，仍必须先完成本节的官方沙箱 E2E。
- **主要范围**：billing provider adapter、webhook ingress、Kong route、原始 body、沙箱配置。
- **不在范围**：支付宝、生产商户切换。
- **内部 checklist**：创建支付订单；验证签名/时间戳/nonce；保存 provider event inbox；主动查询确认；接入 Saga；补沙箱 E2E 和运行手册。
- **验收**：客户端成功提示不能激活订阅；重复/伪造/过期 webhook 被安全处理；已按所有者授权跳过真实沙箱付款激活演练。
- **验证**：签名 fixture；重放/篡改测试；Kong 原始 body 检查；隔离 PostgreSQL 集成测试；真实沙箱 E2E 已豁免，且未作为渠道开通证据。
- **风险/回滚边界**：外部支付渠道；可关闭 provider route 回滚，保留订单、webhook 和审计数据。

### LM3-18：支付宝沙箱

- **目标**：通过独立 webhook ingress 完成支付宝下单、验签、幂等和服务端确认。
- **当前状态（2026-07-13）**：实现、测试、Kong/Compose/Helm 接线和运行手册已合入并以默认关闭的 feature flag 发布。项目所有者已明确授权跳过真实付款后进入后续 loop；因此本 loop 按已交付的软件边界标记为 `done`，没有使用或记录真实支付宝沙箱密钥、付款或公网回调。该豁免不构成真实渠道开通、真实付款或生产支付证据；若未来开启该渠道，仍必须先完成本节的官方沙箱 E2E。
- **主要范围**：billing provider adapter、webhook ingress、Kong route、原始 body、沙箱配置。
- **不在范围**：微信支付、生产商户切换。
- **内部 checklist**：创建支付订单；验证支付宝签名和通知参数；保存 provider event inbox；主动查询确认；接入 Saga；补沙箱 E2E 和运行手册。
- **验收**：重复/伪造 webhook 不重复激活；渠道故障不污染其他渠道；已按所有者授权跳过真实沙箱付款激活演练。
- **验证**：签名 fixture；重放/篡改测试；原始 payload 审计；隔离 PostgreSQL 集成测试；真实沙箱 E2E 已豁免，且未作为渠道开通证据。
- **风险/回滚边界**：外部支付渠道；与微信适配器独立开关、发布和回滚。

### LM3-19：三方对账与人工处理

- **目标**：能从支付平台、billing 和 quota 重建订单、订阅与额度状态并处理差异。
- **主要范围**：billing/quota jobs、reconciliation records、reporting、人工处理 API。
- **不在范围**：Admin UI 完整实现。
- **内部 checklist**：定时拉取渠道账单；比对 order/payment/subscription/token_account；记录差异而非静默覆盖；提供重试/退款/冻结/人工确认动作；生成对账审计和指标。
- **验收**：任意异常订单可说明支付、订阅、额度各自状态和下一步；修复动作幂等且有操作者记录。
- **验证**：缺单、重复单、金额不符、额度缺失 fixture；job 重跑测试；对账报表人工核验。
- **风险/回滚边界**：财务修复；自动动作必须有阈值和开关，人工修正只追加审计记录。
- **完成边界（2026-07-13）**：已交付本地支付账本、订阅快照、quota 精确周期账户与已验证 webhook/query 证据的定时对账；真实微信/支付宝商户账单拉取、真实退款与真实沙箱付款，按所有者“跳过真实付款”授权明确豁免，未被当作已验证的渠道结算或生产支付证据。详见 [LM3-19 运行手册](./LM3-19-三方对账与人工处理.md)。

### LM3-20：账本与支付安全 Gate

- **目标**：以独立 Gate 证明 billing/quota/ai-gateway 的关键写路径满足架构并发与一致性门槛。
- **主要范围**：三领域测试、Compose E2E、race/pressure fixture、文档验收记录。
- **不在范围**：新业务功能。
- **内部 checklist**：覆盖重复 webhook/结算、额度不足、预扣过期、超额 usage；覆盖 Saga 补偿和对账；执行两支付沙箱；验证账本快照和审计；更新 D-005/D-006 状态。
- **验收**：所有关键失败模式都有自动测试或可复现演练；Gate 失败会阻止真实支付和 Cloud AI 发布。
- **验证**：`go test -race ./...`；领域集成测试；`make platform-e2e`；支付沙箱 E2E；并发额度压测报告。
- **风险/回滚边界**：验证 Gate；不为通过测试修改生产规则，失败时回到对应能力 loop 修复。
- **完成边界（2026-07-13）**：全量 race 与全套隔离领域集成 Gate 已通过；真实付款按所有者授权跳过，且 Compose E2E 因既有用户栈缺失 PostgreSQL 未运行，二者继续作为真实支付/部署发布阻断项，不据此宣称生产就绪。详见 [LM3-20 Gate 记录](./LM3-20-账本与支付安全Gate.md)。

### LM3-21：全链路 Trace 与安全日志

- **目标**：让一次支付或 AI 请求可通过 trace_id 跨 Kong、BFF、gRPC、MQ 和 worker 定位，且日志不泄密。
- **主要范围**：OTel SDK/Collector、Jaeger、HTTP/gRPC/MQ propagation、JSON logs、Fluent Bit/OpenSearch。
- **不在范围**：全部业务告警看板。
- **内部 checklist**：入口生成/透传 trace；gRPC/MQ 传播；Provider span；统一日志字段；日志脱敏和内容最小化；OpenSearch 生产安全配置。
- **验收**：支付 Saga 和 AI 预扣/Provider/结算各能形成单条完整 trace；日志按 service+trace_id 可检索且无凭据/正文。
- **验证**：Compose trace smoke；日志字段断言；敏感信息 grep/自动测试；Jaeger/OpenSearch 人工检查。
- **风险/回滚边界**：共享 middleware 与数据泄露风险；回滚采集时保留应用功能，禁止用关闭脱敏换取可观测性。
- **完成边界（2026-07-13）**：应用侧 HTTP/gRPC/MQ/Provider trace、JSON 安全日志、loopback 开发观测栈和自动化 smoke 均已交付，完整 Go/race 回归通过。既有用户 Compose 栈的 `localhost:8000` 拒绝连接，故健康栈的 Jaeger/OpenSearch runtime 验证尚未取得；它仍是支付或部署发布前的阻断项，不据此宣称生产就绪。详见 [LM3-21 记录](./LM3-21-全链路Trace与安全日志.md)。

### LM3-22：指标、看板、告警与错误聚合

- **目标**：让系统和商业异常能够被主动发现并关联到 trace。
- **主要范围**：Prometheus、Grafana、Sentry/同类、业务指标、告警规则、运行手册。
- **不在范围**：自动财务修正。
- **内部 checklist**：覆盖 QPS/延迟/错误率/连接池/队列；支付成功率、quota 拒绝、outbox 堆积；Provider 延迟和成本；配置告警阈值；错误聚合关联 trace_id。
- **验收**：模拟支付失败、outbox 堆积、Provider 超时和成本突增均能触发可操作告警。
- **验证**：Prometheus target 检查；Grafana dashboard smoke；告警注入测试；Sentry 脱敏事件检查。
- **风险/回滚边界**：告警噪声和隐私；看板/告警可独立回滚，不删除历史指标或关闭安全脱敏。
- **完成边界（2026-07-13）**：已交付受限标签的 Prometheus 指标、延迟直方图、Grafana 自动看板、11 条带运行手册的告警规则以及 Sentry 同类错误聚合。`promtool` 规则注入测试证明模拟支付失败、outbox 堆积、Provider 超时和成本突增会进入 firing；完整 Go/race、事件契约、Compose/Helm 渲染和静态看板门禁均已通过。既有用户 Compose 栈仍无法在 `localhost:8000` 提供服务，因此未把 Prometheus Targets、Grafana 实例或 OpenSearch/Jaeger 的运行态检查伪称为完成；恢复健康栈后必须按 [LM3-22 运行手册](./LM3-22-指标告警与错误聚合.md)补跑，作为部署/真实付款前阻断项。

### LM3-23：弹性、降级与舱壁

- **目标**：防止单个下游或模型故障引发级联故障或绕过额度保护。
- **主要范围**：gRPC interceptors、BFF、ai-gateway pools、jobs retry、降级缓存。
- **不在范围**：Kubernetes HPA。
- **内部 checklist**：所有 RPC deadline；仅幂等查询退避重试；下游熔断；quota/auth/billing/MQ 降级策略；模型独立连接池和并发舱壁；`Retry-After` 语义。
- **验收**：quota 不可达时 AI 被拒绝；auth 不可达不绕过验证；MQ 不可达不丢 outbox；慢 Provider 不拖垮其他模型。
- **验证**：故障注入集成测试；超时/熔断/半开测试；连接池并发测试；Compose chaos smoke。
- **风险/回滚边界**：共享调用链；各策略可配置关闭，但不得配置为绕过安全和额度检查。

### LM3-24：Web 账号与付费体验

- **目标**：让用户在 Web 完成真实账号、套餐、订单、支付、订阅和用量管理。
- **主要范围**：Web 页面/components、Web BFF、SDK、邮箱验证/恢复、下载入口。
- **不在范围**：Desktop Cloud AI 实现。
- **内部 checklist**：完成注册验证和找回密码；正式定价/下载页；订单/订阅/取消/恢复/升降级；支付异常恢复；余额/趋势/账单展示；错误关联 trace_id。
- **验收**：真实用户可从注册走到沙箱支付、查看额度、管理订阅和下载桌面端；不再有 billing/download placeholder。
- **验证**：`pnpm lint && pnpm typecheck && pnpm build:web`；Web BFF E2E；浏览器桌面/移动宽度 smoke；支付失败/过期状态检查。
- **风险/回滚边界**：用户可见商业流程；页面可灰度，不能回退认证与账本安全规则。

### LM3-25：桌面本地凭据迁移到 Keychain

- **目标**：让用户自填模型和视频 Provider API Key 只保存在系统凭据库，并安全迁移既有记录。
- **主要范围**：Electron main secrets、模型/视频配置、DB migration marker、设置页、诊断。
- **不在范围**：平台 Cloud AI refresh token 和 PKCE。
- **内部 checklist**：建立 macOS/Windows/Linux Keychain adapter；迁移可逆旧凭据；DB 只留引用/掩码；renderer 永不收到明文；失败保留原数据并可重试；补健康检查和恢复说明。
- **验收**：新保存 API Key 不进入 SQLite 明文字段或 renderer；旧凭据迁移可审计、可回滚且不泄密。
- **验证**：secret 单测；旧库 fixture；Electron smoke；DB/日志/诊断包敏感信息扫描；跨平台 package smoke。
- **风险/回滚边界**：本地凭据数据迁移；删除旧值前必须确认 Keychain 写入成功，失败不得破坏用户配置。

### LM3-26：Desktop BFF 与 PKCE 登录

- **目标**：让桌面端通过系统浏览器和一次性授权码安全登录云端套餐。
- **主要范围**：Desktop BFF proto/app、auth code/PKCE、Web callback、Electron main、Keychain session。
- **不在范围**：实际 AI Provider 调用。
- **内部 checklist**：独立 Desktop BFF；生成 verifier/challenge/state；系统浏览器登录；短 TTL 单次 code；校验 state 后换 token；refresh 存 Keychain/access 存内存；登出和撤销。
- **验收**：Desktop 不使用 WebView、不在回调 URL 传长期 token；重放 code、错误 state/verifier 均失败；正常登录可查询套餐和余额。
- **验证**：PKCE 单元/集成测试；Electron auth E2E；协议/localhost callback 安全测试；日志和 renderer 状态扫描。
- **风险/回滚边界**：跨端认证协议；可关闭 Desktop cloud login 回滚，本地创作必须继续工作。

### LM3-27：桌面 Cloud AI 商业纵切

- **目标**：让桌面用户可选择 DramaIP Cloud Provider，并完成预检、AI 调用、额度结算与余额刷新。
- **主要范围**：Desktop BFF、AI Gateway contract、Electron provider、模型设置、上下文最小化、余额 UI。
- **不在范围**：云同步项目数据库。
- **内部 checklist**：增加 Cloud Provider；提供模型列表/上下文预检；生成 idempotency key；经 Kong/BFF 调 AI；结算后刷新余额；网络故障时保留本地 BYOK/编辑能力。
- **验收**：登录用户无需平台 API Key 即可完成一次真实/沙箱 AI 调用；请求可从桌面追踪到成本与 quota；离线不影响本地项目。
- **验证**：Desktop BFF E2E；Electron E2E；AI Provider 失败/超时/断流测试；`pnpm test`；平台 E2E；最小上下文人工审查。
- **风险/回滚边界**：平台成本与桌面主流程；Cloud Provider 可 feature flag 回滚，不修改本地项目可信源。

### LM3-28：Mobile 安全登录与精简账户视图

- **目标**：让移动端通过独立 BFF 安全登录并查看最小账户、套餐和余额信息。
- **主要范围**：Mobile BFF proto/app、Expo auth、Keychain/Keystore、brief API。
- **不在范围**：完整长文、分镜、视频和复杂版本管理。
- **内部 checklist**：独立 Mobile BFF；移动安全存储；登录/刷新/登出；`/v1/me/brief` 精简视图；离线/过期提示；端 E2E。
- **验收**：移动端不复用 Web BFF service；refresh token 不进 AsyncStorage；弱网和 token 过期行为可恢复。
- **验证**：Mobile type/lint/test；iOS/Android smoke；Mobile BFF E2E；凭据存储检查。
- **风险/回滚边界**：新端认证；移动端可独立关闭，不影响 Web/Desktop。

### LM3-29：Mobile 灵感、草稿与桌面接续

- **目标**：让移动用户记录轻量灵感/草稿、AI 快速扩写，并安全接续到桌面端。
- **主要范围**：Mobile UI/BFF、draft/sync API、Desktop inspiration import、冲突/离线队列。
- **不在范围**：通用项目云同步和正文自动合并。
- **内部 checklist**：文字/语音灵感；人物/项目草稿；AI 快速扩写；离线队列；同步到桌面灵感台；重复和冲突采用规则。
- **验收**：移动记录可在桌面显式查看和采用；不会静默覆盖桌面正文；重复同步幂等。
- **验证**：Mobile/Desktop 联合 E2E；离线重放和重复同步测试；隐私/内容最小上传检查。
- **风险/回滚边界**：跨端数据；只同步轻量草稿，回滚停止同步但保留本地数据和服务端审计。

### LM3-30：Admin BFF、独立认证与 RBAC

- **目标**：建立与 C 端完全分离的管理员身份、权限、审计和操作确认边界。
- **主要范围**：admin proto/app、管理员认证、RBAC、audit log、Kong/internal ingress。
- **不在范围**：完整后台 UI。
- **内部 checklist**：独立 admin principal/token；角色/权限；敏感操作二次确认；不可篡改审计；调用领域 API/reporting；禁止 C 端 JWT 访问。
- **验收**：普通用户 token 无法调用 admin；权限不足被拒绝；所有状态变更记录操作者、原因、trace 和前后状态。
- **验证**：认证/RBAC 矩阵测试；越权测试；审计完整性测试；Admin BFF E2E。
- **风险/回滚边界**：高权限安全域；可关闭管理写操作回滚，审计记录不可删除。

### LM3-31：管理后台与 Reporting Read Model

- **目标**：让运营人员在不跨 schema JOIN 的前提下查询和处理用户、订阅、额度、成本与异步异常。
- **主要范围**：`clients/apps/admin`、reporting/read-model、Admin BFF、表格/图表。
- **不在范围**：自动更改财务账本历史。
- **内部 checklist**：用户/订阅/订单/退款；额度/AI 成本；webhook/outbox/MQ/补偿排查；实时 BFF 编排与异步聚合边界；操作确认和审计 UI。
- **验收**：后台不部署在 C 端 Web；跨域查询不直连领域表；异常事件可定位并进入受控处理流程。
- **验证**：Admin lint/type/build/test；read-model 重建测试；Admin BFF E2E；RBAC/审计人工 smoke。
- **风险/回滚边界**：运营高权限和投影一致性；读模型可重建，管理写操作可独立禁用。

### LM3-32：生产部署、密钥与发布流水线

- **目标**：用同源镜像、受控密钥和自动流水线部署可灰度、可回滚的平台。
- **主要范围**：Dockerfile、K8s、Helm、Kong、External Secrets/Vault/KMS、CI/CD、HPA。
- **不在范围**：数据库灾备演练结果。
- **内部 checklist**：统一 TARGET 构建；dev/staging/prod values；probe/resources/HPA；内部 mTLS；生产 secret 注入；TLS/Kong 限流；镜像扫描、推送、灰度和回滚。
- **验收**：staging 可从空集群自动部署；镜像和 Git 不含密钥；服务健康、限流、mTLS 和回滚可验证。
- **验证**：容器构建；Helm lint/template；staging deploy smoke；secret/image layer 扫描；canary/rollback 演练。
- **风险/回滚边界**：生产发布；数据库 migration 与应用发布分离，使用向后兼容迁移和显式回滚计划。

### LM3-33：PostgreSQL 灾备与恢复

- **目标**：确保订单、支付、订阅和 token 账本在事故后可按明确 RPO/RTO 恢复。
- **主要范围**：PostgreSQL HA、全量/WAL backup、PITR、加密、异地存储、运行手册。
- **不在范围**：桌面本地 SQLite 备份。
- **内部 checklist**：定义 RPO/RTO；自动全量+增量/WAL；备份加密与保留；PITR；隔离环境自动恢复验证；账本一致性核对。
- **验收**：从生产等价备份恢复到目标时间点，支付/billing/quota 对账通过；恢复耗时满足目标。
- **验证**：完整恢复演练；PITR 演练；备份损坏告警测试；恢复后平台 E2E 和三方对账。
- **风险/回滚边界**：事故级数据；演练只在隔离环境执行，禁止以未验证备份覆盖权威库。

### LM3-34：核心平台生产就绪 Gate

- **目标**：证明 Web 付费、Desktop Cloud AI、平台账本、安全、运维和灾备满足正式生产门槛。
- **主要范围**：全仓验证、真实支付沙箱、真实 Provider、并发/故障/恢复、发布文档。
- **不在范围**：云同步、市场、知识库和团队租户。
- **内部 checklist**：标准注册→支付→额度→AI→用量→刷新/登出 E2E；各端 BFF E2E；支付/Provider 故障；并发额度压测；恢复演练；安全/依赖/secret 扫描；发布与回滚说明。
- **验收**：技术架构第 15 节所有适用于核心平台的门槛有证据；未完成 P2/P3 不影响本地模式；生产阻断项为零。
- **验证**：两端完整测试；Compose/staging E2E；支付沙箱；真实 Provider 失败/超时；压测；PITR；人工安全 review。
- **风险/回滚边界**：发布 Gate；任何核心门槛失败均不得标 done 或正式发布。

### LM3-35：本地优先云同步与冲突处理

- **目标**：让用户显式选择同步创作数据，并在冲突时保持本地可信源和人工控制。
- **主要范围**：sync service/contracts、Desktop/Mobile、版本/冲突记录、加密与审计。
- **不在范围**：公共资源市场和多人实时协作。
- **内部 checklist**：定义同步数据边界；增量/幂等同步；正文/剧本冲突人工合并；元数据可采用明确 LWW 规则；离线队列；删除传播和恢复；API Key 永不同步。
- **验收**：离线编辑、双端修改和重复上传不丢数据；正文冲突不静默覆盖；用户可关闭同步并导出数据。
- **验证**：多端冲突 fixture；离线重放；删除/恢复；加密和权限测试；Desktop/Mobile E2E。
- **风险/回滚边界**：用户创作资产；同步服务可关闭，回滚不得删除本地副本或自动解决未确认冲突。

### LM3-36：受控资源市场

- **目标**：交付可审核、可版本化、可追责的模板/Skill/资源包市场。
- **主要范围**：resource package schema、market service/Admin、审核、授权、Desktop import。
- **不在范围**：上传第三方原文、绕过版权或公共模型训练。
- **内部 checklist**：签名/版本/依赖；作者与授权信息；审核和下架；安全扫描；购买/授权记录；本地导入预览和可回滚安装。
- **验收**：未审核或被下架资源不能公开分发；安装不会静默覆盖项目内容；版权和来源可追溯。
- **验证**：package/schema 测试；恶意资源 fixture；审核/RBAC E2E；安装/卸载/升级 smoke。
- **风险/回滚边界**：供应链与版权；市场可整体关闭，已安装资源保留本地可审计版本。

### LM3-37：私有知识库与语义检索

- **目标**：让用户对自有资料建立私有、可删除、可控 Provider 使用的知识检索能力。
- **主要范围**：ingestion、chunk/index、retrieval、权限、Desktop context preview、retention。
- **不在范围**：公共盗版内容库或默认上传全部项目。
- **内部 checklist**：显式导入；租户/用户隔离；来源引用；索引重建/删除；上下文预览和排除；Provider 白名单/不留存选项；成本与用量记录。
- **验收**：用户只能检索自己的库；删除后索引和源数据按策略清理；AI 请求能解释使用了哪些片段。
- **验证**：权限隔离测试；删除/重建测试；检索质量 fixture；上下文最小化和 Provider 策略审查。
- **风险/回滚边界**：隐私与索引一致性；关闭检索不影响原始本地项目，索引可重建。

### LM3-38：团队租户与计费归属

- **目标**：建立全局用户、租户成员关系和个人/团队计费归属三层模型。
- **主要范围**：tenant/membership、RBAC、account scope、billing/quota/usage、Admin/Web。
- **不在范围**：多人实时文档协作算法。
- **内部 checklist**：tenant/membership schema；邀请/移除/角色；个人与团队 account scope；订单/订阅/额度/usage 归属；席位/用量策略；跨租户隔离和审计。
- **验收**：同一用户可加入多个团队；资源和账本不跨租户泄露；计费归属可完整对账。
- **验证**：多租户权限矩阵；跨租户越权测试；团队订阅/额度 E2E；migration 和历史个人账号兼容测试。
- **风险/回滚边界**：身份和账本模型迁移；个人账号保持兼容，团队能力可 feature flag 关闭。

### LM3-39：隐私、内容与个人数据生命周期

- **目标**：让云端内容、身份和审计数据具有明确采集目的、保留期、导出、删除和 Provider 政策。
- **主要范围**：retention policy、用户导出/删除、审计最小化、协议、Provider policy、跨境说明。
- **不在范围**：替代正式法律意见。
- **内部 checklist**：数据分类和保留期；用户导出/删除路径；日志/trace/request audit 最小化；Provider 训练/留存/跨境配置；企业白名单；备份删除例外说明和审计。
- **验收**：每类云端数据能回答为何采集、保存多久、如何导出/删除；用户协议与实际 Provider 配置一致。
- **验证**：数据流审查；删除/导出 E2E；日志/备份抽样；隐私与安全人工 review；合规清单签字。
- **风险/回滚边界**：法律与用户权利；策略变更版本化，不删除法定必须保留的审计数据但需明确隔离和期限。

### LM3-40：LOOPMAP3 全量平台化 Gate

- **目标**：证明核心商业平台和选择上线的平台化能力均满足架构、产品、安全、数据和发布要求。
- **主要范围**：全仓、全部已启用端、文档、部署、灾备、合规、发布说明。
- **不在范围**：尚未决定上线且有明确 feature flag 的未来实验能力。
- **内部 checklist**：复核 D-001～D-011 退出条件；复核技术架构第 15 节；全量回归；生产配置/secret/依赖扫描；灾备和对账；各端发布说明、兼容窗口和回滚预案。
- **验收**：所有计划上线 loop 为 done；未上线能力有清晰关闭状态且不破坏架构红线；差异文档只保留完成记录或真实剩余差距。
- **验证**：根级全量 Gate；各端 E2E；生产 smoke；支付/AI/同步/租户关键路径；安全、隐私、财务、SRE 联合 review。
- **风险/回滚边界**：最终发布 Gate；任一生产红线无证据则保持 todo/partial，不得以文档声明替代验证。

## 7. 推荐执行批次

### Batch A：绿色主干与契约基线

顺序：LM3-00 → LM3-01 → LM3-02 → LM3-03。

完成结果：文档可信、Go 测试恢复、Web BFF 目标路径落地、两端 CI 可阻断回归。

### Batch B：契约与安全底座

顺序：LM3-04 → LM3-05 → LM3-06 → LM3-07。

LM3-04 与 LM3-05 在 LM3-03 后可分别准备，但必须逐 loop 闭环，不并行修改同一目标分支。

完成结果：事件契约、生产签名、Web 会话和内部身份达到安全基线。

### Batch C：领域与数据自治

顺序：LM3-08 → LM3-09 → LM3-10。

完成结果：BFF 不再直连 notification 表，通知异步闭环建立，DB 权限强制服务边界。

### Batch D：账本、支付与对账

建议顺序：

1. LM3-11 → LM3-12 → LM3-13 → LM3-14。
2. LM3-15 → LM3-16。
3. LM3-17、LM3-18 分别闭环。
4. LM3-19 → LM3-20。

完成结果：套餐、订阅、额度、AI 请求、Provider 成本、真实支付和对账可审计、可幂等、可补偿。

### Batch E：可观测性与可靠性

顺序：LM3-21 → LM3-22 → LM3-23。

完成结果：关键链路可追踪、异常可告警、下游故障不会绕过安全或造成级联故障。

### Batch F：多端商业纵切

建议顺序：

1. LM3-24 完成 Web 账号与付费体验。
2. LM3-25 → LM3-26 → LM3-27 完成桌面 Cloud AI。
3. LM3-28 → LM3-29 完成移动轻创作。
4. LM3-30 → LM3-31 完成管理后台。

Mobile/Admin 不阻塞 Web + Desktop 的首个付费内测，但任何端上线前必须完成自己的 BFF 和 E2E。

### Batch G：生产部署与核心发布 Gate

顺序：LM3-32 → LM3-33 → LM3-34。

完成结果：核心商业平台可灰度部署、可回滚、可恢复，并通过真实沙箱和故障验证。

### Batch H：平台化能力

建议顺序：LM3-35 → LM3-36 / LM3-37 → LM3-38 → LM3-39 → LM3-40。

资源市场、知识库和团队能力必须分别闭环；任何一个外部依赖阻塞时，不影响其他已独立验收能力。

## 8. 验证策略矩阵

| 变更类型 | 最小验证 | 扩展验证 |
| --- | --- | --- |
| 文档/路径 | `git diff --check`、链接检查 | 命令和相对路径人工执行 |
| Proto/Event/SDK | `buf lint`、生成物检查 | breaking check、producer/consumer 兼容测试 |
| Go 领域逻辑 | 相关 package test | `go test -race ./...`、数据库/Compose 集成 |
| DB migration/role | migration replay、权限测试 | 旧数据 fixture、平台 E2E、回滚/兼容演练 |
| Auth/Security | 单元与负向测试 | Kong/BFF/E2E、越权、重放、凭据扫描 |
| Billing/Quota/AI | 状态机与幂等测试 | 并发压测、故障注入、支付/Provider 沙箱 |
| Web/Admin | lint、typecheck、build | 浏览器 E2E、RBAC/支付状态 smoke |
| Desktop | format、typecheck、unit | DB、Electron E2E、package smoke、Keychain 检查 |
| Mobile | lint、typecheck、test | iOS/Android smoke、弱网/离线/安全存储 |
| Observability | 配置检查、字段测试 | trace/log/metric/alert 故障注入 |
| K8s/Release | Helm lint/template、镜像扫描 | staging deploy、canary、rollback、PITR |

## 9. 完成定义

每个 loop 只有同时满足以下条件才能标记为 `done`：

1. 单一目标和内部 checklist 已完成，范围无未解释扩散。
2. 验收标准逐项有证据。
3. 风险匹配的本地/集成/人工验证通过，无法运行项有原因和替代检查。
4. `git diff --check` 和累计 diff 审查通过，无凭据、缓存、构建产物或无关改动。
5. 变更已在专用 loop 分支提交。
6. 目标分支在开始前和合并前均已同步远端。
7. 已合并回目标分支并重跑必要验证。
8. 目标分支已成功推送，且与远端无未解释 ahead/behind。
9. loop 分支已安全清理；如保留，已记录原因、位置和责任人。
10. 第 10 节已追加完成记录，并按需更新《差异演进》和相关运行文档。

任何代码已写但未满足验证、推送或清理要求的 loop，状态只能是 `partial`。

## 10. 完成记录区

本节只追加，不覆盖历史。除已完成的 loop 外，其余规划 loop 保持 `todo`，不得因计划存在而提前标记完成。

完成后使用以下模板：

```text
Loop:
Target branch:
Loop branch:
Commit(s):
Merge commit:
Verification:
Diff review:
Remote sync:
Push:
Loop branch cleanup:
Current branch/worktree:
Notes:
```

```text
Loop: LM3-00
Target branch: main
Loop branch: loop/lm3-00-doc-baseline
Commit(s): 59b3900 loop(LM3-00): establish documentation baseline; this completion-record update is the loop's final metadata commit.
Merge commit: 7b83af6 merge: LM3-00 documentation baseline; the metadata commit is merged immediately after this record is committed.
Verification: Before merge, `git diff --check main...HEAD` passed. After merge, `git diff --check origin/main...HEAD` passed; a Node relative-link resolver checked 24 Markdown files; an active-link scan found no Markdown link targeting `docs/process`, `./process`, or `../process`.
Diff review: Reviewed the staged name/status list, root README, document indexes, ROADMAP link, difference-document date note, LOOPMAP3, and the moved LOOP documents. The `docs/process` references that remain are explicitly documented historical execution records, not active Markdown links. No credentials, local environment files, caches, or build artifacts were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` reported main aligned before the loop branch was created; the target branch was fetched and confirmed aligned again before merge.
Push: Core documentation merge 7b83af6 was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-00 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete this branch with `git branch -d loop/lm3-00-doc-baseline` immediately afterward.
Current branch/worktree: loop/lm3-00-doc-baseline; clean before this metadata update.
Notes: LM3-00 moved active process documentation into `docs/loop`, added the root project entry point, repaired active links, retained historical audit paths without rewriting history, and refreshed the difference-document audit date. No product code or deployment configuration changed.
```

```text
Loop: LM3-01
Target branch: main
Loop branch: loop/lm3-01-v1-contract
Commit(s): 8d25eb8 loop(LM3-01): enforce versioned platform routes; this completion-record update is the loop's final metadata commit.
Merge commit: bfff443 merge: LM3-01 versioned platform routes; the metadata commit is merged immediately after this record is committed.
Verification: `GOCACHE=/tmp/dramaip-go-build go test ./app/bff/interface/internal/service` passed before merge; `GOCACHE=/tmp/dramaip-go-build go test ./...` passed before and after merge; `pnpm typecheck` passed before and after merge in `clients`; `make web-route-smoke` passed before and after merge. The BFF test suite now includes v1 success paths and a negative test that unversioned business paths return 404. `git diff --check` passed before and after merge.
Compose E2E: attempted `make platform-up` twice (once normally and once with `COMPOSE_PARALLEL_LIMIT=1`). Both attempts reached the nine Docker `go build` layers and produced no further output or containers for several minutes, so both were interrupted and followed by `make platform-down`. The failed environment build did not modify the working tree. This is recorded as an LM3-03 DevEx/CI follow-up; the direct BFF, SDK, route-smoke, and documentation contract checks above are the replacement evidence for this loop.
Diff review: Reviewed the cumulative four-file diff: BFF tests use `/v1`, unversioned paths have explicit negative coverage, and README/operational/API baseline docs describe the same versioned endpoints. No credentials, environment files, generated artifacts, or unrelated files were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` succeeded before branch creation and again before merge.
Push: Core merge bfff443 was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-01 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete this branch with `git branch -d loop/lm3-01-v1-contract` immediately afterward.
Current branch/worktree: loop/lm3-01-v1-contract; clean before this metadata update.
Notes: `/billing` remains only as a Web UI route, not an external API path. The Compose build stall is an operational limitation, not evidence that an unversioned route remains exposed.
```

```text
Loop: LM3-02
Target branch: main
Loop branch: loop/lm3-02-web-bff-path
Commit(s): 31f5bba loop(LM3-02): migrate shared BFF to Web path; this completion-record update is the loop's final metadata commit.
Merge commit: e243acc merge: LM3-02 Web BFF path migration; the metadata commit is merged immediately after this record is committed.
Verification: Before merge, `buf generate`, `GOCACHE=/tmp/dramaip-go-build go test ./...`, `pnpm typecheck` in `dramaip-platform/clients`, `make web-route-smoke`, `docker compose --env-file services/.env -f deploy/docker-drama/docker-compose.yaml config --quiet`, Helm lint/template with `devInfra.persistence.enabled=false`, Python launcher compilation, and `git diff --check` all passed. `docker compose ... build web-bff` completed and produced the `dramaip-web-bff` image. After merge, the Go suite, client typecheck, route smoke, Compose config, Helm lint/template, launcher compilation, diff check, and old-path scan passed again.
Contract lint: `buf lint` remains red because the repository-wide package-directory and RPC naming baseline fails in multiple existing services; the migrated Web BFF now has only the shared package-directory finding. This is explicitly owned by LM3-04, which will establish the contract gate and compatible baseline rather than suppressing it here.
Diff review: Reviewed the staged 40-file migration. API/app paths, generated Go package, build target, service labels, Docker Compose, Kong, Prometheus, Helm, Kubernetes launcher, display labels, and docs now consistently use `web-bff`. The old generic BFF paths and identifiers have no active references; remaining historical paths are only prior loop records. Removed the unrelated auth fallback variable rather than carrying a renamed BFF-specific migration toggle. No credentials, local `.env`, caches, or unrelated generated files were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target branch was aligned before the no-ff merge.
Push: Core merge e243acc was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-02 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete this branch with `git branch -d loop/lm3-02-web-bff-path` immediately afterward.
Current branch/worktree: loop/lm3-02-web-bff-path; clean before this metadata update.
Notes: `docs/差异演进.md` now records D-001 as complete for the Web phase and preserves D-004's completed `/v1` test status. The next Desktop/Mobile/Admin loops must create their own mirrored BFF paths and must not reintroduce a generic BFF.
```

```text
Loop: LM3-03
Target branch: main
Loop branch: loop/lm3-03-root-ci
Commit(s): d16f371 loop(LM3-03): establish root CI quality gates; this completion-record update is the loop's final metadata commit.
Merge commit: 76897fb merge: LM3-03 root CI quality gates; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `pnpm lint`, `pnpm typecheck`, and `pnpm build:web` passed in `dramaip-platform/clients`; `make web-route-smoke` passed; `pnpm typecheck`, `pnpm test:unit` (115 tests), `pnpm test:db`, and `pnpm build` passed in `dramaip-desktop`. The root desktop and platform workflow YAML files parsed successfully and `actionlint` accepted both; `git diff --check` passed. The Web and Mobile lint commands now run non-interactively through explicit ESLint configurations, and the desktop CI workflow now runs from the repository root with its working directory set explicitly.
Hosted pipeline: On 2026-07-13 the repository owner explicitly chose ordinary Gitee use and did not request Gitee Go activation or a remote merge gate. No Gitee-hosted workflow run or automatic merge blocking is claimed here. The root `.github` workflows remain version-controlled, syntactically validated CI definitions for compatible hosts or mirrors; their full Compose E2E jobs are limited to scheduled, tag, or manual triggers.
Diff review: Reviewed the root workflow migration, path filters, non-interactive lint configuration, package-lock changes, and documentation baseline. No credentials, local environment files, caches, build outputs, or unrelated files were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target branch was aligned before the no-ff merge.
Push: Pending final metadata merge and push to `origin/main`.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-03-root-ci` immediately afterward.
Current branch/worktree: main; clean before this metadata update.
Notes: This loop completes the requested normal Gitee merge workflow and leaves hosted-pipeline activation as an explicit owner decision, not an unstated prerequisite for future implementation work.
```

```text
Loop: LM3-04
Target branch: main
Loop branch: loop/lm3-04-event-contracts
Commit(s): cbc5c60 loop(LM3-04): establish versioned event contracts; this completion-record update is the loop's final metadata commit.
Merge commit: 525fc6f merge: LM3-04 event contract compatibility gate; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `make event-contracts` passed in `dramaip-platform/services`, running `buf format --diff --exit-code`, `buf lint`, `buf breaking` against `origin/main`, `buf generate`, and generated-output consistency checks. `GOCACHE=/tmp/dramaip-go-build go test ./...` passed, including event-example parsing, compatible unknown-field handling, route/payload validation, and repository migration-version uniqueness. The root platform workflow YAML parsed and `actionlint` passed. A temporary local PostgreSQL database applied billing migrations 003, 007, 011 and 015 around representative pending legacy checkout/payment rows; migration 015 converted both rows into valid envelope shapes, and the temporary database and PostgreSQL container were removed/stopped afterward.
Hosted pipeline: The root workflow now defines the same event-contract gate, but the repository owner explicitly selected ordinary Gitee use. No Gitee Go run or remote automatic merge gate is claimed.
Diff review: Reviewed the event schemas, generated Go output, examples, typed envelope validation, RabbitMQ publisher/relay changes, pending-outbox migration, lint exceptions limited to pre-existing synchronous APIs, workflow setup, and documentation. No credentials, `.env` files, container data, caches, or unrelated artifacts were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target branch was aligned immediately before the no-ff merge.
Push: Pending final metadata merge and push to `origin/main`.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-04-event-contracts` immediately afterward.
Current branch/worktree: main; clean before this metadata update.
Notes: subscription, quota, and notification event contracts plus compatible consumer parsing are delivered here; their future domain-specific producer/consumer business behavior remains in the owning loops (notably LM3-08, LM3-09, LM3-12, and LM3-15).
```

```text
Loop: LM3-05
Target branch: main
Loop branch: loop/lm3-05-jwks-auth
Commit(s): 0fba83e loop(LM3-05): migrate auth to JWKS signing; this completion-record update is the loop's final metadata commit.
Merge commit: 51377f3 merge: LM3-05 JWKS production auth; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `GOCACHE=/tmp/dramaip-go-build go test ./...` and `make event-contracts` passed in `dramaip-platform/services`; the latter runs Buf format/lint/breaking/generated-output checks against `origin/main`. `pnpm typecheck` passed in `dramaip-platform/clients`. Helm lint/template with a mounted auth keyset reference, Docker Compose config, Kong-template YAML parsing, and `git diff --check` passed. Auth tests cover key rotation, issuer/audience/expiry/algorithm/kid rejection, production key-material enforcement, and the JWKS HTTP response. A temporary local PostgreSQL instance executed the refresh-token rotation/reuse/device-revocation integration test and was stopped/removed afterward.
Kong boundary: The normal Gitee repository contains no production private key or generated public-key declaration. `cmd/kong-jwt-config` renders Kong RS256 credentials from the operator-controlled public JWKS; the generated plugin checks `kid`, `exp`, and `nbf`, while Auth/BFF retains issuer, audience, and Redis-session checks.
Diff review: Reviewed the RS256 key loader, strict production configuration, generated API fields, refresh-family transaction, migration, device header propagation, public JWKS route, Kong renderer/template, Helm secret mount, Compose/config examples, and documentation. No private PEM, shared HMAC secret, real environment file, container data, cache, or unrelated artifact was included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target was aligned immediately before the no-ff merge.
Push: Core merge 51377f3 was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-05 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-05-jwks-auth` immediately afterward.
Current branch/worktree: loop/lm3-05-jwks-auth; clean before this metadata update.
Notes: The repository owner explicitly chose normal Gitee usage; no Gitee Go pipeline or hosted merge gate is claimed. Production release still requires an operator to supply the approved RSA private key/JWKS keyset and render/reload Kong according to `deploy/kong/README.md`.
```

```text
Loop: LM3-06
Target branch: main
Loop branch: loop/lm3-06-web-cookie-csrf
Commit(s): f0b826f loop(LM3-06): secure web cookie sessions; this completion-record update is the loop's final metadata commit.
Merge commit: bebd93c merge: LM3-06 Web Cookie sessions; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `GOCACHE=/tmp/dramaip-go-build go test ./...` and `make event-contracts` passed in `dramaip-platform/services`; the BFF suite covers token-free JSON responses, HttpOnly/SameSite/Secure/domain Cookie policy, Cookie refresh/logout clearing, and CSRF rejection. `pnpm lint`, `pnpm typecheck`, and `pnpm build:web` passed in `dramaip-platform/clients`; the platform E2E script now maintains a Cookie jar and sends the CSRF header. Compose configuration, Kong-template YAML parsing, Helm lint/template, and `cmd/kong-jwt-config` tests passed. The renderer configures the production JWT plugin to inspect `dramaip_web_access` and bypass only CORS preflight.
Compose E2E: attempted `COMPOSE_PARALLEL_LIMIT=1 make platform-up`. Docker reached all nine Go image compilation layers, then made no further progress or output for two consecutive 30-second windows; it was interrupted and followed by `make platform-down`, which removed the remaining PostgreSQL container and network. No completed browser/Compose smoke is claimed; the direct BFF Cookie/CSRF tests, client production build, E2E script syntax check, and deployment render checks are the recorded evidence.
Diff review: Reviewed the Web session migration, SDK contract, BFF Cookie/CSRF middleware and tests, production Kong Cookie extraction, credentialed exact-origin CORS, same-origin/controlled-subdomain deployment guardrails, E2E Cookie jar, and architecture/baseline/difference documentation. Legacy JavaScript-readable tokens are only removed once for invalidation; no credential handoff, private key, actual environment file, cache, or unrelated artifact was included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target was aligned immediately before the no-ff merge.
Push: Core merge bebd93c was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-06 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-06-web-cookie-csrf` immediately afterward.
Current branch/worktree: loop/lm3-06-web-cookie-csrf; clean before this metadata update.
Notes: The repository owner explicitly chose normal Gitee usage; no Gitee Go pipeline or hosted merge gate is claimed. Production Web/API deployment must use one public origin or an explicitly configured common Cookie domain covering only controlled sibling subdomains.
```

```text
Loop: LM3-07
Target branch: main
Loop branch: loop/lm3-07-trusted-identity
Commit(s): 9eeee69 loop(LM3-07): enforce trusted service identity; this completion-record update is the loop's final metadata commit.
Merge commit: b5f0a80 merge: LM3-07 trusted service identity; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `GOCACHE=/tmp/dramaip-go-build go test ./...` and `make event-contracts` passed in `dramaip-platform/services`. Platform tests cover fail-closed mTLS configuration, missing client certificate, rejected caller CN, trusted identity metadata propagation, and cross-user rejection. `pnpm lint`, `pnpm typecheck`, and `pnpm build:web` passed in `dramaip-platform/clients`. Docker Compose configuration, Kong declaration YAML parsing, Helm lint, and production/development Helm template YAML parsing passed; the production render was inspected to confirm each workload mounts only its own certificate/key pair plus the shared CA.
Diff review: Reviewed the complete 37-file security diff and `git diff --check` before and after the core merge. Kong strips external `X-User-*` headers; the BFF obtains the propagated user only from a verified Cookie/JWT session; production/unknown environments fail closed without TLS 1.3 mTLS material; service CN allowlists and user/subscription/order/quota/AI ownership checks match the documented boundary. No certificates, private keys, real environment files, caches, or unrelated artifacts were included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target was aligned before branch creation and again immediately before the no-ff core merge.
Push: Core merge b5f0a80 was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-07 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-07-trusted-identity` immediately afterward.
Current branch/worktree: loop/lm3-07-trusted-identity; clean before this metadata update.
Notes: The repository owner explicitly chose normal Gitee usage; no Gitee Go pipeline or hosted merge gate is claimed. The local Compose profile explicitly disables mTLS and is not production evidence; production deployment requires operator-managed per-workload certificates as documented in `deploy/k8s/README.md`.
```

```text
Loop: LM3-08
Target branch: main
Loop branch: loop/lm3-08-notification-service
Commit(s): 39204bf loop(LM3-08): isolate notification service; this completion-record update is the loop's final metadata commit.
Merge commit: ba09eea merge: LM3-08 notification service; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `GOCACHE=/tmp/dramaip-go-build go test ./...` and `make event-contracts` passed in `dramaip-platform/services`. Notification tests cover synchronous create/list/read, source-event idempotency, limit normalization, and invalid/missing records; BFF HTTP tests cover payment-created notifications, list/read endpoints, and trusted user context propagation. `pnpm lint`, `pnpm typecheck`, and `pnpm build:web` passed in `dramaip-platform/clients`. Compose configuration, Kong/Prometheus YAML parsing, Helm lint, production/development Helm template parsing, and Python launcher compilation passed. The rendered chart contains notification Deployment/Service, service discovery, and only its own mTLS certificate/key mount.
Boundary review: `rg 'notification\\.notifications|gorm\\.DB|OpenPostgres' dramaip-platform/services/app/bff` returned no matches. The BFF now only uses notification-service gRPC; notification data ownership, user-resource checks, service CN allowlisting, and existing `source_event_id` uniqueness remain in the notification domain.
Compose E2E: attempted `COMPOSE_PARALLEL_LIMIT=1 make platform-up`; all Go images reached their final build layers but no image or container completed. A separate `docker compose ... build notification` attempt likewise stopped at its final Go build layer and produced no image. `make platform-down` left no containers. Therefore `make platform-e2e` is not claimed; direct Go/BFF tests, client build, static boundary scan, and deployment rendering are the recorded substitute evidence.
Known baseline check: `make web-route-smoke` is currently red on unchanged `origin/main` files because it still requires the removed `getAccessToken()` in login/register pages after the Cookie-session migration. LM3-08 did not alter that script or either page, so this pre-existing assertion is not claimed as a passing check and needs a focused maintenance follow-up.
Diff review: Reviewed the complete 34-file cumulative diff and ran `git diff --check` before and after the core merge. The change contains generated protobuf from the checked-in proto source, no real environment file, certificate, private key, cache, image, or unrelated artifact.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target was aligned before branch creation and again immediately before the no-ff core merge.
Push: Core merge ba09eea was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-08 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-08-notification-service` immediately afterward.
Current branch/worktree: loop/lm3-08-notification-service; clean before this metadata update.
Notes: The repository owner explicitly chose normal Gitee usage; no Gitee Go pipeline or hosted merge gate is claimed. LM3-09 owns the event inbox, RabbitMQ consumer, retry/dead-letter behavior, and delivery channels; this loop deliberately provides only the synchronous notification boundary.
```

```text
Loop: LM3-09
Target branch: main
Loop branch: loop/lm3-09-notification-job
Commit(s): ceb35f6 loop(LM3-09): add notification event consumer; this completion-record update is the loop's final metadata commit.
Merge commit: e169dac merge: LM3-09 notification event consumer; the metadata commit is merged immediately after this record is committed.
Verification: Before and after the core merge, `NOTIFICATION_RABBITMQ_INTEGRATION=1 GOCACHE=/tmp/dramaip-go-build go test ./...` and `make event-contracts` passed in `dramaip-platform/services`. Notification tests cover inbox duplicate suppression, a failing channel retry without a duplicate notification, payment/subscription/quota event mapping, dedicated RabbitMQ topic delivery, bounded retry, and dead-letter arrival. `pnpm lint`, `pnpm typecheck`, and `pnpm build:web` passed in `dramaip-platform/clients`; `node --check scripts/platform-e2e.mjs` passed. YAML parsing, Docker Compose config, Helm lint/template (production and development values), rendered notification-job workload inspection, Python launcher compilation, and the BFF no-cross-schema scan passed. The migration job applied migration 017 to the configured local PostgreSQL instance; a source-run notification-job returned healthy Postgres/RabbitMQ health checks. `make platform-e2e` passed against the existing local platform stack and the E2E script now waits for an asynchronous `payment_succeeded` notification.
Compose limitation: `COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file services/.env -f deploy/docker-drama/docker-compose.yaml build notification-job` reached Docker's final `go build` layer but produced no image or completion line. Therefore the existing-stack E2E is not claimed as an execution of the newly built notification-job/BFF images; source-level worker health and opt-in RabbitMQ integration tests are the direct evidence. The prior `make web-route-smoke` baseline remains stale after the Cookie migration and was not used as LM3-09 evidence.
Diff review: Reviewed the full 40-file cumulative diff and ran `git diff --check` before and after the core merge. The change moves the notification repository to the shared notification-domain boundary, adds only migration 017, preserves BFF table isolation, removes the synchronous payment notification double-write, and contains no real environment file, credential, certificate, private key, image, cache, or unrelated artifact.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target was aligned before branch creation and immediately before the no-ff core merge.
Push: Core merge e169dac was pushed successfully to `origin/main`; this metadata update is pushed as the final LM3-09 loop step.
Loop branch cleanup: Pending final metadata merge and push; delete `loop/lm3-09-notification-job` immediately afterward.
Current branch/worktree: main; clean before this metadata update.
Notes: The repository owner explicitly chose normal Gitee usage; no Gitee Go pipeline or hosted merge gate is claimed. Delivery is at-least-once with an idempotent notification effect, not a message-level exactly-once claim. Current enabled channel is `in_app`; email/SMS require an explicit adapter in a later loop. Billing, quota, reporting, and other non-notification side effects remain outside notification-job.
```

```text
Loop: LM3-10
Target branch: main
Loop branch: loop/lm3-10-db-roles
Commit(s): 9172133 loop(LM3-10): isolate domain database roles
Merge commit: ed69c32 merge: LM3-10 database role isolation
Verification: `GOCACHE=/tmp/dramaip-go-build go test ./...` passed before and after the core merge. `make db-role-matrix` passed against a controlled local PostgreSQL test database, applying every migration, connecting as every runtime login, and requiring an attempted foreign-schema table read to fail. Migration 018 then applied successfully to the local Compose database; all six runtime roles are `NOSUPERUSER`/`NOCREATEROLE`, each Compose workload received its expected role, Web BFF had no `POSTGRES_USER` or `POSTGRES_PASSWORD`, and the auth role reported own-schema usage allowed plus billing-schema usage denied. Docker Compose config and Helm lint/template (with a development host-path override) passed. `make platform-e2e` passed after the role-configured workload recreation. A second post-merge E2E attempt could not run because Docker Desktop became unavailable (`Docker Desktop is unable to start`); it did not indicate an application failure.
Diff review: Reviewed the complete 24-file core diff and ran `git diff --check` before the functional commit and again for `origin/main...HEAD` after the merge. The diff contains no real environment file, password, certificate, private key, cache, image, or unrelated changes. Runtime services use dedicated credentials and fail-closed startup checks; only migration receives the DDL credential set.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed the target branch aligned before the no-ff merge.
Push: Core merge and this completion metadata are pending final push to `origin/main`.
Loop branch cleanup: Pending final metadata push; delete `loop/lm3-10-db-roles` immediately afterward.
Current branch/worktree: main; only this completion metadata and the D-007 status update are uncommitted.
Notes: The repository owner explicitly chose normal Gitee use, so LM3-10 supplies a versioned, manually executable role-matrix gate instead of enabling a hosted pipeline. Runtime roles are PostgreSQL cluster-level identities; the test documentation requires an isolated or explicitly role-rotation-safe test instance. Migration rollback never elevates runtime roles or distributes the DDL password.
```

```text
Loop: LM3-11
Target branch: main
Loop branch: loop/lm3-11-plan-snapshots
Commit(s): 84e9034 loop(LM3-11): snapshot purchased plan entitlements
Merge commit: 66b4359 merge: LM3-11 plan entitlement snapshots
Verification: In a fresh isolated PostgreSQL 18 container, `make plan-snapshot-integration` passed before and after the core merge. It replays migrations 001–018, inserts legacy order/subscription/quota-account data, applies migration 019, verifies all three historical snapshots, then changes the current basic plan after checkout and verifies the new order, subscription and quota account retain their original entitlement. `GOCACHE=/tmp/dramaip-go-build go test ./...`, `GOCACHE=/tmp/dramaip-go-build go test -race ./app/billing/... ./app/quota/...`, the post-merge billing/quota regression, and `make event-contracts` passed. Static boundary review found no `billing.plans` reference in quota code; billing reads it only for current catalogue/checkout capture and the integration test.
Diff review: Reviewed the complete 14-file core diff and ran `git diff --check` before the functional commit and for `origin/main...HEAD` after the no-ff merge. The diff contains generated protobuf from the checked-in proto source, no real environment file, password, certificate, private key, cache, image or unrelated artifact. Migration 019 is additive and preserves old rows; its compatibility triggers label mixed-version fallback rather than reconstructing later from mutable plans.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before the no-ff merge.
Push: Core merge and this completion metadata are pending final ordinary `git push origin main`.
Loop branch cleanup: Pending final metadata push; delete `loop/lm3-11-plan-snapshots` immediately afterward.
Current branch/worktree: main; only this completion metadata and the D-005 status update are uncommitted.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. The controlled PostgreSQL container was bound only to localhost and removed after each test. LM3-11 deliberately does not implement real payment channels or Provider cost ledger work.
```

```text
Loop: LM3-12
Target branch: main
Loop branch: loop/lm3-12-quota-settlement
Commit(s): 0a47081 loop(LM3-12): harden quota reservation settlement
Merge commit: be7e1a0 merge: LM3-12 quota reservation settlement
Verification: `make quota-state-machine-integration` passed before and after the core merge against fresh isolated PostgreSQL 18 containers. It applies every migration including 020 and verifies 10 concurrent 20-token reservations on a 100-token account allow exactly five, duplicate request IDs return the original reservation without changing balance, exact and repeated settlement are idempotent, actual overage records `over_quota_settled` without releasing its reservation, unknown usage remains charged through expiry, a precise retry settles it, a deadline produces `settled_estimate`, a pending reservation rejects cancellation, normal expired leases release quota, and repeated period-account provisioning preserves the original snapshot. The same database state-machine test passed with `-race`; `GOCACHE=/tmp/dramaip-go-build go test -race ./...` and `make event-contracts` passed. After the merge, quota/AI Gateway regression tests and `make event-contracts` passed again.
Diff review: Reviewed the complete 13-file core diff and ran `git diff --check` before the functional commit and for `origin/main...HEAD` after the no-ff merge. The diff contains generated protobuf from the checked-in source, no real environment file, password, certificate, private key, cache, image or unrelated artifact. Migration 020 is additive; no settled usage or reservation history is deleted. Both quota service and quota job call the same native-SQL maintenance functions, preventing expiry/finalization state-machine drift.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before the no-ff merge.
Push: Core merge and this completion metadata are pending final ordinary `git push origin main`.
Loop branch cleanup: Pending final metadata push; delete `loop/lm3-12-quota-settlement` immediately afterward.
Current branch/worktree: main; only this completion metadata update is uncommitted.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. `usage_known=false` is intentionally conservative for old clients: it never converts unknown Provider usage into a one-token charge or an automatic refund. Provider-call idempotency and durable request-audit reconciliation remain LM3-13 work; Provider cost accounting remains LM3-14 work.
```

```text
Loop: LM3-13
Target branch: main
Loop branch: loop/lm3-13-ai-request-idempotency
Commit(s): 6904956 loop(LM3-13): persist AI request idempotency; this completion-record update is the loop's final metadata commit.
Merge commit: f7a6764 merge: LM3-13 AI request idempotency
Verification: Before merge, a fresh localhost-only PostgreSQL 18 container ran `make ai-idempotency-integration`, applying every migration including 021. It verified concurrent same-key suppression, completed replay without a second Provider/quota call, payload mismatch conflict, Redis-unavailable PostgreSQL fallback, prompt exclusion from the audit response summary, and conservative rejection before Provider invocation when PostgreSQL is closed. `GOCACHE=/tmp/dramaip-go-build go test -race ./...`, `make event-contracts`, `pnpm typecheck`, `pnpm build:web`, and `node --check scripts/platform-e2e.mjs` passed. After the no-ff merge, `GOCACHE=/tmp/dramaip-go-build go test -race ./...`, `make event-contracts`, `pnpm typecheck`, the BFF header test, and E2E script syntax check passed again.
Compose E2E: `make platform-up` was attempted after Docker Desktop recovered, but the pre-existing local Compose state had no running `postgres` service and its restarted services could not resolve that hostname. The rebuild reached Docker's Go build layers without producing an updated runnable stack, so `make platform-e2e` is not claimed. The E2E script now contains the durable replay/no-second-quota/conflict assertions; the isolated PostgreSQL integration, direct BFF HTTP test, and static script check are the replacement evidence. Restore a healthy Compose stack and execute `make platform-e2e` before treating it as deployment evidence.
Diff review: Reviewed the 17-file core diff and ran `git diff --check` before commit and for `origin/main...HEAD` after the merge. It contains generated protobuf only from checked-in source, a forward-only migration, test/documentation assets, and no real environment file, password, key, container data, cache, image, or unrelated artifact. Redis remains non-authoritative and its best-effort cache has short timeouts/no retry.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before creating the loop branch and again immediately before the no-ff merge.
Push: Core merge and this completion metadata are pending final ordinary `git push origin main`.
Loop branch cleanup: Pending final metadata push; delete `loop/lm3-13-ai-request-idempotency` immediately afterward.
Current branch/worktree: main; only this completion metadata update is uncommitted.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. Migration 021 preserves old `request_id` callers during the rolling window through its compatibility trigger; it does not delete historical audit records. Provider cost accounting remains LM3-14 work.
```

```text
Loop: LM3-14
Target branch: main
Loop branch: loop/lm3-14-provider-cost-ledger (deleted after the core merge push)
Commit(s): 7da2199 loop(LM3-14): add provider cost ledger
Merge commit: b7a2cdd merge: LM3-14 provider cost ledger
Verification: A fresh localhost-only PostgreSQL 18 container ran `make ai-idempotency-integration` with every migration through 022. It verifies durable replay does not call Provider/Quota twice, the immutable Provider cost row links the request and quota reservation, Redis failure still falls back to PostgreSQL, a sub-cent user window cap rejects before the Provider call, and `user_cost_limit_rejected` is appended. Data tests cover model-specific USD price/CNY exchange snapshots and a different-model provider-level fallback. Before and after the no-ff merge, `GOCACHE=/tmp/dramaip-go-build go test -race ./...`, `make event-contracts`, `pnpm typecheck`, `pnpm build:web`, and `node --check scripts/platform-e2e.mjs` passed. Docker Compose config, Helm lint, production/development Helm rendering (with the required development host-path override), and rendered Kong CORS `Idempotency-Key` assertions passed.
Compose E2E: Not claimed. The pre-existing local Compose stack was left broken after a Docker Desktop restart because services could not resolve its absent `postgres` service; this loop did not stop or delete user-owned containers. The isolated database integration, direct BFF test, deployment renders, and E2E script syntax are the substitute evidence. Restore a healthy stack and run `make platform-e2e` before using it as deployment evidence.
Diff review: Reviewed the complete 20-file functional diff before commit and `origin/main...HEAD` after merge with `git diff --check`. Migration 022 is append-only for cost log/guard/alert data; generated protobuf is derived from checked-in source; no real environment file, credential, provider key, container data, cache, image, or unrelated artifact is included. Cost configuration fails closed for non-test Providers, and the quota ledger remains the sole authority for user quota deduction.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before branch creation and immediately before the no-ff merge.
Push: Core merge b7a2cdd was pushed successfully to ordinary `origin/main`; this completion metadata is the final LM3-14 push.
Loop branch cleanup: Completed after the core merge push.
Current branch/worktree: main; completion metadata and D-006 status update are committed and awaiting the final normal push.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. Test Provider pricing is an explicitly marked fixture only; production must supply reviewed provider/model prices and CNY exchange rates through operator-managed configuration. LM3-22 owns metrics/dashboard/notification integration for the append-only alert source.
```

```text
Loop: LM3-15
Target branch: main
Loop branch: loop/lm3-15-payment-activation-saga (deleted after the core merge push)
Commit(s): ba84fc3 loop(LM3-15): complete payment activation saga
Merge commit: 95e3dcc merge: LM3-15 payment activation saga
Verification: A fresh localhost-only PostgreSQL 18 container ran `make billing-saga-integration` with every migration through 023. It verifies repeated payment confirmation does not create a second payment or payment-success outbox row; a scheduled cancellation preserves `quota_pending`; quota unavailability or a local activation error records an activation failure; a successful, repeated activation produces one active subscription and one `subscription.activated.v1` outbox row. Its relay test models broker acceptance followed by missing publisher confirmation, records the unchanged event ID, expires the first worker lease, and proves a later worker retries and eventually marks all rows published. Before and after the no-ff merge, `GOCACHE=/tmp/dramaip-go-build go test -race ./...` and `make event-contracts` passed. `go generate ./app/billing/job/cmd/server`, `pnpm typecheck`, `pnpm build:web`, Helm lint/development render, and Docker Compose config rendering passed.
Compose/RabbitMQ limitation: Not claimed. The pre-existing local Compose stack remains unhealthy after its Docker Desktop restart because workloads cannot resolve the absent `postgres` service; this loop did not stop or delete user-owned containers. Live RabbitMQ publisher-confirm and full Compose E2E were therefore not run. The isolated PostgreSQL Saga test, fake publisher confirmation-loss/lease-retry test, normal platform-package regression, and deployment render checks are the substitute evidence. Restore a healthy stack and run `make platform-e2e` plus a live RabbitMQ confirm/return test before treating this as deployment evidence.
Diff review: Reviewed the complete 22-file functional diff and ran `git diff --check` before commit and again after the merge. Migration 023 is additive: it adds a leased, retryable outbox claim and a unique subscription-activation event constraint. Activation state and the activation outbox row are written in one billing transaction; the relay marks an event published only after broker confirmation. No real environment file, credential, payment material, private key, cache, image, or unrelated artifact is included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before branch creation and immediately before the no-ff merge.
Push: Core merge 95e3dcc was pushed successfully to ordinary `origin/main`; this completion metadata is committed and awaiting the final normal push.
Loop branch cleanup: Completed after the core merge push.
Current branch/worktree: main; completion metadata is the only pending change.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. The payment transport remains simulated by design; WeChat/Alipay webhook verification belongs to LM3-17/LM3-18, subscription lifecycle and refunds to LM3-16, and operational alert wiring to LM3-22.
```

```text
Loop: LM3-16
Target branch: main
Loop branch: loop/lm3-16-subscription-lifecycle (deleted after the core merge push)
Commit(s): 2f49e87 loop(LM3-16): complete subscription lifecycle
Merge commit: 2c3984c merge: LM3-16 subscription lifecycle
Verification: Fresh localhost-only PostgreSQL 18 containers applied every migration through 025. `make billing-saga-integration` verifies the prior payment/activation saga together with immutable subscription-period snapshots, cancellation/resume, immediate upgrade intent/finalization, and repeated scheduled downgrade identity. `make billing-lifecycle-integration` verifies billing-job's due cancellation and the billing-owned renewal transaction that creates a new `quota_pending` period before quota provisioning. `POSTGRES_QUOTA_STATE_TEST_DSN=... go test ./app/quota/service/internal/data -run '^TestQuotaStateMachineIntegration$' verifies idempotent upgrade adjustments, refund holds for unused quota, and mandatory manual review for used/in-flight quota. Billing business tests cover quota outage retry, scheduled downgrade without a current-period quota rewrite, and simulated refund versus manual review. Before and after the no-ff merge, `GOCACHE=/tmp/dramaip-go-build go test -race ./...`, `make event-contracts`, `pnpm typecheck`, and `pnpm build:web` passed. Helm lint/development render and Docker Compose config rendering passed.
Compose/payment limitation: Not claimed. The pre-existing Compose stack remains unhealthy after its Docker Desktop restart because workloads cannot resolve the absent `postgres` service; this loop did not stop or delete user-owned containers. Full Compose E2E, live RabbitMQ relay behavior, and real payment sandbox refunds were not run. Isolated PostgreSQL state-machine tests, client build, and deployment renders are the substitute evidence. Restore a healthy stack, run `make platform-e2e`, and run webhook-confirmed WeChat/Alipay sandbox refund flows before treating it as deployment or real-payment evidence.
Diff review: Reviewed the complete 31-file functional diff and ran `git diff --check` before commit and after merge. Migrations 024/025 are additive: immutable subscription periods/changes/refunds, quota adjustment ledger, and refund holds are appended without deleting historical financial or entitlement records. Generated protobuf is derived from checked-in source; no real environment file, credential, payment material, private key, cache, image, or unrelated artifact is included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` confirmed main aligned before branch creation and immediately before the no-ff merge.
Push: Core merge 2c3984c was pushed successfully to ordinary `origin/main`; this completion metadata is committed and awaiting the final normal push.
Loop branch cleanup: Completed after the core merge push.
Current branch/worktree: main; completion metadata is the only pending change.
Notes: The repository owner explicitly chose normal Gitee use; no Gitee Go pipeline or hosted merge gate is claimed. Simulated payment is the only transport that reaches automatic refund finalization; real provider webhook verification remains LM3-17/LM3-18. LM3-19 owns cross-ledger reconciliation and LM3-22 owns operational alerts.
```

```text
Loop: LM3-17
Target branch: main
Loop branch: loop/lm3-17-sandbox-preflight
Commit(s): e0cf07d loop(LM3-17): add wechat pay webhook; 0b072f9 loop(LM3-17): validate platform certificate serial; e35c643 docs(loop): waive LM3-17 sandbox payment rehearsal; this completion-record commit.
Merge commit(s): 4f11dcb merge: LM3-17 wechat payment sandbox webhook; 9154fce merge: LM3-17 platform certificate serial validation; the required closing no-ff merge of this record follows.
Verification: The core implementation passed `GOCACHE=/tmp/dramaip-go-build go test ./app/billing/...`, targeted billing race tests, `make billing-wechat-webhook-integration` against a fresh isolated PostgreSQL instance, event-contract/client checks, and Helm/Compose rendering; it covers signature/decryption validation, forged/replayed/mismatched callback handling, active-query confirmation, one-time Saga activation, and webhook audit persistence. For the owner-authorized waiver change, `git diff --check` and the documentation/configuration cross-reference review passed. No real merchant credential, payment or callback was used.
Diff review: Reviewed all LM3-17 core diffs and this documentation-only final diff. No real environment file, APIv3 key, certificate, private key, payment payload, cache, image, or unrelated artifact is included. The provider remains disabled by default and can be rolled back by disabling the feature flag and webhook route while retaining audit records.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` aligned main before this closing branch; the same synchronization is repeated immediately before the closing no-ff merge.
Push: The closing merge is pushed with ordinary `git push origin main`; no hosted Gitee pipeline is used.
Loop branch cleanup: Delete `loop/lm3-17-sandbox-preflight` after the closing merge push confirms main and origin are aligned.
Current branch/worktree: This completion record is committed on the clean closing loop branch before its no-ff merge.
Notes: On 2026-07-13 the repository owner explicitly directed that the official sandbox payment-to-callback rehearsal be skipped. LM3-17 is therefore complete only at the delivered software scope; it is not evidence of real WeChat channel activation, real payment, public callback reachability, or production readiness. Any future environment that enables WeChat payment must perform the documented official sandbox E2E first.
```

```text
Loop: LM3-18
Target branch: main
Loop branch: loop/lm3-18-alipay-sandbox-webhook
Commit(s): 086f2b9 loop(LM3-18): add alipay sandbox webhook; this completion-record commit.
Merge commit: The required closing no-ff merge of this branch follows this record.
Verification: `GOCACHE=/tmp/dramaip-go-build go test ./...` passed. `GOCACHE=/tmp/dramaip-go-build go test -race ./app/billing/internal/alipay ./app/billing/service/internal/server ./app/billing/service/internal/biz ./app/billing/service/internal/data` passed. A fresh, localhost-only PostgreSQL 18 container ran `make billing-alipay-webhook-integration` successfully; it verifies inbox persistence, query-confirmed audit, amount mismatch rejection, one payment/subscription/outbox write, and processed replay. Helm lint and enabled-provider render passed, with a missing Alipay credentials Secret render rejected as intended; Docker Compose config and Kong YAML parsing passed. Adapter and handler tests cover RSA2 request/notification signatures, signed provider responses, forged/replayed notifications, amount parsing, query mismatch, and `success` acknowledgement. No real merchant key, payment, callback, or public endpoint was used.
Diff review: Reviewed the complete LM3-18 diff and ran `git diff --check` before this commit. The diff contains no real environment file, credential, private key, payment form, cache, image, or unrelated artifact. The public webhook has an exact Kong route with no browser JWT/CORS plugin, provider secrets are mounted only into billing, and both provider and local order/amount/transaction identities must agree before the pre-existing Saga runs.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` aligned main before branch creation; the same synchronization is repeated immediately before the closing no-ff merge.
Push: The closing merge is pushed with ordinary `git push origin main`; no hosted Gitee pipeline is used.
Loop branch cleanup: Delete `loop/lm3-18-alipay-sandbox-webhook` after the closing merge push confirms main and origin are aligned.
Current branch/worktree: This completion record is committed on the clean closing loop branch before its no-ff merge.
Notes: During LM3-17 on 2026-07-13 the repository owner explicitly directed that real payment be skipped before continuing. LM3-18 therefore completes only the delivered software scope and is not evidence of real Alipay channel activation, real payment, public callback reachability, or production readiness. Any future environment that enables Alipay must perform the documented official sandbox E2E first.
```

```text
Loop: LM3-19
Target branch: main
Loop branch: loop/lm3-19-reconciliation
Commit(s): This functional commit and the closing completion-record commit.
Merge commit: The required no-ff merge follows after the loop branch is synchronized with origin/main.
Verification: `GOCACHE=/tmp/dramaip-go-build go test ./...` passed. Targeted race checks passed for platform mTLS, quota service data/service, billing-job reconciliation data/server/service. `make event-contracts` passed after proto generation, including format/lint/breaking and generated-output stability checks. Fresh localhost-only PostgreSQL 16 containers ran `make billing-reconciliation-integration` and the quota state-machine integration test; they apply every migration through 027 and verify missing quota, duplicate payment, amount mismatch, immutable per-run observations, cursor pagination, rerun case idempotency, operator audit idempotency, no silent manual refund entitlement change, safe quota repair, and exact quota period lookup. Helm lint/template and Docker Compose config rendering passed.
Diff review: Reviewed the complete functional diff and ran `git diff --check`. Migration 027 is additive: run/cursor/case/observation/action tables only. Billing retains its database-role boundary and reaches quota only through a narrow mTLS-restricted internal RPC; no cross-schema query was added. The operator HTTP API is disabled without a Secret token, has no Helm Service/Ingress, requires a constant-time Bearer comparison, and uses no-store responses. No credential, payment record, private key, local environment file, cache, image, or unrelated artifact is included.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` aligned main before the loop branch was created; the same synchronization is repeated immediately before the closing no-ff merge.
Push: The closing merge is pushed with ordinary `git push origin main`; no hosted Gitee pipeline is used.
Loop branch cleanup: Delete `loop/lm3-19-reconciliation` after the closing merge push confirms main and origin are aligned.
Current branch/worktree: This completion record is committed on the loop branch after functional validation.
Notes: On 2026-07-13 the repository owner explicitly directed that real payment be skipped before continuing. This loop therefore delivers local-ledger reconciliation and controlled, audited operator workflows only; it is not proof of downloaded WeChat/Alipay settlement files, real refunds, real payment, public callback reachability, or production readiness. Future merchant-enabled environments must add official provider bill adapters and run their documented sandbox E2E before treating reconciliation as external-channel settlement evidence.
```

```text
Loop: LM3-20
Target branch: main
Loop branch: loop/lm3-20-ledger-safety-gate
Commit(s): This Gate record commit.
Merge commit: The required no-ff merge follows after synchronization with origin/main.
Verification: Full `go test -race ./...` passed. Fresh isolated PostgreSQL 16 databases ran billing Saga, lifecycle, WeChat webhook, Alipay webhook, quota state-machine and reconciliation integrations through migration 027; `make event-contracts`, Compose config and Helm lint/template passed.
Diff review: Documentation/Gate-only diff; `git diff --check` passed. No production rule, credential, payment record or generated artifact is added.
Remote sync: main was synchronized with origin before this branch was created and is synchronized again before merge.
Push: Ordinary `git push origin main`; no Gitee hosted pipeline.
Loop branch cleanup: Delete `loop/lm3-20-ledger-safety-gate` after push.
Current branch/worktree: Gate record committed after validation.
Notes: Real payment sandbox was explicitly waived by the owner. Compose E2E was not run because the pre-existing user Compose stack has no healthy PostgreSQL service; it was not stopped or rebuilt. Both remain real-payment/deployment blockers, documented in the Gate record.
```

```text
Loop: LM3-21
Target branch: main
Loop branch: loop/lm3-21-trace-security-logs
Commit(s): This functional observability commit.
Merge commit: The required no-ff merge follows after synchronization with origin/main.
Verification: Full `go test ./...` and `go test -race ./...` passed using the established isolated cache. `make event-contracts`, Docker Compose config, Helm lint, Helm development render with hostPath persistence disabled, and `node --check scripts/observability-smoke.mjs` passed. New tests cover HTTP/Kratos, gRPC, payment outbox/MQ continuation, AI Provider HTTP spans, and nested structured-log redaction.
Diff review: Shared tracing/logging, payment outbox propagation, job logging, local observability binding, smoke script and documentation only. `git diff --check` passed; no credential, payment material, environment file, cache, image, prompt or generated artifact is included.
Remote sync: main was synchronized with origin before this branch was created and is synchronized again before merge.
Push: Ordinary `git push origin main`; no Gitee hosted pipeline.
Loop branch cleanup: Delete `loop/lm3-21-trace-security-logs` after push.
Current branch/worktree: Functional changes and completion record are committed after validation.
Notes: `make observability-smoke` was attempted read-only but `localhost:8000` refused the connection because the pre-existing user Compose stack is unhealthy; no user container was stopped or rebuilt. Healthy-stack Jaeger/OpenSearch smoke and manual inspection remain deployment/real-payment blockers, not evidence claimed by this record.
```

```text
Loop: LM3-22
Target branch: main
Loop branch: loop/lm3-22-metrics-alerting (deleted after the closing merge push)
Commit(s): 87c97b1 loop(LM3-22): add metrics alerts and dashboard; this completion-record commit.
Merge commit: The required closing no-ff merge follows after synchronization with origin/main.
Verification: `GOCACHE=/tmp/dramaip-go-race-lm3-20 go test ./...` and `go test -race ./...` passed. `make event-contracts`, `make observability-config-smoke`, `make observability-rule-test`, Docker Compose config, `promtool check rules`, Helm lint, and production/development Helm renders passed. The promtool injection fixture proves that simulated payment-confirmation failure, billing outbox backlog, Provider latency timeout signal, and Provider cost guard spike each produce the intended firing alert with the documented runbook. Metrics package tests prove UUID route normalization and that raw error details never become metric labels.
Compose/Grafana runtime limitation: Not claimed. The existing user-owned Compose stack still refuses `localhost:8000`; it was not stopped, deleted, or rebuilt. Prometheus Targets/Alerts, Grafana provisioning UI, OpenSearch/Jaeger trace correlation, and live fault injection must be rerun against a restored healthy stack according to `docs/loop/LM3-22-指标告警与错误聚合.md` before deployment or real-payment readiness is claimed.
Diff review: Reviewed all 26 functional files and ran staged `git diff --check`. The change adds a bounded in-process Prometheus registry, duration histograms, payment/quota/outbox/provider/cost signals, 11 rules, Grafana provisioning/dashboard, deterministic static configuration checks, and an in-image Prometheus rule test. It does not contain credentials, payment data, prompt/body content, trace IDs as labels, cache, image, generated artifact, or an automatic financial correction path.
Remote sync: `git fetch origin` and `git merge --ff-only origin/main` aligned main before this loop branch was created; the same synchronization is repeated immediately before the closing no-ff merge.
Push: The closing merge is pushed with ordinary `git push origin main`; no Gitee hosted pipeline is used.
Loop branch cleanup: Delete `loop/lm3-22-metrics-alerting` after the closing merge push confirms main and origin are aligned.
Current branch/worktree: This completion record is committed on the clean loop branch before its no-ff merge.
Notes: The repository owner explicitly instructed that real payment is skipped. Error aggregation is the documented Sentry-equivalent bounded metrics plus secure logs/traces; a future external Sentry integration must retain the same redaction rules and must not put trace IDs or error text in Prometheus labels.
```
