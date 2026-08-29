# 本地开发（Java）

当前本地运行时是 JDK 21 的 Java 平台：Gateway、独立 migration Job、identity、notification、reporting、creation、quota、ai 和 billing。公共入口为 Gateway `http://localhost:8080`，业务接口使用 `/api/v1/**` 并要求 `X-DramaIP-Contract-Version: 2`。

## 前置条件

- Docker Desktop（Windows 和 macOS 均使用本机 Linux containers 模式）
- JDK 21、全局 Apache Maven 3.9+、Bun 1.4.0（Web、Admin、SDK 工具链）和 Node.js 20+（Mobile Expo 运行时）

不要强制 Docker 平台。Docker Desktop 会按当前主机选择 amd64 或 arm64 的多架构镜像。服务 JAR 由本机 JDK 21/全局 Maven 构建，Docker 仅使用 `amazoncorretto:21-alpine` 将其封装为运行时镜像。

## 启动

Windows PowerShell：

```powershell
python .\run-platform.py
```

macOS：

```bash
python3 run-platform.py
```

仅在本机 JDK 中调试 Java 服务、并把 PostgreSQL/Redis/RabbitMQ/MinIO/Nacos MySQL/Nacos/Seata 留在 Docker 时，使用：

```powershell
bun run .\run-platform-dev.ts
```

该命令不会启动任何 Java 容器。它会停止已有的 Compose Java 应用容器、使用全局 Maven 在本地打包并执行 migration，然后启动本地 Gateway（`8080`）及七个服务（`8081`–`8087`）。Ctrl+C 只停止本地 Java 进程，Docker 基础设施继续运行。

本地 migration 会续跑开发卷中尚未执行的历史 001–049 SQL，再建立 Flyway 49 基线；该兼容开关仅由本地启动器启用，生产环境仍要求迁移账本预先完整。启动器也会让 PostgreSQL、RabbitMQ、Nacos 等回环 TCP 连接绕过 JVM SOCKS 代理，HTTP/HTTPS 外部代理配置不受影响。

启动器会启动 Java Compose profile、等待 Gateway 的 `/actuator/health`，然后启动 Web 开发服务器。只管理后端时可使用：

```bash
cd platform
make platform-up
make platform-e2e
make platform-down
```

CI 使用 Maven 阶段已经产出的可执行 JAR，并以随机宿主端口隔离并发任务：

```bash
make platform-ci-e2e
make platform-ci-down
```

客户端 workspace 使用 Bun 1.4.0。Web、Admin 和 SDK 的开发、构建、检查和测试均由 Bun 执行；Mobile 由 Bun 调度，
但 Expo CLI 和安全 smoke 明确使用 Node 运行：

```bash
cd platform/clients
bun install
bun run dev:web
bun run dev:admin
bun run dev:mobile
```

等价的直接 Compose 命令为：

```bash
mvn -B -ntp -DskipTests -f server/pom.xml package
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java up -d --build
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java logs -f java-gateway identity
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java down
```

Java profile 包含 PostgreSQL、Redis、RabbitMQ、MinIO、Nacos MySQL、Nacos、Seata、migration Job、Gateway 和七个 Java 业务服务。Nacos 使用本机已有的 `mysql:8` 镜像，数据保存在 `deploy/docker-drama/docker-data/nacos-mysql`；首次启动会从同版本 Nacos 镜像导出的官方 schema 自动建表。默认数据库和账户为 `nacos_config` / `nacos` / `nacos`，可分别通过 `NACOS_MYSQL_DATABASE`、`NACOS_MYSQL_USER`、`NACOS_MYSQL_PASSWORD`、`NACOS_MYSQL_ROOT_PASSWORD` 覆盖；这些 MySQL 初始化变量只会在空数据目录的首次启动时生效。可观测性栈按需额外启动：

```bash
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java --profile observability up -d
```

推荐使用已封装的观测入口。它会在 Java 镜像中启用 OTel Java Agent（traces 走 OTLP HTTP，metrics 仍由 Micrometer/Prometheus 抓取，日志仍由 Filebeat 采集），并保留普通 `make platform-up` 不挂 Agent 的行为：

```bash
cd platform
make platform-observability-up
make platform-observability-smoke
make platform-observability-down
```

本机 JDK 调试也可启用同一套栈：

```bash
bun run run-platform-dev.ts --obs
bun run run-platform-dev.ts --obs --services creation,quota
bun run run-platform-dev.ts --obs --services creation --no-gateway --smoke
```

`--obs` 会先启动 Prometheus、Collector、Jaeger、Elasticsearch、Kibana、Filebeat 与 Grafana，再以 `127.0.0.1:4318` 作为 OTLP 地址运行 migration 和选中的 Java 进程。Prometheus 的 file-SD 文件仅列出实际启动的 `host.docker.internal:8080–8087`，所以子集调试不会产生伪 TargetDown。`--skip-package --obs` 要求 `server/target/observability/opentelemetry-javaagent.jar` 已由一次 Maven package 生成。Ctrl+C 仍只停止本机 Java；使用 `make platform-observability-down` 停止观测容器。

## 本地地址

| 组件 | 地址 |
| --- | --- |
| Web | `http://localhost:3009` |
| Java Gateway | `http://localhost:8080` |
| Gateway health | `http://localhost:8080/actuator/health` |
| Nacos API | `http://localhost:8848` |
| Nacos Console | `http://localhost:8849` |
| Nacos gRPC（本机 Java 开发） | `localhost:9848` |
| RabbitMQ 管理台 | `http://localhost:15672` |
| MinIO Console | `http://localhost:9001` |
| Elasticsearch（启用 observability profile 后） | `http://localhost:9200` |
| Kibana（启用 observability profile 后） | `http://localhost:5601` |
| Prometheus（启用 observability profile 后） | `http://localhost:9090` |
| Jaeger（启用 observability profile 后） | `http://localhost:16686` |
| Grafana（启用 observability profile 后） | `http://localhost:3000`（`dramaip` / `dramaip`） |

## 验证

```bash
cd platform/server
mvn -B -ntp verify

cd ..
node scripts/java-platform-e2e.mjs
```

`java-platform-e2e.mjs` 经 Gateway 执行完整阻塞旅程：健康和契约拒绝、注册、套餐与模拟支付、订阅与额度、草稿创建/查询/删除，以及刷新令牌轮换、重放拒绝和吊销。脚本不连接真实 AI 供应商；所有业务响应同时校验 `Result<T>`、`requestId` 和 `traceId`。

观测 smoke 会向公开登录端点发送固定 `traceparent` 和无效 JSON，不会创建用户或订单；它验证 Gateway→identity trace、响应/REST trace ID、Prometheus Java target 以及 Elasticsearch 的结构化访问日志一致。告警、指标契约和排障应通过 Prometheus、Grafana、Jaeger 与 Elasticsearch 的本地界面，以及[本地观测 runbook](./OBSERVABILITY.md)核验。

## 常见问题

- 端口被占用：检查 `5432`、`5672`、`6379`、`8080`、`8848`、`8091`、`9000`、`9001`、`15672`。Windows 可使用 `netstat -ano -p TCP`，macOS 可使用 `lsof -nP -iTCP -sTCP:LISTEN`。
- Docker daemon 不可用：先启动 Docker Desktop，再执行启动器。
- Gateway 未就绪：执行 `docker compose -f deploy/docker-drama/docker-compose.yaml --profile java logs java-gateway identity java-migration`。
- 首次构建较慢：Docker 需要下载与当前 CPU 架构匹配的基础镜像；后续构建会复用本机缓存。
