# Product Upgrade Loop Map 2

本文档依据 [LOOPRULE.md](./LOOPRULE.md) 编写，用于把“短剧 IP 小说写作工作台”的下一阶段产品升级拆成可执行、可审查、可验证、可提交推送的小闭环。

本地图承接 [LOOPMAP.md](./LOOPMAP.md) 已完成的生产优化基线，重点解决当前产品从“功能齐全”走向“主流程清晰、创作可信、竞品差异明确、商业交付闭环”的问题。

## 0. 目标与范围

### 0.1 总体目标

完成一轮面向真实创作者的产品升级：

1. 把现有“工具抽屉式工作台”收束成清晰的小说到短剧视频主流程。
2. 降低 AI 创作门槛，让用户可以用自然语言驱动复杂任务。
3. 提升 AI 可信度，让用户看得见上下文、风险、版本和采用路径。
4. 强化长篇网文、拆书学习、短剧改编、视频前置资产和投稿交付能力。
5. 在保留本地优先、安全与可回滚原则的前提下，补齐竞品启发下的关键功能需求。

### 0.2 参考来源

- 内部现状：当前 Electron + React + SQLite + LangGraph 工作台，已覆盖项目、人物、大纲、章节、记忆、改编、剧本、分镜、视频任务、质量闸门、样本库、模板、多 Agent、任务队列、资产库等能力。
- 既有规划：[PROJECT_BRIEF.md](../product/PROJECT_BRIEF.md)、[ROADMAP.md](../product/ROADMAP.md)、[LOOPMAP.md](./LOOPMAP.md)。
- 竞品参考：
  - 蛙蛙写作：创意灵感、创作模板、灵感卡片、AI 对话、小说拆书、小说改编剧本、漫剧视频、封面、文本质量优化等泛内容创作入口。
  - 量子探险：一键流程化写作、长篇量产、卷/单元/章节大纲、小说拆文、小说转剧本、漫剧制作、配音、封面和衍生开发。
  - FeelFish：对话即创作、多智能体、自定义方案/技能、智能上下文、知识库、云盘、语义搜索、资源市场、项目级创作规范。

### 0.3 明确不覆盖

本 LOOPMAP2 不直接承诺以下内容：

- 账号体系、支付、云会员、资源市场商业化。
- 真正多人协作和云同步冲突合并。
- 新增大量未验证的视频平台适配。
- 绕过平台检测、规避审查或“去 AI 检测”类灰色能力；相关需求统一改写为作者风格强化、原创性风险提示和文本质量优化。
- 一次性重做全 UI。所有视觉和交互改动必须服务对应 loop 的产品目标。

## 1. 当前基线

### 1.1 已具备能力

- 小说创作：项目设定、人物卡、大纲、章节编辑、AI 生成/续写/改写/润色/扩写。
- 长篇一致性：章节记忆、人物状态、事件时间线、伏笔、视觉档案、一致性检查。
- 短剧链路：改编项目、分集大纲、剧本、场景、分镜、镜头 Prompt、视频任务和结果。
- 创意诊断：新鲜度、反套路、叙事曲线、修稿任务、质量闸门、观众模拟、视频风险。
- 工程底座：本地 SQLite、项目包、备份恢复、密钥保护、AI 上下文预算、任务队列、诊断包、资产库、E2E/DB/单元测试基线。

### 1.2 主要问题

- 项目工作台导航入口过多，写作主线、资料维护、诊断分析和系统记录混在一起，新用户容易迷路。
- 现有能力偏按钮式任务，缺少“对话即创作”的统一指挥入口。
- AI 上下文已有预算和预览，但尚未变成每次生成前可控制、可固定、可排除的创作面板。
- 样本库具备结构抽取雏形，但还不是完整的“上传作品 -> 拆章 -> 学习结构 -> 生成创作卡片”的拆书产品。
- 长篇规划层级不足，缺少卷、单元、剧情阶段、章节目标、字数预算、伏笔回收计划等中观结构。
- 诊断结果、修稿任务、版本 diff、复检之间的闭环还不够强。
- 视频前置资产仍偏 Prompt/参考图，缺少选角、音色、封面、字幕、配音和交付包的统一模型。
- 导出仍偏 Markdown/JSON/项目包，缺少投稿包、短剧提案包、分镜交付包、视频 Prompt 包等商业化交付物。

### 1.3 已通过的检查

