import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, confirmDialog, NativeSelect } from "@dramaip/ui-shared";
import {
  EpisodeDevelopmentRequestSchema,
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  StoryboardPackageContentSchema,
  StoryboardRedoPatchSchema,
  EpisodeDevelopmentOperationSchema,
  type EpisodeDevelopmentOperation,
  type EpisodeDevelopmentRequest,
  type EpisodeDevelopmentResult,
  type EpisodeOutlineContent,
  type EpisodeSceneEvidence,
  type StoryboardShotPlanRequest,
  type StoryboardTopologyPlanRequest,
} from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import { productionReferencesForEpisodeResult } from "../../formal-source-navigation";
import {
  episodeDevelopmentNavigationError,
  matchesEpisodeWorkflow,
  readExactEpisodeResult,
  readExactEpisodeWorkflow,
  sameEpisodeDevelopmentRequest,
  newEpisodeConfirmationSearch,
} from "../../episode-development-navigation";
import { useStudioSession } from "../../studio-session";
import { CreationWorkbench } from "../creation-workbench";
import {
  CreationWorkflowSchema,
  type CreationWorkflow,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import { NovelContextPicker } from "../novel/NovelContextPicker";
import { StoryboardContentView } from "./StoryboardContentView";
import { StoryboardShotPlanEditor } from "./StoryboardShotPlanEditor";
import {
  StoryboardTopologyPlanEditor,
  StoryboardTopologyPlanView,
  draftStoryboardTopologyPlan,
  topologySelectedOldShotIds,
} from "./StoryboardTopologyPlanEditor";
import { EpisodeImpactPanel } from "./EpisodeImpactPanel";
import { StoryboardSourceReviewReceiptView } from "./StoryboardSourceReviewReceiptView";
import { StoryboardAttributionPanel } from "./StoryboardAttributionPanel";
import { ProductionRecordMergeReview } from "./ProductionRecordMergeReview";
import { EpisodeScriptRevisionPanel } from "./EpisodeScriptRevisionPanel";
import { EpisodeTopologyRevisionPanel } from "./EpisodeTopologyRevisionPanel";
import { EpisodeSourceRevisionPanel } from "./EpisodeSourceRevisionPanel";
import { ScreenplayImportPanel } from "./ScreenplayImportPanel";
import { NarrativeSourceCoverage } from "../NarrativeSourceCoverage";
import { seasonNarrativeRequestMatches } from "../../episode-narrative-inheritance";
import {
  episodeSourceChoiceKey,
  parseEpisodeSourceChoice,
  episodeSourceChoiceMatches,
  type EpisodeSourceChoice,
} from "../../episode-source-choice";
import {
  PilotPackageDialog,
  pilotPackageStatusLabel,
} from "./PilotPackageDialog";
import type { PilotPackageRecord } from "@dramaip/contracts/delivery";
import { sameFrozenOwnerSnapshot } from "../../current-owner-read";
import {
  currentStoryboardSourceReviewFrame,
  matchesStoryboardSourceReviewObservation,
  type StoryboardSourceReviewFrame,
} from "../../storyboard-source-review-state";

const operationLabel = {
  "episode-outline": "单集大纲",
  "episode-script": "标准剧本",
  "storyboard-package": "分镜包",
};
function SceneQuotes({
  scene,
  verified,
}: {
  scene: EpisodeOutlineContent["scenes"][number];
  verified?: EpisodeSceneEvidence[];
}) {
  return scene.sourceEvidence ? (
    <section
      aria-label="逐场实际引文"
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <p className="text-muted">
        {verified?.some(
          (item) =>
            item.sceneId === scene.id && item.attribution === "human-declared",
        )
          ? "作者声明关联"
          : "模型声明关联"}
        ；规则仅校验逐字匹配，不证明语义正确。重复引文保留全部匹配位置，摘要不补原文位置。
      </p>
      {scene.sourceEvidence.map((evidence) => (
        <div key={evidence.id} className="space-y-1">
          <p className="break-all">
            {evidence.source.sourceKind} {evidence.source.sourceId} v
            {evidence.source.sourceVersion} · {evidence.source.fieldPath}
            {evidence.valuePath}
          </p>
          <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3">
            {evidence.quote}
          </blockquote>
          <p>声明关联理由：{evidence.rationale}</p>
          {verified
            ?.filter(
              (item) =>
                item.sceneId === scene.id && item.evidenceId === evidence.id,
            )
            .map((item) => (
              <details key={item.evidenceId}>
                <summary>规则校验的全部位置（UTF-16，结束位置不含）</summary>
                <p className="break-all">
                  {item.paragraphId
                    ? `实际段落 ${item.paragraphId}`
                    : item.sourceBlockId
                      ? `原稿稳定块 ${item.sourceBlockId}`
                      : "实际表达字段；摘要不推断原文位置"}
                </p>
                {item.matches.map((match, index) => (
                  <p key={index}>
                    表达 [{match.start}, {match.end})
                    {match.chapterStart !== undefined
                      ? `；原章节 [${match.chapterStart}, ${match.chapterEnd})`
                      : ""}
                  </p>
                ))}
              </details>
            ))}
        </div>
      ))}
    </section>
  ) : (
    <p className="text-sm text-muted">
      历史协议仅记录章节／直写来源，没有逐场引文证据，不自动升级。
    </p>
  );
}

export function EpisodeCandidate({ workflow }: { workflow: CreationWorkflow }) {
  const output = workflow.output;
  if (!output) return null;
  const outline = EpisodeOutlineContentSchema.safeParse(output.items[0]?.data);
  const script = EpisodeScriptContentSchema.safeParse(output.items[0]?.data);
  const storyboard = StoryboardPackageContentSchema.safeParse(
    output.items[0]?.data,
  );
  const patch = StoryboardRedoPatchSchema.safeParse(output.items[0]?.data);
  return (
    <article aria-label="单集候选完整内容" className="space-y-3 text-sm">
      <h3 className="font-semibold">{output.title}</h3>
      <p className="whitespace-pre-wrap leading-7">{output.content}</p>
      {workflow.episodeDevelopmentBasis?.sourceBasis &&
        workflow.episodeDevelopmentBasis.contextChapters && (
          <NarrativeSourceCoverage
            basis={workflow.episodeDevelopmentBasis.sourceBasis}
            chapters={workflow.episodeDevelopmentBasis.contextChapters}
            label="AI 草稿冻结实际表达"
          />
        )}
      {outline.success && (
        <>
          <p>
            目标：{outline.data.goal} · 主冲突：{outline.data.mainConflict}
          </p>
          <p>
            转折：{outline.data.turningPoint} · 集尾：{outline.data.endingHook}
          </p>
          {outline.data.scenes.map((scene) => (
            <section
              key={scene.id}
              className="space-y-2 rounded border border-line p-3"
            >
              <h4 className="font-medium">
                场景 {scene.orderIndex + 1} · {scene.location} ·{" "}
                {scene.timeOfDay} · {scene.durationSeconds} 秒
              </h4>
              <p>
                目标：{scene.goal} · 冲突：{scene.conflict} · 结果：
                {scene.outcome}
              </p>
              <p>人物：{scene.characters.join("、")}</p>
              <SceneQuotes scene={scene} />
              {scene.beats.map((beat) => (
                <p key={beat.id}>
                  {beat.action} · 因果：{beat.causalLink}
                </p>
              ))}
              <p className="text-muted">
                {scene.sourceReferences
                  ? "实际直写来源（不是小说章节）："
                  : "本集来源章节映射（不证明全文已读）："}
                {scene.sourceReferences
                  ? scene.sourceReferences
                      .map(
                        (source) =>
                          `${source.sourceKind} ${source.sourceId} v${source.sourceVersion}`,
                      )
                      .join("、")
                  : scene.sourceChapters
                      .map(
                        (source) =>
                          `${workflow.episodeDevelopmentBasis?.chapters.find((item) => item.id === source.id)?.title ?? source.id} v${source.version}`,
                      )
                      .join("、")}
              </p>
            </section>
          ))}
        </>
      )}
      {script.success && (
        <div className="rounded border border-line p-3">
          <p>
            {script.data.blocks.length} 个稳定剧本块 ·{" "}
            {script.data.sceneLinks.length} 个完整大纲场景映射；正文与块的
            Fountain 一致性已经结构检查。
          </p>
          <details className="mt-2">
            <summary>核对稳定标识与场景映射</summary>
            {script.data.sceneLinks.map((scene, index) => (
              <p key={scene.sceneId} className="mt-2 break-all">
                场景 {index + 1} · {scene.sceneId}：{scene.blockIds.join("、")}
              </p>
            ))}
          </details>
        </div>
      )}
      {storyboard.success && (
        <StoryboardContentView content={storyboard.data} />
      )}
      {patch.success && (
        <section aria-label="选中镜头局部候选" className="space-y-3">
          {workflow.episodeDevelopmentBasis?.storyboardRedo?.sourceReview && (
            <StoryboardSourceReviewReceiptView
              value={
                workflow.episodeDevelopmentBasis.storyboardRedo.sourceReview
              }
            />
          )}
          {workflow.stage === "awaiting-review" &&
            !workflow.recordMergeSource &&
            workflow.episodeDevelopmentBasis?.storyboardRedo && (
              <ProductionRecordMergeReview workflow={workflow} />
            )}
          {workflow.recordMergeSource && (
            <section
              aria-label="冻结实际字段选择"
              className="space-y-2 rounded border border-line p-3"
            >
              <p>
                原请求及完整字段指纹已冻结，仅复检此选择；标题／场景动作独立于镜头文字，采用前须核对一致性。私有自定义字段保留，语义质量尚未验证。
              </p>
              {workflow.recordMergeSource.comparison.units.map((unit) => {
                const side =
                  workflow.recordMergeSource!.request.choices[unit.id];
                const value = side === "main" ? unit.current : unit.candidate;
                return (
                  <p key={unit.id} className="whitespace-pre-wrap break-words">
                    {unit.kind === "shots" ? "镜头" : "场景"} {unit.recordId} ·{" "}
                    {unit.field} ·{" "}
                    {side === "main" ? "当前人工值" : "冻结草稿值"}：
                    {value.state === "text"
                      ? value.text
                      : "字段不可核对，不应采用"}
                  </p>
                );
              })}
            </section>
          )}
          <p>
            {patch.data.format === "selected-scene-topology-plan-v1"
              ? "按原双正式人工确认链和作者冻结的完整场景拓扑生成。原同场实际身份只能明确复用，新增使用新身份；退役实际历史、私有原值和旧媒体不删除或迁移。字段合并使用专用 v4 协议，不能借文字选择更改拓扑。"
              : patch.data.format === "selected-scene-shot-plan-v1"
                ? "按以下作者冻结的新镜头计划生成；新身份、顺序、时长和既有资产引用明确固定，未选场景原样保留，退役原记录与素材不删除。人工文字变化可用专用字段合并核对；结构不能作为文字选择改动，旧协议不自动升级。"
                : "只替换以下冻结选中镜头；未选记录原样保留。"}
            {patch.data.format === "selected-scene-shot-plan-v1" ||
            patch.data.format === "selected-scene-topology-plan-v1"
              ? ""
              : patch.data.format === "selected-storyboard-block-structure-v1"
                ? "按明确冻结的新正式块映射接续；场景／镜头身份、数量、时长与既有资产不变。"
                : "场景结构、时长、来源与既有资产不变。"}
            机械范围不是语义安全证明。
          </p>
          {(workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "confirmed-block-structure-fixed-shots-duration-assets-v1" ||
            workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
              "author-frozen-scene-shot-plan-v1") && (
            <div aria-label="冻结块结构映射" className="space-y-1 break-all">
              {workflow.episodeDevelopmentBasis.storyboardRedo.sceneMappings.map(
                (mapping) => (
                  <p key={mapping.sceneId}>
                    {mapping.sceneId} · 原块：
                    {mapping.previousBlockIds.join("、")} · 新块：
                    {mapping.currentBlockIds.join("、")}
                  </p>
                ),
              )}
            </div>
          )}
          {workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "author-frozen-scene-topology-plan-v1" && (
            <section
              aria-label="冻结作者场景拓扑计划"
              className="space-y-2 rounded border border-line p-3"
            >
              <p className="break-all">
                原大纲{" "}
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo
                    .previousOutline.id
                }{" "}
                v
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo
                    .previousOutline.version
                }{" "}
                → 新正式大纲{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.outline.id} v
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo.outline
                    .version
                }{" "}
                · 新正式剧本{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.script.id} v
                {workflow.episodeDevelopmentBasis.storyboardRedo.script.version}{" "}
                · 已核拓扑人工确认{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.topologySteps}{" "}
                步
              </p>
              <StoryboardTopologyPlanView
                value={
                  workflow.episodeDevelopmentBasis.storyboardRedo.topologyPlan
                }
              />
              <p>
                原实际选择、版本和祖先指纹已冻结。这里只展示 AI
                草稿，不证明语义、安全、权利、收费或媒体已完成。
              </p>
            </section>
          )}
          {workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "author-frozen-scene-shot-plan-v1" && (
            <section
              aria-label="冻结作者镜头计划"
              className="space-y-2 break-all rounded border border-line p-3"
            >
              {workflow.episodeDevelopmentBasis.storyboardRedo.scenePlans.map(
                (scene) => (
                  <div key={scene.sceneId}>
                    <p>
                      场景 {scene.sceneId} · 实际 {scene.recordId} v
                      {scene.version}
                    </p>
                    {scene.shots.map((shot) => (
                      <p key={shot.id}>
                        {shot.orderIndex + 1} · {shot.retains ? "复用" : "新增"}{" "}
                        {shot.id} · {shot.durationSeconds} 秒 · 资产{" "}
                        {shot.assetIds.join("、")}
                        {shot.retains
                          ? ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`
                          : " · 实际记录尚未采用创建"}
                      </p>
                    ))}
                  </div>
                ),
              )}
              <p>
                原选{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.shots.length}{" "}
                个镜头；其中不在新计划中的原身份采用后退役，旧快照和实际记录保留。此处不是语义、成本或权利证明。
              </p>
            </section>
          )}
          {patch.data.shots.map((shot) => (
            <div
              key={shot.id}
              className="space-y-1 rounded border border-line p-3"
            >
              <p className="font-medium">
                {shot.id} · {shot.durationSeconds} 秒：{shot.visualAction}
              </p>
              <p>
                构图：{shot.composition} · 机位：{shot.camera} · 运镜：
                {shot.movement}
              </p>
              <p>声音：{shot.sound}</p>
              <p className="whitespace-pre-wrap break-words">
                Prompt：{shot.prompt}
              </p>
              <p className="whitespace-pre-wrap break-words">
                负面 Prompt：{shot.negativePrompt}
              </p>
              <p className="break-all">
                来源：{shot.sourceBlockIds.join("、")} · 资产：
                {shot.assetIds.join("、")}
              </p>
              {patch.data.subtitles
                .filter((item) => item.shotId === shot.id)
                .map((subtitle) => (
                  <p key={subtitle.id}>
                    字幕 {subtitle.startSeconds}–{subtitle.endSeconds} 秒：
                    {subtitle.text}
                  </p>
                ))}
            </div>
          ))}
          {patch.data.costRisks.map((risk, index) => (
            <p key={index}>
              {risk.severity} · {risk.reason}；缓解：{risk.mitigation} ·{" "}
              {risk.shotIds.join("、")}
            </p>
          ))}
          <p className="text-muted">
            未选部分继承冻结原包；局部风险不是报价，未列风险不等于无风险。
          </p>
        </section>
      )}
      {!outline.success &&
        !script.success &&
        !storyboard.success &&
        !patch.success && (
          <p className="text-danger-strong">
            AI 草稿结构尚未通过，保留原输出供修复；不显示为正式结果。
          </p>
        )}
    </article>
  );
}

export function EpisodeDevelopmentPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const { rememberProductionObjectContext } = useStudioSession();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = episodeDevelopmentNavigationError(params);
  const requestedResultId = params.get("resultId")?.trim() || undefined;
  const requestedWorkflowId = params.get("workflowId")?.trim() || undefined;
  const requestedEpisodeId = params.get("episodeId");
  const requestedOperation = params.get("operation");
  const requestedResult = useQuery({
    queryKey: [
      "episode-development-exact-result",
      projectId,
      requestedResultId,
      requestedEpisodeId,
      requestedOperation,
      requestedWorkflowId,
    ],
    queryFn: () => client.episodeDevelopments.get(requestedResultId!),
    enabled: !navigationError && Boolean(requestedResultId),
    refetchInterval: 1500,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const exactResult =
    requestedResultId && !navigationError
      ? readExactEpisodeResult(requestedResult, {
          projectId,
          resultId: requestedResultId,
          episodeId: requestedEpisodeId,
          operation: requestedOperation,
          workflowId: requestedWorkflowId,
        })
      : undefined;
  const [pilotDialog, setPilotDialog] = useState<
    | { storyboard?: { id: string; version: number }; previewId?: string }
    | undefined
  >(() =>
    params.get("pilotPackageId")
      ? { previewId: params.get("pilotPackageId")! }
      : undefined,
  );
  const pilotHistory = useQuery({
    queryKey: ["pilot-packages", projectId],
    enabled: !requestedResultId,
    refetchInterval: 5000,
    queryFn: async () => {
      const items: PilotPackageRecord[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.pilotPackages.list(projectId, cursor, 100);
        if (page.items.some((item) => item.manifest.projectId !== projectId))
          throw new Error("交付历史归属不一致，尚未核全。");
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("交付历史游标循环，尚未核全。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const storageKey = `dramaip-episode-development-basis:${projectId}`;
  const [confirmed, setConfirmed] = useState<
    | {
        operation: EpisodeDevelopmentOperation;
        request: EpisodeDevelopmentRequest;
      }
    | undefined
  >(() => {
    if (requestedWorkflowId || navigationError) return undefined;
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      const request = EpisodeDevelopmentRequestSchema.safeParse(raw?.request);
      return request.success &&
        EpisodeDevelopmentOperationSchema.safeParse(raw.operation).success
        ? { operation: raw.operation, request: request.data }
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [sourceChoice, setSourceChoice] = useState(() => {
    try {
      return parseEpisodeSourceChoice(
        window.localStorage.getItem(episodeSourceChoiceKey(projectId)),
      );
    } catch {
      return undefined;
    }
  });
  const [reviewEnabled, setReviewEnabled] = useState(
    Boolean(confirmed?.request.redoSourceReview),
  );
  const [sourceReviewFrame, setSourceReviewFrame] = useState<{
    client: typeof client;
    frame: StoryboardSourceReviewFrame;
  }>();
  const [originalReviewRestored, setOriginalReviewRestored] = useState(false);
  const [sourceReviewRecovery, setSourceReviewRecovery] = useState(
    confirmed?.request.redoSourceReview ? confirmed : undefined,
  );
  const invalidateSourceReview = useCallback(() => {
    setSourceReviewFrame(undefined);
  }, []);
  const [episodeId, setEpisodeId] = useState(
    params.get("episodeId") ??
      sourceChoice?.episodeId ??
      confirmed?.request.episodeId ??
      "",
  );
  const [operation, setOperation] = useState<EpisodeDevelopmentOperation>(
    EpisodeDevelopmentOperationSchema.safeParse(params.get("operation")).success
      ? EpisodeDevelopmentOperationSchema.parse(params.get("operation"))
      : (confirmed?.operation ?? "episode-outline"),
  );
  const [error, setError] = useState<string>();
  const [narrativeMode, setNarrativeMode] = useState<"season" | "episode">(
    confirmed?.request.episodeNarrativeContext ? "episode" : "season",
  );
  const [episodeContext, setEpisodeContext] = useState<NarrativeContextRequest>(
    confirmed?.request.episodeNarrativeContext ?? {
      format: "narrative-context-v1",
      chapters: [],
    },
  );
  const [redoSelection, setRedoSelection] = useState<
    | {
        baseId: string;
        shotIds: string[];
        mode?: EpisodeDevelopmentRequest["redoMode"];
        shotPlan?: StoryboardShotPlanRequest;
        topologyPlan?: StoryboardTopologyPlanRequest;
      }
    | undefined
  >(() =>
    confirmed?.request.baseStoryboardId && confirmed.request.redoShots
      ? {
          baseId: confirmed.request.baseStoryboardId,
          shotIds: confirmed.request.redoShots.map((item) => item.shotId),
          mode: confirmed.request.redoMode,
          shotPlan: confirmed.request.redoShotPlan,
          topologyPlan: confirmed.request.redoTopologyPlan,
        }
      : undefined,
  );
  const [sourceScriptId, setSourceScriptId] = useState(
    sourceChoice &&
      (!params.get("episodeId") ||
        sourceChoice.episodeId === params.get("episodeId"))
      ? (sourceChoice.sourceScript?.id ?? "")
      : (confirmed?.request.direct?.sourceScript?.id ?? ""),
  );
  const saveChoice = (value: EpisodeSourceChoice) => {
    window.localStorage.setItem(
      episodeSourceChoiceKey(projectId),
      JSON.stringify(value),
    );
    setSourceChoice(value);
  };
  const [requireSourceChoice, setRequireSourceChoice] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(
    confirmed?.request.direct?.durationSeconds ?? 90,
  );
  const linkedWorkflow = useQuery({
    queryKey: [
      "episode-development-linked-workflow",
      projectId,
      requestedWorkflowId,
      requestedEpisodeId,
      requestedOperation,
    ],
    queryFn: async () => {
      const value = CreationWorkflowSchema.parse(
        await client.creation.get(requestedWorkflowId!),
      );
      if (
        !matchesEpisodeWorkflow(value, {
          projectId,
          workflowId: requestedWorkflowId!,
          episodeId: requestedEpisodeId,
          operation: requestedOperation,
        })
      )
        throw new Error(
          "指定原单集运行的项目、分集、操作或冻结请求不匹配；未替换为其他运行。",
        );
      return value;
    },
    enabled:
      !navigationError && !requestedResultId && Boolean(requestedWorkflowId),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const exactWorkflow =
    requestedWorkflowId && !navigationError
      ? readExactEpisodeWorkflow(linkedWorkflow, {
          projectId,
          workflowId: requestedWorkflowId,
          episodeId: requestedEpisodeId,
          operation: requestedOperation,
        })
      : undefined;
  useEffect(() => {
    const value = exactWorkflow;
    if (!value?.input.episodeDevelopmentRequest) return;
    const next = {
      operation: value.input.operation as EpisodeDevelopmentOperation,
      request: value.input.episodeDevelopmentRequest,
    };
    setConfirmed(next);
    setReviewEnabled(Boolean(next.request.redoSourceReview));
    setSourceReviewRecovery(next.request.redoSourceReview ? next : undefined);
    setSourceReviewFrame(undefined);
    setOriginalReviewRestored(false);
    setEpisodeId(next.request.episodeId);
    setOperation(next.operation);
    setRedoSelection(
      next.request.baseStoryboardId && next.request.redoShots
        ? {
            baseId: next.request.baseStoryboardId,
            shotIds: next.request.redoShots.map((item) => item.shotId),
            mode: next.request.redoMode,
            shotPlan: next.request.redoShotPlan,
            topologyPlan: next.request.redoTopologyPlan,
          }
        : undefined,
    );
    setNarrativeMode(
      next.request.episodeNarrativeContext ? "episode" : "season",
    );
    setEpisodeContext(
      next.request.episodeNarrativeContext ?? {
        format: "narrative-context-v1",
        chapters: [],
      },
    );
    if (next.request.direct) {
      setSourceScriptId(next.request.direct.sourceScript?.id ?? "");
      setDurationSeconds(next.request.direct.durationSeconds);
      const selected = {
        episodeId: next.request.episodeId,
        sourceScript: next.request.direct.sourceScript,
      };
      try {
        saveChoice(selected);
      } catch (cause) {
        setError(message(cause));
      }
    }
  }, [exactWorkflow, projectId]);
  const catalog = useQuery({
    queryKey: ["episode-development-sources", projectId],
    queryFn: () => client.episodeDevelopments.sources(projectId),
    refetchInterval: 1500,
    enabled: !requestedResultId,
  });
  const history = useQuery({
    queryKey: ["episode-development", projectId],
    refetchInterval: 1500,
    enabled: !requestedResultId,
    queryFn: async () => {
      const items: EpisodeDevelopmentResult[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.episodeDevelopments.list(
          projectId,
          cursor,
          100,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("单集历史游标循环，尚未核全。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const direct = catalog.data?.direct;
  const narrativeScope =
    catalog.data?.narrativeSourceScope ??
    catalog.data?.narrativeSources?.chapters;
  const narrativeChapters = useQuery({
    queryKey: [
      "episode-independent-narrative-chapters",
      projectId,
      narrativeScope,
    ],
    enabled:
      !requestedResultId &&
      !direct &&
      operation === "episode-outline" &&
      narrativeMode === "episode" &&
      Boolean(catalog.data?.seasonPlan && narrativeScope),
    queryFn: async () => {
      if (!narrativeScope) throw new Error("正式季纲来源范围尚未核全。");
      const values = await client.chapters.list(projectId);
      return narrativeScope.map((source) => {
        const matches = values.filter((item) => item.id === source.id);
        if (
          matches.length !== 1 ||
          matches[0]!.projectId !== projectId ||
          matches[0]!.version !== source.version
        )
          throw new Error("正式季纲范围或章节版本已变化；不补其他或最新章节。");
        return matches[0]!;
      });
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const episodes = direct?.episodes ?? catalog.data?.episodes;
  const currentEpisodeId = episodeId || episodes?.[0]?.id;
  const originalScripts =
    direct?.episodes.find((item) => item.id === currentEpisodeId)?.scripts ??
    [];
  const selectedSourceId =
    sourceScriptId ||
    (!requireSourceChoice &&
    !sourceChoice &&
    direct?.entryPath === "script" &&
    originalScripts.length === 1
      ? originalScripts[0]!.id
      : "");
  const outline = catalog.data?.currentResults.find(
    (item) =>
      item.episodeId === currentEpisodeId &&
      item.operation === "episode-outline",
  );
  const script = catalog.data?.currentResults.find(
    (item) =>
      item.episodeId === currentEpisodeId &&
      item.operation === "episode-script",
  );
  const storyboard = catalog.data?.currentResults.find(
    (item) =>
      item.episodeId === currentEpisodeId &&
      item.operation === "storyboard-package",
  );
  const navigationReferences = productionReferencesForEpisodeResult(
    requestedResultId ? exactResult : (script ?? outline),
    projectId,
  );
  useEffect(() => {
    if (
      navigationReferences &&
      (!requestedResultId || !requestedResult.isFetching)
    )
      rememberProductionObjectContext(projectId, navigationReferences);
  }, [
    projectId,
    navigationReferences?.episodeId,
    navigationReferences?.scriptId,
    requestedResultId,
    requestedResult.isFetching,
    rememberProductionObjectContext,
  ]);
  const selectedRedo =
    redoSelection?.baseId === storyboard?.id
      ? (redoSelection?.shotIds ?? [])
      : [];
  const sourceReviewScopeKey = JSON.stringify({
    projectId,
    episodeId: currentEpisodeId,
    operation,
    storyboard: storyboard && [
      storyboard.id,
      storyboard.version,
      storyboard.sourceState,
    ],
    outline: outline && [outline.id, outline.version, outline.sourceState],
    script: script && [
      script.id,
      script.version,
      script.scriptId,
      script.scriptDocumentVersion,
      script.sourceState,
    ],
    source: direct
      ? [direct.project, direct.authorIntent]
      : catalog.data?.seasonPlan,
    storyBibleCount: catalog.data?.storyBibleCount,
    redoSelection,
  });
  const currentSourceReview =
    !catalog.error && !history.error && sourceReviewFrame?.client === client
      ? currentStoryboardSourceReviewFrame(
          sourceReviewFrame.frame,
          storyboard,
          selectedRedo,
          sourceReviewScopeKey,
        )
      : undefined;
  const liveSourceReview = useRef({
    scopeKey: sourceReviewScopeKey,
    frame: currentSourceReview,
    enabled: reviewEnabled,
  });
  liveSourceReview.current = {
    scopeKey: sourceReviewScopeKey,
    frame: currentSourceReview,
    enabled: reviewEnabled,
  };
  const freezeSourceReview = useCallback(
    (frame: StoryboardSourceReviewFrame) => {
      if (
        frame.scopeKey !== liveSourceReview.current.scopeKey ||
        !liveSourceReview.current.enabled
      )
        throw new Error("本轮来源或重做范围已变化，不能冻结旧审阅。");
      setSourceReviewFrame({ client, frame });
      setOriginalReviewRestored(false);
    },
    [client],
  );
  const restoreOriginalSourceReview = () => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      const request = EpisodeDevelopmentRequestSchema.parse(raw?.request);
      if (
        raw?.operation !== "storyboard-package" ||
        !request.redoSourceReview ||
        !request.redoShots ||
        !request.baseStoryboardId ||
        (request.direct && request.direct.project.id !== projectId)
      )
        throw new Error("本机原来源审阅请求归属或完整范围不符，不补最新基准。");
      const next = { operation: "storyboard-package" as const, request };
      setSourceReviewRecovery(next);
      setConfirmed(next);
      setEpisodeId(request.episodeId);
      setOperation(next.operation);
      setRedoSelection({
        baseId: request.baseStoryboardId,
        shotIds: request.redoShots.map((item) => item.shotId),
        mode: request.redoMode,
        shotPlan: request.redoShotPlan,
        topologyPlan: request.redoTopologyPlan,
      });
      setReviewEnabled(true);
      setSourceReviewFrame(undefined);
      setOriginalReviewRestored(true);
      setError(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const ready =
    !navigationError &&
    (!requestedWorkflowId || Boolean(exactWorkflow)) &&
    !catalog.error &&
    !history.error &&
    !narrativeChapters.error &&
    confirmed?.operation === operation &&
    confirmed.request.episodeId === currentEpisodeId &&
    (exactWorkflow ||
      (Boolean(confirmed.request.redoSourceReview) === reviewEnabled &&
        (!reviewEnabled ||
          (originalReviewRestored &&
            sameFrozenOwnerSnapshot(
              confirmed.request.redoShots?.map((item) => item.shotId),
              selectedRedo,
            ) &&
            confirmed.request.baseStoryboardId === redoSelection?.baseId &&
            confirmed.request.redoMode === redoSelection?.mode &&
            sameFrozenOwnerSnapshot(
              {
                shotPlan: confirmed.request.redoShotPlan,
                topologyPlan: confirmed.request.redoTopologyPlan,
              },
              {
                shotPlan: redoSelection?.shotPlan,
                topologyPlan: redoSelection?.topologyPlan,
              },
            )) ||
          (currentSourceReview &&
            sameFrozenOwnerSnapshot(
              confirmed.request.redoSourceReview,
              currentSourceReview.review,
            ))))) &&
    Boolean(direct) === Boolean(confirmed.request.direct) &&
    (Boolean(direct) ||
      seasonNarrativeRequestMatches(
        catalog.data?.seasonPlan,
        Boolean(catalog.data?.narrativeSources),
        confirmed.request,
      ) ||
      // A deep-linked historical candidate remains reviewable/discardable.
      // New starts and adoption still revalidate its exact old basis in Runtime.
      (exactWorkflow?.input.operation === operation &&
        sameEpisodeDevelopmentRequest(
          exactWorkflow.input.episodeDevelopmentRequest,
          confirmed.request,
        ))) &&
    (operation !== "episode-outline" ||
      Boolean(direct) ||
      (narrativeMode === "episode"
        ? JSON.stringify(confirmed.request.episodeNarrativeContext) ===
          JSON.stringify(episodeContext)
        : !confirmed.request.episodeNarrativeContext)) &&
    (operation !== "episode-outline" ||
      !direct ||
      (confirmed.request.direct?.durationSeconds === durationSeconds &&
        (confirmed.request.direct.sourceScript?.id ?? "") ===
          selectedSourceId));
  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({
        queryKey: ["episode-development-exact-result", projectId],
      }),
      queries.invalidateQueries({
        queryKey: ["episode-development-sources", projectId],
      }),
      queries.invalidateQueries({
        queryKey: ["episode-development", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["production-records"] }),
    ]);
  };
  const confirmBasis = async () => {
    try {
      const frozenReview = reviewEnabled ? currentSourceReview : undefined;
      const frozenScope = sourceReviewScopeKey;
      const originalStorage = window.localStorage.getItem(storageKey);
      if (reviewEnabled && !frozenReview)
        throw new Error(
          "请先明确原关联、本次全部镜头决定与五项审阅；原请求恢复不等于本轮新基准批准。",
        );
      const data = await catalog.refetch();
      const sources = data.data;
      if (data.error || !sources || !currentEpisodeId)
        throw new Error("本集来源尚未核全，请重新确认。");
      const directEpisode = sources.direct?.episodes.find(
        (item) => item.id === currentEpisodeId,
      );
      if (
        sources.direct
          ? !sources.direct.authorIntent || !directEpisode
          : !sources.seasonPlan ||
            !sources.episodes.some((item) => item.id === currentEpisodeId)
      )
        throw new Error(
          sources.direct
            ? "请明确采用正式作者意图并选择当前实际分集。"
            : "请先采用来源有效的季纲并选择本集。",
        );
      const currentOutline = data.data.currentResults.find(
        (item) =>
          item.episodeId === currentEpisodeId &&
          item.operation === "episode-outline",
      );
      const currentScript = data.data.currentResults.find(
        (item) =>
          item.episodeId === currentEpisodeId &&
          item.operation === "episode-script",
      );
      if (
        operation !== "episode-outline" &&
        (!currentOutline || currentOutline.sourceState !== "current")
      )
        throw new Error("请先采用来源有效的单集大纲。");
      const currentStoryboard = data.data.currentResults.find(
        (item) =>
          item.episodeId === currentEpisodeId &&
          item.operation === "storyboard-package",
      );
      if (
        operation === "storyboard-package" &&
        redoSelection?.baseId === currentStoryboard?.id &&
        redoSelection?.mode &&
        !selectedRedo.length
      )
        throw new Error(
          "块结构重做须明确选择全部机械受影响镜头；不会静默改为整包生成。",
        );
      if (
        !sources.direct &&
        operation === "episode-outline" &&
        narrativeMode === "episode"
      ) {
        const actual = await narrativeChapters.refetch();
        if (actual.error || !actual.data)
          throw new Error(
            "本集独立来源读取失败，旧选择尚未重新核对；不能确认基准。",
          );
      }
      if (
        operation === "storyboard-package" &&
        selectedRedo.length &&
        currentStoryboard?.id !== redoSelection?.baseId
      )
        throw new Error("所选分镜采用头已变化，请重新选择，不能自动换基准。");
      if (
        operation === "storyboard-package" &&
        (!currentScript?.scriptId || currentScript.sourceState !== "current")
      )
        throw new Error("请先采用来源有效且未人工改写的标准剧本。");
      const original = directEpisode?.scripts.find(
        (item) => item.id === selectedSourceId,
      );
      if (
        sources.direct &&
        operation === "episode-outline" &&
        selectedSourceId &&
        !original
      )
        throw new Error(
          "所选原剧本不属于当前分集或正文已失效；不会替换为其他原稿。",
        );
      if (
        sources.direct &&
        operation === "episode-outline" &&
        sourceChoice?.episodeId === currentEpisodeId &&
        !episodeSourceChoiceMatches(sourceChoice, {
          episodeId: currentEpisodeId,
          sourceScript: original,
        })
      )
        throw new Error(
          "待确认选择的原稿记录／AST 已变化；请重新手动选择并核对，不自动换版本。",
        );
      if (
        redoSelection?.mode === "scene-topology-plan" &&
        (redoSelection.baseId !== currentStoryboard?.id ||
          !redoSelection.topologyPlan ||
          !selectedRedo.length)
      )
        throw new Error(
          "原拓扑计划、原分镜或完整旧选择未核全；不退回整包模式或补最新身份。",
        );
      if (frozenReview) {
        if (
          !currentStoryboard ||
          currentStoryboard.id !== frozenReview.reference.id ||
          currentStoryboard.version !== frozenReview.reference.version
        )
          throw new Error("原分镜采用头已变化，不自动重绑来源审阅。");
        const actual = await client.episodeDevelopments.impact(
          currentStoryboard.id,
          frozenReview.reference,
          frozenReview.review.attribution,
        );
        if (!matchesStoryboardSourceReviewObservation(frozenReview, actual)) {
          invalidateSourceReview();
          throw new Error(
            "完整实际影响观察已变化；请重读同一原关联并重新逐镜头审阅。",
          );
        }
      }
      const request = EpisodeDevelopmentRequestSchema.parse({
        ...(sources.direct
          ? {
              direct:
                operation === "episode-outline"
                  ? {
                      entryPath: sources.direct.entryPath,
                      project: sources.direct.project,
                      authorIntent: sources.direct.authorIntent,
                      episode: {
                        id: directEpisode!.id,
                        version: directEpisode!.version,
                      },
                      durationSeconds,
                      ...(original
                        ? {
                            sourceScript: {
                              id: original.id,
                              version: original.version,
                              documentVersion: original.documentVersion,
                            },
                          }
                        : {}),
                    }
                  : currentOutline!.basis.request.direct,
            }
          : {
              seasonPlan: sources.seasonPlan,
              ...(operation === "episode-outline"
                ? narrativeMode === "episode"
                  ? { episodeNarrativeContext: episodeContext }
                  : sources.narrativeSources
                    ? { inheritSeasonNarrative: true }
                    : {}
                : {
                    ...(currentOutline!.basis.request.inheritSeasonNarrative
                      ? { inheritSeasonNarrative: true }
                      : {}),
                    ...(currentOutline!.basis.request.episodeNarrativeContext
                      ? {
                          episodeNarrativeContext:
                            currentOutline!.basis.request
                              .episodeNarrativeContext,
                        }
                      : {}),
                  }),
            }),
        episodeId: currentEpisodeId,
        ...(operation === "episode-outline"
          ? { sourceEvidenceFormat: "exact-expression-quotes-v1" }
          : currentOutline!.basis.request.sourceEvidenceFormat
            ? {
                sourceEvidenceFormat:
                  currentOutline!.basis.request.sourceEvidenceFormat,
              }
            : {}),
        ...(operation === "episode-outline"
          ? { baseOutlineId: currentOutline?.id }
          : {
              outline: {
                id: currentOutline!.id,
                version: currentOutline!.version,
              },
              baseScriptDocumentVersion: currentScript?.scriptDocumentVersion,
              ...(operation === "episode-script"
                ? { baseScriptId: currentScript?.id }
                : {
                    script: {
                      id: currentScript!.id,
                      version: currentScript!.version,
                    },
                    baseStoryboardId: currentStoryboard?.id,
                    ...(selectedRedo.length
                      ? {
                          ...(redoSelection?.baseId === currentStoryboard?.id &&
                          redoSelection?.mode
                            ? {
                                redoMode: redoSelection.mode,
                                ...(redoSelection.mode === "scene-shot-plan"
                                  ? { redoShotPlan: redoSelection.shotPlan }
                                  : redoSelection.mode === "scene-topology-plan"
                                    ? {
                                        redoTopologyPlan:
                                          redoSelection.topologyPlan,
                                      }
                                    : {}),
                              }
                            : {}),
                          redoShots: selectedRedo.map((shotId) => {
                            const binding =
                              currentStoryboard?.productionRecords?.find(
                                (item) =>
                                  item.kind === "shots" &&
                                  item.stableId === shotId,
                              );
                            if (!binding)
                              throw new Error("所选镜头实际身份未核全。");
                            const reviewed = frozenReview?.review.shots.find(
                              (item) => item.shotId === shotId,
                            );
                            if (
                              frozenReview &&
                              (!reviewed ||
                                reviewed.decision !== "redo" ||
                                reviewed.record.id !== binding.id)
                            )
                              throw new Error(
                                "所选镜头与已冻结实际来源审阅身份不符，不用旧版本替代。",
                              );
                            return {
                              shotId,
                              recordId: binding.id,
                              version:
                                reviewed?.record.version ?? binding.version,
                            };
                          }),
                          ...(frozenReview
                            ? { redoSourceReview: frozenReview.review }
                            : {}),
                        }
                      : {}),
                  }),
            }),
      });
      // Author edits can make the receipt's document version stale. Reconfirm
      // from the actual AST, not the old adopted snapshot's version.
      if (operation !== "episode-outline" && currentScript?.scriptId)
        request.baseScriptDocumentVersion = (
          await client.screenplays.get(currentScript.scriptId)
        ).version;
      if (
        frozenReview &&
        (liveSourceReview.current.scopeKey !== frozenScope ||
          liveSourceReview.current.frame !== frozenReview ||
          !liveSourceReview.current.enabled)
      )
        throw new Error(
          "确认期间来源选择、完整审阅或重做范围已变化，未保存旧批准。",
        );
      if (window.localStorage.getItem(storageKey) !== originalStorage)
        throw new Error("本机原请求已由其他页面改变，未覆盖其冻结基准。");
      const next = { operation, request };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      if (window.localStorage.getItem(storageKey) !== JSON.stringify(next))
        throw new Error("本轮基准未完整持久保存，未开放生成。");
      setConfirmed(next);
      if (request.redoSourceReview) setSourceReviewRecovery(next);
      setOriginalReviewRestored(false);
      if (request.direct) {
        setSourceScriptId(request.direct.sourceScript?.id ?? "");
        setDurationSeconds(request.direct.durationSeconds);
      }
      setError(undefined);
      const newSearch = newEpisodeConfirmationSearch(
        params.toString(),
        next,
        exactWorkflow,
      );
      if (newSearch !== undefined) setParams(newSearch, { replace: true });
    } catch (cause) {
      if (reviewEnabled) invalidateSourceReview();
      setError(message(cause));
    }
  };
  if (navigationError)
    return (
      <section aria-label="单集开发工作台">
        <p role="alert">{navigationError}</p>
      </section>
    );
  return (
    <section aria-label="单集开发工作台" className="space-y-5">
      {requestedResultId && (
        <section
          aria-label="指定正式结果来源复核"
          className="space-y-2 rounded border border-line p-4"
        >
          <h2 className="font-semibold">指定正式结果来源复核</h2>
          <p className="text-sm text-muted">
            只读取此正式版本，不改成最近 AI
            草稿、不修复生成基准或自动重做。来源变化不撤销原采用事实。
          </p>
          {requestedResult.error ? (
            <p role="alert">{message(requestedResult.error)}</p>
          ) : requestedResult.isPending ||
            !requestedResult.isFetchedAfterMount ? (
            <p role="status">正在读取指定正式结果…</p>
          ) : !exactResult ? (
            <p role="alert">
              指定正式结果的项目、分集、操作或工作流不匹配；未替换为最新版本。
            </p>
          ) : (
            <p className="text-sm">
              {requestedResult.isFetching &&
                "正在重核来源，以下为上次实际读取的原快照 · "}
              {operationLabel[exactResult.operation]} v{exactResult.version} ·{" "}
              {exactResult.sourceState === "current"
                ? "来源有效"
                : "来源已变化，保留原正式快照"}
            </p>
          )}
          <Link
            className="text-sm text-link"
            to={`/projects/${encodeURIComponent(projectId)}/tools/episode-development`}
          >
            返回独立开发工作台（另行选择来源）
          </Link>
        </section>
      )}
      {!requestedResultId && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
          {requestedWorkflowId && !exactWorkflow && !linkedWorkflow.error && (
            <p role="status">
              正在读取指定原单集运行；未恢复其他运行或重新生成。
            </p>
          )}
          <h2 className="font-semibold">
            {direct
              ? "从作者创意或已有剧本独立开发单集"
              : "从已采用季纲开发单集"}
          </h2>
          <p className="text-sm text-muted">
            {direct
              ? "先确认实际作者简报或原剧本及本集时长，再审阅采用单集大纲和标准剧本。没有小说、诊断或季纲；不补造这些成果，原稿保留不覆盖。冻结正式作者意图、实际来源与已批准"
              : "先审阅采用单集大纲，再生成标准剧本。冻结当前季纲、唯一策略、作者意图、已批准"}
            Story Bible
            {direct
              ? "；下游精确继承已采用大纲的来源和时长。"
              : "与已确认的实际叙事表达；新采用保留旧结果，不覆盖作者新稿。"}
            分镜包另经明确采用才建立正式场景与镜头，不生成媒体。
          </p>
          <p className="text-sm">
            {direct ? (
              `实际项目简报 v${direct.project.version} · 正式作者意图：${direct.authorIntent ? `v${direct.authorIntent.version}` : "尚未采用或来源失效"}`
            ) : (
              <>
                当前季纲：
                {catalog.data?.seasonPlan
                  ? `v${catalog.data.seasonPlan.version}`
                  : "尚无来源有效的正式季纲"}
              </>
            )}{" "}
            · 已批准 Story Bible：{catalog.data?.storyBibleCount ?? "尚未核对"}{" "}
            份
          </p>
          <Link
            className="text-link text-sm"
            to={`/projects/${projectId}/tools/${direct ? "author-intent" : "season-plan"}`}
          >
            {direct ? "核对正式作者意图" : "核对整季方案"}
          </Link>
          <label className="block text-sm">
            开发分集
            <NativeSelect
              aria-label="开发分集"
              className="ml-2"
              value={currentEpisodeId ?? ""}
              onChange={(event) => {
                setEpisodeId(event.target.value);
                setEpisodeContext({
                  format: "narrative-context-v1",
                  chapters: [],
                });
                setNarrativeMode("season");
                setConfirmed(undefined);
                setSourceScriptId("");
                try {
                  saveChoice({ episodeId: event.target.value });
                } catch (cause) {
                  setError(message(cause));
                }
              }}
            >
              {episodes?.map((item) => (
                <option key={item.id} value={item.id}>
                  第{item.orderIndex + 1}集 · {item.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          {direct && operation === "episode-outline" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                实际原剧本
                <NativeSelect
                  aria-label="实际原剧本"
                  className="ml-2"
                  value={selectedSourceId}
                  onChange={(event) => {
                    setSourceScriptId(event.target.value);
                    const source = originalScripts.find(
                      (item) => item.id === event.target.value,
                    );
                    if (currentEpisodeId)
                      try {
                        saveChoice({
                          episodeId: currentEpisodeId,
                          ...(source
                            ? {
                                sourceScript: {
                                  id: source.id,
                                  version: source.version,
                                  documentVersion: source.documentVersion,
                                },
                              }
                            : {}),
                        });
                      } catch (cause) {
                        setError(message(cause));
                      }
                  }}
                >
                  <option value="">
                    {direct.entryPath === "script"
                      ? "请选择实际原剧本（必选）"
                      : "仅使用作者保存的创意简报"}
                  </option>
                  {originalScripts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · v{item.version} · 文档{" "}
                      {item.documentVersion === null
                        ? "未创建"
                        : `v${item.documentVersion}`}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                本集目标秒数
                <input
                  aria-label="本集目标秒数"
                  className="ml-2 w-24 rounded border border-line bg-surface p-2"
                  type="number"
                  min={30}
                  max={1800}
                  value={durationSeconds}
                  onChange={(event) =>
                    setDurationSeconds(Number(event.target.value))
                  }
                />
              </label>
            </div>
          )}
          {direct &&
            operation === "episode-outline" &&
            sourceChoice &&
            sourceChoice.episodeId === currentEpisodeId && (
              <p className="text-sm text-muted">
                待确认选源：
                {sourceChoice.sourceScript
                  ? `原稿 ${sourceChoice.sourceScript.id} v${sourceChoice.sourceScript.version} · 文档 ${sourceChoice.sourceScript.documentVersion === null ? "未创建" : `v${sourceChoice.sourceScript.documentVersion}`}`
                  : "仅使用当前作者简报（已有剧本路径仍须选择原稿）"}
                ；仅恢复选择身份与版本，尚未确认本轮单集基准，不继承授权或自动采用。
              </p>
            )}
          {direct && currentEpisodeId && operation === "episode-outline" && (
            <ScreenplayImportPanel
              key={`${projectId}:${currentEpisodeId}`}
              projectId={projectId}
              episodeId={currentEpisodeId}
              onImported={() => {
                setRequireSourceChoice(true);
                void refresh();
                void queries.invalidateQueries({
                  queryKey: ["direct-script-cockpit-evidence", projectId],
                });
              }}
            />
          )}
          {!direct && catalog.data?.seasonPlan && (
            <section aria-label="单集实际表达确认" className="space-y-2">
              {operation === "episode-outline" && (
                <label className="block text-sm">
                  本集实际输入方式
                  <NativeSelect
                    aria-label="本集实际输入方式"
                    className="ml-2 w-auto"
                    value={narrativeMode}
                    onChange={(event) => {
                      setNarrativeMode(
                        event.target.value as "season" | "episode",
                      );
                      setConfirmed(undefined);
                    }}
                  >
                    <option value="season">继承正式季纲的表达</option>
                    <option value="episode">本集独立重选实际表达</option>
                  </NativeSelect>
                </label>
              )}
              <p className="text-sm">
                本集映射{" "}
                {catalog.data.episodes.find(
                  (item) => item.id === currentEpisodeId,
                )?.sourceChapters.length ?? 0}{" "}
                章；实际输入与映射分开核对。独立选择必须完整覆盖本集映射，
                高层摘要全部范围须在原季纲内，不截取跨集摘要；未选章节不自动补入，
                也不证明其语义上无影响。正式季纲及完整来源禁止链仍保留，失效季纲不能绕过。
                确认本轮单集基准后，下游标准剧本和分镜沿用同一表达，不另换源。
              </p>
              {operation === "episode-outline" &&
              narrativeMode === "episode" ? (
                <>
                  {narrativeChapters.error && (
                    <p role="alert">
                      本集来源未核全：{message(narrativeChapters.error)}
                    </p>
                  )}
                  {!narrativeChapters.error && narrativeChapters.data && (
                    <NovelContextPicker
                      key={`${projectId}:${currentEpisodeId}:${catalog.data.seasonPlan.id}:${catalog.data.seasonPlan.version}`}
                      scope={{ projectId, title: "本集独立实际表达" }}
                      purpose="planning"
                      chapters={narrativeChapters.data}
                      request={episodeContext}
                      disabled={Boolean(catalog.error || history.error)}
                      onChange={(value) => {
                        setEpisodeContext(value);
                        setConfirmed(undefined);
                      }}
                    />
                  )}
                </>
              ) : operation !== "episode-outline" &&
                outline?.basis.sourceBasis &&
                outline.basis.contextChapters ? (
                <NarrativeSourceCoverage
                  basis={outline.basis.sourceBasis}
                  chapters={outline.basis.contextChapters}
                  label="继承已采用单集大纲的实际输入"
                />
              ) : catalog.data.narrativeSources ? (
                <>
                  <p className="text-sm">
                    本轮完整继承整季已确认范围{" "}
                    {catalog.data.narrativeSources.chapters.length}{" "}
                    章，可能包含非本集映射章节；摘要／段落不是全文已读证明。
                  </p>
                  <NarrativeSourceCoverage
                    basis={catalog.data.narrativeSources.basis}
                    chapters={catalog.data.narrativeSources.chapters}
                    label="单集继承的整季实际输入"
                  />
                </>
              ) : (
                <p className="text-sm text-muted">
                  历史原文协议仅纳入本集实际映射原文，不自动升级为混合表达或重新选择。
                </p>
              )}
            </section>
          )}
          {operation === "storyboard-package" &&
            storyboard?.content.kind === "storyboard-package" && (
              <section
                aria-label="局部分镜重做范围"
                className="space-y-2 rounded border border-line p-3 text-sm"
              >
                <h3 className="font-medium">明确选择局部重做镜头</h3>
                <p>
                  不选表示整包生成；选中后只生成这些镜头的替换方案。人工剧本先正式确认；全部机械受影响镜头须选中，无法局部化的上游变化会被阻止。默认保留旧块映射；场内块增删／重排须另行明确选择。未选镜头不是语义安全承诺。
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={
                      redoSelection?.baseId === storyboard.id &&
                      redoSelection.mode === "confirmed-block-structure"
                    }
                    onChange={(event) => {
                      setRedoSelection({
                        baseId: storyboard.id,
                        shotIds: selectedRedo,
                        ...(event.target.checked
                          ? { mode: "confirmed-block-structure" as const }
                          : {}),
                      });
                      setConfirmed(undefined);
                    }}
                  />
                  <span>
                    按已正式确认的新块结构重做（场景与镜头身份、数量、顺序、时长及资产不变）
                  </span>
                </label>
                <Button
                  variant="secondary"
                  disabled={Boolean(
                    catalog.error ||
                    history.error ||
                    catalog.isFetching ||
                    history.isFetching ||
                    !outline ||
                    !script,
                  )}
                  onClick={() => {
                    try {
                      const previousOutline = history.data?.find(
                          (value) =>
                            value.id === storyboard.basis.request.outline?.id,
                        ),
                        previousScript = history.data?.find(
                          (value) =>
                            value.id === storyboard.basis.request.script?.id,
                        );
                      if (
                        !previousOutline ||
                        !previousScript ||
                        !outline ||
                        !script
                      )
                        throw new Error(
                          "原双正式历史或新正式版本尚未核全，不读取其他版本。",
                        );
                      const topologyPlan = draftStoryboardTopologyPlan(
                        storyboard,
                        previousOutline,
                        previousScript,
                        outline,
                        script,
                      );
                      setRedoSelection({
                        baseId: storyboard.id,
                        mode: "scene-topology-plan",
                        topologyPlan,
                        shotIds: topologySelectedOldShotIds(
                          storyboard,
                          topologyPlan,
                        ),
                      });
                      setConfirmed(undefined);
                      setError(undefined);
                    } catch (cause) {
                      setError(message(cause));
                    }
                  }}
                >
                  明确按新双正式版本建立场景拓扑计划（须核对退役）
                </Button>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={
                      redoSelection?.baseId === storyboard.id &&
                      redoSelection.mode === "scene-shot-plan"
                    }
                    onChange={(event) => {
                      setRedoSelection({
                        baseId: storyboard.id,
                        shotIds: [],
                        ...(event.target.checked
                          ? {
                              mode: "scene-shot-plan" as const,
                              shotPlan: {
                                format: "author-scene-shot-plan-v1" as const,
                                scenePlans: [],
                              },
                            }
                          : {}),
                      });
                      setConfirmed(undefined);
                    }}
                  />
                  <span>
                    按作者场景镜头计划重做（可增删镜头、调整顺序／时长／既有资产引用，原场景不变）
                  </span>
                </label>
                {redoSelection?.baseId === storyboard.id &&
                redoSelection.mode === "scene-topology-plan" &&
                redoSelection.topologyPlan ? (
                  <StoryboardTopologyPlanEditor
                    key={`${storyboard.id}:${storyboard.version}`}
                    base={storyboard}
                    value={redoSelection.topologyPlan}
                    onChange={(topologyPlan) => {
                      setRedoSelection({
                        baseId: storyboard.id,
                        mode: "scene-topology-plan",
                        topologyPlan,
                        shotIds: topologySelectedOldShotIds(
                          storyboard,
                          topologyPlan,
                        ),
                      });
                      setConfirmed(undefined);
                    }}
                  />
                ) : redoSelection?.baseId === storyboard.id &&
                  redoSelection.mode === "scene-shot-plan" ? (
                  <StoryboardShotPlanEditor
                    base={storyboard}
                    value={
                      redoSelection.shotPlan ?? {
                        format: "author-scene-shot-plan-v1",
                        scenePlans: [],
                      }
                    }
                    onChange={(shotPlan) => {
                      const selectedScenes = new Set(
                        shotPlan.scenePlans.map((scene) => scene.sceneId),
                      );
                      setRedoSelection({
                        baseId: storyboard.id,
                        mode: "scene-shot-plan",
                        shotPlan,
                        shotIds:
                          storyboard.content.kind === "storyboard-package"
                            ? storyboard.content.value.scenes
                                .filter((scene) =>
                                  selectedScenes.has(scene.sceneId),
                                )
                                .flatMap((scene) =>
                                  scene.shots.map((shot) => shot.id),
                                )
                            : [],
                      });
                      setConfirmed(undefined);
                    }}
                  />
                ) : (
                  storyboard.content.value.scenes.map((scene, index) => (
                    <div key={scene.sceneId} className="space-y-1">
                      <p>
                        场景 {index + 1} · {scene.sceneId}
                      </p>
                      {scene.shots.map((shot) => (
                        <label key={shot.id} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedRedo.includes(shot.id)}
                            onChange={(event) => {
                              setRedoSelection({
                                baseId: storyboard.id,
                                mode:
                                  redoSelection?.baseId === storyboard.id
                                    ? redoSelection.mode
                                    : undefined,
                                shotIds: event.target.checked
                                  ? [...selectedRedo, shot.id]
                                  : selectedRedo.filter((id) => id !== shot.id),
                              });
                              setConfirmed(undefined);
                            }}
                          />
                          <span>
                            重做 {shot.id} · {shot.visualAction} ·{" "}
                            {shot.durationSeconds} 秒
                          </span>
                        </label>
                      ))}
                    </div>
                  ))
                )}
                <p>
                  已选 {selectedRedo.length}{" "}
                  镜头；确认基准仅保存选择，不调用模型或生成媒体。
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label="将明确原关联影响审阅绑定本轮局部重做"
                    checked={reviewEnabled}
                    onChange={(event) => {
                      invalidateSourceReview();
                      setReviewEnabled(event.target.checked);
                    }}
                  />
                  <span>
                    将明确原关联影响审阅绑定本轮局部重做（完整范围，不自动选择最新关联）
                  </span>
                </label>
                {reviewEnabled && (
                  <EpisodeImpactPanel
                    key={`${storyboard.projectId}:${storyboard.episodeId}:${storyboard.id}:${storyboard.version}:source-review`}
                    result={storyboard}
                    sourceReview={{
                      scopeKey: sourceReviewScopeKey,
                      selectedShotIds: selectedRedo,
                      onFreeze: freezeSourceReview,
                      onInvalidate: invalidateSourceReview,
                    }}
                  />
                )}
                {sourceReviewRecovery && (
                  <section
                    aria-label="原来源审阅请求恢复"
                    className="space-y-2 rounded border border-line p-3"
                  >
                    <p className="break-all">
                      本机保存的原请求：分镜{" "}
                      {sourceReviewRecovery.request.baseStoryboardId} · 原关联{" "}
                      {
                        sourceReviewRecovery.request.redoSourceReview
                          ?.attribution.id
                      }{" "}
                      · 观察{" "}
                      {
                        sourceReviewRecovery.request.redoSourceReview
                          ?.impactHash
                      }
                      。恢复只开放原冻结请求与原候选核对，不批准新来源、不自动重发或调用模型。
                    </p>
                    <Button
                      variant="secondary"
                      onClick={restoreOriginalSourceReview}
                    >
                      恢复本机原来源审阅请求（不换基准）
                    </Button>
                    {originalReviewRestored && (
                      <p role="status">
                        已明确恢复原完整请求；实际创建与采用仍核原来源资格。新基准必须重新完成完整审阅。
                      </p>
                    )}
                  </section>
                )}
              </section>
            )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={operation === "episode-outline" ? "secondary" : "ghost"}
              onClick={() => setOperation("episode-outline")}
            >
              单集大纲
            </Button>
            <Button
              variant={operation === "episode-script" ? "secondary" : "ghost"}
              onClick={() => setOperation("episode-script")}
            >
              标准剧本
            </Button>
            <Button
              variant={
                operation === "storyboard-package" ? "secondary" : "ghost"
              }
              onClick={() => setOperation("storyboard-package")}
            >
              分镜包
            </Button>
            <Button
              disabled={
                !(direct
                  ? direct.authorIntent && currentEpisodeId
                  : catalog.data?.seasonPlan) || !catalog.data?.storyBibleCount
              }
              onClick={() => void confirmBasis()}
            >
              确认本轮单集基准
            </Button>
          </div>
          {confirmed && (
            <p className="text-sm text-muted">
              {confirmed.request.direct
                ? `已确认直写简报 v${confirmed.request.direct.project.version} · ${confirmed.request.direct.durationSeconds} 秒${confirmed.request.direct.sourceScript ? ` · 原稿 v${confirmed.request.direct.sourceScript.version}` : ""}`
                : `已确认季纲 v${confirmed.request.seasonPlan!.version}`}{" "}
              · 本集 {confirmed.request.episodeId}
              ；保存的基准不会自动重绑新版本。
              {confirmed.request.redoShots &&
                ` · 局部重做 ${confirmed.request.redoShots.length} 镜头（冻结身份与版本）`}
              {confirmed.request.redoSourceReview &&
                ` · 原关联 ${confirmed.request.redoSourceReview.attribution.id} v${confirmed.request.redoSourceReview.attribution.version} · 全部 ${confirmed.request.redoSourceReview.shots.length} 镜头与五项来源审阅已保存（语义未认证）`}
              {confirmed.request.redoMode === "scene-topology-plan"
                ? " · 明确冻结双正式场景拓扑、新旧实际身份和逐项退役（不自动升级旧 AI 草稿，不迁移媒体）"
                : confirmed.request.redoMode === "scene-shot-plan"
                  ? " · 明确冻结作者新镜头计划（旧身份、版本与退役范围同时保留，不自动升级旧 AI 草稿）"
                  : confirmed.request.redoMode &&
                    " · 明确使用已确认块结构协议（不自动升级旧 AI 草稿）"}
            </p>
          )}
          {(error ||
            catalog.error ||
            history.error ||
            linkedWorkflow.error) && (
            <p role="alert" className="text-sm text-danger-strong">
              {error ??
                message(catalog.error ?? history.error ?? linkedWorkflow.error)}
            </p>
          )}
        </div>
      )}
      {!requestedResultId && catalog.data?.storyBibleCount === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            尚无明确采用的 Story Bible。先核对设定 AI
            草稿；生成成功或待确认设定不等于正式采用。
          </p>
          <CreationWorkbench
            projectId={projectId}
            operation="knowledge-plan"
            resultLabel="Story Bible"
            defaultInstruction="根据作品作者意图和已采用内容制定故事圣经，区分事实与未来规划。"
            onApplied={refresh}
          />
        </div>
      )}
      {!requestedResultId && ready && (
        <CreationWorkbench
          key={`${params.get("workflowId") ?? "new"}:${operation}:${currentEpisodeId}:${JSON.stringify(confirmed.request)}`}
          projectId={projectId}
          workflowId={exactWorkflow?.id}
          operation={operation}
          episodeDevelopmentRequest={confirmed.request}
          defaultInstruction={
            operation === "episode-outline"
              ? confirmed.request.direct
                ? "按真实作者简报或原剧本发展有因果推进的场景目标与节拍，保留正式作者意图与原稿；不补造小说、诊断或季纲。"
                : "按本集季纲发展有因果推进的场景目标与节拍，保留作者意图与集尾。"
              : operation === "episode-script"
                ? "按已采用本集大纲创作标准 Fountain 剧本，提供稳定剧本块及完整场景来源映射。"
                : "按正式剧本的稳定块逐场开发镜头、视觉资产需求、正负 Prompt、声音、字幕与制作风险；媒体保持可选。"
          }
          onApplied={refresh}
          renderCandidate={(workflow) => (
            <EpisodeCandidate workflow={workflow} />
          )}
          onAdopt={async (preview) => {
            if (
              !(await confirmDialog({
                title:
                  operation === "episode-outline"
                    ? "明确采用单集大纲？"
                    : operation === "episode-script"
                      ? "明确采用标准剧本？"
                      : confirmed.request.redoShots
                        ? "明确采用选中镜头局部重做？"
                        : "明确采用单集分镜包？",
                description:
                  operation === "storyboard-package"
                    ? confirmed.request.redoShots
                      ? `${confirmed.request.redoMode === "scene-topology-plan" ? "核对双正式人工确认链和完整作者场景拓扑：明确新增、同场复用、原实际身份／版本、顺序／秒数和逐项退役。原退役记录与媒体历史只保留，不自动迁移。" : confirmed.request.redoMode === "scene-shot-plan" ? "核对完整作者场景镜头计划，新旧身份、排序、秒数和资产引用都已明确冻结；不在新计划中的原镜头采用后退役但保留实际历史。" : confirmed.request.redoMode ? "核对明确冻结的原／新块映射，原场景和镜头身份、数量、顺序、时长与资产不变。" : ""}核对冻结选择、局部镜头、字幕及风险。仅更新选中范围与其场景汇总，未选身份、内容和版本保留；对应旧媒体须复核，旧正式快照保留。不调用媒体服务商或授权费用。`
                      : "核对完整镜头、稳定块覆盖和风险。采用将建立正式场景与分镜，保留旧版本；不生成媒体或授权费用。"
                    : "核对参考内容和完整内容。保留旧版本，不自动写入场景、分镜或媒体。",
                confirmLabel: "明确采用",
              }))
            )
              return false;
            await client.changePreviews.commit(
              preview.id,
              `episode-adopt:${preview.id}`,
            );
            return true;
          }}
        />
      )}
      <div className="space-y-3">
        <h3 className="font-semibold">本集正式结果与历史</h3>
        {!requestedResultId && (
          <p className="text-sm">
            当前大纲：
            {outline
              ? `v${outline.version} · ${outline.sourceState === "current" ? "来源有效" : "来源已变化"}`
              : "尚未采用"}{" "}
            · 当前剧本：
            {script
              ? `v${script.version} · ${script.sourceState === "current" ? "来源有效" : "来源或人工正文已变化"}`
              : "尚未采用"}
          </p>
        )}
        {(requestedResultId
          ? exactResult
            ? [exactResult]
            : []
          : (history.data?.filter(
              (item) => item.episodeId === currentEpisodeId,
            ) ?? [])
        ).map((item) => (
          <article
            key={item.id}
            className="space-y-2 rounded border border-line p-4"
            aria-label={`正式${operationLabel[item.operation]} v${item.version}`}
          >
            <h4 className="font-semibold">
              {operationLabel[item.operation]} v{item.version} ·{" "}
              {item.isCurrent ? "当前采用" : "历史采用"}
            </h4>
            {(item.origin === "human-script-revision" ||
              item.origin === "human-topology-revision" ||
              item.origin === "human-source-revision") && (
              <p className="text-sm text-muted">
                人工确认正式快照 · 无模型工作流或运行 ·
                语义由作者声明，未独立验证
              </p>
            )}
            {item.basis.sourceBasis && item.basis.contextChapters && (
              <>
                <p className="text-sm">
                  本集映射 {item.basis.chapters.length} 章；实际冻结输入表达{" "}
                  {item.basis.contextChapters.length} 章，二者不混计。
                </p>
                <NarrativeSourceCoverage
                  basis={item.basis.sourceBasis}
                  chapters={item.basis.contextChapters}
                  label="正式单集冻结实际表达"
                />
              </>
            )}
            {item.staleReasons.map((reason) => (
              <p className="text-sm text-danger-strong" key={reason}>
                {reason}
              </p>
            ))}
            {item.content.kind === "episode-outline" ? (
              <>
                <p className="text-sm">{item.content.value.logline}</p>
                {item.content.value.scenes.map((scene) => (
                  <details key={scene.id}>
                    <summary>
                      场景 {scene.orderIndex + 1} · {scene.location} ·{" "}
                      {scene.durationSeconds} 秒
                    </summary>
                    <p className="text-sm">
                      目标：{scene.goal} · 冲突：{scene.conflict} · 结果：
                      {scene.outcome}
                    </p>
                    {scene.beats.map((beat) => (
                      <p className="text-sm" key={beat.id}>
                        {beat.action} · 因果：{beat.causalLink}
                      </p>
                    ))}
                    <SceneQuotes scene={scene} verified={item.sourceEvidence} />
                  </details>
                ))}
              </>
            ) : item.content.kind === "storyboard-package" ? (
              <StoryboardContentView content={item.content.value} />
            ) : (
              <p className="text-sm">
                {item.content.value.blocks.length} 个稳定剧本块 ·{" "}
                {item.content.value.sceneLinks.length} 个完整场景映射
              </p>
            )}
            {item.scriptId && (
              <Link
                className="text-link text-sm"
                to={`/adapt?projectId=${projectId}&stage=scripts&scriptId=${item.scriptId}`}
              >
                打开实际剧本与导出
              </Link>
            )}
            {!requestedResultId &&
              item.isCurrent &&
              item.operation === "episode-script" && (
                <EpisodeScriptRevisionPanel result={item} />
              )}
            {item.operation === "episode-script" &&
              item.scriptId &&
              ((!requestedResultId && item.isCurrent) ||
                Boolean(params.get("sourceRevisionId"))) && (
                <EpisodeSourceRevisionPanel
                  key={`${item.id}:${item.version}:${params.get("sourceRevisionId") ?? ""}`}
                  result={item}
                />
              )}
            {item.operation === "episode-script" &&
              item.scriptId &&
              ((!requestedResultId && item.isCurrent) ||
                Boolean(params.get("topologyRevisionId"))) && (
                <EpisodeTopologyRevisionPanel
                  key={`${item.id}:${params.get("topologyRevisionId") ?? ""}`}
                  result={item}
                />
              )}
            {item.content.kind === "storyboard-package" && item.scriptId && (
              <Link
                className="text-link text-sm"
                to={`/adapt?projectId=${projectId}&stage=shots&scriptId=${item.scriptId}`}
              >
                打开实际场景与分镜
              </Link>
            )}
            {item.content.kind === "storyboard-package" && (
              <EpisodeImpactPanel
                key={`${item.projectId}:${item.episodeId}:${item.id}:${item.version}`}
                result={item}
              />
            )}
            {item.storyboardRedo?.sourceReview && (
              <StoryboardSourceReviewReceiptView
                value={item.storyboardRedo.sourceReview}
              />
            )}
            {item.content.kind === "storyboard-package" && (
              <StoryboardAttributionPanel
                key={`${item.projectId}:${item.id}:${item.version}:${params.getAll("shotAttributionId").join(":")}`}
                result={item}
              />
            )}
            {!requestedResultId &&
              item.content.kind === "storyboard-package" && (
                <Button
                  disabled={!item.isCurrent || item.sourceState !== "current"}
                  onClick={() =>
                    setPilotDialog({
                      storyboard: { id: item.id, version: item.version },
                    })
                  }
                >
                  预览内部试制包
                </Button>
              )}
          </article>
        ))}
      </div>
      {!requestedResultId && (
        <section className="space-y-2" aria-label="试制交付历史">
          <h3 className="font-semibold">试制交付历史</h3>
          <p className="text-xs text-muted">
            保存回执证明当时文件写入；来源失效后保留历史，不自动重导出或采用。
          </p>
          {pilotHistory.error && (
            <p role="alert" className="text-sm text-danger-strong">
              {message(pilotHistory.error)}
            </p>
          )}
          {pilotHistory.data?.map((item) => (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              key={item.id}
            >
              <span>
                {item.manifest.episodeTitle} ·{" "}
                {pilotPackageStatusLabel[item.status]} ·{" "}
                {item.sourceState === "current" ? "来源有效" : "来源已变化"}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPilotDialog({ previewId: item.id })}
              >
                打开交付记录
              </Button>
            </div>
          ))}
        </section>
      )}
      {!requestedResultId && pilotDialog && (
        <PilotPackageDialog
          key={pilotDialog.previewId ?? pilotDialog.storyboard?.id}
          projectId={projectId}
          episodeId={requestedEpisodeId ?? undefined}
          {...pilotDialog}
          onClose={() => setPilotDialog(undefined)}
          onUpdated={() => {
            void queries.invalidateQueries({
              queryKey: ["pilot-packages", projectId],
            });
          }}
        />
      )}
    </section>
  );
}
