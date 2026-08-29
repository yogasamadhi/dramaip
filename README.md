# DramaIP

DramaIP 是一个以本地优先为基础的 AI 漫剧与短剧 IP 创作系统。仓库包含两个边界独立的子项目：

- [`desktop`](./desktop/README.md)：开源 Electron 桌面端、本地 Core Runtime 与插件运行时。
- [`platform`](./platform/README.md)：闭源 Java/Spring Cloud Alibaba 云平台、Web、Mobile、Admin 与部署资产。

两个子项目分别管理依赖、构建、测试、数据和发布流程，不允许跨目录形成构建或运行时依赖。`desktop/legacy/` 仅保留为只读历史参考，不是第三个项目。

## 文档入口

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
