# 尽意 DramaIP · DSH 插件版

在 DeepSeek Harness Desktop 内创作小说和故事母本。项目、作者意图、章节、人物、世界设定与版本保存在本地；DSH Agent 提出修改建议，作者在面板中比较差异并决定采用。

这是独立的原生插件工程，与 `desktop/`、`platform/` 没有源码、构建或运行依赖。首版不包含分集改编、分镜、媒体生产、云协作或 Desktop 项目迁移，不作正式 GA 或文学质量保证。

## 环境与开发

- 目标宿主：**DSH 0.2.1-rc.3**，`engines.dsh` 精确限制此版本。
- 开发：Node 24、pnpm 11.28.5（`corepack pnpm`）；宿主使用它自己的 Node。
- DSH peer 由实际宿主提供。`src/host/*.d.ts` 是经真实宿主集成测试验证的最小类型门面，不从旧版 npm 包安装 DSH 的另一份实现。
- Client 使用宿主 React 18 与闭包模块加载器。Zod、Markdown 解析／清洗和差异库随插件构建打包，React 不随插件打包。

```sh
cd plugin2dsh
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run pack:plugin
corepack pnpm run test:integration
corepack pnpm run test:ui
```

`test:integration` 和 `test:ui` 需要本机安装 DSH；默认 CLI 为 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，可用 `DSH_BIN` 指定其他安装。UI 测试仅启动无头浏览器：macOS 可复用本机 Playwright Chromium 缓存，也可用 `PW_CHROMIUM_EXECUTABLE` 指定无头 Chromium，其他环境可先运行 `corepack pnpm exec playwright install chromium`。

构建输出为 `build/dramaip-dsh-plugin-0.2.0.tgz`。`lib/`、`build/` 是可再生产物。`corepack pnpm run build` 会检查 Client 模块依赖和重复 React。

## 安装与使用

