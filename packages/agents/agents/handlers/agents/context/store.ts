import { optionalService } from "@dramaip/plugin-api/internal";
import { createHash, randomUUID } from "node:crypto";
import {
  AgentContextPreviewInputSchema,
  AgentContextPreviewSchema,
  AgentContextSnapshotSchema,
  AgentContextPreparationRequestSchema,
  agentContextManifestJSON,
  AgentContextEntrySchema,
  type AgentContextEntry,
  type AgentContextReference,
  type AgentContextPolicy,
  type AgentContextPolicyMode,
  type AgentContextPreview,
  type AgentContextPreviewInput,
  type AgentContextService,
  type AgentContextSnapshot,
} from "@dramaip/contracts/agent-context";
import { CREATIVE_KNOWLEDGE_SERVICE } from "@dramaip/contracts/creative-intelligence";
import {
  KNOWLEDGE_STORY_DECLARATION_SERVICE,
  KNOWLEDGE_STORY_ASSERTION_SERVICE,
} from "@dramaip/contracts/knowledge";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
} from "@dramaip/contracts/writing";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { contextPolicy } from "./policy.js";
import { creationReference } from "@dramaip/contracts/creation";
import type {
  PluginContext,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export class ContextSourceUnavailableError extends Error {
  constructor() {
    super("正式叙事来源暂不可核对；未创建上下文或降级为手工图外发。");
  }
}
function formalReferences(read: () => AgentContextReference[]) {
  try {
    return read();
  } catch {
    throw new ContextSourceUnavailableError();
  }
}

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

interface PreparationRow {
  preparation_scope: string;
  key_sha256: string;
  request_sha256: string;
  project_id: string;
  context_sha256: string;
  preview_id: string;
  snapshot_id: string;
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
  const projectService = optionalService(context, WORKSPACE_PROJECT_SERVICE);
  const chapterService = optionalService(context, WRITING_CHAPTER_SERVICE);
  const resourceService = optionalService(context, WRITING_RESOURCE_SERVICE);
  const knowledgeService = optionalService(context, CREATIVE_KNOWLEDGE_SERVICE);

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

  const build = (
    raw: AgentContextPreviewInput,
    preparedReferences?: import("@dramaip/contracts").AgentContextReference[],
    frozenEntries?: AgentContextEntry[],
    transient = false,
  ): AgentContextPreview => {
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
      (!input.projectId ||
        (chapter ? chapter.projectId !== input.projectId : !transient))
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
    if (knowledgeService && input.projectId && !preparedReferences) {
      const assertions = optionalService(
        context,
        KNOWLEDGE_STORY_ASSERTION_SERVICE,
      );
      if (!assertions) throw new ContextSourceUnavailableError();
      // Manual graph projections have no formal source evidence. Do not convert arbitrary sourceType/sourceId or
      // imported/candidate rows into authoritative story facts. Manual entries
      // require explicit context inclusion and retain their own denial paths.
      const causalNodes = knowledgeService
        .listNodes(input.projectId)
        .filter(
          (node) =>
            node.projectId === input.projectId &&
            node.confirmed &&
            node.sourceType === "manual",
        );
      const ids = new Set(causalNodes.map((node) => node.id));
      const causalEdges = knowledgeService
        .listEdges(input.projectId)
        .filter(
          (edge) =>
            edge.projectId === input.projectId &&
            edge.confirmed &&
            ids.has(edge.fromNodeId) &&
            ids.has(edge.toNodeId) &&
            !assertions.isSourceAnchored(input.projectId!, "edge", edge.id),
        );
      const storyProjection = {
        evidenceBasis: "explicit-manual-declarations-not-original-text",
        originalTextVerified: false,
        causalNodes,
        causalEdges,
      };
      candidates.push({
        sourceKind: "knowledge",
        sourceId: input.projectId,
        sourceVersion: 0,
        fieldPath: "/story-bible/ip-twin",
        policyDependencies: [
          ...causalNodes.map((node) => ({
            sourceId: node.id,
            sourceVersion: node.version,
            fieldPath: `/story-declarations/nodes/${node.id}`,
          })),
          ...causalEdges.map((edge) => ({
            sourceId: edge.id,
            sourceVersion: edge.version,
            fieldPath: `/story-declarations/edges/${edge.id}`,
          })),
        ],
        value: jsonValue(storyProjection),
        sensitivity: "project",
      });
    }
    if (input.projectId && !preparedReferences) {
      const declarations = optionalService(
        context,
        KNOWLEDGE_STORY_DECLARATION_SERVICE,
      );
      if (declarations)
        candidates.push(
          ...formalReferences(() => declarations.references(input.projectId!)),
        );
      const assertions = optionalService(
        context,
        KNOWLEDGE_STORY_ASSERTION_SERVICE,
      );
      if (assertions)
        candidates.push(
          ...formalReferences(() => assertions.references(input.projectId!)),
        );
    }
    if (resourceService && input.projectId)
      for (const kind of contextKinds)
        for (const resource of resourceService.list(kind, input.projectId))
          candidates.push({
            sourceKind: "writing_resource",
            sourceId: resource.id,
            sourceVersion: resource.version,
            fieldPath: `/writing-resources/${resource.domain}/${resource.id}`,
            policyDependencies: creationReference(resource.domain, resource)
              .policyDependencies,
            value: jsonValue({
              title: resource.title,
              domain: resource.domain,
              payload: resource.payload,
            }),
            sensitivity: "project",
          });

    if (preparedReferences)
      candidates.splice(0, candidates.length, ...preparedReferences);
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
    let entries = candidates.map((candidate) => {
      const policy = contextPolicy(candidate, projectPolicies, temporary);
      const explicitDeclarationRequired =
        (candidate.fieldPath === "/story-bible/ip-twin" ||
          candidate.fieldPath.startsWith("/story-declarations/") ||
          candidate.fieldPath.startsWith("/story-assertions/")) &&
        policy.mode === "auto";
      const { deniedDependency } = policy;
      const mode = explicitDeclarationRequired ? "never" : policy.mode;
      return {
        ...candidate,
        mode,
        included: mode === "always",
        reason: explicitDeclarationRequired
          ? "人工认知／因果声明不默认外发，须在上下文预览明确选择；来源锚定不等于解释已核验。"
          : deniedDependency
            ? `派生来源 ${deniedDependency} 禁止发送，不能通过摘要或片段绕过。`
            : mode === "always"
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
    if (frozenEntries) {
      entries = frozenEntries;
      if (
        baseTokens +
          entries
            .filter((entry) => entry.included)
            .reduce((total, entry) => total + entry.estimatedTokens, 0) >
        input.tokenBudget
      )
        throw new Error("候选与冻结资料超过本轮上下文预算，请缩小创作范围。");
    }
    // Freeze the exact public JSON representation used by snapshot reads.
    // Prepared owner references may carry additional metadata; hashing that
    // pre-schema object and later stripping it would reject a valid snapshot.
    // Source values and every supported denial dependency are preserved.
    entries = entries.map((entry) => AgentContextEntrySchema.parse(entry));
    const finalPrompt = composePrompt(input.basePrompt, entries);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const id = randomUUID();
    const manifestSha256 = sha256(
      agentContextManifestJSON({
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
    if (!transient)
      context.uow.execute((transaction) =>
        persistPreview(transaction, input, preview),
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
      return persistSnapshot(transaction, preview);
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
    // Same allocation/policy/prompt algorithm, but no preview/snapshot writes.
    // Only trusted prepared references can describe a prospective target.
    previewCreation: (input, references) =>
      build(input, references, undefined, true),
    prepareCreation: (input, references) => {
      const preview = build(input, references);
      // Never override privacy or budgets, but do not run without a required
      // adopted constraint either. Generic previews may still show exclusions.
      for (const reference of references.filter(
        (entry) => entry.sourceKind === "author_intent",
      )) {
        if (
          !preview.entries.some(
            (entry) =>
              entry.included &&
              entry.sourceKind === reference.sourceKind &&
              entry.sourceId === reference.sourceId &&
              entry.sourceVersion === reference.sourceVersion &&
              entry.fieldPath === reference.fieldPath,
          )
        )
          throw new Error(
            "正式作者意图未完整纳入冻结上下文，请调整隐私策略或上下文预算后重试。",
          );
      }
      return freeze(preview.id, preview.version)!;
    },
    prepareCreationOnce: (raw, references, rawRequest) => {
      const input = AgentContextPreviewInputSchema.parse(raw);
      const request = AgentContextPreparationRequestSchema.parse(rawRequest);
      const projectId = input.projectId;
      if (!projectId) throw new Error("原请求上下文准备须绑定明确项目。");
      // Read peer sources and current privacy outside our own transaction.
      // Never rebind an old action to whatever its source now happens to be.
      const checked = build(input, references, undefined, true);
      for (const reference of references.filter(
        (entry) => entry.sourceKind === "author_intent",
      ))
        if (
          !checked.entries.some(
            (entry) =>
              entry.included &&
              entry.sourceKind === reference.sourceKind &&
              entry.sourceId === reference.sourceId &&
              entry.sourceVersion === reference.sourceVersion &&
              entry.fieldPath === reference.fieldPath,
          )
        )
          throw new Error("正式作者意图未完整纳入原请求上下文准备。");
      const finalPromptSha256 = sha256(checked.finalPromptPreview);
      const contextSha256 = sha256(
        agentContextManifestJSON({
          input,
          manifestSha256: checked.manifestSha256,
          finalPromptSha256,
        }),
      );
      return context.uow.execute((transaction) => {
        const original = transaction.get<PreparationRow>(
          "SELECT * FROM agent_context_preparations WHERE preparation_scope=? AND key_sha256=?",
          request.scope,
          request.keySha256,
        );
        if (original) {
          if (
            original.project_id !== input.projectId ||
            original.request_sha256 !== request.requestSha256 ||
            original.context_sha256 !== contextSha256
          )
            return { status: "conflict" as const };
          const saved = transaction.get<SnapshotRow>(
            "SELECT * FROM agent_context_snapshots WHERE id=?",
            original.snapshot_id,
          );
          const parent = transaction.get<PreviewRow>(
            "SELECT * FROM agent_context_previews WHERE id=?",
            original.preview_id,
          );
          if (!saved || !parent) return { status: "unavailable" as const };
          try {
            const snapshot = snapshotFromRow(saved);
            const preview = previewFromRow(parent);
            const actualManifest = sha256(
              agentContextManifestJSON({
                projectId: snapshot.projectId,
                destination: snapshot.destination,
                tokenBudget: snapshot.tokenBudget,
                entries: snapshot.entries,
              }),
            );
            if (
              snapshot.previewId !== original.preview_id ||
              snapshot.projectId !== original.project_id ||
              preview.status !== "frozen" ||
              preview.version !== 0 ||
              preview.projectId !== original.project_id ||
              agentContextManifestJSON(JSON.parse(parent.input_json)) !==
                agentContextManifestJSON(input) ||
              snapshot.manifestSha256 !== original.manifest_sha256 ||
              actualManifest !== original.manifest_sha256 ||
              original.manifest_sha256 !== checked.manifestSha256 ||
              snapshot.finalPromptSha256 !== original.final_prompt_sha256 ||
              sha256(snapshot.finalPrompt) !== original.final_prompt_sha256 ||
              original.final_prompt_sha256 !== finalPromptSha256 ||
              snapshot.finalPrompt !== checked.finalPromptPreview ||
              preview.finalPromptPreview !== snapshot.finalPrompt ||
              preview.manifestSha256 !== snapshot.manifestSha256 ||
              preview.tokenBudget !== snapshot.tokenBudget ||
              preview.estimatedTokens !== snapshot.estimatedTokens ||
              snapshot.estimatedTokens !== checked.estimatedTokens ||
              agentContextManifestJSON(preview.destination) !==
                agentContextManifestJSON(snapshot.destination) ||
              agentContextManifestJSON(preview.entries) !==
                agentContextManifestJSON(snapshot.entries)
            )
              return { status: "unavailable" as const };
            return { status: "prepared" as const, snapshot };
          } catch {
            // A missing/corrupt original preparation is never repaired from
            // current sources, and private malformed JSON never leaves Agents.
            return { status: "unavailable" as const };
          }
        }
        const preview = persistPreview(transaction, input, checked);
        const snapshot = persistSnapshot(transaction, preview);
        transaction.run(
          `INSERT INTO agent_context_preparations(
            preparation_scope,key_sha256,request_sha256,project_id,
            context_sha256,preview_id,snapshot_id,manifest_sha256,
            final_prompt_sha256,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          request.scope,
          request.keySha256,
          request.requestSha256,
          input.projectId,
          contextSha256,
          snapshot.previewId,
          snapshot.id,
          snapshot.manifestSha256,
          snapshot.finalPromptSha256,
          snapshot.createdAt,
        );
        transaction.append({
          type: "agents.context-prepared.v1",
          pluginId: "agents",
          aggregateType: "context-preparation",
          aggregateId: snapshot.id,
          aggregateVersion: 0,
          payload: {
            projectId,
            scope: request.scope,
            requestSha256: request.requestSha256,
            snapshotId: snapshot.id,
            manifestSha256: snapshot.manifestSha256,
            finalPromptSha256: snapshot.finalPromptSha256,
          },
        });
        return { status: "prepared" as const, snapshot };
      });
    },
    deriveCreation: (id, prompt) => {
      const snapshot = getSnapshot(id);
      if (!snapshot) throw new Error("冻结的创作资料不存在。");
      const preview = build(
        {
          projectId: snapshot.projectId,
          runIntent: "creation-stage",
          basePrompt: prompt,
          tokenBudget: snapshot.tokenBudget,
          destination: snapshot.destination,
          temporaryOverrides: [],
        },
        [],
        snapshot.entries,
      );
      return freeze(preview.id, preview.version)!;
    },
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

function persistPreview(
  transaction: UnitOfWorkTransaction,
  input: AgentContextPreviewInput,
  preview: AgentContextPreview,
): PreviewRow {
  const row: PreviewRow = {
    id: preview.id,
    project_id: input.projectId ?? null,
    input_json: JSON.stringify(input),
    entries_json: JSON.stringify(preview.entries),
    token_budget: preview.tokenBudget,
    estimated_tokens: preview.estimatedTokens,
    destination_json: JSON.stringify(preview.destination),
    final_prompt: preview.finalPromptPreview,
    manifest_sha256: preview.manifestSha256,
    version: 0,
    status: "pending",
    expires_at: preview.expiresAt,
    created_at: preview.createdAt,
    updated_at: preview.updatedAt,
  };
  transaction.run(
    `INSERT INTO agent_context_previews(
      id,project_id,input_json,entries_json,token_budget,estimated_tokens,
      destination_json,final_prompt,manifest_sha256,version,status,
      expires_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,0,'pending',?,?,?)`,
    row.id,
    row.project_id,
    row.input_json,
    row.entries_json,
    row.token_budget,
    row.estimated_tokens,
    row.destination_json,
    row.final_prompt,
    row.manifest_sha256,
    row.expires_at,
    row.created_at,
    row.updated_at,
  );
  return row;
}

function persistSnapshot(
  transaction: UnitOfWorkTransaction,
  preview: PreviewRow,
): AgentContextSnapshot {
  const row: SnapshotRow = {
    id: randomUUID(),
    preview_id: preview.id,
    project_id: preview.project_id,
    entries_json: preview.entries_json,
    token_budget: preview.token_budget,
    estimated_tokens: preview.estimated_tokens,
    destination_json: preview.destination_json,
    final_prompt: preview.final_prompt,
    manifest_sha256: preview.manifest_sha256,
    final_prompt_sha256: sha256(preview.final_prompt),
    created_at: new Date().toISOString(),
  };
  transaction.run(
    `INSERT INTO agent_context_snapshots(
      id,preview_id,project_id,entries_json,token_budget,estimated_tokens,
      destination_json,final_prompt,manifest_sha256,final_prompt_sha256,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    row.id,
    row.preview_id,
    row.project_id,
    row.entries_json,
    row.token_budget,
    row.estimated_tokens,
    row.destination_json,
    row.final_prompt,
    row.manifest_sha256,
    row.final_prompt_sha256,
    row.created_at,
  );
  transaction.run(
    "UPDATE agent_context_previews SET status='frozen',updated_at=? WHERE id=?",
    row.created_at,
    row.preview_id,
  );
  return snapshotFromRow(row);
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
    author_intent: 110,
    selection: 90,
    chapter: 80,
    project: 70,
    story_bible: 60,
    writing_resource: 50,
    production: 85,
    knowledge: 75,
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
