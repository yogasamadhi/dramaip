# DramaIP 后端 Java 重构方案

> 目标：将 `dramaip-platform/legacy/go-services/` 中的 Go/Kratos 后端平滑迁移到 `dramaip-platform/server/` 下的 Java/Spring Cloud Alibaba 服务
> Java 基线：JDK 21 + Spring Boot 4.0.6
> 当前阶段：只完成方案、清单和验收标准，不创建 Java 工程、不编写 Java 代码

## 1. 重构目标

本次重构不是对 Go 源码逐文件翻译，而是在保持业务行为、数据正确性和可回滚能力的前提下，完成以下转型：

1. 入口由 Kong 迁移为 Spring Cloud Gateway。
2. 服务注册、配置、限流熔断迁移到 Nacos 和 Sentinel。
3. 后端采用国内团队常见的 Maven 多模块和分层开发模式。
4. 接口按业务服务归属，不设置按客户端类型拆分的后端适配服务。
5. 数据访问统一为 MyBatis-Plus / MyBatis，保留 PostgreSQL 和现有数据模型。
6. 消息中间件继续使用 RabbitMQ，迁移期和目标架构保持一致。
7. 引入 Seata 2.5.0，为经过评审的 AT/TCC 场景提供分布式事务能力。
8. Java 代码执行阿里巴巴 Java 开发规范和 P3C 自动化门禁。
9. Go 服务逐批切流、逐批只读，最终归档，不进行一次性整体替换。

## 2. 范围与非目标

### 2.1 本次范围

- 现有 Go HTTP、gRPC、定时任务和消息消费能力的迁移。
- 统一网关、认证、安全、异常、日志、接口和工程规范。
- 表所有权、接口所有权、事件所有权和服务边界梳理。
- 灰度、回滚、数据核对和旧服务下线方案。
- RabbitMQ 连接、事件信封、消费幂等、重试和死信治理。
- Seata TC 部署、事务矩阵、AT/TCC 使用边界和故障处置方案。

### 2.2 非目标

- 不在第一阶段更换 PostgreSQL。
- 不更换 RabbitMQ。
- 不在迁移业务代码的同时大规模改表或改业务流程。
- 不把所有单体内调用机械改为远程调用。
- 不把旧 Go 工程的 `api`、`app`、`pkg` 目录逐层映射成 Java Maven 模块。
- 不将所有跨服务写操作都强制改为 Seata 全局事务。
- 不使用 Seata 替代业务幂等、状态机、对账和补偿。
- 不在本方案阶段创建 Java 工程或示例源码。
- 不为了模仿某套脚手架而引入无实际职责的服务。

## 3. 当前资产处理

### 3.1 目录状态

```text
dramaip-platform/
├─ legacy/
│  └─ go-services/       # 现有 Go/Kratos 后端，迁移期仍可构建与运行
└─ server/
   ├─ README.md          # Java 目标目录说明
   ├─ common/            # 基础设施层：公共技术能力
   ├─ gateway/           # 基础设施层：Spring Cloud Gateway
   └─ services/          # 业务服务层：identity/billing/quota/ai/creation/support
```

规则：

- `legacy/go-services` 在迁移期只接受兼容性修复、安全修复和迁移所需观测改造。
- 新业务优先评估落入 Java 目标服务，禁止继续复制新的 Go 服务。
- Java 实现开始后，所有代码必须位于 `server`，禁止与旧 Go 源码混放。
- 旧服务完全退出生产后，将 `legacy` 标记为只读归档。

### 3.2 必须先完成的清单

每个现有进程都要登记：

- HTTP 路径、方法、鉴权要求、请求和响应样例。
- gRPC 服务、方法、超时、错误码和调用方。
- 数据库读写表、事务边界和锁策略。
- Redis Key、TTL、数据结构和一致性要求。
- RabbitMQ exchange、queue、routing key、重试和死信规则。
- 跨服务写入是否需要强一致、候选 Seata 模式、参与表、锁范围、超时和回滚方式。
- 定时任务表达式、并发策略、补偿方式和人工处置方式。
- 外部支付、AI、短信、邮件等第三方依赖。
- 日志、指标、告警、容量和峰值。

未完成上述清单的服务不得进入编码阶段。

## 4. 目标服务映射

