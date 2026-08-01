# DramaIP Platform

DramaIP 的闭源云端平台工作区，包含 Web、Mobile、Admin、部署资产和后端服务。

后端已收口为 JDK 21 的 Java / Spring Cloud Alibaba 运行时。`legacy/go-services`
保留为归档和人工回滚参考，但默认本地、CI/CD 和 Helm 发布均不会启动或构建 Go 服务。

## 文档

- [技术架构](../docs/技术架构.md)
- [后端 Java 重构方案](../docs/后端Java重构方案.md)
- [Java 本地开发与切流手册](deploy/docker-drama/JAVA_MIGRATION_RUNBOOK.md)
- [归档 Go 平台基线](docs/PLATFORM_BASELINE.md)

## 目录

```text
clients/                    Web、Mobile、Admin 和 TypeScript SDK
server/                     Java 21 Maven 工程（migration、gateway 和六个业务服务）
legacy/go-services/         归档的 Go/Kratos 旧后端、契约与迁移参考
deploy/                     Java Compose、Helm 和发布资产
docs/                       平台开发与运维文档
scripts/                    E2E 和可观测性检查
```

## 当前开发入口

后端与 Web 客户端分开启动。先启动 Java migration、Gateway、identity、support、creation、quota、ai、billing
及所需基础设施，再启动 Web 客户端；浏览器 API 通过 Java Gateway 的 `http://localhost:8080/api/v1` 访问：

```bash
python run-platform.py
python run-platform-clients.py

# 或只管理后端 Compose 栈
cd dramaip-platform
make platform-up
make platform-e2e
make platform-down
```

CI/CD 仅验证、构建、扫描和发布八个 Java 镜像与 Web 镜像。`/v1/**`、Kong 和 Go
服务只存在于 legacy/rollback 资产，不能通过默认启动命令进入运行态。

## 迁移约束

- 旧 Go 目录只接受归档、兼容和迁移阻塞修复，不再参与默认构建或发布。
- 任一业务表同一时刻只能有一个权威写入实现。
- Java 仅提供契约 2 的 `/api/v1/**`、`X-DramaIP-Contract-Version: 2` 和 `Result<T>`。
- billing、quota、ai-gateway 必须分别完成并发、对账和回滚演练。
- Java 全量稳定并度过观察窗前，不删除 Go 源码和回滚资产。
