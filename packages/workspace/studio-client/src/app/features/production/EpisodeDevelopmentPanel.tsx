import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { Link, useSearchParams } from "../../router";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
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
import styles from "./EpisodeDevelopmentPanel.module.css";
import { copyText } from "../../copy";

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
      aria-label={copyText("app/features/production/EpisodeDevelopmentPanel.1")}
      className={styles.c1}
    >
      <p className={styles.c2}>
        {verified?.some(
          (item) =>
            item.sceneId === scene.id && item.attribution === "human-declared",
        )
          ? "作者声明关联"
          : "模型声明关联"}
        {copyText("app/features/production/EpisodeDevelopmentPanel.2")}
      </p>
      {scene.sourceEvidence.map((evidence) => (
        <div key={evidence.id} className={styles.c3}>
          <p className={styles.c4}>
            {evidence.source.sourceKind} {evidence.source.sourceId}
            {copyText("app/features/production/EpisodeDevelopmentPanel.3")}
            {evidence.source.sourceVersion} · {evidence.source.fieldPath}
            {evidence.valuePath}
          </p>
          <blockquote className={styles.c5}>{evidence.quote}</blockquote>
          <p>
            {copyText("app/features/production/EpisodeDevelopmentPanel.4")}
            {evidence.rationale}
          </p>
          {verified
            ?.filter(
              (item) =>
                item.sceneId === scene.id && item.evidenceId === evidence.id,
            )
            .map((item) => (
              <details key={item.evidenceId}>
                <summary>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.5",
                  )}
                </summary>
                <p className={styles.c4}>
                  {item.paragraphId
                    ? `实际段落 ${item.paragraphId}`
                    : item.sourceBlockId
                      ? `原稿稳定块 ${item.sourceBlockId}`
                      : "实际表达字段；摘要不推断原文位置"}
                </p>
                {item.matches.map((match, index) => (
                  <p key={index}>
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.6",
                    )}
                    {match.start}, {match.end})
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
    <p className={styles.c6}>
      {copyText("app/features/production/EpisodeDevelopmentPanel.7")}
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
    <article
      aria-label={copyText("app/features/production/EpisodeDevelopmentPanel.8")}
      className={styles.c7}
    >
      <h3 className={styles.c8}>{output.title}</h3>
      <p className={styles.c9}>{output.content}</p>
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
            {copyText("app/features/production/EpisodeDevelopmentPanel.9")}
            {outline.data.goal}
            {copyText("app/features/production/EpisodeDevelopmentPanel.10")}
            {outline.data.mainConflict}
          </p>
          <p>
            {copyText("app/features/production/EpisodeDevelopmentPanel.11")}
            {outline.data.turningPoint}
            {copyText("app/features/production/EpisodeDevelopmentPanel.12")}
            {outline.data.endingHook}
          </p>
          {outline.data.scenes.map((scene) => (
            <section key={scene.id} className={styles.c10}>
              <h4 className={styles.c11}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.13")}
                {scene.orderIndex + 1} · {scene.location} · {scene.timeOfDay} ·{" "}
                {scene.durationSeconds}
                {copyText("app/features/production/EpisodeDevelopmentPanel.14")}
              </h4>
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.9")}
                {scene.goal}
                {copyText("app/features/production/EpisodeDevelopmentPanel.15")}
                {scene.conflict}
                {copyText("app/features/production/EpisodeDevelopmentPanel.16")}
                {scene.outcome}
              </p>
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.17")}
                {scene.characters.join("、")}
              </p>
              <SceneQuotes scene={scene} />
              {scene.beats.map((beat) => (
                <p key={beat.id}>
                  {beat.action}
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.18",
                  )}
                  {beat.causalLink}
                </p>
              ))}
              <p className={styles.c2}>
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
        <div className={styles.c12}>
          <p>
            {script.data.blocks.length}
            {copyText(
              "app/features/production/EpisodeDevelopmentPanel.19",
            )}{" "}
            {script.data.sceneLinks.length}
            {copyText("app/features/production/EpisodeDevelopmentPanel.20")}
          </p>
          <details className={styles.c13}>
            <summary>
              {copyText("app/features/production/EpisodeDevelopmentPanel.21")}
            </summary>
            {script.data.sceneLinks.map((scene, index) => (
              <p key={scene.sceneId} className={styles.c14}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.13")}
                {index + 1} · {scene.sceneId}：{scene.blockIds.join("、")}
              </p>
            ))}
          </details>
        </div>
      )}
      {storyboard.success && (
        <StoryboardContentView content={storyboard.data} />
      )}
      {patch.success && (
        <section
          aria-label={copyText(
            "app/features/production/EpisodeDevelopmentPanel.22",
          )}
          className={styles.c15}
        >
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
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.23",
              )}
              className={styles.c10}
            >
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.24")}
              </p>
              {workflow.recordMergeSource.comparison.units.map((unit) => {
                const side =
                  workflow.recordMergeSource!.request.choices[unit.id];
                const value = side === "main" ? unit.current : unit.candidate;
                return (
                  <p key={unit.id} className={styles.c16}>
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
            {copyText("app/features/production/EpisodeDevelopmentPanel.25")}
          </p>
          {(workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "confirmed-block-structure-fixed-shots-duration-assets-v1" ||
            workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
              "author-frozen-scene-shot-plan-v1") && (
            <div
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.26",
              )}
              className={styles.c17}
            >
              {workflow.episodeDevelopmentBasis.storyboardRedo.sceneMappings.map(
                (mapping) => (
                  <p key={mapping.sceneId}>
                    {mapping.sceneId}
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.27",
                    )}
                    {mapping.previousBlockIds.join("、")}
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.28",
                    )}
                    {mapping.currentBlockIds.join("、")}
                  </p>
                ),
              )}
            </div>
          )}
          {workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "author-frozen-scene-topology-plan-v1" && (
            <section
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.29",
              )}
              className={styles.c10}
            >
              <p className={styles.c4}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.30")}{" "}
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo
                    .previousOutline.id
                }{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.31")}
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo
                    .previousOutline.version
                }{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.32")}{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.outline.id}
                {copyText("app/features/production/EpisodeDevelopmentPanel.3")}
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo.outline
                    .version
                }{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.33")}{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.script.id}
                {copyText("app/features/production/EpisodeDevelopmentPanel.3")}
                {
                  workflow.episodeDevelopmentBasis.storyboardRedo.script.version
                }{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.34")}{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.topologySteps}{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.35")}
              </p>
              <StoryboardTopologyPlanView
                value={
                  workflow.episodeDevelopmentBasis.storyboardRedo.topologyPlan
                }
              />
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.36")}
              </p>
            </section>
          )}
          {workflow.episodeDevelopmentBasis?.storyboardRedo?.scope ===
            "author-frozen-scene-shot-plan-v1" && (
            <section
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.37",
              )}
              className={styles.c18}
            >
              {workflow.episodeDevelopmentBasis.storyboardRedo.scenePlans.map(
                (scene) => (
                  <div key={scene.sceneId}>
                    <p>
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.13",
                      )}
                      {scene.sceneId}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.38",
                      )}
                      {scene.recordId}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.3",
                      )}
                      {scene.version}
                    </p>
                    {scene.shots.map((shot) => (
                      <p key={shot.id}>
                        {shot.orderIndex + 1} · {shot.retains ? "复用" : "新增"}{" "}
                        {shot.id} · {shot.durationSeconds}
                        {copyText(
                          "app/features/production/EpisodeDevelopmentPanel.39",
                        )}{" "}
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
                {copyText("app/features/production/EpisodeDevelopmentPanel.40")}{" "}
                {workflow.episodeDevelopmentBasis.storyboardRedo.shots.length}{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.41")}
              </p>
            </section>
          )}
          {patch.data.shots.map((shot) => (
            <div key={shot.id} className={styles.c19}>
              <p className={styles.c11}>
                {shot.id} · {shot.durationSeconds}
                {copyText("app/features/production/EpisodeDevelopmentPanel.42")}
                {shot.visualAction}
              </p>
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.43")}
                {shot.composition}
                {copyText("app/features/production/EpisodeDevelopmentPanel.44")}
                {shot.camera}
                {copyText("app/features/production/EpisodeDevelopmentPanel.45")}
                {shot.movement}
              </p>
              <p>
                {copyText("app/features/production/EpisodeDevelopmentPanel.46")}
                {shot.sound}
              </p>
              <p className={styles.c16}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.47")}
                {shot.prompt}
              </p>
              <p className={styles.c16}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.48")}
                {shot.negativePrompt}
              </p>
              <p className={styles.c4}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.49")}
                {shot.sourceBlockIds.join("、")}
                {copyText("app/features/production/EpisodeDevelopmentPanel.50")}
                {shot.assetIds.join("、")}
              </p>
              {patch.data.subtitles
                .filter((item) => item.shotId === shot.id)
                .map((subtitle) => (
                  <p key={subtitle.id}>
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.51",
                    )}
                    {subtitle.startSeconds}–{subtitle.endSeconds}
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.42",
                    )}
                    {subtitle.text}
                  </p>
                ))}
            </div>
          ))}
          {patch.data.costRisks.map((risk, index) => (
            <p key={index}>
              {risk.severity} · {risk.reason}
              {copyText("app/features/production/EpisodeDevelopmentPanel.52")}
              {risk.mitigation} · {risk.shotIds.join("、")}
            </p>
          ))}
          <p className={styles.c2}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.53")}
          </p>
        </section>
      )}
      {!outline.success &&
        !script.success &&
        !storyboard.success &&
        !patch.success && (
          <p className={styles.c20}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.54")}
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
      <section
        aria-label={copyText(
          "app/features/production/EpisodeDevelopmentPanel.55",
        )}
      >
        <p role="alert">{navigationError}</p>
      </section>
    );
  return (
    <section
      aria-label={copyText(
        "app/features/production/EpisodeDevelopmentPanel.55",
      )}
      className={styles.c21}
    >
      {requestedResultId && (
        <section
          aria-label={copyText(
            "app/features/production/EpisodeDevelopmentPanel.56",
          )}
          className={styles.c22}
        >
          <h2 className={styles.c8}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.56")}
          </h2>
          <p className={styles.c6}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.57")}
          </p>
          {requestedResult.error ? (
            <p role="alert">{message(requestedResult.error)}</p>
          ) : requestedResult.isPending ||
            !requestedResult.isFetchedAfterMount ? (
            <p role="status">
              {copyText("app/features/production/EpisodeDevelopmentPanel.58")}
            </p>
          ) : !exactResult ? (
            <p role="alert">
              {copyText("app/features/production/EpisodeDevelopmentPanel.59")}
            </p>
          ) : (
            <p className={styles.c23}>
              {requestedResult.isFetching &&
                "正在重核来源，以下为上次实际读取的原快照 · "}
              {operationLabel[exactResult.operation]}
              {copyText("app/features/production/EpisodeDevelopmentPanel.3")}
              {exactResult.version} ·{" "}
              {exactResult.sourceState === "current"
                ? "来源有效"
                : "来源已变化，保留原正式快照"}
            </p>
          )}
          <Link
            className={styles.c24}
            to={`/projects/${encodeURIComponent(projectId)}/tools/episode-development`}
          >
            {copyText("app/features/production/EpisodeDevelopmentPanel.60")}
          </Link>
        </section>
      )}
      {!requestedResultId && (
        <div className={styles.c25}>
          {requestedWorkflowId && !exactWorkflow && !linkedWorkflow.error && (
            <p role="status">
              {copyText("app/features/production/EpisodeDevelopmentPanel.61")}
            </p>
          )}
          <h2 className={styles.c8}>
            {direct
              ? "从作者创意或已有剧本独立开发单集"
              : "从已采用季纲开发单集"}
          </h2>
          <p className={styles.c6}>
            {direct
              ? "先确认实际作者简报或原剧本及本集时长，再审阅采用单集大纲和标准剧本。没有小说、诊断或季纲；不补造这些成果，原稿保留不覆盖。冻结正式作者意图、实际来源与已批准"
              : "先审阅采用单集大纲，再生成标准剧本。冻结当前季纲、唯一策略、作者意图、已批准"}
            {copyText("app/features/production/EpisodeDevelopmentPanel.62")}
            {direct
              ? "；下游精确继承已采用大纲的来源和时长。"
              : "与已确认的实际叙事表达；新采用保留旧结果，不覆盖作者新稿。"}
            {copyText("app/features/production/EpisodeDevelopmentPanel.63")}
          </p>
          <p className={styles.c23}>
            {direct ? (
              `实际项目简报 v${direct.project.version} · 正式作者意图：${direct.authorIntent ? `v${direct.authorIntent.version}` : "尚未采用或来源失效"}`
            ) : (
              <>
                {copyText("app/features/production/EpisodeDevelopmentPanel.64")}
                {catalog.data?.seasonPlan
                  ? `v${catalog.data.seasonPlan.version}`
                  : "尚无来源有效的正式季纲"}
              </>
            )}{" "}
            {copyText("app/features/production/EpisodeDevelopmentPanel.65")}
            {catalog.data?.storyBibleCount ?? "尚未核对"}{" "}
            {copyText("app/features/production/EpisodeDevelopmentPanel.66")}
          </p>
          <Link
            className={styles.c26}
            to={`/projects/${projectId}/tools/${direct ? "author-intent" : "season-plan"}`}
          >
            {direct ? "核对正式作者意图" : "核对整季方案"}
          </Link>
          <label className={styles.c27}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.67")}
            <NativeSelect
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.67",
              )}
              className={styles.c28}
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
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.68",
                  )}
                  {item.orderIndex + 1}
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.69",
                  )}
                  {item.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          {direct && operation === "episode-outline" && (
            <div className={styles.c29}>
              <label>
                {copyText("app/features/production/EpisodeDevelopmentPanel.70")}
                <NativeSelect
                  aria-label={copyText(
                    "app/features/production/EpisodeDevelopmentPanel.70",
                  )}
                  className={styles.c28}
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
                      {item.title}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.71",
                      )}
                      {item.version}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.72",
                      )}{" "}
                      {item.documentVersion === null
                        ? "未创建"
                        : `v${item.documentVersion}`}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                {copyText("app/features/production/EpisodeDevelopmentPanel.73")}
                <input
                  aria-label={copyText(
                    "app/features/production/EpisodeDevelopmentPanel.73",
                  )}
                  className={styles.c30}
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
              <p className={styles.c6}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.74")}
                {sourceChoice.sourceScript
                  ? `原稿 ${sourceChoice.sourceScript.id} v${sourceChoice.sourceScript.version} · 文档 ${sourceChoice.sourceScript.documentVersion === null ? "未创建" : `v${sourceChoice.sourceScript.documentVersion}`}`
                  : "仅使用当前作者简报（已有剧本路径仍须选择原稿）"}
                {copyText("app/features/production/EpisodeDevelopmentPanel.75")}
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
            <section
              aria-label={copyText(
                "app/features/production/EpisodeDevelopmentPanel.76",
              )}
              className={styles.c31}
            >
              {operation === "episode-outline" && (
                <label className={styles.c27}>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.77",
                  )}
                  <NativeSelect
                    aria-label={copyText(
                      "app/features/production/EpisodeDevelopmentPanel.77",
                    )}
                    className={styles.c32}
                    value={narrativeMode}
                    onChange={(event) => {
                      setNarrativeMode(
                        event.target.value as "season" | "episode",
                      );
                      setConfirmed(undefined);
                    }}
                  >
                    <option value="season">
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.78",
                      )}
                    </option>
                    <option value="episode">
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.79",
                      )}
                    </option>
                  </NativeSelect>
                </label>
              )}
              <p className={styles.c23}>
                {copyText("app/features/production/EpisodeDevelopmentPanel.80")}{" "}
                {catalog.data.episodes.find(
                  (item) => item.id === currentEpisodeId,
                )?.sourceChapters.length ?? 0}{" "}
                {copyText("app/features/production/EpisodeDevelopmentPanel.81")}
              </p>
              {operation === "episode-outline" &&
              narrativeMode === "episode" ? (
                <>
                  {narrativeChapters.error && (
                    <p role="alert">
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.82",
                      )}
                      {message(narrativeChapters.error)}
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
                  <p className={styles.c23}>
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.83",
                    )}{" "}
                    {catalog.data.narrativeSources.chapters.length}{" "}
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.84",
                    )}
                  </p>
                  <NarrativeSourceCoverage
                    basis={catalog.data.narrativeSources.basis}
                    chapters={catalog.data.narrativeSources.chapters}
                    label="单集继承的整季实际输入"
                  />
                </>
              ) : (
                <p className={styles.c6}>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.85",
                  )}
                </p>
              )}
            </section>
          )}
          {operation === "storyboard-package" &&
            storyboard?.content.kind === "storyboard-package" && (
              <section
                aria-label={copyText(
                  "app/features/production/EpisodeDevelopmentPanel.86",
                )}
                className={styles.c1}
              >
                <h3 className={styles.c11}>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.87",
                  )}
                </h3>
                <p>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.88",
                  )}
                </p>
                <label className={styles.c33}>
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
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.89",
                    )}
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
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.90",
                  )}
                </Button>
                <label className={styles.c33}>
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
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.91",
                    )}
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
                    <div key={scene.sceneId} className={styles.c3}>
                      <p>
                        {copyText(
                          "app/features/production/EpisodeDevelopmentPanel.13",
                        )}
                        {index + 1} · {scene.sceneId}
                      </p>
                      {scene.shots.map((shot) => (
                        <label key={shot.id} className={styles.c33}>
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
                            {copyText(
                              "app/features/production/EpisodeDevelopmentPanel.92",
                            )}
                            {shot.id} · {shot.visualAction} ·{" "}
                            {shot.durationSeconds}
                            {copyText(
                              "app/features/production/EpisodeDevelopmentPanel.14",
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))
                )}
                <p>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.93",
                  )}
                  {selectedRedo.length}{" "}
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.94",
                  )}
                </p>
                <label className={styles.c33}>
                  <input
                    type="checkbox"
                    aria-label={copyText(
                      "app/features/production/EpisodeDevelopmentPanel.95",
                    )}
                    checked={reviewEnabled}
                    onChange={(event) => {
                      invalidateSourceReview();
                      setReviewEnabled(event.target.checked);
                    }}
                  />
                  <span>
                    {copyText(
                      "app/features/production/EpisodeDevelopmentPanel.96",
                    )}
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
                    aria-label={copyText(
                      "app/features/production/EpisodeDevelopmentPanel.97",
                    )}
                    className={styles.c10}
                  >
                    <p className={styles.c4}>
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.98",
                      )}{" "}
                      {sourceReviewRecovery.request.baseStoryboardId}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.99",
                      )}{" "}
                      {
                        sourceReviewRecovery.request.redoSourceReview
                          ?.attribution.id
                      }{" "}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.100",
                      )}{" "}
                      {
                        sourceReviewRecovery.request.redoSourceReview
                          ?.impactHash
                      }
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.101",
                      )}
                    </p>
                    <Button
                      variant="secondary"
                      onClick={restoreOriginalSourceReview}
                    >
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.102",
                      )}
                    </Button>
                    {originalReviewRestored && (
                      <p role="status">
                        {copyText(
                          "app/features/production/EpisodeDevelopmentPanel.103",
                        )}
                      </p>
                    )}
                  </section>
                )}
              </section>
            )}
          <div className={styles.c34}>
            <Button
              variant={operation === "episode-outline" ? "secondary" : "ghost"}
              onClick={() => setOperation("episode-outline")}
            >
              {copyText("app/features/production/EpisodeDevelopmentPanel.104")}
            </Button>
            <Button
              variant={operation === "episode-script" ? "secondary" : "ghost"}
              onClick={() => setOperation("episode-script")}
            >
              {copyText("app/features/production/EpisodeDevelopmentPanel.105")}
            </Button>
            <Button
              variant={
                operation === "storyboard-package" ? "secondary" : "ghost"
              }
              onClick={() => setOperation("storyboard-package")}
            >
              {copyText("app/features/production/EpisodeDevelopmentPanel.106")}
            </Button>
            <Button
              disabled={
                !(direct
                  ? direct.authorIntent && currentEpisodeId
                  : catalog.data?.seasonPlan) || !catalog.data?.storyBibleCount
              }
              onClick={() => void confirmBasis()}
            >
              {copyText("app/features/production/EpisodeDevelopmentPanel.107")}
            </Button>
          </div>
          {confirmed && (
            <p className={styles.c6}>
              {confirmed.request.direct
                ? `已确认直写简报 v${confirmed.request.direct.project.version} · ${confirmed.request.direct.durationSeconds} 秒${confirmed.request.direct.sourceScript ? ` · 原稿 v${confirmed.request.direct.sourceScript.version}` : ""}`
                : `已确认季纲 v${confirmed.request.seasonPlan!.version}`}{" "}
              {copyText("app/features/production/EpisodeDevelopmentPanel.108")}
              {confirmed.request.episodeId}
              {copyText("app/features/production/EpisodeDevelopmentPanel.109")}
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
            <p role="alert" className={styles.c35}>
              {error ??
                message(catalog.error ?? history.error ?? linkedWorkflow.error)}
            </p>
          )}
        </div>
      )}
      {!requestedResultId && catalog.data?.storyBibleCount === 0 && (
        <div className={styles.c15}>
          <p className={styles.c6}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.110")}
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
      <div className={styles.c15}>
        <h3 className={styles.c8}>
          {copyText("app/features/production/EpisodeDevelopmentPanel.111")}
        </h3>
        {!requestedResultId && (
          <p className={styles.c23}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.112")}
            {outline
              ? `v${outline.version} · ${outline.sourceState === "current" ? "来源有效" : "来源已变化"}`
              : "尚未采用"}{" "}
            {copyText("app/features/production/EpisodeDevelopmentPanel.113")}
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
            className={styles.c22}
            aria-label={copyText(
              "app/features/production/EpisodeDevelopmentPanel.125",
              { p1: operationLabel[item.operation], p2: item.version },
            )}
          >
            <h4 className={styles.c8}>
              {operationLabel[item.operation]}
              {copyText("app/features/production/EpisodeDevelopmentPanel.3")}
              {item.version} · {item.isCurrent ? "当前采用" : "历史采用"}
            </h4>
            {(item.origin === "human-script-revision" ||
              item.origin === "human-topology-revision" ||
              item.origin === "human-source-revision") && (
              <p className={styles.c6}>
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.114",
                )}
              </p>
            )}
            {item.basis.sourceBasis && item.basis.contextChapters && (
              <>
                <p className={styles.c23}>
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.115",
                  )}
                  {item.basis.chapters.length}
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.116",
                  )}{" "}
                  {item.basis.contextChapters.length}
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.117",
                  )}
                </p>
                <NarrativeSourceCoverage
                  basis={item.basis.sourceBasis}
                  chapters={item.basis.contextChapters}
                  label="正式单集冻结实际表达"
                />
              </>
            )}
            {item.staleReasons.map((reason) => (
              <p className={styles.c35} key={reason}>
                {reason}
              </p>
            ))}
            {item.content.kind === "episode-outline" ? (
              <>
                <p className={styles.c23}>{item.content.value.logline}</p>
                {item.content.value.scenes.map((scene) => (
                  <details key={scene.id}>
                    <summary>
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.13",
                      )}
                      {scene.orderIndex + 1} · {scene.location} ·{" "}
                      {scene.durationSeconds}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.14",
                      )}
                    </summary>
                    <p className={styles.c23}>
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.9",
                      )}
                      {scene.goal}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.15",
                      )}
                      {scene.conflict}
                      {copyText(
                        "app/features/production/EpisodeDevelopmentPanel.16",
                      )}
                      {scene.outcome}
                    </p>
                    {scene.beats.map((beat) => (
                      <p className={styles.c23} key={beat.id}>
                        {beat.action}
                        {copyText(
                          "app/features/production/EpisodeDevelopmentPanel.18",
                        )}
                        {beat.causalLink}
                      </p>
                    ))}
                    <SceneQuotes scene={scene} verified={item.sourceEvidence} />
                  </details>
                ))}
              </>
            ) : item.content.kind === "storyboard-package" ? (
              <StoryboardContentView content={item.content.value} />
            ) : (
              <p className={styles.c23}>
                {item.content.value.blocks.length}
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.19",
                )}{" "}
                {item.content.value.sceneLinks.length}
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.118",
                )}
              </p>
            )}
            {item.scriptId && (
              <Link
                className={styles.c26}
                to={`/adapt?projectId=${projectId}&stage=scripts&scriptId=${item.scriptId}`}
              >
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.119",
                )}
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
                className={styles.c26}
                to={`/adapt?projectId=${projectId}&stage=shots&scriptId=${item.scriptId}`}
              >
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.120",
                )}
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
                  {copyText(
                    "app/features/production/EpisodeDevelopmentPanel.121",
                  )}
                </Button>
              )}
          </article>
        ))}
      </div>
      {!requestedResultId && (
        <section
          className={styles.c31}
          aria-label={copyText(
            "app/features/production/EpisodeDevelopmentPanel.122",
          )}
        >
          <h3 className={styles.c8}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.122")}
          </h3>
          <p className={styles.c36}>
            {copyText("app/features/production/EpisodeDevelopmentPanel.123")}
          </p>
          {pilotHistory.error && (
            <p role="alert" className={styles.c35}>
              {message(pilotHistory.error)}
            </p>
          )}
          {pilotHistory.data?.map((item) => (
            <div className={styles.c37} key={item.id}>
              <span>
                {item.manifest.episodeTitle} ·{" "}
                {pilotPackageStatusLabel[item.status]} ·{" "}
                {item.sourceState === "current" ? "来源有效" : "来源已变化"}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPilotDialog({ previewId: item.id })}
              >
                {copyText(
                  "app/features/production/EpisodeDevelopmentPanel.124",
                )}
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
