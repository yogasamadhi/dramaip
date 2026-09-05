import { createHash, randomUUID } from "node:crypto";
import {
  AgentContextPreviewInputSchema,
  AgentContextPreviewSchema,
  AgentContextSnapshotSchema,
  type AgentContextEntry,
  type AgentContextPolicy,
  type AgentContextPolicyMode,
  type AgentContextPreview,
  type AgentContextPreviewInput,
  type AgentContextService,
  type AgentContextSnapshot,
} from "@dramaip/contracts/agent-context";
import { CREATIVE_KNOWLEDGE_SERVICE } from "@dramaip/contracts/creative-intelligence";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
} from "@dramaip/contracts/writing";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import type {
  PluginContext,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

interface PreviewRow {
  id: string;
  project_id: string | null;
  input_json: string;
  entries_json: string;
  token_budget: number;
  estimated_tokens: number;
  destination_json: string;
  final_prompt: string;
  manifest_sha256: string;
  version: number;
  status: "pending" | "frozen" | "expired";
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  preview_id: string;
  project_id: string | null;
  entries_json: string;
  token_budget: number;
  estimated_tokens: number;
  destination_json: string;
  final_prompt: string;
  manifest_sha256: string;
  final_prompt_sha256: string;
  created_at: string;
}

const contextKinds = ["characters", "outlines", "story-arcs"] as const;

export interface AgentContextStore extends AgentContextService {
  getPreview(id: string): AgentContextPreview | undefined;
  getRunSnapshot(runId: string): AgentContextSnapshot | undefined;
  policies(projectId: string): {
    version: number;
    policies: readonly AgentContextPolicy[];
  };
  replacePolicies(
    projectId: string,
    expectedVersion: number,
    values: readonly { fieldPath: string; mode: AgentContextPolicyMode }[],
  ): { version: number; policies: readonly AgentContextPolicy[] } | "conflict";
}

export function createAgentContextStore(
  context: PluginContext,
): AgentContextStore {
  const projectService = context.services.optional(WORKSPACE_PROJECT_SERVICE);
  const chapterService = context.services.optional(WRITING_CHAPTER_SERVICE);
  const resourceService = context.services.optional(WRITING_RESOURCE_SERVICE);
  const knowledgeService = context.services.optional(
    CREATIVE_KNOWLEDGE_SERVICE,
  );

  const readPolicies = (projectId: string) =>
    context.uow.execute((transaction) => {
      const version =
        transaction.get<{ version: number }>(
          "SELECT version FROM agent_context_policy_sets WHERE project_id = ?",
          projectId,
        )?.version ?? 0;
      const policies = transaction
        .all<{
          field_path: string;
          mode: AgentContextPolicyMode;
          version: number;
          updated_at: string;
        }>(
          `SELECT field_path, mode, version, updated_at
           FROM agent_context_policies
           WHERE project_id = ? ORDER BY field_path`,
          projectId,
        )
        .map((row) => ({
          projectId,
          fieldPath: row.field_path,
          mode: row.mode,
          version: row.version,
          updatedAt: row.updated_at,
        }));
      return { version, policies };
    });

  const build = (raw: AgentContextPreviewInput): AgentContextPreview => {
    const input = AgentContextPreviewInputSchema.parse(raw);
    const project = input.projectId
      ? projectService?.get(input.projectId)
      : undefined;
    if (input.projectId && !project)
      throw new Error("项目不存在或当前上下文无法读取项目。");
    const chapter = input.chapterId
      ? chapterService?.get(input.chapterId)
      : undefined;
    if (
      input.chapterId &&
      (!input.projectId || !chapter || chapter.projectId !== input.projectId)
    )
      throw new Error("章节不存在或不属于当前项目。");

    const candidates: Omit<
      AgentContextEntry,
      "mode" | "included" | "reason" | "estimatedTokens"
    >[] = [
      {
        sourceKind: "intent",
        sourceId: "run-intent",
        sourceVersion: 0,
        fieldPath: "/intent",
        value: input.runIntent,
        sensitivity: "project",
      },
    ];
    if (project)
      candidates.push({
        sourceKind: "project",
        sourceId: project.id,
        sourceVersion: project.version,
        fieldPath: "/project",
        value: jsonValue({
          id: project.id,
          title: project.title,
          mode: project.mode,
          targetAudience: project.targetAudience,
          targetEpisodeCount: project.targetEpisodeCount,
          coreHook: project.coreHook,
          emotionalCore: project.emotionalCore,
          coreSellingPoint: project.coreSellingPoint,
          synopsis: project.synopsis,
          styleGuide: project.styleGuide,
          visualStyleDirection: project.visualStyleDirection,
          productionBrief: project.productionBrief,
        }),
        sensitivity: "project",
      });
    if (chapter)
      candidates.push({
        sourceKind: "chapter",
        sourceId: chapter.id,
        sourceVersion: chapter.version,
        fieldPath: `/chapters/${chapter.id}`,
        value: jsonValue(chapter),
        sensitivity: "project",
      });
    if (input.selection !== undefined)
      candidates.push({
        sourceKind: "selection",
        sourceId: input.chapterId ?? input.projectId ?? "projectless-selection",
        sourceVersion: chapter?.version ?? project?.version ?? 0,
        fieldPath: "/selection",
        value: jsonValue(input.selection),
        sensitivity: project ? "project" : "personal",
      });
    if (knowledgeService && input.projectId) {
      try {
        const storyProjection = {
          causalNodes: knowledgeService.listNodes(input.projectId),
          causalEdges: knowledgeService.listEdges(input.projectId),
          provenance: knowledgeService.listProvenance(input.projectId),
        };
        candidates.push({
          sourceKind: "story_bible",
          sourceId: input.projectId,
          sourceVersion: 0,
          fieldPath: "/story-bible/ip-twin",
          value: jsonValue(storyProjection),
          sensitivity: "project",
        });
      } catch {
        // A missing optional projection is recorded by absence, not fabricated.
      }
    }
    if (resourceService && input.projectId)
      for (const kind of contextKinds)
        for (const resource of resourceService.list(kind, input.projectId))
          candidates.push({
            sourceKind: "writing_resource",
            sourceId: resource.id,
            sourceVersion: resource.version,
            fieldPath: `/writing-resources/${resource.domain}/${resource.id}`,
            value: jsonValue({
              title: resource.title,
              domain: resource.domain,
              payload: resource.payload,
            }),
            sensitivity: "project",
          });

    const projectPolicies = new Map(
      input.projectId
        ? readPolicies(input.projectId).policies.map((policy) => [
            policy.fieldPath,
            policy.mode,
          ])
        : [],
    );
    const temporary = new Map(
      input.temporaryOverrides.map((override) => [
        override.fieldPath,
        override.mode,
      ]),
    );
    const baseTokens = estimateTokens(input.basePrompt);
    if (baseTokens > input.tokenBudget)
      throw new Error("基础提示词已超过本次运行的 token 硬预算。");
    const entries = candidates.map((candidate) => {
      const mode =
        temporary.get(candidate.fieldPath) ??
        projectPolicies.get(candidate.fieldPath) ??
        "auto";
      return {
        ...candidate,
        mode,
        included: mode === "always",
        reason:
          mode === "always"
            ? "字段策略要求始终包含。"
            : mode === "never"
              ? "字段策略禁止发送。"
              : "等待依据任务相关度和 token 预算自动选择。",
        estimatedTokens: estimateTokens(candidate.value),
      } satisfies AgentContextEntry;
    });
    const alwaysTokens = entries
      .filter((entry) => entry.mode === "always")
      .reduce((total, entry) => total + entry.estimatedTokens, 0);
    if (baseTokens + alwaysTokens > input.tokenBudget)
      throw new Error("always 字段与基础提示词超过 token 硬预算，运行已阻止。");
    let used = baseTokens + alwaysTokens;
    for (const entry of [...entries]
      .filter((value) => value.mode === "auto")
      .sort(
        (left, right) =>
          priority(right.sourceKind) - priority(left.sourceKind) ||
          left.fieldPath.localeCompare(right.fieldPath),
      )) {
      if (used + entry.estimatedTokens <= input.tokenBudget) {
        entry.included = true;
        entry.reason = "与当前任务相关且在 token 预算内。";
        used += entry.estimatedTokens;
      } else {
        entry.included = false;
        entry.reason = "auto 字段因 token 硬预算被裁剪。";
      }
    }
    const finalPrompt = composePrompt(input.basePrompt, entries);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const id = randomUUID();
    const manifestSha256 = sha256(
      canonicalJson({
        projectId: input.projectId,
        destination: input.destination,
        tokenBudget: input.tokenBudget,
        entries,
      }),
    );
    const preview = AgentContextPreviewSchema.parse({
      id,
      projectId: input.projectId,
      entries,
      tokenBudget: input.tokenBudget,
      estimatedTokens: estimateTokens(finalPrompt),
      destination: input.destination,
      finalPromptPreview: finalPrompt,
      manifestSha256,
      version: 0,
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    context.uow.execute((transaction) =>
      transaction.run(
        `INSERT INTO agent_context_previews(
          id, project_id, input_json, entries_json, token_budget,
          estimated_tokens, destination_json, final_prompt, manifest_sha256,
          version, status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`,
        id,
        input.projectId ?? null,
        JSON.stringify(input),
        JSON.stringify(entries),
        input.tokenBudget,
        preview.estimatedTokens,
        JSON.stringify(input.destination),
        finalPrompt,
        manifestSha256,
        expiresAt,
        now,
        now,
      ),
    );
    return preview;
  };

  const getPreview = (id: string) =>
    context.uow.execute((transaction) => {
      const row = transaction.get<PreviewRow>(
        "SELECT * FROM agent_context_previews WHERE id = ?",
        id,
      );
      return row ? previewFromRow(row) : undefined;
    });

  const updatePreview: AgentContextService["updatePreview"] = (
    id,
    expectedVersion,
    temporaryOverrides,
  ) => {
    const current = context.uow.execute((transaction) =>
      transaction.get<PreviewRow>(
        "SELECT * FROM agent_context_previews WHERE id = ?",
        id,
      ),
    );
    if (!current) return undefined;
    if (current.version !== expectedVersion || current.status !== "pending")
      return "conflict";
    const input = AgentContextPreviewInputSchema.parse({
      ...JSON.parse(current.input_json),
      temporaryOverrides,
    });
    const replacement = build(input);
    return context.uow.execute((transaction) => {
      const stillCurrent = transaction.get<PreviewRow>(
        "SELECT * FROM agent_context_previews WHERE id = ?",
        id,
      );
      if (!stillCurrent || stillCurrent.version !== expectedVersion) {
        deletePreview(transaction, replacement.id);
        return "conflict" as const;
      }
      const generated = transaction.get<PreviewRow>(
        "SELECT * FROM agent_context_previews WHERE id = ?",
        replacement.id,
      )!;
      transaction.run(
        `UPDATE agent_context_previews SET input_json = ?, entries_json = ?,
         estimated_tokens = ?, destination_json = ?, final_prompt = ?,
         manifest_sha256 = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        generated.input_json,
        generated.entries_json,
        generated.estimated_tokens,
        generated.destination_json,
        generated.final_prompt,
        generated.manifest_sha256,
        new Date().toISOString(),
        id,
      );
      deletePreview(transaction, replacement.id);
      return previewFromRow({
        ...generated,
        id,
        version: expectedVersion + 1,
        created_at: current.created_at,
      });
    });
  };

  const getSnapshot = (id: string) =>
    context.uow.execute((transaction) => {
      const row = transaction.get<SnapshotRow>(
        "SELECT * FROM agent_context_snapshots WHERE id = ?",
        id,
      );
      return row ? snapshotFromRow(row) : undefined;
    });

  const freeze: AgentContextService["freeze"] = (id, expectedVersion) =>
    context.uow.execute((transaction) => {
      const existing = transaction.get<SnapshotRow>(
        "SELECT * FROM agent_context_snapshots WHERE preview_id = ?",
        id,
      );
      if (existing) return snapshotFromRow(existing);
      const preview = transaction.get<PreviewRow>(
        "SELECT * FROM agent_context_previews WHERE id = ?",
        id,
      );
      if (
        !preview ||
        preview.version !== expectedVersion ||
        preview.status !== "pending" ||
        Date.parse(preview.expires_at) <= Date.now()
      )
        return undefined;
      const snapshotId = randomUUID();
      const createdAt = new Date().toISOString();
      const finalPromptSha256 = sha256(preview.final_prompt);
      transaction.run(
        `INSERT INTO agent_context_snapshots(
          id, preview_id, project_id, entries_json, token_budget,
          estimated_tokens, destination_json, final_prompt, manifest_sha256,
          final_prompt_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        snapshotId,
        preview.id,
        preview.project_id,
        preview.entries_json,
        preview.token_budget,
        preview.estimated_tokens,
        preview.destination_json,
        preview.final_prompt,
        preview.manifest_sha256,
        finalPromptSha256,
        createdAt,
      );
      transaction.run(
        "UPDATE agent_context_previews SET status = 'frozen', updated_at = ? WHERE id = ?",
        createdAt,
        id,
      );
      return snapshotFromRow({
        id: snapshotId,
        preview_id: preview.id,
        project_id: preview.project_id,
        entries_json: preview.entries_json,
        token_budget: preview.token_budget,
        estimated_tokens: preview.estimated_tokens,
        destination_json: preview.destination_json,
        final_prompt: preview.final_prompt,
        manifest_sha256: preview.manifest_sha256,
        final_prompt_sha256: finalPromptSha256,
        created_at: createdAt,
      });
    });

  const replacePolicies: AgentContextStore["replacePolicies"] = (
    projectId,
    expectedVersion,
    values,
  ) =>
    context.uow.execute((transaction) => {
      const current =
        transaction.get<{ version: number }>(
          "SELECT version FROM agent_context_policy_sets WHERE project_id = ?",
          projectId,
        )?.version ?? 0;
      if (current !== expectedVersion) return "conflict" as const;
      const nextVersion = current + 1;
      const now = new Date().toISOString();
      transaction.run(
        `INSERT INTO agent_context_policy_sets(project_id, version, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET version = excluded.version,
           updated_at = excluded.updated_at`,
        projectId,
        nextVersion,
        now,
      );
      transaction.run(
        "DELETE FROM agent_context_policies WHERE project_id = ?",
        projectId,
      );
      for (const value of values)
        transaction.run(
          `INSERT INTO agent_context_policies(
            project_id, field_path, mode, version, updated_at
          ) VALUES (?, ?, ?, ?, ?)`,
          projectId,
          value.fieldPath,
          value.mode,
          nextVersion,
          now,
        );
      return {
        version: nextVersion,
        policies: values.map((value) => ({
          projectId,
          fieldPath: value.fieldPath,
          mode: value.mode,
          version: nextVersion,
          updatedAt: now,
        })),
      };
    });

  return {
    createPreview: build,
    getPreview,
    updatePreview,
    freeze,
    getSnapshot,
    getRunSnapshot(runId) {
      const id = context.uow.execute(
        (transaction) =>
          transaction.get<{ context_snapshot_id: string | null }>(
            "SELECT context_snapshot_id FROM agent_assistant_runs WHERE id = ?",
            runId,
          )?.context_snapshot_id,
      );
      return id ? getSnapshot(id) : undefined;
    },
    bindRun(snapshotId, runId) {
      context.uow.execute((transaction) => {
        const snapshot = transaction.get<{ id: string }>(
          "SELECT id FROM agent_context_snapshots WHERE id = ?",
          snapshotId,
        );
        if (!snapshot) throw new Error("AI 上下文快照不存在。");
        transaction.run(
          "UPDATE agent_assistant_runs SET context_snapshot_id = ?, updated_at = ? WHERE id = ?",
          snapshotId,
          new Date().toISOString(),
          runId,
        );
      });
    },
    policies: readPolicies,
    replacePolicies,
  };
}

function deletePreview(transaction: UnitOfWorkTransaction, id: string): void {
  transaction.run("DELETE FROM agent_context_previews WHERE id = ?", id);
}

function previewFromRow(row: PreviewRow): AgentContextPreview {
  return AgentContextPreviewSchema.parse({
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    entries: JSON.parse(row.entries_json),
    tokenBudget: row.token_budget,
    estimatedTokens: row.estimated_tokens,
    destination: JSON.parse(row.destination_json),
    finalPromptPreview: row.final_prompt,
    manifestSha256: row.manifest_sha256,
    version: row.version,
    status:
      row.status === "pending" && Date.parse(row.expires_at) <= Date.now()
        ? "expired"
        : row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function snapshotFromRow(row: SnapshotRow): AgentContextSnapshot {
  return AgentContextSnapshotSchema.parse({
    id: row.id,
    previewId: row.preview_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    entries: JSON.parse(row.entries_json),
    tokenBudget: row.token_budget,
    estimatedTokens: row.estimated_tokens,
    destination: JSON.parse(row.destination_json),
    finalPrompt: row.final_prompt,
    manifestSha256: row.manifest_sha256,
    finalPromptSha256: row.final_prompt_sha256,
    createdAt: row.created_at,
  });
}

function priority(kind: AgentContextEntry["sourceKind"]): number {
  return {
    intent: 100,
    selection: 90,
    chapter: 80,
    project: 70,
    story_bible: 60,
    writing_resource: 50,
  }[kind];
}

function composePrompt(
  basePrompt: string,
  entries: readonly AgentContextEntry[],
): string {
  const included = entries.filter((entry) => entry.included);
  if (!included.length) return basePrompt;
  return `${basePrompt}\n\n[DramaIP CONTEXT — frozen for this run]\n${included
    .map(
      (entry) =>
        `${entry.fieldPath} (source=${entry.sourceKind}:${entry.sourceId}@${entry.sourceVersion})\n${JSON.stringify(entry.value)}`,
    )
    .join("\n\n")}`;
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
