# Desktop 发布与回滚 Runbook

本 Runbook 只描述可复现的桌面端发布流程；平台审核、版权判断和外部 Provider 的商业表现不由本软件保证。

## 发布前 Gate

在干净的 release 分支和已注入签名凭据的环境中执行：

```bash
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:db
pnpm --filter @sdns/desktop rebuild:electron
pnpm build
pnpm test:e2e:skip-build
pnpm test:ui:skip-build
pnpm package:smoke
```

`test:unit` 会先为当前 Node ABI 重建 `better-sqlite3`，并且无论成功或失败都会恢复
Electron ABI；`test:db` 结束时也会恢复原生模块。因此发布 Gate 仍按上面的顺序执行，
不能把 ABI 错误忽略或误报为通过。

发布 Gate 还要求：旧数据库迁移、项目包换机导入、素材/权利缺失 fail-closed、AIGC 合规封装、至少两个平台
交付包及 checksum 均有自动化证据。真实图片、TTS 和视频 Provider 只有在账号所有者显式授权计费、由秘密注入环境
提供凭据并留下脱敏 sandbox 证据后才能开启；无此证据的 Provider 必须保持关闭。

## 打包、安装与升级

`pnpm package:smoke` 会产出本平台安装包（macOS 为 DMG/ZIP），并从未签名的解包应用启动 smoke，验证：主进程、
preload、SQLite 迁移、FFmpeg、asar 解包的原生模块、文件关联与首启。它不替代 macOS 公证、Windows 签名或 Linux
发行包的人工安装。

正式 release 需在受控 CI/签名机完成：

1. 固定版本号与变更日志，创建候选 tag；不得把 API Key、证书或更新签名材料提交进仓库。
2. 产出 DMG/ZIP、NSIS/ZIP、AppImage/deb；在每个目标系统用新用户目录首次安装、升级安装和启动后回滚验证。
3. macOS 使用 hardened runtime、Developer ID 签名和公证；Windows 使用受信任代码签名；Linux 附带第三方许可与校验和。
4. 发布更新清单前确认 `publish.url` 已由 release 环境替换为真实 HTTPS 源，绝不发布示例地址。

## 回滚与数据兼容

- 立即停止 rollout、撤下更新清单，并关闭新增 Provider/Profile 的生产开关；不删除用户项目、媒体、任务或权限记录。
- 数据库迁移只前进。旧应用无法识别的新 schema 时，恢复升级前启动备份或使用同版本应用导出 `.sdnspkg`，而非手工删表。
- 项目包导入总是创建新项目；本机路径不会跨设备复用。恢复后必须重新定位素材并复核 rights/AIGC/compliance。
- 已导出的交付包、采用版本、费用与审计记录不可被回滚操作静默删除；回滚仅限制新执行。

## 支持平台、开关与已知限制

- 支持目标：macOS、Windows、Linux 的 Electron 打包目标；实际签名与安装验证以 release candidate 记录为准。
- `Mock` 保持可用，用于离线全链路验证。Hailuo、Wan、Sora、OpenAI Image、OpenAI TTS 均需独立开关、凭据、成本确认和官方 sandbox 证据。
- 平台交付包是人工上传辅助，不登录、代投或自动发布；实时规则、资质、审核和商业表现仍需人工确认。
