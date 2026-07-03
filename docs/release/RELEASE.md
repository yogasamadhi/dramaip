# Release Packaging

本文档记录发布前的打包、签名、公证和自动更新策略。当前自动更新运行时代码仍未接入，
但打包配置会生成后续 updater 需要的安装包与 metadata。

## 本地打包 smoke

```bash
pnpm package:smoke:dir
```

该命令会构建桌面端、按 Electron ABI 重编 `better-sqlite3`、生成当前平台的 unpacked 应用，
然后启动打包后的应用并使用临时 `userData` 验证 `studio.db` 能完成初始化。

需要验证真实安装包时运行：

```bash
pnpm package:smoke
```

各平台预期产物：

| 平台 | 产物 |
| --- | --- |
| macOS | `.dmg` + `.zip` |
| Windows | NSIS `.exe` + `.zip` |
| Linux | `.AppImage` + `.deb` |

## CI 打包 smoke

GitHub Actions 的 `package-smoke` job 在 `macos-latest`、`windows-latest`、`ubuntu-latest`
上分别运行 `pnpm package:smoke`。Linux runner 使用 `xvfb-run` 启动 Electron smoke。

smoke 覆盖：

- 本平台安装包可由 `electron-builder` 生成。
- unpacked 应用可启动到主进程 ready。
- SQLite 数据库可在临时 `userData` 下初始化。
- `app.asar` / `app.asar.unpacked` 不包含工作区源码目录、loop 文档或 `.env` 文件。

## 产物边界

`electron-builder.yml` 只解包原生 `.node` 文件，避免把完整依赖源码目录散落到
`app.asar.unpacked`。发布产物不应包含真实密钥、`.env`、工作区源码、测试目录或 loop 文档。

## 签名与公证

macOS 使用 hardened runtime，并通过 `apps/desktop/build/entitlements.mac.plist` 声明 Electron
运行所需的 JIT、unsigned executable memory 和 library validation 权限。`afterSign` hook 指向
`scripts/notarize-mac.cjs`，没有 Apple 凭据时会跳过公证，避免影响本地 smoke。

发布环境变量：

| 变量 | 用途 |
| --- | --- |
| `CSC_LINK` | macOS Developer ID Application 证书，base64 p12 或可访问 URL |
| `CSC_KEY_PASSWORD` | `CSC_LINK` 对应证书密码 |
| `APPLE_ID` | Apple ID 邮箱，用于 notarytool |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `WIN_CSC_LINK` | Windows 代码签名证书，base64 p12 或可访问 URL |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 |

本地和 PR smoke 默认设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，不尝试发现或使用开发机证书。
正式发布 runner 必须只通过 CI secret 注入上述变量，不允许把证书、密码或 `.env` 写入仓库。

## 自动更新源

更新源采用 `generic` provider，对外暴露一个稳定 HTTPS 静态目录：

```text
https://updates.example.invalid/short-drama-novel-studio/stable/
```

真实生产环境需把该占位域名替换为公司控制的 HTTPS 域名或在 release 配置中覆盖。目录保留
`latest.yml`、`latest-mac.yml`、`latest-linux.yml` 与对应安装包；`beta/` 可作为预发布通道，
但 stable 客户端默认只读取 `stable/`。

回滚策略：

- 每次发布保留至少最近 3 个版本的安装包和 metadata。
- 若新版本需要回滚，只回退 `latest*.yml` 指向上一稳定版本，不删除问题版本，便于审计。
- 发生数据库迁移后的回滚必须先确认旧版本能打开当前 schema；不能确认时只能发布热修版本，
  不直接把用户降级到旧二进制。
- 自动更新接入前，发布说明需提供手动下载旧版安装包的路径与校验方式。
