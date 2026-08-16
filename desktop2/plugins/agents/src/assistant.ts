import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import {
  pageQuerySchema,
  problemDetailsSchema,
  type EngineEvent,
  type TaskState,
} from "@dramaip/contracts";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  ContextSnapshot,
  RouteContribution,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api";

import {
  agentExperimentSchema,
  agentTaskSettingsSchema,
  assistantConversationSchema,
  assistantMessageInputSchema,
  assistantMessageResultSchema,
  assistantTurnSchema,
  continueChapterSchema,
  createAgentExperimentSchema,
  createAssistantConversationSchema,
  providerPageSchema,
  reviewAgentExperimentSchema,
  taskDefinitionSchema,
  updateAgentTaskSettingsSchema,
  updateAssistantConversationSchema,
} from "./contracts.ts";
import type { EngineKind } from "./engine-registry.ts";

export interface AssistantSessionRow {
  id: string;
  engine_session_id: string;
  project_id: string;
  engine_kind: EngineKind;
  title: string;
  state: "active" | "disposed";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AssistantRunRow {
  id: string;
  session_id: string;
  engine_run_id: string;
  state: TaskState;
  prompt: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  error_code: string | null;
  error_message: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AssistantEngineHooks {
  onCompleted?: (output: string, run: AssistantRunRow) => void | Promise<void>;
  onFailed?: (error: unknown, run: AssistantRunRow) => void | Promise<void>;
}

export type ConsumeAssistantEngineEvents = (
  run: AssistantRunRow,
  events: AsyncIterable<EngineEvent>,
  hooks?: AssistantEngineHooks,
) => Promise<void>;

interface ConversationRow {
  id: string;
  project_id: string | null;
  session_id: string | null;
  title: string;
  engine_kind: EngineKind;
  model: string | null;
  status: "active" | "archived";
  version: number;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  conversation_id: string;
  run_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  task_type: string | null;
  context_snapshot_id: string | null;
  change_preview_id: string | null;
  intent_confidence: number | null;
  created_at: string;
}

interface SettingRow {
  scope_type: "global" | "project";
  scope_id: string;
  engine_kind: EngineKind;
  model: string | null;
  advanced_mode: number;
  version: number;
  updated_at: string;
}

interface ExperimentRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  prompt: string;
  task_type: string;
  status: "running" | "ready" | "reviewed" | "failed";
  selected_candidate_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CandidateRow {
  id: string;
  experiment_id: string;
  engine_kind: EngineKind;
  ordinal: number;
  session_id: string | null;
  run_id: string | null;
  state: TaskState;
  output: string;
  created_at: string;
}

export const assistantTaskDefinitions = [
  {
    id: "generate-project-setting",
    label: "生成项目设定",
    category: "knowledge",
    write: false,
    requiresProject: false,
    requiresChapter: false,
    simple: true,
  },
  {
    id: "trope-freshness",
    label: "套路新鲜度分析",
    category: "quality",
    write: false,
    requiresProject: false,
    requiresChapter: false,
    simple: true,
  },
  {
    id: "chapter-diagnostic",
    label: "章节诊断",
    category: "quality",
    write: false,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "generate-revision-tasks",
    label: "生成修稿任务单",
    category: "chat",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: true,
  },
  {
    id: "project-chat",
    label: "项目问答",
    category: "chat",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: true,
  },
  {
    id: "novel-create",
    label: "小说创作",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "chapter-generate",
    label: "生成章节",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "chapter-continue",
    label: "续写章节",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "chapter-rewrite",
    label: "改写章节",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: false,
  },
  {
    id: "chapter-polish",
    label: "润色章节",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "chapter-expand",
    label: "扩写章节",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: false,
  },
  {
    id: "conflict-enhance",
    label: "增强冲突",
    category: "quality",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "hook-enhance",
    label: "增强钩子",
    category: "quality",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: true,
  },
  {
    id: "character-generate",
    label: "生成人物",
    category: "knowledge",
    write: true,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "outline-generate",
    label: "生成大纲",
    category: "knowledge",
    write: true,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "chapter-summary",
    label: "章节摘要",
    category: "chapter",
    write: true,
    requiresProject: true,
    requiresChapter: true,
    simple: false,
  },
  {
    id: "story-bible",
    label: "Story Bible",
    category: "knowledge",
    write: true,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "character-state",
    label: "人物状态",
    category: "knowledge",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "events",
    label: "关键事件",
    category: "knowledge",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "foreshadowing",
    label: "伏笔检查",
    category: "quality",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: false,
  },
  {
    id: "consistency",
    label: "一致性检查",
    category: "quality",
    write: false,
    requiresProject: true,
    requiresChapter: false,
    simple: true,
  },
] as const;

interface TaskDefinition {
  id: string;
  label: string;
  category: "chat" | "chapter" | "knowledge" | "quality";
  write: boolean;
  requiresProject: boolean;
  requiresChapter: boolean;
  simple: boolean;
}

const response = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: response(problemDetailsSchema, "Invalid request"),
  401: response(problemDetailsSchema, "Authentication required"),
  404: response(problemDetailsSchema, "Not found"),
  409: response(problemDetailsSchema, "Conflict"),
  412: response(problemDetailsSchema, "Version conflict"),
  428: response(problemDetailsSchema, "If-Match required"),
  500: response(problemDetailsSchema, "Internal error"),
  503: response(problemDetailsSchema, "Service unavailable"),
} as const;

const conversationJson = (row: ConversationRow) => ({
  id: row.id,
  projectId: row.project_id,
  sessionId: row.session_id,
  title: row.title,
  engineKind: row.engine_kind,
  model: row.model,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const turnJson = (row: TurnRow) => ({
  id: row.id,
  conversationId: row.conversation_id,
  runId: row.run_id,
  role: row.role,
  content: row.content,
  taskType: row.task_type,
  contextSnapshotId: row.context_snapshot_id,
  changePreviewId: row.change_preview_id,
  intentConfidence: row.intent_confidence,
  createdAt: row.created_at,
});

function getConversation(ctx: Context, id: string): ConversationRow {
  const row = ctx.uow.execute((tx) =>
    tx.get<ConversationRow>(
      "SELECT * FROM assistant_conversations WHERE id = ?",
      id,
    ),
  );
  if (!row)
    throw new ApiProblem(
      404,
      "ASSISTANT_CONVERSATION_NOT_FOUND",
      "assistant conversation does not exist",
    );
  return row;
}

function projectExists(ctx: Context, id: string): boolean {
  return ctx.uow.execute((tx) =>
    Boolean(
      tx.get(
        "SELECT id FROM workspace_projects WHERE id = ? AND status != 'trashed'",
        id,
      ),
    ),
  );
}

export function routeIntent(
  content: string,
  explicit?: string,
): { definition: TaskDefinition; confidence: number } {
  if (explicit) {
    const definition = assistantTaskDefinitions.find(
      (candidate) => candidate.id === explicit,
    );
    if (!definition)
      throw new ApiProblem(
        400,
        "AGENT_TASK_UNKNOWN",
        `unknown task type: ${explicit}`,
      );
    return { definition, confidence: 1 };
  }
  const routes: Array<[RegExp, TaskDefinition["id"]]> = [
    [/续写|接着写|继续写/u, "chapter-continue"],
    [/改写|重写/u, "chapter-rewrite"],
    [/润色|优化文风/u, "chapter-polish"],
    [/扩写|写长/u, "chapter-expand"],
    [/冲突|矛盾升级/u, "conflict-enhance"],
    [/钩子|悬念|抓人/u, "hook-enhance"],
    [/章节.*摘要|总结.*章节/u, "chapter-summary"],
    [/生成.*章节|写.*章节/u, "chapter-generate"],
    [/人物|角色/u, "character-generate"],
    [/大纲/u, "outline-generate"],
    [/story\s*bible|故事圣经|设定集/iu, "story-bible"],
    [/人物状态/u, "character-state"],
    [/事件/u, "events"],
    [/伏笔/u, "foreshadowing"],
    [/一致性|前后矛盾/u, "consistency"],
  ];
  for (const [pattern, id] of routes) {
    if (!pattern.test(content)) continue;
    return {
      definition: assistantTaskDefinitions.find(
        (candidate) => candidate.id === id,
      )!,
      confidence: 0.9,
    };
  }
  return {
    definition: assistantTaskDefinitions.find(
      (candidate) => candidate.id === "project-chat",
    )!,
    confidence: 0.35,
  };
}

function settingJson(row: SettingRow) {
  return {
    scope: row.scope_type,
    projectId: row.scope_type === "project" ? row.scope_id : null,
    engineKind: row.engine_kind,
    model: row.model,
    advancedMode: Boolean(row.advanced_mode),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function ensureSetting(
  ctx: Context,
  scope: "global" | "project",
  projectId?: string,
): SettingRow {
  const scopeId = scope === "global" ? "global" : projectId!;
  if (scope === "project" && (!projectId || !projectExists(ctx, projectId)))
    throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
  return ctx.uow.execute((tx) => {
    let inherited: Pick<SettingRow, "engine_kind" | "model" | "advanced_mode"> =
      {
        engine_kind: "opencode",
        model: null,
        advanced_mode: 0,
      };
    if (scope === "project") {
      inherited =
        tx.get<SettingRow>(
          "SELECT * FROM agent_task_settings WHERE scope_type = 'global' AND scope_id = 'global'",
        ) ?? inherited;
    }
    tx.run(
      `INSERT INTO agent_task_settings
       (scope_type, scope_id, engine_kind, model, advanced_mode, version, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(scope_type, scope_id) DO NOTHING`,
      scope,
      scopeId,
      inherited.engine_kind,
      inherited.model,
      inherited.advanced_mode,
      new Date().toISOString(),
    );
    return tx.get<SettingRow>(
      "SELECT * FROM agent_task_settings WHERE scope_type = ? AND scope_id = ?",
      scope,
      scopeId,
    )!;
  });
}

async function resetConversationSession(
  ctx: Context,
  conversation: ConversationRow,
): Promise<void> {
  if (!conversation.session_id) return;
  const session = ctx.uow.execute((tx) =>
    tx.get<AssistantSessionRow>(
      "SELECT * FROM agents_sessions WHERE id = ?",
      conversation.session_id,
    ),
  );
  if (!session || session.state === "disposed") return;
  const active = ctx.uow.execute((tx) =>
    tx.get(
      "SELECT id FROM agents_runs WHERE session_id = ? AND state IN ('queued', 'running')",
      session.id,
    ),
  );
  if (active)
    throw new ApiProblem(
      409,
      "CONVERSATION_HAS_ACTIVE_RUN",
      "interrupt the active run before changing engine or project",
    );
  await ctx.engineRegistry
    .get(session.engine_kind)
    .dispose(session.engine_session_id);
  ctx.uow.execute((tx) =>
    tx.run(
      "UPDATE agents_sessions SET state = 'disposed', version = version + 1, updated_at = ? WHERE id = ?",
      new Date().toISOString(),
      session.id,
    ),
  );
}

async function ensureConversationSession(
  ctx: Context,
  conversation: ConversationRow,
): Promise<AssistantSessionRow> {
  if (conversation.session_id) {
    const existing = ctx.uow.execute((tx) =>
      tx.get<AssistantSessionRow>(
        "SELECT * FROM agents_sessions WHERE id = ?",
        conversation.session_id,
      ),
    );
    if (existing?.state === "active") return existing;
  }
  if (!conversation.project_id)
    throw new ApiProblem(
      409,
      "ASSISTANT_PROJECT_REQUIRED",
      "bind a project before starting an agent run",
    );
  const engineSession = await ctx.engineRegistry
    .get(conversation.engine_kind)
    .createSession({
      projectId: conversation.project_id,
      title: conversation.title,
      ...(conversation.model ? { model: conversation.model } : {}),
      metadata: { conversationId: conversation.id },
    });
  const now = new Date().toISOString();
  const session: AssistantSessionRow = {
    id: randomUUID(),
    engine_session_id: engineSession.sessionId,
    project_id: conversation.project_id,
    engine_kind: conversation.engine_kind,
    title: conversation.title,
    state: "active",
    version: 1,
    created_at: now,
    updated_at: now,
  };
  ctx.uow.execute((tx) => {
    tx.run(
      `INSERT INTO agents_sessions
       (id, engine_session_id, project_id, engine_kind, title, state, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      session.id,
      session.engine_session_id,
      session.project_id,
      session.engine_kind,
      session.title,
      now,
      now,
    );
    tx.run(
      "UPDATE assistant_conversations SET session_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
      session.id,
      now,
      conversation.id,
    );
  });
  return session;
}

function persistSnapshot(
  tx: UnitOfWorkTransaction,
  conversationId: string,
  projectId: string | null,
  snapshot: ContextSnapshot,
): void {
  tx.run(
    `INSERT INTO agent_context_snapshots
     (id, conversation_id, run_id, project_id, request_json, total_tokens, truncated_json, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    snapshot.id,
    conversationId,
    projectId,
    JSON.stringify(snapshot.request),
    snapshot.totalTokens,
    JSON.stringify(snapshot.truncated),
    snapshot.createdAt,
  );
  snapshot.fragments.forEach((fragment, ordinal) =>
    tx.run(
      `INSERT INTO agent_context_fragments
       (id, snapshot_id, fragment_id, plugin_id, kind, title, content, source_id,
        source_version, priority, token_estimate, provenance, ordinal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      snapshot.id,
      fragment.id,
      fragment.pluginId,
      fragment.kind,
      fragment.title,
      fragment.content,
      fragment.sourceId,
      fragment.sourceVersion,
      fragment.priority,
      fragment.tokenEstimate,
      fragment.provenance,
      ordinal,
    ),
  );
}

function promptFor(
  snapshot: ContextSnapshot,
  task: TaskDefinition,
  content: string,
): string {
  const context = snapshot.fragments
    .map((fragment) => `## ${fragment.title}\n${fragment.content}`)
    .join("\n\n");
  return [
    "你是 DramaIP Studio 小说创作助手。只输出面向用户的最终内容，不输出推理、内部日志、凭据或本机路径。",
    `任务：${task.label} (${task.id})`,
    `用户要求：${content}`,
    context ? `创作上下文：\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createPreviewForOutput(
  ctx: Context,
  conversation: ConversationRow,
  session: AssistantSessionRow,
  run: AssistantRunRow,
  definition: TaskDefinition,
  chapterId: string | undefined,
  output: string,
) {
  if (!definition.write || !conversation.project_id || !output.trim())
    return undefined;
  if (definition.category === "chapter" || definition.category === "quality") {
    if (!chapterId) return undefined;
    const chapter = ctx.uow.execute((tx) =>
      tx.get<{
        version: number;
        title: string;
        content: string;
      }>(
        "SELECT version, title, content FROM writing_chapters WHERE id = ? AND project_id = ?",
        chapterId,
        conversation.project_id,
      ),
    );
    if (!chapter) return undefined;
    const patch =
      definition.id === "chapter-summary"
        ? { summary: output }
        : definition.id === "conflict-enhance"
          ? { mainConflict: output }
          : definition.id === "hook-enhance"
            ? { hook: output }
            : definition.id === "chapter-continue"
              ? {
                  content: `${chapter.content}${chapter.content.endsWith("\n") ? "" : "\n"}${output}`,
                }
              : { content: output };
    return ctx.automationRuntime.createPreview({
      projectId: conversation.project_id,
      sessionId: session.id,
      runId: run.id,
      taskType: definition.id,
      rationale: `${definition.label}生成结果，确认后写入章节`,
      targets: [
        {
          kind: "writing.chapter",
          targetId: chapterId,
          baseVersion: chapter.version,
          patch,
          displayDiff: { before: chapter.content, after: patch },
        },
      ],
    });
  }
  const createKind =
    definition.id === "character-generate"
      ? "character"
      : definition.id === "outline-generate"
        ? "outline"
        : definition.id === "story-bible"
          ? "story-bible"
          : undefined;
  if (!createKind) return undefined;
  const data =
    createKind === "character"
      ? {
          role: "",
          biography: output,
          traits: [],
          relationships: [],
          currentState: "",
          visualProfile: "",
        }
      : createKind === "outline"
        ? { summary: output, beats: [] }
        : {
            world: output,
            rules: [],
            themes: [],
            events: [],
            foreshadowing: [],
          };
  return ctx.automationRuntime.createPreview({
    projectId: conversation.project_id,
    sessionId: session.id,
    runId: run.id,
    taskType: definition.id,
    rationale: `${definition.label}生成结果，确认后加入知识库`,
    targets: [
      {
        kind: `knowledge.${createKind}.create`,
        targetId: randomUUID(),
        baseVersion: 0,
        patch: { title: `AI ${definition.label}`, data },
        displayDiff: { before: null, after: data },
      },
    ],
  });
}

export function completeAssistantRun(
  ctx: Context,
  output: string,
  run: AssistantRunRow,
): void {
  const state = ctx.uow.execute((tx) => {
    const turn = tx.get<TurnRow>(
      "SELECT * FROM assistant_turns WHERE run_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1",
      run.id,
    );
    if (!turn) return undefined;
    const conversation = tx.get<ConversationRow>(
      "SELECT * FROM assistant_conversations WHERE id = ?",
      turn.conversation_id,
    );
    const session = tx.get<AssistantSessionRow>(
      "SELECT * FROM agents_sessions WHERE id = ?",
      run.session_id,
    );
    const snapshot = turn.context_snapshot_id
      ? tx.get<{ request_json: string }>(
          "SELECT request_json FROM agent_context_snapshots WHERE id = ?",
          turn.context_snapshot_id,
        )
      : undefined;
    return conversation && session
      ? { turn, conversation, session, request: snapshot?.request_json }
      : undefined;
  });
  if (!state) return;
  const definition = assistantTaskDefinitions.find(
    (candidate) => candidate.id === state.turn.task_type,
  );
  const request = state.request
    ? (JSON.parse(state.request) as { chapterId?: string })
    : undefined;
  const preview = definition
    ? createPreviewForOutput(
        ctx,
        state.conversation,
        state.session,
        run,
        definition,
        request?.chapterId,
        output,
      )
    : undefined;
  ctx.uow.execute((tx) =>
    tx.run(
      "UPDATE assistant_turns SET content = ?, change_preview_id = ? WHERE id = ?",
      output || "生成完成",
      preview?.id ?? null,
      state.turn.id,
    ),
  );
}

function experimentJson(ctx: Context, row: ExperimentRow) {
  const revealed = row.status === "reviewed";
  const candidates = ctx.uow.execute((tx) =>
    tx.all<CandidateRow>(
      "SELECT * FROM agent_experiment_candidates WHERE experiment_id = ? ORDER BY ordinal",
      row.id,
    ),
  );
  return {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    taskType: row.task_type,
    status: row.status,
    revealed,
    selectedCandidateId: row.selected_candidate_id,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      ordinal: candidate.ordinal,
      runId: candidate.run_id,
      state: candidate.state,
      output: candidate.output,
      engineKind: revealed ? candidate.engine_kind : null,
    })),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function finishExperimentCandidate(
  ctx: Context,
  candidateId: string,
  state: "succeeded" | "failed",
  output: string,
): void {
  ctx.uow.execute((tx) => {
    const candidate = tx.get<CandidateRow>(
      "SELECT * FROM agent_experiment_candidates WHERE id = ?",
      candidateId,
    );
    if (!candidate) return;
    tx.run(
      "UPDATE agent_experiment_candidates SET state = ?, output = ? WHERE id = ?",
      state,
      output,
      candidateId,
    );
    const remaining =
      tx.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM agent_experiment_candidates WHERE experiment_id = ? AND state IN ('queued', 'running')",
        candidate.experiment_id,
      )?.count ?? 0;
    if (remaining === 0) {
      const succeeded =
        tx.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM agent_experiment_candidates WHERE experiment_id = ? AND state = 'succeeded'",
          candidate.experiment_id,
        )?.count ?? 0;
      tx.run(
        "UPDATE agent_experiments SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'running'",
        succeeded ? "ready" : "failed",
        new Date().toISOString(),
        candidate.experiment_id,
      );
    }
  });
}

export function installAssistantRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  ctx: Context,
  activeClaims: Map<EngineKind, string>,
  consume: ConsumeAssistantEngineEvents,
): void {
  const taskDefinitions = createRoute({
    method: "get",
    path: "/api/v2/agents/task-definitions",
    request: {
      query: z.object({
        mode: z.enum(["simple", "advanced"]).default("simple"),
      }),
    },
    responses: {
      200: response(
        z.object({ items: z.array(taskDefinitionSchema) }),
        "Assistant task definitions",
      ),
      ...errors,
    },
  });
  app.openapi(taskDefinitions, (context) => {
    const mode = context.req.valid("query").mode;
    return context.json({
      items: assistantTaskDefinitions.filter(
        (definition) => mode === "advanced" || definition.simple,
      ),
    });
  });

  const engines = createRoute({
    method: "get",
    path: "/api/v2/agents/engines",
    responses: {
      200: response(providerPageSchema, "Assistant engines"),
      ...errors,
    },
  });
  app.openapi(engines, async (context) => {
    const configured = new Set(
      ctx.uow.execute((tx) =>
        tx
          .all<{
            kind: EngineKind;
          }>(
            "SELECT kind FROM agents_provider_settings WHERE enabled = 1 AND credential_ref IS NOT NULL",
          )
          .map((row) => row.kind),
      ),
    );
    const items = await Promise.all(
      ctx.engineRegistry.list().map(async (provider) => {
        const [health, capabilities] = await Promise.all([
          provider.health(),
          provider.capabilities(),
        ]);
        return {
          kind: provider.kind,
          version: health.version,
          status: health.status,
          capabilities,
          configured: configured.has(provider.kind),
        };
      }),
    );
    return context.json({ items });
  });

  installSettingsRoutes(app, ctx);
  installConversationRoutes(app, ctx, activeClaims, consume);
  installExperimentRoutes(app, ctx, activeClaims, consume);
  installWritingAssistantRoutes(app, ctx);
}

function installWritingAssistantRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  ctx: Context,
): void {
  const route = createRoute({
    method: "post",
    path: "/api/v2/writing/projects/{projectId}/chapters/actions/continue",
    request: {
      params: z.object({ projectId: z.uuid() }),
      body: {
        content: { "application/json": { schema: continueChapterSchema } },
      },
    },
    responses: {
      200: response(assistantMessageResultSchema, "Clarification returned"),
      202: response(assistantMessageResultSchema, "Continuation run queued"),
      ...errors,
    },
  });
  app.openapi(route, (async (context: any) => {
    const input = context.req.valid("json") as z.infer<
      typeof continueChapterSchema
    >;
    const projectId = context.req.valid("param").projectId;
    const conversation = getConversation(ctx, input.conversationId);
    if (conversation.project_id !== projectId)
      throw new ApiProblem(
        409,
        "CONVERSATION_PROJECT_MISMATCH",
        "conversation is not bound to the requested project",
      );
    const chapter = ctx.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM writing_chapters WHERE id = ? AND project_id = ?",
        input.chapterId,
        projectId,
      ),
    );
    if (!chapter)
      throw new ApiProblem(
        404,
        "CHAPTER_NOT_FOUND",
        "chapter does not exist in the requested project",
      );
    const headers = new Headers(context.req.raw.headers);
    headers.set("content-type", "application/json");
    const internal = new Request(
      new URL(
        `/api/v2/agents/assistant/conversations/${conversation.id}/messages`,
        context.req.raw.url,
      ),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: input.instruction,
          taskType: "chapter-continue",
          chapterId: input.chapterId,
          selection: input.selection,
        }),
      },
    );
    return app.fetch(internal) as never;
  }) as never);
}

function installSettingsRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  ctx: Context,
): void {
  const getGlobal = createRoute({
    method: "get",
    path: "/api/v2/agents/settings",
    responses: {
      200: response(agentTaskSettingsSchema, "Global agent settings"),
      ...errors,
    },
  });
  app.openapi(getGlobal, (context) => {
    const row = ensureSetting(ctx, "global");
    context.header("etag", `"v${row.version}"`);
    return context.json(settingJson(row));
  });
  const putGlobal = createRoute({
    method: "put",
    path: "/api/v2/agents/settings",
    request: {
      body: {
        content: {
          "application/json": { schema: updateAgentTaskSettingsSchema },
        },
      },
    },
    responses: {
      200: response(agentTaskSettingsSchema, "Global agent settings updated"),
      ...errors,
    },
  });
  app.openapi(putGlobal, (context) =>
    updateSettingResponse(ctx, context, "global"),
  );
  const projectParams = z.object({ projectId: z.uuid() });
  const getProject = createRoute({
    method: "get",
    path: "/api/v2/agents/projects/{projectId}/settings",
    request: { params: projectParams },
    responses: {
      200: response(agentTaskSettingsSchema, "Project agent settings"),
      ...errors,
    },
  });
  app.openapi(getProject, (context) => {
    const row = ensureSetting(
      ctx,
      "project",
      context.req.valid("param").projectId,
    );
    context.header("etag", `"v${row.version}"`);
    return context.json(settingJson(row));
  });
  const putProject = createRoute({
    method: "put",
    path: "/api/v2/agents/projects/{projectId}/settings",
    request: {
      params: projectParams,
      body: {
        content: {
          "application/json": { schema: updateAgentTaskSettingsSchema },
        },
      },
    },
    responses: {
      200: response(agentTaskSettingsSchema, "Project agent settings updated"),
      ...errors,
    },
  });
  app.openapi(putProject, (context) =>
    updateSettingResponse(
      ctx,
      context,
      "project",
      context.req.valid("param").projectId,
    ),
  );
}

function updateSettingResponse(
  ctx: Context,
  context: any,
  scope: "global" | "project",
  projectId?: string,
) {
  const current = ensureSetting(ctx, scope, projectId);
  requireIfMatch(context.req.raw, current.version);
  const input = context.req.valid("json") as z.infer<
    typeof updateAgentTaskSettingsSchema
  >;
  const row = ctx.uow.execute((tx) => {
    tx.run(
      `UPDATE agent_task_settings SET engine_kind = ?, model = ?, advanced_mode = ?,
       version = version + 1, updated_at = ? WHERE scope_type = ? AND scope_id = ? AND version = ?`,
      input.engineKind ?? current.engine_kind,
      input.model === undefined ? current.model : input.model,
      input.advancedMode === undefined
        ? current.advanced_mode
        : input.advancedMode
          ? 1
          : 0,
      new Date().toISOString(),
      current.scope_type,
      current.scope_id,
      current.version,
    );
    return tx.get<SettingRow>(
      "SELECT * FROM agent_task_settings WHERE scope_type = ? AND scope_id = ?",
      current.scope_type,
      current.scope_id,
    )!;
  });
  context.header("etag", `"v${row.version}"`);
  return context.json(settingJson(row));
}

function installConversationRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  ctx: Context,
  activeClaims: Map<EngineKind, string>,
  consume: ConsumeAssistantEngineEvents,
): void {
  const idParams = z.object({ id: z.uuid() });
  const list = createRoute({
    method: "get",
    path: "/api/v2/agents/assistant/conversations",
    request: {
      query: pageQuerySchema.extend({
        projectId: z.uuid().optional(),
        status: z.enum(["active", "archived"]).default("active"),
      }),
    },
    responses: {
      200: response(
        z.object({
          items: z.array(assistantConversationSchema),
          nextCursor: z.string().optional(),
        }),
        "Assistant conversations",
      ),
      ...errors,
    },
  });
  app.openapi(list, (context) => {
    const query = context.req.valid("query");
    const cursor = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
    const rows = ctx.uow.execute(
      (tx) =>
        tx.all<ConversationRow>(
          `SELECT rowid AS row_cursor, * FROM assistant_conversations
       WHERE status = ? AND rowid > ? ${query.projectId ? "AND project_id = ?" : ""}
       ORDER BY rowid LIMIT ?`,
          query.status,
          cursor,
          ...(query.projectId ? [query.projectId] : []),
          query.limit + 1,
        ) as Array<ConversationRow & { row_cursor: number }>,
    );
    const visible = rows.slice(0, query.limit);
    return context.json({
      items: visible.map(conversationJson),
      ...(rows.length > query.limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    });
  });

  const create = createRoute({
    method: "post",
    path: "/api/v2/agents/assistant/conversations",
    request: {
      body: {
        content: {
          "application/json": { schema: createAssistantConversationSchema },
        },
      },
    },
    responses: {
      201: response(
        assistantConversationSchema,
        "Assistant conversation created",
      ),
      ...errors,
    },
  });
  app.openapi(create, (context) => {
    const input = context.req.valid("json");
    if (input.projectId && !projectExists(ctx, input.projectId))
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    const now = new Date().toISOString();
    const row: ConversationRow = {
      id: randomUUID(),
      project_id: input.projectId ?? null,
      session_id: null,
      title: input.title,
      engine_kind: input.engineKind,
      model: input.model ?? null,
      status: "active",
      version: 1,
      created_at: now,
      updated_at: now,
    };
    ctx.uow.execute((tx) =>
      tx.run(
        `INSERT INTO assistant_conversations
       (id, project_id, session_id, title, engine_kind, model, status, version, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'active', 1, ?, ?)`,
        row.id,
        row.project_id,
        row.title,
        row.engine_kind,
        row.model,
        now,
        now,
      ),
    );
    context.header("etag", '"v1"');
    context.header(
      "location",
      `/api/v2/agents/assistant/conversations/${row.id}`,
    );
    return context.json(conversationJson(row), 201);
  });

  const get = createRoute({
    method: "get",
    path: "/api/v2/agents/assistant/conversations/{id}",
    request: { params: idParams },
    responses: {
      200: response(assistantConversationSchema, "Assistant conversation"),
      ...errors,
    },
  });
  app.openapi(get, (context) => {
    const row = getConversation(ctx, context.req.valid("param").id);
    context.header("etag", `"v${row.version}"`);
    return context.json(conversationJson(row));
  });

  const update = createRoute({
    method: "patch",
    path: "/api/v2/agents/assistant/conversations/{id}",
    request: {
      params: idParams,
      body: {
        content: {
          "application/json": { schema: updateAssistantConversationSchema },
        },
      },
    },
    responses: {
      200: response(
        assistantConversationSchema,
        "Assistant conversation updated",
      ),
      ...errors,
    },
  });
  app.openapi(update, (async (context: any) => {
    const row = getConversation(ctx, context.req.valid("param").id);
    requireIfMatch(context.req.raw, row.version);
    const input = context.req.valid("json");
    const reset =
      (input.engineKind && input.engineKind !== row.engine_kind) ||
      (input.model !== undefined && input.model !== row.model);
    if (reset) await resetConversationSession(ctx, row);
    const updated = ctx.uow.execute((tx) => {
      tx.run(
        `UPDATE assistant_conversations SET title = ?, engine_kind = ?, model = ?,
         session_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        input.title ?? row.title,
        input.engineKind ?? row.engine_kind,
        input.model === undefined ? row.model : input.model,
        reset ? null : row.session_id,
        new Date().toISOString(),
        row.id,
        row.version,
      );
      return tx.get<ConversationRow>(
        "SELECT * FROM assistant_conversations WHERE id = ?",
        row.id,
      )!;
    });
    context.header("etag", `"v${updated.version}"`);
    return context.json(conversationJson(updated));
  }) as never);

  const bind = createRoute({
    method: "post",
    path: "/api/v2/agents/assistant/conversations/{id}/actions/bind-project",
    request: {
      params: idParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({ projectId: z.uuid() }).strict(),
          },
        },
      },
    },
    responses: {
      200: response(assistantConversationSchema, "Conversation project bound"),
      ...errors,
    },
  });
  app.openapi(bind, (async (context: any) => {
    const row = getConversation(ctx, context.req.valid("param").id);
    requireIfMatch(context.req.raw, row.version);
    const projectId = context.req.valid("json").projectId;
    if (!projectExists(ctx, projectId))
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    if (row.project_id !== projectId) await resetConversationSession(ctx, row);
    const updated = ctx.uow.execute((tx) => {
      tx.run(
        "UPDATE assistant_conversations SET project_id = ?, session_id = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        projectId,
        new Date().toISOString(),
        row.id,
        row.version,
      );
      return tx.get<ConversationRow>(
        "SELECT * FROM assistant_conversations WHERE id = ?",
        row.id,
      )!;
    });
    context.header("etag", `"v${updated.version}"`);
    return context.json(conversationJson(updated));
  }) as never);

  for (const action of ["archive", "restore"] as const) {
    const route = createRoute({
      method: "post",
      path: `/api/v2/agents/assistant/conversations/{id}/actions/${action}`,
      request: { params: idParams },
      responses: {
        200: response(assistantConversationSchema, `Conversation ${action}`),
        ...errors,
      },
    });
    app.openapi(route, (context) => {
      const row = getConversation(ctx, context.req.valid("param").id);
      requireIfMatch(context.req.raw, row.version);
      const status = action === "archive" ? "archived" : "active";
      if (row.status === status) return context.json(conversationJson(row));
      const updated = ctx.uow.execute((tx) => {
        tx.run(
          "UPDATE assistant_conversations SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
          status,
          new Date().toISOString(),
          row.id,
          row.version,
        );
        return tx.get<ConversationRow>(
          "SELECT * FROM assistant_conversations WHERE id = ?",
          row.id,
        )!;
      });
      context.header("etag", `"v${updated.version}"`);
      return context.json(conversationJson(updated));
    });
  }

  const remove = createRoute({
    method: "delete",
    path: "/api/v2/agents/assistant/conversations/{id}",
    request: { params: idParams },
    responses: { 204: { description: "Conversation deleted" }, ...errors },
  });
  app.openapi(remove, (async (context: any) => {
    const row = getConversation(ctx, context.req.valid("param").id);
    requireIfMatch(context.req.raw, row.version);
    if (row.status !== "archived")
      throw new ApiProblem(
        409,
        "CONVERSATION_NOT_ARCHIVED",
        "archive the conversation before deleting it",
      );
    await resetConversationSession(ctx, row);
    ctx.uow.execute((tx) =>
      tx.run("DELETE FROM assistant_conversations WHERE id = ?", row.id),
    );
    return context.body(null, 204);
  }) as never);

  const listMessages = createRoute({
    method: "get",
    path: "/api/v2/agents/assistant/conversations/{id}/messages",
    request: { params: idParams, query: pageQuerySchema },
    responses: {
      200: response(
        z.object({
          items: z.array(assistantTurnSchema),
          nextCursor: z.string().optional(),
        }),
        "Assistant turns",
      ),
      ...errors,
    },
  });
  app.openapi(listMessages, (context) => {
    const row = getConversation(ctx, context.req.valid("param").id);
    const query = context.req.valid("query");
    const cursor = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
    const turns = ctx.uow.execute((tx) =>
      tx.all<TurnRow & { row_cursor: number }>(
        "SELECT rowid AS row_cursor, * FROM assistant_turns WHERE conversation_id = ? AND rowid > ? ORDER BY rowid LIMIT ?",
        row.id,
        cursor,
        query.limit + 1,
      ),
    );
    const visible = turns.slice(0, query.limit);
    return context.json({
      items: visible.map(turnJson),
      ...(turns.length > query.limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    });
  });

  const send = createRoute({
    method: "post",
    path: "/api/v2/agents/assistant/conversations/{id}/messages",
    request: {
      params: idParams,
      body: {
        content: {
          "application/json": { schema: assistantMessageInputSchema },
        },
      },
    },
    responses: {
      200: response(assistantMessageResultSchema, "Clarification returned"),
      202: response(assistantMessageResultSchema, "Assistant run queued"),
      ...errors,
    },
  });
  app.openapi(send, (async (context: any) => {
    const input = context.req.valid("json") as z.infer<
      typeof assistantMessageInputSchema
    >;
    return (await idempotentResponse(
      ctx.uow,
      context.req.raw,
      `agents.assistant.${context.req.valid("param").id}.messages`,
      input,
      async () => {
        const conversation = getConversation(
          ctx,
          context.req.valid("param").id,
        );
        if (conversation.status !== "active")
          throw new ApiProblem(
            409,
            "CONVERSATION_ARCHIVED",
            "restore the conversation before sending a message",
          );
        const routed = routeIntent(input.content, input.taskType);
        const userTurn: TurnRow = {
          id: randomUUID(),
          conversation_id: conversation.id,
          run_id: null,
          role: "user",
          content: input.content,
          task_type: routed.definition.id,
          context_snapshot_id: null,
          change_preview_id: null,
          intent_confidence: routed.confidence,
          created_at: new Date().toISOString(),
        };
        const missingProject =
          routed.definition.requiresProject && !conversation.project_id;
        const missingChapter =
          routed.definition.requiresChapter && !input.chapterId;
        if (missingProject || missingChapter) {
          const assistantTurn: TurnRow = {
            id: randomUUID(),
            conversation_id: conversation.id,
            run_id: null,
            role: "assistant",
            content: missingProject
              ? "请先把当前对话绑定到一个项目，我不会在缺少项目上下文时启动生成。"
              : "请先选择一个章节，我不会在目标不明确时修改内容。",
            task_type: routed.definition.id,
            context_snapshot_id: null,
            change_preview_id: null,
            intent_confidence: routed.confidence,
            created_at: new Date(Date.now() + 1).toISOString(),
          };
          ctx.uow.execute((tx) => {
            insertTurn(tx, userTurn);
            insertTurn(tx, assistantTurn);
          });
          return context.json(
            {
              userTurn: turnJson(userTurn),
              assistantTurn: turnJson(assistantTurn),
              clarification: true,
            },
            200,
          );
        }
        const activeRun = conversation.session_id
          ? ctx.uow.execute((tx) =>
              tx.get(
                "SELECT id FROM agents_runs WHERE session_id = ? AND state IN ('queued', 'running') LIMIT 1",
                conversation.session_id,
              ),
            )
          : undefined;
        if (activeRun)
          throw new ApiProblem(
            409,
            "CONVERSATION_HAS_ACTIVE_RUN",
            "each conversation can only have one active run",
          );
        if (activeClaims.has(conversation.engine_kind))
          throw new ApiProblem(
            409,
            "ENGINE_BUSY",
            "the selected engine already has an active run",
          );
        const snapshot = await ctx.automationRuntime.snapshot({
          projectId: conversation.project_id ?? undefined,
          chapterId: input.chapterId,
          selection: input.selection,
          taskType: routed.definition.id,
          pinned: input.pinned,
          excluded: input.excluded,
          tokenBudget: input.tokenBudget,
        });
        const session = await ensureConversationSession(ctx, conversation);
        const runId = randomUUID();
        const engineRunId = randomUUID();
        const claimId = randomUUID();
        const now = new Date().toISOString();
        const prompt = promptFor(snapshot, routed.definition, input.content);
        const run: AssistantRunRow = {
          id: runId,
          session_id: session.id,
          engine_run_id: engineRunId,
          state: "queued",
          prompt,
          input_tokens: 0,
          output_tokens: 0,
          cost_micros: 0,
          error_code: null,
          error_message: null,
          version: 1,
          created_at: now,
          updated_at: now,
        };
        const assistantTurn: TurnRow = {
          id: randomUUID(),
          conversation_id: conversation.id,
          run_id: runId,
          role: "assistant",
          content: "正在生成…",
          task_type: routed.definition.id,
          context_snapshot_id: snapshot.id,
          change_preview_id: null,
          intent_confidence: routed.confidence,
          created_at: new Date(Date.now() + 1).toISOString(),
        };
        userTurn.run_id = runId;
        userTurn.context_snapshot_id = snapshot.id;
        ctx.uow.execute((tx) => {
          persistSnapshot(
            tx,
            conversation.id,
            conversation.project_id,
            snapshot,
          );
          tx.run(
            `INSERT INTO agents_runs (id, session_id, engine_run_id, state, prompt, input_tokens, output_tokens, cost_micros, error_code, error_message, version, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, 0, 0, 0, NULL, NULL, 1, ?, ?)`,
            runId,
            session.id,
            engineRunId,
            prompt,
            now,
            now,
          );
          tx.run(
            `INSERT INTO agents_mcp_claims (id, project_id, session_id, run_id, read_only, max_results, expires_at, created_at) VALUES (?, ?, ?, ?, 1, 50, ?, ?)`,
            claimId,
            session.project_id,
            session.id,
            runId,
            new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
            now,
          );
          tx.run(
            "UPDATE agent_context_snapshots SET run_id = ? WHERE id = ?",
            runId,
            snapshot.id,
          );
          insertTurn(tx, userTurn);
          insertTurn(tx, assistantTurn);
        });
        activeClaims.set(conversation.engine_kind, claimId);
        const provider = ctx.engineRegistry.get(conversation.engine_kind);
        void consume(
          run,
          provider.run({
            runId: engineRunId,
            sessionId: session.engine_session_id,
            prompt,
          }),
          {
            onCompleted(output, completed) {
              completeAssistantRun(ctx, output, completed);
            },
            onFailed(error) {
              ctx.uow.execute((tx) =>
                tx.run(
                  "UPDATE assistant_turns SET content = ? WHERE id = ?",
                  `生成失败：${error instanceof Error ? error.message : String(error)}`,
                  assistantTurn.id,
                ),
              );
            },
          },
        ).finally(() => {
          if (activeClaims.get(conversation.engine_kind) === claimId)
            activeClaims.delete(conversation.engine_kind);
        });
        return context.json(
          {
            userTurn: turnJson(userTurn),
            assistantTurn: turnJson(assistantTurn),
            clarification: false,
            run: {
              taskId: runId,
              state: "queued" as const,
              href: `/api/v2/agents/runs/${runId}`,
            },
          },
          202,
        );
      },
    )) as never;
  }) as never);
}

function insertTurn(tx: UnitOfWorkTransaction, turn: TurnRow): void {
  tx.run(
    `INSERT INTO assistant_turns
     (id, conversation_id, run_id, role, content, task_type, context_snapshot_id,
      change_preview_id, intent_confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    turn.id,
    turn.conversation_id,
    turn.run_id,
    turn.role,
    turn.content,
    turn.task_type,
    turn.context_snapshot_id,
    turn.change_preview_id,
    turn.intent_confidence,
    turn.created_at,
  );
}

function installExperimentRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  ctx: Context,
  activeClaims: Map<EngineKind, string>,
  consume: ConsumeAssistantEngineEvents,
): void {
  const create = createRoute({
    method: "post",
    path: "/api/v2/agents/experiments",
    request: {
      body: {
        content: {
          "application/json": { schema: createAgentExperimentSchema },
        },
      },
    },
    responses: {
      202: response(agentExperimentSchema, "Blind experiment started"),
      ...errors,
    },
  });
  app.openapi(create, (async (context: any) => {
    const input = context.req.valid("json") as z.infer<
      typeof createAgentExperimentSchema
    >;
    return (await idempotentResponse(
      ctx.uow,
      context.req.raw,
      "agents.experiments.create",
      input,
      async () => {
        if (!projectExists(ctx, input.projectId))
          throw new ApiProblem(
            404,
            "PROJECT_NOT_FOUND",
            "project does not exist",
          );
        if (new Set(input.engines).size !== input.engines.length)
          throw new ApiProblem(
            400,
            "EXPERIMENT_ENGINES_DUPLICATED",
            "blind experiment engines must be unique",
          );
        if (input.engines.some((engine) => activeClaims.has(engine)))
          throw new ApiProblem(
            409,
            "ENGINE_BUSY",
            "one of the selected engines already has an active run",
          );
        const snapshot = await ctx.automationRuntime.snapshot({
          projectId: input.projectId,
          chapterId: input.chapterId,
          taskType: input.taskType,
        });
        const prompt = promptFor(
          snapshot,
          {
            id: input.taskType,
            label: input.taskType,
            category: "chat",
            write: false,
            requiresProject: true,
            requiresChapter: false,
            simple: false,
          },
          input.prompt,
        );
        const sessions = await Promise.all(
          input.engines.map(async (kind) => ({
            kind,
            engine: await ctx.engineRegistry.get(kind).createSession({
              projectId: input.projectId,
              title: "五引擎盲测",
              metadata: { experiment: true },
            }),
          })),
        );
        const now = new Date().toISOString();
        const experiment: ExperimentRow = {
          id: randomUUID(),
          project_id: input.projectId,
          chapter_id: input.chapterId ?? null,
          prompt: input.prompt,
          task_type: input.taskType,
          status: "running",
          selected_candidate_id: null,
          version: 1,
          created_at: now,
          updated_at: now,
        };
        const work = sessions.map(({ kind, engine }, ordinal) => {
          const session: AssistantSessionRow = {
            id: randomUUID(),
            engine_session_id: engine.sessionId,
            project_id: input.projectId,
            engine_kind: kind,
            title: "五引擎盲测",
            state: "active",
            version: 1,
            created_at: now,
            updated_at: now,
          };
          const run: AssistantRunRow = {
            id: randomUUID(),
            session_id: session.id,
            engine_run_id: randomUUID(),
            state: "queued",
            prompt,
            input_tokens: 0,
            output_tokens: 0,
            cost_micros: 0,
            error_code: null,
            error_message: null,
            version: 1,
            created_at: now,
            updated_at: now,
          };
          const candidate: CandidateRow = {
            id: randomUUID(),
            experiment_id: experiment.id,
            engine_kind: kind,
            ordinal,
            session_id: session.id,
            run_id: run.id,
            state: "queued",
            output: "",
            created_at: now,
          };
          return { session, run, candidate, claimId: randomUUID() };
        });
        ctx.uow.execute((tx) => {
          tx.run(
            `INSERT INTO agent_experiments (id, project_id, chapter_id, prompt, task_type, status, selected_candidate_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', NULL, 1, ?, ?)`,
            experiment.id,
            experiment.project_id,
            experiment.chapter_id,
            experiment.prompt,
            experiment.task_type,
            now,
            now,
          );
          for (const item of work) {
            tx.run(
              `INSERT INTO agents_sessions (id, engine_session_id, project_id, engine_kind, title, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
              item.session.id,
              item.session.engine_session_id,
              item.session.project_id,
              item.session.engine_kind,
              item.session.title,
              now,
              now,
            );
            tx.run(
              `INSERT INTO agents_runs (id, session_id, engine_run_id, state, prompt, input_tokens, output_tokens, cost_micros, error_code, error_message, version, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, 0, 0, 0, NULL, NULL, 1, ?, ?)`,
              item.run.id,
              item.session.id,
              item.run.engine_run_id,
              prompt,
              now,
              now,
            );
            tx.run(
              `INSERT INTO agents_mcp_claims (id, project_id, session_id, run_id, read_only, max_results, expires_at, created_at) VALUES (?, ?, ?, ?, 1, 50, ?, ?)`,
              item.claimId,
              input.projectId,
              item.session.id,
              item.run.id,
              new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
              now,
            );
            tx.run(
              `INSERT INTO agent_experiment_candidates (id, experiment_id, engine_kind, ordinal, session_id, run_id, state, output, created_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', '', ?)`,
              item.candidate.id,
              experiment.id,
              item.candidate.engine_kind,
              item.candidate.ordinal,
              item.session.id,
              item.run.id,
              now,
            );
          }
        });
        for (const item of work) {
          activeClaims.set(item.session.engine_kind, item.claimId);
          const provider = ctx.engineRegistry.get(item.session.engine_kind);
          void consume(
            item.run,
            provider.run({
              runId: item.run.engine_run_id,
              sessionId: item.session.engine_session_id,
              prompt,
            }),
            {
              onCompleted(output) {
                finishExperimentCandidate(
                  ctx,
                  item.candidate.id,
                  "succeeded",
                  output,
                );
              },
              onFailed(error) {
                finishExperimentCandidate(
                  ctx,
                  item.candidate.id,
                  "failed",
                  error instanceof Error ? error.message : String(error),
                );
              },
            },
          ).finally(async () => {
            if (activeClaims.get(item.session.engine_kind) === item.claimId)
              activeClaims.delete(item.session.engine_kind);
            try {
              await provider.dispose(item.session.engine_session_id);
            } finally {
              ctx.uow.execute((tx) =>
                tx.run(
                  "UPDATE agents_sessions SET state = 'disposed', version = version + 1, updated_at = ? WHERE id = ? AND state = 'active'",
                  new Date().toISOString(),
                  item.session.id,
                ),
              );
            }
          });
        }
        return context.json(experimentJson(ctx, experiment), 202);
      },
    )) as never;
  }) as never);

  const get = createRoute({
    method: "get",
    path: "/api/v2/agents/experiments/{id}",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: response(agentExperimentSchema, "Blind experiment"),
      ...errors,
    },
  });
  app.openapi(get, (context) => {
    const row = ctx.uow.execute((tx) =>
      tx.get<ExperimentRow>(
        "SELECT * FROM agent_experiments WHERE id = ?",
        context.req.valid("param").id,
      ),
    );
    if (!row)
      throw new ApiProblem(
        404,
        "EXPERIMENT_NOT_FOUND",
        "blind experiment does not exist",
      );
    context.header("etag", `"v${row.version}"`);
    return context.json(experimentJson(ctx, row));
  });

  const review = createRoute({
    method: "post",
    path: "/api/v2/agents/experiments/{id}/actions/review",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: reviewAgentExperimentSchema },
        },
      },
    },
    responses: {
      200: response(agentExperimentSchema, "Blind experiment reviewed"),
      ...errors,
    },
  });
  app.openapi(review, (async (context: any) => {
    const input = context.req.valid("json") as z.infer<
      typeof reviewAgentExperimentSchema
    >;
    return (await idempotentResponse(
      ctx.uow,
      context.req.raw,
      `agents.experiments.${context.req.valid("param").id}.review`,
      input,
      async () => {
        const row = ctx.uow.execute((tx) =>
          tx.get<ExperimentRow>(
            "SELECT * FROM agent_experiments WHERE id = ?",
            context.req.valid("param").id,
          ),
        );
        if (!row)
          throw new ApiProblem(
            404,
            "EXPERIMENT_NOT_FOUND",
            "blind experiment does not exist",
          );
        requireIfMatch(context.req.raw, row.version);
        if (row.status !== "ready")
          throw new ApiProblem(
            409,
            "EXPERIMENT_NOT_READY",
            "wait for all candidates before reviewing",
          );
        const candidate = ctx.uow.execute((tx) =>
          tx.get<CandidateRow>(
            "SELECT * FROM agent_experiment_candidates WHERE id = ? AND experiment_id = ?",
            input.selectedCandidateId,
            row.id,
          ),
        );
        if (!candidate)
          throw new ApiProblem(
            400,
            "EXPERIMENT_CANDIDATE_INVALID",
            "selected candidate is not part of this experiment",
          );
        const updated = ctx.uow.execute((tx) => {
          tx.run(
            "INSERT INTO agent_experiment_reviews (id, experiment_id, selected_candidate_id, scores_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            randomUUID(),
            row.id,
            candidate.id,
            JSON.stringify(input.scores ?? {}),
            input.notes,
            new Date().toISOString(),
          );
          tx.run(
            "UPDATE agent_experiments SET status = 'reviewed', selected_candidate_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            candidate.id,
            new Date().toISOString(),
            row.id,
            row.version,
          );
          return tx.get<ExperimentRow>(
            "SELECT * FROM agent_experiments WHERE id = ?",
            row.id,
          )!;
        });
        context.header("etag", `"v${updated.version}"`);
        return context.json(experimentJson(ctx, updated), 200);
      },
    )) as never;
  }) as never);
}
