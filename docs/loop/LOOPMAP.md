# LOOPMAP：从数据工作台到可交付的 AI 漫剧制作系统

> - 编制日期：2026-08-11
> - 目标分支：`main`
> - 执行规则：[LOOPRULE.md](./LOOPRULE.md)
> - 当前状态：LM6-00、LM6-01、LM6-02、LM6-03、LM6-04、LM6-05、LM6-06、LM6-10、LM6-11、LM6-12、LM6-13、LM6-14、LM6-15、LM6-20 已完成并已推送；其余 Loop 为 `todo`。
> - 执行模式：无人值守 sweep；当前 sweep 为 `0`，下一个游标为 `LM6-21`。

## 1. 总体目标与范围

### 1.1 产品目标

把 DramaIP 从“能力很多但主要以数据表单、级联选择器和 Agent 参数面板呈现”的工作台，升级为：

> 本地优先、可审查、可持续经营 IP 的 AI 短剧制作系统。

产品提供两种互通而非割裂的工作方式：

1. **快速试制模式**：灵感 / 原著导入 / 直接剧本 → 剧本确认 → 自动提取角色与场景 → 选择视觉风格 → 1–3 集试制 → 静帧确认 → 成本预检 → 视频或 NLE 交付。
2. **导演精修模式**：编辑结构与节奏、比较和锁定资产版本、调整 Prompt、按需选择 Provider / 模型、审查谱系与成本、批量生成或重拍、进入多轨时间线。

三个阶段的结果定义如下：

- **P0：更快获得第一个可信结果。** 三种创建入口都能进入项目生产驾驶舱；默认助手只展示上下文动作；导入内容形成可审查的提取变更包；新项目以 1–3 集试制为默认路径。
- **P1：把生产过程变成视觉化导演工作台。** 角色、场景、道具、音色资产可预览、比较、采用、锁定并追踪镜头用途；分镜以卡片看板呈现；静帧确认成为付费视频前置 Gate；集级节奏曲线与常驻 Story Bible 支持精修。
- **P2：形成可播放、可交付、可协作的闭环。** 多轨时间线可播放；对白、旁白、BGM、音效和字幕可自动编排；至少一条真实后期交付路径通过验证；支持系列 Story Bible、跨项目资产复用和可撤销的云审片 / 多人评论。

### 1.2 需求来源与事实来源

本 LOOPMAP 将上一轮竞品分析提出的 P0 / P1 / P2 收敛为实现计划，并以仓库当前实现和以下文档作为事实基线：

- [ROADMAP.md](../product/ROADMAP.md)
- [LM5-02：三种创建路径与项目生产简报](../product/LM5-02-PRODUCTION-BRIEF.md)
- [LM5-03：主内容导入](../product/LM5-03-SOURCE-IMPORT.md)
- [LM5-04：四区任务导向工作台](../product/LM5-04-FOUR-ZONE-NAVIGATION.md)
- [LM5-05：故事圣经变更包](../product/LM5-05-STORY-BIBLE-CHANGE-SETS.md)
- [LM5-06：真实覆盖率与试播编排](../../dramaip-desktop/docs/product/LM5-06-COVERAGE-PILOT-PLAN.md)
- [LM5-07：生产谱系、能力快照与成本账本](../../dramaip-desktop/docs/product/LM5-07-LINEAGE-COST-LEDGER.md)
- [LM5-08：版权与授权资产台账](../../dramaip-desktop/docs/product/LM5-08-RIGHTS-LEDGER.md)
- [LM5-09：版本化角色与场景生产资产包](../../dramaip-desktop/docs/product/LM5-09-VISUAL-ASSET-PACKS.md)
- [桌面端用户指南](../../dramaip-desktop/docs/product/USER_GUIDE.md)
- [云端平台说明](../../dramaip-platform/README.md)

文档与代码冲突时，以可运行代码、数据库结构、HTTP 契约和重新执行的验证结果为准；同时在所属 Loop 内修正文档，不允许保留两套产品真相。

### 1.3 竞品优点的吸收方式

| 竞品模式                                              | 值得吸收的优点                                 | DramaIP 的落点                                           | 不照搬的边界                                         |
| ----------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| LTX Studio 一类的一体化视觉制作                       | 从概念直接进入镜头、资产与时间线，结果导向明确 | 三入口、试制向导、分镜看板、多轨时间线                   | 不做不可审查的黑盒“一键成片”                         |
| Katalist / StoryboardHero 一类的 AI 分镜              | 以缩略图和角色一致性组织镜头，低成本迭代快     | 视觉资产中心、版本锁、静帧先行、镜头覆盖率               | 不把单一图片或视频 Provider 写死到领域模型           |
| NolanAI / Celtx / StudioBinder 一类的编剧与制片工作流 | 用剧本、场景、任务阶段组织复杂生产             | 项目驾驶舱、单一下一步、Story Bible 侧栏、阶段 Gate      | 不牺牲本地数据所有权，不把管理字段暴露成主体验       |
| CapCut 一类的时间线编辑器                             | 播放反馈即时，字幕和音频自动化成熟             | 可播放多轨时间线、自动对白 / 旁白 / BGM / SFX / 字幕编排 | 不在本轮复制完整专业 NLE；优先保证可靠交付           |
| Frame.io 一类的云审片                                 | 带时间码评论、分享、决策与版本反馈闭环         | 复用现有 review package、工作区、评论游标和对象存储能力  | 云端始终可选；不上传完整本地数据库、密钥或未选择媒体 |

### 1.4 非目标

- 不新增与 P0 / P1 / P2 主链路无关的小说类型、Agent 任务或新业务域。
- 不移除当前高级模式、既有 Agent task catalog 或 Provider 抽象；只改变默认暴露方式。
- 不以云同步、登录、订阅或团队服务作为 P0 / P1 的依赖。
- 不在桌面端静默执行付费媒体生成，不承诺无法确认的价格、时长或可发布状态。
- 不为追求“全自动”绕过人工采用、资产锁、版权 Gate、成本预检或回滚能力。
- 不在本轮建设完整 DaVinci Resolve / Premiere / Final Cut Pro 等专业 NLE 的全部能力。

## 2. 当前基线与已知缺口

### 2.1 已有可复用能力

- 桌面端已具备本地优先 SQLite、schema / protocol / generated client、项目包、预览采用、版本与任务状态基础设施。
- 已有生产简报、TXT / Markdown / DOCX / EPUB / JSON 导入、Story Bible 变更包、1–3 集试制覆盖率、谱系 / 成本 / 权利台账和版本化视觉资产包的结构基础。
- Agent task catalog 覆盖面广，AI 引擎与模型可配置；远程 Provider 任务具备能力快照、提交、轮询和结果采用的基础。
- 平台端已有账号、工作区、成员、review package、私有对象存储、带游标评论 / 决策、过期与删除等云审片基础，不应另起一套服务。

### 2.2 需要本轮解决的体验与交付缺口

| 现状                                                     | 缺口                                                       | 影响                               | 对应 Loop      |
| -------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- | -------------- |
| 首页主要是标题与类型的新建表单                           | 三种创建路径没有成为真实首页主体验                         | 首次价值慢，用户不知道从哪里开始   | LM6-01         |
| 文档描述四区工作台，实际仍以多个全局导航和通用工作区为主 | 项目状态、阻塞与下一步不聚焦                               | 用户在页面与级联选择器间寻找流程   | LM6-02         |
| 默认助手暴露引擎、任务、模型、盲测等实现参数             | 新用户必须先理解内部架构                                   | 认知负担高且容易误配               | LM6-03         |
| 导入主稿已存在，但内容提取能力分散                       | 没有一次性、可审查的人物 / 场景 / 道具 / 摘要 / 改编建议包 | 导入后仍需大量手工搬运             | LM6-04         |
| 已有试制覆盖率与计划概念                                 | 缺少串联内容、剧本、分镜与人工 Gate 的向导                 | 试制不是一条可恢复的用户旅程       | LM6-05         |
| 视觉资产已有结构与锁                                     | 界面仍偏表单，媒体预览、版本比较和镜头用途不够直观         | 难以保持角色与场景一致性           | LM6-10         |
| 分镜、镜头和生产任务已存在                               | 缺少导演可扫视和重排的卡片看板                             | 生产过程不够视觉化                 | LM6-11         |
| 已有渲染预检和远程视频任务                               | 静帧采用、资产锁、权利、费用与提交快照现已由服务端统一 Gate | 避免在错误视觉方向上浪费高成本生成 | LM6-12         |
| 爽点、节拍、反转等分析有数据基础                         | 没有在集级工作区形成可定位的节奏曲线                       | 诊断与修改脱节                     | LM6-13         |
| Story Bible 页面和变更包已存在                           | 写作时不能常驻查看当前人物、时间线、伏笔和视觉锁           | 连续性记忆与正文编辑割裂           | LM6-14         |
| 有镜头、视频、配音、字幕等实体 / 任务                    | 没有可播放的多轨编辑语义和自动装配结果                     | 无法形成“看得见”的成片结构         | LM6-20、LM6-21 |
| 有预检和片段级远程生成                                   | 最终 MP4 尚无可信本地路径，NLE 交换也需真实导入证据        | “最终交付”不能标记完成             | LM6-22         |
| Story Bible 与资产主要属于单项目                         | 系列级连续性和跨项目资产复用不足                           | IP 长期经营成本高                  | LM6-23         |
| 平台已有云审片后端基础                                   | 桌面发布、Web 审片、多人评论回流尚未形成经验证闭环         | 外部审片反馈无法进入本地修订       | LM6-24         |

### 2.3 当前验证可信度

- 编写本规划时仓库位于 `main`，工作区已有不属于本文件的修改；执行任何开发 Loop 前必须先确认这些修改的归属，保留它们，并在干净分支或独立 worktree 中开始。
- 本次只编写规划，未重新运行桌面端或平台端测试。既有 release note、roadmap 和历史执行记录中的“通过”只能视为历史证据，不能直接作为 LM6 的通过结论。
- 在 LM6-00 完成之前，`typecheck`、unit、E2E、生成物一致性、Provider 能力、桌面安装包、云审片跨栈测试和真实 NLE 导入均记为 **unknown / untrusted**。
- 真实 Provider、对象存储、签名环境或外部 NLE 的历史结果均为 **unknown / untrusted**；对应 Loop 必须先以预置 fake provider、本地 Compose、reference parser 或结构化 fixture 建立无人值守必达验收。真实环境可增加兼容证据，但缺失时不得让执行器原地等待。

## 3. 兼容性与安全约束

所有 Loop 都必须遵守以下不变量；触犯任一项即验收失败：

1. **本地优先**：P0 / P1 离线可用；云审片是显式 opt-in，断网不阻塞本地创作、资产管理和 NLE 导出。
2. **数据兼容**：数据库只做可迁移、可回滚或有兼容读取策略的变更；旧项目打开后不丢数据；新增字段有安全默认值；项目包 round-trip 后语义不变。
3. **人工控制**：AI 输出默认是草案、候选或变更包；只有用户明确“采用 / 锁定 / 应用”后才能进入权威实体；支持撤销并显示 stale 状态。
4. **成本可见**：付费或可能付费的远程任务提交前必须显示能力、输入范围、预计成本或“未知”、幂等键及取消 / 重试边界；未知成本不能被渲染成 0。
5. **版权 Gate**：导入、复用、生成和云端发布都继承权利台账；缺失、过期或用途不允许时阻断对应动作，不阻断安全的本地编辑。
6. **Provider 中立**：领域模型保存能力需求与冻结快照，不把具体 Provider / 模型 ID 写成业务前提；Provider 不可用时显示真实原因和可行替代路径。
7. **谱系完整**：所有生成或导出结果记录源实体版本、资产版本、Prompt / 参数、能力快照、成本状态、时间和采用人；锁定结果不能被后台任务静默替换。
8. **最小上传**：诊断包、默认项目包和云审片包不携带 API key、授权证明正文、未选媒体或完整本地数据库；上传清单须可预览、校验、撤销与删除。
9. **高级能力保留**：简单模式隐藏复杂性但不删除高级模式；现有 task catalog、深链和自动化调用在兼容层内继续工作。
10. **诚实状态**：未安装、未知、等待人工、失败、过期和已交付必须区分；mock 结果、预检通过或文件生成不能冒充真实 Provider 成功、真实播放或真实 NLE 导入。
11. **可访问与可恢复**：关键动作支持键盘和明确焦点；长任务可恢复、可重试且不会重复扣费或重复采用；空态、失败态和降级态都纳入测试。

## 4. Loop 粒度策略与完成定义

### 4.1 粒度策略

- 每个功能 Loop 都交付一个可独立演示、审查、验证和回滚的用户结果；schema、协议、服务、UI、测试和用户文档随该结果同 Loop 完成。
- LM6-00、LM6-06、LM6-15、LM6-25 是独立 Gate：它们产生可复查的基线或阶段放行证据，因此允许以验证与发布收口为主。
- 默认按本文件顺序逐个**尝试**，同一时刻只允许一个 Loop 分支或隔离 worktree 产生改动；当前尝试达到 `done` 或安全收束为 `partial` 后，立即把调度权交给下一个可推进项。
- 依赖影响最终验收和调度优先级，不构成原地等待理由；前置 Loop 未 `done` 时，可推进不依赖其最终实现的 fixture、纯函数、契约、兼容层或 UI 隔离工作，并以 checkpoint 保存。
- Loop 过大时，只能沿可独立验收的用户结果或风险边界拆分；不得把“写 schema”“补接口”“补测试”“补文档”单独拆成微型 Loop。

### 4.2 状态定义

- `todo`：尚未开始；本文件初始所有 Loop 均为此状态。
- `doing`：当前唯一占用执行权、且已有明确分支或 worktree 的尝试；让出执行权前必须转为 `done` 或 `partial`。
- `partial`：本次尝试已按未完成流程安全收束，分支 / worktree、证据和可直接执行的 `Next attempt` 已保存；等待后续 sweep 自动重新入队，不是暂停或终态。
- `done`：开发、验证、diff review、提交、同步目标分支、`--no-ff` 合并、合并后验证、远端推送和分支清理全部完成。

禁止增加 `blocked`、`waiting-human` 或 `failed-final` 等永久跳过状态。执行器异常退出后遗留的 `doing` 必须先审计现场，再恢复为 `partial` 并重新入队。

### 4.3 单 Loop 完成条件

每个 Loop 只有同时满足以下条件才能从 `doing` 改为 `done`：

1. 目标、scope、non-scope 和验收条件没有被实现过程悄悄扩大或缩小。
2. checklist 全部完成，相关 schema / protocol / generated client / docs 一致。
3. 目标测试、失败路径、旧数据兼容和预先定义的机器可采集验收通过；原验证不可用时，必须是本文件预先定义的等价替代检查通过，仅记录原因不算通过。
4. `git diff --check` 通过，逐文件审查最终 diff，无调试代码、秘密、生成垃圾或无关改动。
5. Loop 分支已有可追溯提交，并在合并前重新同步最新 `origin/main`。
6. 使用 `--no-ff` 合并到 `main`，在合并结果上再次运行规定验证。
7. `main` 已推送到 `origin`，远端包含合并提交。
8. 本地 Loop 分支已清理，当前回到 `main`，工作区干净或仅保留已明确登记的用户修改。
9. 在本文末尾“执行记录”追加本次尝试证据，不重写历史记录。

任何一项未满足时，本次结果只能是 `partial`。单次失败、一次 sweep 结束、外部依赖暂不可用或暂时零进展都不能结束整批任务。

### 4.4 整批完成条件

只有以下条件同时成立，整张 LOOPMAP 才能结束：

1. 19 个 Loop 全部为 `done`，不存在 `todo`、`doing` 或 `partial`。
2. LM6-00、LM6-06、LM6-15、LM6-25 四个 Gate 均通过，跨 Loop 回归通过。
3. 所有 checkpoint 已合入、确认无保留价值或安全清理，没有遗失的 loop worktree。
4. `main` 已同步并推送，远端包含全部合并提交。
5. 每个 Loop 的最终成功记录都能关联历史 `partial` 的解决证据。
6. 当前分支、工作区和远端没有未解释残留。

## 5. 执行约定

### 5.1 Git 流程

