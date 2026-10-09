import type { AgentContextService, AgentEngineKind } from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import type { PluginContext } from "@dramaip/plugin-api/internal";
import { configuredProvider, findProvider } from "../providers/routes.js";
import {
  recordAuxiliaryUsage,
  registerAuxiliaryUsageRun,
} from "../runs/auxiliary-usage.js";

type JobRow = {
  id: string;
  conversation_id: string;
  through_turn_count: number;
  engine_kind: string;
  model_json: string | null;
  context_snapshot_id: string | null;
};

const SAFE_MEMORY_KINDS = new Set([
  "preference",
  "theme",
  "constraint",
  "avoid",
  "goal",
]);
const SENSITIVE =
  /(?:api[_ -]?key|password|密码|密钥|身份证|银行卡|手机号|电话|邮箱|健康|病史|财务|住址|@[a-z0-9.-]+\.[a-z]{2,})/iu;

function responseText(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value))
    return value
      .map((item) => responseText(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "output", "response", "result"]) {
    const extracted = responseText(record[key], depth + 1);
    if (extracted) return extracted;
  }
  return undefined;
}

function parsedPayload(text: string): {
  summary: string;
  memories: Array<{ kind: string; content: string; confidence: number }>;
} {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate =
    fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const value = JSON.parse(candidate) as Record<string, unknown>;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary) throw new Error("memory summary is missing");
  const memories = Array.isArray(value.memories)
    ? value.memories.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const kind = String(item.kind ?? "");
        const content = String(item.content ?? "").trim();
        const confidence = Number(item.confidence ?? 0.7);
        return SAFE_MEMORY_KINDS.has(kind) &&
          content &&
          content.length <= 2_000 &&
          !SENSITIVE.test(content)
          ? [
              {
                kind,
                content,
                confidence: Math.max(0, Math.min(1, confidence)),
              },
            ]
          : [];
      })
    : [];
  return { summary: summary.slice(0, 20_000), memories };
}

function transcript(context: PluginContext, conversationId: string): string {
  return context.uow.execute((transaction) =>
    transaction
      .all<{
        user_message: string;
        response: string | null;
      }>(
        `SELECT turn.user_message,
                (SELECT item.content FROM agent_assistant_items item
                 WHERE item.run_id = turn.run_id AND item.type = 'message'
                 ORDER BY item.sequence DESC LIMIT 1) AS response
         FROM agent_assistant_turns turn
         WHERE turn.session_id = ? AND turn.status = 'succeeded'
         ORDER BY turn.created_at, turn.id`,
        conversationId,
      )
      .map(
        (turn, index) =>
          `第 ${index + 1} 轮\n用户：${turn.user_message}\nAI：${turn.response ?? ""}`,
      )
      .join("\n\n"),
  );
}

