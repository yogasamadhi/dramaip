# Release Packaging

本文档记录发布前的打包 smoke。签名、公证、自动更新仍由后续 L8-03 闭环补齐。

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
