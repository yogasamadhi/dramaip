/** Copy of the review stages, merged into the review dictionary. */
export const stagesZh = {
  "notice.cancelled": "已取消导出。",
  "busy.saving": "正在保存…",
  "busy.exporting": "正在导出…",
  "busy.creating": "正在创建…",
  "busy.preflight": "正在预检…",

  "workflow.title": "分集交付清单",
  "workflow.description":
    "按顺序检查、审片、再预检交付。每项都会生成可追踪的任务和报告，不会修改剧本、分镜或正式交付内容。",
  "workflow.legacy":
    "旧数量评分已停止；已有质量记录未认证，不代表当前质量通过。",
  "workflow.quality": "打开独立质量评议",
  "workflow.list": "分集交付清单",
  "workflow.run": "执行",
  "workflow.running": "正在执行检查并保存报告…",
  "workflow.state.running": "正在执行",
  "workflow.state.done": "本次已完成",
  "workflow.state.failed": "未完成",
  "workflow.state.idle": "未执行",
  "workflow.kind.compliance-check": "执行合规预检",
  "workflow.kind.compliance-check.description":
    "结合基础风险词与素材归档状态，标出需人工核验的内容。",
  "workflow.kind.review-package": "生成审片包",
  "workflow.kind.review-package.description":
    "汇总当前剧本、场景、分镜和待审项目，形成审阅清单。",
  "workflow.kind.minimal-redo-plan": "生成最小返工计划",
  "workflow.kind.minimal-redo-plan.description":
    "按依赖关系整理优先处理步骤，不会直接改写任何内容。",
  "workflow.kind.animatic-draft": "生成动态分镜草案",
  "workflow.kind.animatic-draft.description":
    "根据分镜创建可审阅的节奏时间线，不伪造实际视频成片。",
  "workflow.kind.render-preflight": "执行渲染预检",
  "workflow.kind.render-preflight.description":
    "确认剧本、场景、分镜和素材是否具备提交真实渲染任务的条件。",
  "workflow.kind.delivery-preflight": "执行交付预检",
  "workflow.kind.delivery-preflight.description":
    "核查质量、合规、审片和本地化记录是否具备交付条件。",

  "records.quality.title": "质量审核",
  "records.review.title": "合规与审片",
  "records.delivery.title": "本地化与交付",
  "records.quality": "质量检查",
  "records.quality.description": "记录质量门禁、问题、返工和确认处理。",
  "records.quality.name": "质量检查名称",
  "records.compliance": "合规检查",
  "records.compliance.description": "维护合规规则、预检结果和处理记录。",
  "records.compliance.name": "合规检查名称",
  "records.localization": "本地化",
  "records.localization.description":
    "管理字幕、译文、配音版本和本地化采用结果。",
  "records.localization.name": "本地化版本名称",
  "records.review": "审片",
  "records.review.description": "汇集离线或云端审片包、评论和决策。",
  "records.review.name": "审片包名称",
  "records.delivery": "交付",
  "records.delivery.description":
    "管理平台交付配置、创意变体、预检和导出记录。",
  "records.delivery.name": "交付任务名称",
  "records.field.episode": "关联分集",
  "records.field.severity": "严重程度",
  "records.field.issue": "问题描述",
  "records.field.redo": "返工方案",
  "records.field.ruleSource": "规则来源",
  "records.field.checkState": "检查状态",
  "records.field.risk": "风险与依据",
  "records.field.handling": "处理说明",
  "records.field.language": "目标语言",
  "records.field.subtitles": "字幕与译文",
  "records.field.adoption": "采用状态",
  "records.field.reviewMode": "审片方式",
  "records.field.reviewState": "审片状态",
  "records.field.comments": "评论",
  "records.field.decisions": "决策与跟进",
  "records.field.platform": "目标平台",
  "records.field.deliveryState": "交付状态",
  "records.field.preflight": "预检结果",
  "records.field.deliveryNote": "交付说明",
  "records.action.adopt": "采用本地化版本",
  "records.action.adopted": "本地化版本已采用。",
  "records.action.srt": "导出字幕",
  "records.action.vtt": "导出网页字幕",
  "records.action.txt": "导出译文草稿 TXT",
  "records.action.subtitles.saved": "字幕文件已导出。",
  "records.action.subtitles.cancelled": "已取消字幕导出。",
  "records.action.export": "导出交付清单",
  "records.action.export.saved": "交付清单已导出。",
  "records.action.export.cancelled": "已取消交付清单导出。",

  "platform.workbench": "平台交付创作",
  "platform.eyebrow": "平台交付",
  "platform.title": "提交文案、封面与版本化资料归档",
  "platform.description":
    "这里不会保存平台账号、登录或代投。它只创建可追溯的提交资料清单；真实成片、字幕和封面仍须由人工核验并附加。",
  "platform.catalog.failed":
    "资料目录核对失败，不表示没有候选或历史归档：{message}。",
  "platform.catalog.reload": "重新读取资料目录",
  "platform.profile": "平台交付档案",
  "platform.profile.none": "选择平台档案",
  "platform.profile.option": "{title} · {width}×{height}",
  "platform.variant": "当前创意候选",
  "platform.variant.none": "选择创意 AI 草稿",
  "platform.variant.option": "{label} · v{version} · {title}",
  "platform.profile.spec":
    "{platform} · {region} · {video}/{audio} · {width}×{height}",
  "platform.profile.duration": "时长：{note} 字幕安全区：底部 {margin} 像素。",
  "platform.profile.manual": "我已人工核对：{fields}。",
  "platform.form.label": "草稿标签",
  "platform.form.label.placeholder": "例如：方案一",
  "platform.form.label.default": "方案一",
  "platform.form.label.next": "方案 {letter}",
  "platform.form.cover": "封面素材",
  "platform.form.cover.none": "选择已归档封面素材",
  "platform.form.title": "平台标题",
  "platform.form.title.placeholder": "用户可见的成品标题",
  "platform.form.tags": "标签词",
  "platform.form.tags.placeholder": "用逗号分隔，例如：悬疑、反转",
  "platform.form.description": "平台简介",
  "platform.form.description.placeholder":
    "描述冲突、钩子和卖点；不会自动发布。",
  "platform.form.save": "保存为新草稿",
  "platform.variants.title": "创意 AI 草稿与采用历史",
  "platform.variants.empty":
    "尚无 AI 草稿。请先保存一个完整的标题、简介、标签词和封面组合。",
  "platform.variant.adopted": "已采用",
  "platform.variant.historic": "历史状态（当前采用未核验）",
  "platform.variant.draft": "草稿",
  "platform.variant.adopt": "采用此草稿",
  "platform.variant.adopting": "正在采用…",
  "platform.variant.meta": "标签：{tags} · 封面：{cover}",
  "platform.cover.none": "未引用",
  "platform.preflight.run": "运行平台交付预检",
  "platform.archive.create": "创建提交资料归档",
  "platform.archive.creating": "正在归档…",
  "platform.pending":
    "原{operation}请求待核：{key}；不会自动写入、换键、换版本或恢复人工勾选。",
  "platform.pending.adopt": "采用",
  "platform.pending.archive": "归档",
  "platform.pending.recover": "只读核对原请求",
  "platform.pending.resend": "明确用原键重发原请求",
  "platform.pending.retain": "保留原拒绝记录，重新核对来源",
  "platform.archives.title": "提交资料归档历史",
  "platform.archives.empty": "尚未创建提交资料归档。",
  "platform.archive.version": "v{version}",
  "platform.archive.meta": "{profile} · {at}",
  "platform.archive.legacy": "旧资料：没有冻结预检，不升级为有效交付证据。",
  "platform.archive.frozen":
    "原标题：{title} · 元数据SHA {sha} · 不代表当前成片／发行通过",
  "platform.archive.export": "导出提交资料清单",
  "platform.notice.mismatch": "原请求回执不匹配，保留待核请求。",
  "platform.notice.adopted": "原草稿已明确采用；请重新选择并核对预检。",
  "platform.notice.archived":
    "原预检提交资料已归档；不代表成片／授权／结算／发行通过。",
  "platform.notice.retained":
    "原拒绝请求已保留在本机；请重新读取 AI 草稿并明确核对，不沿用旧预检或同意。",
  "platform.notice.unconfirmed":
    "原请求结果尚未确认，未自动重新提交：{message}",
  "platform.notice.stillPending": "原请求仍待核，保留原键：{message}",
  "platform.notice.invalidPending":
    "本地原请求记录无效；未发起写入，请先核对记录。",
  "platform.notice.catalogBlocked":
    "资料目录核对失败，不能把读取失败当空历史；请先刷新核对。",
  "platform.notice.catalogRefresh": "资料目录核对失败，请先刷新原版本。",
  "platform.notice.pendingFirst": "请先核对原待确认请求。",
  "platform.notice.incomplete":
    "发布草稿必须填写标签、标题、简介和至少一个标签词。",
  "platform.notice.saved": "已保存草稿「{label}」，仍需显式采用后才能归档。",
  "platform.notice.choose": "请先选择平台档案和创意 AI 草稿。",
  "platform.notice.passed": "预检通过，可以创建可追溯的平台提交资料清单。",
  "platform.notice.blocked": "预检发现 {count} 项阻断，请补齐后重试。",
  "platform.notice.preflightFirst": "请先运行并通过平台交付预检。",
  "platform.notice.exported": "提交资料清单已导出。",
  "platform.result.passed": "预检通过：可创建提交资料归档",
  "platform.result.failed": "预检未通过",
  "platform.result.scope":
    "范围：仅提交资料元数据；成片质量、合法授权、实际结算、当前文件和目标平台规格均未核验。",
  "platform.result.original":
    "原候选：{title} · v{version} · 采用修订{revision} · SHA {sha}",
  "platform.result.prefix": "建议文件前缀：{name}",
  "platform.result.files": "预期附件（尚未生成／附加／读取）：{files}。",

  "compliance.eyebrow": "合规规则与预检",
  "compliance.title": "版本化规则、人工声明与交付前核验",
  "compliance.description":
    "规则档案是本地证据而非法律意见；预检不会伪造合规 MP4、水印或平台审核结果。",
  "compliance.profiles": "规则档案",
  "compliance.profile.active": "当前启用",
  "compliance.profile.official": "正式规则",
  "compliance.profile.reference": "仅供参考",
  "compliance.profile.activate": "启用此规则",
  "compliance.profile.meta":
    "发布：{date} · 完整性：{integrity} · 范围：{regions}",
  "compliance.integrity.verified": "已验证",
  "compliance.integrity.invalid": "无效",
  "compliance.integrity.unverified": "未验证",
  "compliance.regions.none": "未限定",
  "compliance.form.title": "交付剧名",
  "compliance.form.language": "字幕语言",
  "compliance.form.language.default": "中文",
  "compliance.form.platform": "目标平台（可选）",
  "compliance.form.region": "目标地区（可选）",
  "compliance.form.region.default": "中国大陆",
  "compliance.form.date": "交付日期",
  "compliance.form.aigc":
    "我确认本交付包含 AI 生成或合成内容，并同意按规则写入显式和隐式标识。",
  "compliance.form.manual":
    "我已完成人工核对：未成年人、历史/民俗、版权、许可证和备案。",
  "compliance.run": "运行合规预检",
  "compliance.result.passed": "合规预检通过",
  "compliance.result.failed": "合规预检未通过",
  "compliance.result.label": " · 固定可见标识：{label}",
  "compliance.result.fingerprint": "证据指纹：{sha}",
  "compliance.notice.activated": "已启用规则档案「{title}」。",
  "compliance.notice.incomplete": "请填写交付剧名、字幕语言和交付日期。",
  "compliance.notice.passed": "合规预检通过，可作为后续受控媒体封装的依据。",
  "compliance.notice.blocked": "合规预检存在阻断项。",

  "editor.eyebrow": "审片与剪辑交接",
  "editor.title": "离线审片包与可重链接剪辑时间线",
  "editor.description":
    "时间线不暴露绝对路径、不复制媒体，也不伪装为成片。导入剪辑软件后请人工重链接已核验媒体。",
  "editor.timeline.meta": "{count} 个分镜 · {width}×{height} · {rate} 帧",
  "editor.timeline.manifest": "导出时间线数据",
  "editor.timeline.edl": "导出剪辑清单",
  "editor.timeline.fcpxml": "导出剪辑工程",
  "editor.timeline.srt": "导出字幕",
  "editor.timeline.exported": "剪辑交换资料已导出。",
  "editor.preflight.ok": "时间线可导出",
  "editor.preflight.blocked": "时间线存在阻断项",
  "editor.preflight.counts":
    "{state} · 已引用 {referenced} 个 · 待重链接 {relink} 个",
  "editor.clip.name": "{index}. {name}",
  "editor.clip.span": "{start}–{end} 秒 · {state}",
  "editor.clip.referenced": "已引用媒体",
  "editor.clip.relink": "待人工重链接",
  "editor.clip.subtitle": "字幕：{text}",
  "editor.packages.title": "离线审片包",
  "editor.packages.description":
    "导出的是中文单文件审阅页；意见 JSON 需要显式导回当前审片包。",
  "editor.package.create": "创建离线审片包",
  "editor.package.export": "导出离线审片页",
  "editor.package.import": "导入离线审片意见",
  "editor.package.importing": "正在导入…",
  "editor.package.current": "当前审片包",
  "editor.package.none": "选择审片包",
  "editor.package.option": "{title} · {at}",
  "editor.notice.created":
    "已创建离线审片包记录；可以导出单文件审阅页分发给审片人。",
  "editor.notice.exported":
    "离线审片页已导出。审片人可在浏览器中填写意见并导出 JSON。",
  "editor.notice.imported":
    "已导入 {comments} 条审阅意见和 {decisions} 条决定。",
  "editor.revision.title": "AI 根据审片意见返修",
  "editor.revision.description":
    "未解决意见以及“退回 / 需要修改”决定会作为上下文写入预览；确认应用前不会改写正式剧本。",
  "editor.revision.script": "目标剧本",
  "editor.revision.script.none": "选择本集剧本",
  "editor.revision.script.option": "{title} · 版本 {version}",
  "editor.revision.instruction":
    "分析尚未解决的审片意见，定位相关场景，生成局部修订后的完整剧本并复检原问题。",
  "editor.revision.import": "导入已有修改稿",
  "editor.revision.draft": "修订草案",
  "editor.revision.draft.placeholder": "基于审片反馈填写拟采用的剧本内容",
  "editor.revision.create": "创建待确认修订预览",
  "editor.notice.revisionIncomplete": "请选择目标剧本并填写修订草案。",
  "editor.notice.revisionCreated": "已创建待确认修订预览；正式剧本尚未改写。",
  "editor.comment.title": "记录审阅意见",
  "editor.comment.shot": "关联分镜",
  "editor.comment.shot.none": "项目级意见",
  "editor.comment.timecode": "时间码（秒）",
  "editor.comment.alias": "署名（可选）",
  "editor.comment.body": "审阅意见",
  "editor.comment.body.placeholder": "描述问题、建议或确认事项",
  "editor.comment.save": "保存审阅意见",
  "editor.comments.empty": "尚无审阅意见。",
  "editor.comment.state": "{state} · {alias}",
  "editor.comment.resolved": "已解决",
  "editor.comment.open": "待处理",
  "editor.comment.anonymous": "未署名",
  "editor.comment.reopen": "标为待处理",
  "editor.comment.resolve": "标为已解决",
  "editor.comment.at": "时间码：{seconds} 秒",
  "editor.notice.commentIncomplete": "请先选择审片包并填写意见。",
  "editor.notice.commentSaved": "审阅意见已保存到本地审片包记录。",
  "editor.decision.title": "记录审片决定",
  "editor.decision.label": "决定",
  "editor.decision.field": "审片决定",
  "editor.decision.note": "仅备注",
  "editor.decision.approve": "通过",
  "editor.decision.return": "退回",
  "editor.decision.request_changes": "需要修改",
  "editor.decision.explain": "决定说明（可选）",
  "editor.decision.save": "保存审片决定",
  "editor.decisions.empty": "尚无审片决定。",
  "editor.decision.by": "{decision} · {alias}",
  "editor.notice.packageFirst": "请先选择审片包。",
  "editor.notice.decisionSaved":
    "审片决定已保存，可作为后续返工和交付复核依据。",

  "cloud.title": "可选云审片",
  "cloud.description":
    "仅上传下方明确选择的媒体。令牌只进入本机加密凭据库；不上传项目数据库、Provider 密钥或未选文件。",
  "cloud.configured": "连接已保存",
  "cloud.unconfigured": "尚未配置",
  "cloud.baseUrl": "平台地址",
  "cloud.baseUrl.placeholder": "例如：https://审片平台.example.com",
  "cloud.workspace": "Workspace ID",
  "cloud.workspace.placeholder": "已授权的 workspace",
  "cloud.token": "短期访问令牌",
  "cloud.token.hint":
    "点击保存连接后，由独立安全窗口输入；主界面不会接触明文。",
  "cloud.pin": "分享 PIN（可选）",
  "cloud.pin.placeholder": "4–12 位数字，仅本次发布使用",
  "cloud.save": "保存安全连接",
  "cloud.media.choose": "选择要上传的媒体",
  "cloud.preview": "计算 SHA-256 发布预览",
  "cloud.preview.busy": "正在计算…",
  "cloud.publish": "确认发布选定媒体",
  "cloud.publish.busy": "正在发布…",
  "cloud.sync": "按游标同步意见",
  "cloud.sync.busy": "正在同步…",
  "cloud.delete": "撤销并删除云审片",
  "cloud.delete.busy": "正在删除…",
  "cloud.vault.unavailable": "本机加密凭据库不可用。",
  "cloud.media.title": "发布清单（确认后才会上传）",
  "cloud.media.item": "{name} · {mime} · {path}",
  "cloud.media.shot": "关联分镜（必填）",
  "cloud.media.shot.label": "{name} 关联分镜",
  "cloud.preview.title": "已计算的发布预览（尚未上传）",
  "cloud.preview.storage": "Workspace：{workspace} · 存储：{used} / {max} 字节",
  "cloud.preview.retention": "保留期：{retention}",
  "cloud.preview.cost": "费用：{cost}",
  "cloud.preview.media": "{path} · {size} 字节 · SHA-256 {sha}",
  "cloud.preview.manifest": "查看 review manifest",
  "cloud.preview.stale": "上传清单已变化，请重新计算发布预览后再确认发布。",
  "cloud.share": "已创建受控分享链接：{url}",
  "cloud.share.binding": " · 状态：{status} · 到期：{at}",
  "cloud.credential.label": "云审片短期访问令牌",
  "cloud.credential.cancelled": "安全窗口已关闭，未保存令牌。",
  "cloud.credential.expired": "安全窗口已超时，未保存令牌。",
  "cloud.notice.incomplete": "请填写平台地址、workspace 和短期访问令牌。",
  "cloud.notice.vault": "本机加密凭据库不可用，不能保存云审片令牌。",
  "cloud.notice.saved": "云审片连接已保存；令牌只保存在本机加密凭据库。",
  "cloud.notice.selectFirst":
    "请先选择本地审片包、保存连接并选择至少一个媒体文件。",
  "cloud.notice.shotRequired": "每个上传媒体都必须显式关联一个分镜。",
  "cloud.notice.previewFirst": "请先计算 SHA-256 发布预览并确认当前上传清单。",
  "cloud.notice.published": "云审片包已发布，保留至 {at}；请只分享下方链接。",
  "cloud.notice.previewed":
    "已在本机计算 SHA-256；尚未创建云端审片包或上传媒体。",
  "cloud.notice.synced":
    "已按游标同步 {comments} 条意见和 {decisions} 条决定。",
  "cloud.notice.deletedKept": "云审片包已删除；本地已同步的意见和决定已保留。",
  "cloud.notice.deleted": "云审片包已删除。",

  "media.title": "整包审片的原版本保护",
  "media.description":
    "冻结完整 NLE 轨道、字幕、片段、原素材和归档元数据。审片决定只适用于原包；不读取当前文件，不核验文学质量、合法授权或账单，也不批准成片／字体／发行。旧审片包不自动升级。",
  "media.preview": "核对本轮整包来源",
  "media.preview.timeline":
    "原时间线 {id} · v{version} · {tracks} 轨／{shots} 镜头／{media} 素材",
  "media.preview.fingerprint": "原来源指纹：{sha}",
  "media.preview.confirm":
    "我已核对本轮原来源，明确创建此版本审片包；不表示审片通过或发行批准",
  "media.create": "创建原版本整包审片包",
  "media.pending": "原待核请求：{key} · {sha}",
  "media.pending.recover": "只读核对原审片请求",
  "media.pending.resend": "明确重发原审片请求",
  "media.pending.retain": "保留原拒绝记录，重新核对审片来源",
  "media.evidence": "核对当前包审片门",
  "media.export": "导出原整包审片资料 JSON",
  "media.evidence.package": "原包：{id} · 审片状态：{state}",
  "media.evidence.legacy":
    "旧包未绑定完整 NLE 原来源；历史决定不认证当前版本。",
  "media.evidence.fingerprint": "原包指纹：{sha} · 来源：{state}",
  "media.evidence.counts": "未解决意见：{open} · 有效决定：{effective}",
  "media.evidence.blockers": "阻断：{list}",
  "media.evidence.blockers.none":
    "当前原包机械审片门无阻断；不是内容质量或发行批准",
  "media.evidence.unknowns": "仍未知：{list}",
  "media.evidence.release": "releaseReady=false",
  "media.notice.failed":
    "原审片请求或资料未能核对；未改用最新包、重新提交或批准发行。",
  "media.notice.accepted": "已核对原整包 {id}；尚需明确审阅与决定。",
  "media.notice.invalid":
    "原待核记录损坏，已保留且阻断新创建；请先处理原记录。",
  "media.notice.unconfirmed":
    "原创建结果未能核对。保留原键与输入，可只读核对或明确重发原请求。",
  "media.notice.retained": "已保留原拒绝记录；请重新核对来源，不沿用原勾选。",
  "media.notice.exported": "已导出原 NLE 审片资料；不是当前文件或发行证明。",
  "media.notice.exportCancelled": "已取消原审片资料导出。",
  "media.owner.label": "原包逐素材owner证据",
  "media.owner.state": "原包素材证据：{state} · {count} 个原素材",
  "media.owner.boundary":
    "人工审片决定与素材证据分别记录；声明受限、服务不可用或缺少归档不能被人工 approve 擦除。正面声明不是合法授权或账单，历史读取不是当前文件核验；这里不批准发行。",
  "media.owner.blockers": "素材已知阻断：{list}",
  "media.owner.empty":
    "原包没有绑定媒体素材；不强制补媒体，也不声明文件或质量已通过。",
  "media.owner.asset": "原素材 {id} · v{version} · {binding}",
  "media.owner.fingerprint": "原素材指纹：{sha}",
  "media.owner.archive": "原包存档绑定：{binding}（只核元数据，不重读文件）",
  "media.owner.changed":
    "当前元数据 v{version} · 指纹 {sha}；不把它绑定为原包素材。",
  "media.owner.missing":
    "没有可用于原包的精确版本证据；不显示另一素材或最新成功记录。",
  "media.binding.exact": "与原包完整素材记录一致",
  "media.binding.changed": "原素材已变化，不换用新版本证据",
  "media.binding.missing": "原素材已缺失或不再属于本项目",
  "media.binding.owner-unavailable": "原素材证据读取能力不可用",
} as const;