每个 Loop 遵循 [LOOPRULE.md](./LOOPRULE.md) 的标准流程，目标分支固定为 `main`，分支名固定为 `loop/<loop-id>-<short-topic>`，例如 `loop/lm6-01-three-entry`。

开始前：

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c loop/lm6-01-three-entry
```

若 `git status` 显示非本 Loop 的修改，不得 reset、覆盖或顺手提交；自动改用从最新 `origin/main` 创建的隔离 worktree。若无法安全创建，记录状态、分支与失败命令，当前尝试收束为 `partial`，继续 sweep，不等待人工回复。

实现与本地验证后：

```bash
git diff --check
git diff --stat
git diff
git add <本 Loop 明确拥有的文件>
git commit -m "feat: complete LM6-01 three-entry creation"
```

本次尝试不能完成但已有安全、可编译且值得保留的工作时，在 Loop 分支执行累计 diff review 后创建 checkpoint：

```bash
git add <本 Loop 明确拥有的文件>
git commit -m "loop(lm6-01): checkpoint <unfinished-topic>"
git push -u origin loop/lm6-01-three-entry
```

checkpoint 不合入 `main`，不表示完成。远端不可用时保留隔离 worktree 和本地分支，并在执行记录中写出绝对位置与恢复命令。

合并与收尾：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff loop/lm6-01-three-entry
# 在合并结果上重新执行本 Loop 验证
git push origin main
git branch -d loop/lm6-01-three-entry
git status --short --branch
```

出现冲突时先中止未完成的合并，回到 Loop 分支解决、重跑验证并产生新的可审查提交；本次无法安全解决则保存 checkpoint、记录冲突文件与再进入命令，收束为 `partial`。禁止把冲突状态或未验证结果留在 `main` 后继续 sweep。

### 5.2 验证命令基线

按变更面选择最小充分验证；阶段 Gate 执行完整集合。

桌面端基础命令（工作目录 `dramaip-desktop`）：

```bash
bun run typecheck
bun run lint
bun run test:unit
bun run check:generated
bun run check:engine-locks
bun run check:provider-catalog
bun run build
bun run test:e2e
```

平台端基础命令（工作目录 `dramaip-platform`）：

```bash
make test
make platform-up
make platform-e2e
make platform-down
```

约定：

- 修改 schema / protocol / HTTP API 时，必须重新生成 client，并运行 `check:generated`、repository conformance 和项目包 round-trip。
- 修改 Agent 路由或 Provider 能力时，必须运行 engine lock、provider catalog、预检 / 幂等 / 重试相关测试。
- 修改主旅程、看板、时间线或审片时，必须增加 Electron / Web E2E；只测组件快照不够。
- 真实 Provider、云对象存储和实际 NLE 导入可作为附加证据，但不能成为无人值守完成的唯一信号；必达验收必须有本地 fixture、参考 parser、结构化输出或 headless E2E。真实证据须记录环境、输入 fixture、输出摘要与时间，不在仓库中保存密钥或私有媒体。
- `make platform-up` 成功后无论验证结果如何都执行 `make platform-down`；失败日志可脱敏保存，基础设施不遗留运行状态。

### 5.3 未完成尝试的统一收束

任一实现、验证、同步、合并、推送或环境动作未能在本次尝试内完成时：

1. 终止持续等待输入、锁、网络或无新输出的进程；退出未完成的 merge / rebase / cherry-pick 中间状态。
2. 执行 `git status --short --branch`、适用的 `git diff --check` 和累计 diff review，确认没有凭据、缓存、其他 Loop 或用户改动。
3. 安全且有保留价值的改动创建 `loop(<loop-id>): checkpoint ...`，有远端时推送同名 Loop 分支；不安全或不可编译的改动只保留在隔离 worktree，不得进入 `main`。
4. 将 Loop 状态更新为 `partial`，在执行记录追加 `Completed`、`Unfinished`、`Evidence`、`Next attempt`、分支 / worktree 和 `Sweep cursor`。
5. `Next attempt` 必须给出下一轮首条可直接运行的命令或具体文件 / 测试入口，并同时写明该动作再次失败时的安全替代方案。
6. 回到干净 `main` 或切换到下一个隔离 worktree；不得停在交互式命令、等待回复或失败后的目标分支上。

推送失败时保留 Loop 分支并在后续 sweep 先运行 `git ls-remote origin` 再重试；合并后验证失败时不得推送，使用项目批准的非破坏性 revert 恢复本次 merge，再保存 Loop 分支现场。任何收束都不得撤销他人提交或本 Loop 范围外的修改。

### 5.4 Sweep 与挂机策略

- **扫描顺序**：按第 9 节顺序扫描所有非 `done` Loop；依赖已满足者优先。依赖未满足时记录 skip，不等待，尝试该 Loop 的隔离 fixture / 契约工作或继续下一个条目。
- **游标**：初始 `Sweep 0 / LM6-00`。每次尝试记录下一个 Loop ID；进程异常退出后，以最后一条执行记录的 `Sweep cursor` 为准，并先审计遗留 `doing`。
- **重试**：到达表尾仍有 `todo` / `partial` 时立即开始下一 sweep。重试先读取最新 `Evidence` 与 `Next attempt`，不得原样重复已证明无效的命令。
- **命令超时**：格式、生成物和定向 unit 单次 10 分钟；typecheck / lint / build / 全量 unit 单次 20 分钟；桌面 E2E、平台 `make test`、Compose E2E 单次 40 分钟；Provider 轮询、上传和下载单次尝试 15 分钟。超时只结束本次尝试，不结束 Loop 或整批任务。
- **无进展判定**：同一尝试中同一命令连续两次得到等价失败，或 10 分钟没有新日志 / 文件 / 测试证据，即停止重复并按 5.3 收束。
- **checkpoint**：`partial` 默认保留 `loop/<loop-id>-<topic>`；可安全提交时推送远端 checkpoint。完成并进入 `main` 后才安全删除本地及远端 Loop 分支。
- **零进展 sweep**：若整轮没有 Loop 产生新 commit、通过新测试或缩小 `Unfinished`，下一 sweep 自动执行恢复分析：重算依赖、优先纯函数 / fixture / contract、缩小失败测试、切换本地 mock / reference parser、补诊断，然后更新各项 `Next attempt` 后继续。
- **凭据与外部资源**：不交互等待凭据。Provider 不可用时使用现有 fake provider / deterministic fixture 验证领域行为；Docker 不可用时先完成平台 unit / contract 并保存 checkpoint；NLE 使用参考 parser 和 round-trip validator 作为必达信号，真实软件导入仅作附加证据。
- **正常终止条件**：只有 4.4 的整批完成条件成立。运行环境被强制终止时只记录“执行中断、可恢复”，不能输出完成总结。

### 5.5 初始调度状态

| 字段                     | 初始值                                              |
| ------------------------ | --------------------------------------------------- |
| Sweep                    | `0`                                                 |
| Sweep cursor             | `LM6-00`                                            |
| Active loop              | `none`                                              |
| Last batch progress      | `none`                                              |
| Pending checkpoint audit | `none`；执行前仍须扫描 `loop/lm6-*` 分支和 worktree |

### 5.6 挂机可执行性审查矩阵

下表中的 fixture 和测试入口是各 Loop 的同轮交付物；文件尚不存在时，创建该入口就是本次尝试的首个确定动作，不需要临场询问。除 LM6-24 标注的平台命令外，命令均在 `dramaip-desktop` 执行；fixture 统一使用合成内容，不含真实媒体、凭据或绝对用户路径。

| Loop   | 确定性输入 / 路径                                | 机器主验收                                                                                    | 外部能力不可用时的等价路径                                                                    |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| LM6-00 | `tests/fixtures/lm6/lm6-00/`                     | `bun test tests/lm6/lm6-00.test.ts`；完整桌面命令                                             | 仅使用合成旧项目与项目包，不依赖 Provider                                                     |
| LM6-01 | `tests/fixtures/lm6/lm6-01/`                     | `bun test tests/lm6/lm6-01.test.ts`；`bunx playwright test tests/electron/lm6-01.spec.ts`     | 导入解析使用本地受支持文件 fixture                                                            |
| LM6-02 | LM6-00 四类项目 fixture                          | `bun test tests/lm6/lm6-02.test.ts`；`bunx playwright test tests/electron/lm6-02.spec.ts`     | 缺上游 UI 时使用 route harness 与冻结 context                                                 |
| LM6-03 | task catalog + fake provider catalog             | `bun test tests/lm6/lm6-03.test.ts`；`check:engine-locks`；`check:provider-catalog`           | deterministic fake provider 覆盖能力 / 成本 / 结果                                            |
| LM6-04 | 分章节小说与冲突实体 fixture                     | `bun test tests/lm6/lm6-04.test.ts`；`bunx playwright test tests/electron/lm6-04.spec.ts`     | 版本化 extraction replay 代替在线模型                                                         |
| LM6-05 | 1 / 2 / 3 集 pilot state fixture                 | `bun test tests/lm6/lm6-05.test.ts`；`bunx playwright test tests/electron/lm6-05.spec.ts`     | recorded task completion replay 验证 resume / retry                                           |
| LM6-06 | P0 全路径 fixture                                | `bunx playwright test tests/electron/lm6-p0-gate.spec.ts`；完整桌面命令                       | fake provider + 离线模式是必测分支                                                            |
| LM6-10 | 四类资产、缺失 / 损坏媒体 fixture                | `bun test tests/lm6/lm6-10.test.ts`；`bunx playwright test tests/electron/lm6-10.spec.ts`     | 本地小型图片 / 音频 fixture，不调用生成服务                                                   |
| LM6-11 | 1 / 100+ shot board fixture                      | `bun test tests/lm6/lm6-11.test.ts`；`bunx playwright test tests/electron/lm6-11.spec.ts`     | 固定缩略图和资产 coverage replay                                                              |
| LM6-12 | readiness / rights / cost truth table            | `bun test tests/lm6/lm6-12.test.ts`；`bunx playwright test tests/electron/lm6-12.spec.ts`     | 调用记录型 fake provider 证明零付费请求                                                       |
| LM6-13 | 短 / 长 / 无数据节奏 fixture                     | `bun test tests/lm6/lm6-13.test.ts`；`bunx playwright test tests/electron/lm6-13.spec.ts`     | 全部派生计算本地运行                                                                          |
| LM6-14 | chapter / Story Bible relation fixture           | `bun test tests/lm6/lm6-14.test.ts`；`bunx playwright test tests/electron/lm6-14.spec.ts`     | editor harness 代替未完成页面集成                                                             |
| LM6-15 | P1 1 / 3 集视觉试制 fixture                      | `bunx playwright test tests/electron/lm6-p1-gate.spec.ts`；完整桌面命令                       | 本地媒体覆盖成功、丢失与损坏状态                                                              |
| LM6-20 | 固定 timebase 的短 / 长多轨媒体                  | `bun test tests/lm6/lm6-20.test.ts`；`bunx playwright test tests/electron/lm6-20.spec.ts`     | 仓库内小型合成代理媒体，不要求硬件编码器                                                      |
| LM6-21 | dialogue / narration / music / SFX / cue fixture | `bun test tests/lm6/lm6-21.test.ts`；`bunx playwright test tests/electron/lm6-21.spec.ts`     | 确定性音频和 TTS replay                                                                       |
| LM6-22 | canonical timeline + relink fixture              | `bun run check:timeline-exports`；`bun test tests/lm6/lm6-22.test.ts`                         | FCPXML schema、OTIO reference parser、EDL round-trip；真实 NLE / MP4 可选                     |
| LM6-23 | 两项目一系列与引用冲突 fixture                   | `bun test tests/lm6/lm6-23.test.ts`；`bunx playwright test tests/electron/lm6-23.spec.ts`     | 完全本地 SQLite 与项目包 fixture                                                              |
| LM6-24 | `dramaip-platform/scripts/fixtures/lm6-review/`  | 平台 `make test`、`node scripts/lm6-review-e2e.mjs`；桌面 `bun test tests/lm6/lm6-24.test.ts` | fake review gateway + object-store adapter 完成两身份 / cursor / 删除契约；Compose 为增强验证 |
| LM6-25 | 全链 1 集、第二项目与审片 fixture                | `bunx playwright test tests/electron/lm6-full-journey.spec.ts`；完整桌面与平台命令            | fake provider、reference parser 和本地 review harness 构成无人值守必达链                      |

审查结论：19 个 Loop 均已有确定输入、测试入口、最长 40 分钟的单次命令上限、`partial` checkpoint 和不依赖临场人工输入的降级路径；因此可以进入无人值守 sweep。若执行中发现某个代理标准不能验证同一用户结果，必须先在该 Loop 内补足自动化或拆出独立风险边界，不能退回等待人工。

## 6. P0 / P1 / P2 覆盖矩阵

| 优先级 | 必须完成的内容                                                   | 实现 Loop | 放行 Gate |
| ------ | ---------------------------------------------------------------- | --------- | --------- |
| P0     | 首页三种创建路径                                                 | LM6-01    | LM6-06    |
| P0     | 创建后进入生产驾驶舱，显示当前结果、阻塞和唯一建议下一步         | LM6-02    | LM6-06    |
| P0     | 助手默认隐藏引擎 / 模型 / task / benchmark，只提供上下文动作     | LM6-03    | LM6-06    |
| P0     | 原著导入后生成角色、场景、道具、章节摘要、改编建议的可审查变更包 | LM6-04    | LM6-06    |
| P0     | 1–3 集试制向导和人工 Gate                                        | LM6-05    | LM6-06    |
| P1     | 角色 / 场景 / 道具 / 音色资产中心                                | LM6-10    | LM6-15    |
| P1     | 多版本视觉比较、采用、锁定和镜头用途追踪                         | LM6-10    | LM6-15    |
| P1     | 卡片式分镜看板                                                   | LM6-11    | LM6-15    |
| P1     | 静帧确认后才能进入视频生成                                       | LM6-12    | LM6-15    |
| P1     | 节拍 / 爽点 / 反转 / 悬念曲线                                    | LM6-13    | LM6-15    |
| P1     | Story Bible 常驻章节编辑器旁                                     | LM6-14    | LM6-15    |
| P2     | 可播放多轨时间线                                                 | LM6-20    | LM6-25    |
| P2     | 对白 / 旁白 / BGM / SFX / 字幕自动编排                           | LM6-21    | LM6-25    |
| P2     | 最终 MP4 或稳定 FCPXML / OTIO / EDL 后期交付                     | LM6-22    | LM6-25    |
| P2     | 系列 Story Bible 和跨项目资产复用                                | LM6-23    | LM6-25    |
| P2     | 可选云审片和多人带时间码评论                                     | LM6-24    | LM6-25    |

## 7. Loop 总表

