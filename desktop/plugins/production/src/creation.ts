import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { assertCreationReferencesCurrent } from "@dramaip/contracts/creation";
import { MEDIA_LIKENESS_SERVICE } from "@dramaip/contracts/media";
import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import {
  creationReference,
  CREATION_PRODUCTION_SERVICE,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import { PRODUCTION_RECORD_SERVICE } from "@dramaip/contracts/production";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
} from "@dramaip/plugin-api/internal";
import { parseFountain, exportFountain } from "./screenplay-codec.js";
import {
  ScreenplayBlockSchema,
  type ScreenplayBlock,
} from "@dramaip/contracts/production";
import {
  createThreeWayMergePlan,
  resolveThreeWayMerge,
} from "./draft-merge.js";
function candidateBlocks(output: {
  items: Array<{ kind: string; data: Record<string, unknown> }>;
}): ScreenplayBlock[] {
  return output.items
    .filter((item) => item.kind === "screenplay-block")
    .map((item) => ScreenplayBlockSchema.parse(item.data));
}

export const productionCreationMigration: PluginMigration = {
  id: "production.0004.creation-adoption",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0003.screenplay-ast-and-script-branches"],
  sql: "CREATE TABLE production_creation_adoptions (workflow_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, before_json TEXT NOT NULL, created_at TEXT NOT NULL);",
};
const PARENT: Record<string, string | undefined> = {
  adaptations: undefined,
  episodes: "adaptations",
  scripts: "episodes",
  scenes: "scripts",
  shots: "scenes",
};
export function registerProductionCreation(context: PluginContext) {
  const records = () => optionalService(context, PRODUCTION_RECORD_SERVICE)!;
  const readBlocks = (id: string): ScreenplayBlock[] =>
    context.uow.execute((tx) => {
      let row = tx.get<{ blocks_json: string }>(
        "SELECT blocks_json FROM screenplay_documents WHERE script_record_id = ?",
        id,
      );
      if (!row) {
        const record = tx.get<{
          project_id: string;
          title: string;
          payload_json: string;
          created_at: string;
          updated_at: string;
        }>(
          "SELECT * FROM production_records WHERE id = ? AND kind = 'scripts'",
          id,
        );
        if (record) {
          const parsed = parseFountain(
            String(JSON.parse(record.payload_json)["剧本内容"] ?? ""),
          );
          tx.run(
            "INSERT INTO screenplay_documents(id, script_record_id, project_id, title, source_format, blocks_json, loss_report_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'native', ?, ?, 0, ?, ?)",
            crypto.randomUUID(),
            id,
            record.project_id,
            record.title,
            JSON.stringify(parsed.blocks),
            JSON.stringify(parsed.lossReport),
            record.created_at,
            record.updated_at,
          );
          row = { blocks_json: JSON.stringify(parsed.blocks) };
        }
      }
      return row
        ? JSON.parse(row.blocks_json).map((block: unknown) =>
            ScreenplayBlockSchema.parse(block),
          )
        : [];
    });
  const service: CreationAdapter = {
    merge: (workflow, choices = {}) => {
      if (
        workflow.input.operation !== "script-revision" ||
        !workflow.baseBlocks ||
        !workflow.output
      )
        throw new Error(
          "旧候选缺少稳定剧本块，无法安全合并；请按当前版本重新生成。",
        );
      const current = records().get(workflow.input.targetId!);
      if (!current || current.projectId !== workflow.input.projectId)
        throw new Error("目标剧本不存在。");
      const plan = createThreeWayMergePlan(
        workflow.baseBlocks.map((block) => ScreenplayBlockSchema.parse(block)),
        readBlocks(current.id),
        candidateBlocks(workflow.output),
      );
      const resolved = plan.unresolvedUnitIds.every((id) => choices[id]);
      const blocks = resolved ? resolveThreeWayMerge(plan, choices) : undefined;
      return {
        currentVersion: current.version,
        units: plan.units.map((unit) => ({
          id: unit.unitId,
          current: unit.main ? exportFountain([unit.main]) : "（已删除）",
          candidate: unit.branch
            ? exportFountain([unit.branch])
            : "（删除此块）",
          conflict: unit.conflict,
          choice: unit.defaultChoice,
        })),
        ...(blocks
          ? {
              output: {
                ...workflow.output,
                content: exportFountain(blocks),
                items: blocks.map((block) => ({
                  ref: block.id,
                  kind: "screenplay-block",
                  title: block.type,
                  data: { ...block },
                })),
              },
            }
          : {}),
      };
    },
    prepare: (input) => {
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      if (!project) throw new Error("项目不存在。");
      const subjects =
        project.mode === "personal_theater"
          ? optionalService(context, MEDIA_LIKENESS_SERVICE)?.listSubjects(
              project.id,
            )
          : [];
      if (
        project.mode === "personal_theater" &&
        (!subjects?.length ||
          subjects.some((subject) => subject.consentStatus !== "active"))
      )
        throw new Error("请先完成人物授权，再生成本项目的故事内容。");
      const characters =
        optionalService(context, WRITING_RESOURCE_SERVICE)?.list(
          "characters",
          project.id,
        ) ?? [];
      const target = input.targetId ? records().get(input.targetId) : undefined;
      if (
        input.targetId &&
        (!target ||
          target.projectId !== project.id ||
          target.version !== input.baseVersion)
      )
        throw new Error("目标不存在、归属不符或版本已变化。");
      if (
        ["script-revision", "review-check"].includes(input.operation) &&
        target?.kind !== "scripts"
      )
        throw new Error("请选择需要修订的剧本。");
      if (input.operation === "shot-prompt" && target?.kind !== "shots")
        throw new Error("请选择需要完善提示的镜头。");
      if (
        input.operation === "episode" &&
        target &&
        !["adaptations", "episodes"].includes(target.kind)
      )
        throw new Error("请选择改编方案或分集。");
      const chapters =
        optionalService(context, WRITING_CHAPTER_SERVICE)?.list(project.id) ??
        [];
      const sources = input.sourceIds.length
        ? input.sourceIds.map((id) => {
            const chapter = chapters.find((item) => item.id === id);
            if (!chapter) throw new Error("来源章节不属于项目。");
            return chapter;
          })
        : chapters.filter((chapter) => chapter.content.trim()).slice(0, 3);
      const materials = [
        "adaptations",
        "episodes",
        "scripts",
        "scenes",
        "shots",
      ]
        .flatMap((kind) =>
          records().list(kind as "scripts", { projectId: project.id }),
        )
        .filter(
          (item) => item.id === target?.id || item.parentId === target?.id,
        );
      const baseBlocks =
        target?.kind === "scripts" ? readBlocks(target.id) : undefined;
      const brief =
        input.operation === "script-revision"
          ? "按反馈局部修订本集剧本。content 返回完整 Fountain 剧本。items 按阅读顺序返回全部剧本块，kind 为 screenplay-block，ref 为块 id，data 包含 id（UUID）、type、text（page_break 除外）。type 使用 scene_heading/action/character/dialogue/parenthetical/transition/note/page_break。保留已有块 id，新增块使用新 UUID，保留未涉及的场景、人物和对白。"
          : input.operation === "shot-prompt"
            ? "根据镜头和人物视觉约束完善媒体提示词。content 返回完整生成提示，items 为空。"
            : `生成一集完整的剧本、场景和分镜方案。content 为完整 Fountain 剧本。items 按父项在前排列，使用 ref/parentRef 引用，kind 仅为 adaptations、episodes、scripts、scenes、shots。${target?.kind === "episodes" ? "根条目从 scripts 开始，直接归属当前分集，不创建新分集。" : target?.kind === "adaptations" ? "根条目从 episodes 开始，直接归属当前改编。" : "根条目为一个 adaptations，再创建一个 episodes。"}每个 scripts 的 data 包含「剧本内容」；每个 scenes 的 data 包含「地点与时间、场景动作、对白与备注」；每个 shots 的 data 包含「镜头序号、镜头描述、生成提示、负面提示、时长、角色」。禁止虚构已生成的媒体文件。`;
      return {
        prompt:
          input.operation === "review-check"
            ? "针对已采用剧本与原审片意见做复检，只指出仍有证据支持的问题，不修改正文，不替用户关闭原问题。"
            : brief,
        ...(input.operation === "review-check" && target
          ? {
              checkContent: {
                title: target.title,
                content: String(target.payload["剧本内容"] ?? ""),
                items: [],
              },
            }
          : {}),
        baseBlocks: baseBlocks?.map((block) => ({ ...block })),
        references: [
          creationReference("project", project),
          ...characters.map((item) => creationReference("characters", item)),
          ...(subjects ?? []).map((subject) =>
            creationReference("likeness", {
              id: subject.id,
              version: Date.parse(subject.updatedAt),
              title: subject.displayName,
              relationship: subject.relationship,
              consentStatus: subject.consentStatus,
            }),
          ),
          ...sources.map((item) => creationReference("chapter", item)),
          ...materials.map((item) =>
            creationReference(
              item.kind,
              item.id === target?.id && baseBlocks
                ? { ...item, screenplayBlocks: baseBlocks }
                : item,
            ),
          ),
        ],
        sources: [
          { kind: "project", id: project.id, version: project.version },
          ...characters.map((item) => ({
            kind: "characters",
            id: item.id,
            version: item.version,
          })),
          ...sources.map((item) => ({
            kind: "chapter",
            id: item.id,
            version: item.version,
          })),
          ...materials.map((item) => ({
            kind: item.kind,
            id: item.id,
            version: item.version,
          })),
        ],
      };
    },
    validate: (input, output) => {
      const issues: CreationIssue[] = [];
      const add = (message: string) =>
        issues.push({
          severity: "error",
          message,
          evidence: "",
          location: "分集候选",
          suggestion: "修复候选结构与父子引用。",
          source: "rule",
        });
      if (!output.content.trim()) add("候选内容为空。");
      if (input.operation === "script-revision") {
        try {
          const blocks = candidateBlocks(output);
          if (
            !blocks.length ||
            new Set(blocks.map((block) => block.id)).size !== blocks.length ||
            output.items.some((item) => item.kind !== "screenplay-block")
          )
            add("剧本块缺失、类型无效或标识重复。");
          if (
            blocks.length &&
            exportFountain(blocks).trim() !== output.content.trim()
          )
            add("完整剧本与结构化剧本块不一致。");
        } catch {
          add("剧本块不符合 ScreenplayDocument 契约。");
        }
      }
      if (input.operation !== "episode") return issues;
      const target = input.targetId ? records().get(input.targetId) : undefined;
      const seen = new Map<string, string>();
      for (const item of output.items) {
        if (!Object.hasOwn(PARENT, item.kind) || seen.has(item.ref)) {
          add("条目类型无效或内部引用重复。");
          continue;
        }
        const parentKind = item.parentRef
          ? seen.get(item.parentRef)
          : target?.kind;
        if (parentKind !== PARENT[item.kind])
          add(`条目「${item.title}」缺少有效父级。`);
        if (
          item.kind === "scripts" &&
          !String(item.data["剧本内容"] ?? "").trim()
        )
          add("剧本条目缺少正文。");
        if (
          item.kind === "shots" &&
          !String(item.data["生成提示"] ?? "").trim()
        )
          add("镜头条目缺少生成提示。");
        seen.set(item.ref, item.kind);
      }
      for (const kind of ["scripts", "scenes", "shots"])
        if (!output.items.some((item) => item.kind === kind))
          add(`候选缺少 ${kind} 条目。`);
      if (!target || target.kind !== "episodes") {
        if (
          output.items.filter((item) => item.kind === "episodes").length !== 1
        )
          add("一次生成必须对应一个分集。");
      }
      return issues;
    },
    apply: (workflow) => {
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM production_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      assertCreationReferencesCurrent(
        workflow,
        service.prepare(workflow.input).references ?? [],
      );
      const output = workflow.output!;
      if (service.validate(workflow.input, output).length)
        throw new Error("候选结构无效。");
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        workflow.input.projectId,
      );
      if (project?.mode === "personal_theater") {
        const subjects = optionalService(
          context,
          MEDIA_LIKENESS_SERVICE,
        )?.listSubjects(project.id);
        if (
          !subjects?.length ||
          subjects.some((subject) => subject.consentStatus !== "active")
        )
          throw new Error("人物授权已变化，请完成授权后重新生成或采用。");
      }
      for (const source of workflow.sources) {
        const current =
          source.kind === "project"
            ? optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
                source.id,
              )
            : source.kind === "characters"
              ? optionalService(context, WRITING_RESOURCE_SERVICE)?.get(
                  source.id,
                )
              : source.kind === "chapter"
                ? optionalService(context, WRITING_CHAPTER_SERVICE)?.get(
                    source.id,
                  )
                : records().get(source.id);
        if (!current || current.version !== source.version)
          throw new Error("来源内容已变化，需要重新检查。");
      }
      context.uow.execute((tx) => {
        if (
          tx.get(
            "SELECT workflow_id FROM production_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          )
        )
          return;
        const at = new Date().toISOString();
        const refs = new Map<string, string>();
        const before = workflow.input.targetId
          ? tx.get<{ payload_json: string; version: number }>(
              "SELECT payload_json, version FROM production_records WHERE id = ?",
              workflow.input.targetId,
            )
          : undefined;
        const writeScript = (id: string, title: string, content: string) => {
          const parsed = parseFountain(content);
          const stableBlocks =
            workflow.input.operation === "script-revision"
              ? candidateBlocks(output)
              : undefined;
          const existing = tx.get<{ blocks_json: string }>(
            "SELECT blocks_json FROM screenplay_documents WHERE script_record_id = ?",
            id,
          );
          const old = existing
            ? (JSON.parse(existing.blocks_json) as Array<{
                id: string;
                type: string;
                text?: string;
              }>)
            : [];
          const used = new Set<string>();
          for (const block of parsed.blocks) {
            const match = old.find(
              (candidate) =>
                !used.has(candidate.id) &&
                candidate.type === block.type &&
                candidate.text === ("text" in block ? block.text : undefined),
            );
            if (match) {
              block.id = match.id;
              used.add(match.id);
            }
          }
          tx.run(
            "INSERT INTO screenplay_documents(id, script_record_id, project_id, title, source_format, blocks_json, loss_report_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'native', ?, ?, 0, ?, ?) ON CONFLICT(script_record_id) DO UPDATE SET title = excluded.title, blocks_json = excluded.blocks_json, version = screenplay_documents.version + 1, updated_at = excluded.updated_at",
            crypto.randomUUID(),
            id,
            workflow.input.projectId,
            title,
            JSON.stringify(stableBlocks ?? parsed.blocks),
            JSON.stringify(parsed.lossReport),
            at,
            at,
          );
        };
        if (workflow.input.operation !== "episode") {
          if (!before || before.version !== workflow.input.baseVersion)
            throw new Error("目标版本已变化。");
          const payload = JSON.parse(before.payload_json);
          payload[
            workflow.input.operation === "script-revision"
              ? "剧本内容"
              : "生成提示"
          ] = output.content;
          tx.run(
            "UPDATE production_records SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
            JSON.stringify(payload),
            at,
            workflow.input.targetId,
          );
          if (workflow.input.operation === "script-revision")
            writeScript(
              workflow.input.targetId!,
              output.title || "修订剧本",
              output.content,
            );
        } else {
          let order = 0;
          for (const item of output.items) {
            const id = crypto.randomUUID();
            const parentId = item.parentRef
              ? refs.get(item.parentRef)
              : workflow.input.targetId;
            tx.run(
              "INSERT INTO production_records(id, kind, project_id, parent_id, title, payload_json, order_index, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
              id,
              item.kind,
              workflow.input.projectId,
              parentId ?? null,
              item.title,
              JSON.stringify({ ...item.data, sourceWorkflowId: workflow.id }),
              order++,
              at,
              at,
            );
            refs.set(item.ref, id);
            if (item.kind === "scripts")
              writeScript(id, item.title, String(item.data["剧本内容"]));
          }
        }
        tx.run(
          "INSERT INTO production_creation_adoptions VALUES (?, ?, ?, ?)",
          workflow.id,
          JSON.stringify(Object.fromEntries(refs)),
          JSON.stringify(before ?? null),
          at,
        );
        tx.append({
          type: "production.creation-adopted.v1",
          pluginId: "production",
          aggregateType: "creation",
          aggregateId: workflow.id,
          aggregateVersion: 1,
          payload: {
            projectId: workflow.input.projectId,
            workflowId: workflow.id,
            ids: [...refs.values()],
          },
        });
      });
    },
  };
  context.effect(
    () => provideService(context, CREATION_PRODUCTION_SERVICE, service),
    `service:${CREATION_PRODUCTION_SERVICE}`,
  );
}
