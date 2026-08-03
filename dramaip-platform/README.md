# DramaIP Platform

DramaIP 的闭源云端平台工作区，包含 Web、Mobile、Admin、部署资产和后端服务。

后端使用 JDK 21 的 Java / Spring Cloud Alibaba 运行时。

## 文档

- [技术架构](../docs/技术架构.md)
- [本地开发手册](docs/LOCAL_DEVELOPMENT.md)

## 目录

```text
clients/                    Web、Mobile、Admin 和 TypeScript SDK
server/                     Java 21 Maven 工程（migration、gateway 和七个业务服务）
deploy/                     Java Compose、Helm 和发布资产
docs/                       平台开发与运维文档
scripts/                    E2E 和可观测性检查
```

## 当前开发入口

后端与 Web 客户端分开启动。先启动 Java migration、Gateway、identity、notification、reporting、creation、quota、ai、billing
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

本地可观测性（Prometheus、Jaeger、Elastic Stack、Grafana）使用 `make platform-observability-up`；宿主机 Java 调试使用 `python run-platform-dev.py --obs`。详见[本地开发手册](docs/LOCAL_DEVELOPMENT.md)。

CI/CD 验证、构建、扫描和发布九个 Java 镜像与 Web 镜像。

## 数据库约束

- 任一业务表同一时刻只能有一个权威写入实现。
- Java 仅提供契约 2 的 `/api/v1/**`、`X-DramaIP-Contract-Version: 2` 和 `Result<T>`。
- billing、quota、ai-gateway 必须分别完成并发、对账和回滚演练。
