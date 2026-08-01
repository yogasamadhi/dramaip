# Retired Go source location

Java / Spring Cloud Alibaba implementation now lives in [`../server/`](../server/README.md).
The preserved Go/Kratos module (including its original module path) lives in [`../legacy/go-services/`](../legacy/go-services/README.md).

目标后端采用 Spring Cloud Gateway 统一入口，客户端直接访问业务归属服务，不按
Web、桌面端、移动端或管理端拆分后端适配服务。

消息中间件统一使用 RabbitMQ；分布式事务基础设施使用 Seata 2.5.0，并按事务矩阵
对白名单 AT/TCC 场景启用。

## 目录组织

本目录按「基础设施层 + 业务服务层」两级组织：

```text
server/
├─ pom.xml                 # 父 POM、聚合模块、dependencyManagement
├─ common/                 # 基础设施层：扁平单一公共技术能力模块
├─ gateway/                # 基础设施层：Spring Cloud Gateway 统一入口
└─ services/               # 业务服务层：每个子目录是一个独立可部署业务服务
   ├─ identity/            # 认证、用户、工作空间、管理后台（合并 auth+user+system）
   ├─ billing/             # 订单、支付、充值、退款、账务流水
   ├─ quota/               # 额度账户、预占、扣减、释放、到期任务
   ├─ ai/                  # 模型供应商接入、模型路由、调用策略
   ├─ creation/            # 灵感、快照、评审等创作流程
   └─ support/             # 通知（站内信/短信/邮件）与报表（合并 notification+reporting）
```

- **基础设施层**（`server/` 顶层）：`common`、`gateway`——支撑所有业务服务的技术能力，不属任何单一业务域。
- **业务服务层**（`server/services/`）：六个独立部署单元，各自独立打镜像、独立扩缩容。
- 模块名不带 `dramaip-` 前缀（Maven artifactId 跟随模块名）；Java 包名仍保留 `com.dramaip.platform.<service>` 反向域名。

技术基线、目标模块和分阶段迁移顺序见：

- [`../../docs/技术架构.md`](../../docs/技术架构.md)
- [`../../docs/后端Java重构方案.md`](../../docs/后端Java重构方案.md)

本目录仅保留该迁移说明，不能作为构建或运行入口。