| 现有能力 | 目标服务 | 迁移说明 |
|---|---|---|
| 登录、令牌、会话；用户、工作空间、成员关系；管理账号、角色、权限、配置 | `identity` | 合并 auth+user+system；保持用户 ID、工作空间 ID 和管理员 ID 不变；内部按 `auth`/`user`/`admin` 子包迁移；Java 使用 RS256/JWKS 和契约 2 |
| 订单、支付、充值、退款、订单超时 | `billing` | 账务流水和回调幂等优先验证 |
| 额度账户、预占、扣减、释放、到期 | `quota` | 保持额度流水可审计 |
| 模型供应商、模型路由和 AI 调用 | `ai` | 先兼容旧供应商协议 |
| 灵感、快照、评审 | `creation` | 作为一个创作服务的内部模块 |
| 站内信、短信和邮件；管理统计和看板 | `support` | 合并 notification+reporting；优先采用事件驱动；报表通过读模型代替实时多服务串行聚合；内部按 `notification`/`reporting` 子包迁移 |
| 四个端侧接口进程 | 拆回对应业务服务 | 不保留按客户端类型划分的服务 |
| Kong 路由 | `gateway` | Kong 仅在灰度阶段保留 |

## 5. 重构原则

### 5.1 先行为等价，后业务优化

第一轮 Java 实现以兼容为主：

- 接口路径、字段含义、错误语义和鉴权规则保持兼容。
- 数据库 schema 和业务主键保持不变。
- 事件语义和幂等键保持不变。
- 性能不得低于当前生产基线。

命名清理、表结构优化、协议升级在完成切流后另行立项。

### 5.2 单一写入方

Go 与 Java 可在迁移期同时读，但同一业务表、同一聚合状态不得双写。

切换写入方的标准流程：

1. 暂停或排空旧写入入口。
2. 核对队列积压和在途任务。
3. 启用 Java 写入。
4. 对比业务记录、流水和关键指标。
5. 旧服务转为只读或停止。

### 5.3 一次只改变一个高风险变量

- 语言迁移阶段保持 PostgreSQL。
- Java 服务沿用 RabbitMQ，只替换客户端实现并补齐治理能力。
- Seata 先在非资金短事务试点，再按事务矩阵逐项启用。
- 核心业务切换和破坏性数据库变更不得在同一发布窗口进行。

### 5.4 不建立客户端专属后端

- Web、桌面端、移动端和管理端都经统一网关访问业务服务。
- 业务接口由领域归属服务提供。
- 看板和复杂统计进入 `support` 的 reporting 子包。
- 少量跨服务实时编排放在具有明确业务所有权的 Service 中。
- 禁止新增只有接口转发、字段改名和客户端适配职责的服务。

### 5.5 BFF 拆解下沉原则

legacy 的 4 个 BFF（web/desktop/mobile/admin，合计约 104 条 HTTP 路由）不重建为独立 Java 服务，其聚合逻辑按业务归属拆解下沉到 6 个业务服务的 Controller。

- **按业务归属下沉**：每个 BFF 路由落到其领域归属的业务服务。例如 web BFF 的 `/v1/auth`、`/v1/me/*`、`/v1/workspaces/*` 下沉到 identity；`/v1/billing/*`、`/v1/subscription/*` 下沉到 billing；`/v1/review/*`、drafts 下沉到 creation；`/v1/ai/*` 下沉到 ai。
- **客户端契约升级**：Java 只公开资源化 `/api/v1/**`，客户端必须发送 `X-DramaIP-Contract-Version: 2` 并解包 `Result<T>`。旧 `/v1/**` 不由 Java 承接；最终切换前必须强制升级 Web、Admin、Mobile、Desktop 和 SDK。
- **管理端路由下沉**：admin interface（约 26 条路由）的 `/v1/admin/*` 按归属下沉到 identity 的 admin 子包以及各业务服务的管理端接口（如退款/对账下沉到 billing，额度调整下沉到 quota，通知重试/报表下沉到 support）。
- **下沉时机**：BFF 路由下沉在对应业务服务阶段内完成，不单独建立阶段。各业务服务阶段的「承接范围」已列出该服务承接的 BFF 路由清单。
- **网关承接编排**：少量纯转发或客户端适配逻辑由 Spring Cloud Gateway 路由层承接，不在业务服务内新增转发型代码。

## 6. 实施阶段

### 阶段 0：冻结基线与架构评审

目标：在写代码前形成可执行基线。

工作项：

