// Platform-owned fictional display content, not a Desktop project or model run.
export const STORY_CASE = {
  schemaVersion: 1,
  id: 'last-ferry-author-demo',
  revision: '2026-10-07.1',
  title: '最后一班渡船',
  evidenceKind: 'author-written-fictional',
  authorIntent: '保留林遥的主动性、母亲的未完成托付和渡口的时间压力。允许合并配角、压缩地点，不允许提前揭露她尚不知道的秘密。语气克制，以人物关系推进，不强制每章反转。',
  sourceScope: '两章作者展示稿，不是完整长篇小说；后续章节未提供。',
  chapters: [
    { id: 'chapter-1', title: '第一章：停航公告', content: '林遥回到渡口，只想替母亲取回寄存的木箱。停航公告把最后一班渡船定在黄昏。摆渡人陈叔说，箱子的钥匙不在他手里。林遥注意到，他一直用拇指遮住公告上的日期，却没有追问。她此时只知道母亲寄过箱子，不知道停航原因。' },
    { id: 'chapter-2', title: '第二章：箱子里的潮汐表', content: '林遥从码头登记员处找到了钥匙。箱中没有遗物，只有母亲标注过的一张潮汐表。她把表摊在陈叔面前，第一次听他说起：母亲曾要他等一个人，而那个人一直没有来。林遥仍不知道那人的姓名。她决定留下，赶在最后一次渡船前查清这份托付。' },
  ],
  memories: [
    { chapterId: 'chapter-1', known: '只知道母亲寄过木箱；不知道停航原因、托付或等待者姓名。', unresolved: '陈叔为何遮住公告日期？钥匙在哪里？' },
    { chapterId: 'chapter-2', known: '知道潮汐表与母亲托付；仍不知道等待者姓名。', unresolved: '那个人是谁？母亲为何要求等待？' },
  ],
  diagnosis: [
    { id: 'diagnosis-rhythm', title: '信息节奏', detail: '第一章的日期疑点适合成为首集悬念；不能在开场就揭露第二章才出现的托付。', sourceChapterIds: ['chapter-1', 'chapter-2'] },
    { id: 'diagnosis-agency', title: '人物主线', detail: '保留林遥从“取箱离开”到“留下调查”的主动选择，不改成旁人替她决定。', sourceChapterIds: ['chapter-1', 'chapter-2'] },
    { id: 'diagnosis-production', title: '制作约束', detail: '可将登记员信息合并为渡口登记簿，降低新增角色成本；这是作者的改编取舍，不修改小说原稿，也不是实际报价。', sourceChapterIds: ['chapter-2'] },
  ],
  strategies: [
    { id: 'strategy-a', title: '策略 A：克制悬疑（本展示稿选择）', detail: '按两章顺序展开，以日期疑点、托付与主动留下递进。保留认知边界，人物情绪优先于反转数量。' },
    { id: 'strategy-b', title: '策略 B：先见潮汐表', detail: '用箱中潮汐表开场，再回到取箱过程；节奏更快，但需额外说明叙事时间与林遥何时知情。作者可以拒绝，不改写原稿。' },
  ],
  selectedStrategyId: 'strategy-a',
  selectionKind: 'author-written-example-not-runtime-adoption',
  episodes: [
    { id: 'episode-1', title: '第 1 集：被遮住的日期', detail: '回乡取箱，发现停航公告的日期被遮住。', sourceChapterIds: ['chapter-1'], sourceScope: '第一章', turn: '悬念：陈叔为何回避日期？', additions: '具体场面调度、凭条道具及对白为作者展示性新增。' },
    { id: 'episode-2', title: '第 2 集：箱子不是告别', detail: '找到钥匙，读到潮汐表上的托付。', sourceChapterIds: ['chapter-2'], sourceScope: '第二章前半', turn: '转折：箱子不是告别，而是等待。', additions: '登记簿替代登记员是待作者确认的改编取舍，不是小说原事实。' },
    { id: 'episode-3', title: '第 3 集：留下来的人', detail: '林遥决定留下；候船人走向最后一班渡船。', sourceChapterIds: ['chapter-2'], sourceScope: '第二章后半', turn: '人物推进：由取物者成为调查者。', additions: '候船调度为展示性新增；等待者身份及后续结局未知，不虚构已覆盖。' },
  ],
  pilot: {
    episodeId: 'episode-1',
    title: '被遮住的日期',
    sourceChapterIds: ['chapter-1'],
    coverage: '本展示方案的完整首集剧本，不是整季剧本或实际采用成果。',
    additions: '凭条、候船台、汽笛、具体对白与动作节拍为作者的场面调度；不提前加入第二章托付、潮汐表或等待者姓名。',
    scenes: [
      { id: 'scene-1', heading: 'EXT. 渡口入口 - 黄昏', sourceChapterIds: ['chapter-1'], body: '林遥提着旅行袋走下石阶。她停在停航公告前。\n\n公告写着：最后一班渡船，黄昏发航。\n\n她摸出母亲留下的寄存凭条，沿码头走向值守桌。' },
      { id: 'scene-2', heading: 'EXT. 渡口值守桌 - 黄昏', sourceChapterIds: ['chapter-1'], body: '陈叔把木箱推到桌边。林遥放下凭条，伸手试了试箱锁。\n\n@林遥\n我来取母亲的箱子。钥匙也寄在您这里吗？\n\n@陈叔\n箱子在。钥匙不在我手里。\n\n林遥看向桌角的另一张停航公告。陈叔挪过手，用拇指压住了日期。\n\n@林遥\n这就是最后一班？\n\n@陈叔\n黄昏发航。\n\n他没有回答日期。林遥把凭条折好，没有追问。' },
      { id: 'scene-3', heading: 'EXT. 渡口候船台 - 黄昏', sourceChapterIds: ['chapter-1'], body: '远处响起汽笛。林遥看了看箱锁，又看向陈叔压住公告的手。\n\n她放下旅行袋，留在桌边等钥匙的线索。\n\n近景：公告边角掀起，日期仍被拇指遮住。\n\n林遥没有伸手揭开。她的目光停在那里。\n\nCUT TO BLACK.\n\n首集结束。' },
    ],
  },
  shots: [
    { id: 'shot-1', sceneId: 'scene-1', frame: '远景', action: '黄昏渡口，林遥走下石阶。', sourceChapterIds: ['chapter-1'], sourceNote: '回到渡口；石阶与调度为展示性新增。' },
    { id: 'shot-2', sceneId: 'scene-1', frame: '特写', action: '最后一班渡船的公告与寄存凭条。', sourceChapterIds: ['chapter-1'], sourceNote: '停航公告／取箱目标；凭条为展示性新增。' },
    { id: 'shot-3', sceneId: 'scene-2', frame: '双人中景', action: '林遥试箱锁，陈叔说明钥匙不在手中。', sourceChapterIds: ['chapter-1'], sourceNote: '钥匙线索；具体动作和对白为作者调度。' },
    { id: 'shot-4', sceneId: 'scene-2', frame: '特写', action: '陈叔拇指遮住公告日期。', sourceChapterIds: ['chapter-1'], sourceNote: '第一章明确疑点。' },
    { id: 'shot-5', sceneId: 'scene-2', frame: '近景', action: '林遥收起凭条，没有追问。', sourceChapterIds: ['chapter-1'], sourceNote: '注意疑点而未追问；收凭条为展示性新增。' },
    { id: 'shot-6', sceneId: 'scene-3', frame: '近景转特写', action: '林遥留在桌边，目光与被遮住的日期交替。', sourceChapterIds: ['chapter-1'], sourceNote: '首集停在第一章认知边界；候船调度为展示性新增。' },
  ],
  handoff: {
    kind: 'author-demo-data-not-dramaip-project-package',
    mediaRequired: false,
    included: ['两章小说与认知记忆', '作者意图', '三项诊断', '两种策略及展示稿选择', '三集季纲与来源／新增说明', '完整首集三场剧本', '六镜头分镜及来源', '交付缺口与证据边界'],
    missing: ['图片／配音／视频未制作', '实际时长／拍摄与制作可行性未验证', '实际模型运行／用量／账单未提供', 'Runtime正式采用／保存回执未提供', '真实用户反馈与文学质量未验证', '公开／改编／发行授权未核验'],
  },
  qualityConclusion: 'not-established',
  releaseReady: false,
} as const