| Loop ID | Priority | Owner               | Status | Attempts | Last progress                                    | 目标                                  | 依赖          |
| ------- | -------- | ------------------- | ------ | -------- | ------------------------------------------------ | ------------------------------------- | ------------- |
| LM6-00  | P0 Gate  | Release             | done   | 1        | 基线契约、往返测试、完整回归和远端 main 推送通过 | 建立可信基线、迁移 fixture 和结果指标 | 无            |
| LM6-01  | P0       | Desktop UX          | done   | 1        | 三入口、生产简报、完整回归和远端 main 推送通过   | 三种创建入口与生产简报落地            | LM6-00        |
| LM6-02  | P0       | Desktop UX          | done   | 1        | 驾驶舱、四区上下文、完整回归和远端 main 推送通过 | 项目生产驾驶舱与唯一下一步            | LM6-01        |
| LM6-03  | P0       | AI Workflow         | done   | 1        | 助手、偏好、完整回归和远端 main 推送通过         | 上下文助手与简单 / 高级双层体验       | LM6-02        |
| LM6-04  | P0       | AI Workflow         | done   | 1        | 五类候选、完整回归和远端 main 推送通过           | 导入后的五类提取变更包                | LM6-03        |
| LM6-05  | P0       | Production Workflow | done   | 1        | 试制向导、完整回归和远端 main 推送通过           | 1–3 集可恢复试制向导                  | LM6-04        |
| LM6-06  | P0 Gate  | Release             | done   | 1        | P0 矩阵、完整回归和远端 main 推送通过           | P0 首次价值与兼容性放行               | LM6-01…LM6-05 |
| LM6-10  | P1       | Media Assets        | done   | 1        | 资产中心、完整回归和远端 main 推送通过           | 统一资产中心、版本比较、锁与用途      | LM6-06        |
| LM6-11  | P1       | Storyboard UX       | done   | 1        | 导演看板、完整回归和远端 main 推送通过           | 卡片式导演分镜看板                    | LM6-10        |
| LM6-12  | P1       | Media Pipeline      | done   | 1        | 静帧 Gate、完整回归和远端 main 推送通过         | 静帧先行与视频成本 Gate               | LM6-11        |
| LM6-13  | P1       | Story Intelligence  | done   | 1        | 节奏看板、修订预览、完整回归和远端 main 推送通过 | 集级节奏曲线与定位修订                | LM6-12        |
| LM6-14  | P1       | Story Intelligence  | done   | 1        | 侧栏、选择性采用、完整回归和远端 main 推送通过   | 章节编辑器常驻 Story Bible            | LM6-13        |
| LM6-15  | P1 Gate  | Release             | done   | 1        | P1 矩阵、三集 Gate、完整回归和远端 main 推送通过 | P1 视觉试制闭环放行                   | LM6-10…LM6-14 |
| LM6-20  | P2       | Timeline Editor     | todo   | 0        | —                                                | 可播放、可编辑的多轨时间线            | LM6-15        |
| LM6-21  | P2       | Media Pipeline      | todo   | 0        | —                                                | 音频与字幕自动编排                    | LM6-20        |
| LM6-22  | P2       | Delivery            | todo   | 0        | —                                                | 真实可验证的后期交付路径              | LM6-21        |
| LM6-23  | P2       | Core Data           | todo   | 0        | —                                                | 系列 Story Bible 与跨项目资产库       | LM6-22        |
| LM6-24  | P2       | Review Integration  | todo   | 0        | —                                                | 桌面到云审片再到本地反馈闭环          | LM6-23        |
| LM6-25  | P2 Gate  | Release             | todo   | 0        | —                                                | 全链路交付、协作与发布放行            | LM6-20…LM6-24 |

## 8. Loop 详细定义

### LM6-00：可信基线与结果契约

- **Priority**：P0 Gate
- **Owner**：Release
- **Status**：done
- **Depends on**：无
- **Goal**：在改造导航和数据模型前，建立能复现当前事实、保护旧项目并衡量 P0 / P1 / P2 结果的基线。
- **Scope**：桌面端当前三类项目 fixture、旧版本项目包、主要页面 smoke、任务 / Provider 能力快照、阶段状态词典、产品真值文档。
- **Non-scope**：不改变主界面，不新增产品能力，不把历史文档声明直接改成“已通过”。
- **Checklist**：
  1. 固化最小的空项目、小说导入项目、已有剧本 / 分镜项目和含资产锁项目 fixture，并记录 schema 版本与预期实体数。
  2. 建立“首次结果、单一下一步、人工采用、成本 Gate、真实交付”的可机测结果契约和统一状态词典。
  3. 为创建、项目打开、项目包导入 / 导出、深链和任务恢复补足基线测试；记录当前失败而不粉饰。
  4. 核对 ROADMAP、用户指南和当前代码，标记已实现、部分实现、未安装、未知，修复会误导后续 Loop 的事实冲突。
  5. 运行桌面端完整基线命令并保存脱敏摘要；确认现有非本 Loop 改动已隔离。
- **Acceptance**：
  - 所有 fixture 可重复载入，失败时能指出是既有缺陷还是回归；旧项目包不会因测试而被原地升级或覆盖。
  - P0 / P1 / P2 Gate 的每个结果都有可观察信号，不以“组件存在”“请求已发出”代替用户结果。
  - 当前测试状态和产品能力状态有一份一致、可复查的真值记录。
- **Verification**：`bun run typecheck`、`bun run lint`、`bun run test:unit`、`bun run check:generated`、`bun run check:engine-locks`、`bun run check:provider-catalog`、`bun run build`、`bun run test:e2e`；项目包 round-trip 前后做结构化 diff。
- **Risk**：基线 fixture 含有机器路径或真实内容；必须使用合成数据并清除绝对路径、令牌和私有媒体。
- **Rollback boundary**：只回滚 fixture、测试与事实文档，不触碰用户项目数据。
- **未完成收束**：按 5.3 保留 `loop/lm6-00-baseline-contract`；记录首个失败命令、fixture 名、预期 / 实际实体数和当前基线 commit，不把失败基线合入 `main`。
- **下一次动作**：从最新记录的首个失败命令重跑；若完整套件仍超时，先运行对应 package 的定向测试并生成结构化失败清单，再回到完整基线。

### LM6-01：三种创建入口与生产简报

- **Priority**：P0
- **Owner**：Desktop UX
- **Status**：done
- **Depends on**：LM6-00
- **Goal**：让用户从首页明确选择“从灵感开始”“导入原著”“直接导入 / 粘贴剧本”，每条路径都以正确上下文进入同一生产驾驶舱。
- **Scope**：项目创建 UI、production brief、创建来源、内容导入或粘贴、schema / protocol / client、项目包兼容、入口 E2E。
- **Non-scope**：不在本 Loop 运行完整内容提取或试制编排；不删除高级的新建字段。
- **Checklist**：
  1. 以三个结果卡片替换首页的单一通用表单；解释每条路径的输入、首个产出和版权要求。
  2. 为 production brief 增加向后兼容的创建来源、内容形态、目标受众 / 平台、集长、集数、画幅和视觉方向默认值。
  3. 灵感路径保存可继续完善的 brief；原著路径复用 LM5-03 导入预览与权利确认；剧本路径支持粘贴或受支持文件导入。
  4. 三条路径创建成功后携带 project context 进入驾驶舱；取消、解析失败和重复提交不产生半成品项目。
  5. 更新生成 client、项目包 manifest、测试和用户指南；旧项目缺少新字段时使用明确的兼容默认值。
- **Acceptance**：
  - 三条路径都能从空首页独立完成创建并进入同一项目驾驶舱，返回首页后来源与 brief 正确保留。
  - 默认流程不要求选择 Agent task、引擎、模型或 Provider；导入路径在落盘前展示预览和权利确认。
  - LM6-00 的旧项目和项目包可打开、可再次导出，原有深链仍能解析。
- **Verification**：schema / server / app 定向 unit；`bun run check:generated`；三路径 Electron E2E；取消、重复点击、坏文件、空内容和旧项目 fixture 回归；`git diff --check`。
- **Risk**：创建时同时落盘项目与导入内容可能留下孤儿记录；使用事务或显式 draft 生命周期。
- **Rollback boundary**：保留旧创建 API 与兼容默认值；可仅回退新首页和新增 brief 字段读取，不删除已创建项目。
- **未完成收束**：按 5.3 保留 `loop/lm6-01-three-entry`；记录卡在 schema、protocol、server、UI 或 E2E 的具体层及三条路径中已通过的路径。
- **下一次动作**：从第一个未通过层的定向测试继续；若 LM6-00 尚未完成，先以其合成 fixture 完成 route card 与 production brief 隔离测试并 checkpoint。

### LM6-02：项目生产驾驶舱与唯一下一步

- **Priority**：P0
- **Owner**：Desktop UX
- **Status**：done
- **Depends on**：LM6-01
- **Goal**：项目打开后先回答“现在有什么、卡在哪里、下一步做什么”，并让用户从项目上下文进入创作、改编、生产和审查，而不是重新走全局级联选择。
- **Scope**：只读派生的项目阶段状态、阻塞原因、单一推荐动作、最近结果、四区导航、上下文深链、任务中心过滤。
- **Non-scope**：不重写底层领域实体；不删除现有九个路由；不在本 Loop 生成内容。
- **Checklist**：
  1. 从真实实体、采用状态、资产锁、能力和任务状态派生项目阶段；禁止维护第二套可漂移的手工进度。
  2. 驾驶舱突出最近可信结果、阻塞项、覆盖率和一个主要下一步；次要动作收纳到对应任务区。
  3. 落实创作 / 改编 / 生产 / 审查四区项目导航，现有路由保留为高级入口与兼容深链。
  4. 从驾驶舱进入页面时自动带入 project / adaptation / episode / script / scene / shot context，减少通用选择器链。
  5. 覆盖空项目、导入中、等待人工、能力未安装、失败可重试和已完成状态，修正文档中的导航真值。
- **Acceptance**：
  - 任意基线 fixture 打开后只出现一个主要下一步，动作落点与实际阻塞一致，不能跳过必需人工或版权 Gate。
  - 项目内主旅程不再要求重复选择已知父级实体；旧 URL / route 仍可到达相同数据。
  - 未安装、未知、失败和等待人工不会显示为完成或 100% 覆盖。
- **Verification**：阶段派生 table tests；路由与 context unit；四类项目 Electron E2E；键盘导航与空 / 错 / 加载态检查；全量 app tests。
- **Risk**：状态推导规则与旧任务状态冲突；将规则做成纯函数并以 fixture 锁定，不反写业务数据。
- **Rollback boundary**：驾驶舱与导航可回退到旧工作区；派生状态不做破坏性写入。
- **未完成收束**：按 5.3 保留 `loop/lm6-02-production-cockpit`；导出阶段 truth table、失败 fixture、路由与 context diff，避免下一轮重新推导规则。
- **下一次动作**：先运行失败的阶段纯函数 table test；若 LM6-01 尚未完成，使用 LM6-00 fixture 推进只读状态和四区导航，最终集成留待后续 sweep。

### LM6-03：上下文助手与简单 / 高级双层体验

- **Priority**：P0
- **Owner**：AI Workflow
- **Status**：done
- **Depends on**：LM6-02
- **Goal**：默认助手只展示当前页面最有价值的动作，同时保留高级用户对现有 task catalog、引擎、模型、参数和盲测的完整控制。
- **Scope**：上下文动作注册表、推荐路由、简单 / 高级模式、能力与成本预检、预览 / 采用、偏好保存、自动化兼容。
- **Non-scope**：不删除或重命名既有 Agent task type；不替用户自动提交付费任务；不让推荐算法直接写权威数据。
- **Checklist**：
  1. 建立 page state → 可用动作 → 所需输入 / 能力 → 默认 task 路由的类型化注册表，复用 task catalog 而非复制字符串。
  2. 简单模式隐藏引擎、模型、task、benchmark 和低层参数，只显示 1–3 个上下文动作、输入摘要、产出与成本状态。
  3. 高级模式继续提供全部既有 task catalog（编制时为 73 类）和显式引擎 / 模型选择，项目级偏好可恢复。
  4. 无可用 Provider、模型未配置、输入不完整或成本未知时禁用提交并给出可执行修复；本地可做的动作不被远程能力阻塞。
  5. 所有结果先进入 preview / change set；采用、拒绝、重试、取消和 stale 语义与既有任务中心一致。
  6. 为 UI、自动化调用和项目包中的旧 task 引用增加兼容测试，更新用户指南。
- **Acceptance**：
  - 新项目默认助手界面不出现必填的引擎、模型、task 或 benchmark 选择器，仍能完成上下文动作。
  - 切换高级模式后现有任务与参数能力无损；简单模式和高级模式提交同一动作时产生等价、可追溯的任务快照。
  - 任何远程调用前都能看到能力、输入与费用 / 未知状态，结果不会自动采用。
- **Verification**：task registry exhaustive test；简单 / 高级路由 parity；能力缺失、成本未知、取消 / 重试 / 幂等测试；app E2E；`check:engine-locks` 与 `check:provider-catalog`。
- **Risk**：推荐路由隐式改变模型或成本；任务快照必须冻结最终 Provider、模型和参数，并允许提交前展开查看。
- **Rollback boundary**：高级面板保持独立可用；可回退简单模式注册表而不迁移或删除任务记录。
- **未完成收束**：按 5.3 保留 `loop/lm6-03-context-assistant`；记录未覆盖 task type、推荐路由差异、Provider 能力和成本预检失败矩阵。
- **下一次动作**：先运行 task registry exhaustive / parity 测试；远程 Provider 不可用时切换 deterministic fake provider 验证路由、预检和 preview / adopt。

### LM6-04：原著导入后的五类提取变更包

- **Priority**：P0
- **Owner**：AI Workflow
- **Status**：done
- **Depends on**：LM6-03
- **Goal**：导入小说后一次获得角色、场景、道具、章节摘要和改编建议，并在写入权威数据前逐项审查。
- **Scope**：导入完成事件、分段 / 章节引用、提取 orchestration、统一 change set、差异审查、选择性采用、撤销、stale 与失败恢复。
- **Non-scope**：不自动生成最终剧本、分镜或媒体；不在导入事务失败时删除原始文件；不以低置信结果覆盖人工内容。
- **Checklist**：
  1. 以已确认导入版本为不可变输入，生成含源章节 / 文本范围、置信度和冲突标记的五类候选项。
  2. 将五类结果收敛到一个可恢复的 change set，支持按类别和单项采用 / 拒绝、全选预览和修改后采用。
  3. 采用时以事务写入 Story Bible、生产资产草案、章节摘要和 adaptation brief；失败不产生部分权威写入。
  4. 输入版本变化后标记 change set stale；支持撤销已采用批次，并保护采用后的人工编辑。
  5. 对分段超限、模型中断、重复回调、部分失败和无 Provider 建立幂等、重试与降级路径。
  6. 更新导入文档、任务中心聚合、schema / protocol / generated client 和项目包 round-trip。
- **Acceptance**：
  - 使用小说 fixture 导入后能看到五类非伪造候选，每项可追溯到源内容；未采用前权威表不变。
  - 选择性采用是原子的，可撤销；重复完成回调不会重复创建实体；人工同名实体以冲突而非覆盖呈现。
  - Provider 不可用或任务失败时，已导入正文仍完整可编辑，并有明确的继续入口。
- **Verification**：五类 schema / parser tests；事务、幂等、stale、undo 和冲突 tests；导入 → review → selective adopt Electron E2E；项目包 round-trip；`check:generated`。
- **Risk**：大文本成本和超时、同名实体误合并；使用有界分段、稳定 source fingerprint 和显式 merge 决策。
- **Rollback boundary**：变更包批次可整体撤销；原始导入版本与人工既有实体永不随回滚删除。
- **未完成收束**：无；输入 fingerprint、候选状态、采用记录和未采用候选均已持久化，分支证据见本表追加记录。
- **下一次动作**：开始 LM6-05 的 1–3 集可恢复试制向导；继续使用版本化 fixture，真实 Provider 仅作附加证据。

### LM6-05：1–3 集可恢复试制向导

- **Priority**：P0
- **Owner**：Production Workflow
- **Status**：done
- **Depends on**：LM6-04
- **Goal**：把三种创建路径收敛到一条可暂停、可恢复、有人审的 1–3 集试制流程，而不是让新用户从整季复杂生产开始。
- **Scope**：试制范围、源内容选择、剧本 / 分镜计划、依赖任务、人工通过 / 退回、覆盖率、成本与能力摘要、驾驶舱恢复入口。
- **Non-scope**：不在本 Loop 生成正式图片或视频；不允许选择超过 3 集；不把计划创建视为内容完成。
- **Checklist**：
  1. 根据 production brief 和已有内容推荐 1–3 集试制范围，允许用户调整但严格限制上限。
  2. 将源内容确认、集纲、剧本、场景 / 镜头、资产需求拆成有依赖的可恢复阶段，并复用既有任务与 preview / adopt 语义。
  3. 每一阶段设置明确的通过、退回和重新生成入口；只有采用的结果解锁下一阶段。
  4. 驾驶舱显示当前阶段、单一下一步、真实覆盖率、缺失能力、预计成本 / 未知和失败恢复动作。
  5. 支持关闭应用后恢复、重复回调幂等、单集重试和取消；不因一集失败损坏其他已采用结果。
  6. 增加三入口到试制计划的 E2E 和面向新用户的操作文档。
- **Acceptance**：
  - 三种创建路径都能在不选择底层 AI 参数的情况下建立 1–3 集试制，并从驾驶舱恢复到唯一待办阶段。
  - 任何未采用剧本 / 分镜、能力未安装或未知成本都不能被显示为“试制完成”。
  - 关闭重开、单阶段失败、退回修改和重复完成回调后，阶段与权威数据保持一致。