/** English copy, key for key. */
export const stagesEn: Record<keyof typeof stagesZh, string> = {
  "notice.cancelled": "Export cancelled.",
  "busy.saving": "Saving…",
  "busy.exporting": "Exporting…",
  "busy.creating": "Creating…",
  "busy.preflight": "Checking…",

  "workflow.title": "Episode delivery checklist",
  "workflow.description":
    "Check, review, then preflight the delivery in order. Each item leaves a traceable task and report and changes no script, shot or delivery.",
  "workflow.legacy":
    "The old count score is retired; existing quality records are uncertified and do not mean the current quality passes.",
  "workflow.quality": "Open the standalone quality review",
  "workflow.list": "Episode delivery checklist",
  "workflow.run": "Run",
  "workflow.running": "Running the check and saving the report…",
  "workflow.state.running": "Running",
  "workflow.state.done": "Done this time",
  "workflow.state.failed": "Not finished",
  "workflow.state.idle": "Not run",
  "workflow.kind.compliance-check": "Run the compliance precheck",
  "workflow.kind.compliance-check.description":
    "Marks what needs a human check from the base risk terms and the archive state of the assets.",
  "workflow.kind.review-package": "Build the review package",
  "workflow.kind.review-package.description":
    "Collects the current script, scenes, shots and open items into a review list.",
  "workflow.kind.minimal-redo-plan": "Plan the smallest redo",
  "workflow.kind.minimal-redo-plan.description":
    "Orders the steps by their dependencies; rewrites nothing.",
  "workflow.kind.animatic-draft": "Draft the animatic",
  "workflow.kind.animatic-draft.description":
    "Builds a reviewable pacing timeline from the shots; fakes no video.",
  "workflow.kind.render-preflight": "Run the render preflight",
  "workflow.kind.render-preflight.description":
    "Checks whether the script, scenes, shots and assets are ready for a real render.",
  "workflow.kind.delivery-preflight": "Run the delivery preflight",
  "workflow.kind.delivery-preflight.description":
    "Checks whether the quality, compliance, review and localization records allow a delivery.",

  "records.quality.title": "Quality review",
  "records.review.title": "Compliance & review",
  "records.delivery.title": "Localization & delivery",
  "records.quality": "Quality check",
  "records.quality.description":
    "Record quality gates, issues, redos and their handling.",
  "records.quality.name": "Quality check name",
  "records.compliance": "Compliance check",
  "records.compliance.description":
    "Keep the compliance rules, precheck results and handling records.",
  "records.compliance.name": "Compliance check name",
  "records.localization": "Localization",
  "records.localization.description":
    "Manage subtitles, translations, dubbed versions and which one is adopted.",
  "records.localization.name": "Localized version name",
  "records.review": "Review",
  "records.review.description":
    "Collect offline or cloud review packages, comments and decisions.",
  "records.review.name": "Review package name",
  "records.delivery": "Delivery",
  "records.delivery.description":
    "Manage platform delivery settings, creative variants, preflights and exports.",
  "records.delivery.name": "Delivery task name",
  "records.field.episode": "Episode",
  "records.field.severity": "Severity",
  "records.field.issue": "Issue",
  "records.field.redo": "Redo plan",
  "records.field.ruleSource": "Rule source",
  "records.field.checkState": "Check state",
  "records.field.risk": "Risk and basis",
  "records.field.handling": "Handling",
  "records.field.language": "Target language",
  "records.field.subtitles": "Subtitles and translation",
  "records.field.adoption": "Adoption state",
  "records.field.reviewMode": "Review mode",
  "records.field.reviewState": "Review state",
  "records.field.comments": "Comments",
  "records.field.decisions": "Decisions and follow-up",
  "records.field.platform": "Target platform",
  "records.field.deliveryState": "Delivery state",
  "records.field.preflight": "Preflight result",
  "records.field.deliveryNote": "Delivery note",
  "records.action.adopt": "Adopt this localization",
  "records.action.adopted": "The localization is adopted.",
  "records.action.srt": "Export subtitles",
  "records.action.vtt": "Export web subtitles",
  "records.action.txt": "Export the translation draft as TXT",
  "records.action.subtitles.saved": "Subtitle file exported.",
  "records.action.subtitles.cancelled": "Subtitle export cancelled.",
  "records.action.export": "Export the delivery list",
  "records.action.export.saved": "Delivery list exported.",
  "records.action.export.cancelled": "Delivery list export cancelled.",

  "platform.workbench": "Platform delivery drafting",
  "platform.eyebrow": "Platform delivery",
  "platform.title": "Listing copy, cover and versioned submission archive",
  "platform.description":
    "No platform account, sign-in or upload is kept here. It only creates a traceable submission list; the real cut, subtitles and cover still need a human check and attachment.",
  "platform.catalog.failed":
    "The catalog could not be checked, which does not mean there are no variants or archives: {message}.",
  "platform.catalog.reload": "Read the catalog again",
  "platform.profile": "Platform delivery profile",
  "platform.profile.none": "Choose a platform profile",
  "platform.profile.option": "{title} · {width}×{height}",
  "platform.variant": "Current creative variant",
  "platform.variant.none": "Choose a creative AI draft",
  "platform.variant.option": "{label} · v{version} · {title}",
  "platform.profile.spec":
    "{platform} · {region} · {video}/{audio} · {width}×{height}",
  "platform.profile.duration":
    "Duration: {note} Subtitle safe zone: {margin} px from the bottom.",
  "platform.profile.manual": "I checked by hand: {fields}.",
  "platform.form.label": "Draft label",
  "platform.form.label.placeholder": "For example: Option one",
  "platform.form.label.default": "Option one",
  "platform.form.label.next": "Option {letter}",
  "platform.form.cover": "Cover asset",
  "platform.form.cover.none": "Choose an archived cover asset",
  "platform.form.title": "Platform title",
  "platform.form.title.placeholder": "The title viewers see",
  "platform.form.tags": "Tags",
  "platform.form.tags.placeholder":
    "Comma-separated, for example: mystery, twist",
  "platform.form.description": "Platform synopsis",
  "platform.form.description.placeholder":
    "Describe the conflict, hook and selling points; nothing is published.",
  "platform.form.save": "Save as a new draft",
  "platform.variants.title": "Creative AI drafts and adoption history",
  "platform.variants.empty":
    "No AI drafts yet. Save a full title, synopsis, tags and cover first.",
  "platform.variant.adopted": "Adopted",
  "platform.variant.historic": "Historic state (current adoption unverified)",
  "platform.variant.draft": "Draft",
  "platform.variant.adopt": "Adopt this draft",
  "platform.variant.adopting": "Adopting…",
  "platform.variant.meta": "Tags: {tags} · Cover: {cover}",
  "platform.cover.none": "None",
  "platform.preflight.run": "Run the platform delivery preflight",
  "platform.archive.create": "Create the submission archive",
  "platform.archive.creating": "Archiving…",
  "platform.pending":
    "The original {operation} request awaits a check: {key}; nothing is written, re-keyed, re-versioned or re-ticked on its own.",
  "platform.pending.adopt": "adoption",
  "platform.pending.archive": "archive",
  "platform.pending.recover": "Check the original request read-only",
  "platform.pending.resend": "Resend the original request with its key",
  "platform.pending.retain": "Keep the rejection and check the source again",
  "platform.archives.title": "Submission archive history",
  "platform.archives.empty": "No submission archive yet.",
  "platform.archive.version": "v{version}",
  "platform.archive.meta": "{profile} · {at}",
  "platform.archive.legacy":
    "Old record: no frozen preflight; it never becomes valid delivery evidence.",
  "platform.archive.frozen":
    "Original title: {title} · metadata SHA {sha} · not a pass of the current cut or release",
  "platform.archive.export": "Export the submission list",
  "platform.notice.mismatch":
    "The receipt does not match the original request; the request stays pending.",
  "platform.notice.adopted":
    "The original draft is adopted; choose again and recheck the preflight.",
  "platform.notice.archived":
    "The original preflight's submission is archived; this passes no cut, licence, settlement or release.",
  "platform.notice.retained":
    "The rejected request is kept on this machine; read the AI drafts again and check them, without the old preflight or consent.",
  "platform.notice.unconfirmed":
    "The original request's result is not confirmed and was not resubmitted: {message}",
  "platform.notice.stillPending":
    "The original request is still pending under its key: {message}",
  "platform.notice.invalidPending":
    "The local record of the original request is invalid; nothing was written. Check the record first.",
  "platform.notice.catalogBlocked":
    "The catalog could not be checked; a failed read is not an empty history. Refresh it first.",
  "platform.notice.catalogRefresh":
    "The catalog could not be checked; refresh the original versions first.",
  "platform.notice.pendingFirst": "Check the original pending request first.",
  "platform.notice.incomplete":
    "A draft needs a label, a title, a synopsis and at least one tag.",
  "platform.notice.saved":
    "Draft “{label}” saved; it still needs an explicit adoption before archiving.",
  "platform.notice.choose":
    "Choose a platform profile and a creative AI draft first.",
  "platform.notice.passed":
    "The preflight passed; a traceable submission list can be created.",
  "platform.notice.blocked":
    "The preflight found {count} blockers; complete them and try again.",
  "platform.notice.preflightFirst":
    "Run and pass the platform delivery preflight first.",
  "platform.notice.exported": "Submission list exported.",
  "platform.result.passed":
    "Preflight passed: the submission archive can be created",
  "platform.result.failed": "Preflight did not pass",
  "platform.result.scope":
    "Scope: submission metadata only; the cut's quality, the licence, the settlement, the current files and the platform spec are unverified.",
  "platform.result.original":
    "Original variant: {title} · v{version} · adopted revision {revision} · SHA {sha}",
  "platform.result.prefix": "Suggested file prefix: {name}",
  "platform.result.files":
    "Expected attachments (not yet made, attached or read): {files}.",

  "compliance.eyebrow": "Compliance rules and precheck",
  "compliance.title":
    "Versioned rules, human declarations and the pre-delivery check",
  "compliance.description":
    "A rule profile is local evidence, not legal advice; the precheck fakes no compliant MP4, watermark or platform review.",
  "compliance.profiles": "Rule profiles",
  "compliance.profile.active": "Active",
  "compliance.profile.official": "Official rule",
  "compliance.profile.reference": "Reference only",
  "compliance.profile.activate": "Activate this rule",
  "compliance.profile.meta":
    "Published: {date} · Integrity: {integrity} · Scope: {regions}",
  "compliance.integrity.verified": "Verified",
  "compliance.integrity.invalid": "Invalid",
  "compliance.integrity.unverified": "Unverified",
  "compliance.regions.none": "Unrestricted",
  "compliance.form.title": "Delivery title",
  "compliance.form.language": "Subtitle language",
  "compliance.form.language.default": "Chinese",
  "compliance.form.platform": "Target platform (optional)",
  "compliance.form.region": "Target region (optional)",
  "compliance.form.region.default": "Mainland China",
  "compliance.form.date": "Delivery date",
  "compliance.form.aigc":
    "I confirm this delivery contains AI-generated or synthetic content and agree to write the explicit and implicit labels the rules ask for.",
  "compliance.form.manual":
    "I checked by hand: minors, history and folklore, copyright, licences and filings.",
  "compliance.run": "Run the compliance precheck",
  "compliance.result.passed": "Compliance precheck passed",
  "compliance.result.failed": "Compliance precheck did not pass",
  "compliance.result.label": " · Fixed visible label: {label}",
  "compliance.result.fingerprint": "Evidence fingerprint: {sha}",
  "compliance.notice.activated": "Rule profile “{title}” activated.",
  "compliance.notice.incomplete":
    "Fill in the delivery title, the subtitle language and the delivery date.",
  "compliance.notice.passed":
    "The compliance precheck passed and can ground the controlled media packaging.",
  "compliance.notice.blocked": "The compliance precheck has blockers.",

  "editor.eyebrow": "Review and edit handover",
  "editor.title": "Offline review packages and a relinkable edit timeline",
  "editor.description":
    "The timeline exposes no absolute path, copies no media and poses as no cut. Relink the checked media by hand after importing it into the editor.",
  "editor.timeline.meta": "{count} shots · {width}×{height} · {rate} fps",
  "editor.timeline.manifest": "Export the timeline data",
  "editor.timeline.edl": "Export the edit list",
  "editor.timeline.fcpxml": "Export the edit project",
  "editor.timeline.srt": "Export subtitles",
  "editor.timeline.exported": "Edit exchange file exported.",
  "editor.preflight.ok": "The timeline can be exported",
  "editor.preflight.blocked": "The timeline has blockers",
  "editor.preflight.counts":
    "{state} · {referenced} referenced · {relink} to relink",
  "editor.clip.name": "{index}. {name}",
  "editor.clip.span": "{start}–{end} s · {state}",
  "editor.clip.referenced": "Media referenced",
  "editor.clip.relink": "Needs a manual relink",
  "editor.clip.subtitle": "Subtitle: {text}",
  "editor.packages.title": "Offline review packages",
  "editor.packages.description":
    "The export is a single-file Chinese review page; the comments JSON must be imported back into the current package explicitly.",
  "editor.package.create": "Create an offline review package",
  "editor.package.export": "Export the offline review page",
  "editor.package.import": "Import offline review comments",
  "editor.package.importing": "Importing…",
  "editor.package.current": "Current review package",
  "editor.package.none": "Choose a review package",
  "editor.package.option": "{title} · {at}",
  "editor.notice.created":
    "Offline review package created; export its single-file page for the reviewers.",
  "editor.notice.exported":
    "Offline review page exported. Reviewers fill in comments in a browser and export JSON.",
  "editor.notice.imported":
    "Imported {comments} review comments and {decisions} decisions.",
  "editor.revision.title": "AI revision from the review comments",
  "editor.revision.description":
    "Open comments and “return / request changes” decisions go into the preview as context; the script is not rewritten until applied.",
  "editor.revision.script": "Target script",
  "editor.revision.script.none": "Choose this episode's script",
  "editor.revision.script.option": "{title} · version {version}",
  "editor.revision.instruction":
    "Analyse the open review comments, locate the scenes involved, write the full script with local revisions and recheck the original issues.",
  "editor.revision.import": "Import an existing revision",
  "editor.revision.draft": "Revision draft",
  "editor.revision.draft.placeholder":
    "The script text to adopt, based on the review feedback",
  "editor.revision.create": "Create a revision preview to confirm",
  "editor.notice.revisionIncomplete":
    "Choose the target script and fill in the revision draft.",
  "editor.notice.revisionCreated":
    "Revision preview created; the script is not rewritten yet.",
  "editor.comment.title": "Record a review comment",
  "editor.comment.shot": "Shot",
  "editor.comment.shot.none": "Project-wide comment",
  "editor.comment.timecode": "Timecode (seconds)",
  "editor.comment.alias": "Signed as (optional)",
  "editor.comment.body": "Review comment",
  "editor.comment.body.placeholder":
    "Describe the issue, suggestion or confirmation",
  "editor.comment.save": "Save the review comment",
  "editor.comments.empty": "No review comments yet.",
  "editor.comment.state": "{state} · {alias}",
  "editor.comment.resolved": "Resolved",
  "editor.comment.open": "Open",
  "editor.comment.anonymous": "Unsigned",
  "editor.comment.reopen": "Mark as open",
  "editor.comment.resolve": "Mark as resolved",
  "editor.comment.at": "Timecode: {seconds} s",
  "editor.notice.commentIncomplete":
    "Choose a review package and write the comment first.",
  "editor.notice.commentSaved":
    "Review comment saved to the local package record.",
  "editor.decision.title": "Record a review decision",
  "editor.decision.label": "Decision",
  "editor.decision.field": "Review decision",
  "editor.decision.note": "Note only",
  "editor.decision.approve": "Approve",
  "editor.decision.return": "Return",
  "editor.decision.request_changes": "Request changes",
  "editor.decision.explain": "Decision note (optional)",
  "editor.decision.save": "Save the review decision",
  "editor.decisions.empty": "No review decisions yet.",
  "editor.decision.by": "{decision} · {alias}",
  "editor.notice.packageFirst": "Choose a review package first.",
  "editor.notice.decisionSaved":
    "Review decision saved; it grounds the later redo and delivery recheck.",

  "cloud.title": "Optional cloud review",
  "cloud.description":
    "Only the media chosen below is uploaded. The token goes only into this machine's encrypted vault; no project database, provider key or unchosen file is uploaded.",
  "cloud.configured": "Connection saved",
  "cloud.unconfigured": "Not configured",
  "cloud.baseUrl": "Platform address",
  "cloud.baseUrl.placeholder": "For example: https://review.example.com",
  "cloud.workspace": "Workspace ID",
  "cloud.workspace.placeholder": "An authorized workspace",
  "cloud.token": "Short-lived access token",
  "cloud.token.hint":
    "After saving the connection, enter it in a separate secure window; this page never sees the plain text.",
  "cloud.pin": "Share PIN (optional)",
  "cloud.pin.placeholder": "4–12 digits, for this publication only",
  "cloud.save": "Save the secure connection",
  "cloud.media.choose": "Choose the media to upload",
  "cloud.preview": "Compute the SHA-256 publication preview",
  "cloud.preview.busy": "Computing…",
  "cloud.publish": "Publish the chosen media",
  "cloud.publish.busy": "Publishing…",
  "cloud.sync": "Sync comments by cursor",
  "cloud.sync.busy": "Syncing…",
  "cloud.delete": "Revoke and delete the cloud review",
  "cloud.delete.busy": "Deleting…",
  "cloud.vault.unavailable": "This machine's encrypted vault is unavailable.",
  "cloud.media.title": "Publication list (uploaded only after confirmation)",
  "cloud.media.item": "{name} · {mime} · {path}",
  "cloud.media.shot": "Shot (required)",
  "cloud.media.shot.label": "Shot of {name}",
  "cloud.preview.title": "Computed publication preview (not uploaded yet)",
  "cloud.preview.storage":
    "Workspace: {workspace} · Storage: {used} / {max} bytes",
  "cloud.preview.retention": "Retention: {retention}",
  "cloud.preview.cost": "Cost: {cost}",
  "cloud.preview.media": "{path} · {size} bytes · SHA-256 {sha}",
  "cloud.preview.manifest": "View the review manifest",
  "cloud.preview.stale":
    "The upload list changed; compute the preview again before publishing.",
  "cloud.share": "Controlled share link created: {url}",
  "cloud.share.binding": " · State: {status} · Expires: {at}",
  "cloud.credential.label": "Cloud review short-lived access token",
  "cloud.credential.cancelled": "The secure window closed; no token was saved.",
  "cloud.credential.expired":
    "The secure window timed out; no token was saved.",
  "cloud.notice.incomplete":
    "Fill in the platform address, the workspace and the short-lived token.",
  "cloud.notice.vault":
    "This machine's encrypted vault is unavailable; the cloud review token cannot be saved.",
  "cloud.notice.saved":
    "Cloud review connection saved; the token stays in this machine's encrypted vault.",
  "cloud.notice.selectFirst":
    "Choose a local review package, save the connection and choose at least one media file first.",
  "cloud.notice.shotRequired": "Every uploaded medium needs an explicit shot.",
  "cloud.notice.previewFirst":
    "Compute the SHA-256 preview and confirm the current upload list first.",
  "cloud.notice.published":
    "Cloud review package published and kept until {at}; share only the link below.",
  "cloud.notice.previewed":
    "SHA-256 computed on this machine; no cloud package was created and nothing was uploaded.",
  "cloud.notice.synced":
    "Synced {comments} comments and {decisions} decisions by cursor.",
  "cloud.notice.deletedKept":
    "Cloud review package deleted; the comments and decisions synced locally are kept.",
  "cloud.notice.deleted": "Cloud review package deleted.",

  "media.title": "Original-version protection of the whole-package review",
  "media.description":
    "Freezes the full NLE tracks, subtitles, clips, original assets and archive metadata. A review decision applies only to the original package; no current file is read, no literary quality, licence or bill is verified, and no cut, font or release is approved. Old packages are not upgraded.",
  "media.preview": "Check this round's package source",
  "media.preview.timeline":
    "Original timeline {id} · v{version} · {tracks} tracks / {shots} shots / {media} assets",
  "media.preview.fingerprint": "Original source fingerprint: {sha}",
  "media.preview.confirm":
    "I checked this round's original source and explicitly create this version's review package; this approves no review or release",
  "media.create": "Create the original-version review package",
  "media.pending": "Original pending request: {key} · {sha}",
  "media.pending.recover": "Check the original review request read-only",
  "media.pending.resend": "Resend the original review request",
  "media.pending.retain":
    "Keep the rejection and check the review source again",
  "media.evidence": "Check the current package's review gate",
  "media.export": "Export the original package review JSON",
  "media.evidence.package": "Original package: {id} · Review state: {state}",
  "media.evidence.legacy":
    "The old package is not bound to a full NLE source; historic decisions certify no current version.",
  "media.evidence.fingerprint":
    "Original package fingerprint: {sha} · Source: {state}",
  "media.evidence.counts":
    "Open comments: {open} · Effective decisions: {effective}",
  "media.evidence.blockers": "Blockers: {list}",
  "media.evidence.blockers.none":
    "The original package's mechanical review gate has no blocker; this approves no content quality or release",
  "media.evidence.unknowns": "Still unknown: {list}",
  "media.evidence.release": "releaseReady=false",
  "media.notice.failed":
    "The original review request or record could not be checked; no newer package, resubmission or release approval was used instead.",
  "media.notice.accepted":
    "Original package {id} checked; it still needs an explicit review and decision.",
  "media.notice.invalid":
    "The original pending record is damaged; it is kept and blocks new packages. Handle it first.",
  "media.notice.unconfirmed":
    "The creation result could not be checked. The original key and input are kept; check it read-only or resend it explicitly.",
  "media.notice.retained":
    "The rejection is kept; check the source again, without the original tick.",
  "media.notice.exported":
    "Original NLE review record exported; it proves no current file or release.",
  "media.notice.exportCancelled": "Original review record export cancelled.",
  "media.owner.label": "Per-asset owner evidence of the original package",
  "media.owner.state":
    "Original package asset evidence: {state} · {count} original assets",
  "media.owner.boundary":
    "Human review decisions and asset evidence are recorded apart; a restricted declaration, an unavailable service or a missing archive cannot be erased by a human approve. A positive declaration is no licence or bill, and a historic read is no check of the current file; nothing here approves a release.",
  "media.owner.blockers": "Known asset blockers: {list}",
  "media.owner.empty":
    "The original package binds no media; none is required, and no file or quality is declared passed.",
  "media.owner.asset": "Original asset {id} · v{version} · {binding}",
  "media.owner.fingerprint": "Original asset fingerprint: {sha}",
  "media.owner.archive":
    "Original package archive binding: {binding} (metadata only, the file is not reread)",
  "media.owner.changed":
    "Current metadata v{version} · fingerprint {sha}; it is not bound as the original package's asset.",
  "media.owner.missing":
    "No exact-version evidence for the original package; no other asset or latest success is shown.",
  "media.binding.exact": "Matches the original package's full asset record",
  "media.binding.changed":
    "The original asset changed; newer evidence is not used",
  "media.binding.missing":
    "The original asset is gone or no longer in this project",
  "media.binding.owner-unavailable":
    "The original asset's evidence cannot be read",
};