- 现有 [LOOPMAP.md](./LOOPMAP.md) 记录的生产优化 loop 均已完成。
- 根目录脚本存在并可作为后续验证入口：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test`、`pnpm test:e2e`、`pnpm package:smoke`。
- 现有页面和模块已包含工作台、改编、剧本、分镜、视频、样本库、模板、Agent 设置、编剧室、诊断和任务监控等入口。

### 1.4 仍不可信的检查

- 本文档只定义升级地图，不代表任何功能 loop 已完成。
- 每个后续 loop 都必须在自己的开发分支中重新同步远端、实现、验证、审查、提交、合并、推送和清理分支。
- 涉及 AI 输出质量、拆书效果、投稿包可用性和视频资产交付的能力，必须追加人工 smoke 或 fixture 检查，不能只看类型检查。

## 2. 兼容、安全与产品约束

- 所有 AI 覆写正文、剧本和 Prompt 的操作默认走预览或版本快照，不得静默覆盖用户核心内容。
- 拆场景、拆镜头、批量生成、工作流自动执行属于高影响操作，必须有跳过已完成项、失败可续跑、版本可回滚或候选预览。
- 样本拆书只能保存抽象结构、标签、节奏、人物关系和可学习模式；不得默认把第三方原文纳入训练、导出包或日志。
- 本地优先仍是默认原则。任何云同步、资源市场、公共知识库能力只能作为后续可选扩展，不进入 P0/P1 主链路。
- 竞品启发只作为需求参考，不复制其文案、素材、商业说法或可能有争议的功能表达。
- 新增 loop 必须遵守 `LOOPRULE.md`：目标单一、开发分支隔离、验证、diff 审查、提交、同步、合并、推送和分支清理后才能标为 `done`。
- 凭据、API Key、第三方样本文本、用户正文、视频二进制资产和诊断包内容必须继续遵守既有脱敏与导出边界。

## 3. 执行约定

- 本文档中的规划 loop 初始状态均为 `todo`。只有满足 `LOOPRULE.md` 第 7 节完成定义后，才能改为 `done`。
- 每个 loop 开始前记录目标分支，执行 `git fetch origin`、`git status --short --branch`、`git branch --show-current`。
- 每个 loop 使用独立分支，建议命名为 `loop/lm2-<loop-id>-<short-topic>`。
- 文档-only loop 至少执行 `git diff --check` 并人工检查路径、链接、命令和验收项。
- UI/renderer loop 至少执行 `pnpm typecheck`；高风险页面改动追加 Electron smoke 或截图检查。
- IPC/schema/AI workflow/DB loop 至少执行相关单测；共享协议或迁移改动追加 `pnpm test:unit`、`pnpm test:db` 或 `pnpm test`。
- 每个 loop 完成后在第 9 节追加执行记录，不覆盖历史。

## 4. 优先级关系

前期讨论中的“最该补的功能需求”是候选功能池，P0/P1/P2 是实施排序。

- P0：让现有产品变好用、可信、能闭环。包括主流程向导、对话式 Agent 指挥台、上下文透明、智能拆书产品化、修稿闭环。
- P1：让产品更专业、更适合长篇和商业交付。包括卷/单元长篇规划、项目级 Skills、灵感台、投稿包和交付包。
- P2：扩大边界，增强衍生和生态。包括选角/音色/封面/配音、移动灵感记录、云同步和资源市场等。

## 5. LM2-00 基线审计

本节是 LM2-00 的审计交付物，用于约束后续 loop 的范围。后续实现不得脱离这里定义的主流程断点、竞品启发映射和执行批次。

### 5.1 当前功能矩阵

| 能力域 | 当前已有能力 | 主要入口 | 当前问题 | 后续 loop |
| --- | --- | --- | --- | --- |
| 项目与设定 | 项目创建、类型预设、目标受众、卖点、风格、视觉方向 | 首页、创建项目页、项目概览 | 项目概览缺少清晰下一步；设定完成度不可见 | LM2-01、LM2-02、LM2-03 |
| 小说写作 | 章节编辑、AI 生成/续写/改写/润色/扩写、版本预览与恢复 | 工作台章节、AI 助手 | 写作能力强，但被大量同级导航入口稀释 | LM2-01、LM2-02、LM2-04 |
| 人物/大纲 | 人物卡、全书/章节大纲、视觉档案 | 人物卡、大纲、人物视觉档案 | 缺少卷/单元/剧情阶段等长篇中观结构 | LM2-10、LM2-11 |
| 长篇一致性 | 章节记忆、人物状态、事件线、伏笔、一致性检查 | 记忆面板、人物状态、事件时间线、伏笔、一致性检查 | 能力分散，未转化成“创作前上下文选择” | LM2-05、LM2-12 |
| 创意诊断 | 新鲜度、反套路、叙事曲线、质量闸门、观众模拟、修稿任务 | 创意诊断台、质量闸门 | 报告多，行动闭环不够强 | LM2-08、LM2-18 |
| 样本库/拆书 | 本地样本上传、抽取案例结构标签 | 样本库、创意诊断上下文 | 尚未形成拆章、结构学习、创作卡片的完整产品 | LM2-06、LM2-07、LM2-14 |
| 改编与剧本 | 改编项目、分集大纲、前 10 集分析、剧本生成、场景拆分 | 改编工作台、剧本工作台 | 从小说工作台进入改编的 CTA 不够强 | LM2-02、LM2-03、LM2-17 |
| 分镜与视频 | 场景拆镜头、Prompt、负面 Prompt、视频任务、结果对比 | 分镜工作台、视频生成页 | 交付链路有骨架，前置选角/音色/封面/字幕不足 | LM2-17、LM2-19、LM2-20 |
| Agent/模板 | 多 Agent 编剧室、模板、任务模型绑定 | 编剧室、模板页、设置 | 更像配置页，不像项目级可复用创作方案 | LM2-04、LM2-12、LM2-13 |
| 导出交付 | Markdown/JSON、完整项目包、剧本/分镜导出 | 各工作台导出菜单 | 缺少面向投稿、提案、分镜交付的成品包 | LM2-16、LM2-17 |
| 工程保障 | 备份恢复、密钥保护、任务队列、诊断包、测试基线 | 设置、任务队列、诊断页 | 后续新功能必须复用这些安全底座 | LM2-23、LM2-24、LM2-25 |

### 5.2 主流程断点

| 断点 | 表现 | 影响 | 优先修复 |
| --- | --- | --- | --- |
| 首页到项目工作台 | 首页有新建项目和创建改编，但项目卡片只提供“打开工作台” | 用户进入项目后不知道该先补设定、人物、大纲还是章节 | LM2-02 |
| 项目工作台导航 | 20+ 个入口同级排列 | 新用户把产品理解成工具箱，而不是创作流程 | LM2-01 |
| 小说到改编 | 改编入口主要在首页；项目内缺少“当前小说是否适合改编”的阶段 CTA | 写完章节后没有自然推进到分集大纲 | LM2-02、LM2-03 |
| 诊断到修稿 | 质量闸门、反套路、观众模拟等能产出报告，但任务采用和复检不够统一 | 用户知道问题却不知道如何闭环 | LM2-08 |
| AI 上下文 | 诊断页能预览 AI run 上下文，但生成前不可控 | 用户不确定 AI 引用了什么，也难以修正上下文选择 | LM2-05 |
| 样本库到创作 | 样本结构能进入诊断上下文，但缺少拆书学习和卡片化采用 | 竞品“拆书/爆款素材”优势没有被产品化 | LM2-06、LM2-07、LM2-14 |
| 长篇规划 | 章节和大纲存在，但没有卷/单元/阶段预算 | 100-300 章长篇缺少中观管理 | LM2-10、LM2-11 |
| 交付出口 | 有数据导出但缺少业务交付包 | 用户难以直接投递、提案或交给制作流程 | LM2-16、LM2-17 |

### 5.3 竞品启发映射

| 竞品信号 | 可借鉴需求 | 我们的差异化做法 | 对应 loop |
| --- | --- | --- | --- |
| 蛙蛙写作的灵感卡片、创作模板、AI 对话 | 降低开局门槛，给用户可直接采用的创意素材 | 用短剧 IP 维度组织卡片：开局钩子、人物关系、爽点、反转、集尾悬念、视频画面卖点 | LM2-14、LM2-15 |
| 蛙蛙写作的小说拆书、小说改编剧本、漫剧视频 | 把“学习样本 -> 改编 -> 视频”做成连续体验 | 保持本地优先，只保存结构标签和创作卡片，不默认保存/传播原文 | LM2-06、LM2-07、LM2-17 |
| 量子探险的卷/单元/章节大纲和长篇量产 | 支持更长篇幅和更明确的章节预算 | 不追求无监督量产，强调阶段目标、质量闸门和可回滚版本 | LM2-10、LM2-11、LM2-23 |
| 量子探险的一键流程化写作 | 减少用户反复选择任务的操作负担 | 用主流程向导和 Agent 指挥台承接，而不是把所有任务藏进单按钮 | LM2-02、LM2-04 |
| FeelFish 的对话即创作 | 自然语言驱动创建/修改文件和复杂任务 | 命令必须产出执行计划，高风险写入进入 diff 预览 | LM2-04、LM2-09 |
| FeelFish 的智能上下文和语义搜索 | 让 AI 主动读取相关资料并解释上下文 | 先做本地上下文透明与手动固定/排除，云端语义搜索只进入预研 | LM2-05、LM2-22 |
| FeelFish 的方案、智能体、技能 | 把作者经验沉淀为可复用项目规范 | 项目级 Skills 绑定短剧类型、人物对白、镜头 Prompt 和平台交付规范 | LM2-12、LM2-13 |
| FeelFish 的资源市场 | 技能/智能体/提示词可共享 | 先设计隐私、审核和版权边界，不进入当前 P0/P1 实现 | LM2-22 |

## 6. Loop 总览

| Loop | 优先级 | Owner | 状态 | 目标 | 主要范围 | 验收 | 验证 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LM2-00 | P0 | 产品/工程负责人 | done | 建立升级基线与信息架构审计 | `docs/process/LOOPMAP2.md`、`docs/product`、核心路由/导航 | 形成当前功能矩阵、主流程断点、竞品启发映射和执行批次；不改业务代码 | `git diff --check`；人工检查文档路径与 loop 粒度 | 无 |
| LM2-01 | P0 | 产品体验 | done | 重组项目工作台导航分组 | `WORKSPACE_NAV`、`WorkspacePage`、相关 section 入口 | 左侧导航按“创作、记忆、诊断、改编准备、记录”分组；章节仍是一等入口；原功能可达 | `pnpm typecheck`；手工 smoke：打开项目并切换每个分组 | LM2-00 |
| LM2-02 | P0 | 产品体验 | done | 增加小说到短剧视频主流程向导 | 项目概览、质量闸门、改编入口、工作流状态 | 项目概览展示阶段进度：设定、人物、大纲、章节、质量闸门、改编、剧本、分镜、视频；每阶段有完成条件和下一步 CTA | `pnpm typecheck`；手工 smoke：空项目、已有章节项目、已有改编项目三种状态 | LM2-01 |
| LM2-03 | P0 | 产品体验/创作闭环 | done | 增加阶段门禁与就绪检查 | 质量闸门、项目概览、改编创建入口 | 创建改编前展示小说就绪项：章节数、人物、大纲、记忆、质量闸门阻塞项；允许继续但风险明确 | `pnpm typecheck`；相关质量闸门单测或手工 smoke | LM2-02 |
| LM2-04 | P0 | AI 产品/基础设施 | done | 建立对话式 Agent 指挥台 MVP | 项目对话、AI run router、任务识别、预览采用 | 用户可输入自然语言命令，系统识别目标实体与任务类型，生成执行计划并调用既有 AI workflow；高风险写入仍走预览 | `pnpm typecheck`；`pnpm test:unit`；手工 smoke：改章节、生成分集、拆镜头三类命令 | LM2-02 |
| LM2-05 | P0 | AI 基础设施 | done | 上下文透明控制面板 | `AiContextPreviewDialog`、context builder、AI run 输入预览 | 每次 AI 生成前可查看将使用的上下文分段、token 估算、被裁剪项；用户可固定/排除章节、人物、样本和视觉档案 | `pnpm typecheck`；上下文预算/预览单测；手工 smoke | LM2-04 |
| LM2-06 | P0 | 样本库/AI | done | 智能拆书一期：导入与拆章 | 样本库、导入安全、章节解析、DB schema/repo | 支持导入 txt/md/docx 样本文档，按章节识别拆分，错误章节可人工修正；不保存到项目正文 | `pnpm typecheck`；文件导入安全测试；DB smoke 视 schema 变化执行 | LM2-00 |
| LM2-07 | P0 | 样本库/AI | done | 智能拆书二期：结构抽取与创作卡片 | 样本结构、AI prompt、样本库 UI、创意诊断上下文 | 从拆章结果抽取钩子、爽点、人物关系、反转、悬念、节奏曲线，生成可复用创作卡片；不输出原文长摘录 | `pnpm typecheck`；AI workflow mock 单测；手工 smoke：导入样本并生成卡片 | LM2-06 |
| LM2-08 | P0 | 创作闭环 | done | 统一诊断到修稿任务再到 diff 采用的闭环 | 创意诊断、修稿任务、`TextDiffPreviewDialog`、`ContentVersionPanel` | 质量闸门/审稿/观众模拟可生成修稿任务；任务可触发改写预览；采用后标记任务状态并可复检 | `pnpm typecheck`；修稿任务单测；手工 smoke：章节任务应用与复检 | LM2-03 |
| LM2-09 | P0 | AI 安全/体验 | done | 收紧高影响自动写入策略 | `TASK_WRITE_POLICIES`、拆场景、拆镜头、批量工作流 | 拆场景/拆镜头/批量结构替换前有候选预览或自动版本快照；失败可恢复；UI 文案说明影响 | `pnpm typecheck`；`pnpm test:unit`；手工 smoke：拆场景、拆镜头、取消采用 | LM2-08 |
| LM2-10 | P1 | 长篇规划 | done | 增加卷/单元/剧情阶段模型 | DB schema/repo、core types、Outline/Workspace UI | 项目可维护卷、单元、剧情阶段；每个阶段可设置目标字数、目标章节、核心矛盾、关键爽点和回收伏笔 | `pnpm typecheck`；`pnpm test:db`；DB migration replay | LM2-02 |
| LM2-11 | P1 | 长篇规划/AI | done | 卷/单元大纲生成与章节预算 | AI prompts、outline section、chapter generation context | AI 可生成卷/单元大纲，章节生成引用所属单元目标；工作台显示章节预算与完成度 | `pnpm typecheck`；AI mock workflow 单测；手工 smoke | LM2-10 |
| LM2-12 | P1 | AI 可配置性 | todo | 项目级 Skills/创作规范系统 | DB 或项目文件模型、Agent settings、AI context | 每个项目可维护多份创作规范/技能，如类型节奏、人物对白、镜头 Prompt 规则；AI 按任务自动选择或用户手动指定 | `pnpm typecheck`；IPC/schema 单测；上下文单测 | LM2-05 |
| LM2-13 | P1 | AI 可配置性 | todo | 自定义 Agent 方案与技能绑定 | Agent settings、writing room、task model binding | 用户可按项目启用/禁用 Agent、指定主 Agent、绑定 Skills 和模型；不影响全局内置预设 | `pnpm typecheck`；IPC/schema 单测；手工 smoke：项目级方案切换 | LM2-12 |
| LM2-14 | P1 | 创意产品 | todo | 灵感台一期：创作卡片库 | 类型库、模板、样本卡片、反套路方案 | 汇总爆款开局、人物关系、冲突机制、反转、集尾悬念、视频画面卖点卡；卡片可收藏、插入项目设定或章节要求 | `pnpm typecheck`；手工 smoke：卡片生成、收藏、采用 | LM2-07 |
| LM2-15 | P1 | 创意产品/AI | todo | 灵感台二期：类型化灵感生成 | genre preset、template run、AI prompts | 用户选择题材/受众/短剧方向后，可一键生成 3-5 组差异化灵感方案，并进入项目创建或章节改写 | `pnpm typecheck`；AI mock 单测；手工 smoke | LM2-14 |
| LM2-16 | P1 | 交付导出 | todo | 小说投稿包导出 | `packages/export`、export IPC/UI | 导出投稿包包含作品简介、卖点、人物小传、前 N 章、章节目录、质量摘要；支持 Markdown/JSON 或目录包 | `pnpm typecheck`；export 单测；人工检查导出内容 | LM2-02 |
| LM2-17 | P1 | 交付导出 | todo | 短剧提案包与分集交付包导出 | export、adaptation/script/shot pages | 导出短剧提案：核心卖点、分集大纲、人物、视觉风格、前 10 集分析、视频风险；分镜包含场景/镜头/Prompt/负面 Prompt | `pnpm typecheck`；export 单测；手工导出 smoke | LM2-16 |
| LM2-18 | P1 | 文本质量 | todo | 作者风格强化与原创性风险提示 | AI prompts、章节/剧本助手、诊断报告 | 提供“作者风格学习、重复句式检测、网文化润色、对白增强、原创性风险提示”；不使用“绕过检测”类灰色表达 | `pnpm typecheck`；AI mock 单测；手工 smoke | LM2-08 |
| LM2-19 | P2 | 视频资产 | todo | 视频前置资产模型扩展 | DB schema、asset library、visual profile、shot/video pages | 建模角色选角、音色、旁白、字幕、封面、首帧图；与人物视觉档案和镜头资产关联 | `pnpm typecheck`；`pnpm test:db`；资产导入导出测试 | LM2-17 |
| LM2-20 | P2 | 视频资产/AI | todo | 封面、配音与字幕生成草稿 | AI prompts、asset UI、video workflow | 可从小说/剧本生成封面 prompt、角色音色建议、旁白/字幕草稿；仅生成草稿，不接真实 TTS 平台 | `pnpm typecheck`；AI mock 单测；手工 smoke | LM2-19 |
| LM2-21 | P2 | 移动/轻量入口 | todo | 移动灵感记录与桌面导入设计 | 文档、数据模型、轻量导入 IPC | 明确移动端只做灵感记录/云端后续设计；桌面可导入灵感 JSON/Markdown 进入灵感台 | 文档 `git diff --check`；如实现导入则追加 typecheck/unit | LM2-14 |
| LM2-22 | P2 | 生态/同步预研 | todo | 云同步、资源市场、知识库路线设计 | `docs/product`、架构文档 | 输出不进入当前实现的路线图：数据边界、隐私、冲突处理、收费/资源审核、知识库语义搜索方案 | 文档 `git diff --check`；人工评审 | LM2-00 |
| LM2-23 | P0 | 测试/发布 | todo | 升级后端到端 smoke 覆盖 | Electron E2E、mock AI、fixture 项目 | 覆盖主流程向导、对话指挥台、智能拆书最小路径、修稿任务采用、投稿包导出 | `pnpm test:e2e` 或记录本地 Electron smoke；`pnpm test:unit` | LM2-02、LM2-04、LM2-07、LM2-08 |
| LM2-24 | P0 | 文档/产品 | todo | 更新用户手册与产品路线 | `README.md`、`USER_GUIDE.md`、`ROADMAP.md`、`TROUBLESHOOTING.md` | 文档解释新主流程、拆书、上下文控制、Agent 指挥台、导出包；旧入口说明与代码一致 | `git diff --check`；人工检查路径、命令、页面名 | 对应功能 loop 完成后 |
| LM2-25 | P0 | Release | todo | LOOPMAP2 全量验收闸门 | 全仓、文档、测试、打包 smoke | P0/P1 目标完成后运行完整回归；确认未完成 P2 不阻塞发布；生成发布说明和回滚提示 | `pnpm test`；必要时 `pnpm package:smoke`；最终 diff 审查 | P0/P1 完成 |

## 7. 推荐执行批次

### Batch A：P0 主流程与可信 AI

目标：先让产品从“功能很多”变成“用户知道下一步怎么做，AI 为什么这样做”。

执行顺序：

1. LM2-00：升级基线与信息架构审计。
2. LM2-01：导航分组。
3. LM2-02：主流程向导。
4. LM2-03：阶段门禁与就绪检查。
5. LM2-04：对话式 Agent 指挥台 MVP。
6. LM2-05：上下文透明控制面板。

阻塞条件：如果 LM2-01/LM2-02 不能稳定保留现有功能入口，不应继续做新的 Agent 指挥台入口。

### Batch B：P0 拆书与修稿闭环

目标：把竞品强项“拆书学习”和我们已有“诊断/反套路/质量闸门”整合成可行动闭环。

执行顺序：

1. LM2-06：智能拆书导入与拆章。
2. LM2-07：结构抽取与创作卡片。
3. LM2-08：诊断到修稿任务到 diff 采用。
4. LM2-09：收紧高影响自动写入策略。
5. LM2-23：扩展 E2E smoke 覆盖 P0 最小路径。

阻塞条件：如果样本文档安全策略或原文保存边界不清晰，不应上线拆书抽取。

### Batch C：P1 长篇专业化

目标：补齐量子探险强调的长篇规划能力，并把 FeelFish 风格的项目级规范沉淀到 AI 工作流。

执行顺序：

1. LM2-10：卷/单元/剧情阶段模型。
2. LM2-11：卷/单元大纲生成与章节预算。
3. LM2-12：项目级 Skills/创作规范系统。
4. LM2-13：自定义 Agent 方案与技能绑定。

阻塞条件：如果上下文透明控制面板未完成，项目级 Skills 容易变成不可解释的隐式 prompt，不应提前做复杂绑定。

### Batch D：P1 灵感与商业交付

目标：把蛙蛙写作的灵感/模板优势和我们自己的短剧链路结合，形成可投稿、可交付的成品包。

执行顺序：

1. LM2-14：灵感台创作卡片库。
2. LM2-15：类型化灵感生成。
3. LM2-16：小说投稿包导出。
4. LM2-17：短剧提案包与分集交付包导出。
5. LM2-18：作者风格强化与原创性风险提示。

阻塞条件：如果主流程向导和拆书卡片未完成，灵感台容易变成另一个孤立页面，应延后。

### Batch E：P2 衍生资产与生态预研

目标：扩展边界，但不影响 P0/P1 发布。

执行顺序：

1. LM2-19：视频前置资产模型扩展。
2. LM2-20：封面、配音与字幕生成草稿。
3. LM2-21：移动灵感记录与桌面导入设计。
4. LM2-22：云同步、资源市场、知识库路线设计。

阻塞条件：任何 P2 loop 不得阻塞 P0/P1 的发布；如果需要云端能力，必须先完成隐私、同步冲突和付费边界设计。

### Batch F：文档与发布闸门

目标：确保产品说明、用户手册和验证结果与真实实现一致。

执行顺序：

1. LM2-24：更新用户手册与产品路线。
2. LM2-25：LOOPMAP2 全量验收闸门。

## 8. 验证策略

| 变更类型 | 最小验证 | 扩展验证 |
| --- | --- | --- |
| 文档-only | `git diff --check` | 人工检查路径、链接、命令、loop 状态 |
| 导航/页面结构 | `pnpm typecheck` | Electron 手工 smoke、关键页面截图检查 |
| IPC/schema | `pnpm test:unit` | `pnpm typecheck`、未知 channel/错误 payload 测试 |
| DB/schema/migration | `pnpm test:db` | 迁移回放、项目包往返、旧 fixture 检查 |
| AI workflow/prompt | `pnpm test:unit` | mock provider 端到端、失败/重试/空输出测试 |
| 文件导入/拆书 | `pnpm test:unit` | 文件大小/扩展名/解析失败/超长文本 smoke |
| 导出包 | export 单测或 fixture 对比 | 人工打开导出 Markdown/JSON/目录包 |
| 视频/资产 | `pnpm typecheck`、DB smoke | 资产缺失、本地路径、远端 URL、项目包策略检查 |
| 发布闸门 | `pnpm test` | `pnpm package:smoke`、诊断包与回滚说明 |

## 9. 完成记录区

规划阶段不得把 loop 标记为 `done`。每个 loop 真正完成后，按以下模板追加记录：

```text
Loop:
Target branch:
Loop branch:
Commit:
Merge commit:
Verification:
Diff review:
Remote sync:
Push:
Loop branch cleanup:
Current branch/worktree:
Notes:
```

### 当前记录

```text
Loop: LM2-00
Target branch: main
Loop branch: loop/lm2-00-upgrade-baseline
Commit: 9fe91af docs: add product upgrade loop map 2
Merge commit: 9d17e63 merge: lm2-00 upgrade baseline
Verification: git diff --check HEAD~1 HEAD -- docs/process/LOOPMAP2.md passed; rg "^##|^###|^# " docs/process/LOOPMAP2.md confirmed required sections; git diff --check after merge passed.
Diff review: reviewed staged/document diff before commit and final origin/main...HEAD stat before push; LM2-00 scope was docs/process/LOOPMAP2.md only, while push also included two pre-existing local main commits approved by the user.
Remote sync: git fetch origin succeeded; git merge --ff-only origin/main reported Already up to date before merge; git fetch origin succeeded again before push.
Push: git push origin main succeeded to Gitee, updating main from ab59be3 to 9d17e63.
Loop branch cleanup: git branch -d loop/lm2-00-upgrade-baseline succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: User explicitly approved pushing the current main state containing four local commits to origin/main. Gitee credentials were entered only through interactive prompts.
```

```text
Loop: LM2-01
Target branch: main
Loop branch: loop/lm2-01-workspace-nav-groups
Commit: 09a0852 loop(LM2-01): group workspace navigation
Merge commit: a7d8d48 merge: lm2-01 workspace nav groups
Verification: git diff --check passed; pnpm typecheck passed; node --import tsx --test tests/workspace-nav.test.ts passed; pnpm test:unit passed with 67 tests; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to grouped workspace nav constants, WorkspacePage rendering, and nav coverage tests.
Remote sync: git fetch origin succeeded before starting LM2-01 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 0b5255a to a7d8d48.
Loop branch cleanup: git branch -d loop/lm2-01-workspace-nav-groups succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: The grouped nav keeps every previous WORKSPACE_NAV entry reachable; tests assert all nav items appear exactly once and that chapters remains the first creation entry.
```

```text
Loop: LM2-02
Target branch: main
Loop branch: loop/lm2-02-main-workflow-guide
Commit: daae1b1 loop(LM2-02): add project workflow guide
Merge commit: 867ae58 merge: lm2-02 main workflow guide
Verification: git diff --check passed; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/project-workflow-guide.test.ts passed; pnpm test:unit passed with 70 tests; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to project workflow guide helper, WorkspacePage overview guide, and workflow guide tests.
Remote sync: git fetch origin succeeded before starting LM2-02 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 3b6284d to 867ae58.
Loop branch cleanup: git branch -d loop/lm2-02-main-workflow-guide succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Project overview now shows nine workflow stages from setup through video, with completion details and CTAs that route to the relevant workspace section or adaptation page.
```

```text
Loop: LM2-03
Target branch: main
Loop branch: loop/lm2-03-adaptation-readiness
Commit: a7b1a24 loop(LM2-03): add adaptation readiness checks
Merge commit: 0726c6a merge: lm2-03 adaptation readiness
Verification: git diff --check passed before and after merge; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/adaptation-readiness.test.ts passed; pnpm test:unit passed with 73 tests; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to adaptation readiness helper, shared readiness panel, project overview integration, CreateAdaptationPage creation gate, and readiness tests.
Remote sync: git fetch origin succeeded before starting LM2-03 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 0cea1a3 to 0726c6a.
Loop branch cleanup: git branch -d loop/lm2-03-adaptation-readiness succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Project overview and adaptation creation now show chapter count, characters, outline, memory coverage, and quality gate blockers; creating an adaptation remains allowed after an explicit risk confirmation.
```

```text
Loop: LM2-04
Target branch: main
Loop branch: loop/lm2-04-agent-command-console
Commit: 4899ee1 loop(LM2-04): add agent command console
Merge commit: 06383d3 merge: lm2-04 agent command console
Verification: git diff --check passed before and after merge; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/agent-command-planner.test.ts tests/workspace-nav.test.ts passed; pnpm test:unit passed with 77 tests; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to Agent command planning, ChatSection command execution UI, WorkspacePage preview wiring, Agent nav label, and planner tests.
Remote sync: git fetch origin succeeded before starting LM2-04 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 9f5a31f to 06383d3.
Loop branch cleanup: git branch -d loop/lm2-04-agent-command-console succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Agent 指挥台 now turns natural-language chapter, episode, and shot commands into execution plans, then calls existing AI workflows only after user confirmation. Chapter edits and episode generation use existing preview/adopt dialogs; shot splitting shows a plan plus confirmation because the underlying workflow still auto-writes.
```

```text
Loop: LM2-05
Target branch: main
Loop branch: loop/lm2-05-context-control-panel
Commit: f96f894 loop(LM2-05): add preflight context controls
Merge commit: 967bc6e merge: lm2-05 context control panel
Verification: git diff --check passed before and after merge; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/ai-context-controls.test.ts tests/agent-command-planner.test.ts passed; pnpm test:unit passed with 79 tests; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to context control types, backend context filtering, preflight context builder, AiContextPreviewDialog controls, Workspace/Chat/AiAssistant wiring, and context control tests.
Remote sync: git fetch origin succeeded before starting LM2-05 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from f3f26de to 967bc6e.
Loop branch cleanup: git branch -d loop/lm2-05-context-control-panel succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Project generation, chapter assistant actions, and Agent commands now open a preflight context panel with token estimates, budget trimming, and pin/auto/exclude controls for chapters, characters, samples, and visual profiles; selected controls are passed into the AI workflow and applied when loading project context.
```

```text
Loop: LM2-06
Target branch: main
Loop branch: loop/lm2-06-sample-import-chapters
Commit: c6b520b loop(LM2-06): add sample document chapter import
Merge commit: b5aa3fb merge: lm2-06 sample import chapters
Verification: git diff --check passed before and after merge; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/case-study-import.test.ts tests/file-import-security.test.ts tests/ipc-contract.test.ts passed; pnpm test:unit passed with 82 tests; pnpm test:db passed with migration replay and DB smoke; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to sample chapter parser, case study import IPC/preload/renderer contracts, CaseStudyPage import review UI, case study document/chapter DB schema and repo APIs, migration replay assertions, and parser tests.
Remote sync: git fetch origin succeeded before starting LM2-06 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 57abd90 to b5aa3fb.
Loop branch cleanup: git branch -d loop/lm2-06-sample-import-chapters succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Sample library now imports .md/.txt/.docx, parses Chinese/English/Markdown chapter headings, lets users correct pending split titles/body text, and saves only document/chapter metadata plus short previews. Full imported text remains transient for correction or the existing redacted AI extraction path, and is not written to project chapters.
```

```text
Loop: LM2-07
Target branch: main
Loop branch: loop/lm2-07-structure-cards
Commit: a7fb8ea loop(LM2-07): add sample structure cards
Merge commit: df8bf6c merge: lm2-07 sample structure cards
Verification: git diff --check passed before and after merge; pnpm format:check passed; pnpm typecheck passed; node --import tsx --test tests/case-study-cards.test.ts tests/case-study-import.test.ts tests/file-import-security.test.ts tests/ipc-contract.test.ts passed; pnpm test:unit passed with 84 tests; pnpm test:db passed with migration replay and DB smoke; pnpm test:e2e passed after building and launching Electron smoke.
Diff review: reviewed staged diff and final origin/main...HEAD stat; changes were limited to extract_case_structure prompt/schema, creative card and rhythm fields, case study DB persistence, sample library card display, creative context inclusion, migration replay assertions, and card tests.
Remote sync: git fetch origin succeeded before starting LM2-07 and before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 0c77735 to df8bf6c.
Loop branch cleanup: git branch -d loop/lm2-07-structure-cards succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Sample extraction now produces abstract rhythm curves and reusable creative cards for hooks, highlights, relationships, reversals, cliffhangers, visuals, and rhythm. The prompt and tests require abstract patterns instead of source excerpts, and creative diagnosis context can reuse card titles/applicability without copying sample text.
```

```text
Loop: LM2-08
Target branch: main
Loop branch: loop/lm2-08-revision-task-loop
Commit: b28a28f loop(LM2-08): add revision task preview adoption
Merge commit: fff1ca0 merge: lm2-08 revision task loop
Verification: git diff --cached --check passed before commit; git diff --check passed after merge; pnpm format:check passed before commit and after merge; pnpm typecheck passed before commit and after merge; node --import tsx --test tests/revision-task-loop.test.ts tests/ipc-contract.test.ts passed before commit and after merge; pnpm test:unit passed with 86 tests; pnpm test:e2e passed after authorized rebuild and Electron smoke.
Diff review: reviewed staged stat/name list and final main status; changes were limited to revisionTask preview/complete IPC, preload/renderer IPC contracts, CreativeDiagnosisSection diff preview adoption and recheck controls, IPC shared schemas, and revision task helper tests.
Remote sync: git fetch origin succeeded before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from dbb18bc to fff1ca0.
Loop branch cleanup: git branch -d loop/lm2-08-revision-task-loop succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Revision tasks now open TextDiffPreviewDialog instead of silently writing content; adopting a preview uses the existing ai.applyResult path, records a revision_task content version, marks the task applied, and enables quality-gate recheck for applied tasks. Legacy revisionTask.apply now returns a preview for compatibility.
```

```text
Loop: LM2-09
Target branch: main
Loop branch: loop/lm2-09-high-impact-write-safety
Commit: 4ca83e7 loop(LM2-09): snapshot high impact structure writes
Merge commit: 70d99c2 merge: lm2-09 high impact write safety
Verification: git diff --cached --check passed before commit; git diff --check passed after merge; pnpm format:check passed before commit and after merge; pnpm typecheck passed before commit and after merge; node --import tsx --test tests/high-impact-write-safety.test.ts tests/ai-task-registry.test.ts tests/save-result-preview.test.ts tests/agent-command-planner.test.ts tests/ipc-contract.test.ts passed before commit and after merge; pnpm test:unit passed with 92 tests; pnpm test:e2e passed after authorized rebuild and Electron smoke.
Diff review: reviewed staged stat/name list, new helper/test files, and final main status; changes were limited to high-impact write policy labels, structure snapshot creation/restoration, split-scene/split-shot UI safety copy and structure version panels, Agent command messaging, and focused tests.
Remote sync: git fetch origin succeeded before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 8ff53fc to 70d99c2.
Loop branch cleanup: git branch -d loop/lm2-09-high-impact-write-safety succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: split_script_to_scenes and split_scene_to_shots now use snapshot_then_auto_write. Before replacing scenes or shots, the workflow stores a manual structure checkpoint with nested scene/shot data; contentVersion restore can rebuild script scene lists and scene shot lists, and renderer panels expose structure versions separately from text/Prompt history.
```

```text
Loop: LM2-10
Target branch: main
Loop branch: loop/lm2-10-story-planning-model
Commit: f852924 loop(LM2-10): add story planning arcs
Merge commit: 92b30fa merge: lm2-10 story planning model
Verification: git diff --check passed before commit and after merge; pnpm format:check passed before commit and after merge; pnpm typecheck passed before commit and after merge; pnpm test:unit passed with 92 tests before commit and after merge; pnpm test:db passed before commit and after merge, including DB migration replay and story_arcs smoke coverage; pnpm test:e2e passed after merge with Electron smoke.
Diff review: reviewed staged stat/name list, new StoryPlanningSection and story-arc repository files, and final origin/main...HEAD stat; changes were limited to story arc DB schema/repo/migration, shared types and IPC contracts, Workspace long-form planning UI, and focused DB/IPC/nav tests.
Remote sync: git fetch origin succeeded before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from 3cab27b to 92b30fa.
Loop branch cleanup: git branch -d loop/lm2-10-story-planning-model succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: Projects can now maintain volumes, units, and story stages in the workspace Long-form Planning section. Each story arc persists target words, target chapters, chapter range, core conflict, key highlights, and foreshadowing payoff plans through shared IPC and SQLite migration version 12.
```

```text
Loop: LM2-11
Target branch: main
Loop branch: loop/lm2-11-story-arc-generation
Commit: 7521f5e loop(LM2-11): generate story planning outlines
Merge commit: ba8abcd merge: lm2-11 story arc generation
Verification: git diff --check passed before commit and after merge; pnpm format:check passed before commit and after merge; pnpm typecheck passed before commit and after merge; node --import tsx --test tests/ai-workflow-mock.test.ts tests/ai-task-registry.test.ts tests/ai-context-controls.test.ts tests/workspace-nav.test.ts passed before commit; pnpm test:unit passed with 93 tests before commit and after merge; pnpm test:e2e passed after merge with Electron smoke.
Diff review: reviewed staged stat/name list, new generate_story_arc_outline prompt/schema, AI persistence/context wiring, StoryPlanningSection budget UI, GeneratePreviewDialog renderer, and final origin/main...HEAD stat; changes were limited to story arc generation, adoption, context controls, and chapter budget completion display.
Remote sync: git fetch origin succeeded before merge; git merge --ff-only origin/main reported Already up to date before merge.
Push: git push origin main succeeded to Gitee, updating main from bf1c7d9 to ba8abcd.
Loop branch cleanup: git branch -d loop/lm2-11-story-arc-generation succeeded after push.
Current branch/worktree: main; only this completion record was pending before the record commit.
Notes: AI can now generate volume/unit/stage outlines through preview_then_adopt, adopted outlines create story arcs with hierarchy and a content version snapshot, chapter context includes matching story arc goals, and the long-form planning UI shows AI generation plus chapter budget completion.
```