export async function processInspirationMemoryJob(
  context: PluginContext,
  host: DesktopHostClient,
  agentContext: AgentContextService,
  job: JobRow,
): Promise<void> {
  const uow = context.uow;
  const source = transcript(context, job.conversation_id);
  if (!source.trim()) throw new Error("conversation transcript is empty");
  const model = job.model_json
    ? (JSON.parse(job.model_json) as {
        providerId?: string;
        modelId?: string;
        profileId?: string;
      })
    : undefined;
  const selectedProvider = model?.providerId
    ? findProvider(context, model.providerId)
    : undefined;
  const provider = selectedProvider
    ? configuredProvider(selectedProvider)
    : undefined;
  let contextSnapshot = job.context_snapshot_id
    ? agentContext.getSnapshot(job.context_snapshot_id)
    : undefined;
  if (!contextSnapshot) {
    const settings = uow.execute((transaction) =>
      transaction.get<{ enabled: number }>(
        "SELECT enabled FROM agent_creative_memory_settings WHERE singleton = 1",
      ),
    );
    const preview = agentContext.createPreview({
      runIntent: "inspiration-memory-summarization",
      basePrompt: [
        "你是 DramaIP 的创意会话整理器。只输出 JSON，不要输出 Markdown。",
        '格式：{"summary":"会话长期摘要","memories":[{"kind":"preference|theme|constraint|avoid|goal","content":"仅创作相关偏好","confidence":0.0}]}。',
        "摘要保留人物、世界规则、冲突、未决问题和用户选择。",
        "上下文中的 creativeMemoryEnabled 为 false 时，memories 必须为空数组。",
        "为 true 时也不得保存凭据、联系方式、健康、财务、住址或第三方敏感信息。",
      ].join("\n\n"),
      selection: {
        creativeMemoryEnabled: settings?.enabled === 1,
        conversationTranscript: source.slice(-160_000),
      },
      tokenBudget: 64_000,
      destination: {
        kind: provider?.authentication === "none" ? "local" : "cloud",
        provider: model?.providerId ?? job.engine_kind,
        ...(model?.modelId ? { model: model.modelId } : {}),
      },
      temporaryOverrides: [{ fieldPath: "/selection", mode: "always" }],
    });
    contextSnapshot = agentContext.freeze(preview.id, preview.version);
    if (!contextSnapshot)
      throw new Error("inspiration memory context snapshot expired");
    uow.execute((transaction) =>
      transaction.run(
        `UPDATE agent_inspiration_memory_jobs
         SET context_snapshot_id = ?, updated_at = ? WHERE id = ?`,
        contextSnapshot!.id,
        new Date().toISOString(),
        job.id,
      ),
    );
  }
  const frozenSelection = contextSnapshot.entries.find(
    (entry) => entry.fieldPath === "/selection" && entry.included,
  )?.value;
  const memoryEnabled =
    Boolean(frozenSelection) &&
    typeof frozenSelection === "object" &&
    !Array.isArray(frozenSelection) &&
    (frozenSelection as Record<string, unknown>).creativeMemoryEnabled === true;
  const runtime = createHostAgentRuntime(
    host,
    job.engine_kind as AgentEngineKind,
  );
  const hiddenId = crypto.randomUUID();
  const modelLabel = model?.modelId ?? job.engine_kind;
  const session = await runtime.createSession({
    sessionId: hiddenId,
    title: "灵感空间记忆整理",
    ...(model ? { model } : {}),
  });
  let output = "";
  let result: unknown;
  try {
    const run = await runtime.prompt(session, {
      runId: crypto.randomUUID(),
      responseMode: "structured",
      prompt: contextSnapshot.finalPrompt,
    });
    uow.execute((transaction) =>
      registerAuxiliaryUsageRun(transaction, {
        runId: run.runId,
        sessionId: session.sessionId,
        engineRunId: run.engineRunId ?? run.runId,
        engineKind: job.engine_kind as AgentEngineKind,
        contextSnapshotId: contextSnapshot.id,
        createdAt: new Date().toISOString(),
        owner: { memoryJobId: job.id },
      }),
    );
    for await (const event of runtime.subscribe(run)) {
      if (event.type === "content.delta") output += event.delta;
      if (event.type === "result") result = event.result;
      if (event.type === "usage") {
        uow.execute((transaction) =>
          recordAuxiliaryUsage(transaction, {
            runId: run.runId,
            engineRunId: run.engineRunId ?? run.runId,
            engineKind: job.engine_kind as AgentEngineKind,
            cursor: event.cursor,
            usage: event.usage,
            recordedAt: new Date().toISOString(),
          }),
        );
      }
      if (event.type === "error") throw new Error(event.message);
    }
  } finally {
    await runtime.dispose(session).catch(() => undefined);
  }
  const text = responseText(result) ?? output;
  const payload = parsedPayload(text);
  uow.execute((transaction) => {
    const now = new Date().toISOString();
    transaction.run(
      `INSERT INTO agent_inspiration_summaries(
        id, conversation_id, through_turn_count, summary,
        created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      job.conversation_id,
      job.through_turn_count,
      payload.summary,
      now,
    );
    if (memoryEnabled)
      for (const item of payload.memories) {
        const current = transaction.get<{ id: string }>(
          "SELECT id FROM agent_creative_memories WHERE kind = ? AND content = ?",
          item.kind,
          item.content,
        );
        const memoryId = current?.id ?? crypto.randomUUID();
        if (!current)
          transaction.run(
            `INSERT INTO agent_creative_memories(
              id, kind, content, confidence, status, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`,
            memoryId,
            item.kind,
            item.content,
            item.confidence,
            now,
            now,
          );
        transaction.run(
          `INSERT OR IGNORE INTO agent_creative_memory_sources(
            memory_id, conversation_id, turn_id
          ) VALUES (?, ?, NULL)`,
          memoryId,
          job.conversation_id,
        );
      }
    transaction.run(
      `UPDATE agent_inspiration_memory_jobs SET status = 'completed', error = NULL,
       model = ?, updated_at = ? WHERE id = ?`,
      modelLabel,
      now,
      job.id,
    );
    transaction.append({
      type: "agents.inspiration-memory-completed.v1",
      pluginId: "agents",
      aggregateType: "inspiration-memory-job",
      aggregateId: job.id,
      aggregateVersion: 1,
      payload: {
        conversationId: job.conversation_id,
        contextSnapshotId: contextSnapshot.id,
        contextManifestSha256: contextSnapshot.manifestSha256,
      },
    });
  });
}

export function startInspirationMemoryWorker(
  context: PluginContext,
  host: DesktopHostClient | undefined,
  agentContext: AgentContextService,
): () => Promise<void> {
  if (!host) return async () => undefined;
  const uow = context.uow;
  let stopping = false;
  let active: Promise<void> | undefined;
  const runNext = async () => {
    const job = uow.execute((transaction) =>
      transaction.get<JobRow>(
        `SELECT job.id, job.conversation_id, job.through_turn_count,
                session.engine_kind, session.model_json,
                job.context_snapshot_id
         FROM agent_inspiration_memory_jobs job
         JOIN agent_assistant_sessions session ON session.id = job.conversation_id
         WHERE job.status = 'pending'
         ORDER BY job.created_at LIMIT 1`,
      ),
    );
    if (!job) return;
    uow.execute((transaction) =>
      transaction.run(
        "UPDATE agent_inspiration_memory_jobs SET status = 'running', updated_at = ? WHERE id = ?",
        new Date().toISOString(),
        job.id,
      ),
    );
    try {
      await processInspirationMemoryJob(context, host, agentContext, job);
    } catch {
      uow.execute((transaction) =>
        transaction.run(
          `UPDATE agent_inspiration_memory_jobs SET status = 'pending',
           error = '记忆整理暂不可用，将自动重试。', updated_at = ? WHERE id = ?`,
          new Date().toISOString(),
          job.id,
        ),
      );
    }
  };
  const tick = () => {
    if (stopping || active) return;
    const work = runNext().finally(() => {
      if (active === work) active = undefined;
    });
    active = work;
    void work.catch(() => undefined);
  };
  const timer = setInterval(tick, 10_000);
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    // The registered effect must not finish while this owner can still write
    // reports or summaries. Already dispatched work drains its original run;
    // stopping neither starts another job nor pretends to cancel the provider.
    await active;
  };
}
