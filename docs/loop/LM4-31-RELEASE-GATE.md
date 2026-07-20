# LM4-31 全量发布 Gate

决策：`BLOCKED`（Loop 状态：`partial`）

## 通过的可重复检查

| 范围 | 证据 |
| --- | --- |
| Desktop | `pnpm test`：161 单测、9 DB/迁移测试；Electron E2E；30 张 UI 基线、0 个固定 fixture 无障碍观察；macOS arm64 directory package smoke |
| Platform | `buf lint`、全量 Go 测试、客户端 lint/typecheck/SDK contract、Web/Admin production build、Web route smoke、Compose platform E2E、observability smoke |
| 质量 | `git diff --check` 通过；无签名包、数据库、截图 artifact、恢复密钥或项目正文被加入 Git |

## 阻塞发布的事项

1. **LM4-26**：尚无获授权的、可计费的 MiniMax Hailuo 官方沙箱执行证据。
2. **LM4-27**：尚无获授权的、可计费的 Alibaba Wan 官方沙箱执行证据。
3. **LM4-28**：依赖上面两个保留父分支，虽已本地/Compose 验证，不能伪称已进入 main。
4. **LM4-29**：Billing reconciliation 和 Notification delivery retry 缺少安全的 owner-domain API；不得通过 Admin BFF 转发静态令牌或直连表。
5. **LM4-30**：缺少 Snapshot 域服务、密文存储、保留/删除证明、生产对象存储/KMS 与 LM3-34 灾备准入。客户端加密信封不构成可发布云快照。

## 非阻断观察

- Admin Vite 主 bundle 为 670.94 kB，构建成功但应后续分包。
- macOS package smoke 未签名、未公证；它只证明目录包可启动和初始化本地数据库，不是正式发布产物。

所有阻塞项都必须在各自能力 Loop 中完成、重新验证、合并并推送后，才能重新运行本 Gate；不得通过 mock、静态令牌、降低加密要求或跳过外部证据使其“通过”。
