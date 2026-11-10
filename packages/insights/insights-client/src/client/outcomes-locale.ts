/** Copy of the outcome ledgers: receipts, measures, executions and usage reports. */
export const outcomesZh = {
  "outcomes.title": "本地创作结果台账",
  "outcomes.refresh": "刷新结果台账",
  "outcomes.intro":
    "只统计你正式采用、写入记忆和保存的成果；数据只在本机，不外发。",
  "outcomes.scope.summary": "统计口径说明",
  "outcomes.scope.counts":
    "分别统计正式采用、章节派生记忆实际写入与完整性回执匹配的实际保存。小说与剧本分开计数，同一实际版本集合的重放、重复保存、换格式或重试不会增加成果数；AI 草稿和页面点击不计入。",
  "outcomes.scope.facts":
    "这是本地历史事实，不是当前版本质量、版权核验或爆款预测。仅包含开始记录后的权威事件，不补算旧资料；不会发送正文、提示词或台账到外部分析服务。",
  "outcomes.scope.memory":
    "记忆写入按实际记录集合计一批，不计入人工正文采用或首稿采用率；自动同步与独立审阅的流程仍各自保留，此计数不认证触发方式、当前有效性或语义正确性。",
  "outcomes.error": "结果台账读取失败：{error}。不能把读取失败当成没有成果。",
  "outcomes.loading": "正在读取本地结果台账…",
  "outcomes.lag":
    "结果投影尚未追平或读取异常，当前数字可能不完整；请稍后刷新。",
  "outcomes.list": "、",
  "outcomes.separator": " · ",
  "outcomes.none": "无",
  "outcomes.unrecorded": "未记录",
  "outcomes.unknown": "未知",
  "outcomes.notYet": "尚未记录",
  "outcomes.ms": "{ms} 毫秒",
  "outcomes.model.invalid": "原配置无效",
  "outcomes.model.unrecorded": "原配置未记录",
  "outcomes.duration.unknown": "未知（时钟异常）",
  "outcomes.duration.seconds": "{value} 秒",
  "outcomes.kind.chapterAdopted": "正式章节采用版本",
  "outcomes.kind.planningAdopted": "人物 / 大纲 / 故事弧采用版本",
  "outcomes.kind.memoryWritten": "章节派生记忆实际写入批次",
  "outcomes.kind.manuscriptExported": "已保存的稿件版本集合",
  "outcomes.kind.diagnosisAdopted": "诊断采用版本",
  "outcomes.kind.strategyAdopted": "独立改编策略明确单选版本",
  "outcomes.kind.seasonPlanAdopted": "季纲采用版本",
  "outcomes.kind.scriptAdopted": "标准剧本采用版本",
  "outcomes.kind.pilotExported": "已保存的内部试制包版本集合",
  "outcomes.metric.chapter": "小说章节",
  "outcomes.metric.diagnosis": "改编诊断",
  "outcomes.metric.strategy": "独立改编策略",
  "outcomes.metric.seasonPlan": "整季方案",
  "outcomes.metric.script": "标准分集剧本",
  "outcomes.chapters.aria": "全书章节集合变化证据",
  "outcomes.chapters.counts":
    "Writing 全书非空章节完整目录：冻结 {frozen} 项 → 实际核对 {current} 项（不是目录版本）",
  "outcomes.chapters.added": "进入该范围的章节引用：{ids}",
  "outcomes.chapters.left": "退出该范围的章节引用：{ids}",
  "outcomes.chapters.note":
    "仅是拒绝时的完整目录观察；空正文可退出范围，不等于物理删除、已读正文、当前授权或叙事质量。",
  "outcomes.goal.title": "初始创作目标确认",
  "outcomes.goal.choice": "创建时明确目标：{goal} · 素材：{material}",
  "outcomes.goal.novelFirst": "先完成小说",
  "outcomes.goal.scriptFirst": "先完成剧本",
  "outcomes.goal.material.inspiration": "创意",
  "outcomes.goal.material.sourceImport": "小说 / 大纲",
  "outcomes.goal.material.script": "已有剧本",
  "outcomes.goal.origin": "原项目 {projectId} @ {version} · 确认发生于 {at}",
  "outcomes.goal.note":
    "只描述实际创建请求的初始明确选择，不是当前作者意图、身份认证、授权证明或质量评分；模型来源未知。旧项目和默认推荐不补确认，不增加成果数或采用率分母。",
  "outcomes.counts.novel": "小说结果",
  "outcomes.counts.adaptation": "剧本 / 改编结果",
  "outcomes.counts.line": "累计 {total} · 最近 7 天 {recent}",
  "outcomes.counts.note":
    "最近 7 天为滚动时间窗，以该成果首次权威回执计数，不是自然周。7 天继续率单独使用固定满窗项目分母，不能与上述滚动成果数混用。真实模型用量与成本、叙事质量率暂不计算。模型来源未知，不由引擎名推断；人工采用与规则校验不等于真实模型质量证据。",
  "outcomes.quality.title": "质量报告历史关联",
  "outcomes.quality.counts":
    "已记录报告采用 {recorded} · 精确目标关联 {exact} · 明确跨章范围关联 {scope} · 未关联已记录成果 {unlinked}",
  "outcomes.quality.note":
    "只读开始记录后的报告采用凭证及准确历史版本，不补算旧报告。报告采用、人工接受风险或解决问题均不等于文学质量通过；模型来源、当前报告有效性和叙事质量仍未知。跨章范围成员不等于逐章原文已读，不作为质量率分母。普通保存剧本／场景的不同身份与指纹不近似映射为单集成果。",
  "outcomes.quality.units":
    "关联成果单位 {units}；一份报告可关联多个历史成果，一份成果也可有关联的多份报告，两者不相加为成果或质量分。以下最多显示最近 20 份已记录报告采用。",
  "outcomes.quality.report":
    "报告 {id} · 采用时版本 {version} · 历史关联 {links}",
  "outcomes.quality.target":
    "原工作流 {workflowId} · 原目标 {kind}：{id} @ {version}",
  "outcomes.quality.source": "原明确来源指纹 {fingerprint}",
  "outcomes.quality.dimensions":
    "原请求维度：{dimensions}；不是人工评分或质量通过。",
  "outcomes.quality.scope":
    "原明确{mode}范围 {included} / {nonEmpty} 非空章（目录 {total} 章）",
  "outcomes.quality.scope.full": "全书",
  "outcomes.quality.scope.selected": "选章",
  "outcomes.quality.chapter": "章节 {id} @ {version} · 表达 {representations}",
  "outcomes.quality.link": "{relation}：{kind} · {id} @ {version}",
  "outcomes.quality.link.exact": "精确历史目标版本",
  "outcomes.quality.link.scope": "明确跨章范围成员（非逐章质量证明）",
  "outcomes.quality.noLinks":
    "未找到准确的已记录成果关联；不表示没有报告、没有人工成果或质量不合格。",
  "outcomes.quality.at":
    "历史采用发生于 {at}；不读取正文，不更新原报告或当前正式头。",
  "outcomes.continuation.title": "本地七天续写观察",
  "outcomes.continuation.intro":
    "当前项目以首个有完整记录的正式章节／实际第一集标准剧本固定七天观察窗。只认内容 owner 的准确上一正式版本与紧邻下一目标、引擎接受的真实 run / session；请求和空目标不是启动。重复采用不重置窗口，后续失败不抹去已发生的启动，正式采用另计。缺失旧证据不补算为零。",
  "outcomes.continuation.lag":
    "全本地继续率投影尚未追平或尚未读取，数字可能不完整。",
  "outcomes.continuation.aria.novel": "下一章七天观察",
  "outcomes.continuation.aria.adaptation": "第二集七天观察",
  "outcomes.continuation.novel": "小说下一章",
  "outcomes.continuation.adaptation": "剧本第二集",
  "outcomes.continuation.state.unobserved": "未建立观察窗（历史证据不足）",
  "outcomes.continuation.state.pending": "七天待观察",
  "outcomes.continuation.state.continued": "满窗：已真实启动续接",
  "outcomes.continuation.state.notStarted": "满窗：未记录窗内启动",
  "outcomes.continuation.state.clockInconsistent": "时钟证据异常，不进入继续率",
  "outcomes.continuation.current": "当前项目：{state}",
  "outcomes.continuation.baseline": "开始 {start} · 满窗 {deadline}",
  "outcomes.continuation.counts":
    "请求 {requests} · 真实启动 {starts} · 后续正式目标 {next} · 未关联本窗 {unlinked}",
  "outcomes.continuation.started": "窗内启动：{state}",
  "outcomes.continuation.started.within": "已记录（未满窗仍待观察）",
  "outcomes.continuation.started.outside": "窗外或时钟证据待核对",
  "outcomes.continuation.started.none": "尚未记录",
  "outcomes.continuation.cohort":
    "全本地有记录项目（非当前项目分母）：满窗继续 {continued} / {matured} · 七天继续率 {ratio}",
  "outcomes.continuation.cohort.none": "未建立满窗分母",
  "outcomes.continuation.cohort.pending":
    "待观察 {pending}（其中已提前续接 {early}）· 时钟未知 {clock} · 无完整基线 {unobserved}",
  "outcomes.continuation.cohort.unread": "全本地项目分母尚未读取，不显示为 0。",
  "outcomes.continuation.note":
    "每项目、每路各一个观察窗；小说不要求改编，直写剧本不要求小说。未满七天、来源不明与时钟异常不进入满窗分母。这是本地实际启动记录，不是公开留存率、叙事质量率或模型对比；不外发遥测。",
  "outcomes.first.title": "本地首候选与采用耗时",
  "outcomes.first.scope.requests":
    "仅统计开始记录后的目标首个实际请求。重试、重新生成、人工合并不重置首轮；历史最初请求未记录的目标不进入首稿分母。占比是截至当前的本地记录，包含待决定，不是公开采用率、文学质量或受控／真实模型对比；当前运行分类均未知。",
  "outcomes.first.scope.conflicts":
    "已核对来源冲突来自普通工作流拒绝，以及诊断、独立策略、季纲内容所有者已提交的拒绝；必须匹配原请求／AI 草稿回执并有实际来源身份、版本差异或完整全书非空章节集合增减，每个原 AI 草稿最多计一次，不是完整冲突率。缺资料、读取失败、仅目标竞争、未覆盖来源和不匹配原 AI 草稿的人工重排不补算；不证明当前有效性或文学质量。",
  "outcomes.first.scope.rejections":
    "采用被拒只统计已记录的工作流拒绝及匹配原 AI 草稿的内容所有者状态决定，重复 内容所有者回执不增加次数；不代表全部 HTTP 409、无效操作或所有历史拒绝。来源变化、目标竞争和未分类拒绝分别保留。",
  "outcomes.first.aria": "{metric}首候选",
  "outcomes.first.adopted": "{mode} {adopted} / {first} · 截至当前占比 {ratio}",
  "outcomes.first.adopted.option": "原首稿内明确选项采用",
  "outcomes.first.adopted.direct": "原首稿直接采用",
  "outcomes.first.ratio.none": "未建立分母",
  "outcomes.first.decisions":
    "待决定 {pending} · 已结束未直接采用 {closed} · 改写后采用 {revised}",
  "outcomes.first.requests":
    "实际请求 {requests} · 目标 {targets} · 首轮历史缺失 {unobserved} · 后续候选 {retries} · 采用被拒 {rejected}",
  "outcomes.first.conflicts": "已核对来源冲突候选 {count}（去重，非全部拒绝）",
  "outcomes.first.conflict.summary": "查看最近原 AI 草稿的来源变化证据",
  "outcomes.first.conflict.ids":
    "原工作流 {workflowId} · 原候选 {candidateId} · 原候选 SHA {fingerprint}",
  "outcomes.first.conflict.owner":
    "专用拒绝所有者 production · 对象类型 {type} · 决定状态版本 {version}（不是内容或工作流版本）",
  "outcomes.first.conflict.change":
    "来源 {kind} · 冻结 {frozenId}@{frozenVersion} → 实际核对 {currentId}@{currentVersion}",
  "outcomes.first.conflict.at":
    "历史拒绝发生于 {at}，不读取正文，不重新采用或认证当前来源。",
  "outcomes.first.accepted": "首个有记录的正式采用：{mode}",
  "outcomes.first.accepted.option": "明确选项 {id}（非整包采用）",
  "outcomes.first.accepted.exact": "原 AI 草稿",
  "outcomes.first.accepted.revised": "改写 AI 草稿",
  "outcomes.first.durations":
    "请求至候选 {ready} · 审阅至采用 {review} · 请求至采用 {total}",
  "outcomes.first.noTiming":
    "尚无请求、AI 草稿与正式 owner 采用完整对应的耗时证据，不补为 0。",
  "outcomes.receipt.summary": "查看不含正文的权威回执",
  "outcomes.receipt.line": "{kind} · {status} · {at}",
  "outcomes.receipt.saved": "实际保存 / 规则回执",
  "outcomes.receipt.written": "实际写入 / 原记录集合（非人工正文采用）",
  "outcomes.receipt.adopted": "正式采用 / 人工决定",
  "outcomes.receipt.object": "对象 {objectId} · {label} {versions}",
  "outcomes.receipt.version.written": "实际记录版本",
  "outcomes.receipt.version.formal": "正式版本",
  "outcomes.receipt.unit": "去重标识 {unitKey} · 模型来源未知 · 质量未独立验证",
  "outcomes.receipt.option":
    "明确选择 {id} · 原选项指纹 {fingerprint} · 不是整包原样采用",
  "outcomes.receipt.memory":
    "原章节 {id}@{version} · 源指纹 {fingerprint} · 实际写入 {count} 条记录 · 历史写入，不认证当前有效性",
  "outcomes.receipt.empty":
    "当前尚无已记录的正式采用、记忆写入或保存回执；不代表旧项目从未有成果。",
  "outcomes.receipt.more": "加载更多权威回执",
  "outcomes.source.title": "来源确认历史",
  "outcomes.source.recorded":
    "本机已记录 {recorded} 次；显示最近 {shown} 次，每次最多前 5 个原绑定，不是完整映射列表。",
  "outcomes.source.workflow.count": "{path} {total}",
  "outcomes.source.workflow.novel": "小说项目",
  "outcomes.source.workflow.adaptation": "剧本 / 改编项目",
  "outcomes.source.workflow.other": "其他项目模式",
  "outcomes.source.entry":
    "{entry} · {format} · 原解析条目 {entries} · 实际保存场景 {scenes}",
  "outcomes.source.entry.ordinary": "普通导入",
  "outcomes.source.entry.native": "原生剧本导入",
  "outcomes.source.origin":
    "原来源 {sourceId} · 原项目 {projectId} @ {version}",
  "outcomes.source.committed": "首次最终提交：{at} · {owner}",
  "outcomes.source.binding": "原条目 {index} → {kind} {id} @ {version}",
  "outcomes.source.binding.document":
    "原条目 {index} → {kind} {id} @ {version} · 原预览条目 {preview} · 剧本 {scriptId} @ {scriptVersion}",
  "outcomes.source.kind.chapter": "章节",
  "outcomes.source.kind.record": "剧本记录",
  "outcomes.source.kind.document": "剧本文档",
  "outcomes.source.fingerprints": "本机原绑定／回执指纹",
  "outcomes.source.binding.sha": "原绑定 SHA-256：{fingerprint}",
  "outcomes.source.receipt.sha": "完整原回执 SHA-256：{fingerprint}",
  "outcomes.source.loss": "原请求已声明审阅损失报告；不认证转换无损或授权。",
  "outcomes.source.note.owner":
    "只证明明确确认的解析条目已由对应 owner 保存，不是整个原文件／全文已读或语义谱系。权利声明未核验，模型来源未知、质量未验证、当前有效性未评估；显示原历史版本，不替换为当前子项。",
  "outcomes.source.note.path":
    "项目产品路径不是创建时明确目标。旧历史不补确认，不增加正式成果数、首稿采用率或七天继续率分母；无正文、文件名、路径、grant 或外部遥测。",
  "outcomes.planning.op.characters": "人物方案",
  "outcomes.planning.op.bookOutline": "全书大纲",
  "outcomes.planning.op.chapterOutline": "章节大纲",
  "outcomes.planning.op.storyArc": "故事弧",
  "outcomes.planning.op.knowledgePlan": "知识规划",
  "outcomes.planning.title": "独立故事规划批次与原请求",
  "outcomes.planning.intro":
    "人物、大纲、故事弧与知识规划独立计量，不要求小说、改编或视频；多条实际资料只算一个采用批次。原逐条规划成果与本批次单位不同，不相加。",
  "outcomes.planning.batches.missing":
    "完整规划批次凭证未记录；旧服务缺失不代表零采用。",
  "outcomes.planning.batches.recorded":
    "本机已记录 {recorded} 个采用批次；显示最近 {shown} 个，每批最多前 5 个实际记录引用及完整计数。",
  "outcomes.planning.batches.count":
    "{operation} {batches} 批 / {records} 条实际资料",
  "outcomes.planning.batch.summary":
    "{operation} · 完整采用 {count} 条 · {owner}",
  "outcomes.planning.batch.workflow":
    "原工作流 {workflowId} · 原候选 {candidateId}",
  "outcomes.planning.batch.sha": "实际采用材料 SHA-256：{fingerprint}",
  "outcomes.planning.batch.committed": "首次提交 {at} · 原事件 {eventId}",
  "outcomes.planning.batch.record": "实际原记录 {kind} {id} @ {version}",
  "outcomes.planning.funnel.missing":
    "独立原规划请求漏斗未记录；不从当前资料或旧工作流补造分母。",
  "outcomes.planning.funnel.intro":
    "每个独立原请求是一个目标；有原回执的重试沿用该目标。首候选采用比例包含待决定，不是文学质量、爆款概率或真实模型通过率。缺原请求链的采用批次 {unmatched} 个，保持未匹配。",
  "outcomes.planning.funnel.counts":
    "实际请求 {requests} · 独立目标 {targets} · 首候选 {first} · 原样采用 {adopted} · 待决定 {pending} · 关闭未原样采用 {closed} · 修改后采用 {revised} · 重试候选 {retries} · 采用被拒 {rejected}",
  "outcomes.planning.funnel.ratio": "首候选原样采用：{ratio}",
  "outcomes.planning.funnel.ratio.none": "未记录首稿，不计算",
  "outcomes.planning.funnel.ratio.value": "{adopted}/{first}（{percent}）",
  "outcomes.planning.conflicts.missing":
    "准确规划来源冲突凭证未记录；普通拒绝与旧服务缺失不推算为零或已知变化。",
  "outcomes.planning.conflicts.count":
    "已核对来源冲突候选 {count}；缺失、无法核对与其他拒绝不计入，不是完整冲突率。",
  "outcomes.planning.conflict.summary": "查看原规划 AI 草稿的准确来源差异",
  "outcomes.planning.conflict.workflow":
    "原工作流 {workflowId} · 原候选 {candidateId}",
  "outcomes.planning.conflict.sha": "原候选材料 SHA-256：{fingerprint}",
  "outcomes.planning.conflict.change":
    "{kind} · 原版本 {frozenId} @ {frozenVersion} → 当前观察 {currentId} @ {currentVersion}",
  "outcomes.planning.conflict.event": "原冲突事件 {eventId} · {at}",
  "outcomes.planning.accepted.summary": "查看首次实际采用凭证与耗时",
  "outcomes.planning.accepted.ids":
    "原工作流 {workflowId} · 候选 {candidateId} · 采用事件 {eventId}",
  "outcomes.planning.accepted.times":
    "{mode} · 请求到候选 {ready} · 候选到采用 {adopt} · 请求到采用 {total}",
  "outcomes.planning.accepted.exact": "原样完整采用",
  "outcomes.planning.accepted.revised": "修改材料后采用",
  "outcomes.planning.note":
    "只证明内容所有者实际提交的历史批次与原请求链；模型来源未知、质量未验证，不认证当前资料、全文覆盖或权利。旧历史不回填；无正文、标题、路径、凭据或外部遥测。",
  "outcomes.exec.state.missing": "原记录缺失（未知，不等于零）",
  "outcomes.exec.state.unavailable": "原读取能力暂不可用",
  "outcomes.exec.state.readFailed": "原记录读取失败（不换最新，不补零）",
  "outcomes.exec.phase.generating": "生成",
  "outcomes.exec.phase.checking": "检查",
  "outcomes.exec.phase.revising": "修订",
  "outcomes.exec.phase.rechecking": "复检",
  "outcomes.exec.stats.title": "原尝试配置分组与运行统计",
  "outcomes.exec.stats.intro":
    "仅此原工作流的阶段，按原引擎及请求模型／服务／配置档精确归组；不是实际模型版本分组或项目成功率。耗时范围只含有原起止时间的阶段，不是工作流总耗时；未结束、缺失和异常不补零。",
  "outcomes.exec.stats.none": "{state}；没有统计分母。",
  "outcomes.exec.stats.counts":
    "回执运行身份 {runs} · 已记录阶段 {recorded} · 缺失身份 {missing} · 已记录修订阶段 {revisions}（不等于达到采用所需的局部修订次数）",
  "outcomes.exec.stats.noRuns": "此尝试尚无运行身份，不视为成功。",
  "outcomes.exec.stats.missingRun": "缺失原运行 {id}：阶段、配置和耗时未知。",
  "outcomes.exec.group.aria": "原请求配置组 {index}",
  "outcomes.exec.group.line": "组 {index} · 引擎 {engine} · {model}",
  "outcomes.exec.group.model":
    "请求模型 {model} · 原服务 {provider} · 原配置档 {profile}",
  "outcomes.exec.group.model.invalid": "原模型配置无效",
  "outcomes.exec.group.model.unrecorded": "原模型配置未记录",
  "outcomes.exec.group.timing":
    "本组 {runs} 阶段 · 可核耗时 {measured}/{runs} · 尚未结束 {inProgress} · 起止未记录 {unrecorded} · 时钟异常 {invalid} · 已知阶段耗时范围 {range}",
  "outcomes.exec.group.range": "{min}–{max} 毫秒",
  "outcomes.exec.group.run": "{phase} · {status} · 原运行 {runId}",
  "outcomes.exec.workflow.aria": "原工作流运行关联",
  "outcomes.exec.workflow.line":
    "原工作流 {workflowId} · 操作 {operation} · 原请求事件 {eventId}",
  "outcomes.exec.workflow.request":
    "实际尝试 {attempt} · {kind} · 原请求时间 {at}",
  "outcomes.exec.workflow.request.parent":
    "实际尝试 {attempt} · {kind} · 原请求时间 {at} · 原父工作流 {parent}",
  "outcomes.exec.workflow.lag": "投影尚未追平或异常；已记录事实可能不完整。",
  "outcomes.exec.workflow.note":
    "只展示精确原请求与原阶段。下列模型是运行发生时记录的请求配置，不证明服务实际使用的模型版本。模型来源未知、质量未核验、账单与结算未知；没有汇总 Token、累计报告或不同币种费用。",
  "outcomes.exec.history.aria": "工作流历史事实",
  "outcomes.exec.history.line": "事件 {eventId} · 游标 {cursor} · {kind}",
  "outcomes.exec.history.candidate": " · 原候选 {id} · 指纹 {fingerprint}",
  "outcomes.exec.history.formal": " · 正式版本 {versions}",
  "outcomes.exec.history.batch": " · 完整采用批次 {count} 项",
  "outcomes.exec.noRuns": "此原尝试尚没有运行身份；不是成功或零用量。",
  "outcomes.exec.run.missing": "原运行 {runId}：{state}；未推测阶段或成功。",
  "outcomes.exec.run.aria": "原{phase}阶段",
  "outcomes.exec.run.line":
    "{phase} · 原运行 {runId} · 会话 {sessionId} · 引擎 {engine} · 实际状态 {status}",
  "outcomes.exec.run.context": "原上下文 {context} · 请求模型 {model}",
  "outcomes.exec.run.model": "{model}（原服务 {provider}）",
  "outcomes.exec.run.timing": "阶段耗时：{timing}",
  "outcomes.exec.run.timing.measured": "{ms} 毫秒（原起止时间）",
  "outcomes.exec.run.timing.running": "尚未结束，不补当前耗时",
  "outcomes.exec.run.timing.invalid": "原时钟记录异常",
  "outcomes.exec.run.timing.unrecorded": "原起止时间未记录",
  "outcomes.exec.run.noUsage": "用量关联未记录",
  "outcomes.exec.detail.loading": "正在读取原工作流…",
  "outcomes.exec.detail.error":
    "原运行读取失败：{error}；不显示旧读数作为成功。",
  "outcomes.exec.detail.older": "读取更早的原工作流事实",
  "outcomes.exec.detail.usage": "单独读取原{phase}阶段全部用量分页",
  "outcomes.exec.detail.reload": "重新读取原工作流",
  "outcomes.exec.aria": "本地原请求与运行台账",
  "outcomes.exec.title": "本地原请求与运行关联",
  "outcomes.exec.intro":
    "包括已记录的失败、重试和规划请求；没有原请求的历史资料不补入。不是成果数、模型质量或账单。",
  "outcomes.exec.read": "读取原请求台账",
  "outcomes.exec.error": "原请求读取失败：{error}；不视为没有请求。",
  "outcomes.exec.lag": "原请求投影未追平或异常；本页不代表完整历史。",
  "outcomes.exec.item": "{operation} · 原工作流 {workflowId}",
  "outcomes.exec.empty": "没有已记录的原请求；不等于历史没有创作。",
  "outcomes.exec.older": "读取更早的原请求",
  "outcomes.usage.scope.response": "单响应报告（增量）",
  "outcomes.usage.scope.run": "运行累计报告",
  "outcomes.usage.scope.session": "会话累计报告（不是本次运行用量）",
  "outcomes.usage.scope.unspecified": "计量口径未指定",
  "outcomes.usage.token.invalid": "报告值无效",
  "outcomes.usage.token.unreported": "未报告",
  "outcomes.usage.aria": "引擎用量观测",
  "outcomes.usage.run": "原运行 {runId} · 当前读取时共 {count} 条观测",
  "outcomes.usage.scopeLine":
    "发生时范围：{scope}；对话后来绑定项目不会改写旧报告归属。",
  "outcomes.usage.scope.project": "项目 {projectId}",
  "outcomes.usage.scope.global": "未绑定项目的全局运行",
  "outcomes.usage.empty": "没有已保存的报告，用量未知；不等于零。",
  "outcomes.usage.item.scope": "{scope} · 游标 {cursor}",
  "outcomes.usage.item.tokens":
    "输入 {input} · 输出 {output} · 缓存读取 {cached}",
  "outcomes.usage.cost":
    "引擎报告费用估值：{amount} · {currency}；不是报价、账单或结算，不按 Token／当前单价补算或合计。",
  "outcomes.usage.amount.invalid": "报告值无效",
  "outcomes.usage.amount.unreported": "金额未报告",
  "outcomes.usage.currency.invalid": "币种报告无效",
  "outcomes.usage.currency.unreported": "币种未报告",
  "outcomes.usage.noCost":
    "本条没有已记录的费用估值；不补造历史金额或币种，结算未知。",
  "outcomes.usage.accounting": "输入口径：{accounting} · 保存时间 {at}",
  "outcomes.usage.accounting.includes": "包含缓存",
  "outcomes.usage.accounting.excludes": "不包含缓存",
  "outcomes.usage.accounting.unspecified": "缓存包含关系未指定",
  "outcomes.usage.note":
    "仅为引擎自行报告，覆盖可能不完整，未合计为本次运行总量。运行来源分类未知，费用与结算未知；不是实际付费、提效或文学质量证明。",
  "outcomes.usage.panel": "运行用量只读记录",
  "outcomes.usage.load.pending": "正在读取用量报告…",
  "outcomes.usage.load.again": "重新读取原运行用量报告",
  "outcomes.usage.load.first": "查看原运行用量报告",
  "outcomes.usage.error": "{error} 上次记录仅作历史查看，不自动换运行或重试。",
  "outcomes.usage.foreign": "用量会话或引擎不属于原阶段；未显示外来报告。",
  "outcomes.usage.changed": "原分页身份已变化，请明确重新读取该运行。",
  "outcomes.usage.older": "读取更早用量观测",
  "outcomes.funnel.state.missing": "最初原工作流回执缺失",
  "outcomes.funnel.state.unavailable": "最初原回执读取能力不可用",
  "outcomes.funnel.state.readFailed": "最初原回执读取失败",
  "outcomes.funnel.state.missingRun": "最初生成阶段未记录，配置未知",
  "outcomes.funnel.state.unobserved": "最初请求未记录，不借重试配置补算",
  "outcomes.funnel.model": "{model} · 服务 {provider} · 配置档 {profile}",
  "outcomes.funnel.result": "全项目原请求配置漏斗结果",
  "outcomes.funnel.head":
    "检查点 {checkpoint} · 已记录原工作流 {workflows} · 原目标 {targets}",
  "outcomes.funnel.lag":
    "投影尚未追平或异常；完整读取了已记录页，不代表完整业务历史。",
  "outcomes.funnel.empty": "没有已记录原请求；不等于历史没有创作。",
  "outcomes.funnel.group.aria": "原配置漏斗组 {index}",
  "outcomes.funnel.group.line": "组 {index} · {family} · {configuration}",
  "outcomes.funnel.family.planning": "独立小说规划",
  "outcomes.funnel.family.creation": "小说章节／改编",
  "outcomes.funnel.configuration": "原生成引擎 {engine} · 请求模型 {model}",
  "outcomes.funnel.row.head":
    "{name} · 原请求 {requests} · 目标 {targets} · 最初请求未记录 {unobserved}",
  "outcomes.funnel.row.first":
    "首候选 {first} · 原候选直接采用 {adopted} · 待决定 {pending} · 已关闭未直接采用 {closed} · 修改后采用 {revised} · 重试候选 {retries}",
  "outcomes.funnel.row.ratio": "截至此检查点首候选直接采用 {ratio}",
  "outcomes.funnel.row.ratio.none": "分母未建立",
  "outcomes.funnel.row.ratio.value":
    "{adopted}/{first}（包含待决定，不是公开模型采用率）",
  "outcomes.funnel.row.accepted":
    "本组首次正式采用事件 {eventId} · 原工作流 {workflowId} · 请求到可审候选 {ready} 毫秒 · 请求到正式采用 {adopt} 毫秒 · 时钟 {clock}",
  "outcomes.funnel.group.ids": "本组最初锚点与全部原尝试身份",
  "outcomes.funnel.group.anchors": "最初已观察请求：{ids}",
  "outcomes.funnel.group.all":
    "全部原工作流（包含重试，不表示全部使用本组配置）：{ids}",
  "outcomes.funnel.title": "全项目原请求配置漏斗",
  "outcomes.funnel.intro":
    "明确读取全部已记录原请求及各工作流事实分页，逐项只读，可能需要等待。按每个目标最初请求的生成阶段配置字段归组；后续换模型重试不重置目标。不是完整超参数或实际模型版本分组；来源未知、质量未核验、费用结算未知，不汇总Token／费用，也不把首次人工采用当文学质量。小说和独立规划分别保留，未记录的旧资料不补入。",
  "outcomes.funnel.read": "读取全项目原配置漏斗",
  "outcomes.funnel.stop": "停止本次读取",
  "outcomes.funnel.pending": "正在完整读取原配置漏斗；不显示部分结果或旧分母…",
  "outcomes.funnel.error":
    "原配置漏斗读取失败：{error}；没有部分分母，请明确重读。",
  "outcomes.revision.result": "首次章节采用前修订结果",
  "outcomes.revision.head": "检查点 {checkpoint} · 已记录章节目标 {targets}",
  "outcomes.revision.lag": "投影尚未追平或异常；不是完整业务历史。",
  "outcomes.revision.empty": "没有已记录章节请求，不等于历史没有修订。",
  "outcomes.revision.target": "原目标 {key}",
  "outcomes.revision.updates":
    "已观察正文修改 {updates} 次 · 显式合并 {rebases} 次（正文变化 {changing} 次）",
  "outcomes.revision.state.pending": "尚无可关联的正式采用；总数未建立",
  "outcomes.revision.state.unknown": "已正式采用，但历史不完整；总数未知",
  "outcomes.revision.state.measured": "首次正式采用前局部正文修订 {count} 次",
  "outcomes.revision.adoption":
    "原采用事件 {eventId} · 章节 {chapterId} v{version} · 原工作流 {workflowId}",
  "outcomes.revision.ids": "全部原请求身份",
  "outcomes.revision.note":
    "只统计首次已记录正式采用事件之前实际保存的正文变化，保留放弃、失败及重试 AI 草稿；采用后的变化不并入。 相同保存不多计，缺旧历史不补零。模型修订阶段、未保存操作及人工工作量不包含，不证明文学质量。 当前为小说章节，可另行读取按最初请求配置分组的修订统计；改编／规划修订另行推进。",
  "outcomes.revision.grouped.result": "原配置章节修订结果",
  "outcomes.revision.grouped.head":
    "检查点 {checkpoint} · 章节目标 {targets} · 原尝试 {workflows}",
  "outcomes.revision.grouped.empty": "没有已记录章节目标；不是历史零修订。",
  "outcomes.revision.grouped.aria": "原配置章节修订组 {index}",
  "outcomes.revision.grouped.configuration": "最初生成配置：{configuration}",
  "outcomes.revision.grouped.engine": "引擎 {engine} · 请求模型 {model}",
  "outcomes.revision.grouped.unknown": "配置未知（{state}）",
  "outcomes.revision.grouped.summary":
    "已可核采用 {measured} / 目标 {targets} · 已采用历史未知 {unknown} · 尚未采用 {pending}",
  "outcomes.revision.grouped.mean":
    "可核采用目标修订范围 {minimum}–{maximum} 次 · 均值 {numerator}/{denominator} 次（精确分数）",
  "outcomes.revision.grouped.mean.none":
    "可核修订均值未建立；未知及未采用不补零",
  "outcomes.revision.grouped.ids": "本组原目标与尝试／采用身份",
  "outcomes.revision.grouped.item":
    "原目标 {key} · 原工作流 {workflows} · 原采用 {eventId} · 总修订 {count}",
  "outcomes.revision.grouped.note":
    "按每目标最初生成请求字段归组；换模型重试仍留原组，不表示所有尝试均使用本组模型。仅完整已采用历史参加均值，未知与未采用独列，不是模型质量、实际远端版本、完整超参数、人工工作量或账单。模型修订阶段不包含；改编／规划另行推进。",
  "outcomes.revision.title": "首次章节采用前实际修订",
  "outcomes.revision.read": "读取首次章节采用前修订",
  "outcomes.revision.read.pending": "正在核对完整原修订分页…",
  "outcomes.revision.readGrouped": "读取按原配置分组的章节修订",
  "outcomes.revision.stop": "停止本次修订读取",
  "outcomes.revision.error":
    "{error} 原读取失败，不显示部分分页、旧结果或推定零。",
  "outcomes.delivery.coverage.result": "正式采用版本交付覆盖结果",
  "outcomes.delivery.coverage.head": "原检查点 {checkpoint}",
  "outcomes.delivery.coverage.aria.novel": "小说章节版本交付",
  "outcomes.delivery.coverage.aria.adaptation": "改编剧本版本交付",
  "outcomes.delivery.coverage.title.novel": "小说章节版本 → 已保存稿件",
  "outcomes.delivery.coverage.title.adaptation":
    "改编剧本版本 → 已保存内部试制包",
  "outcomes.delivery.coverage.counts":
    "已记录正式采用 {adopted} · 同版本采用后保存 {delivered} · 尚无匹配保存 {notSaved}",
  "outcomes.delivery.coverage.ratio":
    "采用版本交付覆盖 {numerator}/{denominator}（精确分数）",
  "outcomes.delivery.coverage.ratio.none":
    "没有已记录采用版本；覆盖率未建立，不补零",
  "outcomes.delivery.coverage.unlinked":
    "已保存但缺此前采用关联的版本 {count}（不加入成功分子）",
  "outcomes.delivery.coverage.items": "原版本与采用／保存回执",
  "outcomes.delivery.coverage.item":
    "原版本 {id} v{version} · 采用 {adoption} · 保存 {saved} · 独立保存版本集合 {units}",
  "outcomes.delivery.coverage.note":
    "仅按已记录owner事件顺序关联同一正式版本；重复保存、换格式不增加采用版本分子。旧版保存不能替代新版，保存时缺此前采用不补关联。不是当前有效性、质量、授权、实际投稿或发行通过；小说不要求改编／媒体，改编试制包不要求媒体。",
  "outcomes.delivery.window.result": "七天交付与采用后保存耗时",
  "outcomes.delivery.window.head":
    "固定UTC观察窗 {from} → {to}（含边界，不是自然周）",
  "outcomes.delivery.window.path.novel": "小说章节正式版本",
  "outcomes.delivery.window.path.adaptation": "改编剧本正式版本",
  "outcomes.delivery.window.counts":
    "{path} · 本窗新增采用 {adopted} · 本窗首次匹配保存 {delivered}",
  "outcomes.delivery.window.measured":
    "可核采用到Host保存 {measured} · 尚无匹配保存 {pending} · 时钟异常／未来证据 {clock}",
  "outcomes.delivery.window.duration":
    "已知历史耗时范围 {minimum}–{maximum} 毫秒 · 精确均值 {numerator}/{denominator} 毫秒",
  "outcomes.delivery.window.duration.none": "采用后保存耗时未知，不补零",
  "outcomes.delivery.window.items": "原版本时间观察",
  "outcomes.delivery.window.item":
    "原版本 {id} v{version} · 原采用 {adoption} · 首次保存 {saved} · {clock} · {reason} · 耗时 {duration}",
  "outcomes.delivery.window.clockOk": "原时钟可核",
  "outcomes.delivery.window.note":
    "新增采用与首次匹配保存是两个跨期计数，不能相除为本周转化率；重复导出不刷新首次时间。耗时只含可核的原采用到首次Host保存，包含人工审阅／等待，不是模型生成速度、全任务耗时或文学质量。旧历史、未来／倒退及回执时钟异常不补零；不认证当前有效性、授权、投稿或发行。",
  "outcomes.delivery.title": "正式采用与保存的同版本交付覆盖",
  "outcomes.delivery.intro":
    "明确读取完整本地台账，小说与改编分开核同版本；不启动模型、采用或导出。",
  "outcomes.delivery.read": "读取采用版本交付覆盖",
  "outcomes.delivery.readWindow": "读取七天交付与保存耗时",
  "outcomes.delivery.pending": "正在读取全部原台账…",
  "outcomes.delivery.stop": "停止读取交付覆盖",
  "outcomes.delivery.error":
    "原交付覆盖读取失败：{error}。不保留旧结果或部分分母。",
};