export const STORY_CASE_ARTIFACTS = [
  { file: 'manuscript.txt', label: '下载两章小说展示稿', mediaType: 'text/plain; charset=utf-8' },
  { file: 'pilot.fountain', label: '下载完整首集剧本展示稿', mediaType: 'text/plain; charset=utf-8' },
  { file: 'storyboard.csv', label: '下载六镜头分镜展示表', mediaType: 'text/csv; charset=utf-8' },
  { file: 'adaptation-demo.json', label: '下载完整结构化改编展示稿', mediaType: 'application/json; charset=utf-8' },
] as const

const boundary = '作者编写的虚构展示稿；不是AI运行、Runtime正式采用、用户测试或发行证据。下载不表示公开／改编／发行授权已核验。'
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`

export function storyCaseArtifact(file: string) {
  const descriptor = STORY_CASE_ARTIFACTS.find((artifact) => artifact.file === file)
  if (!descriptor) return undefined
  let body: string
  switch (descriptor.file) {
    case 'manuscript.txt':
      body = `${STORY_CASE.title}\n版本：${STORY_CASE.revision}\n${boundary}\n范围：${STORY_CASE.sourceScope}\n\n作者意图：${STORY_CASE.authorIntent}\n\n${STORY_CASE.chapters.map((chapter) => `${chapter.title}\n\n${chapter.content}`).join('\n\n')}\n\n连续性记忆（作者展示稿，不是自动核验）：\n${STORY_CASE.memories.map((memory) => `${memory.chapterId}：${memory.known} 待解：${memory.unresolved}`).join('\n')}\n`
      break
    case 'pilot.fountain':
      body = `Title: ${STORY_CASE.title} / 首集：${STORY_CASE.pilot.title}\nCredit: 作者编写的虚构展示稿\nDraft date: ${STORY_CASE.revision}\n\n[[${boundary} 来源：第一章；${STORY_CASE.pilot.additions}]]\n\n${STORY_CASE.pilot.scenes.map((scene) => `${scene.heading}\n\n${scene.body}`).join('\n\n')}\n`
      break
    case 'storyboard.csv':
      body = '\uFEFF' + [
        ['镜头ID', '场景ID', '景别', '动作', '来源章节', '来源／新增说明', '证据边界'],
        ...STORY_CASE.shots.map((shot) => [shot.id, shot.sceneId, shot.frame, shot.action, shot.sourceChapterIds.join('|'), shot.sourceNote, boundary]),
      ].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
      break
    case 'adaptation-demo.json':
      body = JSON.stringify({ ...STORY_CASE, boundary }, null, 2) + '\n'
      break
  }
  return { ...descriptor, body }
}

export const storyCaseFileURL = (file: (typeof STORY_CASE_ARTIFACTS)[number]['file']) => `/cases/story/files/${file}`