- **Verification**：orchestration state-machine tests；1 / 2 / 3 集参数化测试；resume / retry / cancel / idempotency tests；三入口 Electron E2E；任务覆盖率 truth tests。
- **Risk**：将向导状态与真实领域状态重复存储；只保存用户决策和运行游标，完成度由权威实体派生。
- **Rollback boundary**：可删除未采用的试制运行记录；已采用内容保留并可从高级工作区访问。
- **未完成收束**：无；运行游标只保存来源确认和范围，阶段/覆盖率均由权威实体派生。
- **下一次动作**：开始 LM6-06 P0 Gate，按三入口、旧数据、离线和恢复矩阵执行集成验证。

### LM6-06：P0 首次价值与兼容性 Gate

- **Priority**：P0 Gate
- **Owner**：Release
- **Status**：done
- **Depends on**：LM6-01、LM6-02、LM6-03、LM6-04、LM6-05
- **Goal**：用真实集成旅程证明 P0 已降低首次使用门槛，且没有破坏旧项目、高级能力或本地优先边界。
- **Scope**：三入口矩阵、驾驶舱、简单 / 高级助手、五类变更包、1–3 集试制、迁移与文档真值。
- **Non-scope**：不在 Gate 临时新增功能；发现缺陷回到所属 Loop 分支修复并重新走完整流程。
- **Checklist**：
  1. 对灵感、原著、剧本三条路径各完成一次 fresh profile 和一次重开恢复 E2E。
  2. 证明简单模式 0 个必填引擎 / 模型 / task / benchmark 选择，且高级模式 task catalog 无回归。
  3. 对旧项目、旧项目包、坏文件、无 Provider、未知成本和中断恢复执行回归。
  4. 逐页核对首页、驾驶舱、任务中心、用户指南和 README 的能力表述；录制或截图仅作为测试证据补充，不代替断言。
  5. 在合并结果上运行完整桌面端验证，清理 Loop 分支并记录远端合并证据。
- **Acceptance**：P0 覆盖矩阵全部通过；没有 P0 级严重缺陷；三条路径均能到达已采用的试制计划；P1 不再依赖旧通用选择器主流程。
- **Verification**：完整桌面端命令集合；迁移 / 项目包 round-trip；三入口 E2E；自动键盘焦点、可访问性和 1280×720 viewport 断言。人工 walkthrough 仅作附加证据。
- **Risk**：只验证 happy path 导致“首次价值”是假象；Gate 必须包含空态、失败、离线和旧数据。
- **Rollback boundary**：P0 以单个 `--no-ff` 合并历史可整体定位；若回滚 UI，数据兼容读取仍须保留。
- **未完成收束**：无；三入口、恢复、坏文件、旧数据 / 项目包、离线 / 无 Provider、未知成本和中断状态均由本地自动化证据覆盖。
- **下一次动作**：开始 LM6-10，先运行 `git fetch origin` 并创建 `loop/lm6-10-asset-center`；fallback: 若主界面接线受阻，先以四类资产和锁 / usage fixture 实现兼容 read model、媒体错误态与删除保护。

### LM6-10：统一资产中心、版本比较、锁与用途

- **Priority**：P1
- **Owner**：Media Assets
- **Status**：done
- **Depends on**：LM6-06
- **Goal**：让角色、场景、道具和音色成为可看、可听、可比较、可锁定并可追踪镜头用途的生产资产，而不是散落的表单字段。
- **Scope**：统一资产索引、媒体卡片、版本 / 候选、并排比较、采用 / 锁、镜头用途、谱系 / 成本 / 权利状态、导入与生成入口。
- **Non-scope**：不批量生成整集视频；不让跨项目资产在本 Loop 共享；不删除 LM5 视觉资产包兼容结构。
- **Checklist**：
  1. 在现有视觉资产包上建立角色 / 场景 / 道具 / 音色统一 read model 和类型化详情，不复制媒体二进制。
  2. 卡片展示缩略图或音频试听、版本、采用 / 锁状态、来源、权利、成本和生成能力；缺失媒体有可解释占位。
  3. 支持 2–4 个候选并排比较、采用和锁定；锁保存具体版本 ID，后续新版本不会静默替换。
  4. 建立资产版本 → episode / scene / shot 的用途索引，可从资产跳到镜头，也可从镜头查看覆盖缺口。
  5. 导入、复用已有本地资产和远程生成候选统一经过权利与成本 Gate；修改设定后正确标记候选 / 锁 stale。
  6. 完成 schema / protocol / client、项目包、列表性能、媒体错误态、测试和用户文档。
- **Acceptance**：
  - 四类资产都能在同一中心搜索 / 筛选 / 预览；至少两个版本可比较、采用、锁定和解除锁定。
  - 任一锁定版本都能列出使用它的镜头；删除或替换被使用版本时必须阻断或要求显式迁移。
  - 权利不足、文件丢失、费用未知和 Provider 不可用有不同状态，且不会伪造预览。
- **Verification**：asset repository conformance；锁 / stale / usage / deletion safety tests；图片与音频 preview component tests；资产中心 Electron E2E；项目包 round-trip；`check:generated`。
- **Risk**：媒体列表耗尽内存或本地路径泄露；使用缩略图 / 懒加载 / object URL 生命周期管理，对外只暴露受控引用。
- **Rollback boundary**：统一中心是现有资产表的兼容视图；回退 UI 不删除资产版本、锁或权利记录。
- **未完成收束**：无；统一中心是既有 `visual-assets` 的兼容 read model，媒体二进制仍只保留受控本地归档引用。
- **下一次动作**：开始 LM6-11，先运行排序 / undo 纯函数测试；fallback: 使用 LM6-10 的类型化资产 fixture 完成卡片、过滤和性能工作，再接入导演看板。

### LM6-11：卡片式导演分镜看板

- **Priority**：P1
- **Owner**：Storyboard UX
- **Status**：done
- **Depends on**：LM6-10
- **Goal**：用按集 / 场组织的可扫视分镜卡片替代主要生产流程中的通用表单和级联选择器。
- **Scope**：分镜卡片、缩略图、对白、景别、机位 / 运镜、时长、资产覆盖、成本风险、选择与重排、上下文助手。
- **Non-scope**：不在本 Loop 加入多轨播放；不执行高成本视频生成；不取代剧本文本编辑器。
- **Checklist**：
  1. 按 episode → scene → shot 呈现导演看板；卡片包含缩略图、对白摘要、景别、运镜、时长和状态。
  2. 在卡片上显示角色 / 场景 / 道具 / 音色覆盖、锁定版本、权利阻塞、成本风险和任务状态。
  3. 支持键盘与拖拽重排、批量选择和过滤；顺序写入使用稳定排序语义并可撤销。
  4. 选择卡片后，资产中心和上下文助手自动切换到该 shot，不再要求重复选择父实体。
  5. 对长集使用虚拟化 / 分段加载，缩略图失败不阻塞文本编辑；更新 E2E 和用户文档。
- **Acceptance**：
  - 用户可在一个集级页面判断镜头顺序、画面、对白、时长、资产缺口和成本风险，并跳到具体修复动作。
  - 重排刷新后保持，撤销可恢复；锁定资产和人工采用结果不会被重排或刷新改变。
  - 100+ shot fixture 仍可交互，缺图、加载中和失败态不使看板空白。
- **Verification**：排序 / undo / context tests；100+ shot 性能 fixture；键盘和拖拽 E2E；卡片视觉回归；全量 app tests。
- **Risk**：拖拽并发保存导致顺序重复或丢失；使用事务性稳定 rank 和冲突提示。
- **Rollback boundary**：旧分镜列表 / API 保持可访问；看板重排只改变明确的排序字段。
- **未完成收束**：无；看板复用既有镜头、静帧、资产与同级重排记录，不维护第二套顺序或资产引用数据。
- **下一次动作**：开始 LM6-12，先运行服务端“未批准不得提交视频”的负向测试；fallback: 使用调用记录型 fake adapter 固定静帧、资产锁、成本与权利 readiness truth table。

### LM6-12：静帧先行与视频成本 Gate

- **Priority**：P1
- **Owner**：Media Pipeline
- **Status**：todo
- **Depends on**：LM6-11
- **Goal**：在任何高成本视频生成前，用低成本静帧或用户导入的参考帧确认视觉方向，并冻结提交所需资产版本。
- **Scope**：静帧候选、采用 / 锁、镜头就绪规则、批量预检、成本与权利 Gate、失效 / 重拍、视频提交阻断。
- **Non-scope**：不要求必须使用某个图片模型；不在本 Loop 生成最终成片；不允许仅通过勾选来伪造静帧确认。
- **Checklist**：
  1. 每个 shot 可导入或生成静帧候选，候选记录 Prompt、seed、资产版本、Provider、成本和权利谱系。
  2. 只有已采用且未 stale 的静帧，以及完整的必需资产锁，才能使 shot 进入 `video_ready`。
  3. 视频批量预检聚合 Provider 能力、分辨率 / 时长、引用资产限制、预计成本 / 未知和权利阻塞。
  4. Prompt、镜头时长或必需资产锁改变后使确认失效；用户可比较重拍结果并重新采用，不静默继承旧确认。
  5. 视频提交使用幂等键和明确批量上限；任何未通过项只阻断自身并给出修复入口。
  6. 增加“视频调用从未发生”的负向 E2E、成本 ledger 断言和操作文档。
- **Acceptance**：
  - 未采用静帧、静帧 stale、权利不足、成本未知未确认或能力不匹配时，视频提交不可发生。
  - 通过预检后提交的任务快照与用户看到的静帧、资产版本、参数和成本状态一致。
  - 失败或取消不会重复扣费、重复创建任务或解除已有锁。
- **Verification**：readiness truth table；preflight / rights / cost / idempotency tests；Provider mock 负向断言；静帧比较 → 采用 → 视频就绪 Electron E2E；ledger 检查。
- **Risk**：UI 禁用但 API 可绕过；Gate 必须在服务端再次验证同一冻结快照。
- **Rollback boundary**：可停用新视频入口并保留静帧候选与锁；不删除既有远程任务记录。
- **未完成收束**：按 5.3 保留 `loop/lm6-12-still-first-gate`；记录 readiness truth table、服务端阻断请求、成本 / 权利快照和 fake provider 调用次数。
- **下一次动作**：先运行服务端“未批准不得提交”的负向测试；Provider 不可用时使用调用记录型 fake adapter 验证零视频请求、幂等和批量上限。

### LM6-13：集级节奏曲线与定位修订

- **Priority**：P1
- **Owner**：Story Intelligence
- **Status**：todo
- **Depends on**：LM6-12
- **Goal**：在集级看板上可视化节拍、爽点、反转和结尾悬念，并把每个诊断点直接连接到对应剧本 / 镜头修订。
- **Scope**：统一节奏 read model、四类曲线 / 标记、来源定位、置信与 freshness、人工修订、上下文 AI 建议。
- **Non-scope**：不把启发式评分当作市场成功预测；不自动重写已采用剧本；不建设跨用户推荐系统。
- **Checklist**：
  1. 从已采用的集纲、剧本、beat 和 shot 派生统一时间轴，明确缺失、未知和 stale 数据。
  2. 在 episode board 上叠加节拍密度、爽点、反转和 cliffhanger 标记，可按场 / 镜头定位原文与证据。
  3. 支持人工新增、调整或否决诊断点；AI 建议进入 preview，不覆盖人工判断。
  4. 从异常区间创建带上下文的修订动作，采用后重新计算并保留前后版本对比。
  5. 以合成剧本 fixture 锁定曲线语义、边界和无数据状态，补充可访问图表说明和文档。
- **Acceptance**：
  - 一集的四类节奏信息可在同一视图查看，每个点可追到实际文本或镜头，不显示无来源的“神秘分数”。
  - 源内容变化会标记旧分析 stale；用户手工标记不会在刷新后丢失。
  - 诊断发起的修订仍遵循 preview / adopt / undo，不直接改权威剧本。
- **Verification**：timeline mapping property tests；freshness / manual override tests；无数据与极短 / 极长剧本 fixture；chart accessibility test；episode board E2E。
- **Risk**：不同文本版本导致时间位置漂移；使用稳定实体 ID 和版本化范围，不只存字符 offset。
- **Rollback boundary**：曲线为派生数据和人工标注；回退可视化不修改剧本、分镜或采用历史。
- **未完成收束**：按 5.3 保留 `loop/lm6-13-rhythm-curves`；保存失败剧本 fixture、稳定实体映射、freshness 和人工 override 对比。
- **下一次动作**：从 timeline mapping property test 继续；上游看板未完成时以 episode fixture 完成派生模型、图表可访问语义和 stale 测试。

### LM6-14：章节编辑器常驻 Story Bible

- **Priority**：P1
- **Owner**：Story Intelligence
- **Status**：todo
- **Depends on**：LM6-13
- **Goal**：写章节或剧本时，无需离开编辑上下文即可查看相关人物状态、关系、时间线、伏笔和视觉锁，并以变更包方式更新。
- **Scope**：可折叠 / 可调整侧栏、当前范围关联、搜索与固定条目、冲突 / stale、变更包预览、深链和键盘体验。
- **Non-scope**：不删除独立 Story Bible 全量管理页；不在侧栏直接无审查改写正文；不在本 Loop建设大型知识图谱编辑器。
- **Checklist**：
  1. 在章节和剧本编辑器旁提供持久侧栏，按当前 chapter / scene 自动聚合人物、关系、事件、伏笔、设定和视觉资产锁。
  2. 支持搜索、固定、展开来源和跳转到全量 Story Bible；侧栏宽度 / 折叠状态按项目保存。
  3. 显示与当前草稿冲突、待回收伏笔和 stale 条目，且区分 AI 建议、人工确认和权威事实。
  4. 从侧栏发起的新增 / 修改进入 LM5-05 change set，支持差异、选择性采用、undo 和采用后的正文关联刷新。
  5. 覆盖键盘、窄窗口、长列表、离线和无 Story Bible 空态，更新用户文档和 E2E。
- **Acceptance**：
  - 编辑章节 / 剧本时可在不离开页面的情况下查看并定位所有相关连续性信息。
  - 侧栏编辑不会绕过变更包；采用、撤销和 stale 状态在侧栏与独立页面一致。
  - 侧栏折叠后不遮挡正文，1280×720 下关键保存和审查动作仍可达。
- **Verification**：scope relation tests；change-set parity；layout / keyboard / narrow viewport component tests；章节编辑 → 侧栏变更 → 采用 / 撤销 Electron E2E。
- **Risk**：侧栏查询拖慢编辑器；采用缓存的类型化 read model 和增量刷新，不在每次按键触发全库查询。
- **Rollback boundary**：独立 Story Bible 页面保持完整；侧栏只消费兼容 read model。
- **未完成收束**：按 5.3 保留 `loop/lm6-14-story-bible-sidecar`；记录 scope query、change-set parity、窄窗口和键盘失败状态。
- **下一次动作**：先重跑 scope relation / change-set parity 测试；章节页面集成暂不可用时以 editor harness 验证侧栏 read model、布局和焦点行为。

### LM6-15：P1 视觉试制闭环 Gate

- **Priority**：P1 Gate
- **Owner**：Release
- **Status**：todo
- **Depends on**：LM6-10、LM6-11、LM6-12、LM6-13、LM6-14
- **Goal**：证明导演可从已采用剧本走到资产锁定、卡片分镜和静帧批准，同时节奏与 Story Bible 始终可审查。
- **Scope**：资产中心、分镜看板、静帧 Gate、曲线、Story Bible、权利 / 成本 / 谱系、旧项目兼容。
- **Non-scope**：不在 Gate 临时增加时间线或云端能力。
- **Checklist**：
  1. 使用 1 集和 3 集 fixture 完成角色 / 场景 / 道具 / 音色版本比较、采用、锁定和镜头用途核对。
  2. 在分镜看板完成重排、覆盖缺口修复、静帧采用和视频预检，并证明 Gate 前没有视频提交。
  3. 验证节奏点定位、修订前后比较和 Story Bible 侧栏 change set / undo。
  4. 对媒体丢失、权利过期、成本未知、Provider 离线、100+ shot 和窄窗口执行回归。
  5. 在合并结果运行完整桌面验证，核对产品文档真值并记录远端合并证据。