- 完成接口、gRPC、数据库、缓存、消息、任务和第三方依赖清单。
- 确认目标服务、表所有权、RabbitMQ exchange/queue 所有权和接口所有权。
- 建立分布式事务矩阵，区分本地事务、Seata AT、Seata TCC、outbox 和补偿场景。

**规模基线摘要**（基于 legacy Go 实际盘点，作为后续阶段承接范围的参照）：

| 服务 | RPC | 表 | 任务/消费者 | BFF 路由（约） |
|---|---|---|---|---|
| identity | 30 | 16 | — | 55 |
| support | 12 | 10 | 2 消费者 + 2 job | 15 |
| creation | 19 | 10 | — | 30 |
| ai | 7 | 4 | — | 10 |
| quota | 10 | 5 | 1 job | 5 |
| billing | 15 | 14 | 1 重 job + 2 webhook | 30 |

补充说明：

- 4 个 BFF（web/desktop/mobile/admin）合计约 104 条 HTTP 路由，按业务归属拆解下沉到上述 6 个业务服务的 Controller，不重建独立 BFF 服务（下沉原则见 §5.5）。
- Seata TCC 候选场景：ai↔quota（预占/决算/取消）、billing↔quota（升级调拨/退款扣回）。
- billing 的 outbox 事件发布不纳入 Seata，保留等价本地消息表机制。
- 冻结 Spring Boot `4.0.6`、JDK `21`，以及由根父 POM 导入官方 BOM 的版本管理方案。
- 确认编码规范、包结构、错误码、统一响应和日志字段。
- 为支付、额度、登录、创作和 AI 调用保存黄金请求与响应样例。
- 记录当前吞吐、P95/P99、错误率、资源使用和消息积压基线。

退出条件：

- 架构文档评审通过。
- 清单无未知生产入口。
- 每个迁移单元都有负责人、依赖方和回滚方式。

### 阶段 1：技术兼容性验证

目标：验证技术栈可以在目标版本线上稳定运行。

后续实施内容：

- 建立根 `server/pom.xml`，同时承担父 POM、模块聚合和 `dependencyManagement`；按「基础设施层（common、gateway 在顶层）+ 业务服务层（services/ 子层）」组织。
- `common` 为扁平单模块（目录即 `server/common/src/main/java/...`），初期不设 `platform-common` 这类嵌套子模块。
- 验证 Spring Boot 4.0.6 与 Spring Cloud、Spring Cloud Alibaba BOM 的依赖收敛。
- 验证 Nacos 3.x 注册、配置导入和动态配置。
- 验证 Spring Cloud Gateway、Sentinel 网关限流和统一异常。
- 验证 OpenFeign、MyBatis-Plus Boot 4 Starter、PostgreSQL、Redis。
- 验证 Spring AMQP、RabbitMQ Publisher Confirm、手动 ACK、重试、死信和消费幂等。
- 验证 Seata 2.5.0 TC、Nacos 注册配置、PostgreSQL AT、OpenFeign XID 传递和 TCC 防悬挂。
- 验证 Actuator、Micrometer、OpenTelemetry 和结构化日志。
- 用 Testcontainers 完成 PostgreSQL、Redis、RabbitMQ 和 Seata 冒烟测试。

退出条件：

- 依赖树无冲突和重复实现。
- 所有基础组件在 CI 中可重复启动和测试。
- Seata 全局提交、分支失败、超时回滚、TC 重启和锁冲突测试通过。
- P3C、Checkstyle、SpotBugs、JaCoCo 已成为强制门禁。

### 阶段 2：统一网关与公共规范

目标：建立所有 Java 服务共同遵守的入口和工程约束。

后续实施内容：

- 建立 `gateway`（位于 `server/` 顶层，属基础设施层）。
- 实现请求标识、跨域、统一限流、路由级鉴权初检和统一错误响应。
- 建立最小化扁平 `common` 单模块（目录即 `server/common/src/main/java/...`），不设 `platform-common` 嵌套层，不建立中央接口或 DTO 聚合模块。
- 以提供方 OpenAPI 为契约，Feign Client 默认放在调用方 `client` 包，并建立契约测试。
- 建立 RabbitMQ 事件信封、生产确认、消费幂等和死信规范。
- 建立 Seata 客户端公共配置，但不在公共模块自动开启全局事务。
- 确定 `Controller -> Service -> Manager（按需）-> Mapper` 模板。
- 领域对象按层就近组织（`controller/dto`、`entity`、`enums`、按需 `domain`），不设集中 `model` 包；以对象流转矩阵约束层间转换，`convert` 为唯一转换通道。
- 建立 OpenAPI、错误码、日志脱敏、线程池和数据库规范。
- 建立 Kong 到 Spring Cloud Gateway 的灰度路由能力。

