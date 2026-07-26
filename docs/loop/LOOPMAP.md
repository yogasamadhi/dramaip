# AI 漫剧全链路产品优化 Loop Map 5

本文档依据 [LOOPRULE.md](./LOOPRULE.md) 编写，用于把 2026-07-22 对
`dramaip-desktop` 的小说写作、AI 漫剧题材、制作流程、交付合规和用户体验审计结论，
拆成可逐轮执行、审查、验证、提交、回滚和远端闭环的端到端能力 loop。

本地图承接历史 LM2～LM4 已交付的本地创作、长篇一致性、可信 AI、结构化剧本、
Storyboard、视频队列、Hailuo/Wan/Sora、任务恢复、设计系统与发布 Gate，不重做已有能力。
本地图的最终用户结果是：

> 独立创作者或小型团队可以从灵感、现成小说或现成剧本出发，先低成本完成一集可评审
> 样片，再以可控成本和可追溯资产批量生产，最终获得可发布、可审计、可复盘的完整成片。

> 执行状态说明：LM5-00～LM5-09 已按本地图完成代码提交、合并、远端推送和分支清理；
> LM5-10 已完成 Keychain 设置、任务/归档、本地取消与无凭据谱系闭环，但真实外部沙箱尚待账户所有者授权；
> LM5-11～LM5-13、LM5-15～LM5-20 已完成并推送；LM5-14 已完成 Keychain 设置、任务/归档、本地取消与无凭据谱系闭环，但真实外部沙箱尚待账户所有者授权；
> LM5-17～LM5-20 已完成并推送；LM5-21 已完成本地发布 Gate 并以 `partial` 收口，等待账户所有者
> 授权真实图片/TTS/视频沙箱和签名安装/升级/回滚证据；不得将未签名本地构建或适配器合同测试误报为正式发布。

## 0. 目标与范围

### 0.1 总体目标

完成以下用户可见结果：

1. 用带来源日期、热度、饱和度、制作难度和平台适配的市场机会矩阵替代静态题材标签。
2. 支持“写小说并改编”“导入已有小说/IP”“直接制作漫剧”三种真实创建路径。
3. 支持把 TXT、Markdown、DOCX、EPUB 小说正文或结构化漫剧剧本导入主项目，而不再只能
   作为样本或项目包处理。
4. 将复杂工作台收敛为任务导向的信息架构，并让故事记忆在用户确认后自动维护。
5. 用目标覆盖率、阻塞项、成本和质检真值表示项目进度；优先完成 1～3 集试播样片，
   未经确认不批量扩展整季。
6. 建立可复现的生产资产和任务谱系，保存模型、参数、种子、参考资产、源内容版本、
   成本和采用关系。
7. 建立角色、场景、服装、道具、首帧和分镜静帧的真实图片生产与一致性工作流。
8. 建立粗剪 Animatic、配音、字幕、BGM、音效、时间线剪辑和完整 MP4 导出能力。
9. 对画面、声音、字幕、连续性、成片完整性和失败素材执行可解释的自动/人工质检。
10. 建立版权与授权台账、AIGC 显式/隐式标识、版本化平台规则和交付前检查。
11. 建立平台交付包、标题/封面 A/B 方案、真实播放与评论数据导入、修稿回流和海外本地化。
12. 在最终 Gate 中证明三种创建路径都能完成可恢复、可追溯、可交付的闭环。

### 0.2 用户、产品定位与成功结果

默认用户：

- 第一优先：独立小说作者、AI 漫剧个人创作者。
- 第二优先：2～10 人的小型编剧/制作团队使用同一台设备或交换项目包协作。
- 非默认：大型影视制片公司、真人拍摄剧组、实时多人云端编辑团队。

产品定位：

> 本地优先的 AI 漫剧创作与生产工作台，而不是只生成正文、Prompt 或单镜头视频的工具。

成功结果按用户产物判断，不按 AI 调用次数判断：

- 三种创建入口都能进入同一套可解释的项目模型。
- 用户选择的试播集有完整的剧本、镜头、已采用资产、声音、字幕、时间线和成片。
- 每个最终成片能追溯到源章节/剧本版本、生成任务、采用资产、授权证明和质检结果。
- 项目能显示目标覆盖率、预计/实际成本、失败项和下一步，不以“存在一条记录”冒充完成。
- 导出不会遗漏当前规则要求的 AI 标识、版权信息、字幕或平台交付字段。
- 导入反馈可定位到集、场景、镜头或叙事节拍，并形成可预览、可撤销的修订任务。

### 0.3 研究与产品依据

本地图采用 2026-07-22 的公开信息快照，不把市场趋势写成永久事实：