- **Acceptance**：P1 覆盖矩阵全部通过；每个 video-ready shot 都有可追溯的已采用静帧和资产锁；无 P1 级严重缺陷。
- **Verification**：完整桌面端命令集合；1 / 3 集视觉试制 E2E；项目包 round-trip；内存 / 长列表 smoke；自动键盘焦点、媒体错误和窄 viewport 断言。人工 walkthrough 仅作附加证据。
- **Risk**：用 mock 图片掩盖真实媒体错误；Gate fixture 必须同时包含有效媒体、缺失媒体和损坏媒体。
- **Rollback boundary**：P1 UI 可回退，但已创建资产版本、锁、静帧和谱系必须继续可读。
- **未完成收束**：按 5.3 保留 `loop/lm6-15-p1-gate`；记录 1 / 3 集矩阵、首个失败断言、媒体 fixture 类型和对应能力 Loop，不在 Gate 中旁路修复。
- **下一次动作**：重跑首个失败的自动化视觉试制场景；依赖未完成时推进可独立的媒体错误、长列表、项目包和键盘自动检查并在后续 sweep 回访。

### LM6-20：可播放、可编辑的多轨时间线

- **Priority**：P2
- **Owner**：Timeline Editor
- **Status**：done
- **Depends on**：LM6-15
- **Goal**：把已采用镜头和媒体装配成可播放、可定位、可撤销编辑的时间线，为自动音频、字幕和后期导出提供唯一权威结构。
- **Scope**：timeline / track / clip schema、视频与音频播放、playhead、缩放 / 滚动、trim / move / split、mute / solo、autosave / undo、媒体重链。
- **Non-scope**：不复制完整专业 NLE 的调色、复杂特效和插件系统；不把预览播放称为最终渲染。
- **Checklist**：
  1. 定义版本化 canonical timeline，至少支持 video、dialogue、narration、BGM、SFX、subtitle track 和稳定 clip ID。
  2. 从已采用 shot / media 建立可重复的初始时间线；再次装配不覆盖用户已做的明确编辑。
  3. 实现播放 / 暂停、scrub、缩放、track mute / solo，以及 clip move / trim / split 的可撤销编辑。
  4. 处理缺失文件、路径变化、unsupported codec、代理媒体和重链；原媒体不被编辑器修改。
  5. 统一帧率、timebase、duration 和 rounding 规则，保证保存、重开和导出一致。
  6. 为短 / 长时间线、重开、undo / redo、键盘和播放同步增加测试与用户文档。
- **Acceptance**：
  - 含多条视频、音频和字幕轨的 fixture 可在桌面端播放、scrub、编辑并重开，playhead 与可听 / 可见内容一致。
  - 编辑操作可撤销且不改变源媒体；缺失媒体可重链并清晰标记，不导致整个时间线无法打开。
  - 同一时间线两次序列化结果稳定，duration 与后续导出使用相同 timebase。
- **Verification**：timeline schema / serialization property tests；edit command / undo tests；media failure tests；多轨 Electron E2E；真实短媒体播放 smoke；`check:generated`。
- **Risk**：浏览器媒体时钟漂移和大媒体内存压力；使用单一主时钟、代理 / 懒加载和有界预取，并记录可接受误差。
- **Rollback boundary**：时间线是新版本化实体；旧项目无 timeline 时继续使用分镜 / 片段页面，源媒体不迁移。
- **未完成收束**：按 5.3 保留 `loop/lm6-20-multitrack-timeline`；记录 canonical timeline fixture、timebase、首个失败编辑命令和媒体同步偏差。
- **下一次动作**：先运行 serialization / edit-command property test；P1 资产未就绪时使用冻结本地短媒体 fixture 推进播放、undo 和缺失媒体恢复。

### LM6-21：对白、旁白、BGM、SFX 与字幕自动编排

- **Priority**：P2
- **Owner**：Media Pipeline
- **Status**：todo
- **Depends on**：LM6-20
- **Goal**：基于采用剧本、角色音色和镜头时长生成或导入音频 / 字幕候选，并以可审查方式自动放入时间线。
- **Scope**：对白 / 旁白分段、音色版本、TTS 或导入、BGM / SFX 选择、字幕切分、自动放置、音量 / ducking、局部重生成、成本 / 权利 / 谱系。
- **Non-scope**：不自动取得未授权音乐；不静默覆盖人工时间线编辑；不承诺完整音频母带处理。
- **Checklist**：
  1. 将已采用台词和旁白映射到稳定 speaker / shot / time range，生成或导入版本化音频候选。
  2. 根据场景与镜头范围放置 BGM / SFX，提供保守默认音量、淡入淡出和对白 ducking，所有结果可单独试听 / 采用。
  3. 从权威文本与采用音频生成可编辑 subtitle cues，并支持 SRT / WebVTT 预览语义。
  4. 自动编排以变更预览呈现；应用时只改目标范围，检测并保护用户手工移动、trim 或音量调整。
  5. 任一远程音频任务遵循 Provider 能力、幂等、成本、权利和重试规则；支持按句 / 镜头局部重生成。
  6. 增加对白重叠、缺音色、时长溢出、无 BGM、Unicode 字幕和重开恢复测试。
- **Acceptance**：
  - 一集可从剧本生成或导入五类轨道内容，试听后选择性采用并在时间线上同步播放。
  - 自动重新编排不会覆盖手工锁定 clip；修改一句台词只使相关音频和字幕 stale。
  - 每个音频 / 字幕结果可追溯到文本、音色 / 素材版本、Provider、成本和权利状态。
- **Verification**：alignment / cue / overlap tests；partial re-generation and protected-edit tests；rights / cost / idempotency tests；自动编排 → 试听 → 采用 Electron E2E；真实短音频播放 smoke。
- **Risk**：TTS 时长与镜头长度不一致；提供溢出提示和可审查的 time-stretch / 改词建议，不静默裁断对白。
- **Rollback boundary**：自动编排是可撤销 timeline change set；源文本、源音频和人工 clip 不删除。
- **未完成收束**：按 5.3 保留 `loop/lm6-21-auto-assembly`；记录 speaker / cue 映射、溢出片段、受保护人工 edit 和成本 / 权利失败项。
- **下一次动作**：从 alignment / cue 首个失败用例继续；TTS 或媒体 Provider 不可用时使用确定性音频 fixture 验证编排、局部 stale 和保护性合并。

### LM6-22：真实可验证的后期交付路径

- **Priority**：P2
- **Owner**：Delivery
- **Status**：todo
- **Depends on**：LM6-21
- **Goal**：结束“只有预检或片段，没有最终交付”的状态；以稳定 NLE 交换作为必达路径，在 Provider 明确支持服务端合成时可增加真实 MP4 交付。
- **Scope**：canonical export manifest、FCPXML、OpenTimelineIO、CMX 3600 EDL、SRT / WebVTT、媒体清单 / checksum / relink、reference parser / round-trip 证据；可选真实 NLE 与 remote render 附加证据。
- **Non-scope**：不在桌面端内嵌未受控的本地渲染器；不把文件存在冒充格式正确；不为 MP4 锁定单一供应商。
- **Checklist**：
  1. 从 LM6-20 canonical timeline 生成版本化、确定性的交付 manifest，冻结 timebase、轨道、clip、媒体版本、权利和谱系。
  2. 导出 FCPXML、OTIO、EDL、SRT / WebVTT 和媒体 relink 清单；使用相对路径、checksum 和明确的不支持特性报告。
  3. 增加格式 parser / schema / round-trip fixture 和 `check:timeline-exports` 脚本，保证同一输入重复导出稳定。
  4. 使用 FCPXML schema / 结构校验器、OTIO reference parser 和 EDL round-trip parser 自动验证导入语义、重链、时间码、镜头顺序和字幕；实际目标 NLE 导入作为附加兼容证据。
  5. 若 Provider catalog 明确声明 `timeline_render`，才允许走预检 → 提交 → 轮询 → 下载 → checksum → 播放 → 采用的 MP4 路径；否则 UI 明示“不支持”，NLE 交付仍可完成。
  6. 交付结果写入 lineage / cost / rights ledger，项目包只包含声明允许的 manifest / 媒体，不泄露绝对路径或密钥。
- **Acceptance**：
  - **必达条件**：FCPXML、OTIO 和 EDL 均通过版本固定的自动格式 / reference parser / round-trip 验证；重链、字幕与镜头时间在约定容差内。实际 NLE 导入不是无人值守唯一 Gate。
  - **MP4 替代 / 增强条件**：只有真实远程输出可下载、checksum 正确并实际播放时才显示“MP4 已交付”；无相关 Provider 时不阻塞已验证的 NLE 路径。
  - 未支持转场、效果或媒体必须在导出前列明，不得静默丢失。
- **Verification**：`bun run check:timeline-exports`（本 Loop 新增）；determinism / schema / reference parser / round-trip tests；若环境已有目标 NLE，则附加 import checklist；若有 MP4，则使用媒体探测与 Electron 自动播放断言；项目包 round-trip；完整桌面验证。
- **Risk**：不同 NLE 方言和帧率舍入导致漂移；固定版本、timebase、drop-frame 规则和容差 fixture，记录目标 NLE 版本。
- **Rollback boundary**：导出器和可选 remote render adapter 独立注册；回退不改变 canonical timeline 或源媒体。
- **未完成收束**：按 5.3 保留 `loop/lm6-22-production-delivery`；保存失败格式、reference parser 输出、timebase / relink 差异和 deterministic export checksum。
- **下一次动作**：先运行 `bun run check:timeline-exports` 的首个失败 fixture；目标 NLE 不可用时继续以 FCPXML schema、OTIO reference parser 和 EDL round-trip validator 完成必达验收。

### LM6-23：系列 Story Bible 与跨项目资产库

- **Priority**：P2
- **Owner**：Core Data
- **Status**：todo
- **Depends on**：LM6-22
- **Goal**：让同一 IP 的多个项目共享经过审查的世界观和资产，同时避免共享修改静默污染已交付项目。
- **Scope**：series、项目归属、系列 Story Bible、项目 override、资产库、copy / fork / link、版本锁、跨项目用途、权利与项目包快照。
- **Non-scope**：不做公共素材市场；不要求云账号；不允许跨项目隐式修改；不共享 API key 或私有授权证明正文。
- **Checklist**：
  1. 增加可选 series 实体和项目关联；旧项目默认无 series，加入 / 移出不迁移或删除原数据。
  2. 定义系列 Story Bible 继承、项目 override、冲突和冻结规则，采用仍通过 change set。
  3. 建立本地资产库与 `copy` / `fork` / `link-to-version` 语义；链接只指向不可变版本，升级必须显式确认。
  4. 显示系列 / 资产版本在各项目、episode 和 shot 的用途；权利台账决定能否复制、链接、导出或云发布。
  5. 项目包保存所需快照与引用 manifest，确保离开原资产库后仍能解释或按授权携带媒体。
  6. 增加迁移、冲突、删除保护、跨项目搜索、项目包和文档测试。
- **Acceptance**：
  - 两个项目可共享同一锁定资产版本和系列设定；系列产生新版本时，既有项目保持原版本直到显式升级。
  - fork 后的修改不会影响来源；删除被引用版本被阻断或通过显式安全迁移完成。
  - 无 series 的旧项目行为不变；整个能力离线可用。
- **Verification**：inheritance / override / copy / fork / link property tests；rights and deletion safety；两项目 Electron E2E；项目包在无原资产库环境下 round-trip；migration tests。
- **Risk**：跨项目级联删除和循环引用；使用不可变 version ref、数据库约束和应用层 cycle check。
- **Rollback boundary**：series 关联可解除但不删除项目；资产版本与项目快照保留，可回到单项目读取模式。
- **未完成收束**：按 5.3 保留 `loop/lm6-23-series-library`；记录迁移版本、inherit / override / link 冲突、循环引用和项目包快照差异。
- **下一次动作**：从首个 migration 或 property test 继续；交付 Loop 未完成时使用 canonical manifest fixture 推进 series 与资产引用语义。

### LM6-24：桌面—云审片—本地反馈闭环

- **Priority**：P2
- **Owner**：Review Integration
- **Status**：todo
- **Depends on**：LM6-23
- **Goal**：复用现有平台能力，让用户显式发布选定成片 / 片段，邀请多人带时间码评论，并把评论和决策幂等同步回本地修订流程。
- **Scope**：账号 / workspace 选择、review manifest、选定媒体上传、PIN / 到期 / 撤销 / 删除、Web 播放与评论、成员角色、游标同步、本地反馈映射与任务创建。
- **Non-scope**：不上传完整 SQLite、Provider key、授权证明正文或未选择媒体；不做实时多人共同编辑；不让云端成为本地打开项目的前提。
- **Checklist**：
  1. 桌面端发布前预览 review manifest、媒体、checksum、存储 / 保留期、费用和 workspace；用户明确确认后才创建 package 与上传。
  2. 复用平台现有 workspace、review package、私有对象存储和 entitlement 契约，补齐 SDK / server / generated contract 差异而不新建平行服务。
  3. Web 审片页支持受控分享、可选 PIN、过期、按 episode / shot / timecode 评论、通过 / 退回 / note 决策和多身份显示。
  4. 桌面按 cursor 拉取评论与决策，按 client ID 幂等落地，映射到 timeline / shot，并允许创建上下文修订动作。
  5. 覆盖 owner / admin / member / guest 权限、撤销链接、删除对象、过期清理、上传失败恢复、存储配额和审计日志。
  6. 增加跨栈 E2E、离线降级、删除 / 保留期文档和隐私说明；验证登出后本地项目仍完整可用。
- **Acceptance**：
  - 同一 review package 至少由两个不同身份提交带时间码评论 / 决策，桌面同步后只出现一次并可跳到正确 shot / time range。
  - 撤销或过期后公共访问失败；删除后对象存储与数据库状态按保留策略收敛；越权访问被拒绝并有审计。
  - 未登录或断网时 P0–P2 本地能力和 NLE 导出继续可用；发布清单不含秘密、完整数据库或未选择媒体。
- **Verification**：平台 `make test`；SDK contract tests；`make platform-up && make platform-e2e` 后 `make platform-down`；桌面 publish / sync tests；owner + member + guest 跨栈 E2E；对象删除与过期检查。
- **Risk**：分享令牌泄露、评论重复和媒体未清理；令牌只存 hash、支持 PIN / 过期 / 撤销，游标与 client ID 幂等，私有 bucket 配合清理 job。
- **Rollback boundary**：云 package 可撤销 / 删除；本地只保留同步记录和远端引用，断开集成不删除项目、timeline 或媒体。
- **未完成收束**：按 5.3 保留 `loop/lm6-24-cloud-review`；记录 workspace / package / cursor、对象 checksum、失败服务、Compose 日志索引和清理结果，确保执行 `make platform-down`。
- **下一次动作**：先运行失败的 SDK / service contract 测试；Docker 不可用时完成 `make test` 和桌面 sync fixture 后 checkpoint，下一 sweep 先检查 Docker readiness 再重试本地跨栈 E2E。

### LM6-25：P2 全链路交付与发布 Gate

- **Priority**：P2 Gate
- **Owner**：Release
- **Status**：todo
- **Depends on**：LM6-20、LM6-21、LM6-22、LM6-23、LM6-24
- **Goal**：证明产品从三种入口之一到可播放时间线、真实后期交付和可选多人审片形成闭环，同时保持旧项目、本地优先、权利、成本和回滚边界。
- **Scope**：桌面完整旅程、平台本地审片旅程、旧数据 / 项目包、自动 NLE 交换验证、可选真实 NLE / MP4 附加证据、文档与发布真值。
- **Non-scope**：不在 Gate 中用临时脚本掩盖未实现能力；不把人工操作、凭据或真实设备设为唯一完成信号。
- **Checklist**：
  1. 从灵感、原著或剧本入口完成至少一个 1–3 集 fixture：驾驶舱 → 采用剧本 → 资产锁 → 分镜 → 静帧 → 时间线 → 音频 / 字幕 → 交付。
  2. 对同一项目完成 FCPXML / OTIO / EDL reference parser、round-trip、relink 和时间码容差验证；若宣称 MP4，则同时完成真实 Provider、下载、checksum 与自动播放证据。
  3. 将同一 IP 的第二项目关联到 series，验证 Story Bible override、资产 link / fork 和旧项目隔离。
  4. 完成两身份云审片、评论回流、修订、重新交付、撤销 / 删除；再验证完全离线的本地路径。
  5. 执行旧项目迁移、项目包 round-trip、权利过期、成本未知、媒体缺失、Provider / 平台离线和中断恢复矩阵。
  6. 在合并结果运行桌面与平台完整验证，核对 README、用户指南、release note 和能力状态，推送并清理分支。