/** English copy for the same keys. */
export const outcomesEn: Record<keyof typeof outcomesZh, string> = {
  "outcomes.title": "Local creative outcomes ledger",
  "outcomes.refresh": "Refresh the outcomes ledger",
  "outcomes.intro":
    "Counts only what you formally adopted, wrote to memory and saved; the data stays on this machine.",
  "outcomes.scope.summary": "What is counted",
  "outcomes.scope.counts":
    "Formal adoptions, chapter-derived memory writes and saves matched by an integrity receipt are counted apart. Novel and script count separately; replaying, re-saving, reformatting or retrying the same version set adds nothing, and AI drafts or page clicks never count.",
  "outcomes.scope.facts":
    "These are local historical facts, not the quality of the current version, a rights check or a hit forecast. Only authoritative events after recording began are included, nothing is back-filled, and no text, prompt or ledger is sent to an outside analytics service.",
  "outcomes.scope.memory":
    "A memory write counts once per recorded set and never toward manual adoption or first-draft adoption. Automatic sync and separate review keep their own flows; this count does not certify the trigger, current validity or semantic correctness.",
  "outcomes.error":
    "The outcomes ledger could not be read: {error}. A failed read is not the same as no outcomes.",
  "outcomes.loading": "Reading the local outcomes ledger…",
  "outcomes.lag":
    "The outcomes projection has not caught up or failed to read; the numbers may be incomplete. Refresh later.",
  "outcomes.list": ", ",
  "outcomes.separator": " · ",
  "outcomes.none": "none",
  "outcomes.unrecorded": "unrecorded",
  "outcomes.unknown": "unknown",
  "outcomes.notYet": "not recorded yet",
  "outcomes.ms": "{ms} ms",
  "outcomes.model.invalid": "original configuration invalid",
  "outcomes.model.unrecorded": "original configuration unrecorded",
  "outcomes.duration.unknown": "unknown (clock inconsistent)",
  "outcomes.duration.seconds": "{value} s",
  "outcomes.kind.chapterAdopted": "Adopted formal chapter versions",
  "outcomes.kind.planningAdopted":
    "Adopted character / outline / story arc versions",
  "outcomes.kind.memoryWritten": "Chapter-derived memory write batches",
  "outcomes.kind.manuscriptExported": "Saved manuscript version sets",
  "outcomes.kind.diagnosisAdopted": "Adopted diagnosis versions",
  "outcomes.kind.strategyAdopted":
    "Explicitly chosen adaptation strategy versions",
  "outcomes.kind.seasonPlanAdopted": "Adopted season plan versions",
  "outcomes.kind.scriptAdopted": "Adopted standard script versions",
  "outcomes.kind.pilotExported": "Saved internal pilot package version sets",
  "outcomes.metric.chapter": "Novel chapter",
  "outcomes.metric.diagnosis": "Adaptation diagnosis",
  "outcomes.metric.strategy": "Adaptation strategy",
  "outcomes.metric.seasonPlan": "Season plan",
  "outcomes.metric.script": "Standard episode script",
  "outcomes.chapters.aria": "Change in the book's chapter set",
  "outcomes.chapters.counts":
    "Writing full non-empty chapter catalogue: {frozen} frozen → {current} checked (not a catalogue version)",
  "outcomes.chapters.added": "Chapter references that entered the scope: {ids}",
  "outcomes.chapters.left": "Chapter references that left the scope: {ids}",
  "outcomes.chapters.note":
    "Only the full catalogue observed at the rejection; an emptied chapter can leave the scope, which is not a deletion, a read of the text, a current grant or narrative quality.",
  "outcomes.goal.title": "Initial creative goal confirmations",
  "outcomes.goal.choice":
    "Goal chosen at creation: {goal} · material: {material}",
  "outcomes.goal.novelFirst": "Novel first",
  "outcomes.goal.scriptFirst": "Script first",
  "outcomes.goal.material.inspiration": "Idea",
  "outcomes.goal.material.sourceImport": "Novel / outline",
  "outcomes.goal.material.script": "Existing script",
  "outcomes.goal.origin":
    "Original project {projectId} @ {version} · confirmed at {at}",
  "outcomes.goal.note":
    "Describes only the explicit initial choice of the actual creation request, not the author's current intent, an identity check, a grant or a quality score; the model source is unknown. Old projects and default suggestions are not confirmed after the fact and add nothing to outcomes or adoption denominators.",
  "outcomes.counts.novel": "Novel outcomes",
  "outcomes.counts.adaptation": "Script / adaptation outcomes",
  "outcomes.counts.line": "Total {total} · last 7 days {recent}",
  "outcomes.counts.note":
    "The last 7 days is a rolling window counted at each outcome's first authoritative receipt, not a calendar week. The 7-day continuation rate uses its own fixed full-window project denominator and does not mix with these rolling counts. Real model usage, cost and narrative quality are not computed; the model source is unknown and is not inferred from the engine name, and manual adoption or rule checks are not evidence of model quality.",
  "outcomes.quality.title": "Quality report history links",
  "outcomes.quality.counts":
    "Recorded report adoptions {recorded} · exact target links {exact} · explicit cross-chapter scope links {scope} · not linked to a recorded outcome {unlinked}",
  "outcomes.quality.note":
    "Only report adoption receipts recorded after recording began and their exact historical versions; older reports are not back-filled. Adopting a report, accepting a risk or resolving an issue is not a literary quality pass; the model source, current report validity and narrative quality stay unknown. A cross-chapter scope member is not a chapter-by-chapter read and is no quality denominator. Ordinarily saved scripts and scenes with other identities or fingerprints are not approximated as episode outcomes.",
  "outcomes.quality.units":
    "Linked outcome units {units}. One report can link several historical outcomes and one outcome several reports; neither adds up to outcomes or a quality score. At most the latest 20 recorded report adoptions are shown.",
  "outcomes.quality.report":
    "Report {id} · version at adoption {version} · history links {links}",
  "outcomes.quality.target":
    "Original workflow {workflowId} · original target {kind}: {id} @ {version}",
  "outcomes.quality.source":
    "Original explicit source fingerprint {fingerprint}",
  "outcomes.quality.dimensions":
    "Requested dimensions: {dimensions}; not a manual score or a quality pass.",
  "outcomes.quality.scope":
    "Original explicit {mode} scope {included} / {nonEmpty} non-empty chapters ({total} in the catalogue)",
  "outcomes.quality.scope.full": "whole book",
  "outcomes.quality.scope.selected": "selected chapters",
  "outcomes.quality.chapter":
    "Chapter {id} @ {version} · representations {representations}",
  "outcomes.quality.link": "{relation}: {kind} · {id} @ {version}",
  "outcomes.quality.link.exact": "Exact historical target version",
  "outcomes.quality.link.scope":
    "Explicit cross-chapter scope member (no per-chapter quality proof)",
  "outcomes.quality.noLinks":
    "No exact link to a recorded outcome; this does not mean there is no report, no manual outcome or a failed quality check.",
  "outcomes.quality.at":
    "Adopted at {at}; no text is read and neither the report nor the current formal head is updated.",
  "outcomes.continuation.title": "Local seven-day continuation",
  "outcomes.continuation.intro":
    "This project's seven-day window starts at its first fully recorded formal chapter or actual first standard episode script. Only the content owner's exact previous formal version, the immediate next target and a real run or session the engine accepted count; a request or an empty target is not a start. Re-adopting does not reset the window, a later failure does not erase a start that happened, and formal adoption counts apart. Missing old evidence is not counted as zero.",
  "outcomes.continuation.lag":
    "The local continuation projection has not caught up or was not read; the numbers may be incomplete.",
  "outcomes.continuation.aria.novel": "Next chapter seven-day window",
  "outcomes.continuation.aria.adaptation": "Second episode seven-day window",
  "outcomes.continuation.novel": "Novel next chapter",
  "outcomes.continuation.adaptation": "Script second episode",
  "outcomes.continuation.state.unobserved": "No window (not enough history)",
  "outcomes.continuation.state.pending": "Seven days pending",
  "outcomes.continuation.state.continued": "Full window: continuation started",
  "outcomes.continuation.state.notStarted":
    "Full window: no start recorded in it",
  "outcomes.continuation.state.clockInconsistent":
    "Clock evidence inconsistent; excluded from the rate",
  "outcomes.continuation.current": "This project: {state}",
  "outcomes.continuation.baseline": "Start {start} · window ends {deadline}",
  "outcomes.continuation.counts":
    "Requests {requests} · real starts {starts} · later formal targets {next} · not linked to this window {unlinked}",
  "outcomes.continuation.started": "Start within the window: {state}",
  "outcomes.continuation.started.within":
    "recorded (still pending until the window is full)",
  "outcomes.continuation.started.outside":
    "outside the window or clock evidence to check",
  "outcomes.continuation.started.none": "not recorded yet",
  "outcomes.continuation.cohort":
    "All local recorded projects (not this project's denominator): continued {continued} / {matured} full windows · seven-day rate {ratio}",
  "outcomes.continuation.cohort.none": "no full-window denominator",
  "outcomes.continuation.cohort.pending":
    "Pending {pending} ({early} already continued) · clock unknown {clock} · no full baseline {unobserved}",
  "outcomes.continuation.cohort.unread":
    "The local project denominator has not been read; it is not shown as 0.",
  "outcomes.continuation.note":
    "One window per project and path; a novel needs no adaptation and a direct script needs no novel. Windows under seven days, of unknown source or with clock problems stay out of the denominator. This is a local record of real starts, not a public retention rate, narrative quality rate or model comparison; no telemetry leaves the machine.",
  "outcomes.first.title": "Local first candidates and adoption time",
  "outcomes.first.scope.requests":
    "Only each target's first actual request after recording began. Retries, regenerations and manual merges do not reset the first round; targets whose first request was not recorded stay out of the first-draft denominator. The share is the local record so far, includes pending decisions, and is not a public adoption rate, literary quality or a controlled or real model comparison; run classifications are unknown.",
  "outcomes.first.scope.conflicts":
    "Checked source conflicts come from ordinary workflow rejections and from rejections the diagnosis, strategy and season plan owners committed. Each must match the original request and AI draft receipts and show a real source identity, a version difference or a change in the book's non-empty chapter set; each original AI draft counts at most once, and this is not a full conflict rate. Missing material, failed reads, target-only contention, uncovered sources and manual reorders that match no AI draft are not added; nothing here proves current validity or literary quality.",
  "outcomes.first.scope.rejections":
    "Adoption rejections count only recorded workflow rejections and content owner decisions matching the original AI draft; a repeated owner receipt adds nothing. They do not stand for every HTTP 409, invalid action or past rejection. Source changes, target contention and unclassified rejections are kept apart.",
  "outcomes.first.aria": "{metric} first candidate",
  "outcomes.first.adopted": "{mode} {adopted} / {first} · share so far {ratio}",
  "outcomes.first.adopted.option":
    "Explicit option adopted from the first draft",
  "outcomes.first.adopted.direct": "First draft adopted directly",
  "outcomes.first.ratio.none": "no denominator",
  "outcomes.first.decisions":
    "Pending {pending} · closed without direct adoption {closed} · adopted after rewriting {revised}",
  "outcomes.first.requests":
    "Actual requests {requests} · targets {targets} · first round missing {unobserved} · later candidates {retries} · adoption rejected {rejected}",
  "outcomes.first.conflicts":
    "Checked source conflict candidates {count} (deduplicated, not every rejection)",
  "outcomes.first.conflict.summary":
    "See the source change evidence of the latest original AI drafts",
  "outcomes.first.conflict.ids":
    "Original workflow {workflowId} · original candidate {candidateId} · candidate SHA {fingerprint}",
  "outcomes.first.conflict.owner":
    "Rejecting owner production · object type {type} · decision state version {version} (not a content or workflow version)",
  "outcomes.first.conflict.change":
    "Source {kind} · frozen {frozenId}@{frozenVersion} → checked {currentId}@{currentVersion}",
  "outcomes.first.conflict.at":
    "Rejected at {at}; no text is read and the current source is neither re-adopted nor certified.",
  "outcomes.first.accepted": "First recorded formal adoption: {mode}",
  "outcomes.first.accepted.option":
    "explicit option {id} (not the whole package)",
  "outcomes.first.accepted.exact": "original AI draft",
  "outcomes.first.accepted.revised": "rewritten AI draft",
  "outcomes.first.durations":
    "Request to candidate {ready} · review to adoption {review} · request to adoption {total}",
  "outcomes.first.noTiming":
    "No timing evidence yet that links a request, an AI draft and the owner's formal adoption; not shown as 0.",
  "outcomes.receipt.summary": "See the authoritative receipts (no text)",
  "outcomes.receipt.line": "{kind} · {status} · {at}",
  "outcomes.receipt.saved": "Actually saved / rule receipt",
  "outcomes.receipt.written":
    "Actually written / original record set (not a manual text adoption)",
  "outcomes.receipt.adopted": "Formally adopted / manual decision",
  "outcomes.receipt.object": "Object {objectId} · {label} {versions}",
  "outcomes.receipt.version.written": "recorded versions",
  "outcomes.receipt.version.formal": "formal versions",
  "outcomes.receipt.unit":
    "Dedup key {unitKey} · model source unknown · quality not independently verified",
  "outcomes.receipt.option":
    "Explicit choice {id} · option fingerprint {fingerprint} · not the whole package as-is",
  "outcomes.receipt.memory":
    "Source chapter {id}@{version} · source fingerprint {fingerprint} · {count} records written · historical write, current validity not certified",
  "outcomes.receipt.empty":
    "No formal adoption, memory write or save receipt recorded yet; this does not mean an older project never had outcomes.",
  "outcomes.receipt.more": "Load more authoritative receipts",
  "outcomes.source.title": "Source confirmation history",
  "outcomes.source.recorded":
    "{recorded} recorded on this machine; the latest {shown} are shown, each with at most its first 5 bindings, not the full mapping.",
  "outcomes.source.workflow.count": "{path} {total}",
  "outcomes.source.workflow.novel": "Novel projects",
  "outcomes.source.workflow.adaptation": "Script / adaptation projects",
  "outcomes.source.workflow.other": "Other project modes",
  "outcomes.source.entry":
    "{entry} · {format} · parsed entries {entries} · scenes saved {scenes}",
  "outcomes.source.entry.ordinary": "Ordinary import",
  "outcomes.source.entry.native": "Native script import",
  "outcomes.source.origin":
    "Original source {sourceId} · original project {projectId} @ {version}",
  "outcomes.source.committed": "First final commit: {at} · {owner}",
  "outcomes.source.binding": "Entry {index} → {kind} {id} @ {version}",
  "outcomes.source.binding.document":
    "Entry {index} → {kind} {id} @ {version} · preview entry {preview} · script {scriptId} @ {scriptVersion}",
  "outcomes.source.kind.chapter": "chapter",
  "outcomes.source.kind.record": "script record",
  "outcomes.source.kind.document": "script document",
  "outcomes.source.fingerprints":
    "Binding and receipt fingerprints on this machine",
  "outcomes.source.binding.sha": "Binding SHA-256: {fingerprint}",
  "outcomes.source.receipt.sha": "Full receipt SHA-256: {fingerprint}",
  "outcomes.source.loss":
    "The request declared a reviewed loss report; this does not certify a lossless conversion or a grant.",
  "outcomes.source.note.owner":
    "Proves only that the explicitly confirmed parsed entries were saved by their owners, not that the whole file or text was read or a semantic lineage. Rights claims are unchecked, the model source unknown, quality unverified and current validity unassessed; the original historical versions are shown, not today's.",
  "outcomes.source.note.path":
    "The project's product path is not the goal chosen at creation. Old history is not confirmed after the fact and adds nothing to outcomes, first-draft adoption or the continuation denominator; no text, file name, path, grant or outside telemetry.",
  "outcomes.planning.op.characters": "Characters",
  "outcomes.planning.op.bookOutline": "Book outline",
  "outcomes.planning.op.chapterOutline": "Chapter outline",
  "outcomes.planning.op.storyArc": "Story arc",
  "outcomes.planning.op.knowledgePlan": "Knowledge plan",
  "outcomes.planning.title": "Story planning batches and original requests",
  "outcomes.planning.intro":
    "Characters, outlines, story arcs and knowledge plans are measured on their own and need no novel, adaptation or video; several records count as one adoption batch. The per-item planning outcomes use another unit and are not added.",
  "outcomes.planning.batches.missing":
    "Full planning batch receipts are not recorded; a missing old service does not mean zero adoptions.",
  "outcomes.planning.batches.recorded":
    "{recorded} adoption batches recorded on this machine; the latest {shown} are shown, each with at most its first 5 record references and full counts.",
  "outcomes.planning.batches.count":
    "{operation} {batches} batches / {records} records",
  "outcomes.planning.batch.summary":
    "{operation} · {count} adopted in full · {owner}",
  "outcomes.planning.batch.workflow":
    "Original workflow {workflowId} · original candidate {candidateId}",
  "outcomes.planning.batch.sha": "Adopted material SHA-256: {fingerprint}",
  "outcomes.planning.batch.committed":
    "First committed {at} · original event {eventId}",
  "outcomes.planning.batch.record": "Original record {kind} {id} @ {version}",
  "outcomes.planning.funnel.missing":
    "The planning request funnel is not recorded; no denominator is made up from current material or old workflows.",
  "outcomes.planning.funnel.intro":
    "Each original request is one target; a retry with the original receipt keeps it. The first-candidate share includes pending decisions and is not literary quality, a hit probability or a real model pass rate. {unmatched} adoption batches without a request chain stay unmatched.",
  "outcomes.planning.funnel.counts":
    "Actual requests {requests} · targets {targets} · first candidates {first} · adopted as-is {adopted} · pending {pending} · closed without adoption {closed} · adopted after changes {revised} · retry candidates {retries} · adoption rejected {rejected}",
  "outcomes.planning.funnel.ratio": "First candidate adopted as-is: {ratio}",
  "outcomes.planning.funnel.ratio.none":
    "no first draft recorded; not computed",
  "outcomes.planning.funnel.ratio.value": "{adopted}/{first} ({percent})",
  "outcomes.planning.conflicts.missing":
    "Exact planning source conflict receipts are not recorded; ordinary rejections and a missing old service are not read as zero or as a known change.",
  "outcomes.planning.conflicts.count":
    "Checked source conflict candidates {count}; missing, uncheckable and other rejections are excluded, so this is not a full conflict rate.",
  "outcomes.planning.conflict.summary":
    "See the exact source difference of the original planning AI draft",
  "outcomes.planning.conflict.workflow":
    "Original workflow {workflowId} · original candidate {candidateId}",
  "outcomes.planning.conflict.sha": "Candidate material SHA-256: {fingerprint}",
  "outcomes.planning.conflict.change":
    "{kind} · original {frozenId} @ {frozenVersion} → observed {currentId} @ {currentVersion}",
  "outcomes.planning.conflict.event": "Conflict event {eventId} · {at}",
  "outcomes.planning.accepted.summary":
    "See the first adoption receipt and timing",
  "outcomes.planning.accepted.ids":
    "Original workflow {workflowId} · candidate {candidateId} · adoption event {eventId}",
  "outcomes.planning.accepted.times":
    "{mode} · request to candidate {ready} · candidate to adoption {adopt} · request to adoption {total}",
  "outcomes.planning.accepted.exact": "adopted in full as-is",
  "outcomes.planning.accepted.revised": "adopted after changing the material",
  "outcomes.planning.note":
    "Proves only the batches the content owners committed and their request chain; the model source is unknown and quality unverified, and current material, full coverage or rights are not certified. Old history is not back-filled; no text, title, path, credential or outside telemetry.",
  "outcomes.exec.state.missing": "original record missing (unknown, not zero)",
  "outcomes.exec.state.unavailable": "original read temporarily unavailable",
  "outcomes.exec.state.readFailed":
    "original record failed to read (not replaced by the latest, not zero)",
  "outcomes.exec.phase.generating": "Generate",
  "outcomes.exec.phase.checking": "Check",
  "outcomes.exec.phase.revising": "Revise",
  "outcomes.exec.phase.rechecking": "Recheck",
  "outcomes.exec.stats.title":
    "Attempt configuration groups and run statistics",
  "outcomes.exec.stats.intro":
    "Only this workflow's stages, grouped exactly by the original engine and requested model, provider and profile; not an actual model version grouping or a project success rate. The duration range covers only stages with recorded start and end, not the workflow total; unfinished, missing and inconsistent stages are not zero.",
  "outcomes.exec.stats.none": "{state}; no denominator.",
  "outcomes.exec.stats.counts":
    "Receipt run identities {runs} · recorded stages {recorded} · missing identities {missing} · recorded revision stages {revisions} (not the local revisions needed for adoption)",
  "outcomes.exec.stats.noRuns":
    "This attempt has no run identity yet; it is not a success.",
  "outcomes.exec.stats.missingRun":
    "Run {id} missing: stage, configuration and duration unknown.",
  "outcomes.exec.group.aria": "Request configuration group {index}",
  "outcomes.exec.group.line": "Group {index} · engine {engine} · {model}",
  "outcomes.exec.group.model":
    "requested model {model} · provider {provider} · profile {profile}",
  "outcomes.exec.group.model.invalid": "original model configuration invalid",
  "outcomes.exec.group.model.unrecorded":
    "original model configuration unrecorded",
  "outcomes.exec.group.timing":
    "{runs} stages · measurable {measured}/{runs} · unfinished {inProgress} · start or end unrecorded {unrecorded} · clock inconsistent {invalid} · known stage duration range {range}",
  "outcomes.exec.group.range": "{min}–{max} ms",
  "outcomes.exec.group.run": "{phase} · {status} · run {runId}",
  "outcomes.exec.workflow.aria": "Workflow runs",
  "outcomes.exec.workflow.line":
    "Workflow {workflowId} · operation {operation} · request event {eventId}",
  "outcomes.exec.workflow.request":
    "Attempt {attempt} · {kind} · requested at {at}",
  "outcomes.exec.workflow.request.parent":
    "Attempt {attempt} · {kind} · requested at {at} · parent workflow {parent}",
  "outcomes.exec.workflow.lag":
    "The projection has not caught up or failed; the recorded facts may be incomplete.",
  "outcomes.exec.workflow.note":
    "Only the exact original request and stages. The models below are the configurations requested when the runs happened, not proof of the version the provider used. Model source unknown, quality unchecked, billing and settlement unknown; no totals of tokens, cumulative reports or costs in different currencies.",
  "outcomes.exec.history.aria": "Workflow history facts",
  "outcomes.exec.history.line": "Event {eventId} · cursor {cursor} · {kind}",
  "outcomes.exec.history.candidate":
    " · candidate {id} · fingerprint {fingerprint}",
  "outcomes.exec.history.formal": " · formal versions {versions}",
  "outcomes.exec.history.batch": " · full adoption batch of {count}",
  "outcomes.exec.noRuns":
    "This attempt has no run identity yet; that is neither a success nor zero usage.",
  "outcomes.exec.run.missing":
    "Run {runId}: {state}; no stage or success is assumed.",
  "outcomes.exec.run.aria": "{phase} stage",
  "outcomes.exec.run.line":
    "{phase} · run {runId} · session {sessionId} · engine {engine} · status {status}",
  "outcomes.exec.run.context": "Context {context} · requested model {model}",
  "outcomes.exec.run.model": "{model} (provider {provider})",
  "outcomes.exec.run.timing": "Stage duration: {timing}",
  "outcomes.exec.run.timing.measured": "{ms} ms (recorded start and end)",
  "outcomes.exec.run.timing.running": "unfinished; no running time is added",
  "outcomes.exec.run.timing.invalid": "original clock record inconsistent",
  "outcomes.exec.run.timing.unrecorded": "start and end unrecorded",
  "outcomes.exec.run.noUsage": "usage link unrecorded",
  "outcomes.exec.detail.loading": "Reading the workflow…",
  "outcomes.exec.detail.error":
    "The runs could not be read: {error}; no older reading is shown as success.",
  "outcomes.exec.detail.older": "Read older workflow facts",
  "outcomes.exec.detail.usage": "Read every usage page of the {phase} stage",
  "outcomes.exec.detail.reload": "Read the workflow again",
  "outcomes.exec.aria": "Local requests and runs ledger",
  "outcomes.exec.title": "Local requests and their runs",
  "outcomes.exec.intro":
    "Includes recorded failures, retries and planning requests; history without an original request is not added. Not outcomes, model quality or billing.",
  "outcomes.exec.read": "Read the request ledger",
  "outcomes.exec.error":
    "The requests could not be read: {error}; this does not mean there are none.",
  "outcomes.exec.lag":
    "The request projection has not caught up or failed; this page is not the full history.",
  "outcomes.exec.item": "{operation} · workflow {workflowId}",
  "outcomes.exec.empty":
    "No recorded requests; this does not mean nothing was ever created.",
  "outcomes.exec.older": "Read older requests",
  "outcomes.usage.scope.response": "Per-response report (increment)",
  "outcomes.usage.scope.run": "Run total report",
  "outcomes.usage.scope.session": "Session total report (not this run's usage)",
  "outcomes.usage.scope.unspecified": "Measurement scope unspecified",
  "outcomes.usage.token.invalid": "invalid report",
  "outcomes.usage.token.unreported": "unreported",
  "outcomes.usage.aria": "Engine usage observations",
  "outcomes.usage.run": "Run {runId} · {count} observations when read",
  "outcomes.usage.scopeLine":
    "Scope at the time: {scope}; binding the conversation to a project later does not move old reports.",
  "outcomes.usage.scope.project": "project {projectId}",
  "outcomes.usage.scope.global": "a global run with no project",
  "outcomes.usage.empty": "No saved reports; usage is unknown, not zero.",
  "outcomes.usage.item.scope": "{scope} · cursor {cursor}",
  "outcomes.usage.item.tokens":
    "Input {input} · output {output} · cache read {cached}",
  "outcomes.usage.cost":
    "Engine-reported cost estimate: {amount} · {currency}; not a quote, bill or settlement, and never recomputed from tokens or current prices or added up.",
  "outcomes.usage.amount.invalid": "invalid report",
  "outcomes.usage.amount.unreported": "amount unreported",
  "outcomes.usage.currency.invalid": "invalid currency report",
  "outcomes.usage.currency.unreported": "currency unreported",
  "outcomes.usage.noCost":
    "No cost estimate recorded for this item; no historical amount or currency is made up, and settlement is unknown.",
  "outcomes.usage.accounting": "Input accounting: {accounting} · saved at {at}",
  "outcomes.usage.accounting.includes": "includes cache",
  "outcomes.usage.accounting.excludes": "excludes cache",
  "outcomes.usage.accounting.unspecified": "cache inclusion unspecified",
  "outcomes.usage.note":
    "The engine's own reports only; coverage may be incomplete and nothing is totalled for the run. Run source classification, cost and settlement are unknown; this is not proof of payment, efficiency or literary quality.",
  "outcomes.usage.panel": "Run usage records (read-only)",
  "outcomes.usage.load.pending": "Reading usage reports…",
  "outcomes.usage.load.again": "Read the run's usage reports again",
  "outcomes.usage.load.first": "See the run's usage reports",
  "outcomes.usage.error":
    "{error} The previous records stay for history only; no other run or retry is tried.",
  "outcomes.usage.foreign":
    "The usage session or engine does not belong to this stage; the foreign reports are not shown.",
  "outcomes.usage.changed":
    "The page identity changed; read this run again explicitly.",
  "outcomes.usage.older": "Read older usage observations",
  "outcomes.funnel.state.missing": "first workflow receipt missing",
  "outcomes.funnel.state.unavailable": "first receipt read unavailable",
  "outcomes.funnel.state.readFailed": "first receipt failed to read",
  "outcomes.funnel.state.missingRun":
    "first generation stage unrecorded; configuration unknown",
  "outcomes.funnel.state.unobserved":
    "first request unrecorded; not filled in from a retry's configuration",
  "outcomes.funnel.model": "{model} · provider {provider} · profile {profile}",
  "outcomes.funnel.result": "Project request configuration funnel result",
  "outcomes.funnel.head":
    "Checkpoint {checkpoint} · recorded workflows {workflows} · targets {targets}",
  "outcomes.funnel.lag":
    "The projection has not caught up or failed; every recorded page was read, but this is not the full history.",
  "outcomes.funnel.empty":
    "No recorded requests; this does not mean nothing was ever created.",
  "outcomes.funnel.group.aria": "Configuration funnel group {index}",
  "outcomes.funnel.group.line": "Group {index} · {family} · {configuration}",
  "outcomes.funnel.family.planning": "Story planning",
  "outcomes.funnel.family.creation": "Novel chapters / adaptation",
  "outcomes.funnel.configuration":
    "generation engine {engine} · requested model {model}",
  "outcomes.funnel.row.head":
    "{name} · requests {requests} · targets {targets} · first request unrecorded {unobserved}",
  "outcomes.funnel.row.first":
    "First candidates {first} · adopted directly {adopted} · pending {pending} · closed without direct adoption {closed} · adopted after changes {revised} · retry candidates {retries}",
  "outcomes.funnel.row.ratio":
    "First candidates adopted directly as of this checkpoint: {ratio}",
  "outcomes.funnel.row.ratio.none": "no denominator",
  "outcomes.funnel.row.ratio.value":
    "{adopted}/{first} (includes pending; not a public model adoption rate)",
  "outcomes.funnel.row.accepted":
    "First formal adoption in this group {eventId} · workflow {workflowId} · request to reviewable candidate {ready} ms · request to formal adoption {adopt} ms · clock {clock}",
  "outcomes.funnel.group.ids": "This group's anchors and every attempt",
  "outcomes.funnel.group.anchors": "First observed requests: {ids}",
  "outcomes.funnel.group.all":
    "Every workflow (retries included; not all used this configuration): {ids}",
  "outcomes.funnel.title": "Project request configuration funnel",
  "outcomes.funnel.intro":
    "Reads every recorded request and each workflow's fact pages, read-only and one by one, so it may take a while. Groups by the generation stage configuration of each target's first request; a later retry with another model does not reset the target. Not a full hyperparameter or actual model version grouping; source unknown, quality unchecked, cost and settlement unknown, no token or cost totals, and a first manual adoption is not literary quality. Novel and story planning stay apart, and unrecorded history is not added.",
  "outcomes.funnel.read": "Read the project configuration funnel",
  "outcomes.funnel.stop": "Stop this read",
  "outcomes.funnel.pending":
    "Reading the whole configuration funnel; no partial result or old denominator is shown…",
  "outcomes.funnel.error":
    "The configuration funnel could not be read: {error}; there is no partial denominator, read it again.",
  "outcomes.revision.result": "Revisions before the first chapter adoption",
  "outcomes.revision.head":
    "Checkpoint {checkpoint} · recorded chapter targets {targets}",
  "outcomes.revision.lag":
    "The projection has not caught up or failed; this is not the full history.",
  "outcomes.revision.empty":
    "No recorded chapter requests; this does not mean there were no revisions.",
  "outcomes.revision.target": "Target {key}",
  "outcomes.revision.updates":
    "Observed text updates {updates} · explicit rebases {rebases} ({changing} changed the text)",
  "outcomes.revision.state.pending": "No formal adoption to link yet; no total",
  "outcomes.revision.state.unknown":
    "Formally adopted, but the history is incomplete; total unknown",
  "outcomes.revision.state.measured":
    "{count} local text revisions before the first formal adoption",
  "outcomes.revision.adoption":
    "Adoption event {eventId} · chapter {chapterId} v{version} · workflow {workflowId}",
  "outcomes.revision.ids": "Every original request",
  "outcomes.revision.note":
    "Counts only the text changes actually saved before the first recorded formal adoption, keeping abandoned, failed and retried AI drafts; changes after adoption are not included. Identical saves count once and missing history is not zero. Model revision stages, unsaved actions and manual effort are excluded, and nothing here proves literary quality. Novel chapters for now; the revisions grouped by first request configuration can be read separately, and adaptation and planning revisions come later.",
  "outcomes.revision.grouped.result": "Chapter revisions by configuration",
  "outcomes.revision.grouped.head":
    "Checkpoint {checkpoint} · chapter targets {targets} · attempts {workflows}",
  "outcomes.revision.grouped.empty":
    "No recorded chapter targets; this is not zero revisions.",
  "outcomes.revision.grouped.aria":
    "Chapter revision configuration group {index}",
  "outcomes.revision.grouped.configuration":
    "First generation configuration: {configuration}",
  "outcomes.revision.grouped.engine":
    "engine {engine} · requested model {model}",
  "outcomes.revision.grouped.unknown": "configuration unknown ({state})",
  "outcomes.revision.grouped.summary":
    "Measurable adoptions {measured} / targets {targets} · adopted with unknown history {unknown} · not adopted yet {pending}",
  "outcomes.revision.grouped.mean":
    "Revision range of measurable targets {minimum}–{maximum} · mean {numerator}/{denominator} (exact fraction)",
  "outcomes.revision.grouped.mean.none":
    "No measurable mean; unknown and unadopted targets are not zero",
  "outcomes.revision.grouped.ids":
    "This group's targets, attempts and adoptions",
  "outcomes.revision.grouped.item":
    "Target {key} · workflows {workflows} · adoption {eventId} · total revisions {count}",
  "outcomes.revision.grouped.note":
    "Grouped by each target's first generation request; a retry with another model stays in its group, so not every attempt used this model. Only fully adopted histories enter the mean, and unknown or unadopted targets are listed apart; this is not model quality, the remote version, full hyperparameters, manual effort or billing. Model revision stages are excluded; adaptation and planning come later.",
  "outcomes.revision.title": "Revisions before the first chapter adoption",
  "outcomes.revision.read": "Read revisions before the first chapter adoption",
  "outcomes.revision.read.pending": "Checking every revision page…",
  "outcomes.revision.readGrouped": "Read chapter revisions by configuration",
  "outcomes.revision.stop": "Stop this revision read",
  "outcomes.revision.error":
    "{error} The read failed; no partial pages, older result or assumed zero are shown.",
  "outcomes.delivery.coverage.result": "Delivery coverage of adopted versions",
  "outcomes.delivery.coverage.head": "Checkpoint {checkpoint}",
  "outcomes.delivery.coverage.aria.novel": "Novel chapter version delivery",
  "outcomes.delivery.coverage.aria.adaptation":
    "Adapted script version delivery",
  "outcomes.delivery.coverage.title.novel":
    "Novel chapter versions → saved manuscripts",
  "outcomes.delivery.coverage.title.adaptation":
    "Adapted script versions → saved internal pilot packages",
  "outcomes.delivery.coverage.counts":
    "Recorded formal adoptions {adopted} · same version saved after adoption {delivered} · no matching save yet {notSaved}",
  "outcomes.delivery.coverage.ratio":
    "Adopted version delivery coverage {numerator}/{denominator} (exact fraction)",
  "outcomes.delivery.coverage.ratio.none":
    "No recorded adopted versions; no coverage and no zero",
  "outcomes.delivery.coverage.unlinked":
    "Saved versions without an earlier adoption {count} (not in the numerator)",
  "outcomes.delivery.coverage.items":
    "Versions with adoption and save receipts",
  "outcomes.delivery.coverage.item":
    "Version {id} v{version} · adopted {adoption} · saved {saved} · separate saved version sets {units}",
  "outcomes.delivery.coverage.note":
    "Links the same formal version only in recorded owner event order; re-saving or reformatting adds nothing to the numerator. Saving an older version cannot stand in for a newer one, and a save with no earlier adoption is not linked. Not current validity, quality, a grant, a submission or a release; a novel needs no adaptation or media and a pilot package needs no media.",
  "outcomes.delivery.window.result": "Seven-day delivery and save time",
  "outcomes.delivery.window.head":
    "Fixed UTC window {from} → {to} (inclusive, not a calendar week)",
  "outcomes.delivery.window.path.novel": "Formal novel chapter versions",
  "outcomes.delivery.window.path.adaptation": "Formal adapted script versions",
  "outcomes.delivery.window.counts":
    "{path} · new adoptions in the window {adopted} · first matching saves in the window {delivered}",
  "outcomes.delivery.window.measured":
    "Measurable adoption to Host save {measured} · no matching save yet {pending} · clock inconsistent or future evidence {clock}",
  "outcomes.delivery.window.duration":
    "Known duration range {minimum}–{maximum} ms · exact mean {numerator}/{denominator} ms",
  "outcomes.delivery.window.duration.none":
    "Time from adoption to save unknown; not zero",
  "outcomes.delivery.window.items": "Version timing",
  "outcomes.delivery.window.item":
    "Version {id} v{version} · adopted {adoption} · first saved {saved} · {clock} · {reason} · took {duration}",
  "outcomes.delivery.window.clockOk": "clock verifiable",
  "outcomes.delivery.window.note":
    "New adoptions and first matching saves are two counts across periods and must not be divided into a weekly conversion rate; re-exporting does not refresh the first time. The time covers only a verifiable adoption to the first Host save, manual review and waiting included, and is not generation speed, total task time or literary quality. Old history and future, backward or inconsistent receipt clocks are not zero; current validity, grants, submissions and releases are not certified.",
  "outcomes.delivery.title": "Same-version delivery of adoptions and saves",
  "outcomes.delivery.intro":
    "Reads the full local ledger and checks novel and adaptation versions apart; starts no model, adoption or export.",
  "outcomes.delivery.read": "Read adopted version delivery coverage",
  "outcomes.delivery.readWindow": "Read seven-day delivery and save time",
  "outcomes.delivery.pending": "Reading the whole ledger…",
  "outcomes.delivery.stop": "Stop reading delivery coverage",
  "outcomes.delivery.error":
    "Delivery coverage could not be read: {error}. No older result or partial denominator is kept.",
};
