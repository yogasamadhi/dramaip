# 本地开发（Java）

本文仅覆盖 [Platform 云端职责](../README.md) 的开发环境，不是 Desktop 小说/改编的运行前提。按 [产品定位](../../docs/product/POSITIONING.md)，小说可独立创作与稿件交付，媒体、协作和云能力保持可选；启动本地云平台不意味着私人正文自动同步或计划中的跨端工作流已实现。

当前本地运行时是 JDK 21 的 Java 平台：Gateway、独立 migration Job、identity、notification、reporting、creation、quota、ai 和 billing。公共入口为 Gateway `http://localhost:8080`，业务接口使用 `/api/v1/**` 并要求 `X-DramaIP-Contract-Version: 2`。

## 前置条件

- Docker Desktop（Windows 和 macOS 均使用本机 Linux containers 模式）
- JDK 21、全局 Apache Maven 3.9+、pnpm 11.28.5（Web、Admin、SDK 工具链）和 Node.js 20+（Mobile Expo 运行时）

不要强制 Docker 平台。Docker Desktop 会按当前主机选择 amd64 或 arm64 的多架构镜像。服务 JAR 由本机 JDK 21/全局 Maven 构建，Docker 仅使用 `amazoncorretto:21-alpine` 将其封装为运行时镜像。

## 启动

在仓库根目录使用当前的 Node 启动器。它只在本机 JDK 中运行 Java 服务，并把 PostgreSQL、Redis、RabbitMQ、MinIO、Nacos MySQL、Nacos 和 Seata 留在 Docker：

```powershell
pnpm run .\run-platform-dev.ts
```

该命令不会启动任何 Java 容器。它会停止已有的 Compose Java 应用容器、使用全局 Maven 在本地打包并执行 migration，然后启动本地 Gateway（`8080`）及七个服务（`8081`–`8087`）。Ctrl+C 只停止本地 Java 进程，Docker 基础设施继续运行。

本地 migration 会续跑开发卷中尚未执行的历史 001–049 SQL，再建立 Flyway 49 基线；该兼容开关仅由本地启动器启用，生产环境仍要求迁移账本预先完整。启动器也会让 PostgreSQL、RabbitMQ、Nacos 等回环 TCP 连接绕过 JVM SOCKS 代理，HTTP/HTTPS 外部代理配置不受影响。

Web、Admin 与 Mobile 由独立的 `pnpm run run-platform-clients.ts` 启动器管理，不由宿主机 Java 启动器自动启动。若选择 Compose 后端而非宿主机 Java 进程，可使用：

```bash
cd platform
make platform-up
make platform-e2e
make platform-down
```

CI 使用 Maven 阶段已经产出的可执行 JAR，并以随机宿主端口隔离并发任务。该目标会同时启动完整观测栈，先执行业务 E2E，再执行 metrics/logs/traces 关联及敏感 canary 门禁：

```bash
make platform-ci-e2e
make platform-ci-down
```

客户端 workspace 使用 pnpm 11.28.5。Web、Admin 和 SDK 的开发、构建、检查和测试均由 pnpm 执行；Mobile 由 pnpm 调度，
但 Expo CLI 和安全 smoke 明确使用 Node 运行：

```bash
cd platform/clients
pnpm install
pnpm run dev:web
pnpm run dev:admin
pnpm run dev:mobile
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
./deploy/docker-drama/scripts/init-data-dirs.sh
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java --profile observability up -d --remove-orphans
```

推荐使用已封装的观测入口。它会在 Java 镜像中启用 OTel Java Agent：trace 通过 OTLP HTTP 发给 Alloy，metrics 仍由 Micrometer 暴露并由 Prometheus 拉取，结构化 stdout 由 Alloy 写入 Loki；普通 `make platform-up` 仍不挂 Agent：

```bash
cd platform
make platform-observability-up
make platform-observability-smoke
make platform-observability-down
```

本机 JDK 调试也可启用同一套栈：

```bash
pnpm run run-platform-dev.ts --obs
pnpm run run-platform-dev.ts --obs --services creation,quota
pnpm run run-platform-dev.ts --obs --services creation --no-gateway --smoke
```