- **Acceptance**：
  - P2 覆盖矩阵全部满足，NLE 交换路径有完整机器证据；真实 NLE 或 MP4 证据只增强兼容声明，云审片为可选增强而非本地主链依赖。
  - 没有 P0 / P1 / P2 级严重缺陷；所有付费请求、资产版本、交付文件和评论均可追溯。
  - 旧项目可打开与导出；新项目在无网络时仍可编辑、播放已有本地媒体并导出 NLE 包。
  - 文档只声明已由本 Gate 证实的能力，其余明确标注 partial / 未安装 / unknown。
- **Verification**：完整桌面端命令集合；平台 `make test` 和本地受控 `platform-e2e`；全链 Electron / Web E2E；NLE reference parser / round-trip；可选真实 NLE / MP4 附加证据；项目包与迁移矩阵；最终 diff review。
- **Risk**：把 reference parser 通过扩大表述为所有 NLE 版本兼容；文档只能声明已自动验证的格式版本，真实外部证据另行注明环境与限制。
- **Rollback boundary**：按 Loop 合并提交逐项回滚；云审片可独立关闭，canonical timeline、NLE 导出和本地项目仍可用。
- **未完成收束**：按 5.3 保留 `loop/lm6-25-p2-gate`；记录全链矩阵首个失败阶段、自动格式验证、跨栈结果、依赖状态及 checkpoint 清单。
- **下一次动作**：重跑首个失败的机器可判定场景；依赖未完成时推进其余离线、迁移、项目包和 reference parser 回归，更新游标后在下一 sweep 回访。

## 9. 推荐尝试顺序、依赖降级与自动重试

每个 sweep 的推荐扫描顺序：

```text
LM6-00
  → LM6-01 → LM6-02 → LM6-03 → LM6-04 → LM6-05 → LM6-06 (P0 Gate)
  → LM6-10 → LM6-11 → LM6-12 → LM6-13 → LM6-14 → LM6-15 (P1 Gate)
  → LM6-20 → LM6-21 → LM6-22 → LM6-23 → LM6-24 → LM6-25 (P2 Gate)
```

调度规则：

- 同一时刻只有一个 `doing`；它成功则走完合并、推送、清理，未成功则按 5.3 转为 `partial`，随后立即扫描下一个可推进项。
- LM6-06、LM6-15、LM6-25 只有依赖全部 `done` 且阶段回归通过时才能 `done`；依赖未满足时不等待，可先运行独立 fixture、迁移、离线和回归子集并保存 Gate checkpoint。
- 数据迁移或项目包 round-trip 失败时，依赖这些写入语义的 Loop 不得合入 `main`；其他纯 UI、fixture、parser、read model 或平台隔离工作继续尝试。
- 版权、成本、幂等或锁定规则存在可绕过路径时，付费提交与交付相关 Loop 不得 `done`；无付费调用的负向测试、静帧、时间线和格式验证继续推进。
- LM6-22 以自动 schema / reference parser / round-trip 为必达验收；目标 NLE、Provider 或凭据缺失时不等待，实际导入 / MP4 只作为附加证据。
- LM6-24 优先使用本地 Compose 完成跨栈验收；Docker 暂不可用时先推进 unit、contract、桌面同步 fixture 和清理逻辑，checkpoint 后继续其他 Loop，并在下一 sweep 重试。
- 每轮到达表尾仍有非 `done` 条目时，游标回到最早具有新 `Next attempt` 的 `partial`，其次是依赖已满足的 `todo`；不得因为一个 Gate 未通过而停止整批。
- 只有 4.4 全部成立才能宣告整批完成；LM6-25 未 `done` 时只能追加 sweep / 中断进度记录。

前三个最关键的产品杠杆是 LM6-01 + LM6-05（三入口与试制向导）、LM6-03（上下文助手）和 LM6-10（视觉资产中心）。扫描优先级仍以数据和导航依赖为首选，但依赖缺失只改变本次可推进范围，不产生等待状态。

## 10. 阶段退出标准

### P0 Exit

- 三种创建路径均可完成并进入同一生产驾驶舱。
- 默认助手不要求理解底层 Agent / 引擎 / 模型，但高级模式能力无损。
- 小说导入产生五类可追溯、可选择采用、可撤销的变更包。
- 1–3 集试制可暂停 / 恢复，阶段完成度来自真实采用结果。
- 旧项目、旧项目包、离线与无 Provider 状态通过回归。

### P1 Exit

- 四类资产可预览、比较、采用、锁定并追踪到镜头。
- 分镜看板可完成集级扫视、重排、覆盖修复和上下文操作。
- 服务端与 UI 都阻断未经静帧批准的视频提交。
- 节奏诊断可定位到文本 / 镜头并通过 preview / adopt 修订。
- Story Bible 在章节 / 剧本编辑时常驻且与独立页面状态一致。

### P2 Exit

- 多轨时间线可播放、编辑、保存、重开、撤销并处理缺失媒体。
- 对白、旁白、BGM、SFX、字幕可自动编排且保护人工编辑。
- FCPXML / OTIO / EDL 通过版本固定的 schema、reference parser、round-trip、relink 和时间码容差验证；实际 NLE 导入或真实 MP4 是附加兼容证据，不是挂机唯一 Gate。
- 系列 Story Bible 和资产库支持显式继承 / override / copy / fork / link，不静默污染项目。
- 两个身份的云审片评论可回流本地，链接可过期 / 撤销 / 删除，离线主链不受影响。

## 11. 执行记录（append-only）

每次 Loop 尝试结束都追加一条记录，包括 `done` 和 `partial`；不得删除、覆盖或“整理”历史条目。依赖扫描时未创建分支、未执行实现的 skip 写入 sweep 记录，不增加 Attempt；真正进入 Loop 分支或 worktree 后，Attempt 必须单调递增。

```markdown
### <Loop ID> / Attempt <N> — <日期与时区>

- Loop: <Loop ID>
- Attempt: <N>
- Outcome: done | partial
- Target branch: main
- Loop branch: loop/<loop-id>-<short-topic>
- Commit(s): <hash + subject | checkpoint hash | none>
- Merge commit: <hash | none>
- Verification:
  - <command / machine check>: PASS | FAIL | TIMEOUT — <summary or evidence path>
- Diff review: PASS | PARTIAL — <scope and notable findings>
- Remote sync: PASS | FAIL — <origin/main hash or sanitized failure>
- Push: PASS | FAIL | NOT-ATTEMPTED — <target/checkpoint ref>
- Loop branch cleanup: PASS — deleted | RETAINED — <location and recovery command>
- Current branch/worktree: <branch; absolute worktree; clean or explicitly owned changes>
- Completed: <trusted result or none>
- Unfinished: <specific unmet acceptance items or none>
- Evidence: <commands, sanitized output, logs, commits, environment facts>
- Next attempt: <first direct command/action>; fallback: <automatic safe alternative>
- Sweep cursor: <next loop ID>
- Notes: <migration, rollback, limitations, external optional evidence>
```

整批任务最终完成时，最后一条 LM6-25 记录还必须汇总：全部 Loop 的最终成功 Attempt、历史 `partial` 的解决记录、checkpoint / worktree 清理、`origin/main` 对齐状态和四个 Gate 的机器证据。仍有 `todo`、`doing` 或 `partial` 时，只能写执行中断 / sweep 进度，不得写完成总结。

依赖扫描时仅 skip、没有进入 Loop 分支的事件使用轻量记录：

```markdown
### Sweep <N> / Skip — <日期与时区>

- Loop: <Loop ID>
- Missing dependency: <具体 Loop / 契约 / 环境事实>
- Safe progress available: <fixture / pure function / contract action | none>
- Decision: <本 sweep 重新入队 | 下一 sweep 回访>
- Sweep cursor: <next loop ID>
```

每次记录后同步更新第 7 节总表中的 `Status`、`Attempts` 和 `Last progress`。更新表格是调度元数据，不得删除 append-only 记录；`partial` 后续解决时保留旧记录并追加新的 Attempt。

### LM6-00 / Attempt 1 — 2026-08-12 00:06 CST

- Loop: LM6-00
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-00-baseline-contract
- Commit(s): `60c420a6 loop(lm6-00): establish trusted baseline contract`
- Merge commit: `31ac4d98 merge: LM6-00 trusted baseline contract`
- Verification:
  - `bun run typecheck`: PASS — 12 个 Turbo typecheck 任务通过。
  - `bun run lint`: PASS — `oxlint --deny-warnings packages apps` 通过。
  - `bun run test:unit`: PASS — 包级 unit、SQLite conformance、LM6-00 fixture 和服务端 HTTP contract 通过。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS — client / legacy 生成物、OpenCode `1.18.15`、Codex `0.147.0` 与 Provider catalog 均已核验。
  - `bun run build && bun run test:e2e`: PASS — Desktop build 成功，3 个 Electron smoke 场景通过。
  - 项目包 round-trip: PASS — 导出 JSON 经 capability preview 后显式创建新项目，3 章与资源数一致。
- Diff review: PASS — 仅包含 Loop 规则/地图、合成 fixture、基线契约、服务端测试、一个 source-import 写入修复和真值文档；未纳入凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 基线 `origin/main` 为 `2e713443`，合并前再次 fast-forward 检查通过。
- Push: PASS — 功能 merge `31ac4d98` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-00-baseline-contract` 与 `/Volumes/A/code/project/dramaIp-lm6-00`。
- Current branch/worktree: `integrate/lm6-00-baseline-contract`; `/Volumes/A/code/project/dramaIp-integrate-lm6-00`; 仅有本执行记录的显式改动。
- Completed: 四类合成 fixture、结果状态词典、真实能力基线、source-import preview 写入修复、显式 rights commit、视觉资产锁定、项目包 round-trip 与完整桌面回归。
- Unfinished: 无；真实 Provider、真实 NLE 与远程 MP4 仍在基线文档中如实标为外部或未知证据，不作为本 Loop 的完成声明。
- Evidence: `dramaip-desktop/docs/product/LM6-00-BASELINE.md`、`tests/lm6/lm6-00.test.ts`、`packages/server/src/sidecar.node.test.ts`、合并与推送提交。
- Next attempt: 开始 LM6-01，先运行 `git fetch origin` 并创建 `loop/lm6-01-three-entry`；fallback: 若 UI 接线受阻，先实现 production brief 与三路径 route harness / fixture 契约。
- Sweep cursor: LM6-01
- Notes: 首次 typecheck 缺少已安装依赖；`bun install --frozen-lockfile` 后重跑全部通过。外部 Provider / NLE 未被 mock 成真实成功。

### LM6-01 / Attempt 1 — 2026-08-12 00:17 CST

- Loop: LM6-01
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-01-three-entry
- Commit(s): `2d4e68c9 loop(lm6-01): add three project entry paths`
- Merge commit: `2781fa12 merge: LM6-01 three project entry paths`
- Verification:
  - `bun run typecheck && bun run lint`: PASS — 12 个 typecheck 任务与 `oxlint --deny-warnings` 通过。
  - `bun run test:unit`: PASS — 现有包级测试、LM6-00/LM6-01 fixture、生产简报和 HTTP round-trip contract 通过。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS — 生成物、引擎锁和 Provider catalog 均已核验。
  - `bun run build && bun run test:e2e`: PASS — Desktop build 成功，4 个 Electron 场景通过；新增场景覆盖灵感、原著预览和剧本粘贴三路径。
- Diff review: PASS — 仅包含三入口首页、可读且可回滚的 production brief、既有 source-import preview 深链、剧本草稿创建、测试、fixture、用户文档和调度元数据；无凭据、缓存或主工作区改动。
- Remote sync: PASS — 功能 merge 前 `origin/main` 为 `29242bbd`，fast-forward 检查通过。
- Push: PASS — 功能 merge `2781fa12` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-01-three-entry` 与 `/Volumes/A/code/project/dramaIp-lm6-01`。
- Current branch/worktree: `integrate/lm6-01-three-entry`; `/Volumes/A/code/project/dramaIp-integrate-lm6-01`; 仅有本执行记录的显式改动。
- Completed: 首页三张创建卡、来源/内容形态/受众/平台/时长/集数/画幅/视觉方向生产简报、原著/文件的 capability preview 与权益确认入口、粘贴剧本首集草稿、项目包 round-trip 和深链回归。
- Unfinished: 无；LM6-02 才引入以真实项目状态派生的生产驾驶舱和唯一下一步，LM6-01 仍进入现有项目工作区。
- Evidence: `packages/app/src/project-intake.ts`、`tests/lm6/lm6-01.test.ts`、`tests/electron/lm6-01.spec.ts`、`packages/server/src/sidecar.node.test.ts`、用户指南与合并/推送提交。
- Next attempt: 开始 LM6-02，先运行 `git fetch origin` 并创建 `loop/lm6-02-production-cockpit`；fallback: 若全页集成受阻，先以 LM6 fixture 构建项目状态 read model、推荐动作和 route harness。
- Sweep cursor: LM6-02
- Notes: 原著项目是有意保存的待导入 production brief；取消文件预览不会写入章节、剧本或场景。粘贴剧本的章节创建若失败会自动尝试删除新项目，避免孤儿记录。

### LM6-02 / Attempt 1 — 2026-08-12 00:25 CST

- Loop: LM6-02
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-02-production-cockpit
- Commit(s): `0c86a612 loop(lm6-02): add project production cockpit`
- Merge commit: `397aa65e merge: LM6-02 project production cockpit`
- Verification:
  - `bun run typecheck && bun run lint`: PASS — 12 个 typecheck 任务与 `oxlint --deny-warnings` 通过。
  - `bun run test:unit`: PASS — 包级测试、LM6-00/LM6-01/LM6-02 fixture、驾驶舱纯函数和服务器 contract 通过。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS — 生成物、引擎锁与 Provider catalog 已核验。
  - `bun run build && bun run test:e2e`: PASS — Desktop build 成功，5 个 Electron 场景通过；新增场景确认唯一下一步和审核区项目上下文。