退出条件：

- 网关不含业务逻辑和数据库依赖。
- 一条无状态测试接口可经 Kong、Spring Cloud Gateway 到达 Java 服务。
- 灰度比例、快速切回和链路追踪均验证通过。
- 未进入事务矩阵白名单的 Service 不使用 Seata 全局事务。

### 阶段 3：身份服务（identity）

目标：建立后续服务依赖的身份与权限基础。本阶段迁移 `identity` 一个服务（位于 `server/services/`），内部按 `auth`/`user`/`admin` 子包承接原登录令牌、用户工作空间、管理账号权限三块能力。

承接范围：

- 接口：auth（12 RPC）+ user（13 RPC）+ admin（5 RPC），共 30 RPC。
- 表：用户、工作空间、成员、管理员、角色、权限、会话等 16 张。
- BFF 路由：web 的 `/v1/auth`、`/v1/me/*`、`/v1/workspaces/*`；admin 的 `/v1/admin/principals/*`、`/v1/admin/audit`，约 55 条。
- 公开端点：`/.well-known/jwks.json` HTTP 端点。

迁移顺序：

1. 用户只读接口。
2. 工作空间和成员关系查询。
3. 管理员、角色和权限。
4. 登录、刷新、登出和会话。
5. 用户资料和成员关系写接口。
6. BFF 路由下沉到对应 Controller。
7. 旧令牌兼容窗口验证。

关键检查：

- 旧令牌在过渡窗口内可验证。
- 用户 ID、工作空间 ID 和管理员 ID 不变。
- 网关只做令牌初检，服务内仍执行资源权限判断。
- JWKS 端点协议不变，密钥轮换不影响在用令牌验证。
- 登录限流、密码策略、刷新令牌轮换和审计日志完整。

退出条件：

- 新旧客户端均通过回归测试。
- 权限矩阵和越权测试通过。
- 认证回滚不会使已签发令牌大面积失效。

### 阶段 4：通知与报表服务（support）

目标：以低写入风险模块验证完整迁移流程。本阶段迁移 `support` 一个服务（位于 `server/services/`），内部按 `notification`/`reporting` 子包承接原通知发送、报表统计两块能力。

承接范围：

- 接口：notification（3 RPC + delivery ops 2）+ reporting（7 RPC），共 12 RPC。
- 表：notification/reporting 各约 5 张，共 10 张。
- 消费者：notification-job（消费事件→inbox 去重→多渠道投递）、reporting-job（事件投影读模型），共 2 个。
- 死信队列：`dramaip.platform.events.dlx`。
- BFF 路由：admin 的通知重试、报表路由，约 15 条。

迁移顺序：

1. 通知模板与发送记录。
2. 事件消费幂等（事件信封 `eventId` 去重）。
3. 报表读模型投影。
4. 死信重放与人工补偿。
5. BFF/admin 路由下沉。

关键检查：

- 事件信封 `eventId` 幂等，重复投递不产生重复 inbox 记录。
- notification 目前仅 in_app 渠道，SMS/Email 渠道在 legacy 尚未落地，本阶段只迁 in_app，SMS/Email 列为后续新建项（非迁移）。
- reporting 只读不回写业务库。
- 通知重复发送率符合基线。
- 如事务矩阵存在合适的非资金短事务，在本阶段完成首个 Seata AT 灰度；不得为试点强行制造跨服务写入。

退出条件：

- 通知重复发送率符合基线。
- 报表结果与旧实现核对一致。
- 死信重放和补偿流程经过演练。
- 可以完成一次完整灰度、回滚和再次切流。

### 阶段 5：创作服务（creation）

目标：迁移灵感、快照和评审能力。本阶段迁移 `creation` 一个服务（位于 `server/services/`），内部按 `inspiration`/`snapshot`/`review` 子包承接原灵感、快照、评审三块能力。

承接范围：

- 接口：inspiration（4 RPC）+ snapshot（7 RPC）+ review（8 RPC），共 19 RPC。
- 表：移动草稿、项目快照、分片上传记录、评审包等 10 张。
- BFF 路由：desktop 的项目快照分片上传、评审包；web/mobile 的评审、草稿路由，约 30 条。
- 第三方依赖：对象存储（分片上传与断点续传协议需对齐）。

