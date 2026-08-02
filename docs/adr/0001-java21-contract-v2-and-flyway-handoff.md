# ADR-0001：JDK 21、契约 2 与数据库迁移接管

**状态：已接受**  
**日期：2026-07-31**

## 决策

1. Java 后端统一使用 JDK 21、Spring Boot 4.0.6、Spring Cloud 2025.1.0、Spring Cloud Alibaba 2025.1.0.0、Nacos 3.1.1 和 Seata 2.5.0。
2. 公共 HTTP 使用契约 2：Java 仅提供资源化 `/api/v1/**`，请求必须带 `X-DramaIP-Contract-Version: 2`，响应统一为 `Result<T>`：`code`、`message`、`data`、`requestId`、`traceId`。
3. 历史的 001–049 前向 SQL 是不可改动的接管基线。独立 `migration` Job 在空库顺序执行这份基线；在已有库验证 `schema_migrations` 干净且连续到 49 后，显式建立 Flyway 49 baseline。只允许 `V050+` 由 Java 继续全局递增，生产环境禁止 `baselineOnMigrate`。
4. 迁移顺序固定为 identity → notification → reporting → creation → quota → ai → billing。AI 与账务均通过 quota 的 TCC 预占/确认/取消流程协调，不使用 Seata AT 包裹第三方调用或消息发布。

## 后果

- 客户端使用契约 2 的 `/api/v1/**`。
- 每个服务独立校验 JWT，网关只做首次边界校验、路由、限流、CORS 和链路上下文。
- 生产环境始终保持单一写入方，并在发布前排空在途工作。
