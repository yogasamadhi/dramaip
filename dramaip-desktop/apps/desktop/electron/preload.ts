// preload —— 通过 contextBridge 暴露受控的 window.api（项目说明.md §17：React 不直连模型/DB）
import { contextBridge, ipcRenderer } from 'electron'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error'

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const api = {
  search: {
    global: (input: { query: string; limit?: number }) => invoke('search:global', input),
  },
  asset: {
    listByProject: (projectId: string) => invoke('asset:listByProject', projectId),
    listBySource: (sourceEntityKind: string, sourceEntityId: string) => invoke('asset:listBySource', sourceEntityKind, sourceEntityId),
    create: (data: unknown) => invoke('asset:create', data),
    update: (id: string, patch: unknown) => invoke('asset:update', id, patch),
    remove: (id: string) => invoke('asset:delete', id),
  },
  log: {
    renderer: (level: RendererLogLevel, scope: string, message: string, meta?: unknown) =>
      invoke('log:renderer', level, scope, message, meta),
  },
  diagnostic: {
    exportPackage: (options?: { includeContent?: boolean }) =>
      invoke('diagnostic:exportPackage', options ?? {}),
  },
  security: {
    getSecretStorageStatus: () => invoke('security:getSecretStorageStatus'),
  },
  cloudAuth: {
    status: () => invoke('cloudAuth:status'),
    login: () => invoke('cloudAuth:login'),
    logout: () => invoke('cloudAuth:logout'),
    context: () => invoke('cloudAuth:context'),
  },
  cloudAI: {
    models: () => invoke('cloudAI:models'),
    onBalance: (onBalance: (balance: { remainingTokens: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, balance: { remainingTokens: number }) => onBalance(balance)
      ipcRenderer.on('cloudAI:balance', listener)
      return () => ipcRenderer.removeListener('cloudAI:balance', listener)
    },
  },
  cloudHandoff: {
    list: () => invoke('cloudHandoff:list'),
    adopt: (input: { projectId: string; draftId: string }) => invoke('cloudHandoff:adopt', input),
  },
  dataBackup: {
    list: () => invoke('dataBackup:list'),
    create: () => invoke('dataBackup:create'),
    restore: (path: string) => invoke('dataBackup:restore', path),
  },
  longTask: {
    list: (projectId?: string) => invoke('longTask:list', projectId),
    get: (id: string) => invoke('longTask:get', id),
    cancel: (id: string) => invoke('longTask:cancel', id),
    retry: (id: string) => invoke('longTask:retry', id),
  },
  batchTask: {
    run: (input: unknown) => invoke('batchTask:run', input),
  },
  project: {
    list: () => invoke('project:list'),
    listHomeSummaries: () => invoke('project:listHomeSummaries'),
    get: (id: string) => invoke('project:get', id),
    create: (data: unknown) => invoke('project:create', data),
    update: (id: string, patch: unknown) => invoke('project:update', id, patch),
    trash: (id: string) => invoke('project:trash', id),
    listTrash: () => invoke('project:listTrash'),
    restore: (id: string) => invoke('project:restore', id),
    deletionPreview: (id: string) => invoke('project:deletionPreview', id),
    purge: (id: string, confirmationTitle: string) => invoke('project:purge', id, confirmationTitle),
    // v1.0：导入项目包
    importPackage: () => invoke('project:importPackage'),
  },
  chapter: {
    list: (projectId: string) => invoke('chapter:list', projectId),
    get: (id: string) => invoke('chapter:get', id),
    create: (data: unknown) => invoke('chapter:create', data),
    update: (id: string, patch: unknown) => invoke('chapter:update', id, patch),
    reorder: (projectId: string, orderedIds: string[]) => invoke('chapter:reorder', projectId, orderedIds),
    updateContent: (id: string, content: string) => invoke('chapter:updateContent', id, content),
    remove: (id: string) => invoke('chapter:delete', id),
  },
  character: {
    list: (projectId: string) => invoke('character:list', projectId),
    create: (data: unknown) => invoke('character:create', data),
    update: (id: string, patch: unknown) => invoke('character:update', id, patch),
    remove: (id: string) => invoke('character:delete', id),
  },
  outline: {
    list: (projectId: string, type?: 'book' | 'chapter') => invoke('outline:list', projectId, type),
    create: (data: unknown) => invoke('outline:create', data),
    update: (id: string, patch: unknown) => invoke('outline:update', id, patch),
    remove: (id: string) => invoke('outline:delete', id),
  },
  storyArc: {
    list: (projectId: string, kind?: 'volume' | 'unit' | 'stage') => invoke('storyArc:list', projectId, kind),
    create: (data: unknown) => invoke('storyArc:create', data),
    update: (id: string, patch: unknown) => invoke('storyArc:update', id, patch),
    remove: (id: string) => invoke('storyArc:delete', id),
  },
  projectSkill: {
    list: (projectId: string) => invoke('projectSkill:list', projectId),
    create: (data: unknown) => invoke('projectSkill:create', data),
    update: (id: string, patch: unknown) => invoke('projectSkill:update', id, patch),
    remove: (id: string) => invoke('projectSkill:delete', id),
  },
  projectAgentScheme: {
    list: (projectId: string) => invoke('projectAgentScheme:list', projectId),
    getActive: (projectId: string) => invoke('projectAgentScheme:getActive', projectId),
    create: (data: unknown) => invoke('projectAgentScheme:create', data),
    update: (id: string, patch: unknown) => invoke('projectAgentScheme:update', id, patch),
    setActive: (id: string) => invoke('projectAgentScheme:setActive', id),
    remove: (id: string) => invoke('projectAgentScheme:delete', id),
  },
  inspirationFavorite: {
    list: (projectId: string) => invoke('inspirationFavorite:list', projectId),
    upsert: (data: unknown) => invoke('inspirationFavorite:upsert', data),
    importMobile: (data: unknown) => invoke('inspirationFavorite:importMobile', data),
    remove: (id: string) => invoke('inspirationFavorite:delete', id),
    removeByCardKey: (projectId: string, cardKey: string) =>
      invoke('inspirationFavorite:deleteByCardKey', projectId, cardKey),
  },
  evaluation: {
    list: (projectId: string) => invoke('evaluation:list', projectId),
  },
  aiRun: {
    list: (projectId: string) => invoke('aiRun:list', projectId),
    listRecent: (projectId?: string) => invoke('aiRun:listRecent', projectId),
    contextPreview: (id: string) => invoke('aiRun:contextPreview', id),
    exportDebugContext: (id: string) => invoke('aiRun:exportDebugContext', id),
    // v1.0
    summarize: () => invoke('aiRun:summarize'),
    summarizeUsage: () => invoke('aiRun:summarizeUsage'),
  },
  model: {
    list: () => invoke('model:list'),
    getDefault: () => invoke('model:getDefault'),
    create: (data: unknown) => invoke('model:create', data),
    update: (id: string, patch: unknown) => invoke('model:update', id, patch),
    remove: (id: string) => invoke('model:delete', id),
    setDefault: (id: string) => invoke('model:setDefault', id),
    // v1.0
    listTaskBindings: () => invoke('model:listTaskBindings'),
    upsertTaskBinding: (taskGroup: string, modelConfigId: string) =>
      invoke('model:upsertTaskBinding', taskGroup, modelConfigId),
    deleteTaskBinding: (taskGroup: string) => invoke('model:deleteTaskBinding', taskGroup),
    getBudgetSettings: () => invoke('model:getBudgetSettings'),
    updateBudgetSettings: (patch: unknown) => invoke('model:updateBudgetSettings', patch),
    testConnection: (config: unknown) => invoke('model:testConnection', config),
  },
  ai: {
    run: (input: {
      projectId?: string
      chapterId?: string
      characterId?: string
      adaptationProjectId?: string
      partialAdopt?: boolean
      episodeId?: string
      sceneId?: string
      shotId?: string
      taskType: string
      userInstruction?: string
      chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
      templateContent?: string
      templateScope?: string
    }) => invoke('ai:run', input),
    runStream: (
      input: {
        projectId?: string
        chapterId?: string
        characterId?: string
        adaptationProjectId?: string
        episodeId?: string
        sceneId?: string
        shotId?: string
        taskType: string
        userInstruction?: string
        chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
        templateContent?: string
        templateScope?: string
      },
      onChunk: (chunk: string) => void,
    ) => {
      const requestId = createRequestId()
      const listener = (_event: Electron.IpcRendererEvent, payload: { requestId: string; chunk: string }) => {
        if (payload.requestId === requestId) onChunk(payload.chunk)
      }
      ipcRenderer.on('ai:stream:chunk', listener)
      return invoke('ai:runStream', input, requestId).finally(() => {
        ipcRenderer.removeListener('ai:stream:chunk', listener)
      })
    },
    applyResult: (input: {
      projectId?: string
      taskType: string
      data: unknown
      characterId?: string
      adaptationProjectId?: string
    }) =>
      invoke('ai:applyResult', input),
  },
  // v0.2 长篇一致性与视觉记忆系统
  chapterMemory: {
    list: (projectId: string) => invoke('chapterMemory:list', projectId),
    get: (id: string) => invoke('chapterMemory:get', id),
    create: (data: unknown) => invoke('chapterMemory:create', data),
    update: (id: string, patch: unknown) => invoke('chapterMemory:update', id, patch),
    remove: (id: string) => invoke('chapterMemory:delete', id),
  },
  characterState: {
    list: (projectId: string) => invoke('characterState:list', projectId),
    listByCharacter: (characterId: string) => invoke('characterState:listByCharacter', characterId),
    create: (data: unknown) => invoke('characterState:create', data),
    remove: (id: string) => invoke('characterState:delete', id),
  },
  visualProfile: {
    list: (projectId: string) => invoke('visualProfile:list', projectId),
    getByCharacter: (characterId: string) => invoke('visualProfile:getByCharacter', characterId),
    create: (data: unknown) => invoke('visualProfile:create', data),
    update: (id: string, patch: unknown) => invoke('visualProfile:update', id, patch),
    remove: (id: string) => invoke('visualProfile:delete', id),
  },
  visualSetting: {
    list: (projectId: string) => invoke('visualSetting:list', projectId),
    create: (data: unknown) => invoke('visualSetting:create', data),
    update: (id: string, patch: unknown) => invoke('visualSetting:update', id, patch),
    remove: (id: string) => invoke('visualSetting:delete', id),
  },
  storyEvent: {
    list: (projectId: string) => invoke('storyEvent:list', projectId),
    create: (data: unknown) => invoke('storyEvent:create', data),
    update: (id: string, patch: unknown) => invoke('storyEvent:update', id, patch),
    remove: (id: string) => invoke('storyEvent:delete', id),
  },
  foreshadowing: {
    list: (projectId: string) => invoke('foreshadowing:list', projectId),
    create: (data: unknown) => invoke('foreshadowing:create', data),
    update: (id: string, patch: unknown) => invoke('foreshadowing:update', id, patch),
    remove: (id: string) => invoke('foreshadowing:delete', id),
  },
  // v0.3 AI 短剧小说强化系统
  beat: {
    list: (projectId: string) => invoke('beat:list', projectId),
    listByChapter: (chapterId: string) => invoke('beat:listByChapter', chapterId),
    create: (data: unknown) => invoke('beat:create', data),
    update: (id: string, patch: unknown) => invoke('beat:update', id, patch),
    remove: (id: string) => invoke('beat:delete', id),
  },
  highlight: {
    list: (projectId: string) => invoke('highlight:list', projectId),
    create: (data: unknown) => invoke('highlight:create', data),
    remove: (id: string) => invoke('highlight:delete', id),
  },
  feasibility: {
    list: (projectId: string) => invoke('feasibility:list', projectId),
    create: (data: unknown) => invoke('feasibility:create', data),
    remove: (id: string) => invoke('feasibility:delete', id),
  },
  dramaTrend: {
    get: (projectId: string) => invoke('dramaTrend:get', projectId),
    remove: (id: string) => invoke('dramaTrend:delete', id),
  },
  // v0.4 改编分集大纲
  adaptationProject: {
    list: () => invoke('adaptationProject:list'),
    listByProject: (sourceProjectId: string) => invoke('adaptationProject:listByProject', sourceProjectId),
    get: (id: string) => invoke('adaptationProject:get', id),
    create: (data: unknown) => invoke('adaptationProject:create', data),
    update: (id: string, patch: unknown) => invoke('adaptationProject:update', id, patch),
    remove: (id: string) => invoke('adaptationProject:delete', id),
  },
  episode: {
    list: (adaptationProjectId: string) => invoke('episode:list', adaptationProjectId),
    create: (data: unknown) => invoke('episode:create', data),
    update: (id: string, patch: unknown) => invoke('episode:update', id, patch),
    reorder: (orderedIds: string[]) => invoke('episode:reorder', orderedIds),
    remove: (id: string) => invoke('episode:delete', id),
  },
  episodeAnalysis: {
    get: (adaptationProjectId: string) => invoke('episodeAnalysis:get', adaptationProjectId),
    remove: (id: string) => invoke('episodeAnalysis:delete', id),
  },
  // v0.5 AI 短剧剧本生成
  script: {
    list: (adaptationProjectId: string) => invoke('script:list', adaptationProjectId),
    get: (id: string) => invoke('script:get', id),
    getByEpisode: (episodeId: string) => invoke('script:getByEpisode', episodeId),
    create: (data: unknown) => invoke('script:create', data),
    update: (id: string, patch: unknown) => invoke('script:update', id, patch),
    updateContent: (id: string, content: string) => invoke('script:updateContent', id, content),
    remove: (id: string) => invoke('script:delete', id),
  },
  scene: {
    listByScript: (scriptId: string) => invoke('scene:listByScript', scriptId),
    update: (id: string, patch: unknown) => invoke('scene:update', id, patch),
    remove: (id: string) => invoke('scene:delete', id),
  },
  scriptReview: {
    get: (scriptId: string) => invoke('scriptReview:get', scriptId),
    remove: (id: string) => invoke('scriptReview:delete', id),
  },
  // v0.6 分镜与镜头 Prompt 生成
  shot: {
    listByScene: (sceneId: string) => invoke('shot:listByScene', sceneId),
    listByEpisode: (episodeId: string) => invoke('shot:listByEpisode', episodeId),
    get: (id: string) => invoke('shot:get', id),
    create: (data: unknown) => invoke('shot:create', data),
    update: (id: string, patch: unknown) => invoke('shot:update', id, patch),
    remove: (id: string) => invoke('shot:delete', id),
  },
  shotReview: {
    get: (shotId: string) => invoke('shotReview:get', shotId),
    remove: (id: string) => invoke('shotReview:delete', id),
  },
  promptVersion: {
    list: (shotId: string) => invoke('promptVersion:list', shotId),
  },
  // v0.7 AI 视频平台对接
  videoProvider: {
    list: () => invoke('videoProvider:list'),
    getDefault: () => invoke('videoProvider:getDefault'),
    create: (data: unknown) => invoke('videoProvider:create', data),
    update: (id: string, patch: unknown) => invoke('videoProvider:update', id, patch),
    remove: (id: string) => invoke('videoProvider:delete', id),
    setDefault: (id: string) => invoke('videoProvider:setDefault', id),
  },
  videoTask: {
    list: () => invoke('videoTask:list'),
    listByShot: (shotId: string) => invoke('videoTask:listByShot', shotId),
    listByEpisode: (episodeId: string) => invoke('videoTask:listByEpisode', episodeId),
    get: (id: string) => invoke('videoTask:get', id),
    create: (input: unknown) => invoke('videoTask:create', input),
    checkStatus: (taskId: string) => invoke('videoTask:checkStatus', taskId),
    retry: (taskId: string, providerConfigId?: string) => invoke('videoTask:retry', taskId, providerConfigId),
    update: (id: string, patch: unknown) => invoke('videoTask:update', id, patch),
    remove: (id: string) => invoke('videoTask:delete', id),
  },
  videoResult: {
    listByTask: (taskId: string) => invoke('videoResult:listByTask', taskId),
    listByShot: (shotId: string) => invoke('videoResult:listByShot', shotId),
    compare: (shotId: string) => invoke('videoResult:compare', shotId),
    selectBest: (resultId: string) => invoke('videoResult:selectBest', resultId),
    update: (id: string, patch: unknown) => invoke('videoResult:update', id, patch),
    remove: (id: string) => invoke('videoResult:delete', id),
  },
  export: {
    projectMarkdown: (projectId: string) => invoke('export:projectMarkdown', projectId),
    projectJson: (projectId: string) => invoke('export:projectJson', projectId),
    novelSubmissionMarkdown: (projectId: string, options?: unknown) => invoke('export:novelSubmissionMarkdown', projectId, options),
    novelSubmissionJson: (projectId: string, options?: unknown) => invoke('export:novelSubmissionJson', projectId, options),
    dramaProposalMarkdown: (adaptationId: string, options?: unknown) => invoke('export:dramaProposalMarkdown', adaptationId, options),
    dramaProposalJson: (adaptationId: string, options?: unknown) => invoke('export:dramaProposalJson', adaptationId, options),
    dramaEpisodeDeliveryMarkdown: (adaptationId: string, options?: unknown) => invoke('export:dramaEpisodeDeliveryMarkdown', adaptationId, options),
    dramaEpisodeDeliveryJson: (adaptationId: string, options?: unknown) => invoke('export:dramaEpisodeDeliveryJson', adaptationId, options),
    dramaShotDeliveryMarkdown: (adaptationId: string, options?: unknown) => invoke('export:dramaShotDeliveryMarkdown', adaptationId, options),
    dramaShotDeliveryJson: (adaptationId: string, options?: unknown) => invoke('export:dramaShotDeliveryJson', adaptationId, options),
    dramaShotDeliveryCsv: (adaptationId: string, options?: unknown) => invoke('export:dramaShotDeliveryCsv', adaptationId, options),
    chapterMarkdown: (chapterId: string) => invoke('export:chapterMarkdown', chapterId),
    adaptationMarkdown: (adaptationId: string) => invoke('export:adaptationMarkdown', adaptationId),
    adaptationJson: (adaptationId: string) => invoke('export:adaptationJson', adaptationId),
    scriptMarkdown: (scriptId: string) => invoke('export:scriptMarkdown', scriptId),
    scriptJson: (scriptId: string) => invoke('export:scriptJson', scriptId),
    scriptsMarkdown: (adaptationId: string) => invoke('export:scriptsMarkdown', adaptationId),
    scriptsJson: (adaptationId: string) => invoke('export:scriptsJson', adaptationId),
    shotsMarkdown: (sceneId: string) => invoke('export:shotsMarkdown', sceneId),
    shotsJson: (sceneId: string) => invoke('export:shotsJson', sceneId),
    shotsCsv: (sceneId: string) => invoke('export:shotsCsv', sceneId),
    // v1.0：完整项目包
    projectPackage: (projectId: string, options?: unknown) => invoke('export:projectPackage', projectId, options),
  },
  // v0.8 多 Agent 编剧室与模板系统
  agent: {
    list: () => invoke('agent:list'),
    get: (id: string) => invoke('agent:get', id),
    create: (data: unknown) => invoke('agent:create', data),
    update: (id: string, patch: unknown) => invoke('agent:update', id, patch),
    remove: (id: string) => invoke('agent:delete', id),
  },
  writingRoom: {
    run: (input: unknown) => invoke('writingRoom:run', input),
  },
  template: {
    list: () => invoke('template:list'),
    listByType: (type: string) => invoke('template:listByType', type),
    get: (id: string) => invoke('template:get', id),
    create: (data: unknown) => invoke('template:create', data),
    update: (id: string, patch: unknown) => invoke('template:update', id, patch),
    remove: (id: string) => invoke('template:delete', id),
    extractVariables: (content: string) => invoke('template:extractVariables', content),
    run: (input: unknown) => invoke('template:run', input),
  },
  genrePreset: {
    list: () => invoke('genrePreset:list'),
    get: (id: string) => invoke('genrePreset:get', id),
    create: (data: unknown) => invoke('genrePreset:create', data),
    update: (id: string, patch: unknown) => invoke('genrePreset:update', id, patch),
    remove: (id: string) => invoke('genrePreset:delete', id),
  },
  templateRun: {
    list: () => invoke('templateRun:list'),
    listByTemplate: (templateId: string) => invoke('templateRun:listByTemplate', templateId),
  },
  // v1.1 创意诊断与反套路迭代系统
  caseStudy: {
    list: () => invoke('caseStudy:list'),
    listDocuments: () => invoke('caseStudy:listDocuments'),
    importDocuments: () => invoke('caseStudy:importDocuments'),
    createDocument: (data: unknown) => invoke('caseStudy:createDocument', data),
    updateDocumentChapter: (id: string, patch: unknown) => invoke('caseStudy:updateDocumentChapter', id, patch),
    deleteDocument: (id: string) => invoke('caseStudy:deleteDocument', id),
    create: (data: unknown) => invoke('caseStudy:create', data),
    update: (id: string, patch: unknown) => invoke('caseStudy:update', id, patch),
    remove: (id: string) => invoke('caseStudy:delete', id),
  },
  creative: {
    listFreshness: (projectId?: string) => invoke('creative:freshness:list', projectId),
    listFreshnessByTarget: (targetKind: string, targetId?: string) =>
      invoke('creative:freshness:listByTarget', targetKind, targetId),
    listAntiTropeByTarget: (targetKind: string, targetId?: string) =>
      invoke('creative:antiTrope:listByTarget', targetKind, targetId),
    listQualityGates: (projectId?: string) => invoke('creative:qualityGate:list', projectId),
    listAudienceSimulations: (projectId?: string) => invoke('creative:audience:list', projectId),
    listNarrativeCurves: (projectId?: string) => invoke('creative:curve:list', projectId),
  },
  revisionTask: {
    list: (projectId?: string) => invoke('revisionTask:list', projectId),
    listByTarget: (targetKind: string, targetId?: string) => invoke('revisionTask:listByTarget', targetKind, targetId),
    create: (data: unknown) => invoke('revisionTask:create', data),
    update: (id: string, patch: unknown) => invoke('revisionTask:update', id, patch),
    preview: (id: string) => invoke('revisionTask:preview', id),
    updatePreview: (id: string, preview: unknown) => invoke('revisionTask:updatePreview', id, preview),
    adopt: (id: string) => invoke('revisionTask:adopt', id),
    undo: (id: string) => invoke('revisionTask:undo', id),
    complete: (id: string) => invoke('revisionTask:complete', id),
    apply: (id: string) => invoke('revisionTask:apply', id),
  },
  contentVersion: {
    listByTarget: (targetKind: string, targetId: string) => invoke('contentVersion:listByTarget', targetKind, targetId),
    create: (data: unknown) => invoke('contentVersion:create', data),
    restore: (id: string) => invoke('contentVersion:restore', id),
  },
  workflow: {
    list: (projectId?: string) => invoke('workflow:list', projectId),
    run: (input: unknown) => invoke('workflow:run', input),
    resume: (input: unknown) => invoke('workflow:resume', input),
    retryStep: (input: unknown) => invoke('workflow:retryStep', input),
  },
}

contextBridge.exposeInMainWorld('api', api)
