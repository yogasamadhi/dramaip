# dramaip-dsh-plugin

DramaIP 作为 **第三方** DeepSeek Harness（DSH）插件的最小切片：一个 Host 侧 Agent 工具，加一个 Web Client 侧栏面板。它与 `desktop/`、`desktop/next/`、`platform/` 互不依赖，单独安装、构建和打包。

| 部分 | 入口 | 内容 |
| --- | --- | --- |
| Host | `exports["."]` → `lib/host/index.js` | 注册 `dramaip_text_stats` 工具：统计字符、中日韩文字、英文词、段落、对白行与阅读时长；不读文件、不联网 |
| Client | `exports["./client"]` → `lib/client.js` | 侧栏“尽意 · 文本统计”与主面板（占位）；在页面里用同一个统计函数实时计算 |
| 组合层 | `cordis.patch.yml` | 插入一行 `dramaip-dsh-plugin`；同一包的 `dsh.client` 声明让面板进入 Client 图 |

## 与已安装 DSH 的约定

- 目标是本机 `DeepSeek Harness.app` 0.2.1-rc.2（`engines.dsh: ">=0.2.1-rc.2 <0.3.0"`）。
- `@deepseek-ai/dsh-tools` 是 peer，由加载插件的 DSH 安装提供；npm 上的同名包版本较旧，所以 `src/host/dsh-tools.d.ts` 只声明本插件用到的类型。
- Client bundle 是 DSH 闭包工厂格式（`window.__ModuleLoader__.load`），`react`、`react/jsx-runtime` 取自页面 module table（上游为 React 18）。`scripts/build.mjs` 拒绝引用 module table 以外模块或自带 React 的产物。
- DSH 插件是受信任代码，以用户权限在 Host 进程与页面中运行，没有旧 QuickJS 扩展的隔离。

## 命令

Node 24、pnpm 11.28.5（`corepack pnpm`）。

| 命令 | 作用 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | 安装开发依赖（TypeScript、esbuild、React 18 类型） |
| `corepack pnpm run typecheck` | 类型检查源码与测试 |
| `corepack pnpm test` | 统计函数单元测试（`node --test`） |
| `corepack pnpm run build` | 构建 `lib/host`、`lib/shared` 与 `lib/client.js`，并做 bundle 纯度检查 |
| `corepack pnpm run pack:plugin` | 构建并打包到 `build/dramaip-dsh-plugin-<version>.tgz` |
| `node scripts/verify-temp-home.mjs [--keep] [--serve]` | 用本机 DSH CLI 在临时 `DSH_HOME`/`HOME`/Documents 中安装 tgz 到 `web` 与 `headless` profile，核对组合层；用本地 mock 模型跑一轮 headless Agent，确认工具被提供、被调用且结果回到模型；启动 `web` 确认全部条目激活、Client 图含面板。`--serve` 保持 Web 运行以便手动查看；`DSH_BIN` 可替换 CLI 路径。从不读写 `~/.dsh` |

## 安装到真实 DSH（尚未执行）

验证通过后再装进自己的桌面 profile，先备份 `~/.dsh/profiles/desktop/package.json` 与 `cordis.patch.yml`，然后任选其一：

- 桌面端侧栏“插件”页 → 从本地安装 `build/dramaip-dsh-plugin-<version>.tgz`；
- 或命令行：`"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add <tgz 路径>`。

移除：插件页移除，或 `dsh plugin --profile desktop remove dramaip-dsh-plugin`。