先备份自己 DSH Desktop profile 的 `package.json` 与 `cordis.patch.yml`，再通过 DSH 插件页从本地安装 tgz，或使用 **Desktop 安装自带的命令**：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dramaip-dsh-plugin-0.2.0.tgz
```

按 DSH 提示重新加载或重启，在侧栏打开 **尽意 · 故事创作**：

1. 新建项目，保存简介与作者意图。
2. 新建或导入 Markdown 章节，编辑标题和正文，点击“保存”或使用 Cmd/Ctrl+S。
3. 创建人物与世界设定；不再使用的设定可以归档。
4. 展开“在 DSH 对话中使用 AI”，复制请求，补充修改要求后发给 DSH Agent。
5. 回到“修改提案”阅读逐行差异，选择采用或拒绝。采用产生新章节版本；正文或上下文变化后，旧提案禁止采用。
6. 使用“历史版本”比较并恢复；恢复也创建新版本，不改写旧历史。
7. “导出稿件”生成 Markdown；“备份项目”生成完整 JSON 项目包。项目归档后可以在“显示归档”中恢复。

切换项目／编辑对象前须保存或放弃草稿。轮询与重连不会覆盖未保存正文；版本冲突时，界面先展示最新保存内容与草稿的差异，再允许作者确认更新保存基准。业务写入失败不会自动重试；请检查当前保存状态。

移除插件：插件页移除，或 `dsh plugin --profile desktop remove dramaip-dsh-plugin`。移除不删除作品数据，安装新版前建议先导出 JSON 备份。

## Agent 工具与人工采用

| 工具                      | 能力                                                 |
| ------------------------- | ---------------------------------------------------- |
| `dramaip_list_projects`   | 列出项目 ID 和摘要                                   |
| `dramaip_project_summary` | 读取作者意图、章节 ID 与版本                         |
| `dramaip_read_chapter`    | 读取指定章节及基础版本                               |
| `dramaip_read_settings`   | 读取人物、世界设定及归档标记                         |
| `dramaip_propose_chapter` | 提交完整替换正文作为待处理提案                       |
| `dramaip_text_stats`      | 返回字符、中日韩文字、英文词、段落、对白行和阅读时长 |

工具必须显式指定项目和章节 ID。提案记录基础章节版本、上下文内容版本、说明及实际可用的会话／工具调用身份；缺失身份不补造。工具注册不包含正文保存、采用或历史恢复操作。

这些限制描述本插件的工具面。**DSH 原生插件是以用户权限运行的受信任代码，不是 DramaIP Desktop 的 QuickJS 扩展沙箱**；它们不构成对 DSH 其他文件、终端、插件管理工具的隔离。

## 数据与接口

- Host 使用 DSH Storage Domain `dramaip`、格式版本 1、`single` 布局；`projects` 表中每个项目是一个聚合记录。当前默认 JSON 后端路径为 `$DSH_HOME/storages/dramaip.json`，默认 DSH_HOME 为 `~/.dsh`；后端及实际位置遵循宿主配置。
- 正文、新版本与提案状态在同一次 DSH 原子记录更新中提交。历史保存完整正文；提案状态变化不递增内容版本，正文、标题、排序、作者意图或设定等权威内容变化会递增内容版本。
- 通过 DSH Typert Gateway 的 `dramaip/dispatch` Remote 调用通信。输入是 `RequestSchema` 定义的判别联合，响应为 projects／project／export。共享 schema 同时驱动严格 Remote 描述、存储校验和 Client 解码；不依赖源码模式反射，也不新增端口。
- 修改操作携带项目 `expectedRevision`。主要业务错误为 `dramaip/conflict`、`dramaip/stale-proposal`、`dramaip/not-found`、`dramaip/archived`、`dramaip/invalid-input`；Gateway 输入错误和存储错误保留宿主错误语义。
- 完整包格式为 `dramaip-dsh-project-v1`，包含全部章节、设定、版本、提案与来源记录。导入校验所有引用，重新生成内部 ID 并保留来源项目标识，创建新项目，不覆盖旧项目。不兼容其他产品的项目包。
- Markdown 导出只包含作品标题与按顺序排列的章节；设定、作者意图、提案和版本不混入稿件。
- Markdown 预览清洗脚本、事件属性与危险 URL，并禁用图片及其他远程媒体加载。大范围差异计算超时后展示两份完整文本，避免阻塞工作台。

## 验证与当前限制

临时环境脚本不读写日常 `~/.dsh`：真实安装 tgz、调用严格 Gateway、运行带本地 mock 模型的真实 Agent 循环、验证提案和人工采用、重启恢复、JSON 往返、损坏数据拒绝加载及移除后的工具撤销。它依次启动 Web／Headless，避免同时打开同一份存储。

```sh
node scripts/verify-temp-home.mjs --keep          # 保留临时数据用于排查
node scripts/verify-temp-home.mjs --serve         # 隔离验证后保持 Web 运行；Ctrl+C 退出并清理
```

UI 测试使用真实 DSH Web Client 与实际打包后的插件，不以 Client 图存在代替界面操作。覆盖编辑保存、Markdown 预览、提案差异／采用、下载与导入、刷新、断线、草稿保护、冲突和过期提案拒绝。

**官方 DSH Desktop 外壳的实际界面尚未验收。** 当前安装的外壳会主动显示窗口，未发现保证后台运行的测试开关；为遵守不抢占桌面焦点的要求，未启动普通 Desktop 实例。本插件使用宿主 Connection 的逻辑 RPC，而非直接 HTTP fetch；Desktop IPC 传输、文件选择／下载行为仍需在可隔离且保持后台的 Desktop 环境验收。Web 验证不代表这些项目已通过。

首版按单个宿主进程持有数据设计，不支持多个 DSH 进程同时写同一存储；完整项目及历史在内存中处理，未做大型长篇容量或高并发验收。正文单次输入上限 200 万字符，每项目最多 1000 章与 2000 条设定；项目包实际传输上限还受宿主限制。没有自动保存、后台 AI 任务或跨设备同步，未保存草稿仅在当前插件生命周期内保留。

授权与依赖许可证见 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