`--obs` 会先启动 Prometheus、Alloy、Loki、Tempo 与 Grafana，再以 `127.0.0.1:4318` 作为 OTLP 地址运行 migration 和选中的 Java 进程。Alloy 额外读取 `server/target/local-dev/*.log` 的 NDJSON；Prometheus 的 file-SD 文件只列出实际启动的 `host.docker.internal:8080–8087`，所以子集调试不会产生伪 Java `TargetDown`。`--skip-package --obs` 要求 `server/target/observability/opentelemetry-javaagent.jar` 已由一次 Maven package 生成。Ctrl+C 仍只停止本机 Java；使用 `make platform-observability-down` 停止观测容器。

本地 Compose 的 trace sampler 固定为 `always_on`。宿主机 `--obs` 默认同样使用 `always_on`，可为采样实验同时设置 `OTEL_TRACES_SAMPLER=traceidratio`（或 `parentbased_traceidratio`）和 `OTEL_TRACES_SAMPLER_ARG=0`–`1`；非 ratio sampler 不应设置参数。宿主机默认 resource 属性为 `deployment.environment.name=local`、`service.version=development`、`service.namespace=dramaip-platform`、`dramaip.release=host-local`，`service.name` 由各进程设置。resource/span 属性不得加入用户、正文、Prompt、凭据、业务主键或其他高基数值。

这里的 Grafana `dramaip`/`dramaip` 仅是 loopback 本地 Compose 开发凭据，不是 Helm 内置栈或生产凭据。Helm 内置栈使用 Kubernetes Secret、ClusterIP 和可选 ingress-only NetworkPolicy；持久化 `hostPath` 还是需要固定节点的单节点开发存储。完整 sampler、资源预算、Secret、网络、敏感遥测、异步/Outbox/RabbitMQ Trace 和外部告警契约见[可观测性 runbook](./OBSERVABILITY.md)。

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
| Prometheus（启用 observability profile 后） | `http://localhost:9090` |
| Alloy（启用 observability profile 后） | `http://localhost:12345`；OTLP `4317/4318` |
| Loki（启用 observability profile 后） | `http://localhost:3100` |
| Tempo（启用 observability profile 后） | `http://localhost:3200` |
| Grafana（启用 observability profile 后） | `http://localhost:3000`（`dramaip` / `dramaip`） |

## 验证

```bash
cd platform/server
mvn -B -ntp verify

cd ..
node scripts/java-platform-e2e.mjs
```

`java-platform-e2e.mjs` 经 Gateway 执行完整阻塞旅程：健康和契约拒绝、注册、套餐与模拟支付、订阅与额度、草稿创建/查询/删除，以及刷新令牌轮换、重放拒绝和吊销。脚本不连接真实 AI 供应商；所有业务响应同时校验 `Result<T>`、`requestId` 和 `traceId`。

观测 smoke 会向公开登录端点发送固定 `traceparent` 和无效 JSON，不会创建用户或订单；它验证 Gateway→identity trace 可由 Tempo 查询、响应/REST trace ID 一致、Prometheus Java target 健康，以及同一 `trace_id`/`request_id` 的 structured metadata 可由 Loki 查询且未成为索引标签。`make platform-observability-smoke` 还会短暂启动仅属于 `observability-test` profile 的日志 canary：干净 witness 必须进入 Loki，而分别只包含合成 Authorization、Cookie、password、secret、API/private key、credential、token、Prompt、请求正文或用户标识的记录必须被 Alloy 整条拒绝。测试还会直接向 Alloy 发送一条携带这些敏感属性的 OTLP Trace，确认 collector 过滤器本身生效，而不是仅依赖应用自动埋点不采集。canary 不是实际凭据，测试不会输出它的值。告警、指标契约和排障入口见[可观测性 runbook](./OBSERVABILITY.md)。

## 常见问题

- 端口被占用：除业务端口外，观测模式还需检查 `3000`、`3100`、`3200`、`4317`、`4318`、`9090`、`12345`。Windows 可使用 `netstat -ano -p TCP`，macOS 可使用 `lsof -nP -iTCP -sTCP:LISTEN`。
- Docker daemon 不可用：先启动 Docker Desktop，再执行启动器。
- Gateway 未就绪：执行 `docker compose -f deploy/docker-drama/docker-compose.yaml --profile java logs java-gateway identity java-migration`。
- 首次构建较慢：Docker 需要下载与当前 CPU 架构匹配的基础镜像；后续构建会复用本机缓存。
