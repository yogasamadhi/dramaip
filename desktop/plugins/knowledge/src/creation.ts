import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { assertCreationReferencesCurrent } from "@dramaip/contracts/creation";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
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
export function registerKnowledgeCreation(context: PluginContext) {
  const chapters = () => optionalService(context, WRITING_CHAPTER_SERVICE)!;
  const service: CreationAdapter = {
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
      if (input.operation === "knowledge-plan") {
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(input.projectId);
        if (!project) throw new Error("项目不存在。");
        const existing = service.references?.(input.projectId);
        return {
          prompt:
            "根据创作目标、已采用内容和现有资料提出故事圣经与视觉设定方案。items kind 仅为 story-bible、visual-profiles、visual-settings，data 包含「内容」与「依据」。新设定属于待审阅方案，不得声称是正文已发生事实。",
          references: [
            creationReference("project", project),
            ...(existing?.references ?? []),
          ],
          sources: [
            { kind: "project", id: project.id, version: project.version },
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
    validate: (input, output) => {
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
    apply: (workflow) => {
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM knowledge_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      assertCreationReferencesCurrent(
        workflow,
        service.prepare(workflow.input).references ?? [],
      );
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
        context.uow.execute((tx) => {
          const at = new Date().toISOString();
          for (const item of workflow.output!.items)
            tx.run(
              "INSERT INTO knowledge_records(id,kind,project_id,parent_id,title,payload_json,version,created_at,updated_at) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?)",
              crypto.randomUUID(),
              item.kind,
              project.id,
              item.title,
              JSON.stringify({
                ...item.data,
                sourceWorkflowId: workflow.id,
                provenance: "用户采用的 AI 设定方案",
              }),
              at,
              at,
            );
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
        for (const item of workflow.output!.items)
          tx.run(
            "INSERT INTO knowledge_records(id, kind, project_id, parent_id, title, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
            crypto.randomUUID(),
            item.kind,
            source.projectId,
            source.id,
            item.title,
            JSON.stringify({
              ...item.data,
              sourceChapterId: source.id,
              sourceVersion: source.version,
              sourceWorkflowId: workflow.id,
            }),
            at,
            at,
          );
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
      });
    },
  };
  context.effect(
    () => provideService(context, CREATION_KNOWLEDGE_SERVICE, service),
    `service:${CREATION_KNOWLEDGE_SERVICE}`,
  );
}