- Diff review: PASS — 仅包含只读状态派生、项目驾驶舱、四区/任务上下文 query、fixture、测试、用户指南和调度元数据；没有反写阶段数据、凭据、缓存或主工作区改动。
- Remote sync: PASS — 功能 merge 前 `origin/main` 为 `924d8f81`，fast-forward 检查通过。
- Push: PASS — 功能 merge `397aa65e` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-02-production-cockpit` 与 `/Volumes/A/code/project/dramaIp-lm6-02`。
- Current branch/worktree: `integrate/lm6-02-production-cockpit`; `/Volumes/A/code/project/dramaIp-integrate-lm6-02`; 仅有本执行记录的显式改动。
- Completed: 基于真实章节、生产图和任务的纯状态派生、一个主要动作、阻断与覆盖展示、四区项目上下文深链、项目任务过滤以及空/失败/运行/人工确认/交付 fixture。
- Unfinished: 无；LM6-03 将单独改造默认智能助手，不以驾驶舱的状态显示冒充助手能力。
- Evidence: `packages/app/src/project-cockpit.ts`、`tests/lm6/lm6-02.test.ts`、`tests/electron/lm6-02.spec.ts`、完整回归与合并/推送提交。
- Next attempt: 开始 LM6-03，先运行 `git fetch origin` 并创建 `loop/lm6-03-context-assistant`；fallback: 若 UI 分层受阻，先以 task catalog 构建简单/高级模式的纯路由注册表和 fake-provider preflight fixture。
- Sweep cursor: LM6-03
- Notes: 驾驶舱状态是只读派生；任务运行、失败、未采用静帧和真实 delivery 均不会被渲染为完成。

### LM6-03 / Attempt 1 — 2026-08-12 00:49 CST

- Loop: LM6-03
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-03-context-assistant
- Commit(s): `5fb94e7c loop(lm6-03): add contextual assistant modes`
- Merge commit: `1397e801 merge: LM6-03 contextual assistant modes`
- Verification:
  - `bun run typecheck && bun run lint`: PASS — 12 个 typecheck 任务与 `oxlint --deny-warnings` 通过。
  - `bun run test:unit`: PASS — 包级测试、SQLite 旧库偏好迁移、LM6-00 至 LM6-03 fixture、任务注册表穷尽/路由 parity 和 Node HTTP contract 通过。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS — OpenAPI/client 生成物、引擎锁和 Provider catalog 已核验。
  - `bun run build && bun run test:e2e`: PASS — Desktop build 成功，6 个 Electron 场景通过；新增场景确认默认不出现引擎/模型/task/盲测选择器，高级模式可恢复完整控制且偏好能保存。
- Diff review: PASS — 仅包含基于权威 task catalog 的上下文注册表、简单/高级侧栏、项目偏好与旧库兼容迁移、PUT CORS 预检、费用未知的远程执行门禁、生成客户端、fixture、测试、指南和调度元数据；没有凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 功能 merge 前 `origin/main` 为 `7c259d58`，fast-forward 检查通过。
- Push: PASS — 功能 merge `1397e801` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-03-context-assistant` 与 `/Volumes/A/code/project/dramaIp-lm6-03`。
- Current branch/worktree: `integrate/lm6-03-context-assistant`; `/Volumes/A/code/project/dramaIp-integrate-lm6-03`; 仅有本执行记录的显式改动。
- Completed: 8 个页面上下文的 1–3 个受控推荐动作、简单/高级双层 UI、项目级模式偏好、任务快照共享路由、输入/能力/费用状态、未知报价时禁用最终远程媒体执行、旧 task type 保持不变、CORS PUT 浏览器预检及任务中心既有 preview/adopt 语义。
- Unfinished: 无；LM6-04 将单独实现原著导入后的五类提取 change set，不会由 LM6-03 的推荐路由直接写入权威数据。
- Evidence: `packages/app/src/context-assistant.ts`、`tests/lm6/lm6-03.test.ts`、`tests/electron/lm6-03.spec.ts`、`packages/server/src/sidecar.node.test.ts`、用户指南与完整回归/合并推送提交。
- Next attempt: 开始 LM6-04，先运行 `git fetch origin` 并创建 `loop/lm6-04-import-change-set`；fallback: 若完整模型编排受阻，先使用版本化 extraction fixture 验证五类候选、事务、幂等、stale 与 selective adopt 的领域闭环。
- Sweep cursor: LM6-04
- Notes: 首次全量 Electron 回归发现助手章节下拉与工作区章节标题同名；已明确标注“助手上下文”并在同一 Attempt 的完整回归中重跑通过。媒体调用的规划仍可生成 preview，但没有可靠报价时最终远程任务保持禁用。

### LM6-04 / Attempt 1 — 2026-08-12 01:20 CST

- Loop: LM6-04
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-04-import-change-set
- Commit(s): `ec171e20 feat(import): add LM6-04 reviewable extraction change sets`
- Merge commit: `c4dadf00 merge: LM6-04 import extraction change sets`
- Verification:
  - `bun run typecheck && bun run lint`: PASS — 12 个 typecheck 任务及 `oxlint --deny-warnings` 通过。
  - `bun run test:unit`: PASS — 159 个断言通过；覆盖五类候选契约、SQLite schema、Node HTTP 的选择性原子采用、同名人工冲突、重复采用防重、stale、人工编辑保护撤销和项目包 round-trip。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS — OpenAPI/client 生成物、OpenCode `1.18.15`、Codex `0.147.0` 和 Provider catalog 均已核验。
  - `bun run build && bun run test:e2e`: PASS — Desktop build 成功，7 个 Electron 场景通过；新增小说导入 → 五类候选全量预览 → 取消其余选择 → 单项采用路径。
- Diff review: PASS — 仅包含导入候选 schema/protocol/generated client、SQLite 持久化、原子采用/撤销、项目页审阅 UI、项目包回环、合成 fixture、测试、用户指南及受控 E2E 文件选择；未纳入凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 合并前 `origin/main` 为 `15733b50`；无快进 merge `c4dadf00` 已推送至 `origin/main`。
- Push: PASS — 功能 merge `c4dadf00` 已推送。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-04-import-change-set` 与 `/Volumes/A/code/project/dramaIp-lm6-04`。
- Current branch/worktree: `integrate/lm6-04-import-change-set`; `/Volumes/A/code/project/dramaIp-integrate-lm6-04`; 仅有本执行记录的显式改动。
- Completed: 已确认导入以稳定 source fingerprint、章节文本范围、版本和置信度生成角色、场景、道具、章节摘要与改编建议；所有候选先进入统一变更集，可编辑、拒绝和选择性采用。采用事务写入人物/场景、素材道具、章节摘要及改编资料；来源变化会 stale，同名人工内容不覆盖，重复采用不创建重复实体，撤销保留采用后的人工编辑。导入候选在本机确定性整理，Provider 不可用不会影响原稿正文继续编辑，并在任务中心记录 `source_import.extract`。
- Unfinished: 无；实时模型提取不是本 Loop 的前置条件，后续 Loop 如接入 Provider 只能补充候选，不能绕过本变更集、来源版本与人工确认边界。
- Evidence: `packages/server/src/sidecar.ts`、`packages/server/src/sidecar.node.test.ts`、`tests/lm6/lm6-04.test.ts`、`tests/electron/lm6-04.spec.ts`、`tests/fixtures/lm6/lm6-04/extraction-contract.json`、用户指南与 merge/push 提交。
- Next attempt: 开始 LM6-05，先运行 `git fetch origin` 并创建 `loop/lm6-05-pilot-wizard`；fallback: 先以 1 / 2 / 3 集 fixture 固定可恢复状态机、人工 Gate 和 retry / resume，再接制作页。
- Sweep cursor: LM6-05

### LM6-05 / Attempt 1 — 2026-08-12 01:45 CST

- Loop: LM6-05
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-05-pilot-wizard
- Commit(s): `f3cb6d15 feat(pilot): add LM6-05 recoverable pilot wizard`
- Merge commit: `f5af2b67 merge: LM6-05 recoverable pilot wizard`
- Verification:
  - `bun run typecheck && bun run lint && bun run test:unit`: PASS — 12 个 typecheck、174 条 unit 断言与 Node HTTP contract 通过；覆盖 1/2/3 集上限、确认幂等、stale/resume 与取消边界。
  - `bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog`: PASS。
  - `bun run build && bun run test:e2e`: PASS — 8 个 Electron 场景通过，新增原著导入 → 一集试制 → 来源确认 → 唯一待办路径。
- Diff review: PASS — 只增加 pilot plan schema/protocol/client、持久化运行游标、由权威实体派生的阶段/覆盖率、项目页向导、测试/fixture/用户指南；无凭据、缓存或构建产物。
- Remote sync: PASS — 合并前 `origin/main` 为 `232922a1`；无快进 merge `f5af2b67` 已推送。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-05-pilot-wizard` 与 `/Volumes/A/code/project/dramaIp-lm6-05`。
- Completed: 用户可从已有章节建立 1–3 集试制；人工确认来源后幂等创建试制改编方案与分集，之后剧本/场景/分镜/资产阶段和唯一下一步完全由真实实体覆盖率决定。来源变化标为 stale，可重置当前来源版本后继续；取消不删除已采用内容。
- Unfinished: 无；不在此 Loop 生成图片或视频，真实媒体能力仍由后续生产链与 Gate 约束。
- Evidence: `packages/server/src/sidecar.ts`、`packages/server/src/sidecar.node.test.ts`、`tests/lm6/lm6-05.test.ts`、`tests/electron/lm6-05.spec.ts`、用户指南及 merge/push 提交。
- Next attempt: 开始 LM6-06 P0 Gate，先重跑完整自动化矩阵；发现缺陷回到所属 Loop 修复，不在 Gate 临时扩功能。
- Sweep cursor: LM6-06

### LM6-06 / Attempt 1 — 2026-08-12 02:10 CST

- Loop: LM6-06
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: loop/lm6-06-p0-gate
- Commit(s): `ddbf5f9e test(gate): add LM6-06 P0 evidence matrix`
- Merge commit: `c2d3f309 merge: LM6-06 P0 first-value gate`
- Verification:
  - `bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、196 条 unit 断言、Node HTTP / 项目包 contract 和 12 个 Electron 场景全部通过。
  - `bunx playwright test tests/electron/lm6-p0-gate.spec.ts`: PASS — 三条创建入口各自在 fresh profile 以键盘进入、在 1280×720 建立并确认 1 集试制、关闭重开后恢复；坏文件在 capability / 预览边界被拒绝且未产生导入内容。
  - 旧数据与负向状态：PASS — SQLite 旧项目助手偏好迁移、项目包 round-trip、无 Provider、未知成本和中断任务状态均在现有受控 unit / Node contract 中通过；未调用真实 Provider。
- Diff review: PASS — 仅包含 P0 Gate E2E、合成坏文件 fixture 和可审计证据矩阵；无产品功能扩张、凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 合并前 `origin/main` 为 `559d3783`，完成 `git fetch origin` 后无冲突合并。
- Push: PASS — 功能 merge `c2d3f309` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-06-p0-gate` 与 `/Volumes/A/code/project/dramaIp-lm6-06`。
- Current branch/worktree: `integrate/lm6-06-p0-gate`; `/Volumes/A/code/project/dramaIp-integrate-lm6-06`; 仅有本执行记录的显式改动。
- Completed: P0 首次价值 Gate 已以真实 Electron 旅程验证：灵感、原著、剧本三入口均可在隔离 profile 中到达已确认的试制计划并于重开后恢复；默认助手与高级模式、五类候选采用、旧项目 / 项目包、离线能力和诚实状态均有机器证据。
- Unfinished: 无；P1 资产、看板、静帧 Gate、节奏和 Story Bible 仍由 LM6-10 至 LM6-15 单独实现与放行。
- Evidence: `dramaip-desktop/tests/electron/lm6-p0-gate.spec.ts`、`dramaip-desktop/tests/lm6/lm6-06.test.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-06/`、完整桌面回归、merge / push 提交。
- Next attempt: 开始 LM6-10，先运行 `git fetch origin` 并创建 `loop/lm6-10-asset-center`；fallback: 若主界面接线受阻，先用四类资产、锁 / usage 和媒体错误 fixture 建立兼容 read model 与删除保护。
- Sweep cursor: LM6-10

### LM6-10 / Attempt 1 — 2026-08-12 01:50 CST

- Loop: LM6-10
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-10-asset-center`
- Commit(s): `5acb2132 feat(assets): add LM6-10 unified asset center`
- Merge commit: `f974e2bf merge: LM6-10 unified asset center`
- Verification:
  - `bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、210 条 unit 断言、Node HTTP / 既有项目包 contract、生成契约、引擎与 Provider catalog、生产构建和 13 个 Electron 场景均通过。
  - `tests/lm6/lm6-10.test.ts`: PASS — 锁定四类资产、状态、用途、受控预览与删除保护的跨层契约。
  - `packages/server/src/sidecar.node.test.ts`: PASS — 受控 SVG 预览、锁定候选阻止替换、采用 / 锁 / 解锁、镜头分配 / 移除、被使用版本的删除阻断及旧版本安全删除全部通过；资产状态继续存储于通用实体 payload，因此项目包兼容导出不复制媒体二进制。
  - `tests/electron/lm6-10.spec.ts`: PASS — 制作区可进入统一资产中心，四类筛选和候选比较入口在桌面端可用。
- Diff review: PASS — 仅包含资产中心 schema / protocol / generated client、既有视觉资产兼容 read model、受控本地预览、锁与镜头用途保护、UI、fixture、测试和用户指南；没有凭据、缓存、构建产物、媒体二进制复制或主工作区改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `43bedba3`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `f974e2bf` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-10-asset-center` 与 `/Volumes/A/code/project/dramaIp-lm6-10`。
- Current branch/worktree: `integrate/lm6-10-asset-center`; `/Volumes/A/code/project/dramaIp-integrate-lm6-10`; 仅有本执行记录的显式改动。
- Completed: 角色、场景、道具、音色资产可在统一中心搜索、筛选、比较、采用、锁定和解锁；锁定版本能列出镜头用途，使用中删除被服务端阻断。预览只对受控、本地、允许类型且不超过 5 MB 的媒体返回 data URL；文件缺失、未附加、权利受限、费用未知与服务不可用保持不同且诚实的状态。
- Unfinished: 无；跨项目资产复用由 LM6-23 单独实现，批量视频生成不属于本 Loop。
- Evidence: `dramaip-desktop/packages/server/src/sidecar.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/tests/lm6/lm6-10.test.ts`、`dramaip-desktop/tests/electron/lm6-10.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-10/`、`dramaip-desktop/docs/product/USER_GUIDE.md`、功能 merge 与远端推送。
- Next attempt: 开始 LM6-11，先运行 `git fetch origin` 并创建 `loop/lm6-11-storyboard-board`；fallback: 先以排序 / undo、100+ shot 与类型化资产 fixture 实现看板 read model 和键盘操作，再接拖拽界面。
- Sweep cursor: LM6-11
- Notes: 回退资产中心 UI 不删除既有资产版本、锁、权利或镜头引用；旧视觉资产 CRUD 仍作为兼容入口。媒体预览没有暴露本地路径，也没有伪造远程生成成功。

### LM6-11 / Attempt 1 — 2026-08-12 02:05 CST

- Loop: LM6-11
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-11-storyboard-board`
- Commit(s): `6ac215a0 feat(storyboard): add LM6-11 director board`
- Merge commit: `8f950442 merge: LM6-11 director storyboard board`
- Verification:
  - `bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、221 条 unit 断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建和 14 个 Electron 场景均通过。
  - `packages/app/src/storyboard-board.test.ts`: PASS — 从权威 episode → script → scene → shot 层级派生卡片、资产引用 / 锁 / 静帧状态，以及 120 镜头稳定排序与局部重排。
  - `tests/electron/lm6-11.spec.ts`: PASS — 看板展示镜头和诚实静帧状态；Alt+↑ 重排、原生拖拽、撤销、资产用途跳转与智能助手镜头上下文均在桌面端通过。
  - 同级重排契约：PASS — 复用完整 sibling 集合、版本乐观锁和 SQLite 事务；并发旧版本返回冲突，不会产生重复顺序。
- Diff review: PASS — 仅包含导演看板 read model / UI、现有重排接口接线、受控资产与助手上下文、双镜头示例、fixture、单元 / Electron 测试及用户指南；没有凭据、缓存、构建产物、并行排序存储或主工作区改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `f1577b4b`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `8f950442` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-11-storyboard-board` 与 `/Volumes/A/code/project/dramaIp-lm6-11`。
- Current branch/worktree: `integrate/lm6-11-storyboard-board`; `/Volumes/A/code/project/dramaIp-integrate-lm6-11`; 仅有本执行记录的显式改动。
- Completed: 制作区新增集级卡片式导演看板，按场景展示镜头画面、对白、景别、运镜、时长、镜头任务、四类资产覆盖、锁定、权利 / 成本风险和真实静帧状态。支持搜索、风险筛选、批量选择、同场景键盘 / 拖拽重排、一次撤销、50 张分段加载，并将选中镜头带入资产中心和后续助手任务上下文。
- Unfinished: 无；多轨播放、静帧批准和高成本视频 Gate 属于 LM6-12 及后续 Loop。
- Evidence: `dramaip-desktop/packages/app/src/storyboard-board.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/packages/app/src/storyboard-board.test.ts`、`dramaip-desktop/tests/lm6/lm6-11.test.ts`、`dramaip-desktop/tests/electron/lm6-11.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-11/`、用户指南、功能 merge 与远端推送。
- Next attempt: 开始 LM6-12，先运行 `git fetch origin` 并创建 `loop/lm6-12-still-first-gate`；fallback: 先以调用记录型 fake adapter 建立静帧采用 / stale、资产锁、权利、费用、幂等与“零视频提交”契约，再接预检界面。
- Sweep cursor: LM6-12
- Notes: 缺失受控静帧时看板明确显示状态，不伪造缩略图；长场景只渲染首段 50 张卡片。镜头上下文会计入助手任务与盲测的输入估算，不会静默改变项目、资产或任务权威状态。

