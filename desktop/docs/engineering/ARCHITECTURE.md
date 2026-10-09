# DramaIP Desktop 3.0 alpha 架构

> 文档类型：Descriptive Current Implementation
>
> 状态日期：2026-09-07
>
> 目标规范：[DRAMAIP Client / Plugin Runtime Architecture](../../../docs/architecture/desktop/DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md)
>
> 产品定位：[POSITIONING.md](../../../docs/product/POSITIONING.md)

本文只描述已经进入当前代码路径的事实。当前实现是完成 Level 2 进程、连接、插件和安全边界后，启用 Level 3 首版 Extension Platform；第三方 React、任意网页 UI、Node API、Raw SQLite、直连文件/网络仍未开放。

这些能力同时服务独立小说创作/稿件交付与 IP 改编/分集剧本/试制交付；作者意图、叙事质量、连续性、版本与来源贯穿两路，任一媒体 Provider 都不是产品本体。2026-09-30 的文档定位校准不改变以上实现状态日期；新流程与对象按 [执行计划](../../../docs/PLAN.md) 另行验收，不从架构测试推定文学质量或正式 GA。

## 进程与信任边界

```text
Desktop / Web / CLI
  │ ServerConnectionManager → RuntimeTransport → @dramaip/client
  │ HTTP /api/v2 + SSE + OpenAPI
  ▼
Independent Core Runtime（Desktop: Electron Node；Headless/Server: Node 24.18.0）
  ├── Effective Core Graph / Atomic RuntimeRouteRegistry
  ├── first-party Plugin Kernel / typed services / tracked effects
  ├── SQLite migration worker / events / checkpoints
  ├── Extension Capability Broker / Instance Effective OpenAPI
  └── HTTP /host/v1
       ▼
Electron Desktop Host
  ├── file grants / credential vault / SafeHttpTransport
  ├── EngineSupervisor → Pi / Codex / LangGraph.js
  └── ExtensionProcessSupervisor
       └── one utility process + one QuickJS/WASM runtime per active revision
```

PLAN 22.80 / A06.2.1 手工 impact SDK 正式 schema 及原结果／项目／分集／版本校验；旧仅传 ID 调用仍核原 ID，工作台带完整真实引用。query 与组件 key 包含四项身份，连接对象／身份变化清本轮打开状态；enabled=false、retry=false，每次点击显式同一 GET，等待／失败／错配不渲染缓存，跨工具返回的迟到回复不自动打开。只读历史 stale／globalReviewReasons、semanticVerification=unverified、automaticRedo=false 保留；没有 owner／路由／返回契约／迁移变更，也无业务 fetch／IPC 或自动局部化。五项定向、App 405／类型／构建／工程及原实际 Kernel 样本通过，三文件十三项后台的真实错误／错域／恢复与迟到回复、隔离 HMR 均终态通过，A06.2.1 限定 done；完整语义影响／结构性重做继续。

Electron 入口 `electron/main.ts` 只装配桌面应用。窗口、shutdown、Host transport、Credential Capture、Safe HTTP、Engine event channel、Extension process 和 migration worker 已分别放入对应 supervisor/provider 模块；旧 `main-v3.ts` 不再存在。受管进程使用 generation、健康快照、pending 数、指数退避、jitter 和五分钟崩溃预算。Runtime generation 变化时轮换 Runtime/Engine token、结束旧 stream，停止旧扩展进程并用新 nonce 重建 BrowserWindow。

Renderer 的业务代码只使用 `@dramaip/client`。Preload 仅有绑定 `webContents`、30 秒有效、一次消费的 bootstrap nonce exchange；Credential 明文只在独立 sandbox modal 与 Host 私有通道中出现。

PLAN 22.81 / A06.2.2 已加入可选 formal-constraint-observations-v1 脱敏投影（限定验收完成）。跨 owner 当前正式头／批准 Bible 经其只读服务获取，Production 实际头／原稿记录／既有 AST 在自己的 UoW 捕获；跨 owner 读取不嵌套事务、不称全域原子或提交权限。冻结身份取原 basis、指纹仅取唯一同 kind／ID／版本／路径引用，缺失不由正文或最新成果补齐；完整批准集合保留实际成员与位置、零与未核全分开。当前 hash 仅表示实际读取表达，same-reference 不证明正文／语义一致。明细不写数据库／事件，不改局部块比较或删除 globalReviewReasons，异常文本不投影；无新 owner、路由、表、迁移或插件依赖。新契约／生成 OpenAPI 已检查，七项实际 Kernel、SDK／纯界面十一项及 helper 三项通过，普通完整 Runtime 547／另 helper 3／App 411／Main 66、固定十文件 29 项后台和 detached HMR 195／79 均终态通过，无视觉基线更新；完整语义影响／结构性重做继续。

## Core Runtime 与第一方插件

组合固定为：

```text
Plugin → Bundle → Product Profile → Effective Core Graph Revision
```

14 个 bounded-context 插件拥有各自 route、migration、table、event、service 与 UI contribution。DSH Cordis 负责原生 Context、Service、inject、Fiber 和 effect 生命周期；Kernel 负责产品图、贡献和契约校验。`ctx.effect(acquire, label)` 的 Fiber 元数据关联 owner、plugin version、graph revision 和 acquiredAt；独立 effect 按 DSH 原生并发清理，有先后依赖的资源放在一个 effect 中显式等待。旧 activate 循环、ServiceRegistry 和 EffectScope 已移除。

九个 `@deepseek-ai/*` 框架包来自锁定 DSH vendor，经 prepare/install/build 生成到 `build/dsh-framework/`。保留名称、版本、导出语义和 MIT 许可证，禁止 registry 副本。插件模块与元数据分离：生成注册表提供身份、迁移和 UI 元数据，Loader 动态导入保留模块边界的 ESM 实现。

空 `cordis.yml`、六个 Bundle patch 与五个 Profile patch 使用 Include 的 YAML schema 与 `applyEntryPatches` 展开。预检使用独立解析树，避免 DSH 原生 patch 的就地修改污染 Loader 输入。启动先做配置/依赖预检和迁移，再等待所有 Loader 条目及子 Fiber 稳定；pending、异步失败或缺失贡献均阻止发布。

开发期启用 DSH Timer/HMR。业务重载先阻止新路由请求并等待执行中的 handler，暂存 UI/路由变更，校验后同步发布 Router、Core Graph 和诊断。模块导入或配置错误沿用 DSH 恢复；异步激活失败会恢复上一成功构建快照，supervisor 用新进程重建 Runtime。框架、启动入口、迁移和公共元数据变化走完整重启。生产关闭监听。详细实现与验证命令见 [DSH Cordis 迁移说明](DSH_CORDIS_MIGRATION.md)。

agents 的 `index.ts` 与 `plugin.ts` 只做 descriptor/migration/service/route/effect 组合；原聚合实现已拆为 `internal/shared`、`providers/routes`、`sessions/routes`、`runs/task-runner`、`runs/recovery` 和 `experiments/routes`。组合入口禁止 SQL 并受行数门禁保护。

第一方 HTTP route 已全部是声明式 `RouteContribution`。插件不接触 Hono app；同一 declaration 驱动 Router、OpenAPI、Catalog 和生成 Client，并声明认证、body limit、timeout、idempotency 与 concurrency policy。Router 采用 staged build 和 active reference 原子发布。

数据库迁移由独占数据库的子进程执行。Headless/Server 的 Node Worker 与 Desktop 的 Electron-run-as-Node Worker 使用同一 IPC 协议；单项 60 秒、总计 10 分钟，超时精确终止 Worker，再由新进程完成 WAL recovery 与 integrity check。现有文件数据库在迁移前做验证备份和临时副本 dry-run。

持久业务事件通过 `ctx.domainEvents` 注入；Cordis 自己的 `ctx.events` 保留框架用途。`SqliteUnitOfWork` 在业务写入和 Domain Event 同一事务提交后才触发 `afterCommit`。Domain Event 使用数字 cursor、schema/upcaster 和 durable checkpoint；Realtime Event 不使用持久 cursor。SSE 限制每订阅者 1,000 event/4 MiB，并有 heartbeat、慢消费者断开和 replay。

## Client 与 Renderer

Client 分为 connection、transport、events、errors、generated 和 domains，并由单一 `RuntimeTransport` 构造 `StudioClient`。安全 GET 最多重连重试一次；mutation 永不自动重发。

Renderer 入口分为 bootstrap、`studio-shell`、routing、runtime-connection、contribution registry 与领域 feature。`studio-shell` 不静态导入领域 runtime；原 17k 行 Studio 合集已拆为 `studio-shared`、受控 cross-feature widgets 和十个 feature implementation，`studio-runtime.tsx` 只保留兼容导出。workspace、writing、creative、automation、production、media、review/delivery、insights、settings 和 agents 都通过固定动态 import loader 装载。Runtime 只返回启用的 contribution ID/metadata，Renderer 与构建期 canonical hash 取交集。未知或篡改 ID 只进入诊断。`safe/test` profile 不暴露未启用 contribution，chunk 门禁同时检查领域动态入口、禁止入口依赖 aggregate barrel，并拒绝重新生成 `studio-runtime` 聚合 chunk。

### 2026-10-06 项目包脱敏谱系与只读外部归档

Workspace 当前 JSON 项目包为 schema v5，保留作者稿件及章节／资源原版本；v1–v4 继续兼容，不补造缺失的历史谱系。`automation.creation-project-lineage.v1` 只分页读取 Automation 自己的原工作流；Workspace 经公开契约收集允许的原身份／引用／版本／哈希与结果ID，服务不可用明确标 unavailable，异常或不完整分页安全拒绝，不读取当前源修补旧快照。覆盖范围是 recorded-workflows-only-not-all-owner-history。

2026-10-07按PLAN22.169收口原M4允许脱敏谱系父项：完整JSON收严格四owner侧车和原工作流，兼容submission-json／delivery仅收原工作流／外部归档，五种Markdown不序列化侧车；Delivery稿件与显式选用三阶段ZIP有各自实际版本／文件／回执边界。八种Workspace格式的12章、未采用意图和含私人时间的事件探针过；永久谱系／历史／分页／禁发及ZIP回归分命令过。作者自由内容区不认证为同样的敏感字段过滤；未知许可、语义质量、全owner状态历史及完整M4不由此证明。详细格式见[项目包协议](PROJECT_PACKAGE_V4.md)。

`production.project-lineage.v1` 已实现为 Production 唯一拥有的只读、可降级 native effect 服务；分页读取本域原保存记录、不可变正式结果与原人工镜头归因，Workspace 不读 peer 表。JSON-only 可选 `lineage.production` 明确覆盖 recorded-production-owner-rows-only：普通当前保存结构不是历史证明，真实块 UUID／类型／顺序与派生文档指纹不替代原正式快照；缺文档／坏 AST 只标 unavailable，不初始化。原正式结果与人工剧本／拓扑／来源确认保留原父 ID／version、preview／snapshot、稳定场块镜头及原证据位置，不补造 workflow、模型 run 或语义验证。故障／跨项目／重复／错类／私有附加字段安全拒绝 JSON 侧车，独立稿件格式不读取该未序列化制作元数据；不强制小说、改编或媒体。各owner只按公开允许范围提供元数据，不代表全部状态历史；允许导出父项及原M4工程分别按PLAN22.169／22.171完成验收，真实语义／授权和发行另验。

`knowledge.project-lineage.v1` 已实现为 Knowledge 唯一拥有的只读、可降级 native effect 服务；Workspace经公开契约分页收集原声明、关系／认知、原摘要和不可变来源变更四类表。JSON-only可选 `lineage.knowledge` 明确 recorded-knowledge-owner-rows-only：原段落／位置、采用事实与真实保存块、政策依赖、摘要原表达／覆盖／证据哈希、原运行及unknown用量保持原样；目录增长、摘要换头、撤回或指定替换不会重写旧来源。变更身份采用原sourceKind／sourceId／version复合键，原退役行字节指纹明确派生、不认证授权或真实性。原正文／statement／quote／Prompt／私有理由不外发；坏JSON／跨项目／重复／错误类别或owner故障安全拒绝JSON，不读当前源修补历史或影响独立稿件格式；不是所有知识历史或语义质量认证。

`workspace.project-lineage.v1` 已实现为 Workspace 自己的只读、可降级 native effect 服务，分页读取原 `workspace_author_intents` 保存行，不读取当前正式头或 peer 表。JSON-only 可选 `lineage.workspace` 明确 recorded-workspace-author-intent-rows-only／saved-author-intent-row-not-full-state-history；原 version／stateVersion／status、创建／采用时间和比较父 ID 保留，不补造全部状态变迁。manual／legacy 来源只留原 kind／项目版本；AI 原 request／允许范围、表达、原引用、workflow／snapshot／run／engine 保持，来源变化／换头不重写旧记录。八字段正文／legacyFields／Prompt 不外发；content_json／source_json 字节指纹明确派生，坏记录或不完整页安全拒绝 JSON，独立稿件格式不读取该侧车。

`creative-quality.project-lineage.v1` 已实现为 Creative Quality 自己的只读、可降级 native effect 服务，按原类别分页读取模型报告及本地人工／规则评议表，Workspace 只经公开契约收集。JSON-only 可选 `lineage.quality` 明确 recorded-quality-model-and-local-owner-rows-only／saved-quality-owner-row-not-full-state-history；原请求／覆盖／来源版本、实际保存块基准、workflow／snapshot／run、估算预算及 unknown 用量保持。问题只外发原 ID／维度／严重级／来源类型、精确位置与引文字节 SHA／UTF-16 长度；原风险／复检决定保留身份和时间而不外发私人 note，摘要／message／suggestion／quote／Prompt 不外发。字面规则只留 literal-repeated-passage-v1 与 not-assessed，不补语义维度；人工／模型声明不认证质量。所有记录 semanticVerification=unverified，不读取当前源或头补历史／当前状态，原 value_json 字节指纹明确派生；项目／原 row／指纹／引用／问题绑定和异常页安全校验，独立稿件不受此未序列化侧车故障影响。

人工剧本 rebase 与分镜 v1–v4 合并元数据保留原比较来源、基准版本、作者选择、结构确认与公开字段三方状态／哈希，不导出候选正文、字段文本或私人旁注。选择图指纹明确由持久选择派生，不冒称历史原哈希；重试来源与原比较父工作流分别保留。

v5 导入将原谱系存入 Workspace 唯一拥有的 `workspace_imported_lineage_archives`（前向迁移 .0011），只读归档保留原外部项目／工作流／版本，不重映射为本地原运行。`imported-claim-not-local-workflow-or-authority` 表示未经认证的外部声明；规范化元数据派生指纹不证明原文件字节、授权或真实性。A→B→C 导出链平面保存旧归档，不激活工作流／作者意图、凭据或自动采用。新项目／初始化与project事件／归档写入在本owner同一UoW；其他owner的章节与资源导入不因此宣称跨owner原子事务。原freeze11完整normal971／54及其固定／来源／五Profile已分别严格过；Workspace与Quality上述谱系现已正式合入，九源码与末候选同版，正式精确身份并集73条、33类型／工程门和268ESM构建过。freeze12完整normal973/54、固定23/12、来源18及五Node Profile已分别严格终态通过，1953源码／5478编译末清单一致。独立本集只读实际输入误报的四文件已正式合入；原两长篇＋三独立本集＋唯一13单测正式18过、候选兼容76及工程／269ESM过，共享整季／诊断复核保留。freeze13完整normal980/54、固定23/12与来源18已严格过。配置恢复与启动初始化门正式29及工程／构建过；freeze14两原生Profile与来源18过，但固定23均在初始化失败，确证合法源码Profile被恢复边界拒绝。已仅把原已解析JSON字节映射到命名恢复包并正式补正，任意foreign receipt仍拒绝；正式29和工程／269ESM再过，实际后台Desktop启动恢复。freeze15完整normal991/54与固定23/12严格过，原Node／来源复制.tmp失败保留。两脚本精确根目录复制修复及A08.2内部ZIP所选三正式阶段原工作流脱敏谱系已正式合入，默认不附、缺失未知、人工确认不作模型输入。正式30唯一／33类型／SDK／工程与270ESM过；freeze16加强原固定23/12、来源18及五Node／隐藏Electron Profile已分别严格通过，完整normal原30012/30046已终态0并严格核Runtime997/54、App618/113、Main66/14、33类型／Worker及全部conformance，之后才释放冻结。22.164用原两长篇反例复现整季stale全量传播后，正式补入独立单集原输入完整闭包与共享正式约束原ID／version／已知SHA的判断；只影响已有结果的来源观察，不使旧季纲变current或绕过新生成／采用。末版14项定向含实际镜头、三类可选素材和SQLite精确状态恢复，33类型／lint／架构、SDK与迁移门／271ESM构建与chunk过；不借freeze16旧全量作为这组新代码完整验收。正文改版两个隔离旅程过，永久正文旅程及完整业务组验收继续，见PLAN22.164。旧normal14因确定启动错误主动取消143不计完整通过。范围、原失败、精确补丁及各真实命令见PLAN22.155–22.164，不认证全owner状态历史、全部格式、整M4、语义质量或发行。

### 2026-09-30 素材入口与独立成果增量

