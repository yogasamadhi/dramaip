import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createHash } from "node:crypto";
import {
  assertCreationReferencesCurrent,
  assertCreationAuthorIntentCurrent,
  creationAuthorIntent,
  AUTHOR_INTENT_CREATION_PROMPT,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  ProductionNarrativeBasisSchema,
  productionNarrativeIdentity,
} from "@dramaip/contracts/creation";
import { MEDIA_LIKENESS_SERVICE } from "@dramaip/contracts/media";
import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import {
  creationReference,
  CREATION_PRODUCTION_SERVICE,
  CreationContentSchema,
  CreationMergeSchema,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_DIAGNOSIS_SERVICE,
  PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
  PRODUCTION_SEASON_PLAN_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
} from "@dramaip/contracts/production";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
import { parseFountain, exportFountain } from "./screenplay-codec.js";
import {
  ScreenplayBlockSchema,
  type ScreenplayBlock,
} from "@dramaip/contracts/production";
import {
  createThreeWayMergePlan,
  resolveThreeWayMerge,
  inspectThreeWayMergeOrder,
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
  const readActualScript = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    scriptId: string,
  ) => {
    const row = tx.get<{
      version: number;
      document_id: string;
      document_version: number;
      blocks_json: string;
    }>(
      "SELECT r.version, d.id AS document_id, d.version AS document_version, d.blocks_json FROM production_records r JOIN screenplay_documents d ON d.script_record_id = r.id AND d.project_id = r.project_id WHERE r.id = ? AND r.project_id = ? AND r.kind = 'scripts'",
      scriptId,
      projectId,
    );
    if (!row)
      throw new Error("实际保存剧本不存在或归属不符，不初始化或猜测合并基准。");
    return {
      ...row,
      blocks: (JSON.parse(row.blocks_json) as unknown[]).map((block) =>
        ScreenplayBlockSchema.parse(block),
      ),
    };
  };
  const assertRebaseDocument = (
    tx: UnitOfWorkTransaction,
    workflow: Parameters<CreationAdapter["apply"]>[0],
  ) => {
    const source = workflow.rebaseSource,
      basis = source?.basis;
    if (workflow.input.operation !== "script-revision" || !basis) return;
    const current = readActualScript(
      tx,
      workflow.input.projectId,
      workflow.input.targetId!,
    );
    if (
      basis.projectId !== workflow.input.projectId ||
      basis.workflowId !== source!.id ||
      basis.target.scriptId !== workflow.input.targetId ||
      basis.target.version !== workflow.input.baseVersion ||
      current.version !== basis.target.version ||
      current.document_id !== basis.target.documentId ||
      current.document_version !== basis.target.documentVersion ||
      hash(current.blocks) !== basis.target.blocksHash
    )
      throw new Error(
        "采用前实际合并文档身份、版本或块已变化，不覆盖原稿；请重新打开比较。",
      );
  };
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
  const assertNarrativeOwnerCurrent = (
    workflow: Parameters<CreationAdapter["apply"]>[0],
  ): void => {
    const basis = workflow.productionNarrativeBasis;
    if (!basis && !workflow.input.productionNarrativeRequest) return;
    if (
      !basis ||
      !workflow.input.productionNarrativeRequest ||
      basis.operation !== workflow.input.operation ||
      hash(basis.request) !== hash(workflow.input.productionNarrativeRequest)
    )
      throw new Error("原明确制作来源与冻结绑定无法核对，不补造或换源。");
    const owner = optionalService(context, WRITING_NARRATIVE_SOURCE_SERVICE);
    if (!owner) throw new Error("原制作来源核对服务未启用。");
    owner.assertProductionCurrent(workflow.input.projectId, workflow.id, basis);
  };
  const assertNarrativeContextCurrent = (
    workflow: Parameters<CreationAdapter["apply"]>[0],
    prepared: ReturnType<CreationAdapter["prepare"]>,
    mutableTargetId?: string,
  ): void => {
    const basis = workflow.productionNarrativeBasis;
    if (!basis) return;
    const current = prepared.productionNarrativeBasis;
    if (
      !current ||
      productionNarrativeIdentity(basis) !==
        productionNarrativeIdentity(current)
    )
      throw new Error(
        "明确制作来源的范围、实际表达或采用头已变化，不换源采用原候选。",
      );
    const refs = (value: typeof basis) =>
      value.references
        .filter(
          (reference) =>
            !(
              mutableTargetId &&
              reference.sourceKind === "production" &&
              reference.sourceId === mutableTargetId &&
              reference.fieldPath === `/production/${mutableTargetId}`
            ),
        )
        .sort((a, b) =>
          `${a.sourceKind}:${a.sourceId}:${a.sourceVersion}:${a.fieldPath}`.localeCompare(
            `${b.sourceKind}:${b.sourceId}:${b.sourceVersion}:${b.fieldPath}`,
          ),
        );
    if (hash(refs(basis)) !== hash(refs(current)))
      throw new Error(
        "明确制作的实际简报、约束或保存内容已变化，不能把原候选当作当前复检或采用结果。",
      );
  };
  const service: CreationAdapter = {
    assertSourcesCurrent: (workflow) => {
      assertNarrativeOwnerCurrent(workflow);
      if (!workflow.productionNarrativeBasis) return;
      const prepared = service.prepare(workflow.input);
      assertCreationAuthorIntentCurrent(workflow, prepared.authorIntent!);
      assertCreationReferencesCurrent(workflow, prepared.references ?? []);
      assertNarrativeContextCurrent(workflow, prepared);
    },
    merge: (workflow, choices = {}, options = {}) => {
      if (
        workflow.input.operation !== "script-revision" ||
        workflow.stage !== "awaiting-review" ||
        !workflow.baseBlocks ||
        !workflow.output
      )
        throw new Error(
          "旧候选缺少稳定剧本块，无法安全合并；请按当前版本重新生成。",
        );
      const current = context.uow.execute((tx) =>
        readActualScript(
          tx,
          workflow.input.projectId,
          workflow.input.targetId!,
        ),
      );
      assertNarrativeOwnerCurrent(workflow);
      const prepared = service.prepare({
        ...workflow.input,
        baseVersion: current.version,
      });
      assertCreationAuthorIntentCurrent(workflow, prepared.authorIntent!);
      assertNarrativeContextCurrent(
        workflow,
        prepared,
        workflow.input.targetId,
      );
      assertCreationReferencesCurrent(
        {
          ...workflow,
          referenceVersions: workflow.referenceVersions.filter(
            (ref) => ref.sourceId !== workflow.input.targetId,
          ),
        },
        prepared.references ?? [],
      );
      const basis = {
        format: "stable-screenplay-merge-v1" as const,
        projectId: workflow.input.projectId,
        workflowId: workflow.id,
        baseBlocksHash: hash(workflow.baseBlocks),
        candidateHash: hash(workflow.output),
        contextHash: hash({
          authorIntent: prepared.authorIntent,
          references: prepared.references ?? [],
        }),
        target: {
          scriptId: workflow.input.targetId!,
          version: current.version,
          documentId: current.document_id,
          documentVersion: current.document_version,
          blocksHash: hash(current.blocks),
        },
      };
      if (options.basis && hash(options.basis) !== hash(basis))
        throw new Error(
          "实际合并比较基准已变化，请重新打开原候选比较；不会自动换源。",
        );
      const plan = createThreeWayMergePlan(
        workflow.baseBlocks.map((block) => ScreenplayBlockSchema.parse(block)),
        current.blocks,
        candidateBlocks(workflow.output),
      );
      const resolved = plan.unresolvedUnitIds.every((id) => choices[id]);
      const order = inspectThreeWayMergeOrder(plan, choices);
      if (options.blockOrder && !options.basis)
        throw new Error("明确块顺序须绑定实际合并比较基准。");
      const blocks =
        resolved && (options.blockOrder || !order.conflict)
          ? resolveThreeWayMerge(plan, choices, options.blockOrder)
          : undefined;
      return CreationMergeSchema.parse({
        currentVersion: current.version,
        basis,
        blockOrder: {
          format: "stable-block-order-v1",
          base: plan.orders.base,
          current: plan.orders.main,
          candidate: plan.orders.branch,
          ...order,
        },
        units: plan.units.map((unit) => ({
          id: unit.unitId,
          current: unit.main ? exportFountain([unit.main]) : "（已删除）",
          candidate: unit.branch
            ? exportFountain([unit.branch])
            : "（删除此块）",
          conflict: unit.conflict,
          choice: unit.defaultChoice,
          kind: unit.kind,
          currentPresent: Boolean(unit.main),
          candidatePresent: Boolean(unit.branch),
        })),
        ...(blocks
          ? {
              output: CreationContentSchema.parse({
                ...workflow.output,
                content: exportFountain(blocks),
                items: blocks.map((block) => ({
                  ref: block.id,
                  kind: "screenplay-block",
                  title: block.type,
                  data: { ...block },
                })),
              }),
            }
          : {}),
      });
    },
    prepare: (input) => {
      if (input.operation === "adaptation-strategy") {
        const strategies = optionalService(
          context,
          PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
        );
        if (!strategies) throw new Error("独立改编策略服务未启用。");
        return strategies.prepare(input);
      }
      if (
        ["episode-outline", "episode-script", "storyboard-package"].includes(
          input.operation,
        )
      ) {
        const episodes = optionalService(
          context,
          PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
        );
        if (!episodes) throw new Error("单集开发服务未启用。");
        return episodes.prepare(input);
      }
      if (input.operation === "season-plan") {
        const plans = optionalService(context, PRODUCTION_SEASON_PLAN_SERVICE);
        if (!plans) throw new Error("整季方案服务未启用。");
        return plans.prepare(input);
      }
      if (input.operation === "adaptation-diagnosis") {
        const diagnosis = optionalService(
          context,
          PRODUCTION_DIAGNOSIS_SERVICE,
        );
        if (!diagnosis) throw new Error("改编诊断服务未启用。");
        return diagnosis.prepare(input);
      }
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      if (!project) throw new Error("项目不存在。");
      const intentService = optionalService(
        context,
        WORKSPACE_AUTHOR_INTENT_SERVICE,
      );
      if (!intentService) throw new Error("正式作者意图服务未启用。");
      const intent = creationAuthorIntent(
        project.id,
        intentService.current(project.id),
      );
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
      const narrative = input.productionNarrativeRequest
        ? (() => {
            const owner = optionalService(
              context,
              WRITING_NARRATIVE_SOURCE_SERVICE,
            );
            if (!owner) throw new Error("明确制作来源编译服务未启用。");
            return owner.production(
              project.id,
              input.productionNarrativeRequest!,
            );
          })()
        : undefined;
      const chapters = narrative
        ? []
        : (optionalService(context, WRITING_CHAPTER_SERVICE)?.list(
            project.id,
          ) ?? []);
      // Legacy operations must not silently send the first chapters (or the
      // whole manuscript). Empty selection means no chapter source. Frozen
      // workflows keep their recorded references when explicitly retried.
      if (new Set(input.sourceIds).size !== input.sourceIds.length)
        throw new Error("来源章节不能重复选择。");
      const sources = input.sourceIds.map((id) => {
        const chapter = chapters.find((item) => item.id === id);
        if (!chapter) throw new Error("来源章节不存在或不属于项目。");
        return chapter;
      });
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
      const actualScript =
        narrative && target?.kind === "scripts"
          ? context.uow.execute((tx) =>
              readActualScript(tx, project.id, target.id),
            )
          : undefined;
      const baseBlocks =
        target?.kind === "scripts"
          ? narrative
            ? actualScript!.blocks
            : readBlocks(target.id)
          : undefined;
      const brief =
        input.operation === "script-revision"
          ? `${baseBlocks?.length ? "按反馈局部修订本集剧本。" : "当前剧本为空，从项目中的故事构思、创作简报与本集要求直接创作剧本，不先生成小说，也不虚构已采用季纲或媒体。"}content 返回完整 Fountain 剧本。items 按阅读顺序返回全部剧本块，kind 为 screenplay-block，ref 为块 id，data 包含 id（UUID）、type、text（page_break 除外）。type 使用 scene_heading/action/character/dialogue/parenthetical/transition/note/page_break。保留已有块 id，新增块使用新 UUID，保留未涉及的场景、人物和对白。`
          : input.operation === "shot-prompt"
            ? "根据镜头和人物视觉约束完善媒体提示词。content 返回完整生成提示，items 为空。"
            : `生成一集完整的剧本、场景和分镜方案。content 为完整 Fountain 剧本。items 按父项在前排列，使用 ref/parentRef 引用，kind 仅为 adaptations、episodes、scripts、scenes、shots。${target?.kind === "episodes" ? "根条目从 scripts 开始，直接归属当前分集，不创建新分集。" : target?.kind === "adaptations" ? "根条目从 episodes 开始，直接归属当前改编。" : "根条目为一个 adaptations，再创建一个 episodes。"}每个 scripts 的 data 包含「剧本内容」；每个 scenes 的 data 包含「地点与时间、场景动作、对白与备注」；每个 shots 的 data 包含「镜头序号、镜头描述、生成提示、负面提示、时长、角色」。禁止虚构已生成的媒体文件。`;
      const references = [
        ...intent.references,
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
        ...(narrative?.references ??
          sources.map((item) => creationReference("chapter", item))),
        ...materials.map((item) =>
          creationReference(
            item.kind,
            item.id === target?.id && baseBlocks
              ? {
                  ...item,
                  screenplayBlocks: baseBlocks,
                  ...(actualScript
                    ? {
                        screenplayDocument: {
                          id: actualScript.document_id,
                          version: actualScript.document_version,
                        },
                      }
                    : {}),
                }
              : item,
          ),
        ),
      ];
      return {
        prompt:
          (input.operation === "review-check"
            ? "针对已采用剧本与原审片意见做复检，只指出仍有证据支持的问题，不修改正文，不替用户关闭原问题。"
            : brief) +
          (intent.authorIntent.state === "adopted"
            ? `\n${AUTHOR_INTENT_CREATION_PROMPT}`
            : "") +
          (narrative
            ? narrative.basis.coverage.directoryState === "not-read"
              ? "\n作者明确不使用小说正文、段落或摘要。正文目录未读取，范围总数未知；仅依据冻结简报、正式作者意图及实际生产对象，不虚构原著证据或零遗漏覆盖。"
              : `\n作者明确选择${narrative.basis.request.chapterScope.mode === "full" ? "当前全部非空目录" : "局部目录"}中的 ${narrative.basis.coverage.included.length} 章，以所选原文、实际段落或已采用摘要表达；另有 ${narrative.basis.coverage.excluded.length} 章未纳入。不补入未提供正文，不把摘要或局部段落当作全文已读，不宣称语义或全书质量通过。`
            : `\n本轮仅明确选择 ${sources.length} 个章节来源；未选择的原著章节未提供，不能声称已读、全书覆盖或完整原著连续性。无章节来源时仅依据当前冻结的项目简报和生产对象，不虚构原著证据。`),
        authorIntent: intent.authorIntent,
        ...(input.operation === "review-check" && target
          ? {
              checkContent: {
                title: target.title,
                content: actualScript
                  ? exportFountain(actualScript.blocks)
                  : String(target.payload["剧本内容"] ?? ""),
                items: [],
              },
            }
          : {}),
        baseBlocks: baseBlocks?.map((block) => ({ ...block })),
        productionNarrativeBasis: narrative
          ? ProductionNarrativeBasisSchema.parse({
              ...narrative.basis,
              operation: input.operation,
              references: references.map((reference) => ({
                sourceKind: reference.sourceKind,
                sourceId: reference.sourceId,
                sourceVersion: reference.sourceVersion,
                fieldPath: reference.fieldPath,
                contentHash: hash(reference.value),
                policyDependencies: reference.policyDependencies,
              })),
            })
          : undefined,
        references,
        sources: [
          ...intent.sources,
          { kind: "project", id: project.id, version: project.version },
          ...characters.map((item) => ({
            kind: "characters",
            id: item.id,
            version: item.version,
          })),
          ...(narrative
            ? [
                ...new Map(
                  narrative.references.map((item) => [
                    `${item.sourceKind}:${item.sourceId}:${item.sourceVersion}`,
                    {
                      kind: item.sourceKind,
                      id: item.sourceId,
                      version: item.sourceVersion,
                    },
                  ]),
                ).values(),
              ]
            : sources.map((item) => ({
                kind: "chapter",
                id: item.id,
                version: item.version,
              }))),
          ...materials.map((item) => ({
            kind: item.kind,
            id: item.id,
            version: item.version,
          })),
        ],
      };
    },
    validate: (input, output, workflow) => {
      if (
        ["episode-outline", "episode-script", "storyboard-package"].includes(
          input.operation,
        )
      )
        return optionalService(
          context,
          PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
        )!.validate(input, output, workflow);
      if (input.operation === "season-plan")
        return optionalService(
          context,
          PRODUCTION_SEASON_PLAN_SERVICE,
        )!.validate(input, output, workflow);
      if (input.operation === "adaptation-strategy")
        return optionalService(
          context,
          PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
        )!.validate(input, output, workflow);
      if (input.operation === "adaptation-diagnosis")
        return optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE)!.validate(
          input,
          output,
          workflow,
        );
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
    review: (workflow) =>
      ["episode-outline", "episode-script", "storyboard-package"].includes(
        workflow.input.operation,
      )
        ? {
            episodeResultId: optionalService(
              context,
              PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
            )!.result(workflow.id),
          }
        : workflow.input.operation === "adaptation-strategy"
          ? optionalService(
              context,
              PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
            )!.preview(workflow)
          : workflow.input.operation === "season-plan"
            ? optionalService(context, PRODUCTION_SEASON_PLAN_SERVICE)!.preview(
                workflow,
              )
            : workflow.input.operation === "adaptation-diagnosis"
              ? optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE)!.preview(
                  workflow,
                )
              : {},
    reviewState: (workflow) =>
      workflow.input.operation === "adaptation-strategy"
        ? optionalService(
            context,
            PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
          )!.reviewState(workflow)
        : workflow.input.operation === "season-plan"
          ? optionalService(
              context,
              PRODUCTION_SEASON_PLAN_SERVICE,
            )!.reviewState(workflow)
          : workflow.input.operation === "adaptation-diagnosis"
            ? optionalService(
                context,
                PRODUCTION_DIAGNOSIS_SERVICE,
              )!.reviewState(workflow)
            : undefined,
    discard: (workflow) => {
      if (workflow.input.operation === "adaptation-strategy")
        optionalService(
          context,
          PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
        )!.discard(workflow);
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
      if (
        ["episode-outline", "episode-script", "storyboard-package"].includes(
          workflow.input.operation,
        )
      ) {
        optionalService(context, PRODUCTION_EPISODE_DEVELOPMENT_SERVICE)!.apply(
          workflow,
        );
        return;
      }
      if (workflow.input.operation === "adaptation-diagnosis")
        throw new Error("请在改编诊断工作台比较策略并明确选择一个策略后采用。");
      if (workflow.input.operation === "adaptation-strategy")
        throw new Error("请在独立改编策略工作台明确选择一个策略后采用。");
      if (workflow.input.operation === "season-plan")
        throw new Error("请在整季方案工作台核对完整覆盖与顺序后明确采用。");
      // New rebased workflows must not let legacy preparation reconstruct a
      // missing document before refusing the stale actual comparison.
      assertNarrativeOwnerCurrent(workflow);
      context.uow.execute((tx) => assertRebaseDocument(tx, workflow));
      const prepared = service.prepare(workflow.input);
      assertNarrativeContextCurrent(workflow, prepared);
      if (
        workflow.rebaseSource?.basis &&
        hash({
          authorIntent: prepared.authorIntent,
          references: prepared.references ?? [],
        }) !== workflow.rebaseSource.basis.contextHash
      )
        throw new Error(
          "采用前实际合并上下文已变化，不自动换源；请重新打开比较。",
        );
      assertCreationAuthorIntentCurrent(workflow, prepared.authorIntent!);
      assertCreationReferencesCurrent(workflow, prepared.references ?? []);
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
        // Narrative Knowledge references are verified through their own
        // adopted-summary/index owner above, never through Production tables.
        if (
          workflow.productionNarrativeBasis &&
          source.kind === "knowledge" &&
          workflow.productionNarrativeBasis.sourceBasis.references.some(
            (reference) =>
              reference.sourceKind === "knowledge" &&
              reference.sourceId === source.id &&
              reference.sourceVersion === source.version,
          )
        )
          continue;
        const current =
          source.kind === "author-intent"
            ? optionalService(
                context,
                WORKSPACE_AUTHOR_INTENT_SERVICE,
              )?.current(workflow.input.projectId)
            : source.kind === "project"
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
        assertRebaseDocument(tx, workflow);
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