迁移顺序：

1. 创作查询接口。
2. 项目快照与分片上传。
3. 评审包与状态流转。
4. 灵感流程。
5. BFF 路由下沉到对应 Controller。
6. 旧客户端协议兼容验证。

关键检查：

- 合并后 snapshot→review 的跨服务写改为本地事务，不再依赖分布式提交。
- 分片上传断点续传协议、上传标识和合并语义与旧实现一致。
- 对象存储交互（分片边界、并发上传、失败重传）行为一致。
- 快照与评审状态机在重复请求、乱序回调和超时下保持一致。
- 第三方密钥、提示词和用户内容按要求脱敏。

退出条件：

- 固定样例输出和状态副作用符合兼容要求。
- 分片上传与评审端到端流程回归通过。
- 跨服务写已收敛为本地事务，事务矩阵无遗留 snapshot↔review 条目。

### 阶段 6：额度服务（quota）

目标：迁移额度账户、预占、决算、释放和到期任务。本阶段迁移 `quota` 一个服务（位于 `server/services/`），承接原 quota 全部能力。quota 是被依赖最深的基础（ai、billing 均依赖它），需先稳定下来作为 Seata TCC 被调方。

承接范围：

- 接口：quota（10 RPC，含 Reserve/Settle/Cancel/Adjust/PrepareRefund）。
- 表：token_accounts、reservations、usage_logs、adjustments、refund_holds 共 5 张。
- 任务：quota-job（回收过期预占、决算挂起结算、周期账户续期），1 个。
- BFF 路由：admin 的额度调整路由，约 5 条。

迁移顺序：

1. 额度查询。
2. 额度授予。
3. 预占与释放。
4. 实际决算。
5. 到期与补偿任务。
6. BFF/admin 路由下沉。

关键检查：

- `available`、`reserved` 和流水变化满足守恒规则。
- 每个操作拥有稳定幂等键。
- 并发扣减使用条件更新或版本号，并检查影响行数。
- 消息重复、乱序、消费超时和服务重启不会重复扣减。
- 到期任务支持分片、抢占、重试和断点续跑。
- 作为 Seata TCC 被调方，Try/Confirm/Cancel 必须处理幂等、空回滚和悬挂。

退出条件：

- 额度对账无差异。
- 压测下不存在超扣、负数和重复流水。
- Seata TCC 的分支超时、重复 Confirm、重复 Cancel、TC 重启和网络分区测试通过。
- 补偿与人工修复流程经过演练。

### 阶段 7：AI 服务（ai）

目标：迁移模型供应商调用、模型路由、流式响应和使用量采集。本阶段迁移 `ai` 一个服务（位于 `server/services/`），承接原 ai_gateway 全部能力；它只在 quota TCC 已验证后进入写入切换。

承接范围：

- 接口：ai_gateway（7 RPC，含 ChatStream 流式）。
- 表：请求审计、供应商成本日志等 4 张。
- BFF 路由：web 的 `/v1/ai/*`，约 10 条。
- 第三方依赖：OpenAI 兼容协议的模型供应商，采用通用适配，不绑定单一厂商。

迁移顺序：

1. 模型供应商客户端与密钥管理。
2. 模型路由与降级策略。
3. 非流式调用。
4. 流式 SSE 响应。
5. 使用量采集与成本核算。
6. 与 quota 的预占、决算联动（作为 Seata TCC 发起方）。
7. BFF 路由下沉到对应 Controller。

关键检查：

- 第三方 AI 调用设置超时、并发隔离、Sentinel 熔断和成本上限。
- 流式响应的断线、取消和计量行为与旧实现一致。
- 第三方密钥、提示词和用户内容按要求脱敏。
- 与 quota 的 Reserve/Settle/Cancel TCC 场景完成幂等、空回滚和悬挂测试。
- 供应商故障不拖垮业务线程池。

退出条件：

- 固定样例输出和状态副作用符合兼容要求。
- AI 供应商故障不会拖垮业务线程池。
- 使用量记录可追溯且可补偿。
- ai↔quota 的 TCC 链路通过故障注入测试。

### 阶段 8：计费服务（billing）

目标：迁移订单、支付、充值、退款、订阅生命周期和对账。本阶段迁移 `billing` 一个服务（位于 `server/services/`），内部按 `service`/`reconciliation` 子包承接原计费主流程与对账两块能力。billing 是事件主发布方，其 outbox 表是事件可靠性来源，Java 侧必须保留等价本地消息表机制。

