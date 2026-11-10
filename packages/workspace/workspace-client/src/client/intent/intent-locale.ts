/** Copy of the author intent tool: the editor, versions and the AI proposal. */
export const intentZh = {
  "intent.field.themeStatement": "作品主题",
  "intent.field.emotionalPromise": "情绪承诺",
  "intent.field.targetAudience": "目标受众",
  "intent.field.mustKeep": "必须保留",
  "intent.field.mayChange": "允许改变",
  "intent.field.mustAvoid": "必须避免",
  "intent.field.endingContract": "结局约束（可暂不决定）",
  "intent.field.toneAndVoice": "叙事声音与风格",
  "intent.status.pending": "等待审阅采用",
  "intent.status.adopted": "已正式采用",
  "intent.status.discarded": "已放弃",
  "intent.status.conflicted": "采用冲突，需重新预览",

  "intent.label": "正式作者意图工作台",
  "intent.eyebrow": "故事母本与创作约束",
  "intent.title": "正式作者意图",
  "intent.description":
    "意图版本与 AI 草稿独立保存。旧项目设定不是已采用意图；新 AI 草稿必须比较、明确采用，来源变化或并发采用会拒绝旧 AI 草稿。小说不必短剧化，结局可暂不决定。",
  "intent.current.loading": "正在核对正式版本…",
  "intent.current.failed": "当前正式版本未能读取：{message}",
  "intent.current.version": "当前正式版本 v{version}",
  "intent.current.none": "尚无正式采用版本，旧项目设定待确认。",
  "intent.legacy": "带入旧项目字段（待确认）",
  "intent.legacy.notice":
    "仅带入原样保存的受众、情感核心和风格；请自行补全主题与约束，不会自动采用。",
  "intent.fromCurrent": "基于当前正式版本创建草稿",
  "intent.refresh": "刷新来源与状态",
  "intent.refresh.notice": "已刷新来源版本，编辑内容仍保留；请重新核对后预览。",

  "intent.edit.title": "编辑下一份意图草稿",
  "intent.edit.basis":
    "冻结项目版本 {version} · {source}；每条约束单独一行。编辑区按项目仅存本机，不是正式版本；恢复不自动换成最新来源，也不代表重新同意或采用。",
  "intent.edit.source.legacy": "旧字段待确认",
  "intent.edit.source.manual": "作者手工填写",
  "intent.draft.label": "作者意图本地草稿状态",
  "intent.draft.recovered":
    "已恢复本机编辑草稿和原来源版本，未自动刷新或采用。",
  "intent.draft.saved":
    "编辑草稿已保存到本机；不是正式版本，不会发送模型或自动采用。",
  "intent.draft.restore":
    "本地草稿无法安全恢复，原记录未删除或覆盖。可明确清空该项目的编辑草稿；正式版本和候选不受影响。",
  "intent.draft.unavailable":
    "本地编辑草稿未能保存；当前输入仍保留，但不能保证重启恢复。",
  "intent.draft.conflict":
    "本地草稿已在其他窗口变化，未覆盖它；当前输入仍保留，请重新核对后再操作。",
  "intent.draft.cleared":
    "本项目本机编辑草稿已明确清空，正式版本与已保存草稿保持不变。",
  "intent.edit.stale":
    "编辑草稿的项目或正式意图来源已变化。原输入和基准保留；请明确刷新来源并重新核对，不能直接当作当前正式意图。",
  "intent.preview": "保存意图草稿并预览差异",
  "intent.preview.invalid":
    "请填写作品主题、情绪承诺、目标受众与叙事风格；每条约束单独一行，并核对长度限制。",
  "intent.preview.unverified": "尚未核对当前正式版本，不能创建预览。",
  "intent.preview.saved":
    "AI 草稿已保存，请核对差异后明确采用；尚未修改正式作者意图或正文。",
  "intent.clear": "清空本地编辑草稿",
  "intent.clear.title": "清空本地意图编辑草稿",
  "intent.clear.description":
    "只清空此项目本机编辑区的八个字段和旧来源基准；已保存草稿、正式意图、章节、剧本及其他项目不变。",
  "intent.clear.accept": "确认清空编辑草稿",
  "intent.cancel": "取消",
  "intent.close": "关闭",

  "intent.adopt.title": "采用作者意图",
  "intent.adopt.accept": "确认采用",
  "intent.adopt.description":
    "正式采用作者意图 v{version}？这会改变正式意图版本；不会改写章节、剧本或旧意图，也不会自动触发生成。新的小说、剧本、改编诊断与整季方案会冻结正式版本，旧意图或无正式意图的未采用 AI 草稿将不能直接采用。",
  "intent.adopt.done": "已正式采用作者意图 v{version}。",
  "intent.discard.title": "放弃作者意图候选",
  "intent.discard.accept": "确认放弃",
  "intent.discard.description":
    "放弃作者意图候选 v{version}？不会删除已采用版本或修改正文。",
  "intent.discard.done": "已放弃此 AI 草稿，正式内容保持不变。",

  "intent.versions": "意图版本与 AI 草稿",
  "intent.navigation": "指定链接含空白或重复身份；未改用最近候选或运行。",
  "intent.list.failed": "版本列表未核全：{message}",
  "intent.list.paging": "作者意图分页未能完整读取。",
  "intent.list.item": "意图 v{version} · {status}{current}{stale}",
  "intent.list.current": " · 当前正式",
  "intent.list.stale": " · 来源已变化",
  "intent.selected.loading": "正在读取指定意图…",
  "intent.selected.missing":
    "指定意图未能读取或不属于此项目，未打开其他版本代替。",
  "intent.candidate.label": "指定作者意图预览",
  "intent.candidate.title": "v{version} · {status}",
  "intent.candidate.source":
    "来源：{kind} · 项目 v{projectVersion} · 状态版本 {stateVersion}",
  "intent.candidate.kind.legacy-project": "旧项目字段待确认",
  "intent.candidate.kind.ai-generated": "AI 建议，须作者明确确认",
  "intent.candidate.kind.manual": "作者手工填写",
  "intent.candidate.stale":
    "项目设定、选定来源或当前采用版本已变化，不能直接采用旧草稿；请核对并保存新预览。",
  "intent.diff.caption": "本次 AI 草稿与当前正式版本的差异",
  "intent.diff.field": "字段",
  "intent.diff.current": "当前正式版本",
  "intent.diff.candidate": "指定版本内容",
  "intent.diff.unset": "未设置",
  "intent.diff.none": "尚无正式版本",
  "intent.legacyFields": "查看原样保存的旧项目来源（不是正式意图）",
  "intent.provenance": "查看 AI 意图实际参考内容与运行身份",
  "intent.provenance.run":
    "工作流 {workflowId} · 原快照 {snapshotId} · 引擎 {engine} · 运行 {runs}",
  "intent.provenance.runs.separator": "、",
  "intent.provenance.scope":
    "只使用项目简报、当时的正式意图与明确选择的 {count} 份来源；未选材料未读。模型建议不是作者确认。",
  "intent.provenance.reference": "{kind} · {id} · v{version} · SHA-256 {hash}",
  "intent.adopt": "确认采用此作者意图",
  "intent.discard": "放弃此意图草稿",

  "intent.ai.label": "AI 作者意图候选",
  "intent.ai.title": "AI 辅助提出作者意图",
  "intent.ai.description":
    "项目简报可以单独生成建议，也可明确选择非空章节或已有剧本。模型推测不是作者已确认的思想；这里只提出八字段 AI 草稿，经检查后在下方比较并明确采用，不改小说正文或剧本。不声明读过未选材料，实际 usage／费用仍以运行证据为准，未知不是零。",
  "intent.ai.loading": "正在核对可选来源…",
  "intent.ai.failed": "来源未能核全：{message}",
  "intent.ai.workflow.loading": "正在恢复指定意图工作流…",
  "intent.ai.workflow.missing":
    "指定工作流不存在、未能读取或不属于此项目的意图操作；未打开其他运行代替。",
  "intent.ai.project":
    "当前项目 v{version} · {base}；不选择条目即仅用项目简报。",
  "intent.ai.base": "有正式意图比较基准",
  "intent.ai.base.none": "尚无正式意图",
  "intent.ai.chapters.off": "当前 Profile 未启用章节来源。",
  "intent.ai.scripts.off":
    "当前 Profile 未启用剧本来源；不会强制启用媒体生产。",
  "intent.ai.sources": "AI 意图可选来源",
  "intent.ai.source.label": "意图来源：{title}",
  "intent.ai.source.chapter": "章节 · {title} · v{version}",
  "intent.ai.source.script":
    "剧本 · {title} · v{version} / 实际文档 {document}",
  "intent.ai.source.document": "v{version}",
  "intent.ai.source.document.none": "未存在",
  "intent.ai.expressions": "AI 意图明确来源表达",
  "intent.ai.expressions.toggle": "AI 意图使用明确混合表达",
  "intent.ai.expressions.text":
    "明确选择原文／已采用摘要／段落／叙事解释，替代所选章节的整章外发",
  "intent.ai.expressions.note":
    "范围中的章节必须有明确表达；叙事解释不增加整章阅读覆盖。未启用此选项时保留原完整来源协议；不选择材料仍可只用项目简报，不强制小说、剧本或媒体。",
  "intent.ai.expressions.scope":
    "请先明确选择至少一章允许范围；简报独立入口请关闭混合表达。",
  "intent.ai.expressions.loading": "正在核对原允许章节版本…",
  "intent.ai.expressions.failed":
    "表达来源未核全：{message}；旧工作流与候选保持。",
  "intent.ai.expressions.title": "AI 意图来源表达",
  "intent.ai.directory.owner": "原章节目录归属未核对，未改选来源。",
  "intent.ai.directory.version": "原允许章节版本已变化，请核对后重新选择表达。",
  "intent.ai.confirm": "确认 AI 意图来源",
  "intent.ai.confirmed":
    "已明确确认本次允许范围与表达；下一步生成前仍核每章表达、隐私和完整预算。未选材料不补入，旧工作流与 AI 草稿保持不变。",
  "intent.ai.reread": "重新读取 AI 可选来源",
  "intent.ai.reread.notice":
    "已重新读取可选来源，旧工作流基准未自动更新；新运行须重新确认来源。",
  "intent.ai.error.duplicate": "所选来源重复，请重新核对，不会静默去重。",
  "intent.ai.error.missing":
    "所选来源已缺失，请刷新并重新核对，不会忽略旧选择。",
  "intent.ai.error.context":
    "混合表达确认无效；须绑定原允许章节及版本、完整表达和已采用来源，不能补全文或忽略无效选择。Runtime仍须核实际覆盖、隐私与预算。",
  "intent.ai.error.sources":
    "来源确认无效；最多明确选择 100 份完整来源，请调整范围，不会裁剪或声称覆盖全书。",
  "intent.ai.frozen":
    "本次冻结项目 v{version} · {scope} {count} 份 · {base}；各阶段、失败重试和重启保留同一基准。",
  "intent.ai.frozen.context":
    "所选允许来源（实际表达另行冻结，不代表全文已读）",
  "intent.ai.frozen.complete": "所选完整来源",
  "intent.ai.frozen.base": "绑定原正式意图头",
  "intent.ai.frozen.base.none": "冻结当时尚无正式意图",
  "intent.ai.stale":
    "原项目、正式意图头或选定来源已变化。原运行与 AI 草稿保留，重试仍使用旧快照；不能直接采用为当前方向。新运行请明确重新确认来源。",
  "intent.ai.instruction":
    "提出供我审阅的作品主题、情绪承诺、受众、声音与保留／可改／禁止及结局约束，不改写原稿。",
  "intent.ai.candidate.note":
    "AI 建议仍是 AI 草稿，结构与模型检查不是作者确认或真实质量证明。",
  "intent.ai.candidate.open": "比较并确认此 AI 意图草稿",
  "intent.ai.candidate.missing":
    "尚未取得实际意图草稿身份，不打开最新版本代替。",
};

