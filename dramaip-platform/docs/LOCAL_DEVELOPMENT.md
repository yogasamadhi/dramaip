# 本地开发（Java）

当前本地运行时是 JDK 21 的 Java 平台：Gateway、独立 migration Job、identity、support、creation、quota、ai 和 billing。公共入口为 Gateway `http://localhost:8080`，业务接口使用 `/api/v1/**` 并要求 `X-DramaIP-Contract-Version: 2`。

Go/Kratos 与 Kong 仅作为迁移归档/回滚材料保留在 `legacy/go-services`，不会被默认命令启动；迁移验收完成后再统一删除。

## 前置条件

- Docker Desktop（Windows 和 macOS 均使用本机 Linux containers 模式）
- JDK 21、全局 Apache Maven 3.9+、Node.js 20+、pnpm（运行 Web 时）

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

仅在本机 JDK 中调试 Java 服务、并把 PostgreSQL/Redis/RabbitMQ/MinIO/Nacos/Seata 留在 Docker 时，使用：

```powershell
python .\run-platform-dev.py
```

该命令不会启动任何 Java 容器。它会停止已有的 Compose Java 应用容器、使用全局 Maven 在本地打包并执行 migration，然后启动本地 Gateway（`8080`）及六个服务（`8081`–`8086`）。Ctrl+C 只停止本地 Java 进程，Docker 基础设施继续运行。

启动器会启动 Java Compose profile、等待 Gateway 的 `/actuator/health`，然后启动 Web 开发服务器。只管理后端时可使用：

```bash
cd dramaip-platform
make platform-up
make platform-e2e
make platform-down
```

等价的直接 Compose 命令为：

```bash
mvn -B -ntp -DskipTests -f server/pom.xml package
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java up -d --build
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java logs -f java-gateway identity
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java down
```

Java profile 包含 PostgreSQL、Redis、RabbitMQ、MinIO、Nacos、Seata、migration Job、Gateway 和六个 Java 业务服务，不包含任何 Go/Kratos 服务或 Kong。可观测性栈按需额外启动：

```bash
docker compose -f deploy/docker-drama/docker-compose.yaml --profile java --profile observability up -d
```

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

## 验证

```bash
cd dramaip-platform/server
mvn -B -ntp verify

cd ..
node scripts/java-platform-e2e.mjs
```

`java-platform-e2e.mjs` 验证 Gateway 健康检查、契约版本缺失时的拒绝行为，以及携带契约头的受保护资源请求。完整业务验证由各服务的 Maven 测试、客户端契约测试与发布前预检完成。

## 常见问题

- 端口被占用：检查 `5432`、`5672`、`6379`、`8080`、`8848`、`8091`、`9000`、`9001`、`15672`。Windows 可使用 `netstat -ano -p TCP`，macOS 可使用 `lsof -nP -iTCP -sTCP:LISTEN`。
- Docker daemon 不可用：先启动 Docker Desktop，再执行启动器。
- Gateway 未就绪：执行 `docker compose -f deploy/docker-drama/docker-compose.yaml --profile java logs java-gateway identity java-migration`。
- 首次构建较慢：Docker 需要下载与当前 CPU 架构匹配的基础镜像；后续构建会复用本机缓存。
