# DramaIP

DramaIP 是一个以本地优先为基础的 AI 短剧 IP 创作工作台。工作区由三个边界明确的项目组成：

- [`desktop`](./desktop/README.md)：现有 Electron 桌面端，继续独立开发和发布。
- [`desktop2`](./desktop2/README.md)：全插件化 Electron 桌面端，与 `desktop` 长期并行演进，不是替换分支。
- [`platform`](./platform/README.md)：闭源平台，负责官网、账号、订阅、额度、Cloud AI、移动端与运营能力。

`desktop` 与 `desktop2` 是两条同等有效的桌面技术路线，均不冻结。两者拥有独立的工作区、构建、测试、应用身份、用户数据和发布流程；`desktop2` 仅只读共享 `desktop/vendor`，不得运行时依赖 `desktop/apps` 或 `desktop/packages`。

## 文档入口

- [技术架构](./docs/技术架构.md)：目标架构、技术红线和验收门槛。
- [差异演进](./docs/差异演进.md)：当前实现相对目标架构的差距与迁移退出条件。
- [产品路线图](./docs/product/ROADMAP.md)：桌面端产品能力与长期路线。
- [通用文档目录](./docs/README.md)：产品、架构和流程文档索引。
- [平台 GitOps 发布操作](./docs/CICD_平台发布操作.md)：Staging 前置条件、初始化、发布和回滚入口。
- [LOOPRULE](./docs/loop/LOOPRULE.md)：可选的 Loop 工作方式；仅在维护者明确开启 Loop 模式时适用。

## 本地验证

桌面端：

```bash
cd desktop
bun run test
bun run test:e2e
```

全插件化桌面端：

```bash
cd desktop2
bun run check
bun run test:e2e
```

平台端：

```bash
cd platform
make test
make platform-up
make platform-e2e
make platform-down
```

完整命令、环境变量、打包与故障排查请以各子项目 README 和文档目录为准。不要将真实支付密钥、模型 API Key、JWT 私钥或 `.env` 文件提交到仓库。
