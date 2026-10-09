// Platform owns its public copy; this module does not import Desktop artifacts.
export const PRODUCT_POSITIONING = {
  brand: '尽意 DramaIP',
  promise: '尽作者之意，成万象之作',
  category: '面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台',
  adaptationHeadline: '从小说到分集剧本，让故事走向短剧。',
  novelHeadline: '把故事写下去，让人物与世界前后一致。',
  description: '持续创作小说与故事母本，或从创意、已有小说、大纲和剧本开发分集剧本与分镜交付。作者掌握原稿、版本、来源和最终采用权；小说可以独立完成，不必改编或生成视频。',
} as const

export const ADAPTATION_JOURNEY = [
  { title: '原著与作者意图', detail: '确认来源、创作目标与必须保留的表达。', state: '素材与目标' },
  { title: '改编诊断', detail: '比较保留、合并、重排和制作风险。', state: '优化目标' },
  { title: '整季分集方案', detail: '核对人物推进、伏笔和原著覆盖。', state: '优化目标' },
  { title: '首集标准剧本', detail: '审阅候选与来源，再决定采用。', state: '剧本成果' },
  { title: '首集分镜试制包', detail: '以结构化交付连接下游工具，媒体生成可选。', state: '交付目标' },
] as const

export const NOVEL_JOURNEY = ['人物与大纲', '本章生成与修订', '审阅采用', '连续性记忆', '下一章或稿件导出'] as const

export const PLAN_DESCRIPTIONS: Record<string, string> = {
  free: '从故事与独立小说开始，按实际平台权益选用资源，不强制改编或媒体。',
  creator: '面向独立作者与编剧，按需要增加专业交付；不要求先做视频。',
  studio: '面向小型内容工作室，在本地创作基础上按需要使用席位与云审片。',
  enterprise: '按团队需要选择私有网关、席位、容量与数据治理。',
}

export function desktopReleaseInfo(input: { url?: string; version?: string; sha256?: string }) {
  let validURL = false
  try {
    const url = new URL(input.url ?? '')
    validURL = url.protocol === 'https:' && !url.username && !url.password && !url.hostname.endsWith('.invalid')
  } catch { /* Missing or malformed configuration is not a release. */ }
  const version = input.version?.trim() || undefined
  const sha256 = input.sha256?.trim()
  return {
    version,
    sha256,
    url: validURL ? input.url : undefined,
    configured: Boolean(validURL && version && sha256 && /^[a-f0-9]{64}$/i.test(sha256)),
  }
}