### LM6-12 / Attempt 1 — 2026-08-12 02:34 CST

- Loop: LM6-12
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-12-still-first-gate`
- Commit(s): `d764e1d7 feat(video): add LM6-12 still-first readiness gate`
- Merge commit: `412b0e28 merge: LM6-12 still-first video gate`
- Verification:
  - `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、244 条 unit 断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建和 15 个 Electron 场景全部通过。
  - `packages/server/src/sidecar.node.test.ts`: PASS — fake Provider 记录零次阻断调用；静帧 / 已锁定授权资产 / 成本确认 / 快照一致时才发出一次视频调用；幂等重放不增加调用或任务，批量预检会逐项保留阻断并发现并发上限。
  - `tests/electron/lm6-12.spec.ts`: PASS — 未通过 Gate 时提交按钮禁用，桌面端没有发出 `/api/v1/video-generation/runs` 请求。
  - readiness truth table: PASS — 缺少采用静帧、过期或未锁定资产、权利未核验、费用未知未确认、服务商配置不完整、输入提示 / 时长偏离镜头确认基线、并发上限和快照改变均由服务端在厂商 HTTP 调用前阻断。
- Diff review: PASS — 仅包含静帧确认指纹、视频预检 / 批量预检协议与生成客户端、服务端 Gate / 幂等 / 账本记录、视频表单、fixture、Node / Electron 测试和用户指南；没有凭据、缓存、构建产物或未关联格式化改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `8aa7e53e`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `412b0e28` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-12-still-first-gate` 与 `/Volumes/A/code/project/dramaIp-lm6-12`。
- Current branch/worktree: `integrate/lm6-12-still-first-gate`; `/Volumes/A/code/project/dramaIp-integrate-lm6-12`; 仅有本执行记录的显式改动。
- Completed: 采用静帧会冻结镜头提示、时长、静帧版本和资产版本指纹；视频提交仅接受服务器预检快照。服务端校验采用 / stale、资产采用锁定、权利、资产服务状态、费用确认、Provider 配置、镜头输入基线、单项 / 批量并发上限和幂等键，并将静帧、资产、快照与费用状态写入任务和生成账本。前端会预填镜头基线、显示逐项阻断与费用确认，并在提交前再次校验。
- Unfinished: 无；真正的批量提交队列、多轨时间线与最终成片仍属于后续 Loop，不将预检结果伪装为最终渲染。
- Evidence: `dramaip-desktop/packages/server/src/sidecar.ts`、`dramaip-desktop/packages/server/src/sidecar.node.test.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/tests/lm6/lm6-12.test.ts`、`dramaip-desktop/tests/electron/lm6-12.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-12/`、用户指南、功能 merge 与远端推送。
- Next attempt: 开始 LM6-13，先运行 `git fetch origin` 并创建 `loop/lm6-13-episode-pacing`; fallback: 先基于现有剧本 / 场景 / 分镜只读数据建立节奏 read model、阈值 fixture 与定位修订任务，再接可视化和编辑器跳转。
- Sweep cursor: LM6-13
- Notes: 服务端是付费视频 Gate 的唯一权威；UI 禁用、Agent 厂商预览和旧直接调用路径都不能绕过静帧、权利、费用或快照验证。费用未知的确认只允许提交，不伪造已知成本；实际费用仍须在生成账本补录。

### LM6-13 / Attempt 1 — 2026-08-12 CST

- Loop: LM6-13
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-13-episode-pacing`
- Commit(s): `7c020713 feat(story): add LM6-13 episode pacing board`
- Merge commit: `7a4a73bf merge: LM6-13 episode pacing board`
- Verification:
  - `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、259 条 unit 断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建和 16 个 Electron 场景全部通过。
  - `packages/app/src/episode-pacing.test.ts`: PASS — 空分集不伪造曲线；分集 / 剧本 / beat / 场景 / 镜头依稳定实体层级与顺序映射；120 镜头长分集保持稳定；来源版本变化会 stale，人工标记可保留为已否决审查历史。
  - `packages/server/src/sidecar.node.test.ts`: PASS — 上下文 AI 任务只产出 `change-preview`；采用脚本文本前保存节奏修订检查点，恢复检查点可回到采用前文本且会再保存当前版本。
  - `tests/electron/lm6-13.spec.ts`: PASS — 示例项目的改编区在选择分集、剧本和场景后同时暴露四条具名、可访问轨道。
- Diff review: PASS — 仅包含节奏 read model、全分集来源聚合、人工标记资源、版本 stale、受控 AI 修订任务 / 内容检查点、UI、合成 fixture、Node / Electron 测试和用户指南；没有凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `52837100`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `7a4a73bf` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-13-episode-pacing` 与 `/Volumes/A/code/project/dramaIp-lm6-13`。
- Current branch/worktree: `integrate/lm6-13-episode-pacing`; `/Volumes/A/code/project/dramaIp-integrate-lm6-13`; 仅有本执行记录的显式改动。
- Completed: 集级看板从当前分集、剧本、beat、场景与镜头建立单一可追溯时间轴，并把节拍密度、爽点、反转和结尾悬念同时呈现。每点标出规则或人工置信、稳定来源 ID / 版本与 stale 状态；人工标记支持新增、调整、否决且持久保存。规则诊断可携带上下文进入既有 Agent change preview，任务中心仍要求人工采用或放弃；采用脚本文本自动保留修订前检查点，用户可安全恢复，任何路径都不直接覆盖权威剧本。
- Unfinished: 无；市场预测、自动采用剧本与跨用户推荐均仍明确不在本 Loop 范围内。
- Evidence: `dramaip-desktop/packages/app/src/episode-pacing.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/packages/server/src/sidecar.ts`、`dramaip-desktop/packages/server/src/sidecar.node.test.ts`、`dramaip-desktop/tests/lm6/lm6-13.test.ts`、`dramaip-desktop/tests/electron/lm6-13.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-13/`、用户指南、功能 merge 与远端推送。
- Next attempt: 开始 LM6-14，先运行 `git fetch origin` 并创建 `loop/lm6-14-story-bible-sidecar`；fallback: 先建立章节 / 剧本作用域的 Story Bible read model、固定 / 搜索、stale 和 change-set parity 测试，再接侧栏与窄窗口键盘体验。
- Sweep cursor: LM6-14

### LM6-14 / Attempt 1 — 2026-08-12 CST

- Loop: LM6-14
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-14-story-bible-sidecar`
- Commit(s): `de65e036 feat(story): add LM6-14 story bible sidecar`
- Merge commit: `813fc5e6 merge: LM6-14 story bible sidecar`
- Verification:
  - `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、286 条 LM 契约断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建和 17 个 Electron 场景全部通过。
  - `packages/app/src/story-bible-sidecar.test.ts` 与 `tests/lm6/lm6-14.test.ts`: PASS — chapter / script 范围、相关人物 / 时间线 / 伏笔 / 已锁定视觉资产、草案和 stale 状态、无数据边界、偏好持久化与离线提示契约均可重复验证。
  - `packages/server/src/sidecar.node.test.ts`: PASS — 草案暴露字段预览；不合法选择被服务端拒绝；只采用“重要事件”时只写入该字段、来源章节及审计字段，不会写入未勾选内容。
  - `tests/electron/lm6-14.spec.ts`: PASS — 1280×720 下保存和修订预览仍可达；侧栏可用键盘折叠 / 展开，并完成“生成草案 → 取消字段 → 采用 → 撤销”。
- Diff review: PASS — 仅包含 Story Bible 侧栏 read model、章节 / 剧本接线、项目偏好资源、变更包预览与选择性采用契约、客户端生成物、Node / Electron / fixture 测试和用户指南；没有凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `142da4ec`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `813fc5e6` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-14-story-bible-sidecar` 与 `/Volumes/A/code/project/dramaIp-lm6-14`。
- Current branch/worktree: `integrate/lm6-14-story-bible-sidecar`; `/Volumes/A/code/project/dramaIp-integrate-lm6-14`; 仅有本执行记录的显式改动。
- Completed: 在章节编辑器与已选剧本审阅区常驻 Story Bible 侧栏，按当前内容聚合人物、关系与设定、时间线、伏笔、章节记忆和已锁定视觉资产。侧栏支持搜索、固定、来源跳转、折叠 / 宽度项目偏好、长列表滚动、空态和离线提示；草案展示可勾选字段，经同一 change set 事务选择性采用、版本 stale 拦截和撤销，不会改写正文。
- Unfinished: 无；大型知识图谱编辑、跨项目连续性和资产复用仍严格保留给后续 Loop。
- Evidence: `dramaip-desktop/packages/app/src/story-bible-sidecar.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/packages/server/src/sidecar.ts`、`dramaip-desktop/packages/server/src/sidecar.node.test.ts`、`dramaip-desktop/tests/lm6/lm6-14.test.ts`、`dramaip-desktop/tests/electron/lm6-14.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-14/`、用户指南、功能 merge 与远端推送。
- Next attempt: 开始 LM6-15，先运行 `git fetch origin` 并创建 `loop/lm6-15-p1-pilot-gate`; fallback: 先复核 LM6-10 至 LM6-14 的权威资产、静帧 Gate、节奏与 Story Bible 证据矩阵，再实现 P1 视觉试制 Gate 的负向阻断与 Electron 放行旅程。
- Sweep cursor: LM6-15

### LM6-15 / Attempt 1 — 2026-08-12 CST

- Loop: LM6-15
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-15-p1-pilot-gate`
- Commit(s): `8aa1d112 test(gate): add LM6-15 P1 pilot evidence`
- Merge commit: `78559e6b merge: LM6-15 P1 pilot gate`
- Verification:
  - `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、307 条 LM 契约断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建和 18 个 Electron 场景全部通过。
  - `packages/server/src/sidecar.node.test.ts`: PASS — 三章来源确认后确实生成 3 集并报告 `coverage.episodes = 3`；超出 1–3 集限制、重复确认、来源 stale / resume 仍维持既有原子边界。
  - `tests/electron/lm6-15.spec.ts`: PASS — 1280×720 下建立并确认 3 集试制，搜索并以键盘折叠 Story Bible，显式回到带权威静帧的改编 / 分集 / 剧本 / 场景 / 分镜，展示导演看板和采用静帧；视频预检按钮保持禁用，未发送视频提交请求。
  - `tests/lm6/lm6-15.test.ts` 与 P1 matrix fixture: PASS — 锁定资产、分镜、静帧、节奏与 Story Bible 的既有自动化证据，以及缺媒体、权利、成本、Provider、长列表和窄窗口边界均被纳入 P1 Gate。
- Diff review: PASS — 仅包含 P1 Gate 证据矩阵、三集服务端合同和跨工作区 Electron 场景；没有产品范围外的时间线 / 云端能力、凭据、缓存、构建产物或主工作区改动。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `f798f3b3`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `78559e6b` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-15-p1-pilot-gate` 与 `/Volumes/A/code/project/dramaIp-lm6-15`。
- Current branch/worktree: `integrate/lm6-15-p1-pilot-gate`; `/Volumes/A/code/project/dramaIp-integrate-lm6-15`; 仅有本执行记录的显式改动。
- Completed: P1 视觉试制 Gate 已把 1 集恢复证据与新的 3 集试制证据合并为可执行矩阵。导演必须在明确的权威层级中查看锁定资产、卡片分镜、采用静帧、节奏和 Story Bible；发生媒体 / 权利 / 成本 / Provider 缺口时，服务端视频 Gate 仍在厂商请求前阻断，不能由 UI 或新 Gate 场景绕过。
- Unfinished: 无；多轨时间线、自动音频编排、最终交付、系列资产库与云审片均为 P2 后续工作，未在 P1 Gate 中提前实现。
- Evidence: `dramaip-desktop/packages/server/src/sidecar.node.test.ts`、`dramaip-desktop/tests/lm6/lm6-15.test.ts`、`dramaip-desktop/tests/electron/lm6-15.spec.ts`、`dramaip-desktop/tests/fixtures/lm6/lm6-15/`、LM6-10…LM6-14 既有测试、功能 merge 与远端推送。
- Next attempt: 开始 LM6-20，先运行 `git fetch origin` 并创建 `loop/lm6-20-multitrack-timeline`; fallback: 先以稳定 canonical timeline schema、短 / 长 fixture、缺媒体和 undo 命令测试建立独立编辑器模型，再接桌面播放与编辑交互。
- Sweep cursor: LM6-20

### LM6-20 / Attempt 1 — 2026-08-12 CST

- Loop: LM6-20
- Attempt: 1
- Outcome: done
- Target branch: main
- Loop branch: `loop/lm6-20-multitrack-timeline`
- Commit(s): `2bb220cf feat(timeline): add LM6-20 multitrack editor`
- Merge commit: `b94769c9 merge: LM6-20 multitrack timeline`
- Verification:
  - `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test:unit && bun run check:generated && bun run check:engine-locks && bun run check:provider-catalog && bun run build && bun run test:e2e`: PASS — 12 个 typecheck 包、340 条 LM 契约断言、Node HTTP contract、生成契约、引擎与 Provider catalog、生产构建均通过；集成工作树首次 Electron 下载后的完整重跑为 19/19。
  - `packages/server/src/sidecar.node.test.ts`: PASS — canonical 时间线稳定重开；video / dialogue / narration / BGM / SFX / subtitle 六轨初始化；25 fps 取整、move / split、undo / redo、重链与受控短 WAV 预览均通过。
  - `tests/electron/lm6-20.spec.ts`: PASS — 桌面端可播放 / 暂停、scrub、移动片段、撤销 / 重做、静音，并在重新进入工作区后保留版本化编辑。
  - `tests/lm6/lm6-20.test.ts`: PASS — schema、HTTP 契约、SQLite 历史、受控媒体预览、25 fps timebase 与用户文档的跨层边界可重复核验。
- Diff review: PASS — 仅包含时间线 schema / protocol / generated client、SQLite 时间线与历史、受控媒体预览、桌面多轨编辑器、测试 fixture、Node / Electron 测试和用户指南；没有凭据、缓存、构建产物、本地绝对路径或对源媒体的写入。
- Remote sync: PASS — 功能合并前 `origin/main` 为 `84dbe295`；在干净集成 worktree 无冲突 `--no-ff` 合并。
- Push: PASS — 功能 merge `b94769c9` 已推送至 `origin/main`。
- Loop branch cleanup: PASS — 已删除 `loop/lm6-20-multitrack-timeline` 与 `/Volumes/A/code/project/dramaIp-lm6-20`。
- Current branch/worktree: `integrate/lm6-20-multitrack-timeline`; `/Volumes/A/code/project/dramaIp-integrate-lm6-20`; 仅有本执行记录的显式改动。
- Completed: 为每集建立一次性、版本化 canonical timeline；初始轨道总是包括视频、对白、旁白、配乐、音效与字幕，已有人工编辑绝不被重装配覆盖。桌面端以统一播放头同步可见视频和可听音轨，支持播放 / scrub / 缩放、静音 / 独听、move / trim / split、即时保存、undo / redo 与项目内重链接。媒体缺失、未附加和不支持编码保持可打开且有明确状态；时间线仅存实体引用和 25 fps 秒级时间，不修改源文件。
- Unfinished: 无；自动音频 / 字幕编排、权利与成本谱系、保护人工锁定 clip 和后期交换格式由 LM6-21、LM6-22 单独实现。
- Evidence: `dramaip-desktop/packages/schema/src/index.ts`、`dramaip-desktop/packages/protocol/src/index.ts`、`dramaip-desktop/packages/db/src/operational-schema.ts`、`dramaip-desktop/packages/server/src/sidecar.ts`、`dramaip-desktop/packages/app/src/main.tsx`、`dramaip-desktop/tests/lm6/lm6-20.test.ts`、`dramaip-desktop/tests/electron/lm6-20.spec.ts`、用户指南、功能 merge 与远端推送。
- Next attempt: 开始 LM6-21，先运行 `git fetch origin` 并创建 `loop/lm6-21-auto-assembly`；fallback: 使用确定性短音频 fixture 实现 alignment / cue、部分 stale、受保护手工 clip 合并与试听，再接可用 Provider 的局部 TTS / 音乐任务。
- Sweep cursor: LM6-21
