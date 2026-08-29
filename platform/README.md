# DramaIP Platform

DramaIP 的闭源云端平台工作区，包含 Web、Mobile、Admin、部署资产和后端服务。

后端使用 JDK 21 的 Java / Spring Cloud Alibaba 运行时。

## 文档

- [后端技术架构](../docs/后端技术架构.md)
- [本地开发手册](docs/LOCAL_DEVELOPMENT.md)
- [创意语料治理与下架手册](docs/CREATIVE_CORPUS_OPERATIONS.md)

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
bun run run-platform-dev.ts
bun run run-platform-clients.ts

# 或只管理后端 Compose 栈
cd platform
make platform-up
make platform-e2e
make platform-down
```

客户端依赖与 Web/Admin 工具链固定为 Bun 1.4.0；Mobile 的 Expo 运行时仍需 Node.js。手动运行命令见[本地开发手册](docs/LOCAL_DEVELOPMENT.md)。

本地可观测性（Prometheus、Jaeger、Elastic Stack、Grafana）使用 `make platform-observability-up`；宿主机 Java 调试使用 `bun run run-platform-dev.ts --obs`。详见[本地开发手册](docs/LOCAL_DEVELOPMENT.md)。

CI/CD 验证、构建、扫描和发布九个 Java 镜像与一个 Web 镜像。发布前先运行 `deploy/release/preflight.sh`；经审批后使用 `deploy/release/helm-release.sh <staging|production> <apply|rollback>`。`deploy/release/check-manifest.sh` 是镜像清单的唯一校验入口。

## 灵感空间

Web 的 `/inspiration` 是不依赖项目的长期创意对话入口，`/chat` 只保留重定向。AI 服务是云端会话、消息、事件、摘要、记忆、卡片和项目简报 Preview 的唯一写入者；Web 不再把浏览器最近消息作为权威上下文。旧 `dramaip.author-chat.v1.<userId>` 历史仅在用户明确同意后导入，成功前不会删除。

Desktop 与 Web 的会话、私人语料、创意指纹和长期记忆不自动同步。用户确认转项目后，Web 保存 `kind=project` 云端草稿并生成 schema v4 创作简报包；包中只包含用户选中的简报、卡片、抽象语料和脱敏谱系，Desktop 通过既有项目包预览流程导入。

公共创意语料由 AI 服务唯一写入和治理。采集能力默认关闭，只处理公开 HTTP/HTTPS 内容；不绕过登录、付费墙、验证码、robots 或站点限制。网页正文采用应用层加密，最长暂存 7 天，长期只保留来源、哈希、至多 500 字符短摘录和抽象机制。上线顺序与下架流程见[创意语料治理与下架手册](docs/CREATIVE_CORPUS_OPERATIONS.md)。

## 数据库约束

- 任一业务表同一时刻只能有一个权威写入实现。
- Java 仅提供契约 2 的 `/api/v1/**`、`X-DramaIP-Contract-Version: 2` 和 `Result<T>`。
- billing、quota、ai-gateway 必须分别完成并发、对账和回滚演练。
