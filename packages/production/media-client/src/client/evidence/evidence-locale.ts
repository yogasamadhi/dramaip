/** Copy of the read-only delivery evidence of one media record. */
export const evidenceZh = {
  "evidence.record":
    "原素材 {recordId} · v{version}；只读元数据，不是整包交付验收。",
  "evidence.unverified":
    "内容质量未核验 · 合法授权未核验 · 实际结算未知 · 当前文件未读取；不能据此放行发行。",
  "evidence.declarations":
    "实际来源：{source}；可编辑权利声明：{rights}；费用声明：{cost}；服务声明：{provider}。",
  "evidence.archive":
    "原素材存档 {artifactId} · {size} 字节 · SHA {sha}（不是本次字节验证）",
  "evidence.archive.none":
    "没有当前精确版本的单一有效素材 存档，不使用内嵌预览或可编辑路径替代。",
  "evidence.read":
    "最近原版本完整读取凭证 {id} · {at} · SHA {sha} · {binding}；只证明记录时间，不证明现在完整、可解码或已审阅。",
  "evidence.read.none":
    "没有已记录的原版本完整读取凭证；不把加载成功或任务成功补成凭证。",
  "evidence.blockers": "已知阻断：{list}",
  "evidence.blocker": "{label}（{code}）",
  "evidence.blockers.none":
    "本次元数据没有已知负面标记；未知项仍未通过，不等于可交付。",
  "evidence.source.current": "原记录版本一致",
  "evidence.source.stale": "原来源已变化",
  "evidence.source.unverified": "原来源未核验",
  "evidence.source.unbound": "没有来源绑定",
  "evidence.declaration.user-reported-cleared":
    "用户声明已核验（不是授权凭证）",
  "evidence.declaration.user-reported-restricted": "用户声明受限／撤回／过期",
  "evidence.declaration.user-reported-known": "用户声明已知（不是结算回执）",
  "evidence.declaration.user-reported-available":
    "用户声明可用（不是能力核验）",
  "evidence.declaration.user-reported-unavailable": "用户声明不可用",
  "evidence.declaration.user-reported-not-required": "用户声明无需服务",
  "evidence.declaration.not-provided": "未提供声明",
  "evidence.binding.matching-archive-metadata":
    "与当前存档元数据一致（未重读字节）",
  "evidence.binding.changed-archive-metadata":
    "当前存档元数据已变化（不沿用原字节证明）",
  "evidence.binding.not-rechecked": "没有核对当前存档字节",
  "evidence.blocker.DECLARED_RIGHTS_RESTRICTED": "用户声明权利受限、撤回或过期",
  "evidence.blocker.DECLARED_PROVIDER_UNAVAILABLE": "用户声明服务不可用",
  "evidence.blocker.SOURCE_STALE": "原来源已变化",
  "evidence.blocker.SOURCE_UNVERIFIED": "原来源尚未核验",
  "evidence.blocker.ARCHIVE_UNAVAILABLE": "缺少指定版本的单一有效存档",
} as const;

/** English copy, key for key. */
export const evidenceEn: Record<keyof typeof evidenceZh, string> = {
  "evidence.record":
    "Original asset {recordId} · v{version}; read-only metadata, not the acceptance of a whole delivery.",
  "evidence.unverified":
    "Content quality unverified · lawful licence unverified · actual settlement unknown · current file not read; nothing here releases a delivery.",
  "evidence.declarations":
    "Actual source: {source}; editable rights declaration: {rights}; cost declaration: {cost}; service declaration: {provider}.",
  "evidence.archive":
    "Original asset archive {artifactId} · {size} bytes · SHA {sha} (not a byte check of this read)",
  "evidence.archive.none":
    "No single valid archive of this exact version; no inline preview or editable path stands in for it.",
  "evidence.read":
    "Latest full read of the original version {id} · {at} · SHA {sha} · {binding}; it proves only when it was recorded, not that the file is whole, decodable or reviewed now.",
  "evidence.read.none":
    "No recorded full read of the original version; a load or a task success is never turned into one.",
  "evidence.blockers": "Known blockers: {list}",
  "evidence.blocker": "{label} ({code})",
  "evidence.blockers.none":
    "This metadata carries no known negative mark; unknown items still have not passed and do not make it deliverable.",
  "evidence.source.current": "Matches the original record version",
  "evidence.source.stale": "The original source changed",
  "evidence.source.unverified": "The original source is unverified",
  "evidence.source.unbound": "No source binding",
  "evidence.declaration.user-reported-cleared":
    "Declared cleared by the user (not a licence)",
  "evidence.declaration.user-reported-restricted":
    "Declared restricted, withdrawn or expired by the user",
  "evidence.declaration.user-reported-known":
    "Declared known by the user (not a settlement receipt)",
  "evidence.declaration.user-reported-available":
    "Declared available by the user (not a capability check)",
  "evidence.declaration.user-reported-unavailable":
    "Declared unavailable by the user",
  "evidence.declaration.user-reported-not-required":
    "Declared not required by the user",
  "evidence.declaration.not-provided": "No declaration",
  "evidence.binding.matching-archive-metadata":
    "Matches the current archive metadata (bytes not reread)",
  "evidence.binding.changed-archive-metadata":
    "The current archive metadata changed (the original byte proof does not carry over)",
  "evidence.binding.not-rechecked":
    "The current archive bytes were not checked",
  "evidence.blocker.DECLARED_RIGHTS_RESTRICTED":
    "Rights declared restricted, withdrawn or expired by the user",
  "evidence.blocker.DECLARED_PROVIDER_UNAVAILABLE":
    "Service declared unavailable by the user",
  "evidence.blocker.SOURCE_STALE": "The original source changed",
  "evidence.blocker.SOURCE_UNVERIFIED":
    "The original source is not verified yet",
  "evidence.blocker.ARCHIVE_UNAVAILABLE":
    "No single valid archive of the named version",
};
