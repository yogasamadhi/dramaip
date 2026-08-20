# Desktop 3.0 alpha.3 功能迁移账本

产品行为基线固定为只读的 `legacy/desktop`，技术实现以根目录 `docs/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md` 为准。正式代码不得导入、运行或打包归档模块。

机器可执行的权威账本是：

- `docs/engineering/legacy-functional-baseline.json`：冻结的旧版产品 API 基线；
- `docs/engineering/functional-migration-matrix.json`：旧行为到插件、Contract、Route、migration、event、Client、UI 与测试证据的映射；
- `packages/client/src/openapi.json`：`studio` Effective Runtime Graph 实际生成的 OpenAPI；
- `scripts/generate-functional-migration-matrix.mjs`：双向唯一性和完成状态检查器。

当前收口结果：

| 指标                         | 结果 |
| ---------------------------- | ---: |
| 冻结旧版操作                 |  217 |
| 类型化 v2 实现               |  211 |
| 被新 Agent Run 接口替代      |    1 |
| 按架构明确退役               |    5 |
| `not_migrated`               |    0 |
| Effective Graph OpenAPI 操作 |  443 |
| 唯一 operationId             |  443 |
| 唯一 method/path             |  443 |

退役项仅包括旧五个 `/{domain}` 通用 CRUD 操作；对应产品行为已经由各 bounded-context 插件的类型化 Route Contribution 承担。OpenCode、DeepSeek Harness、LangGraph、`/api/v1` 和旧数据库自动导入不属于需要恢复的产品能力。

固定 owner 为 `foundation/system`、`workspace`、`automation`、`writing`、`knowledge`、`agents`、`creative-quality`、`production`、`media`、`timeline`、`review`、`delivery`、`insights`。每个完成项必须同时具备唯一 owner、Contract、实际路由、插件 migration、事务事件、生成 Client、UI Contribution 和自动化证据。

复核命令：

```bash
bun run migration:generate
bun run check:migration:complete
bun run check:generated
bun run check:architecture
```

`check:architecture` 还会拒绝活动 `@sdns/*`、旧 workspace、`/api/v1`、中央 `{domain}` Router、Renderer fetch/IPC、`DomainWorkspace`、OpenAPI 重复/缺失操作以及账本漂移。
