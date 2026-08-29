import type { AgentEngineKind } from "@dramaip/contracts";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import type { PluginContext } from "@dramaip/plugin-api/internal";

type JobRow = {
  id: string;
  conversation_id: string;
  through_turn_count: number;
  engine_kind: string;
  model_json: string | null;
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

async function processJob(
  context: PluginContext,
  host: DesktopHostClient,
  job: JobRow,
): Promise<void> {
  const source = transcript(context, job.conversation_id);
  if (!source.trim()) throw new Error("conversation transcript is empty");
  const settings = context.uow.execute((transaction) =>
    transaction.get<{ enabled: number }>(
      "SELECT enabled FROM agent_creative_memory_settings WHERE singleton = 1",
    ),
  );
  const runtime = createHostAgentRuntime(
    host,
    job.engine_kind as AgentEngineKind,
  );
  const hiddenId = crypto.randomUUID();
  const model = job.model_json
    ? (JSON.parse(job.model_json) as {
        providerId?: string;
        modelId?: string;
        profileId?: string;
      })
    : undefined;
  const modelLabel = model?.modelId ?? job.engine_kind;
  const session = await runtime.createSession({
    sessionId: hiddenId,
    title: "灵感空间记忆整理",
    ...(model ? { model } : {}),
  });
  let output = "";
  let result: unknown;
  let inputTokens = Math.ceil(source.length / 4);
  let outputTokens = 0;
  try {
    const run = await runtime.prompt(session, {
      runId: crypto.randomUUID(),
      responseMode: "structured",
      prompt: [
        "你是 DramaIP 的创意会话整理器。只输出 JSON，不要输出 Markdown。",
        '格式：{"summary":"会话长期摘要","memories":[{"kind":"preference|theme|constraint|avoid|goal","content":"仅创作相关偏好","confidence":0.0}]}。',
        "摘要保留人物、世界规则、冲突、未决问题和用户选择。",
        settings?.enabled
          ? "可提取跨会话创作记忆，但不得保存凭据、联系方式、健康、财务、住址或第三方敏感信息。"
          : "用户未授权跨会话记忆，memories 必须为空数组。",
        `会话内容：\n${source.slice(-160_000)}`,
      ].join("\n\n"),
    });
    for await (const event of runtime.subscribe(run)) {
      if (event.type === "content.delta") output += event.delta;
      if (event.type === "result") result = event.result;
      if (event.type === "usage") {
        inputTokens = event.usage.inputTokens ?? inputTokens;
        outputTokens = event.usage.outputTokens ?? outputTokens;
      }
      if (event.type === "error") throw new Error(event.message);
    }
  } finally {
    await runtime.dispose(session).catch(() => undefined);
  }
  const text = responseText(result) ?? output;
  const payload = parsedPayload(text);
  outputTokens ||= Math.ceil(text.length / 4);
  context.uow.execute((transaction) => {
    const now = new Date().toISOString();
    transaction.run(
      `INSERT INTO agent_inspiration_summaries(
        id, conversation_id, through_turn_count, summary,
        input_tokens, output_tokens, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      job.conversation_id,
      job.through_turn_count,
      payload.summary,
      inputTokens,
      outputTokens,
      now,
    );
    if (settings?.enabled)
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
       model = ?, input_tokens = ?, output_tokens = ?, updated_at = ? WHERE id = ?`,
      modelLabel,
      inputTokens,
      outputTokens,
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
        inputTokens,
        outputTokens,
      },
    });
  });
}

export function startInspirationMemoryWorker(
  context: PluginContext,
  host: DesktopHostClient | undefined,
): () => void {
  if (!host) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    const job = context.uow.execute((transaction) =>
      transaction.get<JobRow>(
        `SELECT job.id, job.conversation_id, job.through_turn_count,
                session.engine_kind, session.model_json
         FROM agent_inspiration_memory_jobs job
         JOIN agent_assistant_sessions session ON session.id = job.conversation_id
         WHERE job.status = 'pending'
         ORDER BY job.created_at LIMIT 1`,
      ),
    );
    if (!job) return;
    running = true;
    context.uow.execute((transaction) =>
      transaction.run(
        "UPDATE agent_inspiration_memory_jobs SET status = 'running', updated_at = ? WHERE id = ?",
        new Date().toISOString(),
        job.id,
      ),
    );
    try {
      await processJob(context, host, job);
    } catch {
      context.uow.execute((transaction) =>
        transaction.run(
          `UPDATE agent_inspiration_memory_jobs SET status = 'pending',
           error = '记忆整理暂不可用，将自动重试。', updated_at = ? WHERE id = ?`,
          new Date().toISOString(),
          job.id,
        ),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 10_000);
  void tick();
  return () => clearInterval(timer);
}