本段描述该日进入代码并单独验证的增量，不重写上面的历史状态日期；任务状态和测试范围见 [PLAN 第 22 节](../../../docs/PLAN.md#22-2026-09-30-实施证据与待验收范围)。

- Workspace/App 的新建入口先选择创意、小说/大纲或已有剧本，再明确选择小说或剧本目标；其他内部模式保留为二级模板。`CreationDraftV1.intakeStep` 是可选兼容字段，恢复素材选择后的目标确认位置，不升级旧草稿格式，不恢复文件 grant 或权利确认。
- 已有小说选择继续写作时沿用已导入末章，不追加新的“第一章”，不创建改编或媒体对象。小说驾驶舱隐藏制作百分比，按需制作导航折叠；采用、当前版本事实记忆及稿件清单/Host 保存回执已接入正式记录，正文计数不等于正式采用或交付。
- Writing 唯一持有 `/api/v2/projects/{projectId}/chapter-adoptions` / `chapters.adoptions` 只读游标分页，读取既有 `writing_creation_adoptions` 与本域章节归属，返回工作流、章节、正式版本及采用时间，不返回正文或凭据。这条读路由无需新表或历史 SQL 改写；规划采用、仅保存的原稿、其他项目或已删除章节不会伪装成章节采用记录。App 只经生成 SDK 读取全部实际分页，将采用版本与当前章节版本核对；事实记忆还需当前来源版本、已采用记忆工作流及可定位正文证据。缺失/旧版本/错归属/未采用资料不计同步。
- 小说驾驶舱与项目首页返回时重新核验采用/记忆，不复用采用前的缓存。章节候选链接携带实际 `chapterId`，只选择本项目真实章节；大纲链接携带 `outlineMode` 区分全书/章节/故事弧，旧无参数路由与末章恢复保持兼容。已采用正文且记忆对应当前版本才推荐继续下一章；作者原稿仍可独立继续/导出，不强制 AI 采用。
- 已有剧本粘贴或结构化 JSON 确认后，入口协调器只经 `@dramaip/client` 使用 Production 的既有资源 API。剧本正文保存在 `scripts`，Production 同步稳定块的 `screenplay_documents`；不再新建小说母稿、章节或人物槽位。粘贴入口创建的分集目录只是兼容容器，不是已采用诊断或整季方案。中断重试复用真实父子对象；不同正文不静默覆盖，未确认权利的恢复草稿不创建内容。
- 创意选择单季剧本目标持久化为 `single_season.entryPath = inspiration`，旧 `novel` 路径不重写。新项目只建立原创分集目录、首集和空剧本，用户构思保持在 Workspace 项目版本中，不伪装成小说正文或已采用季纲。空稿通过既有 `script-revision` 的稳定块候选工作流创作，冻结真实项目与当前正式作者意图版本；显式采用前不写正文，简报或意图变化阻止过期候选采用。该原创兼容路径未接入独立 `episode-script`；小说诊断/季纲驱动的新路径另见下方单集开发，不从兼容工作流推定完整 M3。
- 剧本入口与零章节剧本项目恢复到 `/adapt` 的真实项目/目录/分集/剧本上下文，常规路径折叠父级选择器。现有剧本规则审查仍是规则证据，不是模型质量或发行证明；场景与分镜须后续明确生成/采用，媒体仍可选。
- Workspace 的既有导出兼容路由继续持有 `submission-json`、`delivery` 等输出；它们不再静默截取前十章，按已保存顺序包含完整稿件。`submission-markdown` 只输出题名、梗概和章节，不夹带资源 JSON 附录；旧 JSON 项目包格式保持不变，不制造新 Delivery 回执。
- Delivery 新增强类型 `ManuscriptPreview / Manifest / Receipt`，唯一持有 `/api/v2/projects/{projectId}/manuscripts` 预览/游标列表、`/api/v2/manuscripts/{id}` 读取与 `/save` 明确保存。前向追加 `delivery.0003.manuscripts` 与本域 `delivery_manuscripts`，不改历史迁移；通过 Workspace/Writing 服务读取来源，不查写同级表。清单固定实际项目、章节版本/顺序、范围、格式、正文/文件摘要与字节数；作者稿不被要求先有 AI 采用。列表与 Domain Event 仅包含引用和摘要，不包含稿件正文、路径或凭据。
- 稿件保存必须具备 Idempotency-Key、If-Match、匹配摘要和明确权利声明。保存状态与 Domain Event 在事务内写入，Host 调用在事务外；Host 在用户明确选择位置后核对实际文件字节，Delivery 只接受匹配回执。持久幂等键使重启重放不再打开保存窗口；保存中/未知、取消、缺回执或校验失败不冒充交付。保存前来源变化阻止旧稿件写入，保存窗口期间变化保留历史回执但标为 stale；部分范围不会冒充完整稿件。外部文件后续变化不被监控，作者权利声明也不冒充授权证明核验。
- 小说候选只读预览和原稿/候选切换使用 Tiptap `setEditable(value, false)`，禁止仅切换可编辑状态触发 `update`、把候选送入草稿自动保存或采用前的 `persist()`。候选只投影到编辑器，不进入作者稿件状态或恢复快照；原稿仍 dirty 时切回候选也保留用户新增内容。没有实际候选时默认视图不锁死人工微调，结束运行读取当前人工编辑状态。真实 UI 验证跨过自动保存窗口后正文及版本保持不变，明确采用只增加一个正式版本；人工修订增加当前版本，使旧采用/记忆/稿件清单失效，历史记录保留。
- Automation 唯一贡献 `/pending` 路由与全局待确认导航，Renderer 的只读聚合通过生成 SDK 读取项目、创作工作流、旧章节修订、Story Bible、正式作者意图候选、导入候选、稿件和任务，不建立全域权威表、不改变原领域所有权。工作流/修订/资料与任务按实际关联去重；游标读取至真实末页、跨项目读取限并行，不截断项目库。读取失败或游标重复显示未核全，不用空列表宣告完成；列表摘要不带正文、Prompt、凭据或文件路径，打开页面不采用、保存或执行付费调用。
- Automation 新增 `/api/v2/projects/{projectId}/revision-previews` / `revisions.list`，读取本域既有修订表，通过 Writing 服务核对章节项目归属与当前版本；不查写 Writing 表、不增加迁移。响应为不含正文/理由的游标摘要；旧待确认修订与当前章节版本不符时派生 `conflicted` 读取状态，不悄悄修改独立 GET 的历史记录，写入仍由明确 Commit/Discard 决定。
- 独立修订实际 Commit 的版本冲突写入状态与本域冲突事件于同一事务；Discard 允许处理 `pending/conflicted`，不调用 Writing 内容写入。重复 Discard 直接返回持久的 `discarded` 结果，不重写状态或重复发事件。已采用修订不可再放弃。历史错误拼写的事件保留原样，新明确放弃事件使用 `automation.revision-discarded.v1`。
- Knowledge 的 Story Bible 列表通过 Writing 服务比较真实章节归属、版本和冻结正文指纹，返回可选只读 `sourceState=current/stale/missing`，原 `status`、时间戳、预览、已采用记忆与历史事件不因读取改变。待确认中心将过期/缺失来源置于“需要处理”，原对象隐藏过期采用/恢复动作但保留明确丢弃；打开的审阅面板合并 Writing 事件后重新读取。真正 Apply 冲突时，`stale` 状态、复核标记与 `knowledge.story-bible-source-conflicted.v1` 在同一事务写入；未采用的冲突草案可丢弃，重复状态操作不写重复事件，已采用记忆仍须走撤销采用。重新生成的去重同时核对指纹与版本，不因正文相同返回旧版本的暂停草案。
- Workspace 的 `AuthorIntent` 八字段契约、`workspace.0007.author-intents` 前向迁移、六条 HTTP 路由和 `workspace.author-intents.v1` 只读服务提供手工/旧字段候选、明确采用/放弃、当前头与历史。内容版本 `version` 不随状态变化，`stateVersion` 作为 ETag/CAS；来源固定项目版本与前一采用头，旧字段原样冻结，不解析自由文本标题，不自动迁移为正式意图。三个新表均由 Workspace 所有，同域项目读取使用调用者事务；候选来源检查、采用头更新、持久请求回执和引用摘要事件同事务，不嵌套 UnitOfWork、不写 Writing/Production 表。已采用快照在项目元数据变化后仍独立有效，只有新的明确采用改变当前头。
- 作者意图 POST 使用声明式 `idempotency=required`，采用/放弃另设 `concurrency=if-match-required`；HTTP 内部策略新增可选 `idempotencyReplay=handler`，仅由已实现持久回执的路由显式启用，其他路由的缓存重放保持原行为。领域重放核对操作、实际项目/对象、输入或状态版本，返回当下 `sourceState/isCurrent` 投影而不重写业务或事件；避免通用旧响应缓存绕过本域检查。新错误响应使用实际 RFC 7807 媒体类型。只读列表去除八字段内容和旧字段正文。
- 正式作者意图工作台复用 Workspace 项目工具入口，不新增第一方插件；八字段差异对照、明确确认、历史版本和精确 `intentId` 返回均通过 SDK，拒绝错项目对象。待确认中心读全部实际分页，来源变化/采用冲突进入 attention，已采用/放弃不生成待办，失败/循环显示未核全。打开面板响应真实项目与意图事件，用户编辑的来源基准只在明确刷新/带入/从当前版本建立候选时改变；保存后的候选和采用头可重启恢复。未保存输入恢复、AI 作者意图生成及季纲引用仍未接通；独立诊断引用的后续增量见下节。
- Writing/Production 原生 `inject` 增加 `workspace.author-intents.v1`，仅经类型化只读服务读取当前正式头，不读写 Workspace 表。`CreationWorkflow.authorIntent` 记录项目与正式采用 ID/内容版本或明确 `none`；可选字段仅用于历史兼容，不能把旧候选补成采用证据。上下文独立分类 `author_intent`，稳定策略路径 `/author-intents/current`，快照只投影正式八字段与引用，不带旧字段、状态版本或待采用候选。正式约束优先于旧项目文案，但不是已发生事实，不强迫小说短剧化。
- Agents Context 优先纳入正式意图，同时保留 `never` 和硬预算：必需正式约束未完整纳入时阻止引擎调用。Automation 保存 binding/实际 referenceVersions/sources 并在检查、修订、复检、重启重试保留同一冻结快照；Writing/Production 在采用前比较当前头，首次采用或替换都会拒绝旧候选。正文、规划、稳定块和已采用历史不自动改写；无绑定历史仅在仍无正式头时兼容。该接入覆盖既有小说规划/章节与 Production 创作操作；后续独立诊断另有显式完整范围核验，不推定通用 Agent 对话或新季纲完成。
- 待确认中心携带具体工作流/修订/Story Bible 变更/导入变更/稿件 ID 返回对应对象，不能以该项目最新候选替代。任务深链接从原预览接口重读实际 Change/Revision/Provider 状态，不用嵌入任务的旧快照授权；全局任务用 `scope=all` 避免误绑定活动项目。项目事件刷新 Session 的项目缓存，Creative 指定项目深链接直接读取 URL 中项目，读取失败、已删除或错归属不打开其他对象代替。现有 `/tasks` 和无参数工作区保留；诊断的独立候选/来源摘要/精确返回见下节，AI 作者意图生成、季纲、独立质量问题和全部当前采用资产的继承尚未完成。
- 共享 UI 的 Dialog 与 Drawer 各自使用独立 Root 包装，不能对同一个 Radix Root 重复 `Object.assign` 并覆盖 Content。确认弹窗和稿件预览使用居中弹窗，辅助栏继续使用抽屉；单元断言组件身份隔离，实际待确认冲突放弃旅程核对弹窗位置与高度。小说视觉比较等待真实创作操作就绪，不以尚未加载的空侧栏作为稳定界面。
- `novel-creation-journey.spec.ts` 通过正常自定义服务商配置及独立安全凭据窗口，接入仅绑定 loopback 的受控模型协议接口。实际 LangGraph.js utility process、Runtime 冻结上下文/检查/Preview/Commit、Knowledge 事实记忆及 Host 文件写入均不模拟；同一 fresh-profile 旅程完成人物/大纲、两章采用、记忆纳入下一章、第二章候选重启后采用、投稿文件保存及再次重启。只有固定模型响应和 OS 保存位置选择器受控；不代表真实模型质量、费用或发行证据。

上述增量新增 Writing 只读采用记录、Automation 旧修订摘要与待确认 UI、Delivery 稿件路由/本域前向迁移，以及 Workspace 正式作者意图路由/本域前向迁移，保持十四插件，不改历史 SQL，也不增加 Desktop/Platform 跨产品依赖；入口 enum、路由与所有权更新后通过命令生成客户端 OpenAPI、架构 catalog 与功能迁移矩阵（589 effective operations）。受控 Runtime 与完整小说 UI 旅程已验证稿件范围、明确权利声明、取消、Host 回执及重启恢复；独立待确认 UI 验证实际修订与 Story Bible 精确返回且不修改正文。作者意图实际 UI 验证旧字段待确认、取消/明确采用、来源失效、精确返回/归属隔离、明确放弃及两次重启；后续六项 Runtime 场景核对四阶段冻结、无头/历史边界、重启重试、隐私/预算和剧本写入保护。新增桌面旅程通过正常 UI 采用正式意图、完成人物/大纲与两章并核对实际模型请求的八字段与来源版本；另一 fresh-profile 旅程替换意图后拒绝旧候选，显示真实领域错误，原稿、当前头与旧冻结绑定重启恢复且无额外模型调用。最新全量 Electron 63 项串行通过（10.0 分钟），九项视觉无基线修改；不据此宣称 AI 意图生成、诊断/季纲或真实模型质量完成。任务全局路由及读取失败使用只读夹具，不代表真实任务执行或付费授权验证。授权证据/用途/地区/期限的完整台账核验、真实模型与用户评测，以及三平台发布 Gate 仍另行验收。

### 2026-09-30 独立改编诊断增量

上节的 589 effective operations 与全量 Electron 63 项是接入独立诊断前的基线；本节描述后续当前实现，不把旧基线外推为新功能验收。

- Production 唯一持有强类型 `AdaptationDiagnosis / DiagnosisRequest / Basis / Content`、前向迁移 `production.0005.adaptation-diagnoses`、候选/当前头/持久请求回执三个表、六条声明式路由，以及 `production.diagnoses.v1` 服务和 `adaptation-diagnosis` 项目工具贡献。服务提供 prepare/validate/preview/reviewState 与本项目 get/current；不新增插件、不改历史迁移、不写 Workspace/Writing 表。`diagnoses.sources/list/summaries/get/adopt/discard` 通过生成 SDK 访问 Runtime。
- `CreationOperation` 新增独立 `adaptation-diagnosis`，不再用旧 `episode` 输出冒充诊断。准备阶段须已有正式 AuthorIntent；用户显式确认目标、权利声明、所选章节 ID/版本、全部非空目录指纹及此前采用头。局部范围固定纳入/未纳入章节；全书范围必须包含全部实际非空章节。快照保存所选原文 SHA-256、顺序及八字段意图，Automation 在创建任务/引擎调用前核对每个来源完整纳入，`never` 或硬预算裁剪时阻断而不假称覆盖。
- 四阶段生成、检查、受控修订/复检与重启重试沿用同一快照。Production 的确定性校验读取 Agents Context 类型化服务，逐项核对实际来源 ID/版本/路径/完整正文摘要及逐字引文；拒绝混入其他产物、无效策略数、重复标识、不存在的 finding 引用和只有标题不同但叙事动作/节奏相同的策略。模型观点、结构规则及人工决定仍区分，不把逐字引文匹配当成语义正确或文学质量证明。
- 每份合法候选保存 2–3 个策略，用户比较保留/合并/删减/重排/重构/节奏/制作风险后明确选择一个采用；不默认选择，也不允许通用 ChangePreview 绕过本域策略决定。内容版本不可变，状态版本作为 ETag/CAS；来源、当前头、采用回执及无正文的 Domain Event 在 Production 事务中更新。历史重放读取当前投影，不翻转采用头或更换策略；新候选才能替换已采用诊断。采用/放弃不改小说或已有生产树，不自动创建季纲、分集、剧本、分镜或媒体。
- 来源有效性通过只读派生计算，不改历史状态/时间。所选版本/正文/顺序、正式意图和竞争采用头改变使待确认候选过期；全书还核对新增/移除非空章节，局部不因未选正文变化而误失效。实际采用冲突才保存本域 conflicted 状态/回执/事件；待确认或冲突候选可明确放弃，作者新稿、已采用诊断及历史保持。完整 provenance 保留 sourceSnapshotId、runIds 和筛选后的模型 ID/Provider/协议，不返回凭据或任意模型配置。
- Automation 通过 owner `review/reviewState` 与 `syncReview` 协调候选、工作流、Task 和 ChangePreview。先完成 Production 本域决定，再于 Automation 本域事务记录 applied/discarded 投影及事件，不嵌套 UnitOfWork。受 effect/supervisor 跟踪的恢复扫描能在跨事务中断后继续核对；幂等回执防止重复采用。仅有工作流成功或 Preview 存在不代表诊断已采用。
- 待确认中心读取 `diagnoses.summaries` 的全部真实游标，摘要不含诊断正文、原文、basis、模型配置或 Prompt；用实际项目/候选/工作流三重关联判断来源变化及本域决定。过期候选进入 attention 并精确返回诊断 ID；已采用/放弃本域状态避免工作流投影滞后制造待办。读取失败/缺能力/循环显示未核全，列表读取不采用或触发模型；实际 Writing/Workspace/Automation/诊断事件合并刷新状态。
- 诊断 owner 接入、季纲 owner 接入前的完整 `bun run test` 基线通过：Runtime 131 项（测试体 87.74 秒）、App 107 项（607 个断言）、Main 51 项及全部契约；加七项季纲纯领域测试后 Runtime 138 项通过（87.95 秒）。该阶段 OpenAPI SHA-256 `3f4cea28206acaf2e4ac1fe7764cb61ff5ae6d9d30d560f13bd09161efa1b7a8`，595 effective operations，build/chunks 与各检查通过。诊断实际桌面聚焦 26.8 秒；审核更新两张改编视觉基线、隔离未读目录 Prompt 后全量 65 项通过（10.5 分钟）。新季纲 owner 的最新证据见下一节，不混用两轮结果。

本增量不代表 SeasonPlan、独立 adaptation-strategy 操作、全书分层索引、全部跨阶段继承、段落级影响、完整试制包或真实模型/用户评测完成。受控模型接口未提供 usage，不能据此声称真实 token、费用、采用率、文学质量或 GA。旧 `episode` 和原著导入初始化的季纲/分集占位仍保留为兼容事实，不能冒充正式采用整季方案。

### SeasonPlan 当前实现边界

`contracts/season-plan.ts` 已定义独立于旧 Season 目录的强类型整季内容、诊断/策略/意图基准、稳定分集标识及覆盖/顺序契约。Production `season-plan-content.ts` 的纯函数派生实际章节版本覆盖，检查来源归属、未说明遗漏、使用/删去矛盾、核心节拍/标识重复及冻结集数/时长/完整顺序；局部范围不扩大，全书声明与未读目录不能矛盾。完整标识重排保留原输入和内容，七项 Node 领域测试通过且加入标准 Runtime 测试入口。

后续已接入诊断改编路径 owner：`production.0006.season-plans` 前向迁移、候选/当前头/请求回执三个表、`production.season-plans.v1`、七条声明式路由与独立 `season-plan` 操作、SDK 和 `SeasonPlanPanel`。实际当前采用诊断及唯一策略、八字段意图、已读原文走 Context policy，任务与引擎前验证完整正文/诊断摘要/意图纳入；未读目录只留在本地 basis，Prompt 仅含已读范围与未读数量。旧 Season、导入占位和模型“覆盖率”不能替代正式候选或采用证据。小说独立写作、原创剧本与已有剧本路径不被要求建立小说或诊断。

内容与状态版本分离；采用用 If-Match、冻结头 CAS、持久领域回执和无正文事件同事务。人工重排完整稳定分集标识，保存新 candidate/content version/sourcePlanId，并须明确采用，不改变旧内容/已有生产树。一个 workflow 唯一模型根候选但可有多个手工顺序版本；首次 workflow 采用回执保留，后续顺序决定单独持久化。Automation owner 同步与恢复核对真实采用顺序版本引用，不把手工编辑当成新模型执行；通用 Preview 在 owner 明确决定前不能采用。待确认使用只读摘要、全部实际游标与项目/workflow/父链关联，分别返回精确候选，读取失败显示未核全，不复制正文。

SeasonPlan 首次接入的历史基线为完整 Runtime 145 项 / 19 文件、App 109 项 / 621 断言、全量 Electron 65 项；OpenAPI SHA-256 `dee1c7c3c8d86c63918241ae7f69270d9a9c3e37d75d2013a74fb63e1ca4bb4a`，602 effective operations。实际文件导入到局部两集覆盖、人工重排/采用、来源失效和重启的同一桌面旅程通过。它不单独证明多章节全书与下游首集；后续三章全书合并/拆分/明确删减、竞争头/新增章失效，以及下游单集增量见根 `docs/PLAN.md` 第 22.8 节和下方实现边界。受控模型不证明真实文学质量/费用或 GA。

### 单集大纲与标准剧本当前实现边界

- Production 前向迁移 `production.0007.episode-development` 唯一持有 `production_episode_results`（正式不可变结果）与 `production_episode_result_heads`；模型候选/任务/ChangePreview 继续由 Automation 所有。新增 `production.episode-development.v1` 服务与 sources/get/实际游标列表三条只读路由。每个正式结果按项目/稳定分集/操作分开版本；旧 `production_creation_adoptions` 只追加本次工作流采用回执，不改历史 SQL、十四插件边界或 peer 表。
- `episode-outline` 准备只接受当前、有效、已采用季纲 ID/内容版本与真实分集标识，继承当前诊断/唯一策略、八字段正式意图、本集章节原文及 Knowledge `approvedStoryBible()`。后者完整读取经知识设定工作流明确采用的 story-bible，依本域采用回执核对，不把历史通用设定或 pending 变更伪装为批准。`episode-script` 另须当前、有效、已采用单集大纲和真实当前剧本/AST 编辑版本。
- 基准为每个实际 policy-controlled reference 的 sourceKind/ID/版本/路径/完整 JSON SHA-256；Prompt 不内嵌 basis 正文或本地未读目录。Automation 在创建任务/调用模型前核对全量实际快照，`never`、摘要替换或预算裁剪阻断；生成/检查/修订/复检/失败重试保持同一基准。Production 结构验证读取冻结快照而非新来源，采用时再读当前 peer 服务（全部在本域事务之外），检查当前头和完整基准，不嵌套 UnitOfWork。
- 单集大纲是强类型 logline/目标/冲突/转折/集尾与顺序场景、节拍、因果、人物、时长及真实章节引用。确定性规则拒绝重复标识/核心动作、外部/旧版本章节、未说明来源遗漏与时长不符。剧本是原生稳定 UUID `ScreenplayBlock[]` 与大纲场景到完整连续块组的映射；拒绝重复/遗漏/重叠、非法顺序、空动作及 Fountain/块不一致。这些是结构证据，不是语义、文学或制作质量门。
- Preview/Commit 明确采用后，正式结果、当前头、幂等采用回执与无正文事件同本域事务。大纲采用不生成生产树；剧本采用仅创建本集兼容目录/实际 script/原生 AST，保存模型返回的稳定块，不重新 parse 或重造标识。新采用不覆盖旧 script；同一季纲下重用实际分集容器，新季纲保留旧容器。没有自动 scenes/shots/媒体；现有导入、Fountain 导出、稳定块编辑与三方合并保留。
- GET 只派生来源状态，不改正式快照。当前季纲/诊断/原文/意图、批准 Story Bible 集合或大纲实际变化仍使相关下游过期；实际 AST 人工修改使旧采用快照不能代表新正文。第22.164节修正整体季纲stale向无关独立单集的传播：仅原明确独立输入完整闭包不变、全部共享正式约束的原头身份／版本／已知实际指纹及完整批准Bible集合不变时，已有单集结果不继承该整体stale理由。未知、缺失、竞争头和实际变化仍拒绝；旧继承协议不补造独立来源。父季纲仍stale，新生成／采用仍要求其当前有效，新剧本仍需按真实AST版本重新确认，不能覆盖作者新稿。
- App 单集工作台按实际季纲顺序选择本集，显式保存基准，不自动重绑；大纲候选以场景目标/因果/原文版本呈现，剧本展示完整 Fountain/稳定块映射。待确认返回实际分集和原工作流，恢复其冻结基准；只读目录不复制 Prompt/正文。模型候选、正式结果/头/块与重启重试均有 Runtime 和真实桌面证据，精确范围见根 `docs/PLAN.md` 第 22.8 节。

### 独立分镜包当前实现边界

`storyboard-package` 在现有 EpisodeDevelopment 所有权内新增独立操作与强类型结果，不修改已经应用的 `production.0007` SQL/checksum，也不新增插件。它继承当前有效的正式单集大纲与标准剧本 ID/版本、真实 AST 版本、诊断/唯一策略、意图、本集原文和批准 Bible；正式剧本使用独立 production reference，经 Context policy 与完整 SHA-256 冻结。失败重试不换源，采用重新核对全部当前基准。

Production 的 `storyboard-content.ts` 只做确定性结构/谱系校验：完整场景顺序与连续稳定块组、镜头顺序/覆盖/场景时长、真实 Bible 与资产使用、逐字对白字幕和相对镜头时码、实际镜头对应的风险引用。模型建议的构图、视觉动作、声音、Prompt、风险和外部依赖不是正式事实、货币报价、资产锁或权利证明。结构检查和模型评议不能冒充专业制作/语义质量门。

候选仍由 Automation/Preview 所有。明确 Commit 后，正式结果/当前头/持久回执/无正文事件，以及本域实际 scenes/shots 同一事务创建；引用实际 script 父级与原有稳定块，不改 AST、原文或任何旧场景/镜头，不生成媒体。结果保存稳定标识到实际 record ID/version 的绑定。当前采用头竞争、候选生成后上一版分镜 record 版本变化或缺失阻止旧写入，新运行才捕获新基准。批准设定、剧本/大纲换头、AST 或上游变化，以及实际场景/镜头编辑/删除均只读派生过期状态，不修改不可变历史。

App 的单集工作台提供独立分镜基准、完整可读内容、明确确认、真实场景/镜头出口与历史；待确认按原分集/操作/workflow 返回，不复制正文/Prompt。6 项纯结构检查、3 项实际 Runtime（含 SQLite 恢复、竞争头、人工编辑、隐私阻断、失败重试）与真实桌面旅程的验证范围见根 `docs/PLAN.md` 第 22.9 节。

以上单集链仍仅为已有小说的诊断改编路径。创意/已有剧本继续既有直接创作或导入修订，不强迫小说/诊断；新操作全部跨入口、全书分层索引、段落谱系、语义/完整权利 Gate、真实模型 usage/质量/费用、用户与发布 Gate 尚未完成。正式分镜方案本身不代表已保存，Delivery 内部试制交付另见下节。

### 保存剧本稳定块顺序合并（2026-10-03 增量）

保存剧本修订的稳定块顺序合并接续见 PLAN 第 22.83 节，按限定范围验收完成：末版正常完整 Runtime 571／App 421／Main 66、固定十一文件后台 30 项及隔离 HMR 均终态通过。Production 三方正文选择与顺序独立：单方／一致重排和明确稳定间隔可自动保留，竞争插入／异序／无位置依据没有 output，完整作者 blockOrder 必须恰好覆盖所选稳定 ID；重复输入或未知选择拒绝。新比较的 strict basis／order/presence metadata 成对，绑定原项目／workflow／script、baseBlocks／candidate／完整 prepared context 哈希、实际记录版本、既有文档身份版本和块哈希。跨 owner 的当前意图／引用核对在 Production 自有读取事务外；GET 不初始化文档。新 rebase 的 apply 在 legacy prepare 前核既有文档，准备后核完整 contextHash，正式写入事务内再核实际文档身份／版本／块，不以记录版本代替实际表达一致。

第 22.84 节 A06.3.3.1 正式场景／镜头实际字段基准按限定范围验收完成。Production 从同一采用事务已写入的 actual row 捕获完整标题／父级／顺序／payload、稳定身份及版本，严格 JSON／哈希保存于不可变结果内部 value_json，不新建表或改历史 migration。局部 redo 只为实际写入记录存新基准，未选基准原 capturedResult 不变；新基准还在正式写入事务内参与实际字段复核。普通版本变化保留机械局部分类，同版本变化／损坏／未核全保持全包复核。原 result schema 剥离私有原值，原 impact 仅追加身份、版本／位置及四字段组 hash 的严格脱敏投影，App 复用原 SDK／显式当前读保护；没有投影／历史缺基准不补最新值或模型字段。普通完整 Runtime 576／39、App 424／Main 66、固定后台 30 项及 HMR 198／79 均终态通过，新纯基准五项与 CI 接线另验，不拼回同一完整命令。完整人工冲突选择与拓扑继续，不在这个基础增量内，完整证据见 PLAN。

Automation 的初次 workflow／task／domain event 事务同时保存合并输出、原 request/sourceWorkflowId 与 parent task，不留空 preparing 再独立写结果。恢复 preparing 或 retry 只进入 rechecking，沿用原 sourceSnapshot／引用／baseBlocks 和作者输出；独立检查可以新增自己的 snapshot。缺失历史 merged output 拒绝重新生成，历史无新 basis 不升级。Client 重发同 key/body 先读原持久回执而不按当前目标重新合并；Renderer 在原请求不确定时持久保存 body-free IDs／choices／hashes／order/key，并由作者明确重发、核完整回执，按原单键精确清理及 scope/workflow 迟到保护。无新 SQL migration／owner／route/plugin 或跨产品依赖。该路径不代替正式 episode-result 的人工记录冲突或更大拓扑合并，也不证明语义质量；当前及失败证据分阶段记录在 PLAN。

### Delivery 内部试制交付（2026-10-01 增量）

Delivery 独立持有 `PilotPackageManifest / Preview / Record`、前向迁移 `delivery.0004.pilot-packages` 与 `delivery_pilot_packages`；preview/get/list/save 四条声明式 `/api/v2` 路由采用当前请求策略、版本和领域幂等重放。新包只读 Workspace 项目、Production 当前正式结果/实际 records、Media 台账/人物状态及 Timeline peek/export；peer 读取在 Delivery UnitOfWork 之外，不直接查写 peer 表、不嵌套事务。Timeline peek 不创建时间线，已有 NLE 由 Timeline 所有者导出。

`pilot-files.ts` 将真实正式大纲/剧本/分镜、Fountain、字幕、稳定引用、媒体缺失说明和运行记录构建成多文件 ZIP；使用显式依赖 fflate 0.8.3，不依赖 App 或 Platform。逐文件 UTF-8 摘要/字节数和 ZIP 摘要来自实际字节，固定 ZIP 时间保证同一文件集可重建核对；相对文件名防止目录穿越，CSV 中和公式，当前结构化内容上限为 30 MB。索引清单不包含自己的摘要，避免自引用；完整文件列表另包含实际 `manifest.json`。公开谱系不复制冻结原文章节、凭据、任意绝对路径或授权证据原文；实际采用的剧本/分镜内容只在明确打开的预览与用户确认的本地包中提供。列表和领域事件不包含文件正文或 ZIP Base64。

PLAN 22.139 为该内部试制包的 `sourceContext` 增加已明确选择的冻结故事解释元数据：选择及采用记录身份／版本／类型、指纹／内容哈希与来源章／保存稿件身份版本。按白名单重新构造，不复制解释正文、私人理由、引文或源正文；显式空选择保留空数组，历史未记录选择保持字段缺失。`evidencePolicy` 明确它不是语义质量证明，也不是到镜头的归因。通用 v4 工程包另由 Knowledge 所有者校验本地路径身份、剥离非引文关系的额外引用，拒绝时不修改原记录；两类包不混同，完整脱敏与映射仍按 M4 原条件验收。

保存须匹配 If-Match、包版本/摘要，并明确确认权利、内部试制用途及未核验事项；状态/回执与 Domain Event 在本域事务写入，Host 等待在事务外。Host 的独立认证 `/host/v1/files/save-binary` 校验受支持 ZIP 输入，用户选择路径后写入、读取核对，再返回不透明 artifactRef、SHA-256、字节数和时间。持久幂等重放读取最新投影，不重复原生窗口。取消/失败/缺或错回执不记成功；中断的 saving 无回执不能推定成功，也不自动再保存。当前来源派生失效不改历史文件/清单，窗口期间上游变化可保留真实历史回执但标 stale。

App 仅通过 Client SDK 访问上述能力：正式分镜入口、文件预览、未知/阻断项、三个独立确认、保存与项目真实游标历史；`pilotPackageId` 深链接返回同一记录，重新打开不恢复授权。第 22.13 节增量中，Delivery 只读 Creative Quality `assess`，独立核对正式大纲、剧本、分镜相同精确目标版本的全部有效已采用报告，而非仅取当前报告头。任何未处理错误阻断保存；新干净/较窄报告不能清除旧错误，人工风险不算修复。全部所需维度覆盖且无错误，只显示“评议证据已核对（不是质量保证）”；未核全仍为 unknown。清单仅加入报告 ID/版本、范围、计数及阻断 ID，不复制原句/人工备注；报告采用或决定版本变化使旧包预览失效，不重写历史文件。旧清单的可选 `qualityEvidence` 保持读取兼容，没有正式报告时保留原来源指纹计算。

完整权利证明未核验时保持 unknown，费用不填零，没有媒体不制造媒体；已有撤回/过期/受限台账或未有效授权人物标记阻断。当前预检并不核验所有授权期限、用途、语义质量或发行要求，不能作为 release-ready Gate。全部跨素材入口和精确影响仍未完成；工程证据按根 `docs/PLAN.md` 第 22.10、22.13 节记录。

### 独立叙事质量报告、专用界面与报告证据门（2026-10-01 增量）

Creative Quality 独立拥有 `NarrativeQualityReport`、前向迁移 `creative-quality.0004.narrative-reports` 的报告/采用头/请求回执三表，以及详细读取、真实游标列表、最小摘要、当前目标目录、人工问题决定五条声明式路由。通过只读业务服务读取 Writing 当前章节、Production 当前已采用诊断/季纲/单集大纲或剧本/分镜、正式作者意图与可信 Story Bible；不查写 peer 表、不修改作者正文或生产树。公开 SDK 与 App 专用质量工作台显式选择当前目标版本/维度、确认基准、创建或读取精确运行/报告、明确采用/放弃、记录人工决定并返回真实历史。目标版本按类型/ID/版本比较，不依赖 JSON 属性顺序；真实版本变化仍要求重新确认，不静默换源。

独立 `quality-review` 复用 Automation 四阶段、冻结 Snapshot 和 Preview/Commit。冻结精确目标版本与实际纳入的约束、字段路径和内容摘要；隐私/预算排除任一必需引用时在引擎前阻断，不使用未读内容宣称完成。报告每项问题带所选维度、严重度、模型来源、建议、源 ID/版本、精确 JSON Pointer 和逐字原句；证据限实际内容字段，不能拿标题/ID 等元数据或旁证替代目标正文。仅校验结构和证据存在，不据此证明模型语义判断正确，不生成总分或质量保证。

第 22.14 节增量增加 `chapter-set`：目标绑定本项目版本，`chapterScope` 明确区分局部所选与全书非空正文，保存按实际目录排序的逐章 ID/版本；仅全书范围要求完整目录指纹，新增空章、目录/正文版本变化也使全书历史报告失效。局部范围不读取未选正文，未选正文修改不自动扩展或重绑旧范围。默认每章原文作为 Writing 独立只读引用完整冻结；模型 `reviewedChapters` 须恰好覆盖全部所选版本，引用与冻结覆盖、未读/空章原因及目录计数不符则拒绝，至多进行既有一轮报告修复。报告保存 Snapshot 的上下文估算/预算，实际 usage 仍未知；最小摘要与事件不复制逐字证据或详细章节覆盖。局部报告不能补足全书维度覆盖，但其中仍有效的已知错误不会被新干净全书报告抹去。该跨章质量增量没有新表、迁移或跨产品依赖；第 22.20 节另接入明确混合表达，仍须完整纳入作者所选表达，不声称任意长篇已支持或语义正确。

### 本轮候选检查证据与实际媒体提交门（第 22.168 节增量）

Creative Quality 通过原 tracked `CREATION_QUALITY_SERVICE` 提供各实际创作操作的检查重点；Automation 的 checking／rechecking 将本轮实际 `output` 交该 owner 校验。新模型检查使用严格 `CreationModelCheckSchema`：每项问题、证据、位置和可执行建议须非空，证据逐字存在于本轮候选的内容字段，不接受指令／来源／旧候选替代、模型自行提交位置凭证或额外字段。owner 记录解析后完整候选 JSON 的 SHA-256 和所有精确 RFC 6901 字段／UTF-16 `[start,end)` 匹配，不猜第一处；结构／匹配数量超限失败而不截断放行。实际模型来源固定为 model；规则问题独立保留。无效检查保留候选与原运行，不生成可采用 Preview；既有一次修订及严重问题阻断不变。历史 `CreationIssue` 兼容旧字段，可选 `candidateEvidence` 缺失只显示未记录，不补当前位置。App 只经 SDK 显示原证据；引文存在不认证因果、文学质量或模型推断正确，无新表／迁移或跨 owner 实现导入。

Media 的视频预检检查当前镜头明确分配的全部视觉资产，不再先过滤未采用／未锁定／stale 后忽略。已知受限／撤回／过期权利声明阻断，未知声明只警告，采用或锁定不认证独立授权；未分配的无关坏资产不阻断、未配置可选视觉资产保留原警告。`video-readiness-v2` SHA-256 绑定实际镜头、服务商声明及成本单位、已采用且来源当前的静帧、全部分配资产的 ID／版本／payload／实际来源状态和完整请求（不含凭证自身）。资产改版或参数变化须新预检，旧 job／receipt 不重写。预检与 Seedance／MiniMax H3 adapter 的实际提交均检查当前代码声明的时长／分辨率，拒绝超限、不静默缩短或默认替换；大小写仅映射同一已声明分辨率。声明不是真实厂商或付费调用验证。界面准确说明这些边界并提供可访问控件；媒体是可选输出，不新增小说稿件的媒体前置。定向 Runtime／后台界面及失败历史见 PLAN22.168，完整 M4 尚未验收。

### 来源锚定事件故事时间（第 22.167 节增量）

原事件声明可选保存 `eventTimeline={storyOrder,timeLabel,interpretation}`：作者审阅的故事时间顺序、时间标签与原文陈述／作者推断来源。仅事件允许，旧声明与未标注事件不补字段；小说段落／采用事实和直接剧本保存块保持独立。时间标注随原 immutable input、双重审阅、原键回执及生命周期冻结，Knowledge 索引与明确选择的上下文引用保持同一原值和原来源依赖，不从当前章节目录、认知顺序或因果边推导时间。界面按原顺序展示，平序只并列，不推断同时；未标注、候选、失效和撤回历史保留，不计为全书事件覆盖或语义认证。实际节点引用指纹包含标注，Production 逐镜头关联通过复用公开字段 schema 的严格白名单接收，同时仍核实际节点、具体原文位置及完整禁止策略；关联／交付只输出指纹和身份，不输出私人时间标签。无新表、路由、owner 服务或跨产品依赖；原版本变化的 stale、拒绝与历史恢复规则保留。两固定长篇、三后台界面及相关门的实际证据见 PLAN22.167；完整 M4 和末版全量尚未验收。

### 本地分层来源索引与精确记忆采用来源（第 22.15 节增量）

Knowledge 提供只读 `knowledge.narrative-index.v1` 和 `narrativeIndex.catalog` / `narrativeIndex.chapter` 两条声明式 GET 路由。全书目录、实际卷和故事弧经 Writing 服务读取，卷分页穷尽真实目录，不读取 peer 表。目录只暴露版本、哈希、覆盖和预算估算；详情按明确章节返回有效派生摘要／事实与逐字锚点，排除条目只含 ID/版本/原因。读取计算投影与内容指纹 ETag，不写业务状态、不调用模型、不创建摘要，也不构造模型上下文或外发数据；未来模型接入仍须经过独立 Context policy。

新增前向迁移 `knowledge.0007.narrative-index-receipts`，Knowledge 唯一持有 `knowledge_creation_record_receipts`。采用章节记忆时，精确记录 ID/工作流回执与正文派生记录、本域采用回执和领域事件同事务写入；不回填历史来源身份、不改已应用迁移 SQL。索引还通过可选 Automation 只读服务核对实际 applied 工作流的操作/项目/目标/源版本及原采用输出，拒绝复制标记、采用后编辑、不符引文或缺字段。历史 Story Bible 记忆和旧仅工作流回执的资料保留并列入未验证，不冒充当前有效摘要；来源服务不可用时明确降级。

规划故事弧仅接受 `narrativeChapterScope={format:'chapter-refs-v1',chapters:[{id,version}]}` 的显式、唯一、当前有序引用。App 经已有 Writing `resources.update`/If-Match 写入，不新增跨域写路由；保留原规划载荷，常规规划字段编辑也保留未知扩展字段。数字起止章号或上级名称不推断 UUID 范围；正文版本、目录顺序、删除或跨项目引用不符时只读派生 stale，覆盖不计入。卷／全书节点代表实际目录归属，不是自动生成的事实或语义摘要。

段落 ID 与完整正文哈希、版本和 UTF-16 `[start,end)` 位置绑定，仅按原文空行分段；逐字引文返回全部匹配及相交段落，不猜测重复引文的唯一位置，不保证跨版本语义稳定。上下文文本预算为 UTF-8 字节/4 估算，不是实际 usage。质量工作台以默认折叠的本地索引显示层级、缺失、失效和明确范围；独立章节记忆运行等待正常 Preview/Commit，只有已采用章节自动同步链可继承该采用而自动写入经检查的记忆。

索引复用质量工作台的现有事件连接刷新 Writing/Knowledge/Workspace 来源和实际 Automation 采用终态，不为默认折叠面板额外开启常驻 SSE。实际隐藏桌面曾暴露新增连接耗尽 Chromium HTTP/1 连接池、后端已等待审阅但界面仍停在准备状态；复用连接后恢复正常读取，不以直接调用 API 替代界面生成操作。

第 22.15 节增量本身不向模型输送索引、旧摘要或本地未读目录；后续第 22.16 节接入小说明确表达与派生隐私，第 22.17 节接入独立高层摘要，第 22.18 节接入小说显式高层混合上下文，第 22.20 节接入跨章质量的独立确认范围与混合表达。诊断／季纲混合后续见第 22.21 节；人物认知／关系／因果完整索引、段落到镜头及精确影响仍未完成。旧通用 `references()` 的历史来源和 `LIMIT 100` 仍是待替换的兼容事实，不能把本地新索引当成这些生成流程已迁移；M4 不因此退出。

采用报告只切换本域报告头，不采用或修订正文；竞争头与来源变更阻止旧候选采用。人工接受风险不等于修复；标为解决须引用同目标/检查范围、当前已采用且该问题不再出现的真实复检报告，生成一份干净报告不会自动消除旧报告问题。读历史时派生来源失效，不改内容、决定或历史时间；重放不重写旧报告为当前证据。领域事件不含原句、Prompt、人工备注或 Snapshot 正文，未提供实际 usage 时明确 unknown。

全局待确认读取全部最小摘要页，隔离项目并去重真实关联工作流/任务；候选、有效正式报告的未处理问题、当前失效报告头分别返回指定 reportId/workflowId。新干净头不抹掉旧有效报告的问题；列表不复制引文、人工备注或快照正文，读取失败/缺能力明确未核全。Delivery 通过只读服务聚合报告范围/处理证据，语义质量与完整发行核验仍未完成。纯证据、小说与正式剧本的 Runtime/隐藏窗口验证范围见根 `docs/PLAN.md` 第 22.12–22.14 节；完整全书语义质量、旧通用剧本等全部目标、规则/人工评议创建、真实模型与采用指标仍需实施。

## Agent Engine 与恢复

### 原运行用量观测（第 22.91 节，A07.1 限定完成）

Contracts 的 observation/page v1 区分引擎报告零、未报告与无效数值，保留单响应增量／运行总量／会话总量／未指定口径和输入缓存包含关系。Agents 的前向 agents.0013 持有 run/cursor 唯一的脱敏 JSON／内容指纹，与 run cursor 和持久 agents.usage-observed.v1 同事务；原键重放只核同一内容，不重复事件，不把多个累计值相加。不含提示词、raw report、任意附加字段、凭据或文件路径；格式、原身份／发生时范围及持久哈希每次读取再核，不可核对返回只读 503。历史无报告不补零，旧 migration 不修改；显式删除原会话沿既有 run 生命周期级联清理本域观测，不将此台账作为外部结算凭据。

工作流 task-runner 和普通对话流在现有 tracked supervisor 内记录 usage。发生时范围绑定实际冻结上下文，旧无上下文记录可由首观测核原范围；后来绑定项目不改写旧报告。AgentRun 的只读 usageScope 不外发正文；没有可核 scope 时不冒充当前项目报告。公开分页 SDK 精确核项目／原 run／游标／唯一序列，UI 明确读取和翻页，失败留历史，不自动换最新运行、POST 或调用模型。Insights 不查写 Agents 表，两个产品没有依赖变化。

Codex 校验原 turn 后标会话累计；Pi assistant 响应标增量、输入不含缓存；LangGraph 各上游响应分别记录，包括已收到报告但结果为空／修复失败的响应。锁定 SDK 会对缺值归零，因而 LangGraph 从其保留 raw 中仅提取白名单厂商字段，缺少报告保持未知，Anthropic 不误标缓存包含，Google 缺 reasoning 分量不补零为完整输出。公开结果只称引擎报告，覆盖 partial-or-unknown，运行来源／费用结算未知；不表示实际收费或质量。正常完整 Runtime 630／42、App 441／77、Main 66／14、同构建十二文件后台 40 项、随后 205 ESM／79 依赖的隔离 HMR 与最终静态门终态 0，准确失败／验证记录以 PLAN 22.91 为准。这里只收口普通 agent-run，旧盲测／灵感摘要的独立消费路径及父 MET-01 继续。

### 指定创作尝试的执行回执与费用估值（第 22.134 节）

Agents 的现有 `agent.task-runner.v1` 增加可选只读 `execution(runId, projectId)`；只有 Agents 读取自己的运行表，按原冻结上下文／首观测核对发生时项目范围。公开 `AgentRunExecution` 仅选持久的模型 ID、Provider／Profile ID、引擎、阶段、状态与实际起止，不外发原模型 JSON、凭据、Prompt 或当前默认配置。记录的模型是原运行保存的选择，不是上游实际服务型号的独立认证。相同实际起止才记 0ms；缺失或倒置时间如实未知／无效，不用当前时钟补算。

Automation 仅读自己的原 `workflow.runIds` 并经该公共服务取得每个阶段；GET `/api/v2/workflows/creation/{id}/execution?projectId=...` 提供严格 `creation-execution-receipt-v1`，完整绑定原项目／工作流版本／操作／父尝试、运行身份及阶段顺序。生成、检查、至多一次局部修订和复检不跨重试拼接。原运行缺失明确为 missing；owner 不可用、身份／引擎／阶段不符返回只读 503，不写工作流、不换最近运行。内容指纹 ETag／304 与 no-store 保留。普通工作台经 `@dramaip/client` 的 `creationExecution.read` 明确读取，取消过时请求，项目／版本／顺序变化或读取失败时不显示旧阶段回执；每个原 run 再读取其原用量，保留既有最后运行用量入口。

第22.166节补充逐阶段原输入入口：SDK `creationExecution.readContext` 先核同一原工作流回执，按明确原run经已有GET读取实际快照，再核原项目／持久snapshot ID、提示与完整表达清单SHA，并在await后重核阶段绑定。未记录、服务失败、身份变化或字节不符保持未知，不用首次生成／最近运行／当前正文补造。普通工作台的生成、检查、修订与复检各自明确读取，显示实际纳入／排除表达、理由、版本／路径、估算／预算与折叠原提示；表达数量不冒充章节覆盖率，纳入不认证模型阅读／理解、字节自洽不认证历史真实性。未纳入表达不展示其值；失败、切项目／版本／run或取消不显示旧缓存。没有新增路由、表、owner服务、模型调用或导出附件，原执行回执仍不包含正文。工程与后台真实验收状态见PLAN22.166，不将此入口单独当成完整M4覆盖验收。

`AgentUsageObservation` 在原不可变 JSON 中增加可选 `costEstimate`：只接受引擎实际报告的非负估值和大写三字母币种，金额与币种分别区分 reported／unreported／invalid，结算始终 unknown。旧记录不补字段、不改原指纹／事件；新记录重放核对金额、币种及漏报状态，改变报告拒绝覆盖。没有新表或迁移，没有 Peer 表访问或跨产品依赖。Pi 本地模型目录合成的 cost=0 不当实际费用，LangGraph 无费用报告不猜 USD，不按 Token／当前单价估算，也不合计累计或跨尝试报告。九项 M2 操作共用实际 owner 回执与逐 run 用量永久断言，真实终态与未验范围以 PLAN 22.134 为准；这些记录不证明文学质量、真实付费结算、权利授权或发行就绪。

### 盲测／灵感整理独立用量（第 22.92 节，A07.2 限定完成）

Agents 前向 agents.0014 独立持有辅助运行及逐游标观测，不假造普通 agent-run。原候选或整理任务、冻结上下文／项目、session／engine run 身份与指纹注册后不可替换；准备运行不证明实际调用，有调用无报告仍未知。报告、游标与持久事件同事务，精确重放不重复；事件仅含不透明 run 引用，不泄漏盲测数值／计量口径。失败已收到的报告保留，整理重试使用新的原 run，历史整数和 migration 不改写。

沿现有只读 GET 提供辅助运行分页，未明确揭盲返回 typed 409，评议不解除该限制；揭盲才返回该候选的真实引用。旧 metrics 只公开执行事实白名单，不返回 token／费用猜值或把 prompt 字符称作 token。整理任务返回自身 usageRuns，页面逐原 run 明确读取，不加总或自动重跑；原范围、报告结构／内容哈希不可核对时 503。共享观测规则保持 reported／unreported／invalid、增量／累计和未知费用；没有新增插件、跨产品依赖或 Insights 跨域表访问。正常完整 Runtime 633／43、App 443／78、Main 66／14，同构建十二文件后台 41 项，随后 206 ESM／79 依赖的隔离 HMR 与最终静态门全终态 0，准确失败／证据以 PLAN 22.92 为准。旧盲测和整理 worker 在插件停止时的在途任务等待／释放另续 A07.2.1，本轮普通 HMR 不证明该延迟场景；不当作真实收费、语义质量或父 MET-01 完成。

### 辅助运行停止收尾（第 22.94 节，A07.2.1 限定完成）

盲测候选通过原生 `ctx.effect(acquire, "worker:agent-evaluations")` 跟踪全部已接受 Promise；停止阻断新请求并 allSettled 等待每个原会话／授权收尾。JSON 或就绪检查晚到也返回 503 RFC 7807，不分配上下文或任务。已接受 owner 保留停止前取得的 UoW，原生上下文停用后不再查取该服务。最后原授权均 consumed、候选全部结束且 evaluation 仍 running 时，同一事务只写一次可评议事实；生成结果不等于整组释放完成。灵感 worker 清计时器、阻断下一任务并等待当前原运行、报告和摘要落库。等待不是提供商取消，异常也不允许提前放弃其他 owner。实际原生 fiber／延迟与三候选先后释放、未知观测和重放共 25 项未过滤定向通过，当前正常完整 Runtime 636／43、App 443／78、Main 66／14、同构建十二文件后台 41 项，随后 206 ESM／79 依赖 detached Node 五 Profile／失败恢复与最终静态门全终态 0，准确失败以 PLAN 22.94 为准。不代表提供商取消、费用／质量认证或父任务完成。

### 小说原文／摘要／段落的明确冻结（第 22.16 节增量）

`NarrativeContextRequest` 只接受真实章节版本与 original / summary 精确采用记录 / paragraphs 版本绑定段落 ID，不接受客户端正文、摘要、引文或任意偏移。Writing 编译实际前文与所选表达：原文只提供正式 content 与必要来源元数据；摘要经 Knowledge 索引的精确回执／原输出／当前正文核验，不附带正文引文；段落核对哈希与实际 UTF-16 位置后只提取所选文字。`NarrativeContextBasis` 保存实际表达、未选／空章、安全源版本与完整引用值摘要；没有隐式最近两章／更早三十章旧摘要或历史通用记忆进入新本章正文。当前章自身完整冻结；下一章兼容入口默认只承接用户指定的 sourceChapterId/current version，可通过同一强类型请求改选。

`AgentContextEntry.policyDependencies` 持有派生引用的原章节安全 ID/版本/字段路径。Context 根据原路径及其祖先的 effective never 排除摘要和段落；派生路径自己的 always 或临时 always 不能解除原路径拒绝。显式调整原路径策略仍沿用既有确认／override 行为，而不是永久锁死策略。Automation 在任务前核对全部必需引用的源类型／ID／版本／路径／完整值哈希与真实纳入状态，另核对含引用标识的完整 Prompt 估算不超过硬预算。快照和后续派生阶段保留同一表达及依赖，不从基础 Prompt 复制被排除资料。

Writing 采用再编译并验证原冻结值哈希、版本和采用来源。仅未选前文独立编辑不失效局部范围；所选正文、摘要、顺序或来源身份失效时不换源。目标正文的明确 Preview 三方合并可重定位目标草稿版本，仍保留生成快照和所有上游约束；没有自动重写作者新稿。旧工作流无此 basis 时不补造新范围，历史可读，但旧隐式引用可能因已退役而要求明确新运行，不宣称历史候选已迁移为新范围。

App 的本章／下一章来源选择分开持久化，只保存安全引用；细节按作者读取，不为每个默认折叠条目启动模型或额外 SSE。公开 SDK、严格 Creation／Continue 输入与兼容 Effect 合约同步。运行可查看实际表达／未选数、逐项估算与源版本、完整冻结预算，仍不提供虚构 actual usage。该增量不新增表或插件，也不增加跨产品依赖；高层摘要需第 22.18 节的独立明确选择，不自动成为小说上下文，完整认知／因果图、其他操作的混合策略和跨版本段落到镜头仍未完成。

### 独立卷／故事弧／全书派生摘要（第 22.17 节增量）

Knowledge 唯一持有 `NarrativeSummary`、当前范围采用头及前向迁移 `knowledge.0008.narrative-summaries` 的两张表。只读 `knowledge.narrative-summaries.v1` 和三条声明式 GET 提供实际范围、真实游标历史与指定摘要；ETag 绑定内容及只读来源状态，读取不调用模型或写入业务。卷归属、故事弧显式绑定及完整目录仍由 Writing 权威服务提供，不直接查写 peer 表；批量索引详情只读取同一次当前本地投影。

严格 `NarrativeSummaryRequest` 只接受 book／volume／story-arc 的实际 ID／版本、范围指纹、预期采用头以及有序全部非空章节原文／精确已采用摘要记录 ID／版本。`NarrativeSummaryBasis` 保存完整目录（含未读空章）、所选表达、安全来源和完整值哈希；缺章、倒序、旧源、未绑定故事弧或不符采用回执拒绝。派生表达不发送原文引文，并经原章节 `policyDependencies` 继承禁止策略。Automation 在创建任务前核对全部完整引用、实际 Snapshot 及完整 Prompt 硬预算，不缩成前几章、不夹带作者未来意图或未选原文；生成、检查、至多一轮修复／复检与失败重试沿用原基准。

输出必须是单一摘要条目，按实际顺序列明全部非空章节，每章至少一项源 ID／版本／路径匹配且逐字来自所选正文 content 或派生 summary 的依据；标题／元数据、未读原文与伪造引用不计。校验只证明结构和来源，不能证明概括语义正确。运行、快照、估算预算与 usage unknown 随候选保留；审阅时持久化一个运行一个不可改写根候选，明确 Preview/Commit 才采用。

采用前在本域事务之外重读实际来源；同事务核对候选状态／版本及预期头 CAS、持久化状态和无正文 Domain Event，切换 Knowledge 摘要头，不写章节或生产树。竞争头／源变拒绝旧采用，冲突候选仍可明确放弃；重复采用／重启重放不把过期记录重写为当前证据。来源失效由读取派生，历史内容／版本／时间不改变。事件仅含安全身份／目标／状态，没有摘要、逐字引文或 Prompt。

App 默认折叠工作台经公开 Client SDK 读取；逐章摘要详情按明确操作加载，安全范围本机持久化，确认前再核对目录和采用头。专用 summaryWorkflowId／summaryId 不与质量报告参数混用，待确认返回精确运行和候选，不复制正文。第 22.18 节先接入小说的显式模型来源，第 22.20 节另接入跨章质量；诊断／季纲混合后续见第 22.21 节；全局已采用摘要失效聚合、完整认知／关系／因果图及真实语义质量仍未完成，不据此宣布 M4、完整分层策略或 GA。

### 小说高层冻结范围与原文／段落混合（第 22.18 节增量）

`NarrativeContextRequest.summaries` 仅接受明确的摘要 ID／版本。Knowledge 读取时派生 `contextEligibility`：当前 adopted 头的原冻结正文和精确章节记忆仍匹配原值及逐字依据时才 eligible；不写历史状态或补造覆盖。完整当前目录仍按既有 `isCurrent/sourceState/staleReasons` 核对。因此新增未覆盖章节可以使当前完整范围 stale，而原冻结来源仍 eligible；不会宣称新完整范围已被概括。

Writing 通过只读 Knowledge 服务取得精确头，核对全部覆盖章节均为本项目实际前文，版本／正文哈希／顺序有效；当前章、未来章、旧头或旧源整体拒绝，不切片摘要、不换最新源。高层参考值仅有摘要与安全冻结身份，不附带原文 evidence、中间章节记忆或动态完整范围状态。basis 独立记录原冻结范围、章节版本／哈希及冻结时完整范围状态；高层与直接原文／段落可重叠，但覆盖计数与 omitted 按章节并集核对。正常多阶段运行和采用继续核对同一完整引用值，未选新章不扩展范围，源变拒绝旧候选。

高层 `policyDependencies` 展平为每个原章节及原摘要 basis 中的中间来源路径／版本，最上层路径仍参与策略判定；任何源或祖先的 effective never 均可阻断，派生层 always／临时 override 不能绕过。App 只按明确读取或恢复已保存引用加载 SDK 详情，不新增 SSE／模型调用，不自动选择高层头或移除原文。展开可核对精确冻结章节及估算预算。公开 SDK/OpenAPI 已同步；不新增表、路由、插件或跨产品依赖。

隐藏桌面复验发现重启后立即采用候选所触发的任务可以早于周期配置 reconciler。Agents Task Runner 在非 Codex 引擎 healthy 但未 configured 时，先经 Host 恢复已明确启用的 provider，再复核所选引擎接受配置；失败在会话／模型调用前明确报错，不换引擎／模型。凭据仍只在 Host 解引用，Runtime 不取得明文。两项聚焦 Runtime 与实际重启立即采用旅程验证该边界；完整命令和后台桌面证据见根 `docs/PLAN.md` 第 22.18 节。

该接入仅限新小说本章／兼容下一章明确来源，不等于所有操作已迁移、完整源谱系、全书语义理解或 M4 完成。第 22.18 节时兼容下一章先建空目标再启动工作流；后续第 22.19 节收敛了来源／隐私／完整首轮预算拒绝前的空目标边界。

### 小说下一章无写入预检与请求绑定（第 22.19 节增量）

Writing 在内存中生成下一章的服务器持有 ID／实际下一顺序／空内容／版本 0 提案，不能由公开 Creation 输入注入。内部 `CreationPrepareOptions.prospectiveChapter` 只允许 chapter 操作，校验归属、目标身份、无现有 ID、空内容及实际下一顺序。Automation `preflight` 经正常 Writing 编译与 Agents 模型选择／上下文分配器核对来源、完整表达哈希、正式作者意图、隐私依赖及完整首轮生成 Prompt；`previewCreation` 复用实际分配逻辑但不写预览或快照，不创建任务、运行、引擎会话或模型调用。小说正常冻结也使用含 instruction、wordGoal 和内容格式的同一首轮提示，不只估算领域基础提示。

通过预检后，Writing 创建该精确 ID／顺序目标，正常工作流重新编译真实已持久目标并冻结，而非保存提案的伪快照。预检到创建／正常 start 之间没有 await；各插件事务保持本域所有权，不在 Writing 事务中包裹 peer 服务、直接读写其表或制造嵌套 UnitOfWork。来源、隐私、模型选择或预算拒绝在新目标及其业务事件／预览／快照／任务之前返回 409；通过后发生的持久化或引擎／模型失败不承诺自动回滚全部跨域状态，已创建的目标及运行保留供历史和显式工作流重试。

`writing:continue-chapter` 仅此路由使用 handler-owned 幂等重放。完整解析请求与实际项目计算 SHA-256；本域持久 `continue-target` 回执保存目标 ID 和请求哈希，成功响应另存原回执。tracked effect 管理本进程 in-flight Promise，相同键／哈希并发等待同一响应，不同项目／来源／要求返回 409；成功响应重启重放不新建目标或换成最新运行。历史回执没有完整请求绑定时 fail closed，引导原工作流历史，不改历史回执、删除原目标或重新绑定旧标识。失败后显式工作流重试保留同一目标及原快照；普通重放不当成新的运行请求。

不新增表、迁移、公开路由、插件或跨产品依赖，OpenAPI 公共契约未变。真实 SQLite 与隐藏 Electron 的限定证据见根 `docs/PLAN.md` 第 22.19 节；不代表全部操作、完整 M4、真实文学质量或发行 Gate 完成。

### 跨章质量的明确混合表达与全文证据边界（第 22.20 节增量）

Writing 将已有正文／精确章节摘要／实际段落／高层冻结范围编译器拆出只读 `writing.narrative-sources.v1`。调用者提供本项目真实有序允许章节 ID／版本，服务独立核对当前非空目录后返回 `NarrativeSourceBasis` 与实际引用，不制造假的目标 Chapter。小说原有编译器仍限定实际前文并另行冻结真实目标章；Creative Quality 只经服务读取，不导入 peer 实现或查写 Writing／Knowledge 表。新服务通过 tracked effect 注册，没有新增公开路由、表、迁移、第一方插件或跨产品依赖。

严格 `NarrativeQualityRequest.context` 仅用于 chapter-set，目标范围与实际表达分离。缺少所选章节覆盖、任一高层摘要全部原覆盖未处于允许范围、非当前采用头／旧源／假段落均拒绝；不补原文、不裁切摘要、不换头。`sourceBasis` 保留章节表达、高层身份／原冻结章节哈希、完整引用值哈希和 omitted，`chapterCoverage.included.representations` 标注实际表达并按章节并集去重。已采用高层的当前完整范围 stale 但原来源仍 eligible 时，只可明确使用原覆盖；未选目录增长不扩大局部范围。历史原文报告没有 sourceBasis 时保持原校验，不补造混合覆盖。

混合模型结果须完整列明 `reviewedChapters` 和每个真实表达的 `reviewedSources={sourceId,sourceVersion,fieldPath}`。问题逐字证据只能来自实际所选表达；派生摘要限 `/summary`，原文／段落限实际 `/content`，标题／ID 元数据和未提供原文不计。高层不夹带中间记忆或原文引文，完整原章节／中间记录／祖先隐私依赖继续生效。Automation 冻结质量首轮实际 instruction／wordGoal／格式及引用，逐项核对完整值和完整 Prompt 硬预算，不能以未纳入的表达生成报告。

已采用且有效的混合错误仍参与阻断；只有全书范围且每章明确包含完整原文表达时才可补足全文维度证据，干净摘要／段落报告保持全文 gate unknown。解决旧问题须当前已采用、同目标／维度／范围／精确表达的真实复检；原文与摘要或不同段落不可互换。采用、只读历史和重启重试沿原快照核对，不重绑新源；selected sourceBasis 先经权威 schema 规范化再比较，避免 JSON 字段顺序误判有效基准。仅高层的动态完整范围状态不参与局部基准判等，原覆盖哈希／表达身份仍必须匹配。

App 复用 NovelContextPicker 的明确来源控件，但传入真实确认范围，不假造小说目标或混用续写选择。默认原文模式不变；开启混合不自动选原文，已确认范围只保存安全引用。报告与运行分别显示范围、实际表达、高层原冻结版本和“不是全文评议”；既有质量事件连接被复用，不新增常驻 SSE。Workbench 仅在 creation.start 收到明确 VALIDATION_ERROR/400 或 CONFLICT/409 后撤销该次请求键，允许修正限制后的新尝试；未知网络结果、超时、5xx 和幂等冲突仍保留原键，其他采用／重试动作不改变重放语义。实际 SQLite、多阶段／重启与隐藏桌面验证范围见根 `docs/PLAN.md` 第 22.20 节，诊断／季纲混合后续见第 22.21 节；语义正确、任意长度及 M4／发行验收仍未完成。

### 改编诊断的明确表达与季纲精确继承（第 22.21 节增量）

Production 的 `DiagnosisRequest.context` 可选择确认范围内的完整原文、精确采用章节摘要、实际段落及已采用高层原冻结范围。通过 Writing 的只读 `writing.narrative-sources.v1` 编译，无 peer SQL／实现导入，不制造小说目标。`DiagnosisBasis.sourceBasis` 分别保存实际表达与范围，季纲原样继承该基准，重编译只核对当前仍是同一精确来源，不补整章原文或扩大范围。历史无 sourceBasis 的原文诊断／季纲保留原校验。

混合结果须完整列明真实 `reviewedSources`。诊断证据保留确认章 ID／版本，并附真实 source ID／版本／字段位置及 `/summary` 或 `/content`，只能引用该章实际所选表达；高层引用必须属于其原覆盖，段落路径绑定真实段落身份，未提供原文、标题元数据及其他章节片段不能充当证据。季纲分集覆盖仍按原章节身份派生，不据此证明全文阅读。Legacy Diagnosis 的 `contentHash` 使用正文原字节，共享 Narrative compiler 使用 JSON 编码字符串；混合基准另存 `narrativeContentHash`，分别核对两种指纹，不改历史值或降低覆盖校验。

新诊断／季纲先走 Task Runner 相同 allocator 的无写入 preview，核对全部表达、正式意图、完整首轮 instruction／wordGoal／格式／引用与硬预算后才持久冻结。拒绝不新增上下文预览／快照、任务或运行；原章节、中间摘要和祖先禁止策略继续继承。季纲的派生诊断引用也携带全部实际表达及其 policyDependencies，不能以 production always 绕过原源禁发。重试跳过新源准备，保留原快照／basis；所选源改变使候选与正式结果 stale，并阻止旧采用，读取不改内容或时间。人工重排保持来源和 reviewedSources，不调用模型。

App 通过公开 Client SDK 独立确认诊断选择，安全保存 ID／版本／段落与高层身份，不保存来源正文；季纲只确认已采用诊断基准。Workbench 依完整 diagnosisRequest／seasonPlanRequest 匹配已确认运行，改变表达不把旧运行冒充新请求。范围、逐章表达、高层原冻结身份与全文证据边界分别显示；来源目录变化才刷新表达章节查询，不增加常驻 SSE。SQLite、纯校验和真实隐藏桌面的证据见根 `docs/PLAN.md` 第 22.21 节。

第 22.21 节增量本身不迁移单集开发的本集完整原文策略，后续明确继承见第 22.30 节；不补足质量报告的全文评议门，不代表全部操作、完整认知／因果索引、语义质量、任意长度或 M4／发行验收完成。没有新表、迁移、公开路由、第一方插件或跨产品依赖。

### 正式改编成果驾驶舱（第 22.22 节增量）

App 的 `adaptation-cockpit-evidence.ts` 经公开 SDK 读取 Workspace 当前正式意图、Production 诊断来源目录/完整诊断与季纲/单集采用历史、Automation 工作流及 Delivery 内部试制记录，跟随全部实际游标。游标循环、跨项目或任一读取失败拒绝整个核验投影；不新建权威状态表、不采用、不保存、不调用模型或媒体、不新增 SSE。首页继续卡和项目驾驶舱共享 query key 与纯派生逻辑，失效时不回退计数完成。

`adaptation-cockpit.ts` 验证唯一采用头、当前来源、诊断唯一策略、意图/诊断/季纲精确引用与覆盖。首集从已采用季纲实际 orderIndex 选择稳定 ID，再核对本集正式大纲 → 稳定块剧本/文档版本 → 分镜/真实生产记录 → 当前内部包/明确声明/无已知预检阻断/Host 摘要字节回执。候选、当前运行与失败只匹配本阶段精确基准；已取消或已采用的新运行不重新暴露旧失败，人工重排候选返回自身 ID，失败链接使用唯一参数不被旧头抢先解析。

五 Gate 显示正式版本、实际范围、已知失效和最早未就绪阶段的唯一主动作；旧树、目录或镜头/静帧计数不能代替正式证据。小说独立三 Gate 不因生成诊断候选而切换目标；已有剧本/原创直写保留独立兼容入口，不创建小说或假诊断。该增量验收小说诊断改编路径，不宣布全部素材入口统一试制链完成。内部已保存 badge 明确限定用途，不表示语义质量/完整授权/发行核验通过。

### 独立直写正式单集链（第 22.23 节增量）

Production 在同一 `EpisodeDevelopmentRequest`／正式结果 owner 中增加互斥的 `direct` 来源契约，与 `seasonPlan` 二选一。它绑定真实 `single_season.entryPath = script | inspiration` 项目版本、当前正式意图、当前真实分集目录下的实际 episode 版本、明确时长及可选作者原稿记录／AST 文档版本；已有剧本路径必须有非空真实原稿，创意路径必须有保存的故事构思或简报。读取 catalog 和 prepare 不初始化历史缺失 AST，null 明确绑定当时不存在。正式生成结果不作为未确认的作者原稿替代。

大纲基准没有 diagnosis、季纲或小说 chapters，episode 用 `sourcePath = direct-script` 实际元数据，不伪装成季纲分集。每场 `sourceChapters = []`，`sourceReferences` 精确绑定实际故事来源 kind/id/version/path，元数据、意图与 Bible 不能冒充故事正文；所有本轮故事来源须有场景映射。下游精确继承已采用大纲的根来源和时长，再核对当前大纲／剧本／真实 AST／分镜头，不允许换原稿或静默重绑简报。实际项目、原稿正文／AST、分集、意图和批准设定源变使历史只读 stale、旧候选采用冲突。

正式剧本追加在原实际 episode 下，原稿记录／AST 稳定块保持；分镜继续分别采用才写 scenes/shots，不生成媒体。Automation 对三项单集操作在 context persistence/task/model 前执行同一完整源隐私与全首轮提示（包括 instruction／格式）预算预检；拒绝不分配预览／快照、任务或模型调用。失败重启重试仍用旧快照，来源改变不能借重试采用。

Delivery 同一内部包清单核对全部正式链与实际文档／生产记录；采用链保留 diagnosis+seasonPlan 或 directSource 之一，不混用，直写作者意图须同一版本。说明文件明确列项目／分集／原稿及文档，场景 lineage 保留 sourceReferences，不造章节或诊断。质量报告聚合、未处理错误、权利与未知项、用途确认和 Host 字节／摘要回执守卫保持。没有新增插件、公开路由、权威表、数据库迁移或跨产品依赖；新契约经生成器更新公开 SDK/OpenAPI。

App 单集面板明确确认真实来源及时间，版本身份本地恢复、正文仍由 Runtime 冻结；下游基准来自已采用大纲，不自动换源。原兼容 `script-revision`／导入检查入口仍可用，但不自动升级为正式单集结果。直写首页继续卡／驾驶舱的正式 Gate 后续接通见下一节；其余操作混合来源、完整语义质量、授权与发行核验仍未完成，此链不是小说改编全部来源表达迁移或完整 M1/M3/M4。

### 独立直写成果驾驶舱（第 22.24 节增量）

`direct-script-cockpit-evidence.ts` 仅经公开 SDK 读取 Workspace 当前意图、Production 真实单集来源目录／完整采用历史、Automation 全部实际游标工作流与 Delivery 内部包，不调用小说、诊断或季纲。跨项目、分页循环／重复对象或读取失败拒绝整个投影；不写状态、不创建业务对象、不自动采用、不调用模型／媒体、不新增 SSE。首页继续卡和驾驶舱共享 query key 及纯 `deriveDirectScriptCockpit`，读取失败不回退旧生产计数。

四 Gate 为实际来源与正式意图／批准 Bible、首集单集大纲、首集标准剧本、首集分镜与内部包。首集来自当前实际目录按 orderIndex 排序；重复身份／顺序、过期项目目录、目录与完整历史头不一致均不任选记录。正式结果须唯一、已采用、来源 current，核对同一实际分集、意图、来源记录／原稿 AST（含历史 null）、目标时长与上下游引用；剧本和分镜保留真实脚本及文档版本、实际场景镜头。包核对同一 directSource、全部正式头、文档／生产版本和明确权利声明及 Host 摘要／字节数回执，已知 blocked 或旧来源不能标保存。

最早未就绪 Gate 提供唯一主动作，候选／失败运行与内部包链接携带实际 ID；当前取消／采用的运行不被旧失败遮盖。没有媒体百分比或必需静帧；当前内部保存明确“非发行就绪”，不冒充语义质量、完整授权或真实费用核验。其余入口格式和完整 M1/M3/M4 仍未退出。

### 原生剧本的只读正式来源（第 22.25 节增量）

Production 只读来源目录和正式冻结共用 `direct-script-source.ts`，现有导入协议明确提交在实际 episode 下的 Fountain／FDX AST-only 原稿无需补写旧正文字段即可使用；读取不初始化文档、不重解析文本、不改稳定 ID。旧非空正文的值、真实块和引用属性顺序保持原冻结兼容；AST fallback 冻结稳定块、独立文档版本、明确 `saved-screenplay-ast-fountain` 表达、格式及损失报告，不冒充原文件字节。空故事、损坏 JSON／块／重复 ID 拒绝；完整隐私／首轮预算和 sourceReasons 继续核对同一表达。其限定 Runtime 正式链／内部包协议与重启验证不代表新的原生文件 UI 或全部素材入口完成。

### 项目内原生文件导入与精确回执（第 22.26 节增量）

Production 追加前向迁移 `production.0008.screenplay-import-receipts`，为既有预览增加 nullable `target_json`／`commit_receipt_json`；0001–0007 不变，旧已提交预览缺回执仍是历史未知，不按标题或相似文本猜测原稿。公开 preview 输入／输出可选 target，commit 可选两项声明，preview 输出可选精确原稿／文档版本回执；旧通用协议兼容，带 target 的新协议必须绑定实际 `single_season` 直写项目版本、当前目录下真实 episode 版本和声明，并检查保存 AST 有非空动作／对白。它是结构检查，不是完整格式或文学语义判别。

目标预检经 Workspace 服务与 Production 自有记录同步读取，在写事务前执行、不嵌套跨服务 UoW；中间无 await。写事务再次核对同一预览身份／目标、pending 和 If-Match，原稿／AST／精确回执／原 imported 事件原子提交。竞争提交只有一个成功，不读取后来改动的源文件。新增 `screenplayImport.discard` DELETE 同一预览路径，仅精确 If-Match 的 pending 可撤销，不删除正式原稿，不增加模型或跨域写入。公开契约、路由目录与迁移清单均由正常生成器更新。

App `ScreenplayImportPanel.tsx` 属于现有 Production 单集开发面板，仅使用根 Client SDK 的 `screenplayImports`、实际来源目录和 Host 文件 capability；没有业务 fetch／IPC 或 Runtime 实现导入。完整块／源位置及损失报告供人工核对，两项声明不在恢复时继承。`screenplay-import-session.ts` 严格绑定同一预览／项目／episode／ETag／目标版本，读取仅 preview GET＋catalog GET；receiptCurrent 核对实际目录中的唯一原稿及记录／文档版本（null 不等于 0）。回复丢失后的恢复只读核验同一回执，不自动重导、换源、确认基准、调用模型或采用。

本地导入恢复只存身份／版本，无正文、路径、grant 或勾选。`episode-source-choice.ts` 另保存手动“待确认”来源身份／记录和文档版本，返回驾驶舱后恢复同一选择；确认基准前须与实际目录版本一致，原稿变化不自动换版本。它不是 confirmed request／授权／正式采用；明确工作流深链接仍恢复原冻结基准，不被另一待确认选择覆盖。项目内受控 OS 文件→正式链→实际 ZIP 的后台证据与失败见 PLAN 第 22.26 节，不外推首页创建前入口、全部素材格式、完整质量／授权或正式发行。

### 创建前原生文件预览与持久初始化（第 22.27 节增量）

Production 通过前向迁移 `production.0009.projectless-screenplay-intakes` 持有独立 `production_screenplay_intakes`，不依赖先建项目。四个公开 SDK 操作 `screenplayIntakes.preview/get/discard/commit` 对应 `/api/v2/screenplay-intakes` 及精确 ID／commit 路径；旧项目内导入协议不变。预览 UUID 在 Host 文件读取前由调用方持久保存，并作为预览幂等键；同键只能绑定同一 grant 指纹，返回已保存 AST，不重新读取后改文件。预览／撤销不建项目，pending 无有效动作／对白不能提交；只有显式单季／script 目标和两项 true 声明可开始初始化。

本域状态为 pending → creating → materialized → committed，pending 可 discarded。creating 先原子绑定创建键和请求摘要／冻结输入，再调用 Workspace 既有 `createIdempotent` 服务；该服务的项目、初始化记录／事件和持久回放回执现归同一 Workspace 事务，旧缺 requestInput 回执保持兼容，新键不能换输入。此修复仅指领域服务，不把普通 POST projects 的既有实现宣称为统一原子事务。Production 不导入 Workspace 实现、不读写其表。

实际目录／分集／独立原稿、原预览 AST 和 materialized 回执／无正文事件在 Production 同事务写入；Workspace 服务另选定实际目录，再由 Production 记最终回执。每个边界有持久状态：已有项目／原稿不得因后续失败重复生成；目录已选但最终回执写入失败，允许核验恰好下一项目版本后继续同次操作。GET 只读实际 owner 记录及 Workspace 服务，核对项目／父级／记录和文档精确版本，不初始化缺文档；已删或已改对象显示 stale。提交同键／同输入重放读取同一回执；历史回执不更新为新对象、不覆盖作者编辑。

App `NativeScriptIntakePanel.tsx` 属于既有首页 Workspace UI，仅通过根 Client SDK，复用完整块／损失组件；恢复指针仅身份／版本／请求键，声明不在 pending 恢复时继承。异常只读恢复，不自动 POST；明确继续使用服务器已确认输入，提交已完成的异常回复需明确打开实际原稿。领域／SQLite 重启与实际隐藏桌面链证据见 PLAN 第 22.27 节；模型与 OS 文件选择受控，不外推所有格式、语义质量、完整授权或发行验收。

### 结构化 JSON 的创建前多集初始化（第 22.28 节增量）

同一 `screenplayIntakes` 协议接受 Host `script-json`，只复用公开 `StructuredScriptDocumentSchema`，不导入 Workspace 的解析器实现。Production 一次解析并冻结全部文件顺序分集、原文／明确场景拼接表达、逐集 UUID 稳定块和实际场景属性；JSON 根块为空，不合并成伪首集。未知文档／分集字段显式报告、不转换，场景按公开 schema 校验、未知属性保留，元数据字段不升级为文件／网络权限或配置。

全部分集／原稿／原 AST／提供的场景和完整 materialized 回执在同一 Production 事务；所有原稿文档 `sourceFormat=native`，单稿 Fountain／FDX 保持原值及旧回执形状。JSON 回执按源身份／集号／文件顺序对应全部对象，平坦打开目标须等于实际第一个条目，不能错绑、少集、重用身份或漏场景。GET 检查全部父级／记录／文档／场景版本，事件仅包含初始化元数据，不发布原文或场景属性；某一原对象变化不创建替代物。Scene payload 的 `原场景资料` 另存经 schema 校验的来源数据，即使字段名与初始化元数据冲突也保留；这些原资料不是已采用 `storyboard-package`。

App 单季文件入口统一到持久面板，逐集显示全部正文、AST／损失、场景资料与回执；旧非单季和小说入口仍独立。任一集没有动作／对白或全部块身份不唯一时拒绝整次初始化，场景标题不伪造 Action。沿用原键／冻结输入／只读恢复，不自动导入、换源或采用；后续单集正式链只使用显式实际来源，不覆盖其他分集及原场景。新 optional JSON 字段保存在现有 value_json，不改前向迁移 0009 的历史 SQL，不新增插件／路由／表或跨产品依赖。当前验证与剩余体验范围以 PLAN 第 22.28 节为准，不外推完整 M1/M3/M4、模型质量或发行。

### 未开始创建的缺失预览与本地绑定解除（第 22.29 节增量）

App `readNativeScriptIntakeRecovery()` 通过同一公开 SDK GET 分类。只接受实际 `StudioClientError`、status=404、现有 Production 领域 code=SCREENPLAY_INTAKE 且严格身份中没有 requestKey；普通路由／权限／网络／伪错误对象或版本／来源回复校验失败均抛错，已有创建键的 404 同样不可解除。该实际领域错误码补入成熟公共 ApiErrorCode 的类型与 schema，不用字符串强转绕过契约；现有 RFC 7807 正文／路由和 OpenAPI 不变。

缺失判断仅为当前读结果，不是取消或服务器永不落盘的证明。UI 保留原指针、明确解释范围；作者点击解除时再次读取同一 ID，迟到的实际预览返回原稳定来源／版本并保留绑定，不清除或另建。只有第二次仍明确缺失且无创建键时，才清除本地恢复指针；不发 DELETE、提交、模型调用或跨域写入。不持久保存缺失状态／声明，重启重新核验；新读取失败撤掉旧可解除判断，未知状态继续保留。既有 creating／materialized／committed 仍走原键／原输入／实际回执流程。

本增量不新增插件／表／路由／迁移或跨产品依赖，不将旧导入补偿协议改成同一持久协议。实际无效 JSON 的 400＋领域 404、断网后保留、明确本地解除、真实晚到预览以及有键的客户端崩溃边界见 PLAN 第 22.29 节，仍不证明完整 M1/M3/M4 或发行。

### 单集完整继承整季实际表达（第 22.30 节增量）

EpisodeDevelopmentRequest 增加可选且只能为 true 的 inheritSeasonNarrative；直写明确拒绝此字段。混合季纲须在 App 展示完整表达后明确确认，不能靠缺省请求补读整章；没有混合表达的历史季纲保持本集原文基准。只读 sources 返回真实季纲的 narrativeSources（身份、原覆盖及章节元数据，不复制正文），与本集 sourceChapters 映射分列。Production 经 Writing 的只读编译服务按整季精确章节范围重建同一安全选择，核对 narrativeSourceIdentity；不拆跨集摘要、不换版本，不接受另选 narrativeContextRequest。

正式 basis.sourceBasis 保留整季原冻结表达，contextChapters 记录完整实际输入范围，basis.chapters 仍是本集章节映射；模型、UI、候选及正式历史分别显示，不把摘要／段落覆盖升级为全文阅读。诊断及季纲引用继承完整原章节和中间记录的策略依赖。Automation 对全部实际引用及完整首轮提示做无写入预检；所选缺失、源 never 或预算不足在分配上下文／任务／调用模型前阻断，不静默裁剪。

下游标准剧本／分镜严格继承大纲绑定的同一季纲和继承标记；重启及显式重试使用原 basis／快照，采用重核当前实际表达和全部正式头。新增 basis 经正式 schema 规范化后参与完整 JSON 哈希比较，避免属性序列化顺序造成虚假冲突；不修改旧数据库或快照。旧混合来源但无精确继承记录的结果保持历史，不自动升级为新基准。Knowledge-owned 章节记忆／高层摘要不纳入批准 Bible 集合或资产白名单；只有真实批准 Bible 可作为分镜资产依据。

App 保存原基准身份，不重绑新季纲。精确深链接的历史候选仍能查看／放弃；新生成和采用仍由 Runtime 校验，不能用历史查看许可换源。没有新增插件、表、迁移、公开路由或跨产品依赖；SDK／OpenAPI 与目录正常生成。此第 22.30 节为整季继承路径；后续独立单集重选见第 22.79 节，段落到镜头精确谱系、局部失效、完整语义质量和 M4／发行仍未完成。实际 SQLite／纯校验／后台桌面终态见根 PLAN 第 22.30 节，不能由本节文字推断完整验收。

### 内部包的冻结输入证据（第 22.31 节增量）

Delivery 只读正式 EpisodeDevelopmentResult 的原 basis，pilotSourceContext 使用明确字段白名单生成 source-context.json；三阶段分别绑定实际结果／workflow／sourceSnapshotId，以及全部原冻结引用的身份／版本／字段／哈希。basis.chapters 与 contextChapters 分列，混合 basis.sourceBasis 输出实际表达和原高层范围身份，不复制正文、摘要、引文、标题、提示词或策略依赖。直写只记录实际 directSource，不补小说、诊断、季纲或没有的原稿。输入证据不是模型理解或语义谱系；旧 scene/block/shot lineage 保持，不自动建立“所有输入→每个镜头”关联。

selection.chapters / higherSummaries.chapters 的 contentHash 沿用 NarrativeSourceBasis 的原章节版本哈希；实际表达值以 references 中精确 sourceKind/sourceId/sourceVersion/fieldPath 对应的 contentHash 为准。两类哈希不等同，不能把原章节身份验证升级为全文输入或语义理解证明。

新文件正常纳入字节／SHA-256 清单与 ZIP，旧存储包仍读取原不可变字节，不在 GET 或升级时重建。原来源有效性、质量／权利、明确三确认、Host 回执、幂等和保存前源变校验保持，不调用模型。无新插件、表、迁移、路由、跨产品依赖或 vendor 修改；正常生成的公开契约保持。完整段落语义映射、精确失效／局部重做和 M4 未完成，验证终态见 PLAN 第 22.31 节。

### 逐场实际引文与规则证据（第 22.32 节增量）

Request 可选 `sourceEvidenceFormat=exact-expression-quotes-v1` 保持历史冻结请求哈希；App 新大纲确认显式保存协议，下游须与正式大纲一致。新场景的严格 `sourceEvidence` 只接受 identity/valuePath/quote/rationale，不能自报 hash 或验证结论。Production 从实际 allowed story refs 与唯一 included 快照值核对精确 kind/id/version/path/contentHash，只在正文／已选段落／实际摘要／简报或原稿 action/dialogue 稳定块中逐字匹配。逐场章节／direct 引用有机械覆盖检查，其他集表达不自动归因，Bible／意图／目录不充当正文。

Owner 派生 `EpisodeDevelopmentResult.sourceEvidence`：无 quote/rationale，保留 quoteHash（UTF-8 SHA-256）、quoteCharacters（UTF-16）、全部半开匹配位置、实际 paragraphId/原章节偏移或原稿 sourceBlockId；摘要没有原章节位置。重复／重叠全部保留，超过 1000 匹配拒绝；标记 model-declared/rule/unverified。下游冻结正式大纲含该 owner 元数据，按相同实际表达重新计算核对后继承；历史 absence 不变，新 claims 无协议拒绝。不创建表或更改历史迁移，原 JSON 结果可选字段经正常 OpenAPI 生成。

Delivery 明确移除 outline.json 的原引用正文，lineage.json 以白名单 schema 仅保留 owner 证据与既有 sceneLinks、sourceBlockIds 和实际记录。镜头继承 sceneEvidenceIds/associationScope=scene，未建立逐镜头语义归因；全部输入仍另列 source-context.json。不可变旧包不重建。完整语义谱系、故事节点、精确失效与局部重做仍未完成；最终验证范围与失败保留见 PLAN 第 22.32 节。

### 实际剧本与分镜变化影响（第 22.33 节增量）

Production 新增只读 `GET /api/v2/episode-development/{id}/impact` / `episodeDevelopments.impact`，仅接受已采用分镜结果；其他正式结果 409、缺失结果 404、非法标识 400。Renderer 只经 SDK，UI 可明确核对及重读。它不是原有 production.impact 的 parentId 后代遍历，也不修改该兼容路由。没有新表、迁移或跨产品依赖，公开契约及架构目录正常生成。

Owner 核对冻结正式剧本 result 身份／版本／项目／分集／实际 scriptId／文档版本，按冻结连续 sceneLinks 和声明 sourceBlockIds 比较当前真实 AST。块正文/type/sceneNumber 规范化后只返回哈希、稳定 ID 和变化字段；parser sourceLocation 与 JSON 字段顺序不算创作变化。共享块的相对顺序独立比较，新增块不会使后续全部块误报重排。action/dialogue 文本编辑定位到声明引用镜头；场景标题、character/parenthetical/transition 上下文变化扩展整场；增删／重排／类型变化亦保守扩展相关场景。新增或删除场景标题、跨场移动、重复稳定 ID、缺失文档或原映射未核全，不猜局部安全范围。

正式 productionRecords 映射与当前实际 project/kind/stableId/parentId/版本逐一核对：单个 shot 版本变化只列该镜头，scene 版本变化扩展子镜头，记录缺失或身份不符列 unresolved。作者意图、故事来源、Bible、大纲／剧本／分镜采用头等其他不确定变化保留全包复核。跨 owner 的来源状态读取在 Production 事务之外，各服务拥有自己的事务；仅实际 AST／场景／镜头读取是同一 Production 快照，不声称全部 owner 跨事务原子性。ETag 为正文隔离报告的 snapshotHash，不授权后续写入。

只读报告区分 affected/no-observed-change/unresolved，固定 semanticVerification=unverified / automaticRedo=false。第 22.34 节将实际 AST 比较上限对齐正式剧本协议的 10,000 块；溢出保守列未核全，边界测试的宽松性能回归限值不是 SLA。第 22.33 节的 5,000 块记录仍是当时事实，不回写历史验收。不写正式快照、头、场景、镜头、媒体、事件或任务，不触发模型，不重建缺失 AST，不重新采用人工编辑或放行旧包。完整语义影响、原故事表达到镜头的精确失效、实际局部 Preview/Commit 重做及媒体按范围失效仍待完成；逐次验证与失败见 PLAN 第 22.33–22.34 节。

### 实际人工剧本的正式确认（第 22.34 节增量）

Production 自有 `episode-script-revision.ts` 注册六个声明路由：正式剧本下创建预览、精确 GET、项目全内容历史／无正文摘要，以及采用／撤回。SDK 封装现有实际 screenplay PATCH 与新确认接口，Renderer 仅使用根 Client；`EpisodeScriptRevisionPanel` 在当前正式剧本中提供逐块文字／标题编辑、实际连续映射、完整冻结预览、三项人工声明和历史恢复。待确认仅消费无正文摘要，携带实际分集／预览 ID 精确返回，失效待确认仍保留；重启不自动采用或恢复声明。

`production.0010.author-script-revisions` 是新增前向迁移，不改旧 SQL：历史结果的唯一非空 workflow 存储列改名 adoption_key，真实模型 workflow_id 迁移到独立可空唯一列，历史 JSON／版本不改。人工确认用自己的采用键及 NULL workflow_id，不伪造模型工作流或运行；新增预览／请求回执表只由 Production 写入。预览冻结实际 AST、标题、连续场景映射、文档／脚本版本、原正式结果和当前大纲。模型候选与人工确认复用 `inspectEpisodeScriptContent` 的结构校验；这不证明语义质量。

预览须来自当前正式 episode-script，实际文档有新版本，全部其他上游有效。If-Match／Idempotency-Key、真实文档和生产脚本绑定、AST/Fountain 一致性、完整连续场景及原大纲头在分配前核对。来源状态通过同域读取和公开跨域服务计算，不在本域事务内嵌套跨域事务；采用再次 CAS 核对实际文档／记录／内容哈希、标题和正式头。结果、采用头、状态、请求回执及无正文 Domain Events 在同一事务，撤回仅改变预览。采用不改实际 AST、脚本记录、场景／镜头、媒体或原正式内容。

新结果显式 `origin=human-script-revision`，绑定实际 `scriptRevision` 回执及同一 scriptId／文档版本；contract 拒绝缺声明、伪 workflow/model/run 或其他 operation。历史模型结果保持原 workflow 要求。人工记录版本变化使该确认快照失效，再次实际编辑须重新预览确认；作者意图、来源、Bible 或大纲失效不能靠手工确认正文解除。下游引用保留人工来源与实际回执，内部 ZIP 明确区分继承确认基础与新模型输入，不补造运行／费用。现有整包分镜流程可接受有效人工正式版本，但旧分镜换头失效门不解除；精确媒体失效与真正局部重做仍是后续本地实施范围。

### 明确选中镜头的局部重做（第 22.35 节增量）

沿用 `storyboard-package` Creation 工作流与 Preview/Commit，公开请求新增 `redoShots`（stable shotId／actual recordId／version），冻结依据与正式结果保存 `storyboardRedo`（原正式包身份／版本／哈希、选中实际记录、原正式剧本身份、固定范围及 semanticVerification=unverified）。不增加插件、跨产品依赖或伪运行。非分镜操作不能忽略局部范围。

Production prepare 仅接受当前正式分镜与同一实际剧本，完整核对人工确认祖先链和不变的 sceneLinks；其他上游／实际记录变化拒绝局部化。按原稳定块与当前正式正文的机械比较要求所有 affected 镜头明确选中，unresolved 拒绝，不将 no-observed-change 当语义证明。选择重复／遗漏真实身份／旧版本在分配上下文或任务前失败。模型实际冻结引用只含选中旧镜头／字幕／风险及所需既有资产，不包含未选旧镜头正文；正式故事／剧本上下文仍依原隐私和完整预算规则纳入，不为局部重做绕过隐私。

`selected-storyboard-shots-v1` 是严格 patch 输出协议；全局字段、整包输出、越界／重复／缺失镜头拒绝。保留稳定 ID／顺序／时长／sourceBlockIds／assetIds，字幕与风险只能指向所选镜头。`storyboard-redo.ts` 由 owner 在本地合并旧不可变包，复用完整结构／覆盖／实际对白规则；工作流 output 和模型检查仍是 patch，不向后续检查器送入合并后的未选旧正文。未选字幕保留，共享风险仅保留未选关联部分。

第 22.82 节新增显式 `redoMode=confirmed-block-structure`（A06.3.1 限定验收完成）：独立 `selected-storyboard-block-structure-v1` 与 `confirmed-block-structure-fixed-shots-duration-assets-v1` scope 冻结原／新场内块映射。Production 核全每一人工确认祖先，原场景身份／顺序／标题块不变，所有曾出现稳定块不得跨场迁移（包括删除后重新出现）；机械 affected 全选择，改变映射的场景镜头完整选择。严格新 patch 只允许选中镜头的同场新块引用，原镜头身份／数量／顺序／时长／资产不变；本地完整重组、字幕和覆盖校验、正式头／文档及实际记录 CAS 保留，原事件及 Media owner 复用，无新表或迁移。旧协议、候选与重试不自动换模式。正常完整 Runtime 555／App 414／Main 66、单列 observations helper 3、固定十文件后台 29 项和 detached HMR 196／79 均终态通过。保存剧本合并的接续验收独立见第 22.83 节；更大场景／镜头拓扑、正式记录人工冲突合并与语义归因不在这些增量内，整体仍 active。

采用再次 prepare 比较全部冻结依据；同域事务核对当前正式头与实际父级／版本，选中 shot 及其 scene 汇总同 ID 升级，未选实际记录无 SQL 写入。新正式根完整内容、全部实际绑定与局部回执同事务，原根不改；无正文 `production.storyboard-shots-redone.v1` 精确携带实际 shot ID／前后版本。重放相同采用键不重复更新，竞争候选／人工记录变化拒绝旧提交。

Media 的 tracked durable consumer 仅写自有 `media_records`／`media_audio_tracks`／`media_animatic_drafts`，按实际 shotId／关联音频素材匹配；旧素材标 stale，音轨 stale，包含选中镜头的动态分镜 returned。回放凭来源版本／创建时刻与已处理结果避免污染之后的新素材或重复写入，无正文失效事件与本域写入同事务。图片／语音生成捕获实际镜头版本并在异步完成时核对；`media.0006.shot-source-versions` 是新增前向迁移，仅给视频 job 增加可空实际镜头版本，不修改历史 SQL。视频归档按原任务来源核对，旧任务无版本不伪造。失效静帧／视频拒绝重新采用，视频预检与动态分镜初始化忽略 stale 媒体。没有删除／重生成／擅自取消远端任务。

上述普通局部采用路径仍保护固定结构／来源块／时长／既有资产，拒绝直接覆盖实际场景或镜头的新人工修改；第 22.85–22.86 节另增明确字段比较／选择／冻结复检路径，不绕开原保护门，也不是任意局部合并编辑器。原故事表达到镜头语义影响、更大拓扑、跨域完整逐轨失效与人工复核闭环仍未完成。既有整集动态分镜指纹门保留其保守范围。新增工程／实际后台证据及首次失败按 PLAN 第 22.35 节分别记录，不等同真实模型质量、费用或发行验收。

### 真实场景／镜头创作字段比较与冻结合并（第 22.85–22.87 节）

Production 的 `compareRecords` 领域服务处理实际原字段基准、当前正式行与冻结局部候选的三方读取；Automation 只读自己的工作流后调用此服务，声明 GET `/api/v2/workflows/creation/{id}/record-merge`，不访问 Production 表。只接受仍待审阅的明确选中镜头候选：原保持块结构模式用 v1，第 22.87 节已确认场内块结构模式用独立 v2，不自动升级。正式来源、意图、实际脚本／文档块、原正式头、完整实际绑定和各捕获结果历史重新核对；历史无原基准、损坏、未选记录新修改或当前保护字段偏离实际旧基准均拒绝，不创建运行、模型请求或正式写入。

公开 `storyboard-record-field-comparison-v1` 投影只含实际标题、场景动作和七项镜头创作文本白名单与身份／版本／完整字段哈希。非文本值只返回状态／哈希，自定义字段原值不外发；父级、顺序、时长、来源、稳定身份和资产不能用创作选择覆盖。比较哈希作为 ETag，语义状态固定 unverified、automaticCommit=false。SDK 严格核对原项目、分集、候选版本和原正式包；页面显式重读，失败、重读中、迟到或其他客户端缓存不得替代本次结果。

`storyboard-record-field-comparison-v2` 另带 owner 派生的原结构 receipt、原／新场内块映射、当前正式剧本身份／版本、实际父级及文档版本 proof 和 structureHash，比较哈希包含全部证据。SDK 必须给出对应原 scope 的 expected proof；旧无 proof 调用拒绝 v2，不能回退 v1。Production 复用原只读完整人工确认链，重核机械受影响选择及场景完整选中范围；只有 owner 从原已验证结构 patch 派生 scriptBlockIds／sourceBlockIds 的保护写入，用户选择仍只有创作白名单。当前人工保护结构即使等于新候选映射也拒绝。采用事务再次核确认链、原／新映射和实际旧基准；身份／数量／顺序／时长／资产不变，未选记录无写入，不支持更大拓扑编辑。

第 22.86 节接通 POST `/api/v2/workflows/creation/{id}/record-rebase`：严格无正文请求必须包含全部字段选择、原项目／分集／候选／正式包及比较哈希，作者核对与模型披露确认；If-Match／Idempotency-Key 必需，业务层重放返回当前实际回执，绕开原始响应缓存。Production `mergeRecords` 只读派生所选镜头候选及白名单字段引用，完整当前私有行留在 owner。边界空白若会被正式镜头协议裁剪则拒绝，不暗改人工原文；标题与场景动作独立选择，不伪装成正式包本来具有的字段或语义一致证明。

Automation 重新预检原冻结来源加所选新文字的全部上下文、实际字段／记录／父级与原来源隐私链、完整提示预算，拒绝先于快照／任务／模型分配。新快照只带所选白名单，不带完整三方差异或自定义字段；初次 task／原 request／比较／输出同 Automation 事务落库。合并与失败重试只 recheck 原输出，不重新生成。Production 再核原候选与源、完整冻结字段与复检快照，最终采用事务内重读所有实际行的版本／完整字段哈希／父级／顺序和真实剧本块，保留当前私有字段，只更新选中实际镜头及场景；版本从实际 current 加一，新基准与原 Media 失效事件同事务。旧候选仍受原保护，不自动换协议。

App 只持久原身份／选择／哈希／原 key，重启不自动 POST，显式重发核对同一回执，迟到回执不清除其他请求；默认候选发现不自动切到合并子运行，明确精确链接才打开，另行审阅采用。第 22.87 节 v2 只读展示冻结块映射，原请求额外绑定 structureHash，不保存可编辑映射／正文；实际 SQLite 原回执与重试、完整隐私／重复提示预算及后台重启另行采用已定向验证，正常完整／固定后台验收状态以 PLAN 为准。任意拓扑和语义归因仍须接续，父 A06.3.3.2 保持 in-progress，不把受控接口验收当文学质量、真实成本或发行就绪。

### 作者冻结场景镜头计划（第 22.88 节，A06.3.4，限定验收完成）

`scene-shot-plan` 必须携带显式 `author-scene-shot-plan-v1` 和完整旧镜头实际选择，不能由固定或确认块协议忽略新结构。`author-frozen-scene-shot-plan-v1` 回执包含旧包／hash、旧实际镜头和原剧本、新／复用镜头计划及原新块映射；新镜头使用尚未使用的 UUID，复用者绑定同场旧 actual ID／version，作者在请求前明确连续顺序、整数秒数及原正式资产引用。Production 只读核全所有实际旧字段基准、完整人工确认祖先和历史正式包保留身份；未选场景映射变化、跨场迁移或正式场景拓扑变化均拒绝。无变化的镜头计划不默认为合法结构操作。

Model 只可输出严格 `selected-scene-shot-plan-v1` 局部镜头表达／字幕／风险，不能改写作者冻结的身份、顺序、时长、资产或全局包。Owner 按计划重组完整新包，保留未选值，校验正式场景时长、完整块覆盖和逐字对白；仅从新 proposal 清单移除已经无人引用的原资产定义，不删除 Media 存储。选中引用和正式来源完整禁止依赖仍参与实际首次提示预算／隐私预检，未选镜头与私有实际字段不作为局部基准外发。

前向 `production.0012.storyboard-record-retirement` 只新增 owner 的退役结果／时间列及 active 索引；不修改历史 migration。采用事务复核当前正式头、确认链、文档块、全部旧实际字段／版本与历史保留身份，复用 actual ID／标题／私有 payload、更新明确表达／顺序，创建新行并捕获新实际基准。将移除旧镜头保留 payload／parent 并增加版本和退役回执，旧结果 JSON 不回写，新正式 binding／baseline 仅含 active 行。失败整事务回滚，新建／更新／退役和原失效事件不部分落库；原 key SQLite 重放不再写行。

默认列表／排序排除退役者；原 ID GET 返回只读 retirement 事实，不能普通 PATCH／DELETE、借祖先删除级联历史或把已用稳定身份重新解释成新增镜头。Media 经中立 Production service 读 retirement，保留旧素材但拒绝新的当前来源／媒体任务；原失效消费按改变的旧实际 ID／版本使旧衍生复核，不写 Production 表或删除／取消付费成果。此 scope 明确不接旧 v1／v2 字段合并，不开放保护结构选择，待第 22.89 节新范围自己的合并证据。作者编辑器只存计划元数据，确认不分配模型；仅显式 shotPlan 分支更新 order_index，原固定／确认块普通采用保持 payload-only 更新，SQLite 拒绝顺序写触发器已验证。冻结审阅、新增／退役及重启采用已通过修正后正常完整 Runtime 614／App 437／Main 66、同构建十一文件后台 38 项及随后 detached Node HMR 202 ESM／79 依赖，截图已核对，无视觉基线更新；逐轮失败／终态见 PLAN。14 first-party／两产品独立不变，不宣称场景拓扑、语义安全、真实权利费用、父任务完成或 GA。

### 作者镜头计划实际字段合并（第 22.89 节，限定范围 done）

Production 独立 comparison／merge-request／merge v3 绑定原 `author-frozen-scene-shot-plan-v1` 回执、正式 script／actual script／document 版本和结构哈希；原 v1／v2 不升级。原场景及确实复用的 actual ID 提供三方白名单文字，新增不造旧基准，待退役只读原／当前版本及完整字段哈希。全部旧行仍核不可变 baseline 捕获来源、当前归属／保护结构／私有字段哈希，未选改稿拒绝；每次比较与采用重复核原作者计划、旧完整身份、历史 reserved UUID、正式来源和确认映射。合并仅选择文字并复检冻结输出，不重新生成结构；完整源 ancestry 和所选文字预算在任何快照／任务分配前核对。

同域采用按本次比较冻结的实际版本更新复用者，只有显式 shotPlan 分支写冻结顺序／秒数／资产／块来源，原固定与确认块合并仍不写顺序列。退役使用被冻结的当前版本，标题、完整 private payload 和 parent 不改；新实际记录、退役、baseline、正式头及持久事件整体回滚。Body-free 原选择／哈希／幂等键恢复不存正文或可编辑计划，重启不自动 POST。正常完整 Runtime 624／41、App 439／76、Main 66／14、同构建十一文件后台 38 项及随后 detached HMR 202 ESM／79 依赖均终态通过，最终截图已核对，静态一致性门通过；仅收口本节限定范围，不宣称父任务、语义安全或真实计费完成。

### 逐轨冻结与 Timeline 来源门（第 22.38 节增量）

Media 的前向 `media.0008` 新增 `media_audio_track_sources` 不可更新证明和 `media_audio_adoption_requests`，不回填历史轨。逐片段保存实际镜头版本／所属树身份、音频素材版本／内容哈希／绑定头、音色／样本／人物版本与内容指纹，并保存实际分集版本；跨 owner 只读服务在本域事务外。列表投影重读真实来源而不写历史或事件；创建前拒绝跨项目／分集、错映射／类型、失效正式来源。采用 If-Match／幂等回执、CAS 与脱敏事件同事务，重放返回当前源状态而非复活旧证明。

Timeline 的前向 `timeline.0003` 新增 `timeline_audio_assembly_requests`；时间线／历史／装配回执／事件同事务。预览只纳入当前有效采用轨，输入冻结 timeline ID／version、实际来源指纹和选择；旧预览不能换最新源，字幕只来自选中轨。人工／锁定片段按精确 sourceClipId 保留；新音频／字幕 clip 固定实际采用轨 version／fingerprint。导出／服务导出及渲染预检／新提交／重试重读 Media 服务，并在 Host await 后再次核对，缺失／过期来源阻断，不改文件或历史轨。Zod 与过渡 Renderer 契约同步，SDK 组合及 Renderer 仍遵循 Client 边界。

这个增量没有实际音频播放、声音授权／费用证据、完整逐轨复核／人工替换冲突和正式 Media Gate；手工文本轨不等于音频可用，机械一致不等于叙事／字幕／声音质量。工程及后台命令终态与失败保留见 PLAN 第 22.38 节。

### 人工音轨修订与独立采用头（第 22.39 节增量）

Media 前向 `media.0009.explicit-audio-revisions` 独占修订快照、确认头、不可更新的逐片段修订谱系、替换采用头及持久请求回执五表；不改旧迁移、不回填推测映射。新增五个声明 `/api/v2` 操作：原轨游标历史／创建预览、指定预览读取、明确确认／放弃。写操作必需状态／原轨 If-Match 与幂等键，RFC 7807／traceId 和状态 ETag；游标绑定真实原轨身份。重放重读当前投影，不重复分配草稿或发事件。

原轨实际 ID／版本／片段内容与原确认头冻结；候选片段在 Media 自有 `audio-sources` 的 prepare 阶段重新核对所有真实归属／来源版本。新 UUID 先固定为候选身份，不在预览时创建音轨。旧片段映射须真实属于原轨且唯一，新增／删除由完整候选推导，不接受客户端伪造谱系。确认在事务外同步读服务核对候选真实来源，在同域事务内 CAS 原轨版本／确认头／预览字节，写入新草稿／不可编辑来源证明／修订谱系、三项人工声明与时间、确认头、请求回执和仅身份的 Domain Event。放弃不写轨或文件。

确认头不是采用头。另行采用新草稿时，沿不可编辑谱系核对当前确认头，并与既有采用／回执同事务更新原轨替换采用头；旧竞争草稿不能覆盖新确认。原轨不更新片段、版本或状态，只读投影标为历史来源不再有效。旧已装配音频／字幕保持原引用和人工编辑，继续由 Timeline 的实时来源门保护；本增量没有跨 owner 写 Timeline 表，也没有自动换源／删除或调用付费 Provider。

SDK 在手维护 StudioClient 组合文件新增 `audioRevisions`，正常生成 OpenAPI；Renderer 只经 Client。指定轨的 `AudioRevisionPanel` 读取全部真实游标历史，保存精确预览选择及输入哈希对应请求键，不保存勾选同意；重启恢复原预览，状态／来源变化清空声明。完整新旧片段／时间／版本及新增删除映射可读；只在实际素材版本仍与冻结版本一致、且是受限 audio data URL 时展示内嵌音频，不以当前字节替代旧快照。全局待确认后续接通见第 22.41 节，完整归档媒体播放、实际音色质量／权利／费用仍待继续；人工时间线换源／移除见第 22.40 节。工程及后台终态与失败分别见 PLAN，机械来源不代表质量或整体退出。

### Timeline 人工片段换源与移除（第 22.40 节增量）

Timeline 追加 `timeline.0004.explicit-audio-source-resolutions`，独占冻结预览／真实历史和持久请求回执两表，不改旧 SQL 或回填历史证明。六条声明 v2 操作包含实际候选目录、游标历史／预览、指定预览、确认／放弃；写操作必需 quoted numeric If-Match／幂等键，保留 RFC 7807／traceId，重放重读历史投影而非重复执行。游标绑定实际时间线，真实不存在与非法输入／状态／条件／键冲突分别拒绝。

通过 Media 公开只读音轨／素材服务在 Timeline 写事务外同步读取，不导入 Media 实现或查询 peer 表。候选须同项目／分集／兼容类型、当前有效已采用，逐级沿 Media 不可编辑 revision.clipLinks 对应旧 sourceClipId；无映射、循环、跨域或源偏移＋时长不足拒绝，不猜对应、不裁短。本轨实际当前片段可显式重绑；历史 Media 缺证明不能自动提升为有效，必须另行真实人工修订／采用。新素材须冻结实际版本一致，只接受受限 opaque mediaRef，未能接入则未关联而非保留旧媒体引用。

预览固定全量 before／after 及明确逐片段动作、原来源／实际目标／链／参数和移除理由，无 Timeline 编辑或模型运行。确认前重读实时来源并核对冻结指纹，同域 saveForward 精确 CAS 当前规范化 Timeline、预览 JSON，再一次事务写 Timeline／undo／清 redo、三声明／时间、确认快照／回执与身份事件；终段回执失败全部回滚。新快照使用既有 Timeline Zod 规范化，不以 optional 字段重插入顺序误判历史。只替换明确选中引用，保留 ID、轨、位置／时长／偏移、音量／淡入淡出／降音及锁定；字幕文本独立明确选择，移除不删 Media／文件。自动装配预览的 protectedClipIds 与实际保存一致包含 locked 或 manuallyEdited。

新 `timeline.audio-resolution-previewed/confirmed/discarded.v1` 与 `timeline.audio-resolved.v1` 只载身份，不含正文／理由；既有一般 Timeline 编辑／undo/redo 事件协议未在本增量改造，不能外推为全部事件均无正文。确认可撤销／重做，旧回执不再次编辑，后续 Timeline 版本或来源变化投影为历史／失效；旧引用仍受导出／渲染门保护。App `AudioResolutionPanel` 只经 SDK `audioResolutions`，读全部真实分页，精确选择与输入哈希对应请求键可恢复但不保存声明；换时间线清空未确认编辑基准，状态／来源变化和重启重核三声明。安全音频查看复用实际冻结版本一致的受限 data URL 规则。全局待确认后续接通见第 22.41 节；完整归档播放／权利／费用与正式 Media Gate 未完成，工程与后台终态单独见 PLAN。

### 精确正式来源的七天项目续写观察（第 22.50 节增量）

公开契约增加 owner-derived `CreativeContinuationBasis`，只有内容 owner prepare 能冻结，CreationInput 不接收自填 basis。Writing 使用实际紧邻目录、明确上下文及本域 writing_creation_adoptions 的精确章节／版本；Production 使用实际季纲 ID／版本或当前直写目录的正式首集结果与真实第二项，历史／非正式稿不补证明。采用事件可选 continuationTarget 绑定目标 SHA 与真实序位，缺字段的历史事实不回填；正式人工剧本亦由自己的 Production 采用事实提供锚点。Writing 采用中直接使用现有 tx 读取本域目录；Production 需服务查询的锚点在进入采用事务前同步读取，原 CAS／来源 Guard 保持。

新增 immutable forward-only automation.0009／insights.0004，各自只写本域 receipts／event projection。Workflow 创建事务记录请求；真实 Host 会话接受后，匹配持久 managed run／session 才在状态事务内写唯一 started receipt／Domain Event。预分配 runId／空目标／接受前拒绝不计，接受后流失败不擦掉实际启动；recheck／review 不生成续写启动，retry 继承原准确 basis。对 runner 返回显式只选 runId／sessionId，不把 taskId 或错误正文展开到严格事实。共享单工作流 lease、停用释放和迟到取消保护继续生效。

Insights tracked consumer 严格核对 owner envelope／workflow version、先前准确 request 和真实 source owner id／version／target identity，仅投影本域不可变事实，不读 peer 表或调用 Host／外部分析。每项目每路固定首个有完整记录的正式成果七天窗；后续正式修订须有自身 owner 事实但不重置起点。小说章与剧本实际第一集分开；实际相邻目标与同 scope 核对，不从标题／目录条数推测。未知历史、未关联本窗和异常时钟分别保留；投影／checkpoint 分步安全重放，统计失败不反写已采用内容。

项目 summary 的 continuation 与全本地只读 `/api/v2/creative-continuations/summary` 保持不同作用域，全局只有两路 aggregate 与 projection health，不返回其他项目引用。只用满窗 eligible 项目算 rate，未满包括提前续接始终 pending，缺分母为 null；strict schema 校验两路唯一、算术、精确七天截止与 asOf 状态。SDK／Renderer 走正常公开 client、取消信号、只读 Query 与错误／滞后提示，无正文／路径／凭据或外发遥测。当前未知模型分类不变，不等于公开留存、文学质量、真实费用或 MET-01／M4 退出；本轮首轮失败、限定／完整／固定后台终态逐次见根 PLAN 第 22.50 节。

### 四类首候选的真实请求、内容身份与采用耗时（第 22.49 节增量）

Automation 追加 forward-only `automation.0008.creative-metric-receipts`，只写本域 request／candidate receipts。实际 start 的工作流／任务事务内追加 `automation.creative-requested.v1`；进入 awaiting-review 的真实状态事务内追加 `automation.creative-candidate-ready.v1`；实际失败、取消、放弃、中断及采用被拒分别追加 `automation.creative-metric-state.v1`。所有事件均最小、严格、无正文／标题／prompt／错误正文／路径。没有独立计数服务或从旧状态补事件；同幂等键重放不会增加请求。

目标 key 是本地 canonical SHA-256：项目、四类操作和实际章节／正式单集稳定身份；诊断与整季方案按项目。Automation 核对本域完整既有工作流历史，历史请求算入 attempt 防止新指标开始后把重试伪装首轮，但没有历史新事实就不补分母。请求绑定原 source versions 和 retry／rebase 父工作流；缺真实目标或手工正式剧本不伪装模型候选。候选只从真实第一次进入审阅的输出生成身份／内容指纹；采用失败时同为 awaiting-review 的人工内容不虚构一次新候选。

Writing／Production 在正式采用事务内为四类实际候选增加可选 identity。章节按实际采用正文，诊断／季纲／剧本按各自公开结构规范化内容计算指纹；人工正文 patch 或季纲重排不能只靠同 workflow ID 冒充原候选。旧七类事实的可选字段缺失保持可回放，不修改原迁移或补历史证明；普通人工正式修订仍按自己的正式结果计量，不进入首候选分母。

Insights 追加 `insights.0003.creative-funnel` 本域不可变事件表，复用 tracked durable consumer 独立事务投影三类 Automation 事实。严格核对 owner／event type／aggregate／版本与原请求，event ID／cursor 内容不可替换；只读两个 Insights 台账关联正式采用，不导入 peer 实现、查询 peer 表或调用 Host。四类分母分别为有真实最初请求的原首候选，exact ID／指纹／workflow 才进分子；人工改写、待决定和结束未直接采用分别计量，retry／regenerate 不重置。全量本域记录汇总不受 UI 页长限制，GET 无写入或任务副作用。

现有项目 summary 扩展严格 `funnel` 契约，SDK 校验四类唯一、显式 null 分母、完整候选分类与三段时钟一致性。首个实际 owner 采用依次关联原请求、最初审阅及采用时间；改写后采用明确单列，负 UTC 差为 null／inconsistent，不补零。UI 明示截至当前含 pending 的本地占比、模型分类 unknown，不等于公开采用率或纯生成性能；无外部 telemetry、真实费用／质量分类或七天续写观察。普通工程、后台桌面实际终态和首轮失败见根 PLAN 第 22.49 节，不以第 22.48 节旧证据代替。

### 本地正式创作结果与 Insights 去重投影（第 22.48 节增量）

Writing／Production／Delivery 分别在真实正式采用、或精确 Host 成功保存回执的本域 UOW 中追加七类最小结果事实。公开 schema 只含 owner envelope、opaque scope／workflow／对象与正式／来源版本、human／rule 证据、unknown 模型分类和 unverified 质量；拒绝正文／标题／prompt／凭据／路径。候选和普通编辑、仅 GET 输出不伪造采用或交付；人工正式剧本不用模型 workflow 也有自己的采用事实。

Insights 的新不可变 forward-only migration 只新增 `insights_creative_outcome_events` 与 `insights_creative_outcome_units`；tracked durable consumer 从公开 owner 事件派生本域投影，不触及 peer 表、正文、Host 或外部分析。事件页和单位表同一 Insights 事务，Event Runtime checkpoint 独立；投影后 checkpoint 前重放幂等，完整 event 内容／owner／对象／版本不可替换。缺失项目在回放时跳过，不重新建立项目。统计故障只显示 retrying／degraded，不回滚已经完成的权威业务事务，不宣称跨 owner 原子提交。

单位 key 是 kind 加 canonical 冻结正式版本集合的 SHA-256。章节等正式对象各自 ID／版本；稿件为所选章节版本集合，内部包为大纲／剧本／分镜／剧本记录绑定文档版本／实际制作记录版本集合。重复保存保留各实际回执，不重复增加成果，首事实时间不因后续格式／保存时间更新。SQL 全量 grouped aggregate 提供累计／滚动七天，事件页使用项目内真实 cursor，拒绝外国游标，读取无需排空事件或任何写入。

只读 `/api/v2/projects/{projectId}/creative-outcomes` 与 `/summary` 有声明式 OpenAPI、RFC 7807、no-store／ETag；Renderer 使用正常 `@dramaip/client` composition、严格响应 scope／事件身份、取消信号及项目 keyed Query，不直接 fetch／IPC／Core。结果页面分开小说／剧本、采用／保存和已知／未知，错误不折成空态，投影滞后明确未核全。新事件加入生成目录时，架构 generator 先编译源码 owner 声明，内容变化后仅重启自身以重新载入 static manifest，检查模式不写文件；Runtime 的 owner／声明校验未放宽。

第 22.48 节验收时未有历史生成／状态回填、外部 telemetry／默认同意、首候选分母／采用率、七天续写观察窗、真实成本或可信模型分类、叙事质量率与完整漏斗；后续四类本地首候选及采用耗时增量见第 22.49 节，其余边界继续保留。该节结果只证明正式采用／实际保存，不证明当前 source、合法权利、语义质量或发行。该轮普通／后台终态与首次失败见根 PLAN 第 22.48 节，不能用前轮代替本轮证据。

### NLE owner 存档投影与明确全字节核验（第 22.47 节增量）

TimelineDeliveryManifest v3／relink v2 保留实际片段、冻结版本、来源状态和缺口，绝不从 Media 当前版本自动补历史证明。NLE 会导出非活动轨，来源核对因此显式纳入静音／未独听轨，再复用实际 audio-track／sourceStatus 的公共 owner 投影；重复片段身份保留阻断。缺失或跨项目素材保留已知引用但不泄漏其他项目 title／存档／谱系。只有所有对应来源一致且 Media.archivedArtifact 返回精确项目／版本的单一有效白名单存档时才提供 artifactRef／MIME／扩展名／大小／SHA，公开结果不包含 Host mediaRef 或物理路径。

相对路径仍是目标占位，mediaStatus=unattached；checksum 明确为 owner-metadata-only，不写全字节已验证或已复制。可编辑“已核验”权利字段降为 user-reported-cleared，rightsStatus 仍 unknown；受限声明保守 restricted，没有凭空建立授权证据。manifest／七格式 HTTP 导出只读既有实际分集／Timeline，不调用 getOrCreate，保留 no-store／ETag；Delivery 的已有 peek/export 使用同一 builder，不创建缺失时间线。各 owner 公开读取保持独立事务，不声称跨域原子快照。

Renderer 通过现有 @dramaip/client.mediaPlayback.open 明确逐文件读取，不直接 fetch／Host／业务 IPC。严格校验原清单、实际 scope／version／artifactRef／MIME／字节数／SHA 和完整 Blob WebCrypto 摘要，前后重读实际 manifest 完整内容（不只相信其自称的 hash）。50 文件／合计 256 MiB／单文件 128 MiB，顺序读取且不持有所有文件；未核验项不回退 embedded／最新记录，不自动重试。AbortController／原 lease 与按项目／分集／Timeline／版本／来源指纹的组件作用域隔离迟到结果，停止清除部分结果。没有 URL／播放／上传／文件输出或持久核验／同意账本；结果是本次界面读取证明，不改变 owner 状态或事件。

FCPXML／EDL 视频限定、OTIO 未完整翻译 mute／solo／volume／fade／ducking、独立字幕、未复制媒体／未验证授权等缺口显式记录。正式混音／烧录、实际 NLE 导入、持久证据、媒体复制包、较大文件和完整 Media Gate 尚未完成。普通／实际后台验收终态按根 PLAN 22.47 记录，不外推真实模型质量或发行。

### Media单文件持久字节凭证（第22.173节增量）

Media自有前向`media.0010.complete-byte-verification-receipts`及`media_byte_verifications`，独立于Timeline／Delivery，不写peer表或旧Media记录。`byte-verifications.create/get/recover/list`四个声明式HTTP operation仍经Client→Runtime，公开严格原descriptor／UUID键／凭证和游标，没有文件路径、Host mediaRef或凭据。明确POST核冻结Playback If-Match，复用同owner已跟踪的完整流；MIME／长度／EOF／SHA及前后owner元数据都一致，才同事务保存不可变凭证与最小`media.complete-byte-verified.v1`事件。并发上限四、300秒限时、请求取消／native ctx.effect disposal释放流；原键同输入重放，不再次读取，原键换输入冲突。

GET及分页只核当前元数据，投影unchanged-metadata／changed-metadata／unavailable，不更新原行、不重读文件、不把旧完整读取变成当前文件通过。qualityState／rightsState始终unverified。NLE每个精确当前存档可明确保存／读取历史，严格原输入和请求键本机恢复；回复丢失可原键只读GET，重载不自动POST或换源。停止隔离迟到结果，分页失败清旧列表与游标。这不是NLE快照级整包凭证或复制交付，没有授权／费用／正式混音／字幕证明。自己的Runtime12／App定向21及最终后台1/1、官方生成／静态／构建门终态通过，正常完整命令已实际终态0（Runtime1042/57、33类型、Main66、App633、迁移Worker及全部conformance），948列举输入初末一致；A09.1仅单文件范围done，原M4工程已验状态不变，完整证据与剩余A09见根PLAN22.173／22.175。

### 原媒体包复制的Host底层（第22.176节增量，未完成整包交付）

`@dramaip/desktop-host`拥有严格NleCopyInput／历史Receipt／Job与独立HostWriteDirectoryGrant；Main只监督`host/nle-copy-supervisor.ts`，并以自有ManagedMediaReader流式读取原存档。`host/nle-copy.ts`独占创建私有子目录和七种固定NLE文档／UUID媒体相对路径，完整源／目的EOF、大小和SHA后重读全集，另存copied-media.json。每媒体2 GiB／合计8 GiB／1000源、文档16 MiB为静态限额；实际测试129 MiB和32源，不冒充满限额、媒体解码或NLE语义。

私有`/host/v1/files/nle-copy-directory`明确写授权；不复用read capability。`/host/v1/nle-media-copies` start／原ID+project GET／cancel仅接受冻结原输入与原grant，24 MiB请求／journal上限及no-store／通用RFC7807。单Host supervisor持有最多两任务，包括接受等待reservation；每任务拥有并清除30分钟timer，Main shutdown先abort并await复制、再释放共享Reader。原键同输入重放不读源／解grant，换输入409，失联和取消不自动换键／换源／重做。

私有journal保护POSIX权限／owner、inode／单link／O_NOFOLLOW及严格记录绑定，写入fsync／重读、状态更新atomic rename；本Host同任务读写lease避免正常rename被错当损坏，没有跨Host锁或断电保证。只有completed回执成功持久化才返回成功；晚取消或日志失败保留retained-unpublished。重启未完成仅投影interrupted、不写原行或继续，完成历史GET不重读源／目的、不开过期grant、不公开路径／文档／mediaRef。quality／rights固定unverified，billing未知；复制证明只属于记录时间。

第22.176节当时的两份正式`.integration.ts`由run-node/tsx的`test:nle-copy`接正常链，而非Bun；41实际文件／恢复例含loopback Host HTTP和真正隔离Node退出，类型／lint／格式／架构／生成／构建和原媒体后台1/1通过。当时仅Host底层；当前新增范围如下，不借该历史成功认证本版全Runtime。

### 原媒体包的Timeline业务链与SDK（第22.177–22.183节，A09.2有限组done）

Timeline前向`.0007`独占`timeline_media_copies`／`timeline_media_copy_actions`及七个公开HTTP操作。通过公共Media／Audio owner核原存档和原清单，剔除可编辑clip.mediaRef后生成七种固定NLE文档；仅支持现有导出器的1080×1920／25fps／48k立体声P0，不扩成任意Profile或NLE语义认证。独立目的写grant绑定该清单范围，原请求UUID／完整输入SHA在调用Host前持久化；回复未知保留原身份，不自动换键重抄。

公共owner读取均同步完成后再进入本域写事务，期间无await；事务内只读本域Timeline行做原版本／原内容CAS，保存Core回执及最小Domain Event。观察结果与动作回执同事务，失败全回滚，不嵌套开启owner事务或读写peer表。复制前后范围变更为source-changed，不发布artifact；仍queued／running时明确取消原Host任务。GET／分页只观察owner元数据，不访问Host／字节、不改历史行。原键重放在核当前来源前返回原事实，不能变成最新版本或当前文件证明。

Host完成journal保存原artifactRef、私有目录与root／目录inode；仅明确reveal按原ID／项目／artifactRef核文件系统，替换／symlink／缺失拒绝。重启不重开旧grant或重抄；旧无artifactRef凭证保持历史可读，不臆造可展示能力。Main的reveal仍受后台native guards保护，后台测试只在自己的隔离实例使用受控桩，不打开Finder。Core以ctx.effect跟踪最多四项观察，停用abort并等待；Host Client观察限时30秒、选目录300秒，HTTP中断不自动取消底层复制或伪造失败事实。

`StudioClient.timelineMediaCopies`只用正式Core API；严格身份／范围／原请求SHA、完整receipt字节SHA、原媒体版本／存档／路径／大小／hash、七文档集合、分页游标和迟到取消隔离。明确create／refresh／cancel各带原请求键与If-Match；选目录／展示不附幂等键；构造、GET恢复和历史不自动POST或Host核文件。46原生、9实际Core、10 SDK及普通后台三旅程分别通过；最终完整normal2原33476实际exit0，Runtime1051/57、App663、Main66、33类型／真实Worker／全部conformance及961输入末核按PLAN22.183验收A09.2有限组。正式混音／字幕和Media Gate仍继续；质量／权利unverified、费用unknown，原M4 7/7和34/40不变，原失败保留。

### 普通NLE复制界面的原请求协调（第22.178节增量）

现有NLE交付卡内的`NleMediaCopyPanel`只通过`StudioClient.timelineMediaCopies`访问正式Core，不引入Renderer fetch、Host／Runtime实现或业务IPC。`NleCopyController`构造无存储／网络副作用，mount仅严格恢复本机原身份；没有定时器、自动POST／刷新、最新来源补偿或文件夹启动。明确本地交接声明、原清单写目录和提交分开；原请求UUID＋完整输入须先setItem并精确读回，失败零create。刷新／取消同样先保存原动作身份；响应未知保留，不自动换键重发。

父面板按project／episode／timeline／version／fingerprint keyed，所有异步操作独立AbortController lease；停止仅中止界面等待，卸载和迟到结果不能发布新范围。持久key按项目／时间线而非最新指纹组织，允许换版本后只读恢复原完整输入。每次恢复／重读／动作核原ID、完整scope、原hash及非倒退版本；正在绑定原请求A时，历史任务B不能以刷新／取消覆盖A的动作记录。不同原身份的矛盾缓存保守标坏，不自动删除或发送。

历史分页显式读取，失败清旧列表／cursor；只有对应原请求终态才允许明确准备新复制，并清本机而非Core历史，勾选／目录重新确认。损坏本机记录必须先显式读历史再明确清除；清除与正常动作都精确读回确认，正常清除先核原本机记录未被别页改写。已完成展示走原artifactRef，失败无路径回退；回执区分记录时间字节证明、当前元数据变化／不可核对与未知质量／授权／费用。22.179空字符串精确null拒绝门及20协调测试，末版后台3/3与独立完整normal2已按22.183分别留证，不借旧轮或将前后版本合为一次成功。

### A07原运行脱敏owner读取（第22.184节，in-progress）

原运行脱敏读取现通过Automation公共`CREATION_WORKFLOW_SERVICE.execution(id, projectId)`复用；原HTTP执行回执委托同一实现，协议／ETag不变。只读明确原工作流的四阶段持久run元数据，缺run为missing，错误项目／缺工作流无结果、坏owner响应拒绝；不读取peer表、launch／syncReview或切最新。消费者须在自己UoW之外完成该同步owner读取；服务及其生命周期仍由原ctx.effect提供。该A07前置的两定向／33类型与工程检查见PLAN22.184，完整本地指标关联与可信来源链仍未完成，不升级旧human／rule／modelEvidence unknown或借A09.2的完整normal认证新源码。

### A07原请求／成果／运行的只读关联（第22.185节，父A07仍in-progress）

Agents的公共task-runner增加可选usage读能力，委托原不可变观测。Insights从自己的creative／planning funnel、outcomes及planning adoptions投影读取原请求和分页事实，再在本域UoW之外分别调用Automation execution和Agents usage，禁止peer SQL、嵌套事务或HTTP回环。两个Insights GET位于`/api/v2/projects/{projectId}/creative-outcomes/executions`和`/{workflowId}`；自己的JSON与scope／event／cursor列一致，游标绑定原项目或原workflow，原receipt绑定请求操作／retry父身份，各已记录run保留单独usage状态和原session／engine校验。没有新表／迁移／事件；tracked route effects、ETag／304／no-store及RFC7807失败保留。

严格关联契约不重写历史human／rule，模型来源unknown／质量unverified／结算unknown。仅显示持久requested model及原起止时间，不认证实际远端模型版本；真实零、未报告、无效、累计口径及各币种原估值分列，没有跨阶段／retry／session累计相加。缺run不猜阶段，missing／unavailable／read-failed不变空成功；usage失败可保留安全的原运行，异常正文／路径／凭据不输出。

普通Insights入口仅通过StudioClient明确GET；未启用不展示暖缓存，detail mount强制原读取且等待／失败不显示旧结果，project／workflow key和AbortSignal隔离迟到回复。逐阶段全部观测仍走原SDK分页，附原session／engine保护。当前Runtime定向10、独立路由6、完整App667、33类型／构建／工程门与后台原1旅程分别通过；后台四阶段是明确受控metadata，真实Core空台账另核。完整本源码normal未运行，详见PLAN22.185；可信来源、完整模型分组及其余MET-01仍待。

### A07原尝试配置统计（第22.186节，父A07仍in-progress）

公共纯函数`measureCreativeExecution`先严格核验原Insights关联回执，再按原engineKind及requested modelId／providerId／profileId结构元组归组。只统计一个明确workflow尝试，不读数据库、当前配置或其他尝试；未记录／无效模型分别保留，分隔符不会碰撞。每组携带可核原run／phase／status／timing，列已知耗时观察数及min／max，未结束／未记录／无效另列；全未知的范围为null，不补零、不合计为workflow耗时。missing run只保留身份，不推测阶段；修订阶段身份单列，不冒充采用前局部修订量。没有原receipt的三种状态没有统计分母，来源仍unknown。

Renderer只在既有原工作流GET结果上派生这组描述统计，没有新增路由、响应字段、表、迁移、service或外发。统计输入仍是严格单页原回执，跨页历史通过独立展示参数拼接；超过100条已验证历史不会被误当单页输入。当前定向Runtime10、完整App673／119、33类型与后台原1旅程分别通过；不认证全项目模型比较、实际模型版本、超参数指纹、质量／结算或新的完整normal。原请求、原run及SQLite恢复／实际retry不改写，详见PLAN22.186。

### A07实际候选正文修订台账（第22.211节，父A07仍in-progress）

Automation前向迁移`automation.0011.preview-revision-journal`新增自己拥有的候选头与顺序编辑表，不修改历史迁移。单章候选真实创建记录初始正文SHA256，实际PUT正文变化追加前后SHA与顺序，显式rebase冻结原预览身份与正文SHA；候选、台账和既有Domain Event同事务。相同内容重复保存不增加编辑次数，回改原文仍是一次实际变化；仅版本变化的合并另计、不当作正文修订。同键rebase重放保持旧响应，不重复记账。旧候选首次变化只记录当时观察，coverage为partial；无台账为untracked，总数null，不回填初稿或零。

公共GET `/api/v2/change-previews/{id}/revision-effort`要求原projectId与contentHash，在一个Automation快照中沿原rebase链读取自己的表，核原项目／章／task、顺序连续性、当前正文SHA与原合并来源。损坏、缺失来源、循环或超限使本次读取失败，不挑另一条链。返回无正文的`chapter-preview-revision-effort-v1`、独立修改／合并／正文变化合并数、完整链才有的localRevisionCount及原状态；ETag绑定完整响应，no-store。SDK再核原候选／项目／章／task／状态及正文SHA，Renderer只通过StudioClient明确读取，失败、取消或换范围不沿用旧成功。

普通单章创作工作流与写作对话候选入口已接通。这个入口只测单章原候选链保存的实际变化，不等于人工编辑工作量、模型修订阶段或其他生成尝试；章节跨尝试统计另见下节，改编／规划仍待。定向Core5、完整App710/125、33类型、构建、官方生成／架构／迁移门及后台UI原1用例通过；UI回执是明确受控响应，真实owner写入／采用／SQLite恢复由Core测试验证，不称真实模型或M5验收。

### A07首次章节采用前实际修订（第22.212节，父A07仍in-progress）

Automation新增不可变前向迁移`automation.0012.preview-revision-event-baselines`和自有发布覆盖表。真实章节候选初稿、变化保存与显式rebase，在候选／修订台账同一事务追加`automation.chapter-candidate-revision-recorded.v1`。事件严格绑定发生时的原工作流／请求／目标、章节、原预览链和规范化正文SHA256，不包含正文或模型调用。只有实际变化保存及改变正文的合并增加局部正文修订次数；相同保存和原键重放不多计。既有台账没有事件覆盖标记、旧工作流关联缺失或非本章有效原来源，不能补为完整零历史。

Insights新增前向迁移`insights.0010.novel-revision-observations`，通过现有受监督Domain Event消费者记录自己的投影表，不读peer SQL。公共GET `/api/v2/projects/{projectId}/creative-outcomes/revision-effort`在原检查点读取自己的原请求、实际修订与正式成果事件，严格核项目、身份、唯一游标、顺序、正文指纹和采用版本。按小说章节目标保留放弃／失败／重试候选的已保存修改，截断于该章节首次已记录正式采用之前；采用后新编辑不混入。早于可关联新工作流的旧正式采用也必须保留为首次，关联或历史不足则unknown／总数null，不能跳到后来成功来美化统计。无采用为pending／总数null；完整证据才显示实际零或正数。

SDK明确只读全部检查点绑定分页，拒绝变项目／检查点、重复、缺页或损坏记录；服务超限或损坏503，游标检查点变化409，不返回部分分母。普通Insights提供“读取首次章节采用前修订”，失败／取消／项目切换不显示旧结果，不自动启动模型或采用。此统计排除模型修订阶段、未保存操作和人工工作量，不认证文学质量；章节请求字段分组见下节，改编／规划与完整可信模型配置仍待。22.212末版定向Core8（另543未选）、完整App716/126、33类型、构建／chunks、官方生成／架构／迁移检查及后台原1旅程通过；后台修订数是明确受控UI回执，真实事务／首次采用／SQLite恢复另由Core验证，不称全仓normal或真实M5。

### A07跨工作流原生成配置漏斗（第22.187节，父A07仍in-progress）

当前章节增量（第22.213节）：`measureNovelRevisionConfigurations`严格关联完整章节修订结果、原生成配置漏斗和完整原请求页。同项目／投影状态／检查点、唯一降序事件、原targetKey、全部尝试顺序、最初锚点及每组章节目标／请求数均须匹配。按每目标最初生成请求的engine／model／provider／profile字段归组，换模型重试仍留原组，不归因全部尝试均使用该模型。完整已采用目标才参加修订min／max及BigInt精确分数均值；真实零可计，已采用历史未知与未采用分开，不补零。结果契约重新核身份与算术，不含正文、实际模型版本、完整超参数、账单或质量认证。

SDK编排原只读GET，读取全部原修订／请求页及工作流回执，再核完整目标关联和末尾完整修订历史；失败、取消或原检查点／历史变化拒绝整次结果。普通Insights增加“读取按原配置分组的章节修订”，重读清旧值、取消／换项目不恢复迟到结果。没有新路由、service、迁移或外发。真实Core原A配置与B重试／SQLite恢复、末版7定向／完整App722/127／33类型、构建／chunks、工程门及后台原1旅程通过，不称全仓normal或真实M5。

范围校正：上节22.212关于模型配置归组的待项已按上述请求字段限定范围接通；可信实际模型／完整超参数和改编／规划统计继续。小说当前合并走候选preview rebase，已计入；工作流级merge／record-merge属于剧本／分镜范围，不作为小说当前未接入口扩建。旧未知或无效关联仍不补为完整零历史。

原creative和独立planning计量函数的纯计算部分移入contracts公共`creative-funnel-measurement`，原Insights SQL读取及投影拥有者不变，并委托同一原算法；首目标／首候选／精确或修改后采用、原批次、待决定、重试及耗时口径不改。新纯关联函数严格核验全部原SDK请求／workflow事实页，完整降序页链、相同project／检查点／原request／各页receipt，拒绝重复事件／cursor、改变的target／requestedAt／planning root和不完整读取。按每目标最初请求生成阶段的engine／requested model／provider／profile字段归组，同目标全部重试仍留首组，不重置首候选分母；最初请求未记录、原owner读取的三类失败及缺生成阶段分别成未知组。各组用同一原漏斗算法计算，原工作流／锚点与请求／目标计数须一致，不猜旧来源或实际模型身份。

`StudioClient.creativeOutcomes.configurationFunnel`只编排既有Core GET：顺序读取请求页及所有workflow事实页，传同一AbortSignal，检查点变化即拒绝，末尾原头复核；不POST、不盲重试或返回部分分母。普通Insights入口必须明确启用，等待／错误隐藏旧统计，可停止或项目keyed卸载取消；未启用无读取及暖缓存展示。没有新路由、响应协议、service、表／迁移或跨产品依赖。投影健康和相同检查点不认证跨owner事务快照，生成阶段配置字段不等于完整超参数／实际远端模型，原human／rule与modelEvidence unknown保持。

自己的末版Runtime定向10、原漏斗／planning／路由整文件50、完整App679／120、33类型／构建／工程检查和后台原1旅程分别通过；实际取消后迟到结果不恢复分母，受控全项目统计卡片完整目视核对。原完整`bun run test`97000／75156／75185已真实close：exit0／signal=null，Runtime1059/57、App679/120、Main66/14、33类型／真实Migration Worker／全部conformance通过；1046列举输入首末SHA f6f11e1c…精确一致，2390.340秒。这是22.190正式音频改动前完成的基线，不认证后续新代码。完整可信模型分组及MET-01其余指标仍继续，详见PLAN22.187。

### 同正式版本的采用与保存关联（第22.215节，A07限定观测）

公共纯函数`measureCreativeDeliveryCoverage`消费原成果分页、健康投影检查点和全部九类去重总数，严格核原项目、全链降序游标、唯一事件、终页与单位／正式集合双向一致。小说按chapter版本关联manuscript保存，改编按episode-script版本关联pilot-package保存；采用之后的原事件顺序才可关联，不推断墙钟耗时。首次已记录采用锚定，每个采用版本仅进入一次分母／成功分子；重复格式／保存去重，缺后续保存保留，旧版不能替换新版，无此前采用的保存版本另列。严格结果契约重核单位、顺序、身份与精确分数；modelEvidence unknown、qualityState unverified，不认证当前来源、权利、质量或投稿发行。

SDK`creativeOutcomes.deliveryCoverage`仅编排既有GET：读前summary、全部原成果页、末尾原首页和summary，比较原检查点及所有累计去重总数；同一AbortSignal，超10万事件／1万页、失败、取消或变更拒绝，不自动重试或返回部分分母。普通Insights明确按钮、停止／项目卸载清旧值；没有新路由、迁移、service、业务写入或跨产品依赖。末版Core三条真实owner保存／去重／SQLite恢复、完整App730/128、33类型、构建／chunks、官方生成检查及后台原1旅程通过；后台数字为受控回执，不是实际模型／真人质量或完整normal。真实M5条件与A07其他原范围继续。

第22.216节补同一原版本的时间观察。纯measureCreativeDeliveryWindow消费原严格coverage与Core首次summary的asOf，固定七天UTC含边界，新增采用与首次匹配Host保存分开计数、不构造跨期转化率；原采用到首次Host回执耗时按实际时钟校验，owner提交不得早于Host。未来／倒退／回执先于采用或晚于owner／非零亚毫秒证据保持未知，真实0与待保存分开。可核历史采用版本参与精确BigInt均值，重复导出不刷新首次时间，旧坏钟不择后一次补好。

SDK将原完整GET编排抽成私有共享读取：coverage原格式与调用不变，deliveryWindow使用同一读取前asOf，不额外取当前钟或重跑分页。末尾原检查点、首页与累计去重总数门不减，取消／错误不返回旧读数。普通同一卡片增加明确时间读取，清两种缓存／停止与项目租约沿用；没有新路由、迁移、owner服务、业务写入、模型、费用或外部连接。输出契约从完整原coverage与asOf重算窗口／每项身份／状态和全部算术，不接受伪质量通过。此历史计量不是全任务耗时、实际模型速度、当前有效性、文学质量或完整M5，限定验收见PLAN22.216。

### 正式声音／字幕链路的历史缺口（第22.188–22.189节，后续实现见22.190）

可播放的Timeline预览不等于正式成片。当前render-sources只把精确video归档描述符传给Host；HostTimelineRenderInput和HTTP形状门仅接受五个字段的video clips。render-supervisor只私有复制／探测视频，并固定生成anullsrc stereo48k→AAC；loadVerifiedFfprobe仍要求video流。现有音轨绑定／整timeline snapshot及通用opaque reader不会自动让声音进入正式输出。字幕仍独立SRT，当前预检准确提示静音音轨与不自动烧录，没有正式混音／字幕完成声明。

独立ignored build实验实际用本机FFmpeg7.1.1合成／裁切／混合48k stereo float PCM，对照当前timelinePreviewFrame全部采样：7正向包含offset／delay／间隙、mute／solo、voice重叠只duck一次、零音量voice仍duck、长于clip的双fade相乘、增益1.8；2反例证明volume eval=frame和默认amix归一化在该样本改变原语义。九例共2592000值对照、原进程终态0，报告及误差见根PLAN22.188。此处只证明独立算法方向，不是Core owner／Host契约／音频流探测／签名sidecar、压缩或混合采样率输入、AAC延迟／峰值策略、视频内嵌声音、字幕或Media Gate验收。正式实现仍须沿公共owner精确版本／来源冻结、Host私有全字节复制、实际流能力和明确字幕策略完成有限业务组，不以静音回退或隐式归一化掩盖缺轨。A09仍in-progress；M4原七项已验状态不变。

22.189进一步在ignored隔离目录实现候选render-audio／audio-pcm，末版strict类型、15单元和17实际媒体样本整链原进程真实0，四候选输入首末相等；正式1046输入仍未改。候选支持精确采样／局部voice并集、mono unity、MP4内嵌AAC及展示时钟延迟，并流式核源／结果的有限值、样本数／SHA／取消；源未核样本不得靠apad补成成功，最终过unity明确拒绝，不截原增益。17样本包括13数学一致（1过峰值实际拒绝）和4必须不同的反例，5个源实际探流／解码，另坏WAV实际解码拒绝；完整条件、失败辅助regex和证据见根PLAN22.189。这些候选尚未接到正式Core／Host／签名能力／资源监督／成片或字幕链路，不改变本段现有静音AAC事实或宣称A09完成。

### 版本化实际音频混音链路（第22.190节，已接通并定向验证，父A09仍in-progress）

Core Timeline调用公共Media／Audio owner冻结实际可听视频内嵌声源与dialogue／narration／bgm／sfx的精确项目／record version／归档四字段，重新核来源状态和原采用绑定；不读peer表，不取clip.mediaRef／payload或最新文件。mute／solo排除与原控制值、归档证据一起进入完整timeline＋visual＋audio snapshot和SHA，zero-volume voice不删除。新P0 profile是`1080x1920-25-48000-stereo-audio-mix-v1`，Host严格六字段请求含5字段audioPlan和13字段audio clip；旧五字段缺audioPlan只保持历史静音语义，显式null／错误版本／未知键／字符串数字／路径／冲突身份拒绝。旧Core静音任务重试返回RENDER_POLICY_VERSION_CONFLICT，必须独立新预检／新任务，不能以原键改策略。

签名与可执行SHA核验后，FFmpeg实际执行单视频帧1920个每声道采样的mono unity／双fade／zero-volume voice duck混音与AAC／x264编码，只有通过才公开独立`renderer.ffmpeg-audio-mix-v1` capability；旧renderer能力不能让新任务降级。ffprobe按实际流inventory解释唯一音频流、mono／stereo、采样率、codec／stream index及有理展示时钟，不用format总时长填音频时长；实际video无音频明确为已知无内嵌声，独立音频无流／多流／未知时钟拒绝。

Host复用完整opaque reader私有复制全部参与源（视频／音频共享同一ref须完全相同描述符），按MIME扩展名写独占副本，核源完整SHA／大小／EOF。固定输入demuxer及file protocol，MP4禁外部tracks；伪装WAV的playlist不能自动探成HLS／读取嵌套HTTP。源先实际完整解码为48k stereo有限PCM并核所需区间、样本预算和SHA，再采样级裁切／fade／半开voice并集duck一次、原增益、delay及明确normalize=0；不能让apad掩盖短源。过滤器文件独占写入，1MiB图／10000片段／64KiB argv预算拒绝整请求，不截断。最终私有混音精确样本／SHA／峰值核验后才输入视频编码；peak>1返回AUDIO_MIX_PEAK_EXCEEDED，不夹音量或归一化。最终AAC stereo48k／实际展示时长（最多1024采样编码容差）与完整解码区间、视频精确帧／尺寸核验后才发布原Media回执。

所有decode／mix child沿同一job受监督，取消／超时先TERM再2秒KILL、await close回收、失败不发布；保留原两任务容量、30分钟超时、完整输入hash重放、Core持久恢复与旧来源保护。独占mix文件核完整SHA后只读，临时目录只清本任务mkdtemp。普通面板标本地实验混音和原输出策略，明确同意，不默认勾选／加载／播放，不将历史任务改标成混音证明。

自己的末版定向验证13命令全exit0、1060列举输入首末精确相等：33类型、Main91/16、App679/120、Host＋owner19、Core render12（504未选）、实际签名媒体5及纯模块真实媒体17／5源，lint／全format／架构／迁移／导出与chunk通过；当前构建284 ESM／79依赖，SDK OpenAPI SHA未变，另conformance各原套件通过。后台单原身份首轮35.5秒因旧成功文案被误当新任务终态而失败；修为绑定本次POST原jobId后第二轮38.3秒通过，原失败保存、不合并。普通UI实际Core→Host编码核两段0.4／1.2保存音量的输出RMS比例、非零声、静音间隙、未知请求恢复／重启／取消／篡改／重试／冻结播放器；只认证该限定本地旅程与1351×684面板视口。

本组未再启动完整normal，也不借前述A07旧基线认证混音新版本；A09字幕策略／烧录、完整Media Gate、完整压缩格式库存／大文件压力与其余故障出口仍待，A07可信模型／指标、A10、M5继续。新渲染是有损AAC输出，不证明与所有浏览器解码器逐采样一致、语义／视听质量、合法权利／账单或发行。真实命令、SHA与测试夹具类型错误见根PLAN22.190。

### 全源与最终成片的实际逐帧解码门（第22.191节，父A09仍in-progress）

22.190的AAC已有完整解码，但视频尺寸／时长／平均fps的探测不等于全部画面可解码或每帧时钟正确。本组新增Main内部`video-proof.ts`／`render-video-execution.ts`，只接受已核签名sidecar的实际流inventory、唯一非attached-picture视频、明确stream index／codec／像素格式／有理timebase／start_pts／duration_ts与容器起点；不用format总时长或第一条流补证据。新混音任务每个唯一私有视频源完整解码一次，核原声明展示区间和所有源裁切范围；旧明确缺audioPlan的静音Host兼容路径仍保持原探测语义，不升级其历史证明。

FFmpeg使用固定MOV／file输入、`-xerror -copyts -enc_time_base demux -fps_mode passthrough`，原始解码像素以rawvideo SHA256 framehash流式输出。解析器逐帧核原timebase、尺寸、完整SHA、字节数、连续PTS／正duration与完整首末区间；不施加fps／setpts／pad或用压缩包copy当解码。最终输出另要求实际唯一H.264 yuv420p视频＋AAC48k stereo、1:1 SAR与零起点，每帧严格n/25、时长1/25和width×height×3/2字节、精确总帧数；完整视频及既有AAC解码都通过后才发布编码文件SHA与原Media回执。帧序列摘要只是本次内部解码序列的摘要，不是MP4编码SHA或持久公开证书。语义参照[FFmpeg framehash](https://ffmpeg.org/ffmpeg-formats.html#framehash)及[原时钟／编码时基选项](https://ffmpeg.org/ffmpeg.html#Advanced-options)，实际执行才作为验收证据。

签名FFmpeg还须实际生成／解码三帧x264 MP4并通过原12800时基核验，配合签名ffprobe的probeVideo才启用现有混音capability；任一缺失不回退静音。所有video decoder沿原job监督、TERM→2秒KILL、await close；解码／证明失败返回VIDEO_FRAME_PROOF_INVALID，取消／迟到不得发布。源最多24小时、宽高各8192且16777216像素，解析最多100万帧及有限ASCII行／总字节预算；预算拒绝不截取证明，也不宣称满规模压力通过。本轮没有新增跨owner访问、公开字段／路由、表／迁移、Provider、自动字幕、权利或收费状态。

自己的当前工程／实际签名媒体与后台旅程终态和失败历史见根PLAN22.191；不是完整normal，父A09仍有字幕策略／烧录、完整Media Gate／库存／规模／异步故障及整组全量验收。历史成功文件不重新解码或升级为当前文件、质量／权利／费用证明。

### 签名字体与字面字幕的内部准备层（第22.192节，未接产品链路）

Main内部`renderer-fonts.ts`仅从显式配置根读取Ed25519签名font pack，按原ID／packVersion／完整SHA／size冻结固定UUID成员；不搜索系统字体、下载、猜版本或替换缺字字体。有限EOF／stat、目录／成员链接与身份守卫、严格清单／字节预算和独立私有字节快照拒绝歧义／篡改。`font-cmap.ts`对单面OpenType Unicode cmap4／12与maxp有界核验，逐标量检查原文字形；不把缺字补为方框，license／sourceUrl不是合法发行授权。

`render-subtitles.ts`内部准备接原font身份、唯一cue ID／整数半开帧范围。原Unicode正文只写独占只读textfile，drawtext固定`expansion=none`，graph只含常量成员名／安全数字，cwd为调用者私有目录。固定P0字号／边距，实际一帧灰度栅格与tw／th度量共同检查底部888×480安全区；超区、不可见、重叠、缺字／控制、无证明或超过明确预算即拒绝，不裁字、自动折行、缩字或换字体。实际度量子进程限时、可取消且await close；整个私有目录和后续编码仍由未来主监督负责。

自己的末版8定向命令、18新增单元／完整Main119、实际字幕7及原音视频9回归见PLAN22.192，首轮失败保留。这里没有正式Main启动／RenderSupervisor接入、Host公开契约／capability、Core来源／策略、SDK或普通UI变更，也没有新的构建／全Runtime／App／后台UI／normal证据。普通实验渲染仍不烧录字幕，历史成功不升级；正式明确策略、整条链路、发行字体签名／授权、复杂文字排版与完整Media Gate继续，不可据内部模块声称字幕上线。

### Main／Host正式字幕策略与主监督（第22.193节，Core／SDK／普通UI尚待）

第22.208节补实际Host组合验收，不新增产品能力或字体发行材料：同一25帧输入含源偏移的两路视频、5帧黑隙、共享WAV三类音轨及两段字面中文字幕。实际RGB逐帧核源偏移／镜头／间隙，字幕白色像素只在[6,10)／[16,19)，AAC双声道窗口均值核已保存gain及BGM压低；完整输出SHA／字节／帧数与原键重放保持，换字幕不能复用旧键。原来源证明await期间取消后再放行并dispose，原任务保持canceled、无迟到输出或工作目录。原7项加2项共9项实测通过，33工作区类型通过；本机工具与Arial Unicode仅作隔离测试，无普通应用／播放／系统字体搜索。这个有限组合不是全格式／大文件／异步矩阵、完整Media Gate、发行字体许可或三设备验收；原A09范围与M5真实条件继续。

Host新增严格版本化subtitlePlan：明确omit，或burn-in＋原font ID／packVersion／SHA＋唯一cue ID／原Unicode文字／整数半开帧区间；仅在明确audioPlan的新音视频门下接受字幕策略。拒绝数字字符串、路径／额外字段、重叠、控制／缺证明与明确资源越界；absence保留历史不烧录语义，不补造旧任务证明。同jobId的完整输入hash包括策略／字体／正文，不能借原键改烧录或省略。

Main只从userData/renderer-fonts/active加载签名fonts-manifest.json及fonts/UUID.ttf，独立信任键为DRAMAIP_RENDERER_FONT_PUBLIC_KEY_PEM。缺键／包或坏包不搜索系统字体，不阻断原独立写作或音视频；实际字幕capability必须先监督执行坏字体负控并确认原生拒绝，再逐个实际绘制全部原字体，全部通过才公布opaque字体描述符，缺字／声明许可不转授权。实际字体能力过程也受30秒总限时、取消／TERM→2秒KILL／await close和dispose监督；初始化结束若正在退出，不再启动后续Host／Runtime。

本机实际反例证明fontfile不保证无替代：[FFmpeg drawtext实现](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1.1/libavfilter/vf_drawtext.c)在FreeType拒绝后可尝试Fontconfig。本组每个度量／编码子进程使用私有空配置、无目录／include且rejectfont *，覆盖FONTCONFIG_FILE／PATH并清除继承SYSROOT；参照[Fontconfig原配置说明](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html)。实际坏字体负控与verbose替代日志检查不能省略或只以exit0认证。私有原字体／原textfile／配置在编码前再核完整EOF／SHA，变字、换字体或改配置拒绝；图只含固定相对成员名及已验证数字，不含正文／外部路径。烧录在视频concat后按帧区间执行，不改变已冻结音量控制；实际全部源视频、源音频与最终H.264／AAC全解码发布门保持。取消、坏字／越界、坏字体／篡改不发布或迟到恢复，整个随机任务目录沿原job finally清理；不宣称防御同一用户的特权篡改。

末版15有限命令、构建对应输入首末、Main121／App679、Host12、Core render12定向、实际Host字幕7／字面字幕7／旧音视频9和原后台旅程1的独立终态及失败见PLAN22.193。这里未新增Core公开策略、来源装配／谱系／预检、SDK／恢复输入或普通字幕UI；普通实验任务仍不烧录，历史不升级。复杂文字／视听质量、发行字体签名／权利、完整Media Gate／格式规模与末版normal继续，父A09仍in-progress。

### Core字幕来源／明确策略、公开SDK与原请求恢复（第22.194节历史节点；普通UI见22.195）

Timeline拥有原字幕文字与帧区间，Audio公共owner拥有采用绑定；新增render-subtitle-sources只读原项目／分集、dialogue或narration、adopted／current且非stale、原version／fingerprint／sourceClipId／shotId，不能从peer表或可编辑路径补证明。明确独立的已保存Timeline文字只证明原文字节，没有上游Audio认证。原文字不trim／归一化，Host原整数半开区间、Unicode／条数／字节／重叠预算照用；burn-in无参与字幕不能变成omit成功。字幕不受音频solo排除，但muted排除；明确omit不读取排除字幕的上游状态。新策略单独校验字幕，避免旧播放计划对不参与输出的字幕制造阻断。

新profile为1080x1920-25-48000-stereo-subtitles-v1；subtitlePolicy v1严格区分omit与burn-in＋原font ID／packVersion／SHA。预检query使用subtitleMode及完整fontId／fontPackVersion／fontSha256，未知、重复或部分身份拒绝。公开字体catalog只来自同音视频工具版本的已验证Host capability，严格字段、唯一ID和原大小预算，异常catalog不阻断明确omit的原音视频；不是路径／字体字节或发行授权。Core在Host health前后重核完整来源，全文／原字体／排除状态／公共owner证据入原source snapshot与SHA；旧absence保留原snapshot形状、指纹和不烧录语义，不推成新明确omit。

沿原timeline_render_jobs的source_snapshot_json事务保存，不新增表／迁移或跨owner写入。公开Job只有原快照SHA、Timeline身份、版本化policy及有效Host计划均可核时才返回原选择；不公开全文或从profile标签猜策略。重试必须原Timeline、完整源证明、原策略／字体、渲染器／sidecar版本全部一致，实际来源复核后才分配新任务；原键不能改策略，坏历史证明不补齐。SDK严格核query／body／回执和ready时原字体能力，拒绝缺policy的新版本任务；只读恢复按原请求SHA和全部原输入匹配，不重发或择最新。本地持久化只含opaque字体选择，不保存全文、许可、物理路径或同意勾选。

本版新增来源6、实际公共Core／SQLite5（同原render12共17）和SDK／恢复3身份，完整Main／App及实际字体／音视频、原后台混音旅程的末版有限终态见PLAN22.194。Core公共测试使用受控Host，不把它和另行实际Native测试拼成同一条字幕E2E。普通TimelineRenderPanel尚无字幕选择，原后台旅程也未烧录字幕；下一接普通明确选择／原键恢复／同策略重试与真正字幕像素旅程。复杂语言／观感质量、发行字体授权／签名、完整Media Gate／格式规模和最终整组normal继续，父A09仍in-progress。

### 普通字幕策略与原字体选择（第22.195节，定向通过，父A09仍in-progress）

TimelineRenderPanel通过StudioClient读取原预检／字体metadata，不直接访问Host、Runtime实现、文件或网络。字幕mode初始undefined，不等于omit；burn-in必须另选完整原font tuple，不选第一项／同ID最新版本。未选择或缺font时只允许明确只读核能力，不能将legacy ready当新任务同意。换mode或font清preflight／confirmed；纯explicitRenderReady核新profile、完整原证明、完全相等policy及burn-in原font capability，omit不要求字体能力。目录声明仅显示原license／sourceUrl文字，不打开外部应用或证明权利。

原任务和pending request显示只读policy／完整原font SHA，absence标历史未记录，不从profile或当前目录升级。exactRenderRetryReady核失败／取消／中断状态、原Timeline／version／source／profile／policy／font／renderer／sidecar版本；新选择不能改原任务输入。原键恢复继续findRenderReceipt全身份核验，只存opaque输入，不存字幕正文、许可、路径或勾选。mount／history不自动选择策略、font、POST、加载或播放，项目keyed卸载取消旧读；known job原状态轮询保留。

末版新构建后18有限命令全部exit0，33类型（全缓存）、完整Main121/20／App687/121、Host12、来源6、Core render17（504未选）及实际字幕7／Host字幕7／音视频9通过。同一6313列举源码／构建输入首末一致，后台原混音与新增普通字幕两个精确身份2/2，零retry／skip／flaky／unexpected／global errors且不更新快照；全程hidden／unfocused。新增旅程通过真实公共Core／Audio采用／装配、Native Host和Media归档，对完整输出逐帧核指定字幕区域仅在frame2–6有字，明确omit全12帧无字；真实原请求回复丢失／reload只读恢复、同策略失败重试、换omit禁重试、等长坏字体重启拒绝与旧policy保留均验。面板截图只认证原字体／策略、未自动同意和冻结播放器界面，不以隐窗截图替代字幕像素／观感证明。

首次素材payload缺mediaRef、请求路由未结束就reload，以及option已disabled而原matcher误判的三轮夹具／断言失败保留；生产门没有降低。原E2E4结果文件passed但中断后终端句柄丢失，不当末版独立exit0证据；末版strict runner另收真实close。详细时间／SHA见PLAN22.195。本组不是全Runtime或完整normal，不借A07旧基线。发行字体包／签名授权、复杂语言排版／视听质量、完整Media Gate／格式规模／异步矩阵及最终整组normal继续；原M4与85%不重计。

### 精确Media owner交付证据的只读基础（第22.196节，不是完整Media Gate）

Media的delivery-evidence模块提供公开owner方法和GET `/api/v2/media-records/{id}/delivery-evidence`（operation `media.deliveryEvidence`）。严格指定项目／素材／非负整数版本；重复／未知query拒绝400，错归属404，版本变化412，缺失／损坏实际证据503，不替代最新。只通过Media自身表和公共owner服务读取实际记录、sourceStatus、同项目／版本单一archivedArtifact与已有media_byte_verifications最近一行。校验原凭证ID／时间／scope／descriptor和request_hash，坏历史不跳过或伪造空成功；不访问Host／文件／模型，不写记录、事件、费用或权利。沿既有表，无新迁移；路由仍由原tracked effect统一注册／清理。

公开schema是exact-media-record-metadata，releaseReady固定false；质量、合法授权、结算和当前文件状态不提升。历史完整读取只投影原ID／时间／descriptor，不公开原动作key；matching-archive-metadata、changed-archive-metadata、not-rechecked只比较元数据，不认证当前字节。严格核原素材／项目／版本、归档状态、managed／embedded原身份、全部已知负面blockers和固定unknowns；矛盾声明、路径等额外字段和坏旧凭证拒绝。公共pure声明映射供资产中心、NLE、视频提交预检复用：负面受限／撤回／过期别名优先，正面用户声明始终不是授权／结算／服务能力。

SDK仅一次原作用域GET，AbortSignal在请求前与返回后复检，拒绝错身份和无效原版本。普通MediaDeliveryEvidencePanel由原project／record／version keyed，mount不读、不缓存、不加载文件或确认；明确读取先隐藏旧结果，停止／卸载使原lease失效，迟到回复丢弃。资产中心已明确核对的实际记录与Timeline原成功输出分别接同一控件；旧任务仍使用outputRecord原版本，不从归档列表找最新。

本版新构建18有限检查全exit0，完整Main121/20／App693/122、证据／NLE定向7（519未选）与Core render17（509未选）、Host12及实际字幕7／Host字幕7／音视频9均通过；同构建后台两个原身份2/2和6318列举输入初末一致，细节见PLAN22.196。普通截图只认证本控件的原身份／历史边界及unknown文字，不证明内容／视听质量或全界面。没有整包审片、字体／全部来源授权或实际账单绑定；Desktop旧“平台交付”预检还需精确同项目／采用版本和正式媒体证据保护，不能拿本getter或人工字段勾选替代。后续沿完整A09范围继续，未跑本版完整normal、不借旧A07基线，M4与85%不重计。

### Desktop平台提交资料的原采用／预检／归档（第22.197节，仅元数据）

Delivery独占新的`delivery.0005.platform-metadata`前向迁移、`delivery_variant_adopted_heads`和`delivery_platform_requests`，不修改旧迁移或peer表。保留原平台资料operation IDs，增加`platform-delivery.recoverRequest` GET原项目／请求key；所有路由仍通过tracked effect注册。公共strict契约在`contracts/platform-metadata.ts`，由既有delivery入口导出；公开SDK组合使用独立`client/platform-delivery.ts`，Renderer只调用client。官方生成OpenAPI、架构catalog和迁移矩阵，不手改生成物。

候选投影只公开允许的原标题／简介／标签与封面引用、实际记录version／完整记录SHA、项目／改编版本及真实采用头revision；可编辑status标记不提供采用资格。采用以原If-Match、原内容SHA和头revision做CAS，正式新版本、唯一头、原请求持久回执和owner事件同事务。公共Workspace／Production／Media读取同步完成于Delivery写事务之前，不在事务里再次调用会开启事务的公共服务；没有await介于公共核对和本域CAS之间。事务内只复查本域原行／头／原key，并只写本域行／头／回执／事件。竞争采用、同版本实际改值与事件故障回滚均有实际SQLite回归，不通过修改全局UOW或读取peer SQL实现。

预检严格原project／episode实际父级／variant归属、精确采用头和可选封面Media owner证据。原项目／改编／分集身份、版本和全文记录hash、原标题／简介／标签、原profile、采用revision与封面证据进入指纹；归档必须提交原input／sourceFingerprint及原If-Match，并在本域CAS后冻结原preflight。scope始终submission-metadata-only、releaseReady=false，固定质量／合法授权／结算／当前文件／平台规则unknown；无Host文件读取、生成、Provider调用、登录或发布。内部profile不是当前平台规则，人工声明不认证授权。完整媒体成片／NLE来源、审片、授权／账单门仍独立未完成。

采用与归档持久原请求保持历史响应，重复原key不再修改头或新增归档；原key恢复只读，不按当前状态替代。新归档读取／导出核原身份与冻结指纹；旧ID清单仍可安全读取／导出为legacy-submission-metadata-unverified，限定字段不含原payload的私有字段，绝不补造采用头／冻结文案／新preflight。旧status与已发生采用回执只表示其原时刻的事实，不把历史回放当当前采用。错误作用域、坏历史和读取失败不降级为空／较旧成功。

普通Panel按project／adaptation／episode keyed，不自动选profile／variant或恢复新勾选。预检和动作使用abort＋epoch，离开／换选择废弃迟到结果；正式写入先持久原key／输入，未知时只读核对或明确同键重发。本机仅保留原作用域／版本／指纹和原请求声明值，无文案、凭据、路径；目录坏读与坏原请求不放行新写入。只有明确写入拒绝且原key GET404，才允许用户另行保留原拒绝记录并重核来源，不静默抹掉未知结果。

末版19条有限命令全部exit0，33类型、完整Main121/20／App699/123、资料Core7（533定义中526未选）、原证据7、原render17、Host12及实际字幕7／Host字幕7／音视频9分别通过。同构建后台资料20.280秒、原混音40.060秒、原字幕29.872秒，3/3；6330列举输入和三个本机工具／字体首末相等，完整终态／SHA和失败见PLAN22.197。Host旧omit回归先等待公开`dispose()`监督屏障，再查临时目录，未降低像素／输出／取消断言；terminal output并不承诺finally清理已经同步结束。未跑整组完整normal、不借A07旧基线，不等于完整Media Gate、M5真实质量、法律或发行，原M4与85%不重计。

### 完整原NLE包与实际审片决定绑定（第22.198节，不是发行批准）

Review新增不可变`review.0003.media-packages`和独占`review_media_packages`，保持旧迁移／review_packages／comments／decisions。新preview、createPackage、recoverRequest、evidence、exportOriginal五路由经tracked effect登记；新public `review.media-evidence.v1`只读原审片证据。Timeline的public deliveryManifest仅peek已存在时间线并构建完整NLE元数据，不初始化、不读Host／文件；Review同步读取公共Timeline／Production／Media后，自己的事务只写包、原请求／快照和最小事件，不读写peer SQL。

快照保存完整实际NLE轨道、包括inactive音频在内的全部素材来源／存档元数据，原改编／分集／剧本／场景／镜头／素材version及完整公共owner记录SHA，所有片段／字幕／增益／静音／solo／fade／ducking和frame表达保留。源指纹覆盖完整快照与明确范围，同version实际改值也失效。创建必须原If-Match／sourceFingerprint／原key；本域包／绑定／回执／事件同事务，原key重放优先于当前来源，事件失败全部回滚；空镜头与简化投影不支持的帧率拒绝，不默默转换。

读取验证原receipt、key／input SHA、原包hash／时间／归属、原快照SHA；坏记录503，不回退旧成功／latest／空列表。原JSON仅投影原package和snapshot，不导出key、决定正文、意见正文或任意素材payload。当前源只重新观察比较，不写旧快照；父链、轨道、字幕、素材或存档变化使原审片stale。没有绑定的旧包保持legacy-unbound／unverified，即使有approve也不补为新证据。

审片只读取本域完整意见／决定，按真实插入rowid确定每个package／shot范围最新非note决定；整体approve必需，逐镜头return／request_changes、未解决意见、错误反馈归属和原source blockers优先，后来的整体approve不清除逐镜头问题。公开decisionFingerprint覆盖本域完整原反馈内容，但只公开允许的ID／时间／范围／状态，不公开作者alias／自由意见或note。approved只是原人工决定的机械投影；CONTENT_QUALITY_UNVERIFIED、LEGAL_RIGHTS_UNVERIFIED、SETTLEMENT_UNKNOWN、CURRENT_FILES_NOT_READ、RENDER_AND_FONT_NOT_REVIEWED和releaseReady=false不提升。

22.218将原反馈写入缺口收在Review自己的事务内：comments创建／解决、decisions创建及offline导入共用原包范围校验，绑定包复用同一完整receipt／输入／包与来源指纹核对；无绑定旧包只取自己的冻结manifest镜头集合。新镜头／异项目／不存在镜头均不能借当前Production列表纳入旧范围。离线批次先校验全部项，再写本域记录与事件；404缺包、409范围错误、503原包损坏分别返回，公开契约保留原路由／operationId并列新增错误响应。历史坏反馈不删除或升级，解决其意见仍拒绝；合法原范围在源变后可继续历史审阅，但不会解除stale或任何Media Gate未知项。没有新迁移、跨owner写入、Host文件读取（显式离线导入除外）、模型或发行权限。

严格client SDK在请求前后核AbortSignal、原作用域／key／body和完整JSON原包；普通Panel按实际项目／分集隔离，不自动选包或勾选，明确新来源／原key恢复／同body重发和读取当前包门。写前持久仅原不透明输入；未知不清除／换key，确定拒绝加原GET404后仅明确保留拒绝再核新源。坏pending阻断新写，离开／选包使旧lease无效；原导出在调用Host保存前再核lease。Renderer新增review契约子路径显式映射，不回退根文件或引入Core／Host实现。实现与原失败见PLAN22.198，终态补收见22.203：有限23命令、M5工具47项及原四后台旅程4/4通过，6345列举输入首末一致；字体夹具首次失败保留，不放宽glyph门。不等于完整normal，整个Media Gate、权利／账单凭证、成片／字体审片及最终整组normal仍待。

### 原包逐素材owner证据（第22.210节，不是完整Media Gate）

第22.210节接通Review原包逐素材owner证据，不新增迁移或路由。既有evidence GET复用Media公共deliveryEvidence，严格核原包每个素材ID／version／完整记录SHA；变更／缺失／公共读取能力缺失分别显式表达，不取最近或别的素材。Media仍独占自己的来源、存档、声明和字节凭证读取；Review不查写peer表、不读取Host文件、不升级合法授权或费用结算。原包存档与当前owner存档按原artifact／kind／MIME／extension／size／SHA比较，变更和原未绑定各自阻断，不给旧包补来源。每个记录读取后再核SHA、全部读取后再核完整来源指纹，过程中变动拒绝本次观察；坏owner凭证拒绝整次读取而不回退空成功。公开严格契约要求全体原锚点、不缺项／不重项／同项目及完整负面阻断，状态只为blocked／unverified／no-media，releaseReady=false。普通App复用单素材证据视图、逐项展开，人工reviewState与素材mediaOwnerEvidence独立；历史字节读取始终只证明记录时刻，原CURRENT_FILES_NOT_READ等未知不变。官方SDK／架构与迁移矩阵按生成命令更新，本组有限验收见PLAN22.210，不冒充完整normal、完整Media Gate或M5真实评测。

### M5离线研究记录与真实证据边界（第22.199节）

`scripts/product-evaluation.mjs`保留原catalog／template／validate／summarize，新增study-template、三路user-template与study-check；研究模块只消费原严格评测校验／描述性汇总，无网络、模型、业务DB或文件写入。CLI完成可复用exports初始化后再加载study模块，避免入口top-level await与模块互引造成退出13。统一记录仅允许协议／固定评测／匿名任务观察／调优／获准案例／商业决定／平台设备证据的白名单标签、数字、时间和摘要；不接收正文、Prompt、路径或凭据，错误不打印输入。

协议draft不判建议阈值；声明frozen须完整时间与批准摘要，晚于用户开始不能当预注册，外部真实性始终未独立认证。评测按小说／改编与原固定模型配置分组，每个必需情境的唯一完成记录、决定／修订／匿名人工评议和用量／结算声明需完整，重复候选或未知不补通过。用户任务按真实目标、角色、研究同意摘要及原条件记录；帮助、失败、放弃、未完成、来源变更和重启分别保留，设备／构建／模型／素材预算条件不同不混耗时。六个gate仅给supplied-evidence-complete或incomplete，全部供给齐备也不输出M5／质量／发布pass。

22.204新增evaluation v2的严格execution字段（原起止／回执／当时完整协议SHA），默认null；v1仍按原字段只读校验，缺时间不推算。研究v1可内嵌两种版本，模型组供给就绪另核开始不早于冻结及原协议摘要完全匹配；事后改阈值不重绑原运行，缺失／晚冻结／协议不匹配列独立缺口。时间和摘要未独立认证，不签发预注册或真实执行证明，全部原观察与not-established边界保留。

22.205同模块新增compareEvaluationRecords／compare双文件CLI，严格原套件／输入和逐情境唯一完成记录后配对，按两路／前后来源与完整模型摘要列组；同源新执行的相同输出保留零变化，跨样例复用、缺失／失败／多记录不挑最佳或补零。采用、修订／声明耗时、同一声明盲评者的三维序数等级和原逐项检查分别列变化；费用只在同币种且未共用摘要的声明上用BigInt计算八位小数差值，不合成质量分／总节省。原时间／协议差异、未知和回执复用保持可见，不认证实验或因果效果。前后原记录／summary／配对和比较摘要供人工核对，不写文件／调用模型／自动调优。

第22.205节当时44项Node离线测试含原34与新增10项比较反例／真实CLI；第22.207节当前52项，正常test:unit入口及显式格式检查保留。候选7与元数据10项另通过，不重跑本版完整normal／媒体后台。Platform套餐价值展示独立实现于自己的Web／SDK字段，不导入Desktop脚本或数据、不变更协议或支付。相关有限验收不借旧媒体normal或自动升级M5／GA。

第22.207节另支持显式`--catalog <local-v2-catalog.json>`。默认v1情境包和旧suite／input语义不改，来源只47–100个Unicode字符，targetScale不等于实际中／长篇。新catalog v2上限16MiB，每例实际source最多200万UTF-16单位，另核Unicode字符数／UTF-8内容SHA、人工规模分类引用与有序源单元；complete-work须无漏覆盖正文、不重叠或切开代理对。已有文字只在明确指定的本机来源目录读取，评测／研究记录仍1MiB及无正文白名单，输出不带正文／任务／意图／路径／自由sourcePolicy，不写业务或自动上传。新protocolDigest绑定suiteDigest与完整协议，旧摘要不能补为新确认；重复源的已知分类矛盾拒绝，未知不继承另一例确认。M5模型供给门另要求完整中／长篇声明和分类引用，缺项保留FULL_SOURCE_CORPUS_INCOMPLETE，同时原观察不丢；短篇创意任务不强制先有小说。偏移覆盖、字符数与人工摘要不能独立证明全篇、文学长度标准、作者权利、原审批或真实质量。合成填充只用于边界测试，没有新真实语料、模型运行或M5完成。

第22.214节补`verifyEvaluationEvidence`／`verify-evidence`离线只读附件核对：先严格校验原evaluation v1／v2及suite，再按显式目录内固定`<sha256>.receipt`读取七类原摘要引用，核原始字节，不转换规范化JSON摘要。相同摘要只读一次并保留全部匿名角色引用，不冒充独立样本／收费；缺失、不符、非普通文件、超限或可检测变更不补成功。单文件32MiB、声明总量256MiB、最多5000唯一引用，读取不跟随最终符号链接、非阻塞打开并核文件身份／大小／时间；平台缺必要标志明确拒绝。输出仅摘要、角色、状态和字节数，原记录／附件不写、不解析附件内容，无业务DB／路由／模型／网络或跨产品依赖。exit0只为全部引用在各自读取时匹配，exit2为无／不完整附件，非法输入exit1；单次文件核对不是原子目录快照或来源认证，全部原M5／质量／发布not-established边界保留。当前58项Node测试含新增六组原字节、共享引用、旧版本、缺件／篡改／规范化差异、链接／大小、真实CLI与隐私反例，不是实际真人／模型研究。

### M5候选包只读检查（第22.200节，非发布门）

`scripts/check-release-candidate.mjs`只从本Desktop工具链加载YAML／asar，按当前version／productName读顶层更新清单与安装文件，校验完整size／SHA512并输出SHA256；历史／debug隔离、非法名称／链接、描述冲突和全字节篡改拒绝。旁置mac解包Runtime与app.asar内自有Main／Renderer编译文件另比，排除Runtime依赖、watcher状态和恢复副本，不证明安装文件与app相同、源码构建来源或全依赖库存。codesign完整性、身份、公证未查及三设备not-run分开，releaseReady始终false；无安装、应用／更新器启动、网络、签名写入或发行。

正常test:unit保留原门并加入新7项Node测试，显式format链包括脚本／测试；原研究30项也另通过。PLAN22.200记录实际旧同版号包、旁置构建差异和ad-hoc签名，本版未跑新完整normal／package／E2E。该组发现的release:metadata递归dist问题随后按22.201修复，但清单生成不升级旧包；设备、签名／公证和批准仍需自己的实际证据。

### M5当前版本发布库存与新目录生成（第22.201节）

候选检查与生成共享readReleaseArtifacts及全字节hash。generate-release-metadata仅收顶层当前product／version安装文件、update清单与对应blockmap，不递归旧包／解包／debug；未被update引用的本版ZIP／DEB仍纳入。原最低20唯一组件门和坏manifest检查在任何输出前，SBOM只定位本Desktop已安装依赖，不认证完整打包依赖或法律许可。暂存文档后再核原字节，exclusive mkdir／无覆盖link生成到新目录；已有输出拒绝，并发失败者不删除成功者文件。最后release-inventory绑定所选文件size／SHA256／SHA512及三份文档摘要，releaseReady=false，不是源码构建来源或发行批准。

原Bun入口与CI package→metadata顺序保留，新10项Node测试接正常unit／显式format；真实Node／Bun CLI仅向临时惰性fixture输出。只修改Desktop发布脚本，不改Runtime业务、Platform、依赖或现有候选；无新完整normal／package／E2E。范围与实际失败／修正见PLAN22.201。

### 创作推进的共享单工作流租约（第 22.46 节增量）

Automation 的 creationRuntime 原先仅在 500 ms worker 内维护 busy Map；公共 service.launch 和显式 continue／rebase 直接调用 step／dispatch。dispatch 先持久保存 generating／runId，再 await Agent runner 的 Host health／createSession，另一次 worker step 可以在实际 agent_assistant_runs 尚未写入时误判“引擎提交在保存前中断”。真实续章和本章公共 HTTP 延迟 createSession、跨过实际 worker tick 的两项回归在修复前均稳定得到 failed，不是只通过增加超时绕过界面断言。

同一 workflow 现在在进入异步动作前建立共享 Promise lease：直接 launch、周期推进、明确继续复检及人工合并的复检均走 advance。已经在途时返回原 Promise，不再次派发或检查未落库 run；finally 只删除属于本次 Promise 的租约，不串行阻塞不同工作流。tracked worker effect 停用先 stopping、清 timer、拒绝新推进，再 await 全部在途 Promise，包含公共入口而非仅 timer 发起的任务。内部返回的 step 同样指向 advance，避免旁路；不改变 owner、持久工作流／事件／run 协议或历史迁移。

租约仅存在本 Runtime，重启不造“仍在提交”证明；真正缺 run、引擎 unavailable／failed、取消和历史中断仍沿实际持久状态失败或明确恢复，未加入盲等宽限、自动重试、重新分配目标、换模型或来源。既有 cancel 与迟到保护仍单独执行，候选须显式采用。修复后受控延迟入口及实际失败保留／同键重放／取消／助手路径定向通过；完整默认与真实后台旅程／固定回归按各自终态记账，不能把单项成功补算成整轮 Gate。首次固定后台 34 通过／1 混合续章失败及实际截图保留在 PLAN 第 22.45 节，新验收见第 22.46 节。

### 实验渲染界面、原请求恢复与冻结输出身份（第 22.45 节增量）

Timeline 追加不可回填的前向迁移 `timeline.0006.render-request-and-output-identities`，在自有 render_jobs 保存幂等键的 SHA-256 request_fingerprint 与成功输出的实际 Media record ID／project／version。不暴露原键、内部快照或路径，不为历史任务猜输出身份。声明式 `timeline.renderCatalog` GET `/api/v2/episodes/{episodeId}/timeline-renders` 经 Production 公共服务核对实际分集／项目，只查既有 Timeline 和自有任务；空分集不调用 getOrCreate、不写业务行或事件、不调用 Host。limit 1–100、实际 createdAt／ID 锚点及完整作用域游标，伪造或跨项目游标拒绝；原请求 hash 查询不混用分页。保留 no-store、响应内容 ETag、严格契约和 RFC 7807。已知活动任务的 get 仍可保存实际 Host 状态事实，不把它泛称为所有读取均无写入。

Media.registerArchivedArtifact 在同 owner UOW 中严格校验实际描述符。opaque ref 已存在时，必须只有一份存档、有效且未移除，实际项目／parent／kind／title／record version 0、MIME／扩展名／大小／SHA／几何／时长／有理帧率／drop-frame 及持久冻结 lineage 全部精确一致才返回原记录；完全重放不写行或事件。冲突、歧义、隔离／移除或记录后来被编辑均拒绝复用。Timeline 通过公共服务捕获真正输出记录身份，验证项目／分集／video／version 0 后保存；冲突记 OUTPUT_ARCHIVE_CONFLICT，不暴露 outputRef／outputRecord。各 owner 保持独立事务，不声称 Media 登记与 Timeline 状态跨域原子提交，也不删除可能仍有效的中间存档。

timeline.panel.render-jobs 作为 Timeline 的官方 UI contribution 正常生成 manifest；渲染阶段实际组合 TimelineRenderPanel 和既有 Production 输入预检，两个预检／执行语义不混用。Renderer 仅经 @dramaip/client，timelineRenders.list 严格验证作用域、全部任务归属、当前／冻结版本、重复 ID、输出身份及精确请求 hash；全分页读取遇重复／循环／版本变化拒绝不完整历史。面板按 project／episode remount，统一 AbortController、busy lease 与 selected epoch 处理 StrictMode、旧读取和迟到轮询；离开不取消持久任务，指定 active task 才读取实际状态，不默认选择最新。

明确创建或重试前先核对实际 Timeline／sourceFingerprint／rendererVersion／sidecarFingerprint，声明不默认勾选且不持久化。派发前先保存严格原项目／分集／时间线／version、UUID 原键、创建输入及可选 retryJobId，不保存正文／字节／同意。未知结果阻止另建请求；刷新／重启仅按原键 hash 和全部原输入只读找回同一任务，不能按最新任务猜回执。明确重发也先查原回执，再复用原键／原输入，不自动重发或重新预检换源。首次明确 400／409／412／428 可解除本次未接受绑定，未知／重放冲突保留原绑定；错域或损坏本地恢复明确阻止写，不替换或删除为“没有请求”。历史选择只保存 timelineId／jobId，实际任务变化清空预检和声明。

成功输出复用 MediaPlaybackPanel 的实际项目／ID／冻结 version 与全字节读取；用户须明确加载，不自动播放或审阅。历史缺输出证明不补最新身份；后续 Media 记录变更，旧输出 version 0 保留并以 412 拒绝加载。实际产品界面受控后台旅程已验证回复丢失但服务端接受、原键只读恢复且仅一次创建、完整实际解码／播放／seek／释放、Electron 重启精确选中且不加载、明确取消与原来源重试、旧输出版本拒绝、空分集和错域恢复无初始化。隔离本机测试 sidecar 与静音蓝—黑—蓝样本仍不是发行、人物／声音质量、权利／费用或正式混音／字幕证据。

工程完整和固定后台回归按实际终态逐次记录在 PLAN；首轮扩展测试对外部 SDK 新建项目使用了尚未刷新的 Renderer 项目目录，实际界面仍在旧项目而断言失败，修正用例先刷新目录并通过真实下拉选择项目后再打开同项目入口。此处没有修改或声称修复整个 ProductionWorkspace 的 URL／目录选项机制。NLE 清单的 owner 存档／真实权利投影、正式混音／字幕、完整 Media Gate 与其他本地任务继续；22.44 的无产品 UI 结论仅表示当时验收范围。

### 实验渲染的冻结来源与全文件快照（第 22.44 节增量）

Media 公共 `archivedArtifact(id, projectId, recordVersion)` 服务只从自己的实际 Media 行和唯一有效 media_artifacts 读取严格描述符，不信任 payload.mediaRef／checksum。Timeline 复用既有实际来源／音轨采用投影，冻结全部绑定、owner 存档身份和不可编辑 sourceStatus；历史没有冻结素材版本、来源失效、歧义／移除／隔离、错项目或非 MP4 视频均拒绝。视频轨 mute 只影响声音，不排除画面；10,000 片段上限、非重叠视频及 P0 固定 Profile 仍是实验限制。元数据预检是 owner 证据，不冒充实际文件字节或质量／授权证明。

追加前向迁移 `timeline.0005.frozen-render-source-proof` 为 render_jobs 保存 source_fingerprint／source_snapshot_json；不改旧迁移或回填历史。创建与重试必须提交明确 sourceFingerprint，经过 Host 健康检查后再核对实际来源与时间线版本；最后一次同步核对到本 owner 写事务之间没有异步等待。任务、原冻结快照和 queued 身份事件同事务保存，同幂等键但不同输入拒绝。历史任务仍可读，缺证明不能按当前最新版重试；有证明也须仍与原来源一致，不悄悄换源。SDK 在 StudioClient 手维护组合提供 timelineRenders，严格核对请求／结果身份、版本、指纹与协议，不暴露内部快照或 Host 路径。

Host 私有 Bearer 接口只收 opaque mediaRef、严格 SHA-256／sizeBytes／video/mp4 与时间参数；拒绝路径、额外 clip 字段、数字字符串、无界或越界值。Render supervisor 先复制调用输入，按 jobId／完整输入哈希防冲突；同时最多两任务，30 分钟上限，关闭后不接受新任务。每个任务使用随机独立目录，复用 ManagedMediaReader 的固定根／文件类型／链接／stat 守卫与前后全字节校验，将完整文件写入独占只读副本；同引用只有描述符完全一致才去重，快照后原库变化不改变本次输入。实际 probe 核对 sourceOffset＋duration，不自动裁短；FFmpeg 无 shell，只读任务副本，显式 CFR／25 fps／总帧数，真实输出 probe 再核对几何、帧率及 durationFrames，之后才归档并发布 opaque 输出引用。该副本不宣称抵抗同一用户的特权文件篡改。

取消、执行异常、探测／编码期间变化及 shutdown 通过 AbortController、SIGTERM／超时 SIGKILL 和 finally 释放子进程、读取句柄、输入副本与临时输出。Desktop Application 先等待 render supervisor.dispose 再停 reader／Host；未发布的取消输出移除。Runtime 不让迟到 running 结果复活终态；成功 Host 响应须符合原任务、renderer／sidecar 和冻结 Profile，错误响应转 failed 且不登记 Media。有效输出通过 Media 公共服务归档，项目、分集、标题和谱系使用原冻结时间线版本／指纹，不拿等待期间最新 Timeline 回写。Host 启动失败、404 中断和 Runtime 重启中断同样保存身份事件；读轮询不伪造新任务。

正常生成 OpenAPI／owner 目录／迁移矩阵，不手改生成文件。实际后台本地编码的三秒／75 帧、蓝画面—黑隙—蓝画面、原生 decode／play／seek、取消、等长输入篡改拒绝及恢复原字节后显式重试有受控证据；签名使用隔离测试密钥与本机现有 FFmpeg／FFprobe，未下载、付费或发布。该节旅程通过公开 SDK 和显式受控原生探针，不是产品化渲染界面；后续发起／恢复／结果查看 UI 见第 22.45 节。正式音轨混合、字幕烧录、重叠合成、超大播放及完整 Media Gate 仍未完成。该节验收时只读复核 NLE 清单发现：输出为 mediaStatus=unattached 的相对占位引用，未接入 owner 存档 checksum／完整字节；权利 cleared 由可编辑 payload「权利状态」派生，不是权利证明。后续 owner 存档／冻结身份和明确字节核验见第 22.47 节，真实权利证据与媒体复制包仍继续；不把本渲染修复外推到全部交付。旧指南的 checksum／全面警告／Provider-only 成片说明据实修正，完整命令、首次失败和剩余项分别见根 PLAN。

### 时间线实际来源与同步预览（第 22.43 节增量）

Timeline owner 的声明式 `timeline.playbackPlan` GET 只读取既有时间线，不调用 getOrCreate。请求须 exact project／timelineVersion，错误归属 404、版本变化 412，保留 no-store、ETag 与 RFC 7807。手工 relink 新增实际 Media record.version 的 assetVersion 冻结，限制同项目与 opaque UUID；历史缺版本不回填。装配片段由 Media 公共 audio-track 投影的实际采用状态、来源指纹、冻结 track／asset 版本和片段关联核对，手工 relink 不能绕过音轨修订链。Media 新增只读 sourceStatus 公共服务投影，Timeline 不查 Media 表，不信任可编辑 stale／sourceShotVersion 标记；实际上游镜头／内容失效或历史未核验素材阻止同步预览。该核对不是语义质量或授权证明。

Renderer 经 @dramaip/client 读取完整计划，按 Media owner 描述符及全文件 Blob 通道读取／去重，等待全部原生媒体解码并核对 duration，再重新核对时间线和素材来源。全部成功才开放媒体 transport；每次开始播放前与五秒定时元数据轮询再次核对，变化／失败释放全部 URL。最多 16 个不同文件／64 个片段／合计 256 MiB，沿用单文件 128 MiB 上限；重叠视频、不完整文件、类型不符或 sourceOffset＋duration 超过实际时长均拒绝，不截取子集或自动裁短冒充整条时间线。

独立可测试的媒体时钟按 rational FPS、exclusive end、开始／时长／源偏移计算位置，在真实片段边界等待原生 play 完成后再推进；缺控件、拒绝／取消／十秒启动超时不会运行虚拟替代时钟。暂停／seek 取消原播放锚点和待启动请求，mute 不暂停视频画面，subtitle solo 不误静音所有声音。Web Audio MediaElementSource／Gain／master 连接独立实际媒体，应用 volume、fade、ducking 和本次试听静音；无需音频的纯静帧不强制 AudioContext。设备中断／等待供帧／提前结束明确失败；退出、版本变化或停止释放定时器、节点、AudioContext、请求和 Blob，不调用模型、写业务状态或勾选声明。该本地设备预览不承诺逐帧精确、测量波形混音／真实声音质量或正式 Media Gate。

AssetMediaPreview 的同页“重新核对本地记录”先卸载旧播放器并取消旧读取，经实际 MediaRecord schema／身份／项目／版本核对后才建立新播放器；失败、卸载后的晚到结果和错误项目不能恢复旧文件。记录核对与实际全字节载入保持两次明确操作，即使版本未变，重新核对也释放旧 Blob；不会改变冻结音轨来源。

### 精确媒体只读文件与 Blob 播放（第 22.42 节增量）

Media owner 新增声明式 `media-playback.describe`／`media-playback.read` 两个 GET。请求明确 actual record／project／version，内容读取另须 SHA-256 与 If-Match；严格公开描述符只含身份、版本、类型、大小、哈希、来源和 opaque artifactRef，`verification=owner-metadata-only` 不冒充文件校验。只查自己的 media_artifacts，档案移除／隔离／归属错误或歧义不回退 payload；payload 的 mediaRef／路径不能授权文件。安全内嵌编码也必须完整合法，不读取任意 URL 或 SVG／HTML。

Host 私有 Bearer 通道 `POST /host/v1/media-library/read` 接受 opaque UUID、固定 MIME、预期大小与哈希，不接受路径、额外参数或字符串大小。Main 的 ManagedMediaReader 只读 userData/media-library 下由 MIME 白名单固定扩展名的文件；拒绝符号链接、硬链接、根身份变化、非普通文件及大小不符，在返回头之前核对全文件 SHA-256，并在实际字节流 EOF 再核对完整哈希和 stat。持久文件／Media owner 身份不依赖 session map，重启可重新验证。Media 对 Host 类型／长度、实际交付流的全字节哈希和结束时的 owner 身份再次核验；截断、流中变化或失败不能得到成功 EOF，错误不泄漏物理路径。

两层读取均最多八个并发、五分钟上限，跟踪取消与关闭；Media 通过 native ctx.effect 异步释放活动读取，Main shutdown 等待 reader dispose 后关闭 Host。Runtime 路由保持超时信号同时继承实际调用方 signal，避免取消被覆盖。SDK 在生成 OpenAPI 通道按 stream 读取并完整核对字节数，成功后返回 Blob，不提供原始 Runtime URL／Token／物理路径；保留认证、Origin 和 RFC 7807，未增加匿名播放绕过。完整 Blob 播放限定 128 MiB，不做前缀预览，也不宣称 HTTP Range／超大文件流式播放器。

Renderer 只通过 @dramaip/client 和公开契约。MediaPlaybackPanel 明确加载、无 autoplay，类型与冻结版本绑定；原生解码失败、owner 轮询失败／变化释放 Blob，停止、换对象和卸载取消并 revoke。轮询是 owner 元数据核对，不对已加载副本持续重新读磁盘。来源复核、音轨新旧对照与资产中心复用播放器，assetVersion 展示标签不冒充 record.version；播放不写审阅证据、声明、采用状态、媒体表、Timeline、任务或事件。单文件原生播放不代表 Timeline 混音／字幕同步、质量、权利／费用或完整 M4，工程／后台证据见根 PLAN。

### 媒体身份摘要与精确待确认返回（第 22.41 节增量）

Media 两条和 Timeline 一条项目级 GET 摘要只投影各自权威预览表；没有新的全域待确认表、迁移或业务事件。实际 Workspace 项目须存在，游标绑定领域／项目／真实创建时间／真实 UUID，按稳定创建时间与 ID 翻页并限定 1–100 条。源状态从现有 owner 公开服务重读，投影在 SQL 读事务外运行；只返回显式严格白名单的身份／版本／生命周期／时间／计数，不含台词、字幕、全量轨／时间线、内容哈希、素材字节、映射数组、理由或审阅声明。摘要读取不改历史状态／时间／头／回执，不补造证明，保留 ETag、RFC 7807 和 traceId。另增加 Media owner 的指定实际素材 GET，用于明确详情审阅，不把正文混进全局摘要。

`loadConfirmations` 读完三类全部游标、按实际项目隔离和对象 ID 去重。pending 来源复核／音轨修订／换源进入待确认或来源失效的需要处理；音轨 confirmed 且是当前确认头、实际目标仍 draft／缺失时分别等待另行采用／需要处理，读取目标实际状态而不是冻结候选状态。历史 adopted／discarded／confirmed 换源、旧确认头及实际已采用新轨不反复列待办。缺能力、读取失败或游标循环明确未核全，不能宣告零。

MediaFeature 在明确 URL 身份存在时只挂载独立 `MediaReviewReturn`，严格核对唯一有效 ID、项目和关联身份；不挂载会自动选择默认分集的普通 ProductionWorkspace，也不调用可能初始化时间线的 episode Timeline GET。三面板以指定预览优先于本机历史选择，重启／状态／来源变化清空三声明。音轨确认和另行采用保持两个操作，后者重读实际目标 ID／版本／状态并经 Media 条件采用；旧轨、素材、时间线不自动覆盖。Renderer 全部经 Client 与公开契约，无业务 IPC、fetch 或 peer 实现。工程／失败／固定构建后台证据见根 PLAN；本增量不代表实际声音、权利／费用或完整 M4／目标退出。

### 不可编辑媒体来源与显式复核（第 22.37 节增量）

`media.0007.immutable-source-bindings` 是追加迁移，不修改旧迁移或为历史 payload 回填来源。Media 独占 `media_record_source_bindings`／`media_record_source_heads`／`media_source_reviews`／`media_source_review_requests`；绑定记录禁止 UPDATE，头指向追加的新绑定。保存实际镜头 ID／版本、素材内容 SHA-256、来源类型和绑定版本；采用／锁定／失效等管理字段不是内容证据。生成结果使用请求等待前捕获的版本，视频归档使用持久 job 原版本，不能在晚到结果创建时偷换当前版本。

`media-sources.*` 六个声明式 `/api/v2` 操作提供只读来源状态、游标历史、预览读取／创建、明确确认／放弃，保留 ETag／If-Match 的 412 条件失败、必需幂等键与 RFC 7807（含 traceId）。跨 owner 只经 Production 服务读取实际镜头及场景→剧本→分集归属、当前正式分镜和上游状态；不查询或写 Production 表。当前正式结果必须包含实际镜头 ID／版本，局部重做保留的未选中镜头不会仅因采用头 ID 改变失效。静帧／视频采用、资产中心操作、视频预检及动态分镜引用重新核对持久绑定；篡改 payload、已完成结果之后源变或素材内容变化不能恢复有效。

预览冻结素材版本／哈希、原绑定头及真实镜头／正式来源指纹。确认须三个明确人工声明、If-Match 状态版本和持久幂等键；服务读取在本 owner 事务外，无 await 缝隙，Media 自身行／头／状态 CAS、追加绑定、复核状态、回执及脱敏事件同事务提交。重复请求重读当前复核投影，无额外绑定或事件。新来源复核事件仅含身份／版本，不将旧通用资源事件宣称为无正文。确认重置素材采用状态，不自动采用、锁定、付费调用、删除旧文件或改稿。

手维护 SDK 在 `packages/client/src/studio-client.ts` 组合既有 Client 和生成的 OpenAPI 请求，不手改生成产物；Renderer 仅用 `@dramaip/client`。静帧／视频卡片和选中音频素材的复核界面读取实际内容、恢复待确认历史、三声明确认／放弃，并显示源变禁用。安全 data URL 仅内嵌受限图片／音频／视频类型；没有实际安全预览的归档视频不能用元数据冒充内容审阅。该机制只证明机械身份／版本／内容一致；完整逐轨来源、语义质量、权利／费用与正式媒体 Gate 仍需继续。详细失败、受控证据及完整命令终态见 PLAN 第 22.37 节。

### 媒体异步来源版本与视频预检回执（第 22.36 节增量）

图片／语音在 `providerRequest` 前通过 Production 的公开服务捕获实际 shot ID／version，完成后再次核对；源变则保留候选与素材并标记 stale，跨项目来源在任务／服务商调用前拒绝。视频 job 的 `source_shot_version` 是原提交的实际版本，异步提交完成、SQLite 重启、服务商轮询及 Host 归档等待都不重绑定当前镜头；归档后以原版本再次核对。历史 NULL 不补造身份或版本，结果保留待复核，旧静帧／视频采用门仍拒绝 stale。

视频预检的指纹计算排除 `readinessHash` 回执字段本身，仅比较其实际确认的请求与来源。否则客户端在提交时附上预检回执，会改变原指纹并使正常提交失败。实际镜头版本／提示词／费用确认等变化仍改变指纹或阻断 ready，不借此放宽来源门。没有新增 API、表或迁移；第 22.35 节已增加的 media.0006 在新 SQL 样本中核对旧任务所有原列保持、NULL 不伪造、零及正版本可写／负版本拒绝和 SQLite 完整性。

受控 Host 替身经真实 Runtime HTTP 路由验证图片／语音等待中改稿、同键并发拒绝／精确重放、新键绑定当前版本、跨项目零调用，以及视频提交和归档中源变、未变与历史无版本三种恢复。跨域输出不携带服务商凭据引用，同域输出沿既有规则可使用该引用；只保存不透明 mediaRef，不保存易失输出 URL。视频终态再次刷新不轮询、不重复归档或删除，任何结果都不自动采用。测试的归档描述符由受控 Host 返回，不是实际 sidecar 探测或真实付费视频证据。无正文断言限定视频生命周期／归档事件与对应任务；现有通用资源事件仍含本地资源 payload，不将整个事件总线宣称为无正文。逐次失败及验证终态见 PLAN 第 22.36 节，完整逐轨语义复核／媒体 UI 闭环仍未完成。

### 引擎状态与恢复

Runtime 永远拥有 Session、Run、Item、checkpoint、Preview/Commit 和恢复状态；vendor thread/turn 只是执行句柄。Run 状态为：

```text
created / queued / preparing / running / waiting_approval / committing / completed
interrupted / failed / aborted / orphaned / recoverable
```

Pi、Codex、LangGraph.js 实现同一 vendor-neutral contract 和 conformance。LangGraph.js 在 Electron utility process 中执行固定提示图，只是 external-benchmark Engine，不接管 Core Runtime workflow。Engine 退出立即拒绝 pending、结束 stream、发送 `RUN_INTERRUPTED` 并清理队列。Host generation reconciler 恢复 Provider 配置并扫描 recoverable/running/committing：持久结果幂等 Commit；Codex 和 LangGraph.js 还能从私有快照读取已完成结果；句柄缺失转 orphaned；临时不可用保持 recoverable；不支持恢复转 interrupted。旧 generation、重复 cursor 和迟到 terminal event 被拒绝。

2026-09-30 的 LangGraph 结构化结果修复保留完整且已解析的 JSON envelope 于中立 `text` 字段，`summary/content/data` 的展示与旧用法仍保留；自然语言模式不追加该字段。候选的 `title/items/brief` 和仅含 `issues` 的检查响应因此能原样到达 Runtime 验证，不能先抽取 `content` 而丢失业务结构。单轮修复后保存最终合法 envelope，不用修复前的流式片段冒充完成结果；引擎不据此直接采用正文。

## Extension Platform v1

`@dramaip/plugin-api` 根导出是 Public Plugin API v1；第一方 Kernel API 只从 `/internal` 使用。扩展 bundle 在打包时拒绝 Node builtin、dynamic dependency、native addon 和未声明依赖，运行时从不由 Node `import()`。

每个 active revision 使用独立 Electron utility process 与 QuickJS/WASM runtime。默认限制为 64 MiB heap、1 MiB stack、同步 2 秒、完整调用 30 秒、4 并发、100 次/分钟、请求和响应各 1 MiB。五分钟五次崩溃进入 quarantine；retry 必须显式清除预算。QuickJS revision 失败会退出隔离进程，候选更新只有在启动与健康握手成功后才替换旧 revision。

Capability token 由 Runtime 生成并绑定 plugin ID、content revision、permission revision、scope、expiry 和 trace；插件 payload 中自报 identity 被忽略。当前 capability 包括 namespaced storage、manifest-declared event subscription、command、declarative UI、namespaced route、scoped projects/documents/assets、`ai.invoke`、受限 network 与 notification。网络同时经过签名 manifest origin、用户 grant 和 Host SafeHttpTransport；路径、Credential 明文和 vendor object 不进入沙箱。

System 插件拥有 installed revision、grant、publisher、registry source、audit、storage document/index 与 event checkpoint 表。第三方没有 SQLite 连接。存储按签名 manifest 的 JSON Schema 子集校验，并由通用 index-value 表维护声明索引。事件订阅使用 durable consumer 和 checkpoint。

扩展包是确定性 `.dramaip-extension` ZIP。验证拒绝绝对路径、`..`、symlink、重复文件、超限文件数/压缩/解压体积；Registry root 与 publisher package 都使用 Ed25519 canonical signature。`extension:pack`、`extension:verify` 和 `extension:registry:build` 生成可部署到 HTTPS 静态站点的产物。

Marketplace API 位于 `/api/v2/system/extensions`，提供 verified/offline-cached catalog、preview/commit、enable/disable/retry、rollback、uninstall keep/export/delete。权限扩大及 publisher/key 变化必须重新确认；失败更新保留上一 revision。扩展启停只改变独立 Extension Graph revision，不改变官方 Product Profile/Core Graph。

第三方 UI 只有 command、menu、settings、form、table 和 panel 严格 schema。主 Renderer 只使用平台组件、纯文本、固定 icon、受控字段和 slot allowlist；不解释 HTML，不加载脚本、iframe、URL 或第三方 React/Vue bundle。

## 自主完成优先与兼容来源／意图编辑恢复（2026-10-02）

根 PLAN 第 16 节调整为本地工程 A01–A10 优先、真实模型／用户／授权／公开案例／发行条件 B01–B05 后置，保留旧 ID、原里程碑和验收标准。没有新增 Provider、产品间依赖或 Loop。第 22.51 节记录当前实现与实际验证，不把顺序重排当成功能完成。

Production 的旧 `episode`／`script-revision`／`review-check`／`shot-prompt` 只将明确 sourceIds 的本项目章节作为 prepare 引用，空列表不默认取前三章或全书。重复／缺失／跨项目来源拒绝；公共契约的 100 项上限保留并拒绝超限，而不是静默分页裁剪。Automation 在这四类新请求的 transient preview 中核对完整首轮提示、精确章节 ID／版本／路径／值及 included，隐私／预算排除在任务和持久上下文创建前拒绝；原失败工作流的重试仍用原 sourceSnapshot，采用仍重新核对实际来源与版本。无新表／迁移／领域事件／公共 API 形状，不能据此称全部混合来源操作已迁移。

作者意图草稿是 Renderer 的本机暂存编辑区，不是 Workspace 的正式业务版本。UI 按 projectId 使用专用 localStorage key，严格 schema 保留八个字符串字段及冻结 projectVersion／baseAdoptedId／manual 或 legacy 来源；字段尚未完整时也能保存。不经业务请求、事件或模型传出；正式预览／候选／采用继续只走 `@dramaip/client` 和 Workspace 唯一事务 owner。恢复不自动换头或同意，来源变化明确提示；已发现跨窗口改动时不覆盖旧读基准，不宣称 localStorage 检查是数据库 CAS 或跨进程锁。错误不外露私有原始值，损坏／未知版本数据保留，清空须明确确认且限定本项目编辑 key。普通应用实例没有被打开、隐藏或关闭。

## 独立 AI 作者意图候选（2026-10-02，PLAN 22.54）

Workspace 提供 `workspace.author-intent-creation.v1` Creation Adapter，继续唯一写入意图／采用头／请求回执三张本域表。新不可变前向迁移 `workspace.0008.ai-author-intents` 仅为 AI 来源中的实际 workflowId 加唯一索引，不改历史 SQL。AI 来源必须含原工作流、sourceSnapshotId、实际 runIds／engineKind 和完整 basis；手工公开预览仍只接受 manual／legacy-project，不能伪造 AI 来源。结构输出只接受唯一 `author-intent` 条目和严格八字段，混入正文、剧本、采用声明或额外字段会进入结构修复或失败，不生成权威内容。

`author-intents.sources` 声明式 GET 只返回本项目可用非空章节／剧本元数据、版本、哈希及当时项目／正式意图头。Writing 只读服务拥有章节，Production 新只读 `production.author-intent-sources.v1` 拥有实际剧本记录及保存的文档；复用本域 `directScriptSourceContent` 读取旧文本或 AST-only Fountain／FDX 表达，不初始化缺失文档、重解析或分配块 ID。Workspace 不查写 peer 表、不导入 peer 实现；Novel Profile 没有 Production 时仍可独立生成简报／章节意图，不强制增加媒体能力。

`authorIntentRequest` 严格绑定项目版本／baseAdoptedId 和明确来源身份（类型、ID、版本、JSON 引用 SHA-256，剧本另含文档版本或实际 null）。不接受 sourceIds 第二通道、正文目标／字数／其他工作流请求。Automation 首轮无写入预检核对实际完整提示预算与每个冻结字段／内容哈希，隐私或裁剪拒绝不分配上下文记录、任务或模型调用；随后沿用正常生成／检查／至多一轮修订／复检、派生硬预算、取消、原快照重试／继续和重启恢复，不新增计时器或引擎回退。

检查后的意图候选按实际工作流唯一落库，生成期间来源改变仍保存原基准并投影 stale，不能丢失输出或暗中换源。采用前先经只读 peer 服务核验所选来源，之后在同一 Workspace 事务做项目版本／当前头 CAS、写入状态和无正文 Domain Event；所有读取同步，peer UoW 不嵌套，亦不宣称多进程／跨 owner 分布式事务原子性。未选来源改变不失效所选候选，已采用意图仍是不可变作者决定，不因后续原稿变化自动撤销。只有意图专用 confirmed＋If-Match＋Idempotency-Key 采用路由能改变正式头；通用 Preview/Commit 只能同步已经明确采用的结果，不能代替作者确认。重放旧采用不切回历史头。

Renderer 只经 SDK 的来源目录、Creation 和正式意图接口；恢复精确 workflowId 时显示该运行自己的请求，不用当前勾选或最新运行代替。待确认按项目／workflowId／authorIntentId 三重关联去重，链接保留候选和原工作流；源变事件刷新只读状态，不自动生成或采用。未启动的 AI 来源勾选尚未实现持久草稿恢复，手工八字段恢复独立；真实 usage／费用、语义质量与其余本地范围继续另行推进。独立策略新增实现见下节，意图本轮工程／后台命令终态及失败记录以 PLAN 22.54 为准。

## 独立改编策略与精确下游绑定（2026-10-02，PLAN 22.55）

Production 唯一拥有 `production.adaptation-strategies.v1`、独立策略候选／采用头／幂等回执三表及六条声明式路由。新不可变前向迁移 `production.0011.adaptation-strategies` 依赖既有诊断和本域迁移；不修改历史迁移、增加第十五插件、跨产品依赖或 Provider。服务／路由使用原生 `ctx.effect`，状态写入、采用头、领域采用回执和无正文 Domain Event 在同一 Production 事务；peer 只读来源核验在事务外，不宣称跨 owner 原子提交。

`adaptationStrategyRequest` 只继承明确采用且来源有效的精确诊断版本／当时策略头。强类型 basis 冻结正式意图、诊断叙事判断完整引用哈希及实际原文／摘要／段落／高层表达，诊断内旧策略不进入新操作的叙事引用。隐私依赖包含派生记录的完整原来源；首轮完整 Prompt 无写入预检与派生硬预算复用 Automation。拒绝额外正文目标、第二来源通道或其他工作流请求，不补未选章节或把局部声明成全书。

新候选恰好包含 2–3 个严格策略选项，引用冻结诊断真实发现。确定性检查核对选项唯一性及保留／合并／删减／重排／重构的规范化动作区别，换标题或排列同一动作不能过关；该检查不证明语义差异、文学质量或制作可行性。沿用生成／模型检查／至多一轮修订／复检、原快照重试／重启、取消与持久 preview，不自动选择。采用须专用 confirmed、optionId、If-Match 和幂等键；竞争头、来源或原工作流变化保留冲突候选，旧回执重放不切回历史头，已采用选项不能原地重选。通用提交不能代替选择；通用放弃由本域服务处理，避免递归推进 Automation 的同一状态 CAS。

采用新独立策略后，季纲必须冻结其 ID／版本／所选 optionId 和只含该选项的引用哈希；诊断内旧建议及未选新方案不进入季纲。已有旧诊断策略的季纲保留内容与历史，但不能冒充新策略绑定；新头失效时不得静默回退旧方向。单集大纲／剧本／分镜逐阶段继承精确策略，Delivery 内部清单和脱敏谱系携带该引用；直写／已有剧本链与独立小说不强制经过此操作。

Renderer 仅经 SDK，独立策略工作台分别确认来源、生成、无默认单选比较和专用采用／放弃。指定项目／workflowId／strategyId 必须匹配，缺失或错误不改读最新候选；待确认只读取分页无正文摘要。PLAN 22.56 后，新项目默认六 Gate；同项目真实旧季纲／运行保留五 Gate 兼容链，外项目证据不能替代。未生成前的来源确认不承诺重启恢复；已创建运行恢复自己的原请求。测试终态以 PLAN 为准，不把新领域能力扩大为完整 M2 或发布通过。

### 新主流程与旧 episode 兼容（PLAN 22.56）

Production 的诊断专用采用允许省略旧 strategyId，只确认叙事诊断；原显式旧 ID／参数位置与历史回执保持兼容，采用后不可补改选项。不新增迁移或重写历史记录。SeasonPlan 仅在独立策略已有效采用时为诊断单独采用提供可生成基准；旧选项不能伪造该基准，正式策略版本仍精确沿用。诊断内容保留旧 proposals 供历史审阅，新策略准备引用只含诊断叙事证据，季纲另引用所选独立方案。

Renderer 正式流程与旧一体化 episode 工作台分离，旧生成默认折叠，所有入口、任务与待确认均明确兼容；旧 operation、工具别名与 owner 采用规则不变，不自动创建新独立正式结果。精确 workflowId 经 SDK 查询后核对项目与 operation，再用原 input／目标／来源快照恢复，不读最新候选。Session 不对精确工作流链接自动改写项目；改编页立即使用路由声明身份，缓存未核验、归属错误或不存在项目只显示错误，不回退其他项目。普通无精确工作流路由保留既有恢复。E2E 所需的 creation 源码别名加入现有 tsconfig 路径，不改变隔离 linker、依赖边界或安装包。

多分集已有剧本的裸项目入口恢复按 Production owner 返回的实际分集顺序核对连接，不用跨父级 script 列表第一项猜第一集。当前方案／项目归属／真实父级仍核对；不把本修复说成所有阶段或最后选中对象的上下文恢复已完成。

离线研究准备另有 `scripts/product-evaluation.mjs` 和十份固定内部情境包，实际 Node wrapper 测试为 `bun scripts/run-node.mjs --test scripts/tests/product-evaluation.test.mjs`，不属于 App／Runtime 运行依赖。工具只读明确的本地 JSON并向stdout输出模板／一致性摘要，不联网／调用模型／写业务；评测／研究记录保持1MiB无正文白名单，显式新版来源目录另为16MiB，可读取允许使用的本机正文但不回显。来源unknown、缺用量／确实零、原回执／模型版本和人工评议分开。来源、授权、真实模型／费用或文学质量不由自填元数据和摘要证明，quality／release Gate始终not-established。默认长篇项是明确片段，不是完整长篇语料；真实完整中／长篇、模型及用户仍未验证。研究协议和当前边界见根PLAN第14、22.52、22.207节。

## 安全和诊断

### 全项目正式来源状态与精确工具身份（PLAN 22.57）

Knowledge 的 `narrativeSummaries.summaries` 与 Production 的 `episodeDevelopments.summaries` 是无正文 GET owner 投影，不新增总待办表或 peer 写入。严格契约只暴露身份／版本／head／来源状态／计数／原时间，摘要完整范围 freshness 与 frozen context eligibility 分开，人工正式剧本无伪 workflow。真实 cursor 绑定项目与 owner 记录，ETag 随当前投影变化；SDK 拒绝跨项目、重复身份和额外私有字段。

全项目聚合读全部真实分页，不以存在模型工作流作为读取前提；后页失败／循环／能力不可用保留 unavailable。已采用摘要仅当前 head 的失效进入 attention，正式单集仅当前失效 head；浏览不撤销采用、改时间或触发模型。正式单集 resultId 只读原快照，匹配项目／分集／操作／可选 workflow，错误引用不换最新记录。Session 保留所有实际精确对象链接；ProjectToolPage 原子绑定项目与章节到路由身份，用读取 revision 拒绝迟到／乱序响应，错误状态按项目隔离。原普通无精确对象的最近项目恢复不变。

PLAN 22.58 的 App 身份纯规则区分明确对象、指定运行的结果和普通历史选择；指定运行未读取或未知时不以最新记录代替。CreationWorkbench 按项目／操作／目标／显式 workflow 绑定内部状态；诊断／季纲／质量工具的引用集合另约束本地审阅状态。恢复使用原运行的 typed request，明确新基准才解除旧引用；历史和人工重排更新具体 ID。错配链接不挂载工作台结果，独立策略回调不改写错误 strategyId。已采用／已放弃摘要的精确返回只读原版本，待审阅仍经实际原运行；这些 UI 保护不新增路由、表或跨产品依赖。验收与剩余上下文见 PLAN，不据定向工程宣称全部 UX 完成。

PLAN 22.59 的资源工作区在挂载业务组件前由 SDK 核对 project GET 与具体 Production 对象的完整父级；全部声明的 ID、kind、项目、父级和重复／空参数参与身份边界，错误不回退列表首项。明确对象按实际 GET 可在目录缓存未列出时恢复，内部选择状态按项目／引用集隔离。Session 仅保存本机对象导航提示，侧栏重新解析同项目资源路由，正式单集仅转交 owner 实际 episodeRecordId／scriptId，不将 stable episodeId、正文、工作流或权限跨页传递。创作目标显示／启动前再次核对自身身份。本项不新增表、业务写入、路由或产品间依赖；费用／权利未知不因导航或采用变成核验通过。

PLAN 22.60 的普通小说页按路径项目、全部 projectId／chapterId 参数形成读取身份；项目 GET、目录与明确章节 GET 在实际 ID／归属核对后作为同一个 snapshot 发布。旧 snapshot 不能在新路由挂载正文或写入控件，读取版本与当前引用同时约束迟到响应，离页使旧读取失效。明确章节不从目录首项、记忆或旧正文补出；未在旧目录列出的真实 GET 章节仍可读取。明确章节的未知项目由 owner 报错并保留链接，不让 Session 改读最近项目；无明确章节的普通目录选择和历史项目恢复规则未扩大改动。既有按章草稿／保存队列不清空，普通变更的 UI 回写仅作用于原绑定 snapshot；无新增路由、表、契约或跨产品依赖。

PLAN 22.61 的 TaskPage 使用完整 projectId／taskId／workflowId／revisionId 原参数集作为只读查询身份；重复、空值及无法证明同一对象的混合引用拒绝，不因 workflowId 存在而忽略 taskId。SDK 核对实际项目、任务列表中的准确任务、运行 taskId／input.projectId 和修订实际章节；错误读取优先于缓存，不渲染其他工作列表替代。普通 TaskCard 同样将 Change／Revision／Provider 原指针解析为实际 owner GET，验证 ID、项目及已声明原任务，修订来源版本失配只读投影 conflicted。未知或错误引用不使用嵌入参数授权。

厂商预览按正式 Schema 解析实际记录；助手卡须核对真实 Conversation、Run 与该运行原 Task 的结果指针。执行后的 preview.taskId 是新建的受理任务，不强行等同于原建议任务；原任务权威结果指针仍可关联同项目已执行预览。UI 只在有限非负估值与非空币种齐全时提供远程执行确认，原记录参数默认折叠；金额零、estimate、已执行或已放弃均不充当真实结算／合法授权。受控确认前后分别重读 pending、归属与完整记录，内存快照不同、读取失败或组件离页即不发 execute；内存比较不是持久授权或真实报价协议。

Automation execute 在 executor 前要求估值／币种和 Workspace 实际项目存在，未知返回 409 COST_UNKNOWN，项目无法核对返回 409 PROJECT_UNVERIFIED；discard 不运行外部执行器。Task 状态 SQL 只关联同项目 Change／Provider，Provider 同时接受原结果的明确 ID 指针和新受理 taskId，列表中历史 result 仍是快照而非可执行参数；实际 UI 必须 GET。保持既有 API／owner／事务事件／前向迁移，不新增路由或表，不改变跨产品边界；完整费用回执、持久权利证据和发布 Gate 未因此完成。

PLAN 22.62 的小说驾驶舱从全部 owner 分页历史选取未决候选／活动运行，不先以同目标最新结束记录覆盖；返回使用 projectId／taskId／workflowId 三 ID 的实际 TaskPage 复核入口，事实记忆 Gate 同样保留指定运行。普通章节／资料工作台只读最新操作，不能充当旧运行恢复。已处理失败只在实际任务同项目／同 ID、状态失败或中断且已声明结果指针不冲突时退出主操作；没有证明仍需处理。此为只读建议与导航规则，不更改失败历史、原稿、正式采用／记忆／保存回执，不新增路由、表、持久同意或模型调用。

PLAN 22.63 的改编／直写调用方保留各自严格项目、操作、首集及当前正式基准匹配，再共用 `selectUnresolvedCreationWorkflow`：复制排序，优先 awaiting-review，其次活动阶段；无未决记录时仅返回最新 failed／interrupted，较新终态继续抑制旧失败。正式来源有效的实际采用头仍优先于候选，不拿已结束工作流制造正式成果。该 helper 不读取 peer 实现、不写状态、不合并不同基准或更换目标；原工作流链接仍由各 owner 工具核对原 request、实际候选与冻结版本。未变更契约／路由／迁移或模型调用，验收范围见 PLAN。

PLAN 22.65 的 `ProjectHomeContinueCard` 在调用 `deriveCockpit` 前，通过只读 `projectProgressReadiness` 核对 graph、tasks 与当前路径 owner evidence；非改编／直写路径另核对章节。必要读取 error 优先于旧 data 与其他 loading；无 error 但必要 data 缺失只显示整理中，实际空数组和 `{ current: null }` 不被当作缺值。失败分支不推导旧建议，只提供当前 projectId 的安全打开链接；不操作业务对象或改正式成果。基础 query 每次挂载重查，领域 evidence 沿用既有 query／事件刷新。测试只中断真实 SDK GET，不种候选或假回复；既有 Host 窗口主题 POST 与业务写入分别核对，所有隔离窗口仍隐藏且不聚焦。不新增 SSE、契约、owner、迁移或 Provider。

### 独立规划的明确来源与派生隐私（PLAN 22.67）

`NarrativePlanningRequest` 独立于小说目标，严格区分 none／selection／full 和实际表达；完整目录指纹只编码有序身份／版本／顺序／非空元数据，不复制正文。Writing 在 `writing.narrative-sources.v1` 新增 tracked 只读 planning capability，核对实际 owner 目录，再复用完整原文、精确采用章节摘要、实际段落及高层原冻结范围编译。Knowledge 规划仅调用正式只读服务，不导入 peer 实现或读写 peer 表；明确规划不附加旧记忆／规划，简报与正式作者意图（包括无头）另行冻结。

Automation 在任何上下文／任务分配前预检完整首次提示（要求、格式、引用均计入），逐引用核对纳入及值哈希；所选缺失、禁止或超预算拒绝，不静默裁剪。workflow 保存 request、逐章实际表达／排除元数据、完整 reference hashes／policyDependencies 与估算预算。检查、修订、复检和 SQLite 重试保留原 snapshot，采用再编译并核对原基准；局部未选目录增长不换源，full 指纹另核对整个目录。历史没有 basis 不补造新协议。

Writing／Knowledge 采用的资料 payload 保留不可从模型生成的原 planning basis。共享 `creationReference` 继承原引用及祖先策略依赖；Agents 通用 writing-resource 上下文候选同样继承依赖，同时保持既有字段路径和 value 形状。派生字段 always 不能绕过原章或中间摘要 never。实际失败与修正分别保留于 PLAN，不以仅创建时受保护声称所有后续引用安全。

Renderer 只用 Client SDK 读取实际目录与摘要。五个工作台无默认范围、范围与表达分别确认；读取错误优先于缓存，未确认仅禁新生成，不禁原运行查看／重试／采用操作的 Runtime 再校验。完整 request 参与草稿键、列表匹配与当前运行核对；精确 `CreationRunCard` 从指定 workflow 传回原 request，不替换为最新。source coverage 和预算只说明实际输入，不表示模型理解、文学质量、授权或结算已通过。保持十四插件，无新 SQL／路由／跨产品依赖；当前验证终态与余项以 PLAN 22.67 为准。

Client 的 `events.subscribe` 在同一个 SDK 生命周期内共享一条可重放 SSE，而非每张任务卡新开一条 HTTP 连接。订阅者独立注销，最后一个注销立即取消连接／退避；有订阅者时断开按实际 domain cursor 恢复并去重，不重置回放游标。后来加入的订阅者接收之后的帧，页面初始事实仍由各自 SDK GET 核对；全部注销后的新生命周期从 cursor 0 开始，不跨 SDK／Runtime 共享。逐帧使用订阅快照，已注销者不再收到帧，回调错误报告但不阻断其他订阅者或重启流；重启后的任务中心五候选明确采用有实际后台证据。此修复解除多卡事件流占满浏览器连接池导致普通 GET／POST 排队的实际缺陷，不改变采用权限、来源核验、幂等或业务事务。

### 认知／因果声明的限定 owner 保护（PLAN 22.68，继续实施）

Knowledge 的 graph／node／edge／audience-state／snapshot／simulation 当前通过 Workspace 正式只读服务核项目，不把未知项目投影成有效空图。edge 两端、认知目标与 character 主体在 Knowledge 写入事务内核同项目和实际节点种类；confirmed 关系不能升级未确认候选，非 unknown 认知须非空人工证据说明。`buildTwin` 仅纳入已确认声明及合法关系／认知，候选仍保留在原 graph；模拟核原 snapshot stale 和当前声明指纹，不自动换成最新快照。node／edge／认知／snapshot 增量的 owner Domain Event 只含 ID／project／version 或指纹，与业务写入及旧快照失效同事务，真实事件失败会整体回滚。

既有 confirmed 字段仍是人工声明，不是小说原文、正式记忆或因果语义的验证证据；模拟文案改为声明节点，不称权威事实。第一轮九项实际 Native 插件／SQLite 保护与类型／工程门通过；后续 PLAN 22.69 增加原 ID 的项目限定 GET、模拟元数据事件及实际回滚测试。GET 只读返回原快照／推演，并投影当前 stale，不写入、不刷新冻结图、不选择最新记录。新模拟事件只有 ID／project／snapshot／version／status，不含假设或检查正文，旧历史事件不回写。

工作台已替换原生 prompt 为页内节点／关系／认知表单，人工 confirmed 默认不勾选；错误优先于旧缓存，不把失败写成零。快照与规则推演分别明确创建，推演须先核对实际原快照；projectId／storySnapshotId／storySimulationId 进入精确 URL，历史读取和新生成分开，错配／外项目／失效不自动换源。SDK 组合使用正式 OpenAPI 通道，核同项目、原 ID、候选／节点关系与实际回执。后台实际恢复和最终工程证据以 PLAN 22.69 的终态为准。

Agents 通用上下文不再把任意 graph／provenance 自动称为 story_bible。手工图只纳入同项目、sourceType=manual 且人工 confirmed 的节点及确认关系，标注 originalTextVerified=false；默认不外发，必须在上下文预览显式选择。保留节点／关系本身的版本和禁止路径，整图 always 不能绕过子节点 never。未确认候选及 arbitrary chapter/sourceId 声明不升级为原文事实；明确五类规划等 preparedReferences 操作不顺带读取该图。

PLAN 22.70 新增 Knowledge-owned 小说来源声明协议：通过 Writing 正式只读章服务和本域 NarrativeIndex，核当前 project／chapter／version／content hash、实际段落 ID／字符范围；采用资料须额外核精确 record／version／原 applied chapter-memory workflow 和所有引文位置。新 forward-only `knowledge.0009.source-anchored-declarations` 保存不可更改的输入／证据、候选／采用状态与持久原请求回执，不补写历史资料。创建只保存 pending 候选；采用必须 If-Match、同冻结指纹和两项 explicit source／interpretation review，才在同一 UoW 创建独立节点、采用状态、请求回执及元数据 Domain Event。跨 owner 同步来源读取在写 UoW 外预检，写入内再核精确原候选；不扩展全局事务重入。handler-owned 幂等重放核原请求 hash，跨 SQLite 重启返回原操作回执，只重算当前来源状态，不换源或再次写入。

保留类型 `source-anchored-declaration-v1` 不能通过手填 node 接口创建。只读 `knowledge.story-declarations.v1` 核实际候选采用与独立节点绑定；buildTwin 在本域读取事务之后核源，不在 SQLite 事务内启动跨域读取。旧来源 stale 节点和依赖关系／认知退出新快照，旧快照原文保留且 stale；来源不可读时 503 拒绝生成缺项快照或采用候选。候选来源或采用资料变化不换成最新版本。Agents 的正式来源声明另为逐项显式引用，默认不发送，只传作者声明与非语义证明标记、原来源身份／位置／哈希，不隐式传引文或资料解释。原章、选中段落、中间资料、原工作流 references 和采用节点的 policyDependencies 保留；段落保留本协议 raw 路径、Writing 既有 encodeURIComponent 路径及旧 contentHash 禁止别名，never 优先于派生项 always，容量不足则明确拒绝而不裁掉依赖。

PLAN 22.71 为直接剧本增加 Production-owned `production.screenplay-sources.v1` 正式只读服务及项目限定的 screenplay-sources list／get：读实际本域 script／已保存 screenplay_documents，不调用会初始化文档的 screenplays.get，不重新 parse Fountain、导出替换文本或 mint ID。实际块重复／损坏／外项目、文档缺失与采用回执缺证据都 fail closed。contentHash 绑定 document／script／project／version／title／format 和已保存 blocks_json／loss_report_json 字节；公开快照保留已保存块，sourceLocation 只表示原保存字段，不保证编辑后原文件位置。list 是实际剧本 keyset 元数据页，get 才核完整来源与上游回执；不会读取最新代替原 ID。

Knowledge 的新增 screenplay-blocks 选择绑定精确 script ID／version、document ID／version／contentHash 和明确 blockIds；仅所选有字块按实际顺序冻结 quote、block ID／index／type／已存 location，与小说字符段落锚点不可混用。来源声明沿用原 pending／双重审阅／If-Match／持久原键及同域事件事务，不修改 0009 历史 SQL。Production 只从自己真实 production_creation_adoptions／episode_results 查关联，并在本域读取事务外核 Automation applied workflow，保留真实 referenceVersions 与正式 basis 上游禁止路径；复制 payload/sourceWorkflowId 没有实际采用绑定时 unavailable。此依赖保留是隐私继承，不宣称上游叙事仍 current 或语义已验证；历史版本冲突或超过完整依赖容量也拒绝，不裁掉禁止依赖。原剧本记录、正文路径、文档、所选块 ID 与实际索引别名保留，任一原源 never 阻断声明 always。Renderer 只经 SDK 读取，直接剧本不要求小说；实际源变后原证据保留，失效节点退出新快照，旧快照和原请求重放不换源。新只读源、声明和图错误显式返回 RFC 7807 媒体类型及 traceId。关系／认知自己的来源表达续见 PLAN 22.72；完整语义／规则覆盖仍继续，不算整个 A05.2 完成，各阶段工程与后台终态只按 PLAN 实际记录判定。

PLAN 22.72 增加独立 Knowledge-owned 关系／认知来源声明，复用同本域的精确原文编译器而不改变 0009 已应用 SQL。新 forward-only `knowledge.0010.source-anchored-assertions` 保存 immutable input／basis、pending／adopted／discarded、精确 edge 或 cognition 绑定与 handler-owned 持久原动作回执。输入声明实际节点 ID／version、作者解释、明示或推断类型；关系置信是作者估计，认知顺序是作者声明，均非校准／语义证明。创建核同项目、已确认、精确版本和角色类型，保留完整节点快照；任意来源标记与无实际采用绑定的复制节点不能成为正式源。写入采用在预检完跨 owner 读取后同步进入 UoW，再核原候选和端点快照，独立记录／采用状态／回执／元数据 Domain Event 同事务；不创建多余节点、不写原稿或调用模型。

正式只读 `knowledge.story-assertions.v1` 核真实采用记录字段与 frozen input 的精确绑定，并核关系／认知自己原文及全部端点来源。buildTwin 对实际边／认知调用该服务：自身来源变化也退出新快照，不要求端点先变；旧 graph／snapshot 历史保留，旧快照不可新推演。`knowledge.story-declarations.v1.nodeReference` 只返回原节点精确采用的脱正文引用和全部 policyDependencies，供关系／认知继承原章、段落、采用资料／工作流及原声明禁止路径。新断言再加自己的来源与实际 edge／cognition 禁发路径，容量或版本冲突拒绝而不裁剪。Agents 默认 never，显式项只包含作者输入和原身份／锚点／hash；正式来源关系不进入手工图投影，防止整图 always 绕过上游 never。来源读取不可用时以本插件的 typed error 在上下文分配前拒绝，返回 RFC 7807 503，不导入 peer implementation 错误类。

Renderer 关系／认知工作台仅经正式 SDK；小说与保存剧本块各自可选，来源／端点／解释类型不默认选中。原 project／storyAssertion ID、双重审阅、只读历史 keyset、源读取错误覆盖旧缓存和持久原键分别处理，不自动换到最新、采用或新建 Twin。节点来源 GET 与图读取仍保留原语义。Runtime Route Registry 的 declarative validation hook 返回 RFC 7807，原校验失败不得执行 owner handler，也不暴露原输入或 Zod payload。当前工程及后台证据以 PLAN 22.72 的终态分阶段记录，语义质量、规则覆盖及整个 A05 父任务不由此自动完成。

PLAN 22.73 将新 Twin 的结构提示定位到同一原冻结 node／edge／cognition ID／version，新增可选 ruleAnalysis，不改历史 JSON／迁移、不在 GET 升级旧规则。Knowledge 纯规则只收已经 owner 核实、确认且来源当前的图；depends_on 的前置方向是终点→起点，causes／enables 为起点→终点，reveals 只揭示终点。迭代强连通分量保留全部实际循环见证，认知下降／缺入向揭示／作者已声明冲突仅供 review，不理解作者证据或证明语义、揭示时点／文学质量。SDK 核实际覆盖、每个冻结位置／版本和兼容文本，Renderer 只展示原冻结记录、范围和人工建议，没有自动通过／忽略／改稿／采用入口。重复手工关系／认知与来源采用在原本域 UoW 先核 UNIQUE 占用，409 保留记录／候选／快照／事件／回执；不放宽原唯一限制或自动撤回旧声明。

PLAN 22.74 的全局待确认通过正式 SDK 的 storyDeclarations／storyAssertions 项目元数据列表接入独立作者候选，不依赖 Creation workflow。节点 owner 不再丢弃已有 Summary contract 的 adoptedNode ID／version；两种 SDK 分页均核 status 与实际采用指针的一致性，关系／认知另核 edge／cognition 类型。聚合每页 100、完整读实际游标，并核全扫描跨页身份唯一性、项目归属与末项游标；缺能力、后页或身份失败丢弃整个受影响来源、明确 unavailable，不保留早页冒充完整结果，不截断项目目录。其余完整领域仍可展示，计数未核全。

pending/current 为 waiting，pending/stale 或 unavailable 为 attention；已采用实际绑定只有来源失效才复核，current/adopted 与 discarded 不重复待采用。精确链接保留 projectId／storyDeclarationId 或 storyAssertionId，原 owner 页面重新独立核对；聚合只请求元数据列表、不请求 get 冻结正文，不写任何领域、授权或恢复人工勾选。owner 列表仍通过正式只读依赖在本地核来源状态，不宣称完全没有原文读取；Renderer 不显示 raw reasons 或正文。Knowledge 元数据事件合并刷新沿用既有订阅，不增加 SSE 连接。React Query 顶层项目读取失败优先于 retained cache，隐藏全部旧对象入口并保留原链接项目的未核对 option，retry:false、显式刷新后才用新证据；部分来源失败是带 unavailable 的成功读模型，不能误成空列表。无新路由、表、migration、插件或跨产品依赖；工程与固定后台终态按 PLAN 分阶段记录，不扩大为整个 A04 或 A05 完成。

Renderer/Runtime 公共接口只处理 `FileGrantId`、`DirectoryGrantId`、`ArtifactRef` 与 `credentialRef`。Provider/Extension 网络经过 DNS 固定、IP 分类、redirect 重验、跨源去凭据、大小、类型与 timeout 策略。日志和 diagnostics 递归去除 Authorization、secret、prompt 和绝对路径。

PLAN 22.75 增加 Knowledge-owned `knowledge.0011.source-lifecycle` 前向迁移，0009／0010 的原 status、version、frozen input／basis、采用绑定和请求回执不改。三类实际图记录另有 retired_at，退役只增加实际记录版本而不删除 ID／解释或重连节点引用；关系／认知表前向重建保存全部原列和记录，以 active-only partial UNIQUE 核位置，退役位置可由明确新采用记录占用，但其它当前占用仍冲突。`knowledge_story_source_transitions` 保存有实际声明 FK 的不可更新本域历史、原实际图记录字节、理由、退役版本和明确 replacement ID；无 GET 回填、无修改旧迁移或旧 frozen Twin。原记录 GET 在历史采用事实之外投影 active／withdrawn／replaced 独立版本和完整决定历史，元数据列表仅含 lifecycle 身份／状态／版本／替换 ID，不含理由、图正文或引文。

四条 withdraw／replace 路由继续 `/api/v2`、RFC 7807、If-Match 与 handler-owned 原键重放。跨 owner 同步新来源预检在写 UoW 外完成；同域事务再次核原声明、生命周期、真实原图字段／版本、指定候选及实际节点快照。撤回可处理 stale／unavailable 原来源，但不能覆盖变动／缺失／错绑定的实际记录；替换必须同项目同类型 pending／current 新候选及双重独立审阅，原记录退役、新实际 ID／正式采用、immutable 决定历史、原动作回执与两个 metadata Domain Event 同一事务。写入三张图表使用静态 owner SQL，不放宽动态 SQL 保护；事件失败或竞争位置 409 全部回滚。原已撤回记录仅能明确替换，已替换的原记录终止，不能回滚激活；指定新记录继续自己的生命周期。旧 adopt／discard／withdraw／replace 原键重放不再次写入，只投影当前真实头，动作历史供 SDK 核对本次决定，不用原采用回执冒充当前生效。

raw graph／package graph／new Twin／manual create 的节点、关系、认知选择先过滤 retired，关联节点也须生效；正式服务在核来源前拒绝退役记录，保留原绑定以防无绑定 manual 兼容降级。原图引用、已保存 snapshot／rule 及原稿不改写，原快照 GET 只读核指纹 stale。新声明沿用完整自己的源／端点／采用回执／实际记录 policyDependencies，默认 never，派生 always 不绕过上游 never；不能拿旧绑定换名或去绑定后手工外发。Renderer 只用正式 SDK，精确旧／新 ID、理由与三项确认无默认，重启／刷新不恢复审阅，新候选读取错误优先旧缓存。全局待确认忽略退役历史而仍核新的生效或 pending 记录。当前正常完整 Runtime 522／App 386／Main 66、同构建指定十一文件后台 38 项和 detached Node HMR 已终态通过，分开结果与历史失败以 PLAN 22.75 为准，不扩大为语义索引或整个 A05 完成。

PLAN 22.76 / A05.3.1 新增 Production-owned `production.quality-sources.v1` tracked 只读服务和 GET `projects/{projectId}/production-quality-sources[/{recordId}]`；无新表／迁移／插件。普通已保存 script 和无 parent 的独立 scene 不依赖小说、已采用意图、季纲或媒体；有父级时核真实同项目 script→episode→adaptation 链。详情保留实际 ProductionRecord、原行／payload 字节 hash、原保存文档／稳定块／位置／损失报告；场景不复制父正文，仅保留真实父记录及保存文档 metadata／hash，父文档即使同版本字节变化也改变来源指纹。缺失、损坏、错误父级或未知禁止链如实 unavailable，不调用编辑器初始化 GET、同步／重解析、修复或 ID 分配。列表完整 keyset 元数据无正文，SDK 核实际项目／ID／kind／domain／版本／父级／保存文档与页游标，无补最新或写入。

本域实际 materialization／revision 回执、formal result 绑定和 applied workflow／项目在同步 UoW 退出后核对；实际 sourceSnapshot 中每条所需来源唯一纳入，正式 basis hash 必须匹配，并继承其全部 policyDependencies。复制 workflow／result 标签不获得绑定；完整实际父级、转义嵌套 payload、保存块 ID／索引／文本别名均保留禁止身份，不能只用扁平 workflow.referenceVersions 绕过中间拒绝。当前 2000 依赖上限超出时失败关闭、不截断。该服务不更改旧 policy 默认、不自动向模型附加来源。A05.3.1 限定完成，当时未扩大 NarrativeQualityTarget 原五类；该阶段正常完整 Runtime 528／App 389／Main 66、八文件后台 17 项及 detached Node HMR 终态通过。随后报告接入另记 PLAN 22.77，不补算历史终态，真实来源可读不是叙事语义或整个 A05 完成。

PLAN 22.77 / A05.3.2 接入 script／scene 两类明确质量 target，必须绑定实际 sourceFingerprint；原五类不补指纹，episode-result 显式分支，未知目标不回退。Creative Quality 只读 Production 正式服务，完整分页目录不含正文，冻结输入仅保存文档（保留原块身份／位置／损失报告）或三个真实场景文本字段，无父正文／旧 serialized script；完整 policyDependencies 不裁剪。productionSourceBasis 元数据核项目、目标／版本／指纹、原记录／保存文档 hash、块 ID／类型／顺序与真实父级 metadata；不得伪造 chapter coverage。报告引文限真实规范块 text 或场景动作／对白与备注／地点与时间，模型必须声明实际目标表达，不引用 ID／标题／损失报告。Automation 仍先完整首提示预检再分配，不改稿；原头读取、聚合和 SDK／App 判等均核指纹，同版本源变保留原报告为 stale，不让新无问题报告绕过旧错误。工作台元数据只读、原 ID 返回，读取错误优先于旧缓存并重用现有 SSE；无新表、迁移、插件或跨产品依赖。定向、正常完整 Runtime 536／App 393／Main 66、同构建九文件后台 18 项与 detached Node HMR 分别终态通过，限定完成普通保存报告入口；对应正式包的新报告证据／错误门另按 A05.4 接续，不当作父 A05、真实模型质量或 GA。

PLAN 22.78 / A05.4 的 Delivery-owned 只读门经公开 Production quality-source 服务核实际包内 scriptId／scene binding、文档版本／全部原块及顺序、场景动作／映射与正式强类型包一致，字段对象键顺序不作为语义差异，数组顺序和原稳定身份不忽略。已采用保存稿件评议以实际指纹补充原三个正式 episode-result，全部有效旧错误与精确人工决定由 Creative Quality owner 聚合；新无问题头不能清除旧错误，局部清洁报告不补整包覆盖。没有相关新报告不加入空评议改变历史 sourceFingerprint；来源缺失／不同失败关闭，旧 files／manifest／receipt 保持原冻结历史。导出只加目标／报告／问题身份、维度和计数，不附新源／父正文、质量引文或风险说明。SDK 单次原身份请求、App scope 清确认／失败禁保存／同记录刷新与分列指纹接入；无新表／迁移／插件、跨写或跨产品依赖。五项实际 Runtime、SDK／App、末版构建／工程、正常完整 Runtime 539／App 396／Main 66、同构建十文件后台 27 项与 detached Node HMR 各自终态通过，限定质量门完成，不倒算第 22.77 节证据或声明语义质量／GA。独立单集重选表达属于后续 A06.1，精确影响／局部重做仍另验收。

PLAN 22.79 / A06.1 新 episodeNarrativeContext 与 inheritSeasonNarrative／direct 互斥；Production 复用 Writing 公开只读编译，完整原季纲范围内精确选择且覆盖所有本集映射。sourceBasis 保留 omitted，contextChapters 只计实际覆盖；同时重核原整季表达，将其完整源／中间资料及新表达的禁止依赖附到正式约束，不在 Prompt 默认补入旧表达值。下游须继承正式单集大纲原选择；sourceReasons 重新编译独立表达及版本，原季纲 current 门仍保留。目录 scope、SDK 项目／范围／唯一身份／历史原 ID、UI 改选清确认及错误优先缓存与新模式交付元数据同步，不新建表／迁移／插件或跨产品依赖。三项新增实际 Kernel、SDK／契约七项与普通完整 Runtime 542／App 400／Main 66 通过；原固定后台 28 通过／1 异步断言等待失败、说明修正后十三项相关后台与隔离 Node HMR 另行全通过，分开记录且不更新视觉基线。该子项限定 done，精确影响／结构性局部重做另验收，下一 A06.2.1 为精确影响 SDK 和错误优先缓存边界。

诊断包含 Core/Extension graph revision、active/in-flight router、effect owner、migration、consumer、Host/Engine/Extension generation、restart budget、pending、Run recovery 和 trace。架构 Catalog 从真实注册源生成，不是第二套手写配置。

### 生成费用观察边界（PLAN 22.97，限定范围已验收）

Insights 的 0005 前向迁移独立保存 generation record 原身份／递增 sequence／严格观察 JSON／绑定 SHA，不修改历史 SQL。配置单次估价、手工声明、旧未认证及未报告来源与计量范围分别保存，所有 billingStatus 都为 unknown；SHA 只保护本地内容绑定，不认证账单。记录／观察／持久事件同事务，读／补录前核对全部历史序号和指纹；旧数据库升级不补历史观察或默认币种，首次显式新声明前保留原旧金额。只读 GET 绑定原项目和原记录、严格分页且无模型调用，UI 用 SDK 并按原身份隔离，重新展开明确 fresh 读取，失败不继续展示缓存。

Media 图片归档传配置单次估价而非 actualCost，不乘候选数量或声明本次总费用。视频 preflight 把费用单位纳入快照，金额或单位未知仍须明确确认，batch 逐项保留而不生成混合总数；界面不补零／USD、不把小金额舍入成零。当前 14 owner 插件／692 effective operations，新 API 由官方生成器更新，产品间依赖不变。正常完整 Runtime 640／App 447／Main 66、同构建后台 42 项、随后隔离恢复及最终静态门均终态通过；后续源码另行验收，不据本节认证真实结算、模型或文学质量。

### 配置恢复与独立策略事实（PLAN 22.98–22.99，限定范围已验收）

Agents 配置恢复计时器使用 native tracked effect，停用清 timer 并等待已受理 reconcile；健康与配置恢复 await 后复检停止，不启动新恢复回调。运行恢复捕获原 UOW，已受理 recoverRun 在原资源收尾，停止后不处理下一运行；这不是远端 Provider 取消证明。四项真实原生 Fiber 延迟与当前正常完整 Runtime 645／App 447／Main 66 验收通过，后台批次与视觉差异修正分列见 PLAN。

Automation 记录新独立策略请求和候选的完整内容／原选项指纹；Production 在真实单选采用同事务发出独立最小成果事实，保留原通用事件与回执。Insights 只读自己投影的权威事件，第五 metric 独立核对原候选与显式选项，标注 selected-option，不冒充整包采用；旧策略 hash 和 SQL 不改，不补造历史分母、可信模型分类或文学质量。严格 schema／错误 envelope、原采用／幂等、SQLite 重启与正常完整通过。固定后台 41 通过／1 视觉差异，核对后仅更新两张明暗基线，另行普通十项视觉比较通过；随后隔离 HMR 和最终静态门通过，不合为一次固定 42 项全通过。HMR 恢复核对原 headless Host 的 503 状态与已完成 router 发布，不虚构 200；vendor／产品 Runtime 未因测试断言改变。仍十四 owner 插件，产品构建边界不变；下一 Knowledge 实际记忆写入事实与其余本地范围另行实现验收。

### 章节记忆实际写入事实（PLAN 22.100，限定范围已验收）

Knowledge 在派生记忆的原 UOW 中保存新记录、自己的 record／workflow 回执和 knowledge.chapter-memory-written.v1，事件仅有原章节身份／版本／内容 SHA、实际新记录身份／类型／初始版本／canonical 内容 SHA，所有标题、正文和证据引文留在 owner。Insights 第九类 written／rule 投影按实际版本集合去重、校验 creation envelope，不写 peer 表、不改历史迁移或补算旧资料。自动同步仍需真实已采用父章节链，独立 memory 候选仍需明确审阅；事实不认证触发方式或当前语义有效性，也不进入章节人工采用／首候选分母。SDK／UI 原项目只读、区分实际记录版本和正式采用，故障回滚／历史／重启已验；本版正常完整 Runtime 647／App 448／Main 66、同构建十二文件后台 42/42、随后隔离 HMR 及最终工程门均终态通过。两张 macOS Insights 视觉差异核对后先单独更新，再普通批次比较，不改 Windows；准确来源冲突与其他本地范围未由本项完成。

### 普通采用的来源差异事实（PLAN 22.102，限定范围已验收）

CreationSourceConflictError 只携带实际原／当前来源 UUID 和整数版本的差异，不解析 Error 文案或将无法读取归为变化。Writing 普通章节目标先核自己真实当前版本；共享正式意图／引用核对可提供准确 typed 差异。Automation 只接受本域原请求和唯一原候选回执及冻结 kind／身份／版本匹配，将 automation.creative-source-conflict.v1 同拒绝工作流／任务状态一起提交；人工 Preview 文本不替换原候选指纹。Insights 从既有本域投影校验先前请求／候选、owner envelope 与原项目，去重候选数和普通采用拒绝次数分列，最近来源证据无正文，失败隐藏旧缓存；没有新 SQL、历史回填或外发遥测。实际版本变化、意图身份替换、事件失败回滚／缺源排除和 SQLite 重启已验；本版正常完整 Runtime 650／App 449／Main 66、同 build1 十二文件后台 42/42、其后 detached Node HMR 208 ESM／79 本地依赖及最终工程门全部终态通过，四张 Insights 视觉基线未改。专用 Production 拒绝另见 22.104、全书集合另见 22.106；未覆盖来源及完整来源冲突率仍未完成。

### 专用正式采用拒绝的 owner 事实（PLAN 22.104，限定范围已验收）

Production 的 diagnosis／adaptation-strategy／season-plan 在真实 pending → conflicted 的 UOW 中同状态、幂等请求和原通用事件保存 production.creative-adoption-rejected.v1。最小契约包含原项目／工作流／候选 canonical SHA、策略完整选项 SHA、Production aggregateType 与决定 stateVersion；不伪造 Automation workflowVersion／request 时间／targetKey，不混用正式 content version。公开服务在事务之外核对正式意图、所选章节和正式诊断／策略引用；只将已实际读到的身份或整数版本差异列为 sourceConflict，缺源、竞争目标头及其他未知拒绝保留为通用事实，HTTP 409 本身不作为证据。

Insights 使用既有本域事件表保存不可变 owner 决定；原 aggregateType／candidate ID／stateVersion 的决定身份跨项目／工作流不可迁移，重复不增加次数或更新时间。同域原 request／candidate、完整选项 SHA 和先前 cursor 匹配后才进入五类漏斗；旧历史或人工重排可以保留 owner 事实，不补分母。迟到投影不更新旧工作流或正式头，通用拒绝与来源冲突候选去重分列；SDK／UI 只读原候选和 owner 决定版本，读取失败不显示旧缓存。无新 SQL、历史迁移改写、跨产品依赖、peer 写表、模型调用或外发遥测。真实三个路径的故障回滚／同键重放／源变化／缺源、竞争头排除、原策略选项与 SQLite 恢复，以及当前正常完整 Runtime 653／App 450／Main 66、同 build3 十二文件后台 42/42、其后 detached Node HMR 209 ESM／79 本地依赖和最终门均已终态通过，四张 Insights 基线未改。22.105 的全书集合差异及父 A07／MET-01、其他自主范围继续，不借本项证明完整冲突率或文学质量。

### 全书非空章节集合拒绝凭证（PLAN 22.106，限定范围已验收）

CreativeOwnerSourceConflict 独立于普通 CreationSourceConflict；专用 owner 可以保留真实版本差异及可选完整全书集合增减，至少一个真实差异必需。Collection 只含 whole-book／nonempty-chapters／Writing 完整目录声明和去重原／当前 UUID，原集合限有效冻结范围，当前空集合不补缺失对象版本；相同集合或仅顺序、未知完整性、跨项目／重复身份、私有附加字段拒绝。三个 Production sourceReview 在原 UOW 之外读公开 Writing list，版本核对使用未过滤的完整目录，再按正式确认的非空资格核对集合；源读取失败不推断删除，空正文退出范围不等于物理删除。原候选／完整选项、owner 决定不可变、事件／状态／幂等原事务和本域只读投影不变；没有新 SQL、peer 表写入、外发分析或正文读取入口。21 项投影／边界、10 项 SDK、三个真实路径新增／删除／空正文／选章反例、回滚／原键重放及 SQLite 恢复已验；本版正常完整 Runtime 658／App 451／Main 66、同 build1 十二文件后台 43/43、随后 detached Node HMR 209 ESM／79 本地依赖及最终工程门均终态通过，四张 Insights 基线未改，不借 22.104 或称完整来源冲突率。报告历史关联按 22.107 继续，不证明文学质量或整个父任务完成。

### 质量报告采用与历史成果关联（PLAN 22.108，限定范围已验收）

Creative Quality 在实际 report awaiting-review→adopted、version＋1 和正式 head 原 UOW 追加 narrative-report-adopted.v1；最小严格凭证仅保留原项目／workflow／report UUID、采用时报告版本、实际目标 kind／ID／版本／普通目标明确指纹、原请求维度及可选明确跨章覆盖。报告正文、标题、引文、建议、模型名、Prompt、路径及人工私有 note 不外发到事件或台账。固定模型来源未知、qualityState=unverified、currentValidity=unknown；请求维度不是已评质量证明，报告采用和人工风险决定不当文学质量。跨章保留原 full／selection、目录／非空项数与原文／摘要／段落／高层摘要表达，不把摘要升级原文或缺历史升级完整范围。

新前向 insights.0006.quality-associations 只归 Insights 所有，投影原报告采用身份／目标索引；原 report ID／项目／workflow／采用版本与回执不可替换，重复新事件保留第一次时间与 cursor。它只联接 Insights 自己已有的成果事件／单位，优先自己的首次成果回执；正式 typed kind、ID 和整数版本精确相等才关联 chapter／diagnosis／season-plan／实际 episode-result，跨章仅范围成员。普通 script／scene 保存身份／复合 hash 与单集成果不同，保留未关联，不扫描 peer 表、比较不同 hash 口径或补造旧成果分母。报告与关联成果单位分别去重，摘要最多最近 20 份并校验实际已见记录与累计数；UI 只经 SDK 读取，错误隐藏旧缓存，旧报告源变或人工决定只保留历史，不更新原采用版本或断言当前有效。

真实报告来源／头竞争继续旧冲突语义；本域 UOW 提交异常转为合同 NarrativeQualityCommitError，Automation 原 apply 不吞为来源冲突、不修改原工作流／Preview 状态，HTTP 安全 500 后可重试原操作。未扩大为其他采用路径的全部事务恢复。25 项投影、11 项 SDK、五项真实 Kernel 含不同目标／原表达／投影回滚／owner 事件故障、原键随后采用／重放、源变／人工风险／SQLite 恢复已验；同 build1 后台原报告台账、重启和读取失败保护已通过，真实固定批次截图另行核对。本版正常完整 Runtime 664／App 452／Main 66、同 build1 十二文件后台 43/43、随后 211 ESM／79 依赖隔离 HMR 与最终工程门均终态通过，四张基线未改，OpenAPI cc7f8896c38616aac17814a093a42f83c4f6fb9a47f2451355d15c73c3d0cd6e；各轮失败及限定边界见 PLAN，不借 22.106 或声称父任务／文学质量完成。

### 创建／派生原子回执（PLAN 22.110，限定范围已验收）

Workspace 前向 workspace.0009.project-creation-receipts 为自己持有的旧回执表追加可空 operation／request_hash，旧 SQL 与未知行不改、不回填。HTTP projects.create／commitDerivation 明确 required／handler 重放，原解析输入或 sourceId／previewId 的稳定 digest 与操作同 owner UOW 核对；项目、初始化记录／事件、派生关联／原预览删除和回执在一个事务，初始化查询复用 tx。内部 createIdempotent 已有原子性继续保留，原 requestInput 与新持久操作绑定不混入 HTTP；旧无原预览派生拒绝重新创建。旧新建快照仅核实际写入字段并以 legacy-project-snapshot 返回，旧内部原输入按稳定字段顺序核对，不将原快照或首次重试冒充目标确认事实。私有 requestInput／digest 不进入事件指标或 Renderer 实现依赖。

五项实际 Kernel 的回执故障／事件全回滚、同键重试、输入／操作／来源／预览错配、SQLite 重启和真实旧数据库前向升级已验，旧时间／身份／数据保持；本版正常完整 Runtime 669／App 452／Main 66、同 build2 十二文件后台 43/43、随后 212 ESM／79 依赖隔离 HMR 与最终门均终态通过，四张基线未改，OpenAPI cc7f8896c38616aac17814a093a42f83c4f6fb9a47f2451355d15c73c3d0cd6e。初始三项红测与限定边界见 PLAN，不借质量关联前版结果或称全部漏斗完成，明确目标与可靠来源按 22.111 接续。

PLAN 22.112 初始明确目标按限定范围 done：ProjectInput 可选严格 goalConfirmation，Workspace 实际新项目 v0 与最小 workspace.creation-goal-confirmed.v1 事实同原 UOW；PATCH／错配模式／原键加字段与内部非法字段拒绝。Insights 新前向 insights.0007.initial-goals 只保存自己的首次历史投影，摘要按准确项目分列原目标，不进入九类成果分母；SDK 严格读和 UI 错误优先隐藏缓存。真实目标按钮才保存确认，普通请求发送前冻结原输入／原键，失回复和 SQLite 重启不根据新表单重拼；默认／高级／旧输入不推断，旧未知请求不补冻／换键。Native 渲染无效输入不抛异常且禁用创建，实际写边界继续严格拒绝。

本版正常完整 Runtime 674／43 文件、App 457／80、Main 66／14 与迁移 Worker／全部 conformance 通过，同 build3 十三文件后台 45/45／零 skip 或 flaky，随后 214 ESM／79 依赖隔离 HMR 和最终门均终态通过，四张基线未改，OpenAPI 3294ac3d3090decaf4521bd74bc51a1ac76863420fd6b9e381a37ee99f2b6f51。失败、中止与恢复图片仅标题的边界见 PLAN，不借 22.110 或旧构建。事实只描述原明确请求，模型来源 unknown、质量 unverified，不证明作者身份、当前意图或版权许可；按 22.113 继续普通导入持久批次恢复，不将父指标任务改 done。

### 普通导入原请求与内容批次恢复（PLAN 22.114，限定范围已验收）

Writing 前向 writing.0006.ordinary-import-batches 与 Production 前向 production.0013.ordinary-import-batches 各自持有内容、原事件和不可变完整批次回执；公开 importBatch 校验准确 project／import 与稳定原输入，同域全回滚／同键返回原 ID。Workspace 前向 workspace.0010.ordinary-import-commits 在 peer 调用前持久冻结原输入／目标版本，peer 在自己 UOW 外部执行，最后 Workspace 的 extraction／原泛化事件／最终回执／预览删除及实际剧本当前头同本域事务。失败保留原批次，不补偿删除或刷新历史版本；成功重放不重复写入，旧无动作键的新请求成功后重复仍 404。

GET sourceImports.getCommit 只核原 project／key／input，不自动 POST；绑定预览不可删除。SDK 只经公开 client；两普通 UI 在发送前可靠本机保存原请求／键，损坏或未知输入保留且拒绝换键，未提交恢复取消旧声明勾选，原冻结声明不是新授权。新摘要按原 sourceKey 顺序绑定实际 chapter ID／v0，采用前预检全部选源；旧无 ID 只允许唯一同名／同版本。原项目 CAS 拒绝覆盖后来选择，不承诺所有抽取采用原子化。

本版 normal-full2 全命令终态 0（Runtime 679／43、App 465／82、Main 66／14、真实 Node migration worker／全部 conformance），同业务 build5 十三文件后台 46/46，完整重跑期间 218 ESM／79 依赖隔离 HMR 和最终连续门均通过，四张基线未改。OpenAPI 9aef9189ef940000fa61ff89a1478d8f060f302c4fed25b00dd7125e4a72084e，14 owner／693 operations；工程数量不代表完成率。首轮真实重复红测、各定向失败和 full1 旧迁移夹具漏依赖修正分列见 PLAN，旧 SQL／无回执不补造。最小来源确认随后，不认证版权、完整全文或语义质量，也不将父指标任务改 done。

### 原确认来源不可变历史（PLAN 22.115，限定范围已验收）

Workspace 普通导入与 Production 创建前 Native intake 在各自首次最终 UOW 追加严格 creation-source-confirmed.v1，最终事件失败回滚本域状态，已写原内容批次／materialized 回执保持供原键恢复。历史 committed 成功重放不补事实；普通 preview 无版本列，不补 sourceVersion。原解析条目顺序、完整实际 owner ID／历史版本、Native 原 previewEntry／document／script 绑定与脱敏 binding／receipt SHA 留本机，无文件名、正文、可编辑 sourceKey、grant、路径或动作键。

Insights 前向 insights.0008.source-confirmations 仅持有自己的不可变首次事件／游标／时刻／项目投影；公共 Workspace includeDeleted 查询允许可恢复回收站期间延迟重放，物理 purge 后不分配。当前摘要 API 仍 active-only，严格项目作用域、完整历史总量／最近 20 条／每次前 5 原绑定和 SDK／只读 UI，不影响原成果／漏斗／七天分母。版权 declared-not-verified、模型 unknown、质量 unverified、当前有效性 not-assessed；确认解析范围不等于整个文件或无损／许可认证。

本版 normal-full1 全命令终态 0（Runtime 687／43、App 469／83、Main 66／14、真实 Node migration worker／全部 conformance），同业务 build1 十三文件后台 46/46；二者期间 220 ESM／79 依赖 detached HMR 和最终门均终态通过，四张视觉基线未改。OpenAPI 18d9191c67360ed709f714591b465a4eee26bd3390e32af22a4586e24e084d79，14 owner／693 operations。定向故障、测试修正和本轮恢复图仅标题的限制见 PLAN，不借其他轮图片；A07.9 核对其他历史指标的可恢复软删除，不将父任务改 done。

## 发布边界

当前 A07.9 按 PLAN 22.116 限定 done：六条真实 owner 历史在回收站延迟重启恢复原行，restore 不改原计量，物理 purge 与第二次重启不复活；Production 0014 前向修复三类请求 FK，旧原键／哈希／响应保留，不让 Workspace 写 peer 表。normal-full1 全命令完成（Runtime 689／43、App 469／83、Main 66／14、真实迁移 Worker／全部 conformance），同业务 build1 十三文件后台 46/46；二者期间 221 ESM 隔离 HMR／最终门通过，四张基线未改。原失败、时序和恢复截图仅标题的限制留证，不更改原分母／API 回收站边界。接续 A07.6.4，父任务与原 22/40＝55% 不变。

当前 A07.6.4 按 PLAN 22.117 限定 done：仅从原明确章摘要／段落／高层摘要覆盖核实际章节身份版本，准确 typed 冲突与原候选同事务；故障全回滚、重复拒绝单事实、未选改稿／范围外增长零冲突、缺失未知及两次 SQLite 恢复已验，不换源／正文或额外调用模型。normal-full1 全命令终态 0（Runtime 689／43、App 469／83、Main 66／14、真实迁移 Worker／全部 conformance），同业务 build1 十三文件后台 47/47；二者期间 221 ESM 隔离 HMR／最终门通过，四张基线未改。当前固定新增来源冲突 original／restored 图均完整，focus1 空白与原失败独立保留。接续已选摘要自己的记录／采用头 A07.6.5，父任务和原 22/40＝55% 不变。

当前 A07.6.5 按 PLAN 22.118 限定 done：章摘要自己真实 PATCH 版本、高层原采用头被明确新 adopted ID 替换，经 Knowledge 公共 owner 只读元数据核对；原章不变也记录准确 knowledge 冲突，故障整事务回滚、同候选去重、原内容／候选和 SQLite 恢复已验。缺源／同版本失信不造已知变化，未选改稿正常采用，新候选未采用不换头。normal-full1 全命令终态 0（Runtime 691／43、App 469／83、Main 66／14、真实 Worker／全部 conformance），同业务 build1 十三文件后台 48/48；二者期间 221 ESM HMR／全部最终工程门通过，四张基线未改。focus1／fixed1 的 restored 图空白限制独立保留，以各自真实 DOM／API 证明恢复，不认证语义或模型。接续独立故事规划完整批次／原请求 A07.10，父任务与原 22/40＝55% 不变。

A07.10 已按 PLAN 22.119 的完整规划批次／原请求范围 done：五类独立规划由真实 owner 事务保存原候选与完整实际记录，独立新请求不吞并、多记录不计多批、旧无回执不补首轮。normal-full3 全命令终态 0（Runtime 699／44、App 473／84、Main 66／14、真实 Migration Worker／全部 conformance），同业务最终 build3 十三文件 fixed2 48/48，skip／flaky／全局错误为零；先行 225 ESM HMR／相关工程门与最终静态门通过，四张基线未改。focus5 双图完整；fixed2 自己的 original 图完整而 restored 图空白，恢复只据本轮 DOM／API，图像限制及此前失败／中断独立保留，不倒推启动关闭根因。模型未知、质量未验证；接续 A07.6.6，父范围与原 22/40＝55% 不变。

A07.6.6 已按 PLAN 22.120 的五类规划准确来源冲突范围 done：原已选章／章摘要版本和高层 adopted head 由公共 owner 在重编译前核对，绑定原请求／候选及真实拒绝事务；缺失／同版本不合资格和旧无绑定不补造。normal-full1 全命令终态 0（Runtime 704／44、App 475／84、Main 66／14、真实 Worker／全部 conformance），同业务 build1 十三文件 fixed1 48/48，skip／flaky／全局错误为零；先行 225 ESM HMR、相关工程门及类型通过，四旧基线未改。自己的原冲突图完整，focus1 恢复冲突图及 fixed1 两恢复图空白，仅据各自 DOM／API 证明恢复；红测／类型失败和图像限制保留。OpenAPI 为本版 eccca3f638fff333cc43918ea755e3e57484066abc46f666d57f6f84dc7945f9；接续 22.121 场景拓扑整组，可信分类／质量与其余父范围未完成，原 22/40＝55% 不变。

Level 3 首版已实现并进入 conformance；仍明确属于未来的能力只有：

- 任意第三方 React/Vue 或网页代码；
- isolated interactive UI 容器；
- 远程 Marketplace 发布者后台；
- 多 Runtime SQLite consumer lease；
- 未通过 macOS、Windows、Linux 候选包签名/升级/卸载验证的正式 GA 声明。

本地质量门除原有门禁外增加：

```text
test:extension-host-conformance
test:extension-security
test:marketplace
check:extension-packages
check:renderer-chunks
```

M1 已按原退出条件完成（2026-10-06，第 22.132 节）：原7/7项，三入口 fresh-profile／正式阶段接续／唯一下一步／当前父级继承／统一待确认／旧路由与精确返回已验。M1收口版后台20/20、8文件、15.5分钟，零skip/retry/unexpected/flaky/global errors且不更新快照；16项实际Runtime费用门、App589/106、33类型与工程／root17门分别通过，不能拼成同一命令。无任务费用与试制包权利确认只表达实际状态，未知账单／合法授权／文学质量不标通过。原总清单27/40＝67.5%、13项未完（未加权、非工时或发布就绪），完整目标active。

M1收口版的完整正常回归 normal-full2 已独立终态通过（2026-10-06 10:02）：原supervisor2590／子2614实际close退出0、signal=null，33类型、Main66/14、App589/106、Runtime910/50、真实Node迁移Worker及全部conformance通过。严格读取及末版freeze13清单复核原47469终态1fbe9b退出0，统计SHA b6712f60f13ad0385f8fcf60fc3222268149f77e2f197aeef5e4a58ac57f8fe2；1914源码／5448编译／54PNG精确未变（排除.last-good.json）。本轮固定后台20/8与完整正常命令分开留证，首轮中断不计验收、原日志及截图保留。M1原7项已完成，原总27/40＝67.5%不变；本版冻结解除后按16.1推进A05–A10，A06.6追加补验后置且原范围保留。完整目标active，不认证语义质量、授权／结算、发行或全部自主工作完成。

M2 已按原退出条件完成（2026-10-06 12:03，第22.134节，done）：原7/7项，第7节九项创作操作、八项逐操作条件及小说导入→明确采用诊断／完整季纲退出Gate已验。实际费用估值不可变记录、全部阶段的持久模型／起止／逐run用量和严格SDK／普通UI接通；缺报告不补零，不推算账单或跨重试总量。本节M2验收版完整normal2真实退出0：33类型、Main66/14、App596/108、Runtime932/52、真实Node迁移Worker和全部conformance通过；原固定后台16/16、7文件、零跳过／重试／失败／全局错误且不更新快照。九操作定向52通过（396明确过滤）、148份实际安全回执与1931源码／5456编译清单已严格核对；失败与中断历史保留，不拼接旧版通过。M2验收时原清单M0 7/7、M1 7/7、M2 7/7、M3 6/6、M4 1/7、M5 0/6：28/40＝70%，12项未完，未加权、非工时或发布就绪。M4／A05–A10及M5／B01–B05原未验范围保留，完整目标active，不认证真实文学质量、结算、授权或发行。

M4 已按原退出条件完成（2026-10-07 02:50，第22.171节，done）：原7/7项；章节／卷／显式故事弧／全书索引、所有当前创作流程的完整原表达与逐run上下文、原章段／节点／分集／稳定块／场景／镜头映射、八类工程质量Gate和同范围复检、精确受影响失效及允许脱敏谱系已按原有限矩阵验收。两个12章／超9万UTF-16固定样例能解释每集来源，单章变化只使真正相关分集／镜头／可选素材stale，SQLite保持原状态，未知约束和新生成／采用仍严格拒绝。自己的官方normal94908／48422／48452真实exit0：Runtime1036/57、App627/115、Main66/14、33类型／真实Node迁移Worker／全部conformance；942列举输入首末SHA ac6b3be8…完全一致。后台原19旅程首轮18过1个Node环境诊断失败；仅该原用例按Node24补验1/1过，两轮839列举编译／测试输入SHA31028f3e…一致，失败不改写、不拼作一次19/19。当前原清单M0 7/7、M1 7/7、M2 7/7、M3 6/6、M4 7/7、M5 0/6：34/40＝85%、6未完（未加权，非工时／发布就绪）。M5真实模型／用户／授权／商业／发行及A07／A09／A10剩余本地准备继续，完整目标active；不认证文学质量、历史真实性、账单、授权或GA。全部后台，无付费、安装、Loop、普通实例前台操作、提交／推送或发行。

上一版 freeze12 的完整正常测试、原固定后台 53／14、18 在途文件 HMR、五 Profile、最终工程门和原源码／构建／基线清单已分别终态通过，M2 原来源／并发测试按有界审计5勾选。新的 M1 实现属于解除冻结后的另一版，不能借上述旧版验收。撤回三条隔离诊断已终态通过并限定目视，正文两条隔离补验终态失败为夹具选择／原请求绑定问题，失败保留且后置，不放宽实际来源门。无付费模型、安装、普通软件前台调试、Loop、提交／推送或发行；A04–A10／B01–B05 其余未验范围保留。

上一版本限定验收：A06.5／PLAN22.130 已按精确原关联影响观察的限定工程范围 done：Knowledge 原声明／节点／生命周期只读元数据、明确原关联 ID／version、Production 原引文位置／稳定块／实际记录／可选节点观察及 SDK／普通 UI 已接入。默认不附关联，不切最新或替代节点，不搜索新位置；无正文／私人理由／写入或模型调用，逐字未变不等于语义安全。自己的同业务 build2 normal-full1 原48604全命令终态0：Runtime824／47文件、1857.39s，App549／98／3746assert（1.90s）、Main66／14／218assert（319ms）、类型33/33全缓存（125ms）、真实Node Migration Worker与全部conformance通过；固定后台原37219完整41/41／14文件、1269328.112ms，原名单精确一致，skip／unexpected／flaky／retry／global errors全零、单worker不更新快照，完整产物独立留存。自己的244 ESM／79依赖五Profile隔离NodeHMR、root17、独立检查及最后工程门均终态0；1878源码／测试／生成物／全部既有基线和5430编译文件首尾清单SHA完全一致，只排除可变.last-good.json，不认证整仓库字节或完整视觉／文学质量。定向与失败各轮保留，不借A06.4证据。冻结解除，当前接 A06.6 真实上游来源正式确认与来源驱动局部重做衔接；父A06／LIN-01／IMP-01和其余A04–A10未完，原22/40＝55%不变，B01–B05只挂对应验收，没有付费、安装、普通实例前台操作、Loop或发行。

上一限定验收：A05.7 已按 PLAN22.128 的旧制作四操作明确来源工程范围 done。明确无正文／局部／完整目录、实际原文／段落／已采用摘要／高层摘要、完整首次引用与预算、原快照重试及采用／复检结束核对已验。自己的同业务 build2 normal-full1 全命令终态0：Runtime776／45（1758.82s）、App529／96／3576 assertions（1.82s）、Main66／14／218 assertions（315ms），类型33/33（30cached，15.575s）、真实迁移Worker与全部conformance通过；固定十一文件29/29（624720.544ms），skip／unexpected／flaky／retry／global errors全零。自己的237 ESM／79依赖五Profile隔离NodeHMR、root17与最终工程门通过；1832份源码／测试／生成物／全部基线及5416份编译文件首尾清单和SHA完全一致，明确排除可变开发恢复副本.last-good.json，不认证该副本或整个仓库字节不变。当前组未更新视觉基线，目视只认证398×258来源覆盖卡片。冻结解除，接A06.4逐镜头明确引文位置／稳定块／实际采用节点与脱敏交付，其余A04–A10保持未完；外部B01–B05只阻塞对应验收，原22/40＝55%不变。没有付费、安装、普通软件前台操作、Loop、跨产品依赖或发行。

历史限定验收记录：A05.6 已按 PLAN22.127 的兼容固定／数量质量结论停用限定范围 done：四种无内容证据的旧写入明确拒绝，普通历史界面只读并标未认证／量纲未知，旧原值／响应不改写，案例库和旧显式删除协议仍保留；不自动运行独立人工、规则或模型评议。原工作流回执另核真实 task／owner／不可变 parent，FNV32 碰撞、缺失绑定与 HTTP 拒绝缓存已防护，其余六类原键重放兼容。自己的同业务 build4 normal-full2 全命令终态0：Runtime763／45（1721.67s）、App525／95／3566 assertions（2.09s）、Main66／14／218 assertions（429ms），类型33/33全缓存、真实迁移Worker与全部契约通过；固定十一文件28/28、600280.067ms，skip／unexpected／flaky／retry／global errors全零。自己的235 ESM／79依赖五Profile隔离NodeHMR、root17和末版工程门通过。1817份源码／测试／生成物／全部基线及5133份编译文件首尾SHA一致；唯一变化是开发启动刷新的代码恢复副本，380个解码成员逐一匹配初始编译哈希，原校验返回1和诊断修正保留，不称5134字节全部不变。仅两张已目视的darwin review基线更新，其余51未改，冻结后全部基线稳定；原历史1309×1156视口与分集分析1309×234卡片可读，只证对应范围，不认证全画面／语义质量。此前失败／主动中止各轮独立记录。冻结解除，接A05.7旧制作操作明确混合来源与完整预算，再续A04–A10未完范围；外部B01–B05分列，原22/40＝55%不变，无付费、安装、前台普通实例操作或发行。

A05.5 已按 PLAN22.124 的独立本地人工声明／逐字规则工程限定范围 done：本域 .0005、完整实际来源与原采用位置 CAS、事务元数据事件／幂等恢复、七类目标／同入口同源同范围复检及独立 Gate 均已验。自己的 normal-full1 全命令终态0（Runtime755／45、1718.74s；App507／90／3337 assertions、1.98s；Main66／14／218 assertions、299ms；类型33/33与真实迁移Worker／全部契约）；同业务build2固定15文件50/50，零skip／flaky／全局错误（1497312.095ms），自己的235 ESM／79依赖隔离Node五Profile HMR／恢复、root17与最后工程门通过，1834份源码／测试／生成物／基线和4编译模块哈希始终不变。固定自己的1111×556原评议卡标题顶部有裁切，来源／未认证／问题／风险／复检控件可读；只证此视口，完整恢复以本轮DOM／公开API／原key零新模型验证，不借focus或旧组，不认证文学语义。失败、误命令及555像素误记分列；人工／规则始终未认证，规则不计语义覆盖。冻结解除，接A04全项目Native脱敏待确认和原模型／摘要／诊断／季纲／意图本次owner读取；父A04–A10与原22/40＝55%不变，无付费、安装、前台调试、Loop、提交／推送或发行。

A04.3.8／A08.1／PLAN22.123 两项限定工程现已验收：独立策略按本次 owner 成功读取原候选／原运行和冻结绑定，错误不回填缓存，只候选链接不切最近运行；资产中心自由权利／费用／服务声明另列，不提升核验／结算／可用性，受限／不可用保守保留，原记录不改写。本组合自己的normal-full1全命令终态0：Runtime745/45（1703.06s）、App502/89／3274assertions（1.97s）、Main66/14／218assertions（295ms）、类型33/33全缓存、真实Node Worker与全部conformance通过；同business build1自己的fixed1严格后台单worker 49/49／14文件（原13/48加资产1，24.6分钟），无跳过／失败／重试，非整个Electron目录。231ESM detached Node恢复、root17项及最终静态门通过，四旧基线和21业务／测试／SDK文件SHA不变。自己的红测／类型错误、过期矩阵及路径记录分别保留，不借前轮；卡片443×382视觉仅本卡片，不认证完整画面或文学质量。继续A05独立本地质量／其余上下文，随质量入口补A04剩余UX，再续A06／A07／A08剩余／A09／A10；所有父范围仍未完成，原22/40＝55%不变。没有付费调用、安装、普通应用前台操作、Loop、提交／推送或发行。

A04.3.7 已按 PLAN22.122 的单集精确导航／原运行读取工程限定范围验收：同页 episode／operation／精确引用隔离，本次 owner 读取和原身份／完整冻结请求核对，错误隐藏缓存；工作台独立轮询冻结动作，明确新基准确认和本机保存成功后才退出旧运行链接，不自动重绑旧运行。自己的 normal-full1 全命令终态0（Runtime744／45，1702.18s；App493／87／3205 assertions，Main66／14／218 assertions，类型33/33及真实迁移Worker／全部conformance）；同业务build4原十三文件fixed1 48/48、零skip／flaky／全局错误（1456730.954ms），先行focus4 1/1（2.7分钟）、root1 17项和末轮相关静态门／六文件hash复核通过，四原基线未改。自己的fixed1 error视口1800×1100与先前已核视的ownfocus4像素SHA相同，仅证明该错误视口，不认证全画面或语义质量；红测及focus1–3误拒绝／诊断更正分别保留，不借A06验收拼成整轮。源码冻结解除，下一A04独立策略精确读取保护接续；A05独立人工／规则评议、A08资产声明及其他自主范围仍待，外部条件独列16.2，父范围与原22/40＝55%不变。

A06.3.5 已按 PLAN22.121 的场景拓扑工程整组限定范围验收：双正式人工确认／0015、逐版实际祖先／原预览隐私、完整局部拓扑、v4 实际字段保护、原子新行与明确退役／0016、旧媒体 stale 接通 Runtime 和普通界面。自己的 normal-full3 全命令终态0（Runtime744／45，1706.15s；App485／86、Main66／14、类型33/33、真实迁移Worker与全部conformance）；同业务build6原十三文件fixed1 48/48、零skip／flaky／全局错误（1446449.418ms），先行231 ESM／79依赖五Profile HMR和最后全部相关静态门通过，四张原基线未改。自己的fixed1双正式original／restored图上部可读、下部空白且SHA相同，v4-restored只核视口内字段；完整恢复依据本轮DOM／公开API／同key零新模型，不认证完整视觉或语义质量。初始红测、类型／夹具／缓存修正、focus2–8与normal-full1失败／full2主动停止分别保留，不借旧组或拼接不同源码成功。冻结解除，A04精确导航／原运行恢复接续；其他自主父范围与原22/40＝55%保持，无真实付费模型、普通应用前台、安装、Loop、提交／推送或发行。