- [2025 中国网络文学发展研究报告](https://www.cssn.cn/skgz/bwyc/202604/t20260420_5981165.shtml)：
  类型细分、都市玄幻、末世高武、历史、古言、民俗志怪、推理治愈与精品化趋势。
- [2026 中国 AI 短剧行业发展与受众洞察报告](https://pdf.dfcfw.com/pdf/H3_AP202604101821108151_1.pdf?1775812269000.pdf=)：
  奇幻玄幻、游戏系统、末世、悬疑、规则怪谈等偏好，以及 AI 漫剧与仿真人剧的题材差异。
- [2024 中国网络文学蓝皮书](https://wyb.chinawriter.com.cn/Pad/content/202506/30/content79852.html)：
  AI 长篇直接生成仍弱，AI 更适合作为结构、上下文、语义和写作辅助。
- [数字化时代文学阅读的新样态](https://www.chinawriter.com.cn/n1/2026/0427/c404027-40709177.html)：
  章评、段评、评论和二创对人物与剧情调整的真实反馈价值。
- [2026 AI 漫剧行业市场发展趋势洞察](https://test-oss.busionline.com/attachment/2026042917474169f1d3bd1db2c.pdf)：
  剧本、分镜、绘图、动画、配音、字幕与剪辑构成完整生产链，而非只生成视频片段。
- [人工智能生成合成内容标识办法](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)：
  2025-09-01 起实施的显式标识和隐式标识要求。
- [“微短剧精品创作传播计划”实施方案](https://www.nrta.gov.cn/art/2026/5/26/art_113_73378.html)：
  精品化、原创、全流程管理、内容审核与传播台账方向。
- [微短剧发展管理办法（征求意见稿）](https://www.nrta.gov.cn/art/2026/6/24/art_113_73514.html)：
  仅作为 2026-06-24 的规则候选来源，未生效内容不得写成确定法规。
- [红果持续治理 AI 短剧素材违规使用](https://jingxuan.douyin.com/m/video/7625574094905396489)：
  平台对无授权素材的现实处置风险。

### 0.4 覆盖范围

本地图覆盖：

- `dramaip-desktop/apps/desktop` 的 Electron main/preload/IPC、renderer 页面和组件。
- `dramaip-desktop/packages/core` 的类型、schema、常量、能力注册与共享规则。
- `dramaip-desktop/packages/db` 的迁移、repository、事务与项目包往返。
- `dramaip-desktop/packages/ai` 的任务、上下文、结构化输出、图片/音频能力适配。
- `dramaip-desktop/packages/export` 的成片清单、平台交付、合规标识和反馈交换格式。
- `dramaip-desktop/tests`、Electron E2E、UI baseline、DB smoke、打包 smoke 和必要的沙箱 smoke。
- 与同一能力验收边界紧密相关的用户手册、工程说明、迁移说明和运行手册。
- 仅当 Desktop 的可选云能力确实需要时，最小化修改 `dramaip-platform` 的端专属 BFF 或契约；
  不得顺手扩张为平台重构。

### 0.5 明确不覆盖

本地图不承诺：

- 依赖抓取红果、抖音、番茄或其他平台私有榜单来提供“实时热度”。
- 在没有官方 API、沙箱、授权和稳定协议时自动登录、代投、代发或抓取平台数据。
- 一次接通 UI 中所有图片、视频、语音供应商；每个真实供应商必须有独立官方 API、
  Feature Flag、沙箱证据和回滚边界。
- 自动训练或托管 LoRA、声音克隆模型；本地图只管理经授权的模型/参考资产标识与调用。
- 克隆未经授权的真人脸、演员形象、真实配音员或普通用户声音。
- 把 Desktop 本地 SQLite 改成云端可信源，或实现实时多人协作、自动冲突合并。
- 把第三方小说、样本原文、媒体二进制、完整 Prompt 或项目正文默认上传到公共服务。
- 以“一键生成整季”为默认路径；批量生产必须在试播样片人工通过后显式开启。
- 用软件检查替代平台审核、发行许可/备案判断或专业法律意见。
- 为追求“全自动”删除人工采用、版本、撤销、成本确认和版权确认步骤。

## 1. 当前基线

### 1.1 已具备且不得重做的能力

- 本地 SQLite、版本化迁移、启动备份、项目包往返与系统 Keychain 凭据保护。
- 项目、人物、大纲、章节、长篇规划、记忆、人物状态、时间线、伏笔与一致性检查。
- AI 上下文预览、固定/排除、token 估算、写入确认、Diff、内容版本和修稿采用。
- 项目首页下一步、章节树、专注编辑、可恢复草稿、任务中心和批量任务恢复。
- 统一改编生产壳、分集规划、结构化剧本编辑、场景与 Storyboard 分镜工作台。
- 镜头 Prompt、首帧/封面/旁白/字幕文本草稿、资产引用和分镜交付包。
- 视频任务排队、估算、自动轮询、多结果对比、本地归档和最佳结果选择。
- Mock、OpenAI Sora、Hailuo、Wan 与 custom 视频适配；未实现供应商保持禁用真值。
- 设计系统、浅色/深色、密度、reduced-motion、UI baseline 和 Electron smoke 底座。
- 小说投稿、短剧提案、分集、分镜 Markdown/JSON/CSV 与完整项目包导出。

以上能力可以在新 loop 中扩展，但不得以“重新设计”为理由回退保存、恢复、可访问性、
上下文透明、版本、任务可靠性、供应商真值或本地优先边界。

### 1.2 已确认的主要差距

#### P0：用户不能直接开始或正确判断完成

- 漫剧创建仍以软件内已有小说为前提，现成小说/IP和直接剧本路径不顺畅。
- 小说主稿没有 TXT/Markdown/DOCX/EPUB 的事务化导入向导；样本导入不能代替主稿导入。
- 题材预设缺少来源日期、表现形式、平台、饱和度、成本与合规风险维度。
- 进度仍可能因“一张人物卡、一章正文、一集剧本、一个最佳视频”过早显示完成。
- 资产只有通用 `metadata`，没有一等版权、授权、生成谱系和标识状态。
- AIGC 标识和平台规则尚未成为导出 Gate。

#### P1：从分镜到完整成片存在生产断点

- 人物视觉档案主要是文字和引用地址，不是版本化角色定妆、表情、服装与道具资产包。
- 封面、首帧、旁白和字幕任务明确只生成文本草稿，不会真实生图、配音或渲染字幕。
- 没有第一等图片任务、图片 Provider、静帧变体采用、跨镜头视觉一致性检查。
- 没有低成本 Animatic、音频轨、字幕轨、BGM/SFX、剪辑时间线和最终 MP4 导出。
- 视频任务缺少统一的源内容版本、精确参数快照、seed、参考权重和可复现克隆语义。
- 没有对黑帧、冻结、字幕溢出、音量、嘴型、角色漂移和镜头完整性的成片质检。

#### P2：没有发布与反馈闭环

- 平台交付仍以通用 Markdown/JSON/CSV 为主，缺少版本化平台交付 Profile 和成片清单。
- 没有标题、封面、简介、标签的 A/B 方案及采用记录。
- 没有真实播放、完播、停留、互动、评论和读者反馈导入到修稿任务的链路。
- 没有语言版本、字幕/配音本地化、文化适配和海外交付变体。

### 1.3 本地图创建时的工作区与可信检查

截至 2026-07-22：

- 当前目标分支显示为 `main...origin/main`。
- 工作区已有多项未提交的 Desktop 题材、创建页、Dashboard、Chat、DB、测试和样式改动。
- `docs/loop/LOOPMAP.md` 是本次新建的未跟踪空文件。
- 本次编写地图不整理、不覆盖、不提交上述既有改动，也不据此宣告任何 LM5 loop 已开始。
- 因工作区不干净，本次未执行 `git fetch`、`ff-only`、切 loop 分支或完整测试；这些动作属于
  每个实现 loop 的开始流程，必须在执行前先解决工作区归属。

### 1.4 执行前阻塞条件

LM5-00 开始前必须完成：

1. 逐项确认当前未提交改动的 Owner 和所属目标；不得把无关改动带入 LM5 分支。
2. 将既有改动提交到其正确分支、移交给 Owner，或由维护者明确授权其他安全处理方式。
3. 工作区干净后再按 `LOOPRULE.md` 执行 fetch、ff-only 和 loop 分支创建。
4. 如果现有题材改动与 LM5-01 重叠，LM5-01 以累计 diff 和真实验收为准，不重复覆盖。

## 2. 兼容、安全、数据、成本与合规约束

所有 loop 必须遵守：

1. Desktop 本地 SQLite 继续作为本地项目的可信写入源；网络服务默认可选、最小上传。
2. 所有 schema 变更使用版本化迁移；老项目、老项目包和无新字段的历史记录必须可读。
3. 主稿导入、批量生成、资产采用、时间线保存、最终导出和反馈导入必须事务化或可恢复，
   取消/失败不得留下无法解释的半成品。
4. 用户正文、图片、音频、视频、评论、授权证明和生成参数不得默认进入日志、trace、截图 fixture
   或公共遥测。
5. API Key、refresh token、供应商密钥、声音克隆授权文件不得进入 SQLite 明文、命令参数或 commit。
6. 图片、视频、TTS 供应商只使用官方文档接口；真实提交必须有 Feature Flag、费用预检、取消/停止
   语义和沙箱/生产能力真值。
7. 预计费用必须明确标为估算；实际费用来自可审计账本。没有可靠报价时显示“未知”，不得伪造数字。
8. 任何自动生成整季、批量高清、声音克隆或高费用操作必须人工确认范围和预算。
9. 角色脸、声音、原著、样本、音乐、字体、图片和视频必须记录来源与授权；缺少授权时允许草稿，
   但不得通过最终交付 Gate。
10. AI 显式标识、文件元数据、内容编号和平台检查按版本化规则 Profile 执行；征求意见稿与正式规则
    必须区分状态、生效日期和来源。
11. 不提供删除、伪造、规避 AIGC 标识或绕过平台审核的能力。
12. 角色一致性评分、观众模拟、题材热度和合规检查都是辅助判断，UI 必须展示依据和不确定性。
13. 真实评论和运营数据导入只读取用户主动选择的文件；不保存平台账号 cookie，不私自爬取。
14. 媒体路径、字幕内容和 FFmpeg 参数必须使用结构化调用与路径校验，禁止拼接不可信 shell 命令。
15. 引入媒体运行时必须确认许可、签名、公证、目标架构体积与离线可用性；打包 smoke 是发布阻断。
16. UI 继续满足键盘、焦点、语义标签、非颜色状态表达、WCAG 2.2 AA 对比度和 reduced-motion。
17. 已采用内容、生成资产、版权记录和质量报告之间必须保留版本关系；修改源内容时下游显示过期，
    不静默把旧产物标为最新。

## 3. 目标用户体验与领域模型

### 3.1 三种创建路径

```text
从灵感开始                 导入已有小说/IP             直接制作 AI 漫剧
名称/一句话/题材机会         文件与权利声明               剧本/梗概/分集输入
        └──────────────┬──────────────┘
                       ↓
            创作目标 + 表现形式 + 平台 Profile
                       ↓
                 项目生产简报
```

项目创建时只要求完成本路径必要字段；长篇目标、季数、集数、单集时长、平台和表现形式均可
后续修改，不再硬编码“1章=2集、每集2分钟”。系统可以给出建议，但必须说明依据并允许覆盖。

### 3.2 信息架构

默认一级导航收敛为：

```text
内容       小说、分集、剧本、灵感
故事圣经   人物、世界、状态、时间线、伏笔、视觉规则
制作       资产、分镜、样片、视频、声音、剪辑
交付       质检、版权、合规、导出、反馈
```

- 当前任务、下一步、阻塞和预算留在项目概览。
- Agent 方案、Skills、AI 调用记录、模型原始参数等进入高级模式。
- 旧 section 深链必须兼容重定向；不能因导航收敛删除底层能力。

### 3.3 试播优先生产链

```text
市场机会/原作/剧本
  → 分集与剧本
  → 角色/场景/服装/道具资产
  → Storyboard 与已采用关键帧
  → Animatic（静帧 + 临时声音 + 时长）
  → 人工通过试播
  → 最终视频片段 + 正式配音/BGM/SFX/字幕
  → 时间线剪辑与 MP4
  → 媒体质检 + 版权/合规预检
  → 平台交付包
  → 数据/评论回流
```

### 3.4 生产真值

每个项目、季、集、场景和镜头至少区分：

- `planned`：已进入目标范围。
- `draft`：有草稿但未采用。
- `approved`：用户已采用且与当前源版本一致。
- `stale`：源内容、角色资产或规则变化后已过期。
- `blocked`：缺少上游、权限、授权、预算、Provider 或质检未通过。
- `delivered`：已进入通过合规 Gate 的具体交付版本。

完成率以“目标项中 approved/current/delivered 的覆盖比例”计算；不得用任意一条记录存在来替代。

### 3.5 市场机会模型

题材不再只有 `name`，至少包含：

- 快照版本、发布日期、来源链接、数据口径与置信说明。
- 题材、核心机制、情绪承诺、关系结构、目标受众。
- AI 漫剧/仿真人/2D/3D/沙雕漫/静态解说等表现形式适配。
- 平台/地区适配、热度、饱和度、创新空间。
- 视觉卖点、生产难度、预计成本等级、主要失败风险。
- 版权、未成年人、民俗/历史、声音/肖像等合规提醒。
- `hot`、`rising`、`stable`、`classic`、`saturated` 等带日期的市场层级。

## 4. 粒度策略与执行约定

### 4.1 粒度策略

- 以一个用户可见结果、独立数据边界、外部供应商或发布 Gate 为 loop，不按目录或前后端拆分。
- 同一能力的模型、迁移、repository、IPC、UI、测试、文档放在同一 loop 的内部 checklist。
- LM5-03、07、08 涉及主稿/生产谱系/版权持久化，必须保留独立事务和回滚边界。
- LM5-10、14 依赖外部图片/TTS供应商，可能被账号、沙箱或官方接口阻塞，不能与本地资产/音频
  基础能力合并。
- LM5-12 Animatic 和 LM5-15 最终剪辑均可独立交付、独立验收并安全保留，必须拆分。
- 测试和文档跟随能力收口；LM5-00 和 LM5-21 是独立阻断发布的 Gate，不创建“补测试 loop”。
- 若实际 diff 无法在一次约 30～60 分钟聚焦 review 中理解，开始实现前先更新本地图，按
  `LOOPRULE.md` 3.3.3 拆分；不得在一个分支中暗中推进多个 loop。

### 4.2 反碎片化复核结果

初稿已按以下原则合并：

- 市场数据模型、离线快照、题材 UI 和创建推荐合并为 LM5-01。
- 三种创建路径、目标/形式/Profile 和项目简报合并为 LM5-02。
- 小说/剧本解析、预览、事务写入和导入恢复合并为 LM5-03。
- 导航、基础/高级模式、旧深链和故事圣经容器合并为 LM5-04。
- 章节记忆、人物状态、事件、伏笔和过期语义共同服务自动故事圣经，合并为 LM5-05。
- 生产任务谱系、能力快照、预算估算和任务复现共享同一数据边界，合并为 LM5-07。
- 字幕轨、混音、时间线和 MP4 共同形成最终成片，合并为 LM5-15。

外部图片 Provider、外部 TTS Provider、Animatic、最终剪辑、合规 Gate 和反馈闭环各自存在
独立验收或阻塞条件，保持独立。

### 4.3 Git 与状态约定

- 所有规划 loop 初始状态为 `todo`。
- 每个 loop 开始时记录真实目标分支，本地图不假定永远是 `main`。
- 分支格式：`loop/lm5-<id>-<short-topic>`，例如 `loop/lm5-03-primary-import`。
- 严格执行：检查工作区 → fetch/ff-only → 创建 loop 分支 → 实现 → 验证 → 累计 diff 审查 →
  提交 → 再同步目标分支 → 合并 → 合并后验证 → 推送目标分支 → 清理 loop 分支。
- 同一时刻只允许一个 LM5 loop 为 `doing`；前一个 loop 未闭环，不得开始下一个。
- 外部沙箱未验证、目标分支未推送、loop 分支未清理或工作区有未解释残留时，最多为 `partial`。
- 每完成一个 loop，在第 12 节追加记录，不覆盖历史。

### 4.4 通用验证入口

执行者按风险选择；详细 Loop 中列出的命令是最低要求：

```bash
# 通用（仓库根目录）
git status --short --branch
git diff --check

# Desktop（仓库根目录下的 dramaip-desktop）
cd dramaip-desktop
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:db
pnpm test:ui
pnpm test:e2e
pnpm package:smoke

# 供应商沙箱（仅在获得授权并通过交互式安全配置后）
pnpm test:hailuo:sandbox
pnpm test:wan:sandbox
```

新增图片、TTS、媒体导出或平台 Profile 后，必须在对应 loop 内增加专用最小测试命令，并在
`package.json` 与用户/工程文档中同时收口；不得只在完成记录中写一个不存在的命令。

## 5. Gate、优先级与覆盖映射

### 5.1 Gate

| Gate | 目标 | 进入条件 | 通过条件 | 阻断后续 |
| --- | --- | --- | --- | --- |
| G0 基线 Gate | 固化三种旅程、生产真值和隐私基线 | 工作区归属已解决 | LM5-00 done | 全部 LM5 实现 |
| G1 创作入口 Gate | 市场、入口、导入、信息架构和故事圣经可用 | G0 | LM5-01～06 done | 新生产链发布 |
| G2 生产资产 Gate | 谱系、版权、角色/场景资产、真实生图和关键帧闭环 | G1 | LM5-07～11 done | 样片与批量生产 |
| G3 成片 Gate | Animatic、声音、真实 TTS、剪辑、MP4 和媒体质检闭环 | G2 | LM5-12～16 done | 对外交付 |
| G4 合规交付 Gate | AIGC/规则、平台包、反馈和本地化闭环 | G3 | LM5-17～20 done | 全量发布 |
| G5 Full Gate | 三种路径全链路可发布 | G0～G4 | LM5-21 done | 无 |

### 5.2 优先级说明

- `P0`：数据、版权、合规、核心入口或发布真值；即使执行顺序靠后也属于发布阻断。
- `P1`：做出完整样片和稳定生产所必需的核心能力。
- `P2`：交付效率、运营反馈、增长与海外扩展。
- 优先级不是并行授权；所有 loop 仍严格按建议顺序逐个闭环。

### 5.3 上一轮优化建议覆盖映射

| 优化内容 | 对应 Loop |
| --- | --- |
| 最新题材、少量经典、按形式/平台推荐、热度与饱和度 | LM5-01 |
| 写小说/导入IP/直接漫剧三入口，平台与表现形式 Brief | LM5-02 |
| TXT/MD/DOCX/EPUB 主稿和剧本导入 | LM5-03 |
| 四区导航、基础/高级模式、降低25入口认知负担 | LM5-04 |
| 自动章节记忆、人物状态、时间线、伏笔与确认 Diff | LM5-05 |
| 覆盖率真值、1～3集试播、阻塞与下一步 | LM5-06 |
| 模型/seed/参数/源版本/成本/采用关系可追溯 | LM5-07 |
| 版权、授权、肖像、声音、音乐和素材权利台账 | LM5-08 |
| 角色定妆、表情、服装、场景和道具资产包 | LM5-09 |
| 真实图片 Provider | LM5-10 |
| 分镜静帧、首尾帧、变体采用和视觉一致性 | LM5-11 |
| 低成本 Animatic，先审后做高清 | LM5-12 |
| 角色声音、临时/正式音频、BGM/SFX 音频轨 | LM5-13 |
| 真实 TTS Provider 与授权边界 | LM5-14 |
| 字幕、时间线、混音和完整 MP4 | LM5-15 |
| 黑帧、冻结、漂移、字幕、响度、缺镜头等媒体质检 | LM5-16 |
| AIGC 标识、规则版本、备案/平台清单与交付预检 | LM5-17 |
| 平台交付 Profile、标题/封面/简介 A/B | LM5-18 |
| 播放/完播/评论/章评导入与修稿回流 | LM5-19 |
| 海外翻译、字幕、配音与文化本地化 | LM5-20 |
| 全量回归、打包、发布和回滚证明 | LM5-21 |

## 6. Loop 总览

本节与第 7～10 节的详细定义共同构成 `LOOPRULE.md` 3.2 要求的 Loop 表。

| Loop | P | Owner | 状态 | 单一目标 | 主要范围 | 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| LM5-00 | P0 | QA/产品 | done | 建立三种创建路径、生产真值、隐私与成本的可重复基线 Gate | fixtures、UI baseline、E2E、审计文档 | 执行前阻塞解除 |
| LM5-01 | P0 | 产品数据/Desktop | done | 交付带来源日期的题材机会矩阵和离线市场快照 | core、db、Genres、CreateProject | LM5-00 |
| LM5-02 | P0 | Desktop/产品体验 | done | 交付三种创建路径及平台/形式驱动的项目简报 | CreateProject、CreateAdaptation、routes、core/db | LM5-01 |
| LM5-03 | P0 | Desktop/导入与数据 | done | 将现成小说或剧本事务化导入为主项目 | parser、IPC、db、import wizard、project package | LM5-02 |
| LM5-04 | P1 | Desktop/信息架构 | done | 用内容/故事圣经/制作/交付重构默认导航并兼容旧深链 | shell、Workspace、routes、nav constants | LM5-02、03 |
| LM5-05 | P0 | AI/长篇一致性 | done | 在用户确认后自动维护故事圣经并传播过期状态 | AI tasks、memory repos、chapter/version events、UI | LM5-03、04 |
| LM5-06 | P0 | Desktop/工作流 | done | 用覆盖率与试播编排表达真实进度和下一步 | workflow truth、task center、pilot plan、overview | LM5-04、05 |
| LM5-07 | P0 | Core/生产数据 | done | 建立跨图片、视频、音频的任务谱系、能力快照和成本账本 | core schema、db migration、providers、export | LM5-06 |
| LM5-08 | P0 | 合规/资产数据 | done | 建立第一等版权、授权和使用范围台账 | asset schema/repo/UI/package、preflight | LM5-07 |
| LM5-09 | P1 | Desktop/视觉资产 | done | 交付可版本化的角色、场景、服装和道具生产资产包 | visual profiles、asset library、versions、UI | LM5-07、08 |
| LM5-10 | P1 | AI/图片 Provider | partial | 接通至少一个官方真实图片供应商并保留可禁用真值 | image provider、IPC、settings、sandbox runbook | LM5-09 |
| LM5-11 | P1 | Desktop/Storyboard | done | 交付镜头静帧、首尾帧、变体采用和跨镜头一致性检查 | ShotWorkspace、image tasks、reviews、batch | LM5-09；LM5-10 可被导入资产替代开发 |
| LM5-12 | P1 | Media/导演工作流 | done | 用静帧、时长和临时声音生成可审查 Animatic | media runtime、timeline draft、preview/export | LM5-11 |
| LM5-13 | P1 | Media/音频产品 | done | 交付角色声音、对白/旁白、BGM/SFX 和音频轨管理 | audio core/db、asset UI、timeline、manual import | LM5-08、09、12 |
| LM5-14 | P1 | AI/TTS Provider | partial | 接通至少一个官方真实 TTS 供应商及授权/取消/归档闭环 | TTS adapter、settings、tasks、sandbox runbook | LM5-13 |
| LM5-15 | P1 | Media/成片 | done | 交付字幕、时间线剪辑、混音和完整 MP4 | editor、render queue、FFmpeg、export/package | LM5-12～LM5-14 |
| LM5-16 | P1 | QA/媒体质量 | done | 对完整单集执行可解释质检并只返工失败资产 | QC analyzers、review UI、workflow truth | LM5-15 |
| LM5-17 | P0 | 合规/交付 | done | 交付 AIGC 标识、版本化规则和最终合规预检 | rules、metadata/watermark、rights、export | LM5-08、15、16 |
| LM5-18 | P1 | 交付/平台 Profile | done | 交付平台化成片包和标题/封面/简介 A/B 方案 | delivery profiles、export、creative variants | LM5-17 |
| LM5-19 | P2 | 数据/创作反馈 | done | 导入真实运营与读者反馈并生成可采用修稿任务 | feedback import、analytics、comments、revision | LM5-06、18 |
| LM5-20 | P2 | 本地化/交付 | done | 交付语言版本、字幕/配音和文化适配变体 | localization model、AI tasks、audio/subtitle/export | LM5-14、18 |
| LM5-21 | P0 | QA/Release | partial | 以本地证据完成发布 Gate；外部真实 Provider 与签名安装证据待授权 | 全 Desktop、沙箱、E2E、package、文档 | LM5-00～LM5-20 |

## 7. G0～G1：基线、市场、入口与创作体验

### LM5-00 — 三种用户旅程与生产真值基线

- **Owner**：QA / 产品。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：第 1.4 节执行前阻塞全部解除。
- **目标**：建立可重复的基线 Gate，使后续 loop 能证明用户旅程更短、完成真值更可信且没有
  隐私、数据或费用回退。
- **主要范围**：`scripts/ui-baseline.mjs`、Electron E2E fixtures、核心用户旅程 fixture、
  `docs/product` 验收说明；必要的只读诊断 helper。
- **内部 checklist**：
  1. 固化“灵感创建、导入小说、直接剧本”三条旅程的目标状态与现状缺口；后两条在基线中
     应明确记录为未实现，而非伪造通过。
  2. 建立一个小型小说项目和一个 3 集漫剧项目 fixture，覆盖人物、章节、改编、剧本、镜头、
     视频任务、资产和历史项目包。
  3. 为覆盖率、过期、阻塞、预算未知、版权缺失和 Provider 不可用建立可断言的 UI/领域 fixture。
  4. 记录日志、截图、项目包和诊断包不得出现的正文/凭据/媒体内容检查。
  5. 记录三种旅程的人工 smoke 步骤、截图对象和通过标准。
- **不在范围**：实现新入口、新导入、新生产功能；重写现有 UI。
- **验收**：后续执行者可以从一个命令和一份人工脚本重复得到相同 fixture；基线明确显示现有
  能力和缺口；隐私检查能发现故意注入的测试密钥/正文泄漏。
- **验证**：`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`；人工打开
  fixture 项目核对项目概览、章节、剧本、Storyboard、视频和导出入口。
- **风险与回滚边界**：fixture 不得连接真实 Provider 或写用户数据库；失败时整体撤销测试/文档
  基线，不影响业务 schema。

### LM5-01 — 版本化题材机会矩阵

- **Owner**：产品数据 / Desktop。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-00。
- **目标**：让用户按题材、机制、受众、表现形式、平台、饱和度和制作难度选择方向，并能看到
  数据日期与来源，而不是把静态标签当成实时市场结论。
- **主要范围**：`packages/core/src/constants/genre-presets.ts`、类型/schema、DB repository/migration、
  `GenrePresetPage`、`CreateProjectPage`、项目包和测试。
- **内部 checklist**：
  1. 建立第 3.5 节市场快照和机会项 schema，区分官方报告、研究报告、用户自建与未知来源。
  2. 把热门题材与少量经典题材迁移为带日期的默认快照，保留同名用户自定义项。
  3. 支持按 AI 漫剧/仿真人、男女频、平台、成本等级和饱和度筛选与排序。
  4. 用“为什么推荐、主要风险、差异化建议”替代单一热度排序；经典项不伪装为当前爆款。
  5. 支持离线使用、手动导入经校验的新快照和回退上一版本；不抓取私有榜单。
  6. 将快照版本和选中机会写入项目简报与项目包，而非只保存最终名称。
- **不在范围**：实时爬榜、自动发布研究报告、购买付费数据、替用户承诺爆款。
- **验收**：新用户能区分“热门、上升、稳定、经典、饱和”；每项显示日期、来源、适合形式、
  制作难度和风险；升级不删除用户自定义类型；离线仍可选择最近快照。
- **验证**：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`；人工核对热门/经典、
  空来源、过期快照、筛选和离线状态。
- **风险与回滚边界**：DB 迁移只增加字段/表并提供兼容默认；回滚应用后旧 `GenrePreset` 仍可读，
  不删除用户自定义数据。

### LM5-02 — 三种创建路径与项目生产简报

- **Owner**：Desktop / 产品体验。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-01。
- **目标**：用户可以从灵感、现成小说/IP或现成漫剧剧本开始，并在创建时只回答与其目标有关的
  问题。
- **主要范围**：`CreateProjectPage`、`CreateAdaptationPage`、Project/Adaptation 类型与 migration、
  routes、项目首页、AI context、项目包。
- **内部 checklist**：
  1. 建立 `novel_to_drama`、`adapt_existing_ip`、`direct_drama` 创建目标及兼容默认。
  2. 建立表现形式、目标平台/地区、画幅、单集时长范围、试播集数和预算档位 Profile。
  3. 创建页按目标渐进显示字段，作品名、题材机会和平台建议互相联动但允许覆盖。
  4. 删除硬编码“1章=2集、每集2分钟”的强制语义，保留可解释的可编辑建议。
  5. 创建后生成统一项目生产简报和下一步；缺少导入文件时引导到 LM5-03 路径。
  6. 旧项目自动得到兼容 Profile，不改变其现有章、集、季与时长数据。
- **不在范围**：文件正文解析、真实生成、直接平台发布。
- **验收**：三条入口均能建立项目；直接漫剧不要求先创建小说章节；导入路径不会先创建大量空章节；
  用户可选择 2D/3D/仿真人等形式并修改集数/时长建议；旧项目可正常打开。
- **验证**：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、`pnpm test:e2e`；
  人工分别走完三条创建入口并返回/重进检查持久化。
- **风险与回滚边界**：新字段向后兼容；失败时回滚创建 UI 和新增字段读取，保留已创建项目数据，
  不级联删除用户内容。

### LM5-03 — 小说主稿与漫剧剧本导入

- **Owner**：Desktop / 导入与数据。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-02。
- **目标**：把用户拥有权利的 TXT、Markdown、DOCX、EPUB 小说或结构化剧本安全导入主项目，
  并在写入前可预览、纠错和取消。
- **主要范围**：Electron 文件选择与安全、parser、IPC、Project/Chapter/Script/Scene repositories、
  import wizard、长任务、项目包与测试 fixtures。
- **内部 checklist**：
  1. 解析常见编码、标题、卷/章边界、空章、超长章、脚注和 EPUB spine，保留原始顺序。
  2. 支持剧本 Markdown/JSON 的集、场景、对白、动作结构预览；未知格式只作为草稿文本，不猜写结构。
  3. 导入向导展示文件摘要、识别结果、重复章节、将创建/覆盖数量和权利声明。
  4. 默认新建内容，不覆盖现有主稿；显式合并/覆盖必须创建检查点并二次确认。
  5. 写入使用事务或可恢复长任务；取消、解析失败和中途崩溃不留下部分章节/场景。
  6. 导入后可生成但不自动采用人物/大纲/故事圣经建议；第三方样本路径继续保持抽象结构边界。
- **不在范围**：PDF OCR、DRM 绕过、抓取付费小说、自动证明版权、未经确认覆盖现有正文。
- **验收**：四种小说文件和至少一种剧本交换格式能预览并正确导入；用户修正章节边界后结果一致；
  取消/失败无半写入；重复导入有明确策略；导入内容能进入现有写作/改编路径。
- **验证**：parser 单元测试、恶意/超大/乱码 fixture、`pnpm typecheck`、`pnpm test:unit`、
  `pnpm test:db`、`pnpm test:e2e`；人工导入每种格式并核对前后章节与剧本结构。
- **风险与回滚边界**：高风险数据写入 loop；迁移与写入必须事务化。回滚删除本次 import batch 创建的
  实体，不碰导入前内容；原始文件只读，不原地修改。

### LM5-04 — 四区任务导向信息架构

- **Owner**：Desktop / 信息架构。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-02、LM5-03。
- **目标**：普通用户只面对“内容、故事圣经、制作、交付”四个一级区域，同时保留高级能力和旧链接。
- **主要范围**：App shell、Workspace、production shell、routes、nav constants、section containers、
  URL state、UI baseline。
- **内部 checklist**：
  1. 将现有约 25 个入口映射为四区二级页，建立基础/高级模式和可搜索全局命令。
  2. 合并记忆、人物状态、视觉档案、视觉设定、时间线、伏笔、一致性为故事圣经容器。
  3. 合并诊断、评分、节拍、爽点和质量问题为行动中心，不丢失独立数据与深链。
  4. 项目概览只显示当前结果、阻塞、预算和一个主要下一步；高级记录不抢占主路径。
  5. 为旧 `?section=`、改编/剧本/分镜/视频 URL 提供确定重定向并保留前进/后退。
  6. 更新键盘导航、小窗口、焦点恢复、reduced-motion 和截图 baseline。
- **不在范围**：删除任何底层功能、重写业务 repository、改变 AI 写入权限。
- **验收**：默认一级区域不超过四个；新用户可从项目概览进入下一步而无需理解 Agent/Memory 术语；
  高级用户仍能到达全部旧能力；已保存旧链接不会 404 或打开错误项目。
- **验证**：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`；人工验证 1024、
  1320、1440px，键盘、前进/后退、基础/高级和旧深链。
- **风险与回滚边界**：只改变导航与容器，不迁移/删除业务数据；失败时整体恢复旧导航，保留新路由映射
  直到下个兼容窗口。

### LM5-05 — 自动故事圣经与过期传播

- **Owner**：AI / 长篇一致性。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-03、LM5-04。
- **目标**：章节保存、AI采用或主稿导入后，系统生成一份可审查的故事圣经变更包，用户一次确认即可
  更新记忆、人物状态、事件、伏笔和视觉连续性。
- **主要范围**：chapter/version/import events、AI task/graph、memory/state/event/foreshadowing repositories、
  Story Bible UI、quality truth、任务中心。
- **内部 checklist**：
  1. 定义包含摘要、人物变化、关系、秘密、时间线、伏笔、视觉状态的结构化变更包。
  2. 内容稳定保存后才排队，不在每次键入时调用模型；显示预计 token/费用并允许关闭自动建议。
  3. 以 Diff 展示新增、修改、解决和冲突；默认不静默采用，不覆盖用户手写故事圣经。
  4. 一次采用事务化更新全部实体并记录源内容版本、任务与撤销点。
  5. 源章节再次变化时标记对应故事圣经和下游诊断为过期，并提供按章/按范围回填。
  6. 处理导入长篇的批量暂停、恢复、跳过和失败明细。
- **不在范围**：键入级实时抽取、无确认写入、自动改写用户正文。
- **验收**：完成一章后用户不需进入多个页面重复操作；一次采用可更新所有相关记录并可撤销；
  章节修改后旧记忆不会继续显示为最新；批量失败不影响成功项且可恢复。
- **验证**：AI parser/transaction 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、
  `pnpm test:e2e`；人工检查关闭自动建议、费用未知、冲突、撤销和批量恢复。
- **风险与回滚边界**：高影响 AI 写入必须有内容版本和事务；回滚撤销变更包产生的实体版本，不删除原章节。

### LM5-06 — 覆盖率真值与试播编排

- **Owner**：Desktop / 工作流。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-04、LM5-05。
- **目标**：用目标覆盖率、过期、失败、版权、预算和质检状态显示真实进度，并把默认生产范围限制为
  用户选定的 1～3 集试播。
- **主要范围**：workflow guide/truth、Project overview、adaptation readiness、task center、pilot plan、
  quality dashboard、E2E fixtures。
- **内部 checklist**：
  1. 用目标章/集/场景/镜头覆盖率替代“存在任意记录即完成”的逻辑。
  2. 建立试播范围、阶段依赖、人工暂停点和通过/退回决策；默认不展开整季批量任务。
  3. 显示最新源版本、approved/stale/blocked、预计/实际成本和下一项可执行动作。
  4. 任务中心按试播计划聚合剧本、分镜、资产、视频、音频、剪辑、质检和交付；尚未实现的阶段
     显示“能力未安装/未完成”，不伪造成功。
  5. 试播通过后才能复制 Profile 到更多集；复制只创建计划，不自动产生高费用外部任务。
  6. 修正项目、季、集、镜头完成与交付状态的 E2E 真值断言。
- **不在范围**：本 loop 不实现图片、TTS、剪辑或最终视频；不自动提交整季。
- **验收**：20 集目标只有 3 集剧本时显示 3/20；一个最佳镜头视频不能让整季完成；用户可选择 1～3 集，
  查看全部阻塞并逐阶段继续；未通过试播时没有整季外部任务。
- **验证**：workflow truth 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`；
  人工验证空项目、部分项目、过期项目、失败任务和已交付项目。
- **风险与回滚边界**：状态计算变化不删除产物；回滚只恢复旧展示逻辑。新状态字段保持兼容，禁止将
  显示回滚写回业务记录。

## 8. G2：生产谱系、版权与视觉资产

### LM5-07 — 生产谱系、能力快照与成本账本

- **Owner**：Core / 生产数据。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-06。
- **目标**：每次图片、视频、音频和渲染任务都能追溯并复现其源内容、Provider 能力、模型参数、参考资产、
  估算/实际费用和用户采用关系。
- **主要范围**：core types/schemas、DB migration/repositories、Provider interfaces、task runtime、assets、
  project package、usage UI、export。
- **内部 checklist**：
  1. 定义通用 generation lineage：媒体类型、源实体/版本、Provider/config/model/version、完整参数快照、
     seed、参考资产及权重、父任务、重试/克隆和采用结果。
  2. 保存提交时的 Provider capability snapshot；后续设置变化不改写历史真值。
  3. 建立按项目/季/集/镜头的预计与实际成本账本，未知报价保持未知并记录计算依据。
  4. 提供“按原参数重试”“复制并修改参数”“仅重做失败项”，不覆盖旧结果。
  5. 将 lineage 和成本纳入项目包、诊断脱敏和交付清单；密钥、私有响应和完整媒体不进入日志。
  6. 为现有视频任务回填兼容 lineage，无法确定的字段标为 unknown 而非猜测。
- **不在范围**：统一供应商计费、保证完全确定性、把估算当账单、实现新媒体 Provider。
- **验收**：任一采用资产可回溯到源版本和任务；配置修改后历史任务不变；重试创建新任务；项目能显示
  试播估算、实际值和未知项；旧视频任务仍可查看。
- **验证**：schema/parser/repository 单测、迁移回放、项目包往返、`pnpm typecheck`、`pnpm test:unit`、
  `pnpm test:db`、相关 E2E。
- **风险与回滚边界**：高风险共享数据迁移；只增表/字段和兼容回填。回滚应用版本时老任务仍可读，
  不删除 lineage 或费用记录；不得修改历史任务原始字段。

### LM5-08 — 版权与授权资产台账

- **Owner**：合规 / 资产数据。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-07。
- **目标**：为原著、人物参考、声音、音乐、字体、图片、视频和生成结果建立第一等权利记录，并在交付前
  识别缺失、过期或用途不匹配。
- **主要范围**：ProjectAsset schema/repository/migration、asset library/inspector、文件证据、项目包、
  preflight、UI。
- **内部 checklist**：
  1. 定义权利人、来源、权利类型、授权范围、商用/改编/生成权限、平台、地区、期限、证明文件 hash、
     AI 生成声明和审核状态。
  2. 原著导入、人工参考、声音样本、音乐和 Provider 结果进入台账；`unknown` 必须显式可见。
  3. 授权证明以受控本地资产保存，项目包默认只含清单；二进制包含需用户显式选择。
  4. 克隆脸/声音前要求对应授权类型；不允许用文字勾选绕过缺失的证明状态。
  5. 交付预检按目标平台/地区/日期判断范围和期限；草稿阶段允许继续但显示阻塞。
  6. 支持导出权利清单和重新定位丢失证据，不把真实证据内容写入日志/截图。
- **不在范围**：自动判定法律效力、公共版权数据库检索、替用户取得授权。
- **验收**：每个最终采用媒体都有明确 `verified/declared/unknown/expired/restricted` 状态；缺失版权不会
  阻止写草稿但阻止最终交付；项目包往返保持清单和安全策略；过期授权能准确定位受影响成片。
- **验证**：migration/repository/project-package 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、
  UI baseline；人工验证未知、过期、地区不匹配、证据丢失和重新定位。
- **风险与回滚边界**：高风险合规数据；迁移只增不删。回滚不得把 unknown 自动提升为已授权，
  不删除用户证据文件；最终 Gate 始终 fail closed。

### LM5-09 — 版本化角色与场景生产资产包

- **Owner**：Desktop / 视觉资产。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-07、LM5-08。
- **目标**：把文字视觉档案升级为可版本化、可采用、可复用的角色和场景生产资产包，即使没有真实图片
  Provider，也能用用户导入的授权素材完成资产锁定。
- **主要范围**：visual profile/setting、asset library、version/adoption、Character/Scene UI、project package。
- **内部 checklist**：
  1. 角色包包含脸部锚点、三视图/全身、表情、姿态、服装阶段、道具、色板、负面约束和声音引用。
  2. 场景包包含空间布局、日夜/天气、镜头方向、光色、标志物、可变/不可变元素和道具位置。
  3. 支持导入、裁切/标注、候选版本、采用、替换、过期和回退；原文件不被破坏性编辑。
  4. 镜头引用锁定具体资产版本；上游采用变化时只标记受影响镜头 stale。
  5. 提供资产完整度、缺失项和生产难度摘要；群像、儿童、动物、历史道具等高风险明确提示。
  6. 项目包和交付清单保持版本、权利与引用关系。
- **不在范围**：真实生图调用、LoRA 训练、自动修图、无授权真人定妆。
- **验收**：用户仅用本地授权图片也能建立角色/场景包并锁定到镜头；替换服装不会误改旧集；
  每个镜头能显示具体版本和过期原因；项目包往返不丢引用。
- **验证**：asset/version 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、
  项目包往返与人工资产替换 smoke。
- **风险与回滚边界**：不原地覆盖媒体；回滚只撤销新 UI/关联，保留已导入资产和版本记录。

### LM5-10 — 真实图片 Provider 闭环

- **Owner**：AI / 图片 Provider。
- **状态**：`partial`。
- **优先级**：P1。
- **依赖**：LM5-09；需要官方 API、沙箱/生产账号和授权测试素材。
- **目标**：接通至少一个适合角色/场景/关键帧的官方图片生成供应商，形成提交、轮询/同步、取消、归档、
  成本和错误恢复闭环。
- **主要范围**：image provider interface/adapter、Electron IPC、settings、task center、asset archive、
  sandbox script/runbook、Feature Flag。
- **内部 checklist**：
  1. 建立 renderer-safe 能力矩阵：文生图、图生图、参考图数量、seed、尺寸、同步/异步、取消和内容限制。
  2. 选择一个有稳定官方 API 的供应商；凭据进入 Keychain，设置页只显示掩码和真实可用状态。
  3. 任务使用 LM5-07 lineage、LM5-08 rights 和本地归档；远端 URL 失效后仍可使用已归档结果。
  4. 支持失败重试、用户取消、本地停止跟踪与远端取消差异，禁止把未支持能力显示为可用。
  5. 提供 Mock 合同测试和授权环境的沙箱 smoke；记录模型、地域、限流、费用与数据保留边界。
  6. Provider 不可用时仍允许导入素材完成 LM5-09/11，不阻塞离线项目浏览。
- **不在范围**：一次接通所有图片平台、绕过内容审核、自动训练模型。
- **验收**：授权沙箱能生成并归档至少一张角色图、一张场景图和一个参考图变体；任务可追溯且费用状态
  可信；关闭 Feature Flag 后不能提交；无凭据时 UI 不误报可用。
- **验证**：adapter 合同单测、`pnpm typecheck`、`pnpm test:unit`、专用图片沙箱 smoke、`pnpm test:e2e`；
  未取得外部证据时只能 `partial`。
- **风险与回滚边界**：外部费用和隐私独立边界；回滚关闭 Feature Flag 并保留本地资产/任务历史，
  不删除远端任务证据，不把密钥写入日志。

### LM5-11 — 分镜静帧、变体采用与视觉一致性

- **Owner**：Desktop / Storyboard。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-09；LM5-10 可由人工导入资产替代开发与本地验收，但 G2 完成仍要求 LM5-10 done。
- **目标**：用户可以为选定试播镜头批量生成或导入静帧/首尾帧，对比候选、采用最佳版本，并识别跨镜头
  的角色、服装、场景和道具漂移。
- **主要范围**：ShotWorkspace、image tasks、asset inspector、batch runtime、ShotReview、continuity service、
  UI baseline/E2E。
- **内部 checklist**：
  1. 从镜头、角色包、场景包和视觉 Profile 构造可预览的图片任务，提交前显示引用和成本。
  2. 支持静帧、首帧、尾帧和封面候选，多结果同步比较、备注、采用与回退。
  3. 批量只覆盖无采用结果或显式选中项；失败项可重试，不覆盖已采用资产。
  4. 对人脸/轮廓、服装色、标志道具、场景布局、画幅和文字乱码执行可解释一致性检查。
  5. 人工可以接受风险并记录理由；采用后向 Animatic/视频任务暴露稳定版本。
  6. 源剧本、镜头或资产包变化时准确标记 stale，并给出最小重做范围。
- **不在范围**：最终视频质量、嘴型、音频、法律结论。
- **验收**：试播镜头能达到“目标镜头数/已采用静帧数”覆盖真值；已采用版本不会被批量覆盖；
  一致性问题可定位到具体镜头和资产版本；只重做失败/过期镜头。
- **验证**：continuity/batch 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`；
  人工验证多结果、批量失败、采用/回退和源变化过期。
- **风险与回滚边界**：生成结果不可变；回滚只撤销采用关系或 UI，不删除本地图片和历史 review。

## 9. G3：Animatic、声音、成片与媒体质检

### LM5-12 — 低成本 Animatic

- **Owner**：Media / 导演工作流。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-11。
- **目标**：在提交高费用视频前，用已采用静帧、镜头时长、对白/旁白和临时声音形成可播放、可批注、
  可退回的试播 Animatic。
- **主要范围**：media runtime 选型、timeline draft model、Shot/Script integration、preview player、render task、
  local archive、package smoke。
- **内部 checklist**：
  1. 建立镜头顺序、持续时间、静帧、推拉/转场占位、对白/旁白和临时音频的草稿时间线。
  2. 从剧本/镜头时长自动初始化，但允许拖拽、裁切和人工覆盖；变更保留版本。
  3. 生成低成本本地预览，不调用高费用视频 Provider；缺音频时可使用静音或明确的临时轨。
  4. 支持按时间点批注节奏、信息量、钩子和镜头问题，并退回到具体镜头。
  5. 试播通过产生审批记录和锁定版本；未通过不能自动扩展整季高清任务。
  6. 媒体运行时使用结构化参数、校验路径，并纳入打包许可与目标架构检查。
- **不在范围**：最终调色、正式混音、高清成片、真实 TTS。
- **验收**：用户可播放一集完整 Animatic，修改镜头时长后重新渲染且旧版本可回看；批注能定位镜头；
  未通过时不会产生整季高费用任务。
- **验证**：timeline/render 单测、固定媒体 fixture hash/时长检查、`pnpm typecheck`、`pnpm test:unit`、
  `pnpm test:e2e`、`pnpm package:smoke`；人工检查播放、拖拽、批注、通过/退回。
- **风险与回滚边界**：媒体运行时与打包为独立风险；回滚保留 timeline JSON、静帧和批注，删除可重建的
  临时预览缓存，不删除源资产。

### LM5-13 — 角色声音与音频轨生产

- **Owner**：Media / 音频产品。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-08、LM5-09、LM5-12。
- **目标**：建立角色声音、对白、旁白、BGM、环境音和音效的可版本化音频资产及时间线工作流，
  即使没有真实 TTS 也能用人工导入音频完成成片。
- **主要范围**：audio core/db、voice profile、asset library、Script/Shot/Timeline UI、audio task interface、
  manual import、project package。
- **内部 checklist**：
  1. 声音 Profile 包含授权状态、音色、语速、情绪、语言、读音词典、样本和禁用范围。
  2. 从结构化剧本生成对白/旁白片段清单并关联角色、台词版本、镜头和时间位置。
  3. 支持人工录音/音频导入、临时音轨、候选采用、裁切、音量、淡入淡出和替换。
  4. BGM/SFX 记录来源、版权、循环/裁切和 ducking 意图，不默认附带无授权素材库。
  5. 台词变化后只标记受影响音频 stale；重新生成/导入不覆盖旧版本。
  6. 为 TTS Provider 定义能力、任务、归档、成本和取消接口，但不伪造真实可用。
- **不在范围**：真实外部 TTS、未经授权声音克隆、专业 DAW 全功能。
- **验收**：用户可为一集完成角色声音绑定、人工对白/旁白、BGM/SFX 和采用；台词变化正确标记过期；
  音频权利和源版本可追溯；项目包往返保持关系。
- **验证**：audio schema/timeline 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:ui`、
  E2E 人工音频导入 smoke。
- **风险与回滚边界**：不破坏源音频；回滚保留音频文件、版本和授权记录，只撤销新轨道引用/UI。

### LM5-14 — 真实 TTS Provider 闭环

- **Owner**：AI / TTS Provider。
- **状态**：`partial`。
- **优先级**：P1。
- **依赖**：LM5-13；需要官方 API、沙箱/生产账号和经授权声音。
- **目标**：接通至少一个官方 TTS 供应商，支持角色声音、情绪/语速、读音词典、任务归档、费用和失败恢复，
  严格隔离普通合成音色与声音克隆权限。
- **主要范围**：TTS adapter、settings/Keychain、audio tasks、task center、archive、sandbox script/runbook、
  Feature Flag。
- **内部 checklist**：
  1. 建立能力矩阵：语言、音色、情绪、SSML/读音、同步/异步、克隆、取消、输出格式与限制。
  2. 选择一个稳定官方 API；普通音色默认可用，声音克隆单独 Feature Flag 和授权 Gate。
  3. 将每段音频绑定台词版本、角色 Profile、模型参数、成本、授权与本地归档。
  4. 支持批量前预估、暂停/恢复、失败项重试和限流退避；不覆盖已采用人工音频。
  5. 沙箱只使用授权测试声音和非敏感台词；日志不记录密钥、完整声音样本或用户正文。
  6. 无凭据/供应商故障时回退到人工导入/临时轨，不把草稿标为正式配音。
- **不在范围**：任意真人声音复刻、绕过供应商实名/授权、自动发布音频。
- **验收**：授权沙箱能生成、归档、采用至少两个角色和一段旁白；读音词典生效；克隆入口在无授权时
  fail closed；批量失败可恢复；成本和能力显示真实。
- **验证**：adapter 合同单测、`pnpm typecheck`、`pnpm test:unit`、专用 TTS 沙箱 smoke、相关 E2E；
  未取得外部证据时只能 `partial`。
- **风险与回滚边界**：外部费用、生物特征和授权独立边界；回滚关闭 Provider/克隆 Flag，保留已归档音频、
  任务、成本和授权证据。

### LM5-15 — 字幕、剪辑时间线、混音与完整 MP4

- **Owner**：Media / 成片。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-12、LM5-13、LM5-14。
- **目标**：将已采用视频/静帧、正式音频、字幕和转场装配为可预览、可版本化、可导出的完整单集视频。
- **主要范围**：timeline editor/model、subtitle tracks、audio mix、render queue/runtime、VideoResult、export、
  package smoke、UI/E2E。
- **内部 checklist**：
  1. 建立视频、静帧、对白/旁白、BGM/SFX、字幕和转场轨，支持拖拽、裁切、锁定、静音与版本。
  2. 从台词/音频时间生成字幕草稿，支持 SRT/VTT、逐句校时、换行、竖屏安全区和样式 Profile。
  3. 支持镜头视频与 Animatic 占位混排，清楚标识未完成镜头，最终交付禁止静默包含占位。
  4. 完成基础响度、ducking、淡入淡出、画幅/分辨率/帧率和封面设置。
  5. 渲染队列可取消、恢复、失败重试并归档 MP4、字幕、音轨和 manifest；源资产不被改写。
  6. 时间线/成片绑定具体源版本、资产、规则和 render lineage；修改后旧成片 stale。
- **不在范围**：专业级调色/合成/特效软件替代、直接平台上传。
- **验收**：一集可在应用内预览并导出可播放 MP4；字幕安全区正确；音轨可听且无占位；取消/失败可恢复；
  旧成片可回看并显示过期；manifest 可追溯全部输入。
- **验证**：timeline/subtitle/render 单测、媒体 fixture 时长/分辨率/音轨/字幕断言、`pnpm typecheck`、
  `pnpm test:unit`、`pnpm test:e2e`、`pnpm package:smoke`；人工完整播放至少一集。
- **风险与回滚边界**：高风险媒体处理与打包；回滚保留 timeline、manifest 和已导出成片，清理仅限可重建缓存。

### LM5-16 — 自动媒体质检与最小返工

- **Owner**：QA / 媒体质量。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-15。
- **目标**：对完整单集和其镜头执行可解释的技术/连续性质检，把问题定位到最小重做范围，并保留人工判断。
- **主要范围**：media analyzers、ShotReview/episode QC、quality dashboard、workflow truth、regeneration tasks、
  report export。
- **内部 checklist**：
  1. 检查缺镜头、占位、黑帧/冻结、损坏文件、时长偏差、画幅/分辨率、字幕溢出/重叠和安全区。
  2. 检查静音、削波、响度、对白与字幕时序；嘴型只在可靠能力下给出置信建议，不冒充确定结论。
  3. 汇总 LM5-11 的角色/服装/场景/道具连续性并定位具体时间点、镜头和资产版本。
  4. 区分 blocker、warning、accepted risk；人工接受需理由、Owner、时间和适用交付版本。
  5. 一键创建“仅重做失败镜头/音频/字幕”的任务，不重跑已通过资产。
  6. 复检绑定输入 hash；成片变化后旧报告 stale，不能继续通过交付 Gate。
- **不在范围**：自动判定艺术好坏、保证平台审核通过、未经确认自动替换最终成片。
- **验收**：故意注入的黑帧、缺镜头、字幕越界、削波和过期报告均被发现；问题可定位且只重做失败项；
  人工风险接受有审计；重新渲染后必须复检。
- **验证**：媒体 fixture/analyzer 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:ui`、`pnpm test:e2e`；
  人工核对报告与实际时间点。
- **风险与回滚边界**：质检默认只读，不删除媒体；回滚报告与任务接线，不修改源资产或历史风险接受记录。

## 10. G4～G5：合规、交付、反馈、本地化与发布

### LM5-17 — AIGC 标识与版本化合规预检

- **Owner**：合规 / 交付。
- **状态**：`done`。
- **优先级**：P0。
- **依赖**：LM5-08、LM5-15、LM5-16。
- **目标**：根据目标地区、平台和交付日期执行版本化规则，生成不可静默遗漏的 AIGC 显式/隐式标识、
  权利清单和交付前检查结果。
- **主要范围**：compliance rule profiles、rights/QC integration、video watermark/intro slate、file metadata、
  export manifest、UI、规则更新文档。
- **内部 checklist**：
  1. 规则 Profile 保存来源、状态（正式/征求意见/平台建议）、发布日期、生效日期、适用范围和版本。
  2. 对文字、图片、音频、视频和最终文件记录 AI 属性、Provider/内容标识、用户声明和权利状态。
  3. 按适用规则生成片头/画面周边显式标识与文件隐式元数据，并验证转码后是否保留。
  4. 检查剧名、字幕语言、未成年人、历史/民俗、版权、许可证/备案字段等，但清楚区分自动检查与人工确认。
  5. 导出前显示 blocker/warning/规则来源；禁止提供删除标识或绕审选项。
  6. 支持离线规则包、签名/校验、上一版本回退和规则更新审计；未知规则 fail safe。
- **不在范围**：法律意见、代办许可证/备案、保证审核通过、自动抓取平台后台规则。
- **验收**：使用正式 Profile 导出的 MP4/manifest 包含要求的显式和隐式标识；征求意见稿不会被当作强制
  blocker；缺权利/新鲜质检/必要字段时不能最终交付；规则来源可点击查看。
- **验证**：rule engine、metadata/watermark、transcode persistence 单测，`pnpm typecheck`、`pnpm test:unit`、
  `pnpm test:e2e`、`pnpm package:smoke`；人工用媒体检查工具核对成片与 metadata。
- **风险与回滚边界**：发布阻断且 fail closed；回滚不得删除已写标识或放宽历史规则，只能禁用有缺陷的新
  Profile 并恢复上一已验证版本。

### LM5-18 — 平台交付 Profile 与 A/B 创意包

- **Owner**：交付 / 平台 Profile。
- **状态**：`done`。
- **优先级**：P1。
- **依赖**：LM5-17。
- **目标**：按目标平台/地区 Profile 导出成片、字幕、封面、标题、简介、标签、版权/合规 manifest，
  并管理 A/B 创意候选和采用记录。
- **主要范围**：delivery profiles、export packages、cover/title/description variants、Project/Adaptation UI、
  manifests、docs/tests。
- **内部 checklist**：
  1. Profile 定义画幅、分辨率、编码、时长、字幕、安全区、命名、封面、简介和所需业务字段。
  2. 创建红果/抖音等公开规则可验证的初始 Profile；无法确认的字段标为人工填写，不猜测。
  3. 标题、封面、简介、标签可生成多候选、人工编辑、采用和版本化，并保留来源/版权。
  4. 一次导出目录包含成片、字幕、封面、文本、rights manifest、AIGC/QC/compliance report 和 checksum。
  5. 导出预览显示缺失和最终文件名；重复导出不静默覆盖，生成独立 delivery version。
  6. 提供复制文本、打开目录和继续外部精剪入口；没有官方 API 时不显示“一键发布”。
- **不在范围**：自动登录平台、代投、投流、抓取私有规则或数据。
- **验收**：至少两个 Profile 能从同一成片生成不同且可验证的交付包；A/B 候选有采用和版本；缺字段
  被阻断；重复导出可回看；包内 checksum 与 manifest 一致。
- **验证**：export/profile 单测、golden package fixture、`pnpm typecheck`、`pnpm test:unit`、
  `pnpm test:e2e`、`pnpm package:smoke`；人工核对两个平台包。
- **风险与回滚边界**：Profile 独立版本化；回滚禁用错误 Profile，不删除已导出包或采用记录。

### LM5-19 — 真实运营与读者反馈回流

- **Owner**：数据 / 创作反馈。
- **状态**：`done`。
- **优先级**：P2。
- **依赖**：LM5-06、LM5-18。
- **目标**：让用户主动导入播放、完播、停留、互动、评论、章评和 A/B 结果，并把反馈定位到叙事对象，
  生成可预览、可撤销的修订任务。
- **主要范围**：feedback schemas/repos、CSV/JSON import wizard、analytics dashboard、comment clustering、
  revision tasks、project package。
- **内部 checklist**：
  1. 建立来源、时间窗、平台、版本、集/章节/镜头映射和指标口径；不同平台指标不强行混为同一值。
  2. 支持公开导出格式的 CSV/JSON 映射模板、预览、去重和事务导入；不保存 cookie/账号凭据。
  3. 评论/章评保留原文、本地隐私级别、来源和定位；AI 聚类结果与原文分开并可删除。
  4. 将流失点、正向反馈、角色争议、节奏/钩子问题关联到集、场景、镜头或节拍。
  5. 从真实反馈创建 revision task，沿用 Diff、版本、人工采用和复检，不直接修改正文/成片。
  6. 对 A/B 封面/标题/简介记录投放版本和结果；不把相关性展示成因果结论。
- **不在范围**：平台爬虫、自动投流、实时数据仓库、用户画像交易、用模拟观众替代真实指标。
- **验收**：用户可导入至少两种指标文件和评论文件，预览/去重正确；反馈能定位内容并创建修订任务；
  删除一次 import batch 不影响正文；项目包可选择是否包含敏感评论。
- **验证**：parser/mapping/dedup/revision 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、
  `pnpm test:ui`、E2E 导入/回滚 smoke。
- **风险与回滚边界**：评论和运营数据可能含个人信息；默认本地、导出可排除。回滚按 import batch 删除
  派生指标/聚类，不删除用户正文和已采用版本。

### LM5-20 — 海外语言与文化本地化交付

- **Owner**：本地化 / 交付。
- **状态**：`done`。
- **优先级**：P2。
- **依赖**：LM5-14、LM5-18。
- **目标**：从同一母版创建可审查的语言版本，覆盖翻译、字幕、配音、标题/简介、文化注释和地区交付 Profile，
  不把逐字翻译冒充本地化。
- **主要范围**：localization variants、AI translation/review tasks、subtitle/audio versions、delivery profiles、
  terminology/glossary、project package。
- **内部 checklist**：
  1. 语言版本绑定母版版本、目标地区、词汇表、人名/设定表、文化敏感项和审核状态。
  2. 生成字幕/标题/简介翻译候选，支持逐句对照、长度/阅读速度检查和人工采用。
  3. 为目标语言绑定授权 TTS/人工配音、读音词典和角色声音，不默认克隆原声。
  4. 提示笑点、民俗、历史、度量单位、UI 文字和审查差异，允许文化改写但记录与母版差异。
  5. 输出地区 Profile 的成片/字幕/音频/文案/manifest，保持 AIGC 与权利标识。
  6. 母版变化时标记受影响翻译和音频 stale，并支持只更新变化句段。
- **不在范围**：保证海外商业表现、机器翻译免审、全球平台直发、未经授权声音克隆。
- **验收**：至少一个非中文语言版本能完成字幕、文案和音频候选、人工采用和独立交付；母版变化只
  标记相关段落；语言包可追溯且不影响中文母版。
- **验证**：localization/stale/subtitle 单测、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:e2e`、
  golden delivery package；至少一名人工 reviewer 检查试播集语言和字幕可读性。
- **风险与回滚边界**：本地化版本独立于母版；回滚删除/禁用该语言 delivery，不修改中文母版和历史翻译。

### LM5-21 — 全量产品与发布 Gate

- **Owner**：QA / Release。
- **状态**：`partial`（本地 Gate 已通过；外部 Provider/签名安装证据未获授权）。
- **优先级**：P0。
- **依赖**：LM5-00～LM5-20；LM5-10、LM5-14 仍为外部 Provider `partial`，必须保留在最终发布阻断项中。
- **目标**：以可复现证据证明三种创建路径均能完成试播、生产、成片、质检、合规、交付、反馈与恢复，
  并形成发布/回滚闭环。
- **主要范围**：全 `dramaip-desktop`、供应商沙箱、E2E/UI/package、安装包、用户/工程/发布文档、
  migration/project-package compatibility。
- **内部 checklist**：
  1. 三条黄金路径：灵感→样片、导入小说→样片、直接剧本→样片；每条至少完成一个完整试播集。
  2. 覆盖离线/无Provider、Provider失败、费用未知/超预算、取消/恢复、应用重启和项目包换机恢复。
  3. 覆盖旧数据库/旧项目包迁移、题材快照回退、资产证据丢失、源内容变更、成片/报告过期。
  4. 运行图片和 TTS 真实沙箱、至少一个现有视频真实沙箱；外部证据不足不得豁免为 done。
  5. 验证成片播放、字幕/声音、质量报告、rights/AIGC/compliance manifest、两个平台包和 checksum。
  6. 审计日志、诊断、截图、项目包默认策略、密钥/正文/媒体泄漏、媒体路径与命令注入。
  7. 更新 README、USER_GUIDE、TROUBLESHOOTING、ROADMAP、Provider/媒体/合规 runbook 和 release notes。
  8. 打包、安装、升级、回滚并记录支持平台、已知限制、Feature Flag 和外部供应商停用方法。
- **不在范围**：在 Gate 中顺手增加新功能；发现功能缺口应退回对应 loop 或新增经批准的独立 loop。
- **验收**：所有黄金路径、自动化、人工 smoke、真实沙箱、安装/升级/回滚、合规与隐私证据齐全；
  无 P0/P1 blocker；目标分支推送成功、loop 分支清理、工作区无未解释残留。
- **验证**：

  ```bash
  cd dramaip-desktop
  pnpm format:check
  pnpm typecheck
  pnpm test:unit
  pnpm test:db
  pnpm test:ui
  pnpm test:e2e
  pnpm package:smoke
  # 加上 LM5-10 / LM5-14 建立的图片与 TTS 沙箱命令，
  # 以及至少一个已启用视频供应商的官方沙箱 smoke。
  ```

- **风险与回滚边界**：发布 Gate 本身不改变业务行为；发布失败停止 rollout，关闭新增外部 Provider/Profile
  Feature Flag，并按版本化迁移/资产兼容说明回滚应用。不得删除新版本产生的用户数据。

## 11. 建议执行顺序与阻塞处理

### 11.1 严格顺序

```text
工作区归属清理
  → LM5-00
  → LM5-01 → LM5-02 → LM5-03 → LM5-04 → LM5-05 → LM5-06
  → LM5-07 → LM5-08 → LM5-09 → LM5-10 → LM5-11
  → LM5-12 → LM5-13 → LM5-14 → LM5-15 → LM5-16
  → LM5-17 → LM5-18 → LM5-19 → LM5-20
  → LM5-21
```

虽然部分依赖允许更早开发，执行仍遵循 `LOOPRULE.md` 的单 loop 串行闭环要求。只有当维护者
明确采用多工作区/多 Owner 项目规则并更新本地图时，才可改变顺序；不得仅因等待时间私自并行。

### 11.2 外部供应商阻塞

- LM5-10 或 LM5-14 缺少官方账号、沙箱、API 或安全授权时，记录为 `partial`，保留分支/提交/验证状态，
  不把 Mock 通过写成真实闭环。
- 本地资产包、人工导入、Storyboard、Animatic 和音频基础能力可以依其自身 loop 独立验收，但 G2/G3/G5
  仍保持阻断，直到真实供应商 loop 完成。
- 如果目标供应商撤销 API，应先更新本地图的供应商选择与回滚说明，再开始替代 adapter loop。

### 11.3 法规与平台规则变化

- 正式规则变化通过版本化 Profile 更新，不覆写历史交付所用规则。
- 征求意见稿转为正式规则时，必须对比条款、生效日期和适用范围；不得只改显示文案。
- 规则变化若要求新的显式/隐式标识或数据迁移，应新增独立合规 loop，不塞进普通交付 loop。

### 11.4 范围变化

- 新增真实 Provider、直接发布 API、云端素材库或实时数据连接都具有独立外部安全/回滚边界，必须
  先更新 LOOPMAP 再执行。
- 若一个 loop 的累计 diff 无法聚焦 review，按用户可验收结果或数据/供应商边界拆分，并同步更新 Gate。
- 如果发现两个相邻 loop 共享同一验收且单独无价值，应在开始前合并，不允许生成“补接线/补测试”微型 loop。

## 12. 完成记录区

本区只追加真实执行记录，不覆盖历史。

### LM5-00～LM5-05（回填远端合并记录）

- **Target branch**：`main`；已依次推送至 `gitee/main`。
- **Merge commits**：`fe8afb6`（LM5-00）、`2835b83`（LM5-01）、`10a43de`（LM5-02）、
  `933f6c7`（LM5-03）、`b020754`（LM5-04）、`2b85dbb`（LM5-05）。
- **Loop branch cleanup**：LM5-01～LM5-05 临时分支已在各轮合并后清理；LM5-00 的历史分支
  为远端既有引用，不以它替代完成证据。
- **Notes**：这些 loop 在本地图首次落盘前已完成并已进入远端主线；本次仅回填可从远端
  Git 日志复核的状态与合并证据，不伪造未保留的逐条命令输出。

### LM5-06

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-06-coverage-pilot`。
- **Commit(s)**：`3648de1 feat: add truthful pilot production coverage`。
- **Merge commit**：`ea1bb9b merge: LM5-06 truthful pilot production coverage`。
- **Verification**：目标覆盖率 workflow 单测 14/14；Desktop Web/Node `tsc --noEmit`；
  `electron-vite build`；Electron E2E smoke；Electron UI baseline；格式和 diff 检查。
- **Diff review**：覆盖率按本季目标而非任意记录计算；试播限制在 1～3 集；主进程拦截越界
  批处理；未安装的资产、音频、剪辑、成本、版权和最终交付均明确显示缺口。
- **Remote sync / Push**：已 `fetch`、`merge --ff-only gitee/main`，并成功推送
  `2b85dbb..ea1bb9b` 至 `gitee/main`。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-06-coverage-pilot`。
- **Current branch/worktree**：`main`，接续 LM5-07。

### LM5-07

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-07-lineage-cost`。
- **Commit(s)**：`08674d1 feat(production): add generation lineage and cost ledger`。
- **Merge commit**：`a1c0b7a merge: complete LM5-07 generation lineage and cost ledger`。
- **Verification**：生产谱系/Provider 脱敏与交付清单单测 10/10；迁移回放、项目包往返和 DB smoke；
  Core/DB/AI/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；`electron-vite build`；
  集成主线 Electron E2E smoke、UI baseline 和格式/diff 检查均通过。根 `tsconfig` 的
  `scripts/smoke-db.ts` 既有严格检查错误保留为基线问题，未借此改写无关脚本。
- **Diff review**：提交时冻结源版本、能力、模型、参数、seed 与引用；Provider 参数递归脱敏；
  重试新建谱系且不覆盖旧记录；旧视频按 `unknown/partial` 回填；项目包与交付清单保留可追溯
  关系但不伪造可轮询任务或采用结果；项目概览显示估算、实际和未知成本。
- **Remote sync / Push**：已 `fetch`、`merge --ff-only gitee/main`，并成功推送
  `ea1bb9b..a1c0b7a` 至 `gitee/main`。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-07-lineage-cost`。
- **Current branch/worktree**：`main`，接续 LM5-08。

### LM5-08

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-08-rights-ledger`。
- **Commit(s)**：`4c0aca1 feat(compliance): add asset rights ledger and delivery preflight`。
- **Merge commit**：`137409b merge: complete LM5-08 asset rights ledger`。
- **Verification**：迁移回放与项目包安全往返 15/15；IPC/生产基线/视频授权边界单测 15/15；
  DB smoke；Core/DB/AI/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；`electron-vite build`；
  集成主线 Electron E2E smoke、UI baseline（3 条既有 a11y 观察项）和格式/diff 检查均通过。
- **Diff review**：权利记录独立于资产 metadata；导入声明不会升级为核验；证明被复制到受控目录并以
  SHA-256 绑定；项目包不导出证明路径/正文，导入后必须重新定位；未知、过期、范围不符和缺证据
  均阻止最终预检；已登记选角/人脸参考在 Provider 调用前强制核验生成授权，选角还要求肖像授权。
- **Remote sync / Push**：已 `fetch`、`merge --ff-only gitee/main`，并成功推送
  `a1c0b7a..137409b` 至 `gitee/main`。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-08-rights-ledger`。
- **Current branch/worktree**：`main`，接续 LM5-09。

### LM5-09

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-09-visual-assets`。
- **Commit(s)**：`9d87eec feat(assets): version visual production packs`。
- **Merge commit**：`04d2de0 merge: complete LM5-09 visual asset packs`。
- **Verification**：迁移回放与生产资产包/项目包往返 16/16；IPC、生产基线、交付清单和视频授权边界
  单测 20/20；DB smoke；Core/DB/AI/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；
  `electron-vite build`；集成主线 Electron E2E smoke、UI baseline（3 条既有 a11y 观察项）和格式/diff
  检查均通过。
- **Diff review**：角色/场景资产使用不可变候选和采用状态；替换只使锁定旧版本的镜头变为 stale，
  不覆盖历史集；本地人工素材保留源文件，裁切/标注说明随候选记录，实际处理需外部工具另存新素材；
  版本、锁、素材状态和权利状态进入项目包及分镜交付清单，不携带二进制或证据正文；主进程验证资产、
  设定和分镜都属于同一项目。
- **Remote sync / Push**：已 `fetch gitee`，并成功推送 `137409b..04d2de0` 至 `gitee/main`。
- **Loop branch cleanup**：已移除 LM5-09 临时工作区并删除 `loop/lm5-09-visual-assets`。
- **Current branch/worktree**：`main`，接续 LM5-10。

### LM5-10

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-10-image-provider`。
- **Commit(s)**：`38f9db4 feat(image): add gated OpenAI image adapter`。
- **Merge commit**：`054bd99 merge: partial LM5-10 gated OpenAI image adapter`。
- **Verification**：OpenAI Image adapter 合同测试 3/3；既有 IPC/视频 Provider 合同测试 12/12；
  Core/AI/DB/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；格式和 diff 检查均通过。
- **Diff review**：采用官方 `POST /v1/images/generations` 和 `gpt-image-2` 的受控适配器；只有 API Key
  与明确生产开关同时具备时才可提交；文本生图拒绝上传本地参考图；无文档的轮询、远端取消或 edits
  上传均未伪造。返回内容只以 b64 交给未来资产归档器，适配器不记录密钥、媒体或提示词。
- **External blocker / partial**：当前没有用户授权的 OpenAI API Key、账单/区域权限和已授权测试素材，且本轮
  尚未开放 Keychain 设置页和图片任务持久化/归档链路。因此没有执行真实 API 或沙箱 smoke，也不能将
  Provider 宣称为生产可用；`OPENAI_IMAGE_PROVIDER_RUNBOOK.md` 记录了继续条件。
- **Remote sync / Push**：已 `fetch gitee`，并成功推送 `04d2de0..054bd99` 至 `gitee/main`。
- **Loop branch cleanup**：已移除 LM5-10 临时工作区并删除 `loop/lm5-10-image-provider`。
- **Current branch/worktree**：`main`，接续 LM5-11（可先使用本地导入素材）。

### LM5-10（重新开放：本地生成任务闭环）

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-10-image-runtime`。
- **Commit(s)**：`8f7d8ab feat(image): complete local provider task runtime`。
- **Merge commit**：`5bb28e1 merge: complete local LM5-10 image runtime`。
- **Verification**：源分支通过 `pnpm format:check`、全 workspace `pnpm typecheck`、`pnpm test:unit`（226/226）和
  `pnpm test:db`（22/22）；同一 loop 分支的 Electron E2E smoke、UI baseline（含 image settings）和 ARM64 unsigned
  package smoke 均通过。成本谱系的最终小幅修订后再次通过格式、类型、完整 unit 与 DB；合并后的集成主线再次通过
  `pnpm format:check`、`pnpm typecheck`，以及图片/IPC/任务运行时定向测试 15/15。
- **Diff review**：图片 Provider 配置仅持久化 Keychain 引用，渲染端只得到脱敏显示；关闭明确的费用开关时拒绝构造
  生产适配器。镜头工作区先预检、明确确认后才逐项创建候选；任务使用独立的图片并发槽，取消会中止本地等待，归档
  为新资产候选而不覆盖既有素材。调用参数、模型与 token 使用量进入无凭据的谱系快照；远端实际费用在没有可核对
  账单时始终标为 `unknown`，不伪造金额。Runbook 已更新为官方 `gpt-image-2` 同步图片生成路径及受控外部 smoke。
- **External blocker / partial**：没有账户所有者授权的真实 Image sandbox、组织验证/计费确认或授权测试素材；本轮没有
  执行真实 API 调用，因此没有实际生成、远端归档、实际账单费用或故障恢复证据。该项保持 `partial`，但此前缺失的
  Keychain 设置、任务持久化、取消和本地归档链路已完成；取得授权后只需按 Runbook 补跑外部 Gate，不能将本地测试
  或 unsigned package 当作外部生产证据。
- **Remote sync / Push**：已 `fetch gitee`，并成功推送 `43cdfb0..5bb28e1` 至 `gitee/main`；`ls-remote` 已确认
  `5bb28e19a019761c9b318555171a6fe208592d06`。
- **Loop branch cleanup**：已移除 LM5-10 临时工作区并删除 `loop/lm5-10-image-runtime`。
- **Current branch/worktree**：`main`，接续 LM5-14 的本地 TTS 运行时闭环。

### LM5-11

- **Target branch**：`main`。
- **Loop branch(es)**：`loop/lm5-11-storyboard-visuals`、`loop/lm5-11-batch-completion`。
- **Commit(s)**：`951d7cb feat(visual): add shot still candidate workflow`；`bdeacc9 feat(visual): add still batch planning and risk audit`。
- **Merge commit(s)**：`00441e8 merge: complete LM5-11 storyboard visuals`；`11e0983 merge: complete LM5-11 batch planning and risk audit`。
- **Verification**：Core/DB/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；迁移回放及项目包往返 16/16；IPC、项目包、静帧任务规划和连续性单测 14/14；`electron-vite build`；Electron E2E smoke；UI baseline（3 条既有 a11y 观察项）；格式与 diff 检查均通过。
- **Diff review**：静帧、首帧、尾帧和封面以独立候选/采用关系保存，采用历史候选可回退且不会覆盖媒体；镜头更新、素材移除和上游视觉资产换版只标记相应镜头 stale。批量计划默认只补缺，显式选中才会创建新候选；计划只生成无密钥的可审阅输入，费用标为未知。人工接受风险以追加审计记录保存。项目包 v10 往返候选、采用、过期与引用，不携带媒体二进制。像素级人脸/文字识别没有被伪装为已实现，界面明确标示为人工复核。
- **External boundary**：LM5-10 的真实图片 Provider/Keychain/归档仍为 `partial`，因此 LM5-11 不提交计费请求；用户可复制任务清单并导入已授权图片完成同一候选工作流。
- **Remote sync / Push**：已 `fetch gitee`，并成功推送 `054bd99..11e0983` 至 `gitee/main`。
- **Loop branch cleanup**：已移除 LM5-11 两个临时工作区并删除 `loop/lm5-11-storyboard-visuals`、`loop/lm5-11-batch-completion`。
- **Current branch/worktree**：`main`，接续 LM5-12。

### LM5-12

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-12-animatic`。
- **Commit(s)**：`9e6954c feat: add versioned animatic pilot review`。
- **Merge commit**：`891fba1 merge: complete LM5-12 animatic pilot review`。
- **Verification**：Core/DB/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；Animatic 时间线与 IPC 契约单测 7/7；迁移回放与项目包往返 16/16；格式和 diff 检查均通过。合并后在隔离依赖树完整执行目录版 `package:smoke`：生产构建、原生模块重建、macOS ARM64 打包、`app.asar` 内容检查及冷启动 SQLite 初始化均通过。
- **Diff review**：Animatic 从当前分集的已采用静帧与镜头时长确定性初始化，静帧缺失明确显示为空位；时长、拖拽排序和 9:16 取景裁切均保存为只追加版本。时间点批注覆盖节奏、信息量、钩子和镜头；审核结论必须填写理由且不可覆盖。镜头源版本变化会阻止保存/审批过期时间线。项目包 v11 会重映射镜头、静帧候选、资产和审核记录，不携带媒体二进制。预览为应用内低成本静帧播放，不调用视频/TTS/图片 Provider；最终 MP4、外部媒体运行时和正式声音明确留给 LM5-13～LM5-15。
- **Remote sync / Push**：已推送 `11e0983..891fba1` 至 `gitee/main`，并以 `ls-remote` 确认同一 HEAD。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-12-animatic`。
- **Current branch/worktree**：`main`，接续 LM5-13。

### LM5-13

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-13-audio-tracks`。
- **Commit(s)**：`4d44c0d feat(audio): add versioned manual audio tracks`。
- **Merge commit**：`205c120 merge: complete LM5-13 versioned manual audio tracks`。
- **Verification**：Core/DB/Export/Desktop 受影响 TypeScript 工程 `tsc --noEmit`；Animatic/IPC 契约单测 7/7；包含音频迁移、候选/采用/过期与项目包往返的数据库回归 17/17；格式与 diff 检查均通过。合并后目录版 `package:smoke` 成功完成生产构建、原生模块重建、macOS ARM64 打包、`app.asar` 内容检查和冷启动 SQLite 初始化。
- **Diff review**：声音 Profile 与角色可选绑定，候选/采用历史不覆盖；人工导入的对白、旁白、BGM、音效通过第一等资产类别进入只追加音轨版本。台词/旁白/时长变动时音轨标为 stale 并禁止采用；新采用同类轨只将旧采用版本设为 superseded。项目包 v12 重映射角色、样本、镜头、音频素材和声音 Profile，并保留 stale 状态。当前工作台明确不调用 TTS 或声音克隆；真实供应商边界留给 LM5-14。
- **Remote sync / Push**：已推送 `891fba1..205c120` 至 `gitee/main`，并以 `ls-remote` 确认同一 HEAD。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-13-audio-tracks`。
- **Current branch/worktree**：`main`，接续 LM5-14。

### LM5-14

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-14-tts-provider`。
- **Commit(s)**：`5be21e9 feat(audio): add gated OpenAI TTS adapter`。
- **Merge commit**：`033b403 merge: partial LM5-14 gated OpenAI TTS adapter`。
- **Verification**：Core `tsc --noEmit`；OpenAI 图片/TTS provider 契约单测 6/6；diff 检查均通过。完整 AI 包类型检查因隔离依赖树缺少既有 `@langchain/langgraph`/`zod` 依赖而无法运行，不将其误报为通过；适配器自身由独立测试覆盖。
- **Diff review**：以官方同步 `POST /v1/audio/speech` 实现 `gpt-4o-mini-tts` 默认适配器，文本长度、格式、速度和中止信号均受控；API Key 与非秘密生产开关同时缺一不可。内置声音可用，定制声音/克隆、样本上传、未文档化远端轮询/取消均明确拒绝。runbook 规定 Keychain、经授权测试、资产归档、成本账本和人工回退。
- **External blocker / partial**：没有用户授权的 OpenAI TTS API Key、账单/区域权限、Keychain 设置接线、归档任务链路或可用于沙箱的授权声音/台词。因此没有真实外部提交、成本、归档和恢复证据，不能宣称生产可用；LM5-13 人工音轨继续可用。
- **Remote sync / Push**：已推送 `205c120..033b403` 至 `gitee/main`，并以 `ls-remote` 确认同一 HEAD。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-14-tts-provider`。
- **Current branch/worktree**：`main`，接续 LM5-15。

### LM5-14（重新开放：本地 TTS 运行时闭环）

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-14-tts-runtime`。
- **Commit(s)**：`864660c feat(audio): complete local TTS provider task runtime`。
- **Merge commit**：`debb5ad merge: complete local LM5-14 TTS runtime`。
- **Verification**：源分支通过 `pnpm format:check`、全 workspace `pnpm typecheck`、`pnpm test:unit`（229/229）和
  `pnpm test:db`（22/22）；Electron E2E smoke 通过，并明确验证 TTS Provider 的 Keychain 引用与渲染端脱敏；
  UI baseline 通过（新增 TTS 设置屏，3 条既有 a11y 观察项）；ARM64 unsigned package smoke 通过。合并后的集成主线
  再次通过格式、类型和 TTS/IPC/任务运行时定向测试 15/15。
- **Diff review**：TTS Provider 配置只持久化 Keychain 引用，默认关闭计费开关；音频入口仅接受内置声音，明确拒绝
  定制声音/声音克隆/样本上传和未文档化远端取消。提交前先写入任务、无凭据谱系及 `unknown` 成本账本；读音词典在
  本地预处理后才发送，返回音频只归档为新的对白/旁白候选资产，不覆盖人工录音。停止只中止本地等待，远端实际费用
  在账单核对前不会被伪造。Runbook 已改为可执行的受控 sandbox 步骤。
- **External blocker / partial**：没有账户所有者授权的真实 TTS sandbox、组织/区域/计费确认或授权台词与声音材料；本轮
  没有执行真实 API 调用，因此没有实际生成、远端归档、实际账单费用或故障恢复证据。该项保持 `partial`，但此前缺失的
  Keychain 设置、任务持久化、取消、重试和本地归档链路均已完成；取得授权后只需按 Runbook 补跑外部 Gate，不能将本地
  测试或 unsigned package 当作外部生产证据。
- **Remote sync / Push**：已 `fetch gitee`，并成功推送代码 `da98d24..debb5ad` 至 `gitee/main`；`ls-remote` 已确认
  `debb5adaa470c870f72075998401fde045f52321`。
- **Loop branch cleanup**：代码推送后已移除 LM5-14 临时工作区并删除 `loop/lm5-14-tts-runtime`；本条记录随后作为
  追加文档提交推送。
- **Current branch/worktree**：`main`；真实外部 TTS 与发布 Gate 仍受授权限制。

### LM5-15

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-15-render-timeline`。
- **Commit(s)**：`fe3ff63 feat(render): add versioned episode MP4 pipeline`。
- **Merge commit**：`102e8e5 merge: complete LM5-15 render timeline`。
- **Verification**：Core 与 Desktop Node/Web `tsc --noEmit`；完整 Node 测试集 204/204；真实 FFmpeg fixture
  生成并检查 720×1280 H.264/AAC MP4、混音、SRT/VTT、manifest 与安全区字幕；合并后目录版
  `package:smoke` 成功完成生产构建、macOS ARM64 打包、内置 FFmpeg 可执行检查和冷启动 SQLite 初始化。
- **Diff review**：渲染只接受当前、已批准的 Animatic、已采用且有本地文件的视听资产、字幕与权利前检；缺镜头、
  占位、过期源、无本地媒体或无字幕会阻断交付。时间线计划将视觉版本、音频版本、静音选择、资产更新时间和
  权利状态写入 hash，历史成片按自己的输入重算 stale。FFmpeg 使用结构化参数生成竖屏 H.264/AAC、裁切与转场、
  淡入淡出、ducking、响度处理及烧录安全区字幕，归档 MP4、音轨、字幕和 manifest；任务复用长任务的取消、
  重试和恢复机制，不改写源资产。应用包解包内置 `ffmpeg-static` 运行时并携带第三方许可证说明。
- **External boundary**：LM5-14 的真实外部 TTS 仍为 `partial`；本轮以 LM5-13 的受权人工导入音轨完成成片，
  未将无凭据的供应商音频伪装为正式输出。
- **Remote sync / Push**：已推送 `033b403..102e8e5` 至 `gitee/main`，并以 `ls-remote` 确认同一 HEAD。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-15-render-timeline`。
- **Current branch/worktree**：`main`，接续 LM5-16。

### LM5-16

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-16-media-qc`。
- **Commit(s)**：`23182c2 feat(qc): add episode media quality gate`。
- **Merge commit**：`bb68a49 merge: complete LM5-16 media quality gate`。
- **Verification**：Core 与 Desktop Node/Web `tsc --noEmit`；完整 Node 测试集 208/208；数据库迁移回放和
  repository smoke 17/17；真实 FFmpeg fixture 同时验证成片 MP4、视频流、音频流和 720×1280 探测；
  `electron-vite build`、Electron E2E smoke 和 UI baseline 均通过。
- **Diff review**：质检仅读取已经归档的当前 MP4，使用内置 FFmpeg 检查可读性、时长、画幅、视频/音频流、
  黑帧、冻结、静音、削波和响度；静帧保持段与短淡入淡出会被识别为预期素材，而不是误报冻结/黑帧。核心规则
  检查缺镜头/占位、字幕越界/重叠/安全区、对白字幕时序，并汇总既有视觉版本锁连续性；嘴型同步未接入可靠模型时
  明确只保留人工核对提示。每份报告绑定渲染任务、渲染输入 hash 和当前时间线，替换资产或重新渲染即 stale。
  blocker、warning 和追加式风险接受分别展示；风险接受包含本地 Owner、时间、理由和交付版本，且不静默放行
  blocker。最小返工清单只引用 blocker 涉及的镜头、音频、字幕或交付项，不覆盖媒体、也不提交新的 Provider 任务。
- **Remote sync / Push**：已在合并前 `fetch gitee main` 并 fast-forward 校验，成功推送
  `102e8e5..bb68a49` 至 `gitee/main`，以 `ls-remote` 确认同一 HEAD。
- **Loop branch cleanup**：已移除临时工作区并删除 `loop/lm5-16-media-qc`。
- **Current branch/worktree**：`main`，接续 LM5-17。

### LM5-17

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-17-compliance-gate`。
- **Commit(s)**：`f8198be feat(compliance): add signed AIGC delivery gate`。
- **Merge commit**：`0fc4c42 merge: complete LM5-17 signed AIGC delivery gate`。
- **Verification**：核心/DB/Desktop 全量 TypeScript 检查；规则预检、迁移回放、已签名离线
  Profile、真实 FFmpeg 转码与 MP4 元数据回读测试；全量单元测试 212/212；DB smoke；
  Electron E2E smoke；UI baseline；`electron-builder --dir` package smoke。合并后重新运行了
  全量 TypeScript、212/212 单元测试、DB smoke 和 Electron E2E。打包后 Node 测试第一次会因
  `better-sqlite3` 被 Electron ABI 重建而报 ABI 不匹配；按既有 `pnpm rebuild:node` 流程恢复后
  全部通过，非功能断言失败。
- **Diff review**：已运行累计 `git diff --check` 和最终 `gitee/main...HEAD` 审查。规则 Profile
  同时保存来源状态、发布日期/生效日期、范围、版本、sha256 和 Ed25519 签名；启动、启用与交付
  预检均复验签名，未知、篡改、未验证或征求意见 Profile 不会静默放行。合规封装只新建输出，不改写
  原 MP4；固定写入可见 `AI Generated` 角标、`SDNS-AIGC` 隐式元数据和不含正文/路径/凭据的
  文本、图片、音频、视频、最终文件与权利属性 Manifest，转码后读回验证失败即拒绝标为交付。
- **Remote sync / Push**：合并前已 `fetch gitee main`，本地 `main` 与 `gitee/main` 都是
  `bb68a49`；合并后成功推送 `bb68a49..0fc4c42`，并以 `ls-remote` 确认远端 `main` 为
  `0fc4c42d0abf3c992525c8c32ad57a3bc850c8a9`。
- **Loop branch cleanup**：LM5-17 临时 worktree 已移除，`loop/lm5-17-compliance-gate` 已安全删除。
- **Current branch/worktree**：`main`，接续 LM5-18。
- **Notes**：UI 不提供删除/规避标识入口；风险接受、人工内容复核和版权/许可证/备案状态均不替代
  新鲜媒体质检或权利预检。规则 Profile 是离线发布包和辅助合规 Gate，不构成法律意见或审核通过保证。

### LM5-18

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-18-platform-delivery`。
- **Commit(s)**：`031e618 feat(delivery): add platform handoff packages`。
- **Merge commit**：`8c06de0 merge: complete LM5-18 platform delivery packages`。
- **Verification**：Core/DB/Desktop 全量 TypeScript；全量单元测试 218/218（含 Profile fail-closed、IPC
  严格输入、独立目录 golden package 与逐文件 SHA-256 校验）；数据库迁移回放和 repository smoke 19/19（含
  A/B 采用归档与多 delivery version）；Electron E2E smoke、UI baseline、`electron-vite build` 和
  `electron-builder --dir` package smoke 均通过。合并到 `main` 后复跑了同一组 TypeScript、单元、数据库、
  E2E、UI 与打包检查。
- **Diff review**：新增离线 Profile：通用竖屏母版、抖音人工提交包、红果人工提交包。它们将本地可验证的
  720×1280、H.264/AAC、字幕安全区、命名和文件字段与必须人工复核的实时上传规格/时长、资质、分类和审核字段
  分开呈现；不会猜测或声称平台规则已被自动满足。交付只能选当前成功且不 stale 的合规 MP4、已采用候选、可用封面
  与人工确认；目录包含 MP4、SRT/VTT、封面、listing、rights、AIGC/compliance、QC、Manifest 和 checksums，
  失败遗留目录或重复导出都会递增版本，绝不覆盖。IPC 仅暴露受限本地操作，不保存平台账号、不登录、不代投或自动发布。
- **Remote sync / Push**：合并前 `fetch gitee main` 与本地基线均为 `0fc4c42`；成功推送
  `0fc4c42..8c06de0` 至 `gitee/main`，并以 `ls-remote` 确认远端 `main` 为
  `8c06de04070bdcf9e7f12da40c33e2154f3f6bdd`。
- **Loop branch cleanup**：LM5-18 临时 worktree 已移除，`loop/lm5-18-platform-delivery` 已安全删除。
- **Current branch/worktree**：`main`，接续 LM5-19。
- **Notes**：交付 Profile 是可追溯的本地手工提交辅助，不构成平台审核通过、备案/版权法律意见或自动发行承诺。

### LM5-19

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-19-feedback-loop`。
- **Commit(s)**：`c737511 feat(feedback): add local metrics and comment feedback loop`。
- **Merge commit**：`c68450d merge: complete LM5-19 local feedback loop`。
- **Verification**：Core/DB/Desktop 全量 TypeScript；全量单元测试 221/221；数据库迁移回放和 repository
  smoke 21/21；新增 CSV/JSON 指标与评论解析、文件/行去重、隐私脱敏、派生聚类删除、项目包默认排除/显式
  包含反馈、跨项目定位回退及修订任务不改正文的集成测试；Electron E2E smoke、UI baseline、生产构建均通过。
  合并到 `main` 后复跑了同组 TypeScript、221/221 单元、21/21 数据库、构建、E2E 和 UI 验证。
- **Diff review**：反馈文件仅在主进程读取，前端只持有 30 分钟一次性预览令牌；不存平台账号、cookie 或抓取数据。
  指标独立保留平台、版本、时间窗、口径和 A/B 版本，不展示跨平台“热度”或因果结论。评论可仅本地保存或在
  写入前脱敏，关键词聚类是可删除的派生记录；修订任务只写入受控摘要，须继续经 Diff/人工采用，绝不直接改正文
  或成片。普通项目包默认不包含反馈，用户可显式导出并在导入时恢复批次、定位和聚类；外部或失效的定位安全回退
  至当前项目，避免跨项目写入。
- **Remote sync / Push**：合并前 `fetch gitee main` 基线为 `8c06de0`；成功推送
  `8c06de0..c68450d` 至 `gitee/main`，并以 `ls-remote` 确认远端 `main` 为
  `c68450d298e050545f3907d8740e671d18eb2eaa`。
- **Loop branch cleanup**：LM5-19 临时 worktree 已移除，`loop/lm5-19-feedback-loop` 已安全删除。
- **Current branch/worktree**：`main`，接续 LM5-20。
- **Notes**：本实现是用户主动选择本地文件的回流链路，不提供爬虫、自动投流、账号登录或模拟观众替代真实数据。

### LM5-20

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-20-localization`（已清理）。
- **Commit(s)**：`75a3230 feat(localization): add reviewable language variants`。
- **Merge commit**：`9ea5880 merge: complete LM5-20 localization variants`。
- **Verification**：Core/DB/Desktop 全量 TypeScript；`tests/localization.test.ts`、IPC 契约和项目包兼容测试；
  全量单元 223/223、数据库 smoke 21/21；Electron E2E、UI baseline、生产构建与 package smoke 全部通过。
  数据库迁移 v39 创建 `localization_variants`，并以回放测试确认旧库可幂等升级。
- **Diff review**：语言版本与中文母版分离，保存地区、术语、文化说明、逐句时间轴、审核/过期状态与目标语言声音候选；
  字幕导出检查阅读速度，母版变更会使版本过期，不会静默覆盖译文。项目包往返会重映射镜头提示，保留语言内容，
  但清空声音候选并要求重新选择已授权的目标语言声音；不提供原声克隆或免审机器翻译。
- **Remote sync / Push**：已推送 `c68450d..9ea5880` 至 `gitee/main`，远端 HEAD 为
  `9ea58807f509458b505bd9e47793ec97401260be`。
- **Loop branch cleanup**：LM5-20 临时 worktree 和 `loop/lm5-20-localization` 已安全删除。
- **Current branch/worktree**：`main`，接续 LM5-21。
- **Notes**：真实 TTS 仍受 LM5-14 的授权 Provider 边界限制；本 loop 只交付可审查的候选和受权人工/目标语言配音接线。

### LM5-21

- **Target branch**：`main`。
- **Loop branch**：`loop/lm5-21-release-gate`（已清理）。
- **Commit(s)**：`0106c05 docs(release): record LM5-21 release gate`。
- **Merge commit**：`43cdfb0 merge: record LM5-21 release gate evidence`。
- **Verification**：
  - 全量本地 Gate：`pnpm format:check`、`pnpm typecheck`、`pnpm rebuild:node && pnpm test:unit`
    （223/223）、`pnpm test:db`（21/21），以及新增本地化项目包往返迁移测试（22/22）均通过；合并后再次通过
    format、typecheck 和 22/22 迁移/项目包回归，并恢复 Electron ABI。
  - `pnpm build`、Electron E2E smoke、UI baseline、`pnpm package:smoke` 均通过。E2E 输出覆盖三种入口、
    导入小说/剧本、项目包往返、取消/恢复与重启恢复、生产工作台链路；打包 smoke 产出 macOS ARM64 未签名 DMG/ZIP，
    验证 asar、内置 FFmpeg、冷启动和 SQLite 初始化。
  - 迁移回放覆盖旧数据库、题材快照回退、缺失权利 fail-closed、源变更/过期、反馈与本地化项目包恢复；已有交付
    测试覆盖两个平台 Profile、manifest 与逐文件 SHA-256。日志/诊断和包内容检查拒绝密钥、正文、媒体路径与不可信命令泄漏。
  - 未授权视频 sandbox 的安全拒绝已复核：`pnpm test:hailuo:sandbox` 与 `pnpm test:wan:sandbox` 都因未设置显式
    `*_SANDBOX_ALLOW_BILLING=1` 以退出码 1 停止，未产生网络调用或费用。
- **Diff review**：新增发布/回滚 Runbook、Release Candidate 模板、用户指南和故障排除说明，并补充本地化迁移与
  项目包往返回归。Runbook 如实区分本地自动化、未签名 package smoke 与正式签名/公证/安装验证；默认关闭外部 Provider，
  不保存 Provider 密钥、平台账号或 cookie。
- **External blocker / partial**：
  1. OpenAI Image 缺少 Keychain 设置、图片任务归档和由账户所有者授权的真实 sandbox；不能以适配器合同测试替代。
  2. OpenAI TTS 缺少 Keychain/成本/归档接线和授权 sandbox；人工音轨是受控回退，不能证明真实 TTS 发布能力。
  3. Hailuo/Wan 真实视频 sandbox 需要专用 API Key 与显式计费授权；当前安全拒绝符合预期，但不是成功证据。
  4. macOS/Windows/Linux 的正式签名、公证、首次安装、升级与回滚必须由拥有证书和目标系统的 release 环境执行；
     本轮仅验证 macOS ARM64 未签名构建及打包后启动。
- **Remote sync / Push**：合并前已 `fetch gitee main` 并 fast-forward 校验；成功推送 `9ea5880..43cdfb0` 至
  `gitee/main`，`ls-remote` 确认为 `43cdfb05dfa0fd6ac4cb06fecbacdcbea04ae175`。
- **Loop branch cleanup**：LM5-21 临时 worktree 已移除，`loop/lm5-21-release-gate` 已安全删除。
- **Current branch/worktree**：`main`；无下一内部 loop。取得所列授权与 release 环境证据后，重开 LM5-21 并仅补跑
  外部 Gate，不能把本条 `partial` 改写为 `done`。
- **Notes**：`docs/release/RELEASE.md` 给出完整的 Node/Electron ABI 顺序、打包、安装与回滚步骤；
  `docs/release/RELEASE_CANDIDATE.md` 是脱敏证据记录模板，不是已发布声明。

### LM5-21（外部 Gate 复核）

- **Target branch**：`main`。
- **Loop branch**：无；本次只复核已完成本地 Gate 与账户所有者授权边界，不创建无效实现分支。
- **Verification**：LM5-10 和 LM5-14 已分别补齐本地 Keychain、任务、取消、重试、候选归档和无凭据谱系；最新本地
  回归为 229/229 unit、22/22 DB、Electron E2E、UI baseline 与 unsigned package smoke。没有把这类本地证据
  等同于真实 Provider 或正式发布。
- **External blocker / partial**：
  1. 图片与 TTS 均仍缺账户所有者授权的真实 sandbox、组织/区域/计费确认、授权测试材料和实际账单/远端归档证据；
     两条 Runbook 已可在取得授权后直接执行。
  2. Hailuo/Wan 真实视频 sandbox 仍需要专用 API Key 与显式计费授权。
  3. 正式签名、公证、跨平台首次安装、升级与回滚仍需要证书、目标操作系统和 release 环境授权。
- **Decision**：保持 LM5-10、LM5-14 与 LM5-21 为 `partial`，不发起真实 API 调用、不使用或记录任何未经过账户所有者
  授权的凭据；所有可在本地完成的 loop 已收口并推送。取得上述授权后只重开相应的外部 Gate。
- **Safe no-authorization recheck**：在未设置 `HAILUO_SANDBOX_ALLOW_BILLING=1` 或
  `WAN_SANDBOX_ALLOW_BILLING=1` 的条件下，`pnpm test:hailuo:sandbox` 和 `pnpm test:wan:sandbox`
  都以预期退出码 1 在本地拒绝执行，未携带 API Key、未发起网络请求或费用。这证明 fail-closed 边界仍有效，
  不构成任何真实 Provider 成功证据。

### 记录模板

```text
Loop:
Target branch:
Loop branch:
Commit(s):
Merge commit:
Verification:
Diff review:
Remote sync:
Push:
Loop branch cleanup:
Current branch/worktree:
Notes:
```

### 状态汇总

| 状态 | Loop |
| --- | --- |
| todo | 无 |
| doing | 无 |
| partial | LM5-10（缺少账户所有者授权的真实 Image sandbox、组织验证/计费与实际费用/归档证据）；LM5-14（缺少账户所有者授权的真实 TTS sandbox、组织/区域/计费与实际费用/归档证据）；LM5-21（缺少真实 Provider 与签名安装/升级/回滚证据） |
| done | LM5-00～LM5-09、LM5-11～LM5-13、LM5-15～LM5-20 |