承接范围：

- 接口：billing/service（11 RPC）+ reconciliation（4 RPC），共 15 RPC。
- 表：orders、payments、refunds、outbox_events 等 9 张 + reconciliation 对账 5 张，共 14 张。
- 任务：billing-job（outbox relay、quota 调拨重试、订阅生命周期、对账含手动修复），1 个重任务。
- 支付渠道：alipay、wechat 两个自研支付渠道（RSA 签名/验签需用 Java 重写）。
- Webhook：wechat、alipay 两个回调端点。
- BFF 路由：web 的 `/v1/billing/*`、`/v1/subscription/*`；admin 的退款/对账路由，约 30 条。

迁移顺序：

1. 账务只读查询。
2. 订单创建。
3. 支付和充值回调。
4. 退款。
5. 订单超时任务。
6. 订阅生命周期。
7. 对账流程。
8. BFF/admin 路由下沉。

关键检查：

- 金额全部使用最小货币单位整数。
- 订单号、第三方流水号和幂等键有数据库唯一约束。
- 回调验签、金额、商户号和订单状态校验完整。
- 账务流水只追加。
- 重复回调、乱序回调、超时与回调并发时结果唯一。
- 本地事务和事务发件箱一致提交。
- 支付渠道调用、RabbitMQ 发布和长时间人工流程不进入 Seata AT。
- outbox 模式保留，不使用 Seata 替代事件发布。
- billing↔quota 的升级调拨、退款扣回走 Seata TCC，完成锁范围和回滚测试。
- 对账 cursor 扫描与多类 mismatch 检测覆盖完整。

退出条件：

- 全量对账结果一致。
- 并发、重复请求和故障注入测试通过。
- 有人工冻结、补单、重放和审计操作手册。
- 完成至少一个完整业务周期的灰度观察。

### 阶段 9：RabbitMQ 与 Seata 治理收口

目标：完成消息治理和分布式事务生产化，不更换消息中间件。

步骤：

1. 固化 RabbitMQ 事件信封、exchange、routing key、queue、重试和死信规则。
2. 按消费方切换 Java queue，使用 `eventId` 去重并清理旧 Go queue 与绑定。
3. 将 Seata TC 以高可用集群部署，接入 Nacos 和独立事务存储。
4. 逐项复核事务矩阵，只为已批准场景启用 AT 或 TCC。
5. 演练全局超时、分支失败、锁冲突、TC 重启、回滚失败和人工修复。
6. 建立 RabbitMQ 重放手册、Seata 事务处置手册和审计流程。

禁止事项：

- 禁止更换或同时双写其他消息中间件。
- 禁止 RabbitMQ 发布参与 Seata 全局事务。
- 禁止在支付或额度主切流当天首次启用新的 Seata 场景。
- 禁止通过删除 Seata 全局锁或事务记录掩盖业务数据问题。

退出条件：

- 所有 RabbitMQ 生产者、消费者、事件版本和负责人有清单可查。
- 发布确认、积压、重试、死信和重放监控可用。
- 旧 Go queue 无生产消费流量和未处理消息。
- Seata TC 高可用、事务指标、告警、查询和人工处置能力可用。
- 所有生产全局事务都能在事务矩阵中找到审批记录和回滚方案。

### 阶段 10：入口切换与旧系统归档

目标：Spring Cloud Gateway 成为唯一入口，旧 Go 服务退出生产。

步骤：

1. 核对所有外部路径、回调路径和内部调用方。
2. 将 Nginx / SLB 的入口切换到 Spring Cloud Gateway。
3. Kong 保留短期回滚窗口但不承接主流量。
4. 停止旧 Go 定时任务、消息消费者和写入口。
5. 观察完整业务周期并完成最终数据核对。
6. 下线 Kong 和 Go 服务部署。
7. 将 `legacy/go-services` 标记为只读归档。

退出条件：

- 网关访问日志中不存在遗漏路径。
- 旧服务没有数据库连接、消息消费和定时任务执行。
- 回滚窗口关闭前未出现不可解释的数据差异。
- 运维、告警、值班和故障手册全部转向 Java 服务。

## 7. 单个迁移单元的标准流程

每个接口、消费者或任务都按以下流程执行：