export const intentEn: Record<keyof typeof intentZh, string> = {
  "intent.field.themeStatement": "Theme",
  "intent.field.emotionalPromise": "Emotional promise",
  "intent.field.targetAudience": "Target audience",
  "intent.field.mustKeep": "Must keep",
  "intent.field.mayChange": "May change",
  "intent.field.mustAvoid": "Must avoid",
  "intent.field.endingContract": "Ending contract (can wait)",
  "intent.field.toneAndVoice": "Narrative voice and tone",
  "intent.status.pending": "Waiting for review",
  "intent.status.adopted": "Adopted",
  "intent.status.discarded": "Discarded",
  "intent.status.conflicted": "Adoption conflict; preview again",

  "intent.label": "Author intent workbench",
  "intent.eyebrow": "Story foundation and creative constraints",
  "intent.title": "Author intent",
  "intent.description":
    "Intent versions and AI drafts are saved separately. Old project settings are not an adopted intent; a new AI draft must be compared and explicitly adopted, and a source change or concurrent adoption refuses an old AI draft. A novel need not become a short drama, and the ending can wait.",
  "intent.current.loading": "Checking the adopted version…",
  "intent.current.failed": "The adopted version could not be read: {message}",
  "intent.current.version": "Adopted version v{version}",
  "intent.current.none":
    "No adopted version yet; old project settings wait for confirmation.",
  "intent.legacy": "Bring in old project fields (to confirm)",
  "intent.legacy.notice":
    "Only the audience, emotional core and style saved as they are were brought in; complete the theme and constraints yourself. Nothing is adopted automatically.",
  "intent.fromCurrent": "Start a draft from the adopted version",
  "intent.refresh": "Refresh sources and state",
  "intent.refresh.notice":
    "Source versions refreshed and your edits kept; check again before previewing.",

  "intent.edit.title": "Edit the next intent draft",
  "intent.edit.basis":
    "Frozen project version {version} · {source}; one constraint per line. The editor is kept on this machine per project and is not a formal version; restoring it does not switch to the latest sources or mean consent or adoption.",
  "intent.edit.source.legacy": "old fields to confirm",
  "intent.edit.source.manual": "written by the author",
  "intent.draft.label": "Author intent local draft state",
  "intent.draft.recovered":
    "The local draft and its original source versions were restored; nothing was refreshed or adopted.",
  "intent.draft.saved":
    "Draft saved on this machine; it is not a formal version, is not sent to a model and is not adopted.",
  "intent.draft.restore":
    "The local draft cannot be restored safely and was neither removed nor overwritten. You can explicitly clear this project's draft; adopted versions and candidates are not affected.",
  "intent.draft.unavailable":
    "The local draft could not be saved; your input stays, but it may not survive a restart.",
  "intent.draft.conflict":
    "The local draft changed in another window and was not overwritten; your input stays. Check again before continuing.",
  "intent.draft.cleared":
    "This project's local draft was cleared; adopted versions and saved drafts are unchanged.",
  "intent.edit.stale":
    "The project or adopted intent this draft is based on has changed. Your input and basis are kept; refresh the sources and check again. It cannot stand for the current adopted intent.",
  "intent.preview": "Save the intent draft and preview the difference",
  "intent.preview.invalid":
    "Fill in the theme, emotional promise, target audience and voice; one constraint per line, within the length limits.",
  "intent.preview.unverified":
    "The adopted version is not checked yet; a preview cannot be created.",
  "intent.preview.saved":
    "Draft saved. Compare the difference and adopt it explicitly; the adopted intent and the text are unchanged.",
  "intent.clear": "Clear the local draft",
  "intent.clear.title": "Clear the local intent draft",
  "intent.clear.description":
    "Only this project's eight local fields and old source basis are cleared; saved drafts, the adopted intent, chapters, scripts and other projects are unchanged.",
  "intent.clear.accept": "Clear the draft",
  "intent.cancel": "Cancel",
  "intent.close": "Close",

  "intent.adopt.title": "Adopt the author intent",
  "intent.adopt.accept": "Adopt",
  "intent.adopt.description":
    "Adopt author intent v{version}? This changes the adopted version; chapters, scripts and old intents are not rewritten and nothing is generated. New novel, script, diagnosis and season runs freeze the adopted version, and unadopted AI drafts based on an old or no intent can no longer be adopted directly.",
  "intent.adopt.done": "Author intent v{version} adopted.",
  "intent.discard.title": "Discard the author intent candidate",
  "intent.discard.accept": "Discard",
  "intent.discard.description":
    "Discard author intent candidate v{version}? Adopted versions and the text are not removed or changed.",
  "intent.discard.done":
    "This AI draft was discarded; the adopted content is unchanged.",

  "intent.versions": "Intent versions and AI drafts",
  "intent.navigation":
    "The link names a blank or repeated identity; no nearest candidate or run was used instead.",
  "intent.list.failed": "Version list not fully checked: {message}",
  "intent.list.paging": "Author intent pages could not be read completely.",
  "intent.list.item": "Intent v{version} · {status}{current}{stale}",
  "intent.list.current": " · adopted",
  "intent.list.stale": " · sources changed",
  "intent.selected.loading": "Reading the chosen intent…",
  "intent.selected.missing":
    "The chosen intent could not be read or belongs to another project; no other version was opened instead.",
  "intent.candidate.label": "Chosen author intent preview",
  "intent.candidate.title": "v{version} · {status}",
  "intent.candidate.source":
    "Source: {kind} · project v{projectVersion} · state version {stateVersion}",
  "intent.candidate.kind.legacy-project": "old project fields to confirm",
  "intent.candidate.kind.ai-generated":
    "AI suggestion, needs the author's explicit confirmation",
  "intent.candidate.kind.manual": "written by the author",
  "intent.candidate.stale":
    "Project settings, chosen sources or the adopted version changed; an old draft cannot be adopted directly. Check and save a new preview.",
  "intent.diff.caption":
    "Difference between this draft and the adopted version",
  "intent.diff.field": "Field",
  "intent.diff.current": "Adopted version",
  "intent.diff.candidate": "Chosen version",
  "intent.diff.unset": "Not set",
  "intent.diff.none": "No adopted version",
  "intent.legacyFields":
    "Show the old project source saved as it was (not an adopted intent)",
  "intent.provenance":
    "Show the AI intent's actual references and run identity",
  "intent.provenance.run":
    "Workflow {workflowId} · snapshot {snapshotId} · engine {engine} · runs {runs}",
  "intent.provenance.runs.separator": ", ",
  "intent.provenance.scope":
    "Only the project brief, the adopted intent at the time and {count} explicitly chosen sources were used; unchosen material was not read. A model suggestion is not the author's confirmation.",
  "intent.provenance.reference": "{kind} · {id} · v{version} · SHA-256 {hash}",
  "intent.adopt": "Adopt this author intent",
  "intent.discard": "Discard this intent draft",

  "intent.ai.label": "AI author intent candidates",
  "intent.ai.title": "Propose an author intent with AI",
  "intent.ai.description":
    "The project brief alone can produce a suggestion, or you can choose non-empty chapters or existing scripts. A model's guess is not the author's confirmed idea; only an eight-field AI draft is proposed here, compared below after its checks and adopted explicitly, without changing the novel or scripts. Unchosen material is not claimed as read; actual usage and cost come from run evidence, and unknown is not zero.",
  "intent.ai.loading": "Checking the sources you can choose…",
  "intent.ai.failed": "Sources not fully checked: {message}",
  "intent.ai.workflow.loading": "Restoring the chosen intent workflow…",
  "intent.ai.workflow.missing":
    "The chosen workflow does not exist, could not be read or is not this project's intent run; no other run was opened instead.",
  "intent.ai.project":
    "Project v{version} · {base}; choose nothing to use the project brief only.",
  "intent.ai.base": "an adopted intent to compare against",
  "intent.ai.base.none": "no adopted intent yet",
  "intent.ai.chapters.off": "Chapter sources are off in the current profile.",
  "intent.ai.scripts.off":
    "Script sources are off in the current profile; media production is not forced on.",
  "intent.ai.sources": "Sources for the AI intent",
  "intent.ai.source.label": "Intent source: {title}",
  "intent.ai.source.chapter": "Chapter · {title} · v{version}",
  "intent.ai.source.script":
    "Script · {title} · v{version} / document {document}",
  "intent.ai.source.document": "v{version}",
  "intent.ai.source.document.none": "none",
  "intent.ai.expressions": "Explicit source expressions for the AI intent",
  "intent.ai.expressions.toggle":
    "Use explicit mixed expressions for the AI intent",
  "intent.ai.expressions.text":
    "Choose text, adopted summaries, paragraphs or narrative interpretations instead of sending whole chosen chapters",
  "intent.ai.expressions.note":
    "Every chapter in range needs an explicit expression; narrative interpretations do not add chapter coverage. Without this option the complete-source protocol stays; choosing nothing still uses only the project brief, without forcing novel, script or media.",
  "intent.ai.expressions.scope":
    "Choose at least one chapter as the allowed range first; turn mixed expressions off for the brief-only entry.",
  "intent.ai.expressions.loading": "Checking the allowed chapter versions…",
  "intent.ai.expressions.failed":
    "Expression sources not fully checked: {message}; old workflows and candidates stay.",
  "intent.ai.expressions.title": "AI intent source expressions",
  "intent.ai.directory.owner":
    "The chapter directory's ownership is not checked; no source was changed.",
  "intent.ai.directory.version":
    "Allowed chapter versions changed; check and choose the expressions again.",
  "intent.ai.confirm": "Confirm the AI intent sources",
  "intent.ai.confirmed":
    "This round's allowed range and expressions are confirmed; each chapter's expression, privacy and full budget are checked again before generating. Unchosen material is not added, and old workflows and AI drafts are unchanged.",
  "intent.ai.reread": "Read the AI sources again",
  "intent.ai.reread.notice":
    "Sources read again; old workflow bases were not updated, and a new run needs the sources confirmed again.",
  "intent.ai.error.duplicate":
    "A chosen source is repeated; check again. Nothing is silently deduplicated.",
  "intent.ai.error.missing":
    "A chosen source is gone; refresh and check again. Old choices are not ignored.",
  "intent.ai.error.context":
    "The mixed expression confirmation is invalid; it must bind the allowed chapters and versions, complete expressions and adopted sources, without filling in text or ignoring invalid choices. The runtime still checks actual coverage, privacy and budget.",
  "intent.ai.error.sources":
    "The source confirmation is invalid; choose at most 100 complete sources. Nothing is trimmed or claimed to cover the book.",
  "intent.ai.frozen":
    "Frozen project v{version} · {scope} {count} · {base}; every stage, retry and restart keeps the same basis.",
  "intent.ai.frozen.context":
    "chosen allowed sources (actual expressions frozen separately, not full text read)",
  "intent.ai.frozen.complete": "chosen complete sources",
  "intent.ai.frozen.base": "bound to the adopted intent head",
  "intent.ai.frozen.base.none": "no adopted intent when frozen",
  "intent.ai.stale":
    "The project, adopted intent head or chosen sources changed. The original run and AI draft are kept and a retry still uses the old snapshot; it cannot be adopted as the current direction. Confirm the sources again for a new run.",
  "intent.ai.instruction":
    "Propose a theme, emotional promise, audience, voice, must keep / may change / must avoid and an ending contract for me to review, without rewriting the manuscript.",
  "intent.ai.candidate.note":
    "An AI suggestion is still an AI draft; structural and model checks are not the author's confirmation or proof of quality.",
  "intent.ai.candidate.open": "Compare and confirm this AI intent draft",
  "intent.ai.candidate.missing":
    "The actual intent draft identity is not known yet; the latest version is not opened instead.",
};
