# 尽意 DramaIP Platform

> **尽作者之意，成万象之作**

尽意 DramaIP 当前定位是“面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台”，长期愿景是成为创作者拥有的本地优先 IP 操作系统。完整口径见[产品定位](../docs/product/POSITIONING.md)。

本目录是闭源云端平台工作区，包含 Web、Mobile、Admin、部署资产和后端服务。Platform 提供无项目灵感入口、账号、订阅、可选协作与审片、公共创意语料治理和运营能力；Desktop 仍是故事母本、小说、剧本、分镜、版本与来源的本地权威创作环境。Platform 不把私人正文或未采用对话自动同步为云端权威内容。

小说写作是可独立完成的一等能力，不仅是云端向 Desktop 输送改编素材。官网、案例与商业化分别表达小说稿件/投稿、改编剧本/试制交付两类价值，不强制作者进入媒体制作。可选云能力不成为本地写作的依赖；协作、审片和跨端范围按当前实现逐项说明，优化目标见 [执行计划](../docs/PLAN.md)。

后端使用 JDK 21 的 Java / Spring Cloud Alibaba 运行时。

## 文档

官网案例按根 PLAN 22.93 的限定范围校正：`/cases/story` 是作者编写的展示稿，`/cases/demo` 是历史受控制作说明；不保证当前 Desktop 安装包含样片，不把 Mock、示意场景卡、许可元数据或目标流程称作真实模型质量、账单、完整授权或发行回执。2026-10-04 本轮全客户端 lint／类型／测试、契约 v2、Web 构建与 14 条静态路由检查通过；真实公开案例和授权批准仍留在外部验收。本次只改本地源码，没有部署、收费变更或启动普通应用。

2026-10-07 PLAN22.202补齐当前作者展示成果：案例首页分独立小说、改编和历史制作；`/cases/story`两章原文与记忆可独立下载TXT，不是完整小说。改编展示含三诊断、两策略、三集季纲、完整首集三场剧本与六镜头，明确来源／作者新增／未读后续，四文件固定在`/cases/story/files/`（manuscript.txt、pilot.fountain、storyboard.csv、adaptation-demo.json）。页面与下载共用本Platform展示内容，不读取Desktop或私人数据；JSON不是DramaIP项目包，作者展示标签不认证真人身份、实际模型／采用、公开许可、质量或发行。尚未部署，没有改变Java契约、价格、支付或权益。

本版Web15测试及完整客户端lint／类型／契约／测试、Web构建通过；自身后台临时standalone的真实HTTP检查通过四个附件字节与头、页面链接及未知文件404。可在`platform/clients/`先`pnpm run build:web`，再`pnpm --filter @dramaip/web run smoke:cases`复验；后者只起自己的127.0.0.1临时Web进程并在退出时清理，不启动Java／浏览器、不抢焦点、不杀占用端口。Node24.18的`make web-route-smoke`另核15源码身份；不是浏览器布局／原生下载交互、外部Fountain／CSV导入、真实用户评测或生产部署验收。

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
python3 run-platform-dev.py
python3 run-platform-clients.py

# 或只管理后端 Compose 栈
cd platform
make platform-up
make platform-e2e
make platform-down
```

客户端依赖与 Web/Admin 工具链固定为 pnpm 11.28.5；Mobile 的 Expo 运行时仍需 Node.js。手动运行命令见[本地开发手册](docs/LOCAL_DEVELOPMENT.md)。

本地可观测性使用 Prometheus、OpenTelemetry Java Agent、Alloy、Loki、Tempo 和 Grafana：Compose Java 使用 `make platform-observability-up`，宿主机 Java 调试使用 `python3 run-platform-dev.py --obs`。详见[本地开发手册](docs/LOCAL_DEVELOPMENT.md)和[可观测性 runbook](docs/OBSERVABILITY.md)。

CI/CD 验证、构建、扫描和发布九个 Java 镜像与一个 Web 镜像。发布前先运行 `deploy/release/preflight.sh`；经审批后使用 `deploy/release/helm-release.sh <staging|production> <apply|rollback>`。`deploy/release/check-manifest.sh` 是镜像清单的唯一校验入口。

## 灵感空间

Web 的 `/inspiration` 是不依赖项目的长期创意对话入口，`/chat` 只保留重定向。AI 服务是云端会话、消息、事件、摘要、记忆、卡片和项目简报 Preview 的唯一写入者；Web 不再把浏览器最近消息作为权威上下文。旧 `dramaip.author-chat.v1.<userId>` 历史仅在用户明确同意后导入，成功前不会删除。

Desktop 与 Web 的会话、私人语料、创意指纹和长期记忆不自动同步。用户确认转项目后，Web 保存 `kind=project` 云端草稿并生成 schema v4 创作简报包；包中只包含用户选中的简报、卡片、抽象语料和脱敏谱系，Desktop 通过既有项目包预览流程导入。

公共创意语料由 AI 服务唯一写入和治理。采集能力默认关闭，只处理公开 HTTP/HTTPS 内容；不绕过登录、付费墙、验证码、robots 或站点限制。网页正文采用应用层加密，最长暂存 7 天，长期只保留来源、哈希、至多 500 字符短摘录和抽象机制。上线顺序与下架流程见[创意语料治理与下架手册](docs/CREATIVE_CORPUS_OPERATIONS.md)。

## 数据库约束

- 任一业务表同一时刻只能有一个权威写入实现。
- Java 仅提供契约 2 的 `/api/v1/**`、`X-DramaIP-Contract-Version: 2` 和 `Result<T>`。
- billing、quota、ai-gateway 必须分别完成并发、对账和回滚演练。