```mermaid
flowchart LR
    Inventory["资产清点"] --> Contract["冻结契约"]
    Contract --> Implement["Java 实现"]
    Implement --> Test["单元与集成测试"]
    Test --> Compare["新旧结果对比"]
    Compare --> Shadow["影子或小流量验证"]
    Shadow --> Canary["灰度切流"]
    Canary --> Verify["数据与指标核对"]
    Verify --> Full["全量切流"]
    Full --> ReadOnly["旧单元只读 / 停止"]
```

每个迁移单元必须交付：

- 资产清单。
- 接口或事件契约。
- 数据写入方说明。
- 事务方案说明；涉及 Seata 时附事务矩阵条目、锁范围和超时。
- 测试用例与对比结果。
- 监控面板和告警。
- 灰度步骤。
- 回滚步骤。
- 数据修复方案。
- 旧单元停止证据。

## 8. 网关迁移方案

### 8.1 路由粒度

优先按完整业务资源或完整路由组切换，例如：

- `/api/v1/users/**`
- `/api/v1/workspaces/**`
- `/api/v1/orders/**`
- `/api/v1/quota/**`

不要把同一写流程中的不同步骤分散到 Go 与 Java。

### 8.2 灰度策略

按风险从低到高使用：

1. 内部测试账号。
2. 指定租户或工作空间。
3. 只读流量。
4. 小比例真实流量。
5. 全量流量。

支付回调、额度扣减等接口不适合随机百分比双处理，应按稳定业务键决定唯一处理方。

### 8.3 回滚

回滚不是简单改回路由。切流前必须明确：

- Java 是否已经写入数据。
- 是否产生消息或调用第三方。
- 旧服务是否仍能读取新状态。
- 在途请求、任务和消息如何排空。
- 是否需要先停止 Java 写入再恢复 Go。

任何不能回答上述问题的接口不得进入生产灰度。

## 9. 数据迁移方案

### 9.1 第一阶段不搬库

Java 服务直接兼容现有 PostgreSQL schema，但必须通过表所有权控制读写。

优点：

- 避免应用迁移和数据搬迁同时发生。
- 便于新旧结果对比和快速回滚。
- 保留现有主键和历史数据。

### 9.2 兼容性约束

- Java 的 `DO` 字段类型必须逐列核对数据库类型和空值语义。
- 时间、JSON、UUID、金额、枚举和布尔字段必须做专项测试。
- Go 中依赖零值的逻辑需显式转换为 Java 的默认值或空值规则。
- 复杂 SQL 必须核对执行计划、锁范围和影响行数。

### 9.3 后续拆库

只有服务迁移完成且表所有权稳定后，才评估按服务拆 schema 或拆实例。拆库属于后续架构演进，不作为本次 Java 重构的验收前提。

## 10. 质量与开发规范

### 10.1 合并门禁

每次合并至少满足：

- P3C PMD 无阻断问题。
- Checkstyle、SpotBugs 通过。
- 单元测试和集成测试通过。
- 新增业务分支有对应测试。
- OpenAPI 和错误码同步更新。
- Flyway 脚本通过空库和升级库验证。
- 无高危依赖漏洞、明文密钥和敏感日志。

### 10.2 评审清单

代码评审重点检查：

- Controller 是否包含业务逻辑或直接调用 Mapper。
- 是否把业务 DTO、Feign Client 或服务端接口放入中央共享模块。
- 事务是否过大，事务中是否存在远程调用。
- 是否错误地暴露 `DO` 或在层间复用同一对象。
- 是否有无界线程池、无界队列、无限重试或无超时调用。
- 是否正确处理空值、金额、时间和集合。
- SQL 是否命中索引、检查影响行数并限制批量大小。
- Seata 全局事务是否在白名单内，是否错误包含第三方调用、RabbitMQ 或长事务。
- 日志是否重复打印异常或泄露敏感数据。
- 消费者、定时任务和写接口是否具备幂等性。

### 10.3 测试最低要求

- 普通 Service：主要分支、异常分支和边界条件。
- Mapper：使用真实 PostgreSQL 容器验证 SQL。
- Controller：参数校验、鉴权、错误码和序列化。
- Feign Client：超时、降级、非 2xx 和错误响应。
- MQ Consumer：重复、乱序、失败重试和死信。
- Job：并发实例、断点续跑和重复执行。
- Seata AT/TCC：分支失败、全局超时、锁冲突、重复回调、空回滚、悬挂和 TC 重启。
- 计费与额度：状态机、守恒、并发、幂等和补偿全部覆盖。

