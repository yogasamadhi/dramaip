import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { assertCreationReferencesCurrent } from "@dramaip/contracts/creation";
import {
  creationReference,
  CREATION_DELIVERY_SERVICE,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import { PRODUCTION_RECORD_SERVICE } from "@dramaip/contracts/production";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import type {
  PluginContext,
  PluginMigration,
} from "@dramaip/plugin-api/internal";

export const deliveryCreationMigration: PluginMigration = {
  id: "delivery.0002.creation-adoption",
  pluginId: "delivery",
  version: "3.0.0-alpha.4",
  dependsOn: ["delivery.0001.records"],
  sql: "CREATE TABLE delivery_creation_adoptions (workflow_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);",
};
export function registerDeliveryCreation(context: PluginContext) {
  const records = () => optionalService(context, PRODUCTION_RECORD_SERVICE)!;
  const service: CreationAdapter = {
    prepare: (input) => {
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      const target = input.targetId ? records().get(input.targetId) : undefined;
      if (
        !project ||
        !target ||
        target.projectId !== project.id ||
        target.version !== input.baseVersion
      )
        throw new Error("请选择有效的当前分集或改编方案。");
      const episodes =
        target.kind === "episodes"
          ? [target]
          : records().list("episodes", { parentId: target.id });
      const scripts = episodes.flatMap((episode) =>
        records().list("scripts", { parentId: episode.id }),
      );
      if (!scripts.length) throw new Error("请先生成并采用剧本。");
      const format =
        input.operation === "localization"
          ? `根据剧本生成 ${input.language ?? "中文"} 字幕与译文。items kind 为 localization，data 使用「目标语言」「字幕与译文」。不编造时间码，没有真实音轨时标记 timingStatus=unaligned。`
          : "根据实际作品生成标题、简介、标签和封面构想。items kind 为 delivery-variant，data 包含 label、title、description、tags（字符串数组）、coverBrief。禁止虚构封面文件或宣传数据。";
      return {
        prompt: format,
        references: [
          creationReference("project", project),
          ...[target, ...scripts].map((item) =>
            creationReference(item.kind, item),
          ),
        ],
        sources: [
          { kind: "project", id: project.id, version: project.version },
          ...[target, ...scripts].map((item) => ({
            kind: item.kind,
            id: item.id,
            version: item.version,
          })),
        ],
      };
    },
    validate: (input, output) => {
      const kind =
        input.operation === "localization"
          ? "localization"
          : "delivery-variant";
      const issues: CreationIssue[] = [];
      if (
        !output.items.length ||
        output.items.some(
          (item) =>
            item.kind !== kind ||
            (kind === "localization"
              ? !String(item.data["字幕与译文"] ?? "").trim()
              : !String(item.data.title ?? "").trim() ||
                !String(item.data.description ?? "").trim() ||
                !Array.isArray(item.data.tags)),
        )
      )
        issues.push({
          severity: "error",
          message: "交付候选字段不完整。",
          evidence: "",
          location: "交付方案",
          suggestion: "补全目标语言、译文或标题、简介和标签。",
          source: "rule",
        });
      return issues;
    },
    apply: (workflow) => {
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM delivery_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      assertCreationReferencesCurrent(
        workflow,
        service.prepare(workflow.input).references ?? [],
      );
      if (service.validate(workflow.input, workflow.output!).length)
        throw new Error("交付候选结构无效。");
      for (const source of workflow.sources) {
        const current =
          source.kind === "project"
            ? optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
                source.id,
              )
            : records().get(source.id);
        if (!current || current.version !== source.version)
          throw new Error("作品来源已变化。");
      }
      const target = records().get(workflow.input.targetId!)!;
      context.uow.execute((tx) => {
        if (
          tx.get(
            "SELECT workflow_id FROM delivery_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          )
        )
          return;
        const at = new Date().toISOString();
        for (const item of workflow.output!.items)
          tx.run(
            "INSERT INTO delivery_records(id, kind, project_id, parent_id, value_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            crypto.randomUUID(),
            item.kind,
            workflow.input.projectId,
            item.kind === "delivery-variant" && target.kind === "episodes"
              ? target.parentId
              : target.id,
            JSON.stringify({
              ...item.data,
              title: item.data.title ?? item.title,
              source: "ai_draft",
              status: item.kind === "delivery-variant" ? "candidate" : "draft",
              versionNumber: 1,
              projectId: workflow.input.projectId,
              adaptationId:
                target.kind === "episodes" ? target.parentId : target.id,
              adopted: false,
              sourceWorkflowId: workflow.id,
              ...(item.kind === "localization"
                ? { timingStatus: "unaligned" }
                : {}),
            }),
            at,
            at,
          );
        tx.run(
          "INSERT INTO delivery_creation_adoptions VALUES (?, ?)",
          workflow.id,
          at,
        );
        tx.append({
          type: "delivery.creation-adopted.v1",
          pluginId: "delivery",
          aggregateType: "creation",
          aggregateId: workflow.id,
          aggregateVersion: 1,
          payload: {
            projectId: workflow.input.projectId,
            workflowId: workflow.id,
          },
        });
      });
    },
  };
  context.effect(
    () => provideService(context, CREATION_DELIVERY_SERVICE, service),
    `service:${CREATION_DELIVERY_SERVICE}`,
  );
}
