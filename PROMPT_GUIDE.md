# Prompt 工程指南

本文档说明项目的 prompt 体系：目录结构、模板约定、JSON 输出规范、变量渲染、内置 Agent 体系、模板系统用法。

## 目录结构

```
packages/ai/src/prompts/
  zh-CN/
    project/      项目设定（生成项目、人物、大纲、对话式设定）
    chapter/      章节生成（续写、改写、润色、增强）
    evaluation/   评分（AI短剧契合度）
    memory/       记忆与一致性（章节摘要、人物状态、故事事件、伏笔）
    analysis/     分析（节拍、爽点、可行性、趋势）
    adaptation/   分集大纲（改编策略、分集生成、增强、前10集分析）
    script/       剧本（生成、拆场景、审稿、改写、增强）
    shot/         分镜与镜头 Prompt（拆镜头、视频/负面 Prompt、审查、改写、平台优化）
    creative/     创意诊断（新鲜度、反套路、曲线、修稿任务、闸门、观众模拟、视频风险、样本结构）
    consistency/  一致性检查、长上下文构建
    agent/        多 Agent 编剧室（agent-review、consolidate-review）
  loader.ts       REGISTRY（taskType → 模板字符串）+ isJsonTask + effectiveTaskType
  template-render.ts  {{变量}} 渲染 + extractTemplateVariables
  types/raw.d.ts  *.md?raw 类型声明
```

## Prompt 文件约定

每个 prompt 是一个 Markdown 文件，**顶部 YAML 头**声明元数据：

```markdown
---
prompt: generate-chapter
version: 0.1.0
taskType: generate_chapter
output: text|json
---

# 角色
你是…

# 输出要求
…

# 输出格式
（json 任务：严格输出 JSON 对象/数组，不要 Markdown / 代码块 / 解释）
```

- `taskType`：对齐 `NovelTaskType`（core 类型）。
- `output`：`json` 任务会被 `isJsonTask` 判定，call-model 设 `responseFormat:'json'`，parse 用 `extractJson`，validate 用对应 Zod。
- `version`：prompt 迭代时递增，便于回溯。

## 注册流程

1. 写好 `.md` 文件。
2. `loader.ts`：`import xxx from './zh-CN/<域>/xxx.md?raw'`。
3. 写入 `REGISTRY`（key = taskType）。
4. JSON 任务加入 `JSON_TASKS` 集合。
5. 产物的 Zod schema 在 `core/schemas` 登记 `ALL_RESULT_SCHEMAS`。

## JSON 输出规范

- **只输出一个 JSON 对象/数组**，不要 Markdown 代码块、不要解释文字。
- 模型若输出带 ```json 围栏，`extractJson`（`parsers/json.ts`）会剥离并容错解析。
- 解析或 Zod 校验失败 → `build-prompt` 追加「修复要求」重试一次（`retryCount` 递增，超过阈值记失败）。

## 上下文构建（context-builder）

`context/context-builder.ts` 提供按场景拼装上下文的 builder：

| Builder | 用途 |
|---|---|
| `buildChatContext` | 对话式项目设定（多轮历史 + 现有设定） |
| `buildChapterContext` | 章节类任务（项目 + 人物 + 视觉档案 + 大纲 + 前文 + 评分 + 记忆） |
| `buildAnalysisContext` | 分析类（项目 + 章节正文 + 人物 + 记忆） |
| `buildMemoryContext` | 记忆提取（项目 + 章节正文） |
| `buildEvaluationContext` | 评分（项目 + 章节正文 + 视觉方向） |
| `buildScriptContext` | 剧本（项目 + 改编 + 分集 + 场景） |
| `buildShotContext` | 镜头（场景 + 镜头 + 视觉风格） |
| `buildAdaptationContext` | 分集（项目 + 全书大纲） |
| `buildCreativeContext` | 创意诊断（创作材料 + 本地样本库 + 既有评分/曲线/任务/闸门） |

`build-prompt.node.ts` 按 `effectiveTaskType` 选择 builder，拼成「# 输入材料」段落。

## 创意诊断任务（v1.1）

`creative_strategy` 任务组包含：

- `analyze_trope_freshness`：套路新鲜度评分，识别可预判点。
- `generate_anti_trope_variants`：生成 conservative / balanced / wild 三档反套路方案。
- `analyze_narrative_curve`：输出钩子、冲突、反转、情绪、悬念、新鲜度曲线。
- `generate_revision_tasks`：把诊断意见转成可应用的修稿任务单。
- `run_quality_gate`：判断是否可进入下一生产阶段。
- `simulate_audience_reaction`：模拟目标观众留存、吐槽和可剪素材。
- `analyze_video_cost_risk`：提前判断视频生成难度和返工风险。
- `extract_case_structure`：把用户上传样本文档中的内容抽象成本地样本库结构标签。

所有任务均为 JSON 输出并落库；内容改写类任务和修稿任务应用会自动创建 `content_versions` 快照。

## 模板系统（v0.8）

模板让用户自定义可复用 prompt 片段，支持 `{{变量}}` 占位符：

- **类型**：project / character / outline / chapter / evaluation / episode / script / shot / prompt / pitch。
- **作用域（scope）**：模板可绑定一个生成类 taskType（如 `generate_project`）。运行时：
  1. `template:run` 渲染变量 → 记录 `template_runs` 快照。
  2. 以 `taskType='template_run'` + `templateScope` + `templateContent` 调 `ai.run`。
  3. graph 各节点经 `effectiveTaskType(taskType, templateScope)` 把 template_run 透传为对应生成类任务，复用其解析/校验/预览落库闭环。
- 变量渲染：`renderTemplate(content, variables)`（`prompts/template-render.ts`），未提供值的变量保留占位符交给模型补全。
- 前端「模板」页实时提取变量并生成填写表单。

## 多 Agent 编剧室（v0.8）

独立工作流 `writing-room.graph.ts`（非 novel-workflow）：

```
load_target_context → review_all（各 Agent 串行审稿）→ consolidate（主编整合）→ END
```

- **9 个内置 Agent**（`core/constants/agents.ts`）：小说主编 / 短剧策划 / 爽点优化 / 人物关系 / 视觉导演 / 分镜导演 / Prompt 工程师 / 合规审查 / 剧本医生。每个有独立 `systemPrompt`（人格 + 审稿维度）。
- 每个 Agent 输出 `AgentReviewResult`（score/issues/suggestions/summary），结构化、可对比。
- 主编 Agent 汇总所有意见，产出 `WritingRoomConsolidated`（score/keyIssues/revisionPlan）。
- Agent 配置存 `agent_profiles` 表，可在「Agent 设置」页增删改（内置预设不可删，仅可改 systemPrompt）。
- Prompt 文件：`zh-CN/agent/agent-review.md`（共用，`{{AGENT_SYSTEM_PROMPT}}` 注入角色）+ `consolidate-review.md`。

## 内置预设 Seed

应用首次启动时（`electron/db.ts` 的 `seedBuiltInPresets`）幂等 upsert：

- 9 个内置 Agent（按 `role` 幂等）。
- 若干内置模板（按 `name` 幂等）。
- 11 个内置类型预设（按 `name` 幂等）。

已存在记录不覆盖用户改动，仅补 `builtIn` 标记。
