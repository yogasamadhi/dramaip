# 尽意 DramaIP

> **尽作者之意，成万象之作**
>
> 面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台

尽意 DramaIP 面向原创作者和小型内容团队，把创意或长篇小说转化为经过连续性、节奏、钩子和制作风险检查的分集剧本、分镜与交付包。小说创作是建立故事母本的上游核心之一，短剧/漫剧改编是当前转化核心；图片、声音与视频模型作为可替换的生产出口接入。作品、版本、来源和最终采用权始终由创作者掌握。

长期愿景是成为创作者拥有的本地优先 IP 操作系统；当前市场定位、首要用户、英雄流程和产品边界以[产品定位](./docs/product/POSITIONING.md)为准。

仓库包含两个边界独立的子项目：

- [`desktop`](./desktop/README.md)：开源 Electron 桌面端、本地 Core Runtime 与插件运行时。
- [`platform`](./platform/README.md)：闭源 Java/Spring Cloud Alibaba 云平台、Web、Mobile、Admin 与部署资产。

## 许可证边界

- `desktop/` 及其自有源码按 Apache License 2.0 发布，详见 [`desktop/LICENSE`](./desktop/LICENSE) 与 [`desktop/NOTICE`](./desktop/NOTICE)。
- `platform/` 为专有闭源软件，不因与 Desktop 同仓而获得 Apache-2.0 授权。
- `desktop/vendor/` 与按需安装的外部 sidecar 适用各自上游许可证和第三方声明。

两个子项目分别管理依赖、构建、测试、数据和发布流程，不允许跨目录形成构建或运行时依赖。`desktop/legacy/` 仅保留为只读历史参考，不是第三个项目。

## 文档入口

- [品牌与文案规范](./docs/product/BRAND.md)
- [产品定位](./docs/product/POSITIONING.md)
- [Desktop Client / Plugin Runtime 目标架构](./docs/architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)
- [Desktop 当前实现](./desktop/docs/engineering/ARCHITECTURE.md)
- [Platform 后端技术架构](./docs/后端技术架构.md)
- [产品路线图](./docs/product/ROADMAP.md)
- [文档总索引](./docs/README.md)
- [可选 Loop 工作方式](./docs/loop/LOOPRULE.md)（仅在维护者明确开启时适用）

Platform 发布入口是 `platform/deploy/release/preflight.sh` 与 `platform/deploy/release/helm-release.sh`；镜像清单由 `check-manifest.sh` 统一校验。

## 本地验证

Desktop（要求 Bun 1.4.0）：

```bash
cd desktop
bun run test
bun run test:e2e
```

Platform：

```bash
cd platform
make test
make platform-up
make platform-e2e
make platform-down
```

根启动器和发布脚本测试使用：

```bash
python3 -m unittest discover -s tests
```

完整环境变量、打包和故障排查以各子项目 README 为准。不要提交真实支付密钥、模型 API Key、JWT 私钥或 `.env` 文件。
