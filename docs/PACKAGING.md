# 打包指南

先按 [开发指南](DEVELOPMENT.md) 准备环境。在对应的平台和架构上构建安装包。

## 构建

```bash
pnpm run build
```

用于发布的构建使用：

```bash
pnpm run build:release
```

发布构建生成 Web、客户端插件、Electron 壳、Pi 和 Desktop Host 产物，清理调试资料并保留需要分发的许可证。

## 安装包

打包需要设置 `DRAMAIP_UPDATE_URL`，其值应为当前发行渠道的更新地址。以下为 Bash 示例，请替换示例地址：

```bash
DRAMAIP_UPDATE_URL=https://updates.example.com/dramaip pnpm run package
```

`package` 会先运行发布构建，再调用 electron-builder。安装包输出到 `apps/desktop/dist/`。各系统的打包目标见 [electron-builder 配置](../apps/desktop/electron-builder.yml)。签名和 macOS 公证需要另行配置相应凭据。

## 产物检查

```bash
pnpm run release:inspect
pnpm run release:metadata
```

`release:inspect` 只读核对候选产物；`release:metadata` 生成当前版本的文件清单与摘要，默认输出到新的 `apps/desktop/dist/release-metadata/` 目录，并拒绝覆盖已有输出。这些命令不会上传或发布安装包，安装与升级流程仍需在目标环境验证。

分发时保留 [LICENSE](../LICENSE)、[NOTICE](../NOTICE) 及 [第三方声明](../THIRD_PARTY_NOTICES.md)。
