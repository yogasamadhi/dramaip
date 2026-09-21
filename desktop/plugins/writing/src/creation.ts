import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { assertCreationReferencesCurrent } from "@dramaip/contracts/creation";
import { KNOWLEDGE_RESEARCH_SERVICE } from "@dramaip/contracts/knowledge";
import { mergeChapterText } from "./text-merge.js";
import {
  creationReference,
  CREATION_WRITING_SERVICE,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
} from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
} from "@dramaip/plugin-api/internal";

export const writingCreationMigration: PluginMigration = {
  id: "writing.0005.creation-adoption",
  pluginId: "writing",
  version: "3.0.0-alpha.4",
  dependsOn: ["writing.0004.four-mode-content"],
  sql: "CREATE TABLE writing_creation_adoptions (workflow_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL);",
};
export function registerWritingCreation(context: PluginContext) {
  const chapters = () => optionalService(context, WRITING_CHAPTER_SERVICE)!;
  const resources = () => optionalService(context, WRITING_RESOURCE_SERVICE)!;
  const service: CreationAdapter = {
    mergeText: mergeChapterText,
    prepare: (input) => {
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      if (!project) throw new Error("项目不存在。");
      const chapter =
        input.operation === "chapter" && input.targetId
          ? chapters().get(input.targetId)
          : undefined;
      if (
        input.operation === "chapter" &&
        (!chapter ||
          chapter.projectId !== project.id ||
          chapter.version !== input.baseVersion)
      )
        throw new Error("章节不存在、归属不符或版本已变化。");
      const all = chapters().list(project.id);
      const previous = chapter
        ? all.filter(
            (item) =>
              item.orderIndex < chapter.orderIndex && item.content.trim(),
          )
        : [];
      const near = previous.slice(-2);
      const facts = previous
        .slice(0, -2)
        .slice(-30)
        .map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          version: item.version,
        }));
      const materials = ["characters", "outlines", "story-arcs"].flatMap(
        (kind) =>
          resources().list(
            kind as "characters" | "outlines" | "story-arcs",
            project.id,
          ),
      );
      const memory = optionalService(
        context,
        CREATION_KNOWLEDGE_SERVICE,
      )?.references?.(input.projectId, chapter?.id);
      const research =
        input.operation === "creator-content"
          ? (optionalService(context, KNOWLEDGE_RESEARCH_SERVICE)?.references?.(
              project.id,
            ) ?? [])
          : [];
      const profiles =
        input.operation === "creator-content"
          ? context.uow.execute((tx) =>
              tx.all<{
                id: string;
                title: string;
                payload_json: string;
                version: number;
              }>(
                "SELECT id,title,payload_json,version FROM writing_creator_content WHERE project_id=? AND kind IN ('profile','column') ORDER BY updated_at DESC LIMIT 20",
                project.id,
              ),
            )
          : [];
      const formats: Record<string, string> = {
        chapter:
          "先在内部明确本章任务：剧情推进、人物目标、视角、事实限制、情绪、伏笔与字数。content 只放完整小说正文，title 为章名，items 为空。遵循作者要求，不强制每章反转。",
        characters:
          "items 的 kind 为 characters，data 使用「角色定位、身份背景、性格、欲望与目标、秘密与弱点、人物弧光、视觉描述」。",
        "book-outline":
          "items 的 kind 为 outlines，data 包含「大纲层级」=「全书」及「内容」。",
        "chapter-outline":
          "items 的 kind 为 outlines，data 包含「大纲层级」=「章节」、「排序」及「内容」。",
        "story-arc":
          "items 的 kind 为 story-arcs，data 包含「层级、起始章节、结束章节、核心冲突、高光与伏笔回收」。",
        "creator-content":
          "提出选题、研究计划和完整脚本。items 的 kind 仅为 idea 或 draft，data 包含 content、sources 和 researchPlan。没有来源支持的关键事实写为待核验，不得编造引文或网址。",
      };
      return {
        prompt: `${formats[input.operation]}\n引用资料中已采用章节与故事记忆是事实；大纲是未来规划，历史设定必须核对。`,
        references: [
          creationReference("project", project),
          ...[...(chapter ? [chapter] : []), ...near, ...facts].map((item) =>
            creationReference("chapter", item),
          ),
          ...materials.map((item) => creationReference(item.domain, item)),
          ...(memory?.references ?? []),
          ...research,
          ...profiles.map((profile) =>
            creationReference("creator-profile", {
              id: profile.id,
              title: profile.title,
              version: profile.version,
              payload: JSON.parse(profile.payload_json),
            }),
          ),
        ],
        sources: [
          { kind: "project", id: project.id, version: project.version },
          ...[...(chapter ? [chapter] : []), ...near, ...facts].map((item) => ({
            kind: "chapter",
            id: item.id,
            version: item.version,
          })),
          ...materials.map((item) => ({
            kind: item.domain,
            id: item.id,
            version: item.version,
          })),
          ...(memory?.sources ?? []),
        ],
      };
    },
    validate: (input, output) => {
      const issues: CreationIssue[] = [];
      const issue = (
        message: string,
        severity: CreationIssue["severity"] = "error",
      ) =>
        issues.push({
          severity,
          message,
          evidence: "",
          location: "候选方案",
          suggestion: "根据本轮目标补全候选。",
          source: "rule",
        });
      if (input.operation === "chapter") {
        if (!output.content.trim()) issue("候选正文为空。");
        const length = output.content.replace(/\s/gu, "").length;
        if (
          input.wordGoal &&
          Math.abs(length - input.wordGoal) > input.wordGoal * 0.15
        )
          issue(`正文 ${length} 字，目标 ${input.wordGoal} 字。`, "warning");
      } else {
        if (!output.items.length) issue("方案未包含可采用的结构化条目。");
        const kinds =
          input.operation === "characters"
            ? ["characters"]
            : input.operation === "story-arc"
              ? ["story-arcs"]
              : input.operation === "creator-content"
                ? ["idea", "draft"]
                : ["outlines"];
        if (output.items.some((item) => !kinds.includes(item.kind)))
          issue("候选条目类型不符合本次操作。");
        if (
          new Set(output.items.map((item) => item.ref)).size !==
          output.items.length
        )
          issue("候选内部标识重复。");
      }
      return issues;
    },
    apply: (workflow) => {
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM writing_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      assertCreationReferencesCurrent(
        workflow,
        service.prepare(workflow.input).references ?? [],
      );
      if (
        !workflow.output ||
        service
          .validate(workflow.input, workflow.output)
          .some((issue) => issue.severity === "error")
      )
        throw new Error("候选结构无效。");
      for (const source of workflow.sources) {
        if (source.kind === "project") {
          if (
            optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(source.id)
              ?.version !== source.version
          )
            throw new Error("项目方向已变化。");
        } else if (source.kind === "chapter") {
          if (chapters().get(source.id)?.version !== source.version)
            throw new Error("来源正文已变化。");
        } else if (
          ["characters", "outlines", "story-arcs"].includes(source.kind) &&
          resources().get(source.id)?.version !== source.version
        )
          throw new Error("来源设定已变化。");
      }
      if (workflow.input.operation === "chapter") {
        const chapter = chapters().get(workflow.input.targetId!);
        if (!chapter || chapter.version !== workflow.input.baseVersion)
          throw new Error("正文版本已变化。");
        context.uow.execute((tx) => {
          const at = new Date().toISOString();
          tx.run(
            "INSERT OR IGNORE INTO writing_chapter_versions(id,chapter_id,version_number,snapshot_json,created_at) VALUES (?, ?, ?, ?, ?)",
            crypto.randomUUID(),
            chapter.id,
            chapter.version,
            JSON.stringify(chapter),
            at,
          );
          tx.run(
            "UPDATE chapters SET content = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            workflow.output!.content,
            at,
            chapter.id,
            chapter.version,
          );
          tx.run(
            "INSERT INTO writing_creation_adoptions VALUES (?, ?, ?)",
            workflow.id,
            JSON.stringify({
              chapterId: chapter.id,
              version: chapter.version + 1,
            }),
            at,
          );
          tx.append({
            type: "writing.chapter-updated.v1",
            pluginId: "writing",
            aggregateType: "chapter",
            aggregateId: chapter.id,
            aggregateVersion: chapter.version + 1,
            payload: {
              id: chapter.id,
              projectId: chapter.projectId,
              version: chapter.version + 1,
              sourceWorkflowId: workflow.id,
            },
          });
        });
        return;
      }
      context.uow.execute((tx) => {
        if (
          tx.get(
            "SELECT workflow_id FROM writing_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          )
        )
          return;
        const at = new Date().toISOString();
        const ids: string[] = [];
        for (const item of workflow.output!.items) {
          const id = crypto.randomUUID();
          ids.push(id);
          if (workflow.input.operation === "creator-content") {
            tx.run(
              "INSERT INTO writing_creator_content(id, kind, project_id, title, status, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'review_required', ?, 0, ?, ?)",
              id,
              item.kind,
              workflow.input.projectId,
              item.title,
              JSON.stringify({ ...item.data, sourceWorkflowId: workflow.id }),
              at,
              at,
            );
          } else {
            tx.run(
              "INSERT INTO writing_resources(id, kind, project_id, title, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
              id,
              item.kind,
              workflow.input.projectId,
              item.title,
              JSON.stringify({ ...item.data, sourceWorkflowId: workflow.id }),
              at,
              at,
            );
          }
        }
        tx.run(
          "INSERT INTO writing_creation_adoptions VALUES (?, ?, ?)",
          workflow.id,
          JSON.stringify(ids),
          at,
        );
        tx.append({
          type: "writing.creation-adopted.v1",
          pluginId: "writing",
          aggregateType: "creation",
          aggregateId: workflow.id,
          aggregateVersion: 1,
          payload: {
            projectId: workflow.input.projectId,
            workflowId: workflow.id,
            ids,
          },
        });
      });
    },
  };
  context.effect(
    () => provideService(context, CREATION_WRITING_SERVICE, service),
    `service:${CREATION_WRITING_SERVICE}`,
  );
}
