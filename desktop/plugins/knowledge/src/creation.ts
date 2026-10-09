import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createHash } from "node:crypto";
import {
  CreativeOutcomeFactSchema,
  CreativePlanningAdoptionFactSchema,
  CreativePlanningCommitError,
  creativePlanningMaterial,
  canonicalCreativeMetricJSON,
} from "@dramaip/contracts/insights";
import {
  assertCreationReferencesCurrent,
  assertCreationAuthorIntentCurrent,
  creationAuthorIntent,
  AUTHOR_INTENT_CREATION_PROMPT,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  NarrativePlanningBasisSchema,
  narrativePlanningIdentity,
} from "@dramaip/contracts/creation";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import {
  creationReference,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
} from "@dramaip/plugin-api/internal";

export const knowledgeCreationMigration: PluginMigration = {
  id: "knowledge.0006.creation-adoption",
  pluginId: "knowledge",
  version: "3.0.0-alpha.4",
  dependsOn: ["knowledge.0005.story-intelligence"],
  sql: "CREATE TABLE knowledge_creation_adoptions (workflow_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);",
};
export function registerKnowledgeCreation(
  context: PluginContext,
  summaries: CreationAdapter,
) {
  const chapters = () => optionalService(context, WRITING_CHAPTER_SERVICE)!;
  const service: CreationAdapter = {
    // Only the user's explicit knowledge-plan adoption is authoritative here.
    // Generic legacy settings and pending change-sets must not masquerade as it.
    approvedStoryBible: (projectId) =>
      context.uow
        .execute((tx) =>
          tx.all<{
            id: string;
            title: string;
            version: number;
            payload_json: string;
          }>(
            "SELECT id, title, version, payload_json FROM knowledge_records WHERE project_id = ? AND kind = 'story-bible' AND json_extract(payload_json, '$.sourceWorkflowId') IN (SELECT workflow_id FROM knowledge_creation_adoptions) ORDER BY id",
            projectId,
          ),
        )
        .map(({ payload_json, ...row }) =>
          creationReference("knowledge", {
            ...row,
            projectId,
            kind: "story-bible",
            payload: JSON.parse(payload_json),
          }),
        ),
    references: (projectId, chapterId) => {
      const all = chapters().list(projectId);
      const target = all.find((chapter) => chapter.id === chapterId);
      const rows = context.uow.execute((tx) =>
        tx.all<{
          id: string;
          kind: string;
          title: string;
          payload_json: string;
          version: number;
        }>(
          "SELECT id, kind, title, payload_json, version FROM knowledge_records WHERE project_id = ? AND kind IN ('story','story-bible','chapter-memories','character-states','story-events','foreshadowings') ORDER BY updated_at DESC LIMIT 100",
          projectId,
        ),
      );
      const valid = rows.flatMap((row) => {
        const payload = JSON.parse(row.payload_json);
        if (payload.sourceChapterId) {
          const source = all.find(
            (chapter) => chapter.id === payload.sourceChapterId,
          );
          if (
            !source ||
            source.version !== payload.sourceVersion ||
            (target && source.orderIndex >= target.orderIndex)
          )
            return [];
        }
        return [
          {
            ...row,
            payload_json: undefined,
            payload,
            provenance: payload.sourceChapterId
              ? "采用正文的有效派生资料"
              : "历史设定，来源版本未记录",
          },
        ];
      });
      return {
        prompt: "有效故事记忆见引用资料。",
        references: valid.map((item) => creationReference("knowledge", item)),
        sources: valid.map((row) => ({
          kind: "knowledge",
          id: row.id,
          version: row.version,
        })),
      };
    },
    prepare: (input) => {
      if (
        input.narrativePlanningRequest &&
        input.operation !== "knowledge-plan"
      )
        throw new Error("明确规划来源只适用于知识规划，不能静默忽略范围。");
      if (input.operation === "narrative-summary")
        return summaries.prepare(input);
      if (input.operation === "knowledge-plan") {
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(input.projectId);
        if (!project) throw new Error("项目不存在。");
        const planning = input.narrativePlanningRequest
          ? optionalService(
              context,
              WRITING_NARRATIVE_SOURCE_SERVICE,
            )?.planning(project.id, input.narrativePlanningRequest)
          : undefined;
        if (input.narrativePlanningRequest && !planning)
          throw new Error("规划来源只读编译服务未启用，不能猜测或补原文。");
        const intentService = optionalService(
          context,
          WORKSPACE_AUTHOR_INTENT_SERVICE,
        );
        if (planning && !intentService)
          throw new Error("正式作者意图服务未启用。");
        const intent = planning
          ? creationAuthorIntent(project.id, intentService!.current(project.id))
          : undefined;
        const existing = planning
          ? undefined
          : service.references?.(input.projectId);
        const references = [
          ...(intent?.references ?? []),
          creationReference("project", project),
          ...(planning?.references ?? existing?.references ?? []),
        ];
        return {
          prompt:
            "根据创作目标和本轮明确提供的资料提出故事圣经与视觉设定方案。items kind 仅为 story-bible、visual-profiles、visual-settings，data 包含「内容」与「依据」。新设定属于待审阅方案，不得声称是正文已发生事实。" +
            (planning
              ? `本轮正文范围=${planning.basis.request.chapterScope.mode}，实际覆盖 ${planning.basis.coverage.included.length} 章，目录未纳入 ${planning.basis.coverage.excluded.length} 章。摘要仅是派生概括、段落仅是片段，不代表全文已读或语义保证；不补入未选章节或旧记忆。${intent?.authorIntent.state === "adopted" ? AUTHOR_INTENT_CREATION_PROMPT : ""}`
              : ""),
          authorIntent: intent?.authorIntent,
          ...(planning
            ? {
                narrativePlanningBasis: NarrativePlanningBasisSchema.parse({
                  ...planning.basis,
                  operation: input.operation,
                  references: references.map((reference) => ({
                    sourceKind: reference.sourceKind,
                    sourceId: reference.sourceId,
                    sourceVersion: reference.sourceVersion,
                    fieldPath: reference.fieldPath,
                    policyDependencies: reference.policyDependencies,
                    contentHash: createHash("sha256")
                      .update(JSON.stringify(reference.value))
                      .digest("hex"),
                  })),
                }),
              }
            : {}),
          references,
          sources: [
            ...(intent?.sources ?? []),
            { kind: "project", id: project.id, version: project.version },
            ...(planning?.references ?? []).map((reference) => ({
              kind: reference.sourceKind,
              id: reference.sourceId,
              version: reference.sourceVersion,
            })),
            ...(existing?.sources ?? []),
          ],
        };
      }
      const chapter = input.targetId
        ? chapters().get(input.targetId)
        : undefined;
      if (
        !chapter ||
        chapter.projectId !== input.projectId ||
        chapter.version !== input.baseVersion ||
        !chapter.content.trim()
      )
        throw new Error("需要当前已采用章节及其版本。");
      return {
        prompt: `仅提取正文明确发生的事实。不要新增设定、推断人物能力或把未来计划写成事实。items 的 kind 仅为 chapter-memories、character-states、story-events、foreshadowings，每项 data 必须含 evidence（正文原文证据）与对应中文字段：章节摘要、当前状态、事件描述或伏笔说明。content 为章节摘要。`,
        references: [creationReference("chapter", chapter)],
        sources: [
          { kind: "chapter", id: chapter.id, version: chapter.version },
        ],
      };
    },
    validate: (input, output, workflow) => {
      if (input.operation === "narrative-summary")
        return summaries.validate(input, output, workflow);
      if (input.operation === "knowledge-plan")
        return output.items.length &&
          output.items.every(
            (item) =>
              ["story-bible", "visual-profiles", "visual-settings"].includes(
                item.kind,
              ) &&
              typeof item.data["内容"] === "string" &&
              item.data["内容"].trim(),
          )
          ? []
          : [
              {
                severity: "error",
                message: "设定方案缺少可采用内容。",
                evidence: "",
                location: "设定方案",
                suggestion: "补全故事或视觉设定条目。",
                source: "rule",
              },
            ];
      const chapter = input.targetId
        ? chapters().get(input.targetId)
        : undefined;
      const issues: CreationIssue[] = [];
      if (
        !output.items.length ||
        output.items.some(
          (item) =>
            ![
              "chapter-memories",
              "character-states",
              "story-events",
              "foreshadowings",
            ].includes(item.kind) ||
            typeof item.data.evidence !== "string" ||
            !item.data.evidence.trim() ||
            !chapter?.content.includes(item.data.evidence),
        )
      )
        issues.push({
          severity: "error",
          message: "派生资料缺少可定位的正文证据。",
          evidence: "",
          location: "故事记忆",
          suggestion: "只保留正文明确支持的事实并提供原文。",
          source: "rule",
        });
      return issues;
    },
    review: (workflow) =>
      workflow.input.operation === "narrative-summary"
        ? (summaries.review?.(workflow) ?? {})
        : {},
    reviewState: (workflow) =>
      workflow.input.operation === "narrative-summary"
        ? summaries.reviewState?.(workflow)
        : undefined,
    discard: (workflow) => {
      if (workflow.input.operation === "narrative-summary")
        summaries.discard?.(workflow);
    },
    apply: (workflow) => {
      if (workflow.input.operation === "narrative-summary") {
        summaries.apply(workflow);
        return;
      }
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM knowledge_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      if (workflow.narrativePlanningBasis) {
        const source = optionalService(
          context,
          WRITING_NARRATIVE_SOURCE_SERVICE,
        );
        if (!source?.assertPlanningCurrent)
          throw new Error("规划原来源元数据核对服务未启用，不能猜测当前版本。");
        source.assertPlanningCurrent(
          workflow.input.projectId,
          workflow.id,
          workflow.narrativePlanningBasis,
        );
      }
      const current = service.prepare(workflow.input);
      assertCreationReferencesCurrent(workflow, current.references ?? []);
      if (workflow.narrativePlanningBasis) {
        assertCreationAuthorIntentCurrent(workflow, current.authorIntent!);
        if (
          !current.narrativePlanningBasis ||
          narrativePlanningIdentity(workflow.narrativePlanningBasis) !==
            narrativePlanningIdentity(current.narrativePlanningBasis)
        )
          throw new Error(
            "知识规划的明确来源或约束已变化，保留候选但不能换源采用。",
          );
      }
      if (workflow.input.operation === "knowledge-plan") {
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(workflow.input.projectId);
        if (
          !project ||
          service.validate(workflow.input, workflow.output!).length
        )
          throw new Error("设定方案无效。");
        if (
          workflow.sources.some(
            (source) =>
              source.kind === "project" && source.version !== project.version,
          )
        )
          throw new Error("项目方向已变化。");
        try {
          context.uow.execute((tx) => {
            const at = new Date().toISOString();
            const ids: string[] = [];
            for (const item of workflow.output!.items) {
              const id = crypto.randomUUID();
              ids.push(id);
              tx.run(
                "INSERT INTO knowledge_records(id,kind,project_id,parent_id,title,payload_json,version,created_at,updated_at) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?)",
                id,
                item.kind,
                project.id,
                item.title,
                JSON.stringify({
                  ...item.data,
                  sourceWorkflowId: workflow.id,
                  provenance: "用户采用的 AI 设定方案",
                  ...(workflow.narrativePlanningBasis
                    ? {
                        narrativePlanningBasis: workflow.narrativePlanningBasis,
                      }
                    : {}),
                }),
                at,
                at,
              );
            }
            if (workflow.narrativePlanningBasis && workflow.previewId)
              tx.append({
                type: "knowledge.planning-batch-adopted.v1",
                pluginId: "knowledge",
                aggregateType: "creation",
                aggregateId: workflow.id,
                aggregateVersion: 1,
                payload: CreativePlanningAdoptionFactSchema.parse({
                  eventVersion: 1,
                  kind: "story.planning-batch-adopted",
                  workflowPath: "story-planning",
                  projectId: project.id,
                  workflowId: workflow.id,
                  operation: workflow.input.operation,
                  candidate: {
                    id: workflow.previewId,
                    contentFingerprint: createHash("sha256")
                      .update(
                        canonicalCreativeMetricJSON(
                          creativePlanningMaterial(workflow.output!.items),
                        ),
                      )
                      .digest("hex"),
                  },
                  records: ids.map((id, index) => ({
                    id,
                    kind: workflow.output!.items[index]!.kind,
                    version: 0,
                  })),
                  sourceVersions: workflow.sources.map(({ id, version }) => ({
                    id,
                    version,
                  })),
                  evidenceKind: "human",
                  modelEvidence: "unknown",
                  qualityState: "unverified",
                  resultStatus: "adopted",
                }),
              });
            tx.run(
              "INSERT INTO knowledge_creation_adoptions VALUES (?, ?)",
              workflow.id,
              at,
            );
            tx.append({
              type: "knowledge.creation-adopted.v1",
              pluginId: "knowledge",
              aggregateType: "creation",
              aggregateId: workflow.id,
              aggregateVersion: 1,
              payload: { projectId: project.id, workflowId: workflow.id },
            });
          });
        } catch (error) {
          if (workflow.narrativePlanningBasis)
            throw new CreativePlanningCommitError();
          throw error;
        }
        return;
      }
      const source = chapters().get(workflow.input.targetId!);
      if (
        !source ||
        source.version !== workflow.input.baseVersion ||
        service.validate(workflow.input, workflow.output!).length
      )
        throw new Error("来源章节已变化或派生资料缺少证据。");
      context.uow.execute((tx) => {
        if (
          tx.get(
            "SELECT workflow_id FROM knowledge_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          )
        )
          return;
        const at = new Date().toISOString();
        const records: Array<{
          id: string;
          version: 0;
          kind: string;
          contentFingerprint: string;
        }> = [];
        for (const item of workflow.output!.items) {
          const recordId = crypto.randomUUID();
          const payload = {
            ...item.data,
            sourceChapterId: source.id,
            sourceVersion: source.version,
            sourceWorkflowId: workflow.id,
          };
          tx.run(
            "INSERT INTO knowledge_records(id, kind, project_id, parent_id, title, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
            recordId,
            item.kind,
            source.projectId,
            source.id,
            item.title,
            JSON.stringify(payload),
            at,
            at,
          );
          tx.run(
            "INSERT INTO knowledge_creation_record_receipts(record_id, workflow_id) VALUES (?, ?)",
            recordId,
            workflow.id,
          );
          records.push({
            id: recordId,
            kind: item.kind,
            version: 0,
            contentFingerprint: createHash("sha256")
              .update(
                canonicalCreativeMetricJSON({
                  id: recordId,
                  kind: item.kind,
                  projectId: source.projectId,
                  parentId: source.id,
                  title: item.title,
                  payload,
                  version: 0,
                }),
              )
              .digest("hex"),
          });
        }
        tx.run(
          "INSERT INTO knowledge_creation_adoptions VALUES (?, ?)",
          workflow.id,
          at,
        );
        tx.append({
          type: "knowledge.creation-adopted.v1",
          pluginId: "knowledge",
          aggregateType: "creation",
          aggregateId: workflow.id,
          aggregateVersion: 1,
          payload: {
            projectId: source.projectId,
            chapterId: source.id,
            sourceVersion: source.version,
          },
        });
        // Count only the actual record set committed by this owner, irrespective
        // of automatic sync versus a standalone reviewed workflow. Neither path
        // is evidence of a new human chapter adoption or narrative quality.
        tx.append({
          type: "knowledge.chapter-memory-written.v1",
          pluginId: "knowledge",
          aggregateType: "creation",
          aggregateId: workflow.id,
          aggregateVersion: 1,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "novel.chapter-memory-written",
            workflowPath: "novel",
            projectId: source.projectId,
            objectId: workflow.id,
            workflowId: workflow.id,
            formalVersions: records.map(({ id, version }) => ({
              kind: "knowledge-record",
              id,
              version,
            })),
            sourceVersions: [{ id: source.id, version: source.version }],
            memoryWrite: {
              source: {
                id: source.id,
                version: source.version,
                contentFingerprint: createHash("sha256")
                  .update(source.content)
                  .digest("hex"),
              },
              records,
            },
            evidenceKind: "rule",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "written",
          }),
        });
      });
    },
  };
  context.effect(
    () => provideService(context, CREATION_KNOWLEDGE_SERVICE, service),
    `service:${CREATION_KNOWLEDGE_SERVICE}`,
  );
}
