# AI 核心流程修正：实施与验收记录

> 本文记录 2026-09-06 的阶段性实现与验收事实，不单独定义当前产品市场定位。当前定位、核心层级与主路径以 [产品定位](../../../docs/product/POSITIONING.md) 为准；其中的小说能力应理解为重要上游核心之一，不能外推为所有项目必须先写小说，也不能把范围扩大为未经验证的文学质量承诺。

本次修改仅在 `desktop/`。保留原窗口 1800 × 1000、系统按钮布局、主题、滚动、任务提醒和编辑恢复改动。工作区有先前未提交成果，未重置、提交或覆盖这些成果。

## 里程碑与可评审实现

| 阶段 | 当前实现                                                                                                               | 主要证据                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| M0   | 首页与概览以创意、来源及 AI 方案为入口；移除三种写作模式；正常布局中的目录按钮、独立目录记忆与焦点恢复                 | NovelChapterWorkspace、project-cockpit、Electron 创建与布局旅程                 |
| M1   | automation 持久工作流、冻结上下文与模型、实际引擎调用、检查和一轮局部修订、任务/助手共用候选、真实取消与关联重试       | creation contracts、automation/creation、agents task runner、Runtime 工作流测试 |
| M2   | 默认阅读与 AI 本章区域、固定输入区、实际引用/遗漏和检查报告、完整人物/大纲方案包、采用后的证据记忆；文本三方合并       | CreationWorkbench、writing/creation、knowledge/creation、text-merge 测试        |
| M3   | 来源确认后真正生成第一集；候选内部父子引用原子应用；结构化剧本及稳定块合并；镜头提示和台词复用；字幕草稿与真实时序区分 | production/creation、pilot、media UI、分集与剧本 Runtime 旅程                   |
| M4   | 审片与反馈关联目标的 AI 修订、采用后原问题复检、交付文案/译文方案、博主完整选题脚本、小剧场授权后创作、知识方案入口    | review/insights typed services、delivery/creation、四模式工作台                 |

正文微调、导入已有稿件和资料管理保留为辅助入口。安全凭据、人物授权、媒体预检与费用确认、发布确认继续沿用原机制。

## 数据与协议

automation 新增所属迁移 `automation.0007.creation-workflows`。writing、production、knowledge、delivery 各自保存采用收据，并在所属事务内写入本领域对象与事件。同一方案重复采用不会产生重复对象。没有跨插件读写业务表。

工作流保存阶段、主任务、运行/会话、上下文快照、实际纳入来源版本、输入模型、检查问题及候选引用。旧记录兼容默认值。重试复制原输入与快照，源资料变化不能通过采用静默覆盖。生成候选不参与正式故事记忆。

工作流 API 为 `/api/v2/workflows/creation` 及对象、actions、merge、rebase 子路径；使用既有 Bearer 鉴权和幂等键，分页使用稳定游标。错误返回 Problem Details；读取对象带 ETag，操作支持 If-Match。OpenAPI、客户端、事件与架构清单同步生成。

## 验证证据与边界

本机工程质量门已通过（Bun 1.4.0）：

- `lint`、`format:check`、`typecheck`（33 个工作区）与 `test`。
- `test` 包含桌面主进程、app、Runtime 和插件/引擎/扩展一致性测试；当前共 235 项通过，另有迁移 worker 集成验证。Runtime 主套件为 98 项，额外引擎桥接套件为 3 项。
- `check:architecture`、`check:generated`、`check:migration:complete`。
- `check:engine-locks`、`check:provider-catalog`、`check:extension-packages`、`check:renderer-chunks`、`check:timeline-exports` 和 `build`。

Runtime 创作流程测试使用模拟 Host 引擎，验证真实请求内容、持久写入、取消重试、候选采用、父子关系、记忆版本和冲突复检。新测试还验证了重启后候选及上下文原样恢复、章节助手与工作台共用候选、错误章节绑定拒绝，以及无时间信息的译文只能导出为草稿。这些结果证明执行链路与数据约束，不能证明真实模型的文学质量。

Electron 的 `creation-workbench.spec.ts` 单独模拟工作流响应，使用真实 Runtime 保存章节，用于验证候选放弃与最新草稿隔离、相同失败请求的幂等重试、修改要求及切换章节后的请求隔离。这是界面状态证据，不是真实模型生成证据。

Electron 使用隔离数据目录和内嵌 Node。视觉覆盖明暗主题与 1800 × 1000、1440 × 900、1280 × 800、1080 × 700、200% 缩放、独立滚动及焦点。所有页面基线已从当前构建重新采集，并人工检查小说工作台的明暗布局。

最终构建的完整 Electron 回归：**51 项全部通过，用时 5.6 分钟**。命令：`bun scripts/run-electron-playwright.ts test --reporter=list`；运行日期为 2026-09-06，本机 macOS。旧导入、手工资料调整、时间线编辑和人工修改稿测试继续作为兼容性验证；AI 内容执行以新增工作流测试的运行、持久候选和采用证据为依据，模板初始化不计为模型生成。

尚无真实模型对比采用率/连续性错误/成本、真实付费媒体成片交付、Windows/Linux 安装升级恢复和 6–8 位用户任务测试证据。这些属于发布验收，不能用模拟引擎或页面通过替代。大项目性能目标也不是本次已测结论。

## 固定内容评估样例

1. 悬疑长篇：雨夜重逢，人物只能知道已采用章节明确告知的事实；第一章到第二章检验视角与认知连续性。
2. 轻喜剧长篇：目标是人物关系推进，不强制反转；检验重复桥段与机械悬念。
3. 单季短剧：三章来源、首集范围 1 集，检查人物/场景/镜头完整引用及改编覆盖。
4. 博主工作室：明确受众和目标，提供两份已采用资料，检查事实、引文、推测及配音方案的区分。
5. 小剧场：两位已授权人物，先撤回一位授权再尝试生成/采用，验证阻断；恢复授权后评估故事与分镜。

真实模型评估固定引擎、模型版本、输入资料版本及预算，分别记录首次候选采用与否、局部修订次数（默认最多 1）、连续性错误、人工补录量、阶段耗时及实际费用。评价表不得保存密钥、本机路径或未经用户同意的正文。模拟结果与真实模型评价分开存档。

## 复核入口

- `packages/contracts/src/creation.ts`：类型化工作流、候选、版本与检查协议。
- `plugins/automation/src/creation.ts`：阶段推进、恢复、实际取消、关联重试、候选与采用后任务。
- `plugins/{writing,production,knowledge,delivery}/src/creation.ts`：各领域内容准备、校验、采用收据与所属事务。
- `packages/app/src/features/creation-workbench.tsx`：跨领域候选、要求、报告及采用交互。
- `packages/runtime/src/workspace-writing.test.ts`：创作 Runtime 旅程与恢复验证。
- `tests/electron/creation-workbench.spec.ts`：候选与草稿隔离、请求重试边界。
- `tests/electron/lm7-ui-visual.spec.ts-snapshots/ai-workbench-1800-darwin.png`：1800 × 1000 小说工作台当前基线。
