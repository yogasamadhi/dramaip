# DramaIP

DramaIP 是一个以本地优先为基础的 AI 短剧 IP 创作工作台。工作区由两个边界明确的项目组成：

- [`dramaip-desktop`](./dramaip-desktop/README.md)：Electron 桌面端，负责本地项目、创作工作流、导出与用户自带 API Key 模式。
- [`dramaip-platform`](./dramaip-platform/README.md)：闭源平台，负责官网、账号、订阅、额度、Cloud AI、移动端与运营能力。

## 文档入口

- [技术架构](./docs/技术架构.md)：目标架构、技术红线和验收门槛。
- [差异演进](./docs/差异演进.md)：当前实现相对目标架构的差距与迁移退出条件。
- [产品路线图](./docs/product/ROADMAP.md)：桌面端产品能力与长期路线。
- [通用文档目录](./docs/README.md)：产品、架构和流程文档索引。
- [平台 GitOps 发布操作](./docs/CICD_平台发布操作.md)：Staging 前置条件、初始化、发布和回滚入口。
- [LOOPRULE](./docs/loop/LOOPRULE.md)：逐 loop 的分支、验证、合并和推送规则。
- [LOOPMAP3](./docs/loop/LOOPMAP3.md)：平台架构收敛的执行地图。

## 本地验证

桌面端：

```bash
cd dramaip-desktop
bun run test
bun run test:e2e
```

平台端：

```bash
cd dramaip-platform
make test
make platform-up
make platform-e2e
make platform-down
```

完整命令、环境变量、打包与故障排查请以各子项目 README 和文档目录为准。不要将真实支付密钥、模型 API Key、JWT 私钥或 `.env` 文件提交到仓库。