## 11. 里程碑

| 里程碑 | 结果 |
|---|---|
| M0 方案冻结 | 架构、清单模板、规范、责任边界评审通过 |
| M1 技术底座 | Boot 4.0.6、Nacos、Sentinel、Gateway、RabbitMQ、Seata、CI 验证通过 |
| M2 身份基础 | `identity` 切流（认证、用户、系统管理） |
| M3 低风险域 | `support` 切流（通知与报表），完整迁移流程跑通 |
| M4 创作 | `creation` 切流（灵感、快照、评审），snapshot↔review 收敛为本地事务 |
| M5 额度 | `quota` 切流并完成守恒核对，作为 Seata TCC 被调方稳定 |
| M6 AI | `ai` 切流（模型路由、流式响应、使用量采集），ai↔quota TCC 链路就绪 |
| M7 计费 | `billing` 切流（订单、支付、充值、退款、对账），全量对账一致 |
| M8 中间件收口 | RabbitMQ 治理完成，Seata 白名单场景和高可用运维能力就绪 |
| M9 收口 | Spring Cloud Gateway 成为唯一入口，Kong 和 Go 运行实例下线 |

里程碑按退出条件验收，不按计划日期强行切流。

## 12. 风险登记

| 风险 | 影响 | 控制措施 |
|---|---|---|
| Spring Boot 4.0.6 与生态依赖兼容不足 | 无法启动或运行时异常 | 先完成 BOM 和关键 Starter 验证 |
| Go 零值与 Java 空值语义不同 | 数据或接口行为变化 | 逐字段契约测试和黄金样例 |
| 新旧服务同时写同一状态 | 账务、额度不一致 | 单一写入方、稳定路由、切流排空 |
| gRPC 与 HTTP 错误语义不同 | 调用方误判 | 固定错误码映射和契约测试 |
| 消息重复或乱序 | 重复扣减、重复通知 | 事件 ID、幂等表、状态机和死信重放 |
| RabbitMQ 发布成功但本地事务失败，或反之 | 数据与事件不一致 | 本地事务发件箱、发布确认和补偿扫描 |
| Seata AT 全局锁竞争 | 延迟升高或事务超时 | 场景白名单、短事务、锁范围评审和容量测试 |
| Seata 回滚失败或 TC 不可用 | 脏数据或业务阻塞 | TC 高可用、回滚校验、告警和人工处置手册 |
| TCC 空回滚、悬挂或重复执行 | 资源状态错误 | 防悬挂记录、Confirm/Cancel 幂等和故障注入 |
| 定时任务多实例重复执行 | 重复关单或过期 | 数据库抢占、分片和幂等 |
| 网关承载业务逻辑 | 边界混乱、难以测试 | 架构门禁和依赖检查 |
| 建立中央接口和 DTO 聚合模块 | 服务编译耦合、版本联动 | OpenAPI 作为契约，Feign Client 默认由调用方维护 |
| 公共模块持续膨胀 | 服务耦合和循环依赖 | 白名单、依赖方向检查、架构评审 |
| 迁移期双网关增加延迟 | P99 上升 | 仅灰度期使用，监控并尽快收口 |
| 把所有跨服务写入都纳入 Seata | 耦合、锁冲突和可用性下降 | 事务矩阵评审，本地事务与异步最终一致性优先 |

## 13. 人员与协作建议

每个业务域至少明确：

- 业务负责人：确认行为和验收样例。
- Java 实现负责人：负责服务代码和测试。
- 旧系统负责人：解释 Go 行为并确认兼容性。
- 数据负责人：负责表所有权、SQL 和对账。
- 测试负责人：负责契约、端到端和故障用例。
- 运维负责人：负责灰度、监控、告警和回滚。

支付、额度和认证切流必须由业务、研发、测试和运维共同确认。

## 14. 当前阶段交付物

当前只交付：

1. `docs/技术架构.md`：目标架构、服务边界和开发规范。
2. `docs/后端Java重构方案.md`：阶段、灰度、回滚和验收方案。
3. `dramaip-platform/legacy/go-services/`：原 Go 后端归档位置。
4. `dramaip-platform/server/README.md`：Java 目标目录说明。

当前阶段明确不包含：

- Maven `pom.xml`。
- Java 启动类。
- Java 公共模块。
- Java 测试代码。
- Java 构建产物。

Java 工程只有在方案评审通过并进入实施阶段后才创建。
