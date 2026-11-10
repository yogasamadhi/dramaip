import { CreationRecordWorkbench } from "../creation-workbench";
import { configuredEstimateLabel } from "../../generation-cost";
import { MediaSourceReviewPanel } from "./MediaSourceReviewPanel";
import { AudioRevisionPanel } from "./AudioRevisionPanel";
import { AudioResolutionPanel } from "./AudioResolutionPanel";
import { AssetMediaPreview } from "./AssetMediaPreview";
import { AssetDeclarationStatus } from "./AssetDeclarationStatus";
import { TimelinePlaybackPanel } from "./TimelinePlaybackPanel";
import { TimelineRenderPanel } from "./TimelineRenderPanel";
import { NleMediaVerificationPanel } from "./NleMediaVerificationPanel";
import type { TimelinePreviewControls } from "../../timeline-preview";
import type {
  AnimaticInitialization,
  AssetCenterAsset,
  AudioTrack,
  DomainEntity,
  TimelineDeliveryExportFormat,
  TimelineEditCommand,
  TimelineManifest,
  VideoGenerationInput,
  VideoGenerationPreflight,
} from "@dramaip/contracts/product";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { useMutation, useQuery, useQueryClient } from "../../query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "../../router";
import {
  buildStoryboard,
  reorderStoryboardShots,
  type StoryboardScene,
  type StoryboardShot,
} from "../../storyboard-board";
import {
  StageNavigation,
  type WorkspaceStageItem,
  domainLabel,
  message,
  productStatusLabel,
  useStudio,
} from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import { PluginResourceWorkspace, recordPayload } from "../studio-widgets";
import {
  ProductionContextBoundary,
  WorkspaceObjectControls,
} from "../ProductionContextBoundary";
import {
  productionReferenceKey,
  withExactProductionRecord,
  type ProductionObjectContext,
} from "../../production-object-context";
import styles from "./impl.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";
/**
 * The production workbench. The media client's page frame (P5-b) renders its
 * heading and lays this out in its `media.produce` slot.
 */
export function ProductionWorkspace() {
  const location = useLocation();
  return (
    <ProductionContextBoundary>
      {(projectId, context) => (
        <ProductionWorkspaceInstance
          key={JSON.stringify([
            projectId,
            productionReferenceKey(location.search),
          ])}
          projectId={projectId}
          context={context}
        />
      )}
    </ProductionContextBoundary>
  );
}
function ProductionWorkspaceInstance(props: {
  projectId: string;
  context: ProductionObjectContext;
}) {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useStudioSession();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const projectId = props.projectId;
  const [selectedAdaptationId, setAdaptationId] = useState("");
  const [selectedEpisodeId, setEpisodeId] = useState("");
  const [selectedScriptId, setScriptId] = useState("");
  const [selectedSceneId, setSceneId] = useState("");
  const [selectedShotId, setShotId] = useState("");
  const adaptationId = props.context.adaptationId?.id ?? selectedAdaptationId;
  const episodeId = props.context.episodeId?.id ?? selectedEpisodeId;
  const scriptId = props.context.scriptId?.id ?? selectedScriptId;
  const sceneId = props.context.sceneId?.id ?? selectedSceneId;
  const shotId = props.context.shotId?.id ?? selectedShotId;
  const [stage, setStage] = useState<
    | "assets"
    | "asset-center"
    | "storyboard"
    | "rights"
    | "visual-assets"
    | "shot-stills"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "timeline"
    | "renders"
  >("assets");
  const { data: listedAdaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: listedEpisodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  const { data: listedScripts = [] } = useQuery({
    queryKey: ["resource", "scripts", projectId, episodeId],
    queryFn: () => client.resources.list("scripts", projectId, episodeId),
    enabled: Boolean(projectId && episodeId),
  });
  const { data: listedScenes = [] } = useQuery({
    queryKey: ["resource", "scenes", projectId, scriptId],
    queryFn: () => client.resources.list("scenes", projectId, scriptId),
    enabled: Boolean(projectId && scriptId),
  });
  const { data: listedShots = [] } = useQuery({
    queryKey: ["resource", "shots", projectId, sceneId],
    queryFn: () => client.resources.list("shots", projectId, sceneId),
    enabled: Boolean(projectId && sceneId),
  });
  const adaptations = withExactProductionRecord(
    listedAdaptations,
    props.context.adaptationId,
  );
  const episodes = withExactProductionRecord(
    listedEpisodes,
    props.context.episodeId,
  );
  const scripts = withExactProductionRecord(
    listedScripts,
    props.context.scriptId,
  );
  const scenes = withExactProductionRecord(listedScenes, props.context.sceneId);
  const shots = withExactProductionRecord(listedShots, props.context.shotId);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("stage");
    if (
      requested &&
      [
        "assets",
        "asset-center",
        "storyboard",
        "rights",
        "visual-assets",
        "shot-stills",
        "image",
        "audio",
        "video",
        "animatics",
        "timeline",
        "renders",
      ].includes(requested)
    )
      setStage(requested as typeof stage);
  }, [location.search]);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    if (adaptationId || !adaptations.length) return;
    const current = projects.find(
      (project) => project.id === projectId,
    )?.currentAdaptationId;
    setAdaptationId(
      adaptations.some((item) => item.id === current)
        ? current!
        : adaptations[0]!.id,
    );
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
  }, [episodeId, episodes]);
  useEffect(() => {
    if (!episodeId && episodes[0]) setEpisodeId(episodes[0].id);
  }, [episodeId, episodes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("episodeId");
    if (requested && episodes.some((item) => item.id === requested))
      setEpisodeId(requested);
  }, [episodes, location.search]);
  useEffect(() => {
    if (scriptId && !scripts.some((item) => item.id === scriptId))
      setScriptId("");
  }, [scriptId, scripts]);
  useEffect(() => {
    if (!scriptId && scripts[0]) setScriptId(scripts[0].id);
  }, [scriptId, scripts]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("scriptId");
    if (requested && scripts.some((item) => item.id === requested))
      setScriptId(requested);
  }, [location.search, scripts]);
  useEffect(() => {
    if (sceneId && !scenes.some((item) => item.id === sceneId)) setSceneId("");
  }, [sceneId, scenes]);
  useEffect(() => {
    if (!sceneId && scenes[0]) setSceneId(scenes[0].id);
  }, [sceneId, scenes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("sceneId");
    if (requested && scenes.some((item) => item.id === requested))
      setSceneId(requested);
  }, [location.search, scenes]);
  useEffect(() => {
    if (shotId && shots.length && !shots.some((item) => item.id === shotId))
      setShotId("");
  }, [shotId, shots]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("shotId");
    if (requested && shots.some((item) => item.id === requested))
      setShotId(requested);
  }, [location.search, shots]);
  const parentId =
    stage === "audio" ||
    stage === "animatics" ||
    stage === "timeline" ||
    stage === "renders"
      ? episodeId
      : stage === "video" || stage === "shot-stills" || stage === "image"
        ? shotId
        : undefined;
  const parentRequired =
    stage === "audio" ||
    stage === "animatics" ||
    stage === "timeline" ||
    stage === "renders" ||
    stage === "video" ||
    stage === "shot-stills" ||
    stage === "image";
  const requestedStage = new URLSearchParams(location.search).get("stage");
  const mediaStageIds = [
    "assets",
    "asset-center",
    "storyboard",
    "rights",
    "visual-assets",
    "shot-stills",
    "image",
    "audio",
    "video",
    "animatics",
    "timeline",
    "renders",
  ] as const;
  const recommendedStage =
    requestedStage &&
    mediaStageIds.includes(requestedStage as (typeof mediaStageIds)[number])
      ? requestedStage
      : shots.length
        ? "storyboard"
        : "assets";
  useEffect(() => {
    if (!requestedStage && shots.length && stage === "assets")
      setStage("storyboard");
  }, [requestedStage, shots.length, stage]);
  const stageItems: WorkspaceStageItem[] = mediaStageIds.map((id) => {
    const needsShot = ["shot-stills", "image", "video"].includes(id);
    const needsEpisode = ["audio", "animatics", "timeline", "renders"].includes(
      id,
    );
    const available = Boolean(
      projectId && (!needsShot || shotId) && (!needsEpisode || episodeId),
    );
    return {
      id,
      label: domainLabel(id),
      availability: available ? "available" : "blocked",
      recommended: recommendedStage === id,
      reason: !projectId
        ? "请先创建或选择一个项目。"
        : needsShot
          ? "当前能力归属具体分镜，请先在改编工作区创建并选择分镜。"
          : needsEpisode
            ? "当前能力归属具体分集，请先在改编工作区创建并选择分集。"
            : undefined,
      recoveryLabel: !projectId ? "返回项目工作台" : "去改编工作区补齐",
      recoveryTarget: !projectId
        ? "/"
        : `/adapt?${new URLSearchParams({
            projectId,
            stage: needsShot ? "shots" : "episodes",
          })}`,
    };
  });
  const stageGroups = [
    {
      id: "director",
      label: "分镜与资产",
      stages: ["storyboard", "asset-center"],
    },
    {
      id: "assets",
      label: "素材与角色",
      stages: ["assets", "rights", "visual-assets", "shot-stills"],
    },
    {
      id: "media",
      label: "音视频",
      stages: ["image", "audio", "video"],
    },
    {
      id: "output",
      label: "时间线与输出",
      stages: ["animatics", "timeline", "renders"],
    },
  ] as const;
  const activeStageGroup =
    stageGroups.find((group) => group.stages.includes(stage as never)) ??
    stageGroups[1];
  const resetChain = () => {
    setAdaptationId("");
    setEpisodeId("");
    setScriptId("");
    setSceneId("");
    setShotId("");
  };
  const syncRoute = (next: {
    projectId?: string;
    stage?: typeof stage;
    adaptationId?: string;
    episodeId?: string;
    scriptId?: string;
    sceneId?: string;
    shotId?: string;
  }) => {
    const search = new URLSearchParams();
    const values = {
      projectId,
      stage,
      adaptationId,
      episodeId,
      scriptId,
      sceneId,
      shotId,
      ...next,
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    navigate(`/produce?${search}`);
  };
  const selectStoryboardShot = (
    nextShotId: string,
    nextSceneId: string,
    nextScriptId: string,
    nextStage: "storyboard" | "asset-center" = "storyboard",
  ) => {
    setScriptId(nextScriptId);
    setSceneId(nextSceneId);
    setShotId(nextShotId);
    setStage(nextStage);
    const search = new URLSearchParams({
      projectId,
      adaptationId,
      episodeId,
      scriptId: nextScriptId,
      sceneId: nextSceneId,
      shotId: nextShotId,
      stage: nextStage,
    });
    navigate(`/produce?${search}`);
  };
  return (
    <section className={styles.c1}>
      <div className={styles.c2}>
        <WorkspaceObjectControls
          projectTitle={
            projects.find((project) => project.id === projectId)?.title
          }
          objectTitles={[
            episodes.find((record) => record.id === episodeId)?.title,
            scripts.find((record) => record.id === scriptId)?.title,
            shots.find((record) => record.id === shotId)?.title,
          ].filter((title): title is string => Boolean(title))}
        >
          <section className={styles.c3}>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.1")}
              <NativeSelect
                value={projectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  if (nextProjectId) session.selectProject(nextProjectId);
                  resetChain();
                  syncRoute({
                    projectId: nextProjectId,
                    adaptationId: "",
                    episodeId: "",
                    scriptId: "",
                    sceneId: "",
                    shotId: "",
                  });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.2")}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.3")}
              <NativeSelect
                disabled={!projectId}
                value={adaptationId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setAdaptationId(nextId);
                  setEpisodeId("");
                  setScriptId("");
                  setSceneId("");
                  setShotId("");
                  syncRoute({
                    adaptationId: nextId,
                    episodeId: "",
                    scriptId: "",
                    sceneId: "",
                    shotId: "",
                  });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.4")}
                </option>
                {adaptations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.5")}
              <NativeSelect
                disabled={!adaptationId}
                value={episodeId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setEpisodeId(nextId);
                  setScriptId("");
                  setSceneId("");
                  setShotId("");
                  syncRoute({
                    episodeId: nextId,
                    scriptId: "",
                    sceneId: "",
                    shotId: "",
                  });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.6")}
                </option>
                {episodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.7")}
              <NativeSelect
                disabled={!episodeId}
                value={scriptId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setScriptId(nextId);
                  setSceneId("");
                  setShotId("");
                  syncRoute({ scriptId: nextId, sceneId: "", shotId: "" });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.8")}
                </option>
                {scripts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.9")}
              <NativeSelect
                disabled={!scriptId}
                value={sceneId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSceneId(nextId);
                  setShotId("");
                  syncRoute({ sceneId: nextId, shotId: "" });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.10")}
                </option>
                {scenes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c4}>
              {copyText("app/features/media/impl.11")}
              <NativeSelect
                disabled={!sceneId}
                value={shotId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setShotId(nextId);
                  syncRoute({ shotId: nextId });
                }}
              >
                <option value="">
                  {copyText("app/features/media/impl.12")}
                </option>
                {shots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </section>
        </WorkspaceObjectControls>
        <div className={styles.c5}>
          <nav
            aria-label={copyText("app/features/media/impl.13")}
            className={styles.c6}
          >
            {stageGroups.map((group) => (
              <BareButton
                key={group.id}
                className={clsx(
                  styles.c7,
                  activeStageGroup.id === group.id ? styles.k1 : styles.k2,
                )}
                onClick={() => {
                  const nextStage = group.stages[0] as typeof stage;
                  setStage(nextStage);
                  syncRoute({ stage: nextStage });
                }}
              >
                {group.label}
              </BareButton>
            ))}
          </nav>
          <StageNavigation
            label={`${activeStageGroup.label}功能`}
            items={stageItems.filter((item) =>
              activeStageGroup.stages.includes(item.id as never),
            )}
            active={stage}
            onChange={(value) => {
              const nextStage = value as typeof stage;
              setStage(nextStage);
              syncRoute({ stage: nextStage });
            }}
          />
        </div>
        {projectId ? (
          <details className={styles.c8}>
            <summary className={styles.c9}>
              {copyText("app/features/media/impl.14")}
            </summary>
            <div className={styles.c10}>
              <ProductionGraphPanel projectId={projectId} />
            </div>
          </details>
        ) : null}
        {!projectId ? (
          <p className={styles.c11}>{copyText("app/features/media/impl.15")}</p>
        ) : stage === "asset-center" ? (
          <AssetCenterPanel
            projectId={projectId}
            selectedShotId={shotId}
            onOpenCatalog={() => setStage("visual-assets")}
          />
        ) : stage === "storyboard" ? (
          <StoryboardBoard
            projectId={projectId}
            episodeId={episodeId}
            selectedShotId={shotId}
            onSelectShot={(shotId, sceneId, scriptId) =>
              selectStoryboardShot(shotId, sceneId, scriptId)
            }
            onOpenAssetCenter={(shotId, sceneId, scriptId) =>
              selectStoryboardShot(shotId, sceneId, scriptId, "asset-center")
            }
          />
        ) : stage === "audio" && episodeId ? (
          <AudioProductionPanel
            projectId={projectId}
            episodeId={episodeId}
            shotId={shotId}
          />
        ) : stage === "image" && shotId ? (
          <ImageGenerationPanel projectId={projectId} shotId={shotId} />
        ) : stage === "video" && shotId ? (
          <VideoGenerationPanel
            projectId={projectId}
            episodeId={episodeId}
            shotId={shotId}
          />
        ) : stage === "animatics" && episodeId ? (
          <AnimaticProductionPanel
            projectId={projectId}
            episodeId={episodeId}
          />
        ) : stage === "timeline" && episodeId && adaptationId ? (
          <TimelineEditorPanel
            projectId={projectId}
            adaptationId={adaptationId}
            episodeId={episodeId}
          />
        ) : stage === "renders" && episodeId ? (
          <div className={styles.c12}>
            <TimelineRenderPanel projectId={projectId} episodeId={episodeId} />
            <EpisodeRenderPreflightPanel episodeId={episodeId} />
          </div>
        ) : [
            "assets",
            "rights",
            "visual-assets",
            "shot-stills",
            "image",
            "audio",
            "video",
            "renders",
          ].includes(stage) ? (
          <PluginResourceWorkspace
            owner="media"
            title={copyText("app/features/media/impl.16")}
            domains={[stage]}
            projectId={projectId}
            parentId={parentId}
            parentRequired={parentRequired}
          />
        ) : (
          <p className={styles.c11}>{copyText("app/features/media/impl.17")}</p>
        )}
      </div>
    </section>
  );
}

export type StoryboardUndo = {
  sceneId: string;
  previousIds: string[];
  currentRecords: DomainEntity[];
};

export function stillStateLabel(state: StoryboardShot["stillState"]): string {
  if (state === "adopted") return "静帧已采用";
  if (state === "candidate") return "存在待确认静帧";
  return "暂无静帧预览";
}

export function StoryboardBoard(props: {
  projectId: string;
  episodeId: string;
  selectedShotId?: string;
  onSelectShot(shotId: string, sceneId: string, scriptId: string): void;
  onOpenAssetCenter(shotId: string, sceneId: string, scriptId: string): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "missing-assets">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visiblePerScene, setVisiblePerScene] = useState(50);
  const [draggingId, setDraggingId] = useState<string>();
  const [savingSceneId, setSavingSceneId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [undo, setUndo] = useState<StoryboardUndo>();
  const { data: scripts = [] } = useQuery({
    queryKey: ["storyboard", "scripts", props.projectId],
    queryFn: () => client.resources.list("scripts", props.projectId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["storyboard", "scenes", props.projectId],
    queryFn: () => client.resources.list("scenes", props.projectId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["storyboard", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const { data: stills = [] } = useQuery({
    queryKey: ["storyboard", "stills", props.projectId],
    queryFn: () => client.resources.list("shot-stills", props.projectId),
  });
  const { data: assetCenter } = useQuery({
    queryKey: ["asset-center", props.projectId],
    queryFn: () => client.assetCenter.get(props.projectId),
  });
  const storyboard = buildStoryboard({
    episodeId: props.episodeId || undefined,
    scripts,
    scenes,
    shots,
    stills,
    assets: assetCenter?.assets ?? [],
  });
  const matchesFilter = (shot: StoryboardShot) => {
    const haystack = [
      shot.title,
      shot.visualDescription,
      shot.dialogue,
      ...shot.referencedAssets.map((asset) => asset.title),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLocaleLowerCase()))
      return false;
    if (filter === "attention")
      return (
        shot.rightsBlocked || shot.costRisk || shot.stillState !== "adopted"
      );
    return filter !== "missing-assets" || shot.missingAssetReference;
  };
  const visibleScenes = storyboard
    .map((scene) => ({
      ...scene,
      shots: scene.shots.filter(matchesFilter),
    }))
    .filter((scene) => scene.shots.length);
  const toggleSelected = (shotId: string) =>
    setSelectedIds((current) =>
      current.includes(shotId)
        ? current.filter((id) => id !== shotId)
        : [...current, shotId],
    );
  const refreshShots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["storyboard", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["asset-center", props.projectId],
      }),
    ]);
  };
  const reorder = async (
    scene: StoryboardScene,
    movingId: string,
    targetId: string,
  ) => {
    const next = reorderStoryboardShots(scene.shots, movingId, targetId);
    if (next.every((shot, index) => shot.id === scene.shots[index]?.id)) return;
    setSavingSceneId(scene.id);
    setNotice(undefined);
    try {
      const result = await client.productionStructure.reorderShots(scene.id, {
        items: next.map((shot) => ({ id: shot.id, version: shot.version })),
      });
      setUndo({
        sceneId: scene.id,
        previousIds: scene.shots.map((shot) => shot.id),
        currentRecords: result.records,
      });
      setNotice("已保存分镜顺序；可在下一次调整前撤销这次重排。");
      await refreshShots();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingSceneId(undefined);
      setDraggingId(undefined);
    }
  };
  const move = (scene: StoryboardScene, shotId: string, direction: -1 | 1) => {
    const index = scene.shots.findIndex((shot) => shot.id === shotId);
    const target = scene.shots[index + direction];
    if (target) void reorder(scene, shotId, target.id);
  };
  const undoReorder = async () => {
    if (!undo) return;
    const recordsById = new Map(
      undo.currentRecords.map((record) => [record.id, record]),
    );
    const items = undo.previousIds
      .map((id) => recordsById.get(id))
      .filter((record): record is DomainEntity => Boolean(record))
      .map((record) => ({ id: record.id, version: record.version }));
    if (items.length !== undo.previousIds.length) {
      setNotice("无法恢复：镜头集合已变化，请刷新后检查当前顺序。");
      setUndo(undefined);
      return;
    }
    setSavingSceneId(undo.sceneId);
    try {
      await client.productionStructure.reorderShots(undo.sceneId, { items });
      setNotice("已恢复上一次分镜顺序。");
      setUndo(undefined);
      await refreshShots();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingSceneId(undefined);
    }
  };
  const selectedShot = storyboard
    .flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })))
    .find(({ shot }) => selectedIds.length === 1 && shot.id === selectedIds[0]);
  const contextShot = storyboard
    .flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })))
    .find(({ shot }) => shot.id === props.selectedShotId);
  return (
    <section
      className={styles.c1}
      aria-label={copyText("app/features/media/impl.18")}
    >
      <div className={styles.c13}>
        <div>
          <p className={styles.c14}>{copyText("app/features/media/impl.19")}</p>
          <h2 className={styles.c15}>
            {copyText("app/features/media/impl.20")}
          </h2>
          <p className={styles.c16}>{copyText("app/features/media/impl.21")}</p>
        </div>
        <span className={styles.c17}>
          {storyboard.reduce((total, scene) => total + scene.shots.length, 0)}{" "}
          {copyText("app/features/media/impl.22")}
        </span>
      </div>
      <div className={styles.c18}>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.23")}
          <input
            className={styles.c19}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copyText("app/features/media/impl.24")}
          />
        </label>
        <div className={styles.c4}>
          {copyText("app/features/media/impl.25")}
          <div
            className={styles.c20}
            role="group"
            aria-label={copyText("app/features/media/impl.26")}
          >
            {(
              [
                ["all", "全部镜头"],
                ["attention", "需处理"],
                ["missing-assets", "缺资产引用"],
              ] as const
            ).map(([value, label]) => (
              <BareButton
                key={value}
                className={clsx(
                  styles.c21,
                  filter === value ? styles.k3 : styles.k4,
                )}
                onClick={() => setFilter(value)}
              >
                {label}
              </BareButton>
            ))}
          </div>
        </div>
      </div>
      {notice && <p className={styles.c22}>{notice}</p>}
      {contextShot && (
        <p
          className={styles.c23}
          aria-label={copyText("app/features/media/impl.27")}
        >
          {copyText("app/features/media/impl.28")}
          {contextShot.shot.title}
          {copyText("app/features/media/impl.29")}
        </p>
      )}
      {(selectedIds.length > 0 || undo) && (
        <div className={styles.c24}>
          {selectedIds.length > 0 && (
            <span>
              {copyText("app/features/media/impl.30")}
              {selectedIds.length}
              {copyText("app/features/media/impl.31")}
            </span>
          )}
          {selectedShot && (
            <BareButton
              className={styles.c25}
              onClick={() =>
                props.onOpenAssetCenter(
                  selectedShot.shot.id,
                  selectedShot.scene.id,
                  selectedShot.scene.scriptId,
                )
              }
            >
              {copyText("app/features/media/impl.32")}
            </BareButton>
          )}
          {selectedIds.length > 0 && (
            <BareButton
              className={styles.c26}
              onClick={() => setSelectedIds([])}
            >
              {copyText("app/features/media/impl.33")}
            </BareButton>
          )}
          {undo && (
            <BareButton
              className={styles.c27}
              disabled={Boolean(savingSceneId)}
              onClick={() => void undoReorder()}
            >
              {copyText("app/features/media/impl.34")}
            </BareButton>
          )}
        </div>
      )}
      {visibleScenes.map((scene) => {
        const shownShots = scene.shots.slice(0, visiblePerScene);
        return (
          <section
            key={scene.id}
            className={styles.c28}
            aria-label={copyText("app/features/media/impl.230", {
              p1: scene.title,
            })}
          >
            <div className={styles.c29}>
              <div>
                <h3 className={styles.c30}>{scene.title}</h3>
                <p className={styles.c31}>
                  {scene.location || "未填写地点与时间"} · {scene.shots.length}{" "}
                  {copyText("app/features/media/impl.22")}
                </p>
              </div>
              <span className={styles.c32}>
                {savingSceneId === scene.id
                  ? "正在保存顺序…"
                  : "可拖拽或用 Alt + ↑/↓ 重排"}
              </span>
            </div>
            <div className={styles.c33}>
              {shownShots.map((shot) => {
                const fullIndex = scene.shots.findIndex(
                  (candidate) => candidate.id === shot.id,
                );
                return (
                  <article
                    key={shot.id}
                    data-shot-id={shot.id}
                    draggable={!savingSceneId}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "application/x-dramaip-shot-id",
                        shot.id,
                      );
                      setDraggingId(shot.id);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const movingId =
                        event.dataTransfer.getData(
                          "application/x-dramaip-shot-id",
                        ) || draggingId;
                      if (movingId) void reorder(scene, movingId, shot.id);
                    }}
                    className={clsx(
                      styles.c34,
                      props.selectedShotId === shot.id ? styles.k5 : styles.k6,
                    )}
                  >
                    <div className={styles.c35}>
                      <div className={styles.c36}>
                        <BareButton
                          className={styles.c37}
                          aria-label={copyText("app/features/media/impl.231", {
                            p1: shot.title,
                          })}
                          aria-pressed={props.selectedShotId === shot.id}
                          onClick={() =>
                            props.onSelectShot(
                              shot.id,
                              scene.id,
                              scene.scriptId,
                            )
                          }
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              move(scene, shot.id, -1);
                            }
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              move(scene, shot.id, 1);
                            }
                          }}
                        >
                          {fullIndex + 1}. {shot.title}
                        </BareButton>
                        <p className={styles.c38}>{shot.visualDescription}</p>
                      </div>
                      <label className={styles.c39}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(shot.id)}
                          aria-label={copyText("app/features/media/impl.232", {
                            p1: shot.title,
                          })}
                          onChange={() => toggleSelected(shot.id)}
                        />
                        {copyText("app/features/media/impl.35")}
                      </label>
                    </div>
                    <div
                      className={styles.c40}
                      aria-label={copyText("app/features/media/impl.233", {
                        p1: stillStateLabel(shot.stillState),
                      })}
                    >
                      {stillStateLabel(shot.stillState)}
                      {copyText("app/features/media/impl.36")}
                    </div>
                    <dl className={styles.c41}>
                      <div>
                        <dt className={styles.c42}>
                          {copyText("app/features/media/impl.37")}
                        </dt>
                        <dd>{shot.dialogue || "无对白"}</dd>
                      </div>
                      <div>
                        <dt className={styles.c42}>
                          {copyText("app/features/media/impl.38")}
                        </dt>
                        <dd>{shot.camera || "未填写"}</dd>
                      </div>
                      <div>
                        <dt className={styles.c42}>
                          {copyText("app/features/media/impl.39")}
                        </dt>
                        <dd>
                          {[shot.movement, shot.duration]
                            .filter(Boolean)
                            .join(" · ") || "未填写"}
                        </dd>
                      </div>
                      <div>
                        <dt className={styles.c42}>
                          {copyText("app/features/media/impl.40")}
                        </dt>
                        <dd>{shot.taskStatus}</dd>
                      </div>
                    </dl>
                    <div
                      className={styles.c43}
                      aria-label={copyText("app/features/media/impl.234", {
                        p1: shot.title,
                      })}
                    >
                      {(["character", "scene", "prop", "voice"] as const).map(
                        (category) => (
                          <span key={category} className={styles.c44}>
                            {ASSET_CATEGORY_LABELS[category]}{" "}
                            {shot.categoryCounts[category]}
                          </span>
                        ),
                      )}
                      <span
                        className={clsx(
                          styles.c45,
                          shot.lockedAssetCount ? styles.k7 : styles.k8,
                        )}
                      >
                        {shot.lockedAssetCount
                          ? `已锁 ${shot.lockedAssetCount}`
                          : "暂无锁定资产"}
                      </span>
                      {shot.missingAssetReference && (
                        <span className={styles.c46}>
                          {copyText("app/features/media/impl.41")}
                        </span>
                      )}
                      {shot.rightsBlocked && (
                        <span className={styles.c47}>
                          {copyText("app/features/media/impl.42")}
                        </span>
                      )}
                      {shot.costRisk && (
                        <span className={styles.c46}>
                          {copyText("app/features/media/impl.43")}
                        </span>
                      )}
                    </div>
                    <div className={styles.c48}>
                      <BareButton
                        className={styles.c49}
                        disabled={Boolean(savingSceneId) || fullIndex === 0}
                        onClick={() => move(scene, shot.id, -1)}
                      >
                        {copyText("app/features/media/impl.44")}
                      </BareButton>
                      <BareButton
                        className={styles.c49}
                        disabled={
                          Boolean(savingSceneId) ||
                          fullIndex === scene.shots.length - 1
                        }
                        onClick={() => move(scene, shot.id, 1)}
                      >
                        {copyText("app/features/media/impl.45")}
                      </BareButton>
                      <BareButton
                        className={styles.c50}
                        onClick={() =>
                          props.onOpenAssetCenter(
                            shot.id,
                            scene.id,
                            scene.scriptId,
                          )
                        }
                      >
                        {copyText("app/features/media/impl.46")}
                      </BareButton>
                    </div>
                  </article>
                );
              })}
            </div>
            {scene.shots.length > shownShots.length && (
              <BareButton
                className={styles.c51}
                onClick={() => setVisiblePerScene((current) => current + 50)}
              >
                {copyText("app/features/media/impl.47")}{" "}
                {Math.min(50, scene.shots.length - shownShots.length)}
                {copyText("app/features/media/impl.31")}
              </BareButton>
            )}
          </section>
        );
      })}
      {!visibleScenes.length && (
        <p className={styles.c11}>{copyText("app/features/media/impl.48")}</p>
      )}
    </section>
  );
}

export const ASSET_CATEGORY_LABELS: Record<
  AssetCenterAsset["category"],
  string
> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  voice: "音色",
};

export function assetStatusLabel(asset: AssetCenterAsset): string {
  if (asset.stale) return "设定已过期";
  if (asset.preview.status === "missing") return "本地文件缺失";
  if (asset.rightsStatus === "restricted") return "权利受限";
  if (asset.costStatus === "unknown") return "费用未知";
  if (asset.providerStatus === "unavailable") return "服务不可用";
  if (asset.preview.status === "unattached") return "尚未附加媒体";
  return asset.adopted ? "已采用" : "AI 草稿版本";
}

export function AssetCenterPanel(props: {
  projectId: string;
  selectedShotId?: string;
  onOpenCatalog(): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: center, error } = useQuery({
    queryKey: ["asset-center", props.projectId],
    queryFn: () => client.assetCenter.get(props.projectId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["resource", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const [category, setCategory] = useState<
    "all" | AssetCenterAsset["category"]
  >("all");
  const [query, setQuery] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [shotId, setShotId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [workingId, setWorkingId] = useState<string>();
  useEffect(() => {
    if (props.selectedShotId) setShotId(props.selectedShotId);
  }, [props.selectedShotId]);
  const assets = center?.assets ?? [];
  const filtered = assets.filter(
    (asset) =>
      (category === "all" || asset.category === category) &&
      `${asset.title} ${asset.subject}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const compared = assets.filter((asset) => compareIds.includes(asset.id));
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["asset-center", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "shots", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["resource", "visual-assets", props.projectId],
      }),
    ]);
  };
  const action = async (
    asset: AssetCenterAsset,
    actionName: "adopt" | "lock" | "unlock" | "assign-shot" | "remove-shot",
  ) => {
    if (
      (actionName === "assign-shot" || actionName === "remove-shot") &&
      !shotId
    ) {
      setNotice("请先选择要查看或迁移用途的镜头。");
      return;
    }
    setWorkingId(asset.id);
    setNotice(undefined);
    try {
      await client.assetCenter.action(asset.id, {
        action: actionName,
        version: asset.version,
        ...(actionName === "assign-shot" || actionName === "remove-shot"
          ? { shotId }
          : {}),
      });
      setNotice(
        actionName === "assign-shot"
          ? "已将锁定版本分配给镜头。"
          : actionName === "remove-shot"
            ? "已移除该镜头的资产用途。"
            : "资产版本状态已更新。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorkingId(undefined);
    }
  };
  const toggleCompare = (id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) {
        setNotice("最多并排比较 4 个 AI 草稿版本。");
        return current;
      }
      return [...current, id];
    });
  };
  return (
    <section
      className={styles.c1}
      aria-label={copyText("app/features/media/impl.49")}
    >
      <div className={styles.c13}>
        <div>
          <p className={styles.c14}>{copyText("app/features/media/impl.50")}</p>
          <h2 className={styles.c15}>
            {copyText("app/features/media/impl.51")}
          </h2>
          <p className={styles.c16}>{copyText("app/features/media/impl.52")}</p>
        </div>
        <BareButton className={styles.c52} onClick={props.onOpenCatalog}>
          {copyText("app/features/media/impl.53")}
        </BareButton>
      </div>
      <div className={styles.c18}>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.54")}
          <input
            className={styles.c19}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copyText("app/features/media/impl.55")}
          />
        </label>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.56")}
          <NativeSelect
            className={styles.c53}
            value={shotId}
            onChange={(event) => setShotId(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.57")}</option>
            {shots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {shot.title}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div
        className={styles.c20}
        role="group"
        aria-label={copyText("app/features/media/impl.58")}
      >
        {(["all", "character", "scene", "prop", "voice"] as const).map(
          (item) => (
            <BareButton
              key={item}
              className={clsx(
                styles.c21,
                category === item ? styles.k3 : styles.k9,
              )}
              onClick={() => setCategory(item)}
            >
              {item === "all" ? "全部资产" : ASSET_CATEGORY_LABELS[item]}
            </BareButton>
          ),
        )}
      </div>
      {notice && <p className={styles.c22}>{notice}</p>}
      {error && <p className={styles.c54}>{message(error)}</p>}
      {compared.length > 0 && (
        <section
          className={styles.c55}
          aria-label={copyText("app/features/media/impl.59")}
        >
          <div className={styles.c56}>
            <div>
              <h3 className={styles.c30}>
                {copyText("app/features/media/impl.60")}
              </h3>
              <p className={styles.c31}>
                {copyText("app/features/media/impl.61")}
              </p>
            </div>
            <BareButton
              className={styles.c57}
              onClick={() => setCompareIds([])}
            >
              {copyText("app/features/media/impl.62")}
            </BareButton>
          </div>
          <div className={styles.c58}>
            {compared.map((asset) => (
              <article key={asset.id} className={styles.c59}>
                <p className={styles.c60}>{asset.title}</p>
                <p className={styles.c38}>
                  {asset.assetVersion} · {assetStatusLabel(asset)}
                </p>
                <p className={styles.c61}>
                  {asset.preview.label ?? "没有可展示的本地预览说明。"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className={styles.c62}>
        {filtered.map((asset) => (
          <article key={asset.id} className={styles.c28}>
            <div className={styles.c35}>
              <div className={styles.c36}>
                <p className={styles.c63}>
                  {ASSET_CATEGORY_LABELS[asset.category]} · {asset.subject}
                </p>
                <h3 className={styles.c64}>{asset.title}</h3>
                <p className={styles.c38}>
                  {copyText("app/features/media/impl.63")}
                  {asset.assetVersion}
                </p>
              </div>
              <BareButton
                className={clsx(
                  styles.c65,
                  compareIds.includes(asset.id) ? styles.k3 : styles.k10,
                )}
                onClick={() => toggleCompare(asset.id)}
              >
                {compareIds.includes(asset.id) ? "已加入比较" : "加入比较"}
              </BareButton>
            </div>
            <AssetMediaPreview
              key={`${props.projectId}:${asset.id}`}
              asset={asset}
              projectId={props.projectId}
            />
            <dl className={styles.c66}>
              <div>
                <dt className={styles.c42}>
                  {copyText("app/features/media/impl.64")}
                </dt>
                <dd>{asset.adopted ? "已采用" : "AI 草稿"}</dd>
              </div>
              <div>
                <dt className={styles.c42}>
                  {copyText("app/features/media/impl.65")}
                </dt>
                <dd>{asset.lockStatus === "locked" ? "已锁定" : "未锁定"}</dd>
              </div>
              <AssetDeclarationStatus asset={asset} />
            </dl>
            {asset.usages.length > 0 && (
              <p className={styles.c67}>
                {copyText("app/features/media/impl.66")}
                {asset.usages.map((usage) => usage.shotTitle).join("、")}
              </p>
            )}
            <div className={styles.c68}>
              {!asset.adopted && (
                <BareButton
                  className={styles.c69}
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "adopt")}
                >
                  {copyText("app/features/media/impl.67")}
                </BareButton>
              )}
              {asset.adopted && asset.lockStatus === "unlocked" && (
                <BareButton
                  className={styles.c70}
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "lock")}
                >
                  {copyText("app/features/media/impl.68")}
                </BareButton>
              )}
              {asset.lockStatus === "locked" && (
                <BareButton
                  className={styles.c70}
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "unlock")}
                >
                  {copyText("app/features/media/impl.69")}
                </BareButton>
              )}
              {asset.adopted && asset.lockStatus === "locked" && (
                <BareButton
                  className={styles.c70}
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "assign-shot")}
                >
                  {copyText("app/features/media/impl.70")}
                </BareButton>
              )}
              {asset.usages.some((usage) => usage.shotId === shotId) && (
                <BareButton
                  className={styles.c71}
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "remove-shot")}
                >
                  {copyText("app/features/media/impl.71")}
                </BareButton>
              )}
            </div>
          </article>
        ))}
        {!filtered.length && (
          <p className={styles.c11}>{copyText("app/features/media/impl.72")}</p>
        )}
      </div>
    </section>
  );
}

export function ImageGenerationPanel(props: {
  projectId: string;
  shotId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("");
  const [kind, setKind] = useState<
    "still" | "first_frame" | "last_frame" | "cover"
  >("still");
  const { data: shot } = useQuery({
    queryKey: ["resource", "shots", props.shotId],
    queryFn: () => client.resources.get("shots", props.shotId),
  });
  const [prompt, setPrompt] = useMediaDraft(
    `media-image:${props.shotId}`,
    String(
      recordPayload(shot?.payload)["图片提示"] ??
        recordPayload(shot?.payload)["生成提示"] ??
        "",
    ),
  );
  const [negativePrompt, setNegativePrompt] = useMediaDraft(
    `media-image-negative:${props.shotId}`,
    String(recordPayload(shot?.payload)["负面提示"] ?? ""),
  );
  const [size, setSize] = useState("1024x1536");
  const [notice, setNotice] = useState<string>();
  const [running, setRunning] = useState(false);
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
    queryFn: () =>
      client.resources.list("shot-stills", props.projectId, props.shotId),
  });
  const run = async () => {
    if (!providerId || !prompt.trim()) {
      setNotice("请选择图片服务商并填写生成提示。");
      return;
    }
    setRunning(true);
    setNotice(undefined);
    try {
      const result = await client.imageGeneration.run(
        {
          providerId,
          projectId: props.projectId,
          shotId: props.shotId,
          kind,
          prompt: prompt.trim(),
          ...(negativePrompt.trim()
            ? { negativePrompt: negativePrompt.trim() }
            : {}),
          ...(size.trim() ? { size: size.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setNotice(
        `已归档 ${result.candidates.length} 张 AI 草稿图片，请人工采用后进入动态分镜。`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["resource", "assets", props.projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setRunning(false);
    }
  };
  const adopt = async (id: string) => {
    try {
      await client.visuals.adoptStill(id);
      setNotice("已采用该静帧 AI 草稿。后续动态分镜会优先引用它。");
      await queryClient.invalidateQueries({
        queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className={styles.c72}>
      <details className={styles.c73}>
        <summary className={styles.c74}>
          {copyText("app/features/media/impl.73")}
        </summary>
        <CreationRecordWorkbench
          projectId={props.projectId}
          targetId={props.shotId}
          domain="shots"
          operation="shot-prompt"
        />
      </details>
      <div>
        <h2 className={styles.c30}>{copyText("app/features/media/impl.74")}</h2>
        <p className={styles.c31}>{copyText("app/features/media/impl.75")}</p>
      </div>
      <div className={styles.c75}>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.76")}
          <NativeSelect
            className={styles.c76}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.77")}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.78")}
          <NativeSelect
            className={styles.c76}
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="still">
              {copyText("app/features/media/impl.79")}
            </option>
            <option value="first_frame">
              {copyText("app/features/media/impl.80")}
            </option>
            <option value="last_frame">
              {copyText("app/features/media/impl.81")}
            </option>
            <option value="cover">
              {copyText("app/features/media/impl.82")}
            </option>
          </NativeSelect>
        </label>
        <label className={styles.c4}>
          {copyText("app/features/media/impl.83")}
          <input
            className={styles.c19}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <label className={styles.c77}>
          {copyText("app/features/media/impl.84")}
          <textarea
            className={styles.c78}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={copyText("app/features/media/impl.85")}
          />
        </label>
        <label className={styles.c77}>
          {copyText("app/features/media/impl.86")}
          <textarea
            className={styles.c79}
            placeholder={copyText("app/features/media/impl.87")}
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </label>
        <BareButton
          className={styles.c80}
          disabled={running}
          onClick={() => void run()}
        >
          {running ? "正在生成并归档…" : "生成 AI 草稿图片"}
        </BareButton>
      </div>
      <section className={styles.c81}>
        <h3 className={styles.c60}>{copyText("app/features/media/impl.88")}</h3>
        <div className={styles.c82}>
          {!candidates.length && (
            <p className={styles.c14}>
              {copyText("app/features/media/impl.89")}
            </p>
          )}
          {candidates.map((candidate) => {
            const payload = recordPayload(candidate.payload);
            const adopted = payload["采用状态"] === "已采用";
            return (
              <div key={candidate.id} className={styles.c83}>
                <span>{candidate.title}</span>
                <MediaSourceReviewPanel
                  recordId={candidate.id}
                  kind="shot-stills"
                  shotId={props.shotId}
                  adopted={adopted}
                  adoptLabel="采用此静帧"
                  onAdopt={() => adopt(candidate.id)}
                />
              </div>
            );
          })}
        </div>
      </section>
      {notice && <p className={styles.c22}>{notice}</p>}
    </section>
  );
}

export function VideoGenerationPanel(props: {
  projectId: string;
  episodeId: string;
  shotId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("");
  const { data: shot } = useQuery({
    queryKey: ["video-generation-shot", props.shotId],
    queryFn: () => client.resources.get("shots", props.shotId),
  });
  const [prompt, setPrompt] = useMediaDraft(
    `media-video:${props.shotId}`,
    String(recordPayload(shot?.payload)["生成提示"] ?? ""),
  );
  const [seconds, setSeconds] = useState("5");
  const [confirmUnknownCost, setConfirmUnknownCost] = useState(false);
  const [preflight, setPreflight] = useState<VideoGenerationPreflight>();
  const [notice, setNotice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["video-generation", props.shotId],
    queryFn: () => client.videoGeneration.listByShot(props.shotId),
    refetchInterval: (query) =>
      query.state.data?.some((job) =>
        ["queued", "running"].includes(job.status),
      )
        ? 10_000
        : false,
  });
  const refresh = async () =>
    queryClient.invalidateQueries({
      queryKey: ["video-generation", props.shotId],
    });
  useEffect(() => {
    setPreflight(undefined);
  }, [providerId, prompt, seconds, confirmUnknownCost, props.shotId]);
  const input = (): VideoGenerationInput | undefined => {
    if (!providerId || !prompt.trim()) {
      setNotice("请选择视频服务商并填写生成提示。");
      return undefined;
    }
    const length = Number(seconds);
    if (!Number.isInteger(length) || length < 1 || length > 60) {
      setNotice("视频时长须为 1 至 60 秒的整数。");
      return undefined;
    }
    return {
      providerId,
      projectId: props.projectId,
      episodeId: props.episodeId,
      shotId: props.shotId,
      prompt: prompt.trim(),
      seconds: length,
      confirmUnknownCost,
    };
  };
  const checkReadiness = async () => {
    const request = input();
    if (!request) return;
    setCheckingReadiness(true);
    setNotice(undefined);
    try {
      const result = await client.videoGeneration.preflight(
        props.shotId,
        request,
      );
      setPreflight(result);
      setNotice(
        result.ready
          ? "预检通过：本次提交将固定使用当前静帧、资产版本、参数与费用快照。"
          : "预检发现阻断项；不会向视频服务商发起调用。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setCheckingReadiness(false);
    }
  };
  const create = async () => {
    const request = input();
    if (!request) return;
    if (!preflight?.ready) {
      setNotice("请先完成静帧、资产、权利和费用预检。");
      return;
    }
    setCreating(true);
    try {
      const job = await client.videoGeneration.create(
        { ...request, readinessHash: preflight.snapshotHash },
        crypto.randomUUID(),
      );
      setNotice(videoJobNotice(job.status));
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setCreating(false);
    }
  };
  const check = async (id: string) => {
    try {
      const job = await client.videoGeneration.refresh(id);
      setNotice(videoJobNotice(job.status));
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const cancel = async (id: string) => {
    try {
      await client.videoGeneration.cancel(id);
      setNotice("已停止本地追踪，请在服务商侧确认远端任务状态。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const retry = async (id: string) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    setProviderId(job.providerId);
    setPrompt(job.prompt);
    setPreflight(undefined);
    setNotice(
      "已恢复原服务商、模型和输入快照。请重新完成静帧、资产、权利与费用预检，再确认提交。",
    );
  };
  const adopt = async (id: string) => {
    try {
      await client.visuals.adoptVideo(id);
      setNotice(
        "已采用视频 AI 草稿。分镜将引用此版本，其他 AI 草稿仍会保留以供比较。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section
      aria-label={copyText("app/features/media/impl.90")}
      className={styles.c72}
    >
      <details className={styles.c73}>
        <summary className={styles.c74}>
          {copyText("app/features/media/impl.73")}
        </summary>
        <CreationRecordWorkbench
          projectId={props.projectId}
          targetId={props.shotId}
          domain="shots"
          operation="shot-prompt"
        />
      </details>
      <div>
        <h2 className={styles.c30}>{copyText("app/features/media/impl.91")}</h2>
        <p className={styles.c31}>{copyText("app/features/media/impl.92")}</p>
      </div>
      <section className={styles.c75}>
        <NativeSelect
          aria-label={copyText("app/features/media/impl.93")}
          className={styles.c84}
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          <option value="">{copyText("app/features/media/impl.94")}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.title}
            </option>
          ))}
        </NativeSelect>
        <input
          aria-label={copyText("app/features/media/impl.95")}
          className={styles.c85}
          type="number"
          min="1"
          max="60"
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
        />
        <BareButton
          className={styles.c86}
          disabled={
            creating || checkingReadiness || !providerId || !prompt.trim()
          }
          onClick={() => void checkReadiness()}
        >
          {checkingReadiness ? "正在检查…" : "检查静帧与视频预检"}
        </BareButton>
        <BareButton
          className={styles.c80}
          disabled={creating || !preflight?.ready}
          onClick={() => void create()}
          title={
            preflight?.ready
              ? "提交与预检快照完全一致的视频任务"
              : "请先通过静帧与视频预检"
          }
        >
          {creating ? "正在提交…" : "提交视频生成"}
        </BareButton>
        <textarea
          aria-label={copyText("app/features/media/impl.96")}
          className={styles.c87}
          placeholder={copyText("app/features/media/impl.97")}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </section>
      <section className={styles.c88}>
        <h3 className={styles.c60}>{copyText("app/features/media/impl.98")}</h3>
        <p className={styles.c38}>{copyText("app/features/media/impl.99")}</p>
        {preflight?.costStatus === "unknown" && (
          <label className={styles.c89}>
            <input
              type="checkbox"
              checked={confirmUnknownCost}
              onChange={(event) => setConfirmUnknownCost(event.target.checked)}
            />
            {copyText("app/features/media/impl.100")}
          </label>
        )}
        {preflight && (
          <div className={styles.c90}>
            <p>
              {copyText("app/features/media/impl.101")}
              {preflight.snapshotHash.slice(0, 18)}
              {copyText("app/features/media/impl.102")}{" "}
              {preflight.adoptedStillId ? "已采用" : "未采用"}
              {copyText("app/features/media/impl.103")}{" "}
              {preflight.lockedAssetIds.length}
              {copyText("app/features/media/impl.104")}
              {` · ${configuredEstimateLabel(preflight.estimatedCost, preflight.currency)}`}
            </p>
            {preflight.blockers.map((blocker) => (
              <p key={blocker} className={styles.c91}>
                {copyText("app/features/media/impl.105")}
                {blocker}
              </p>
            ))}
            {preflight.warnings.map((warning) => (
              <p key={warning} className={styles.c92}>
                {copyText("app/features/media/impl.106")}
                {warning}
              </p>
            ))}
            {preflight.ready && (
              <p className={styles.c93}>
                {copyText("app/features/media/impl.107")}
              </p>
            )}
          </div>
        )}
      </section>
      <section className={styles.c81}>
        <h3 className={styles.c60}>
          {copyText("app/features/media/impl.108")}
        </h3>
        <div className={styles.c82}>
          {!jobs.length && (
            <p className={styles.c14}>
              {copyText("app/features/media/impl.109")}
            </p>
          )}
          {jobs.map((job) => (
            <article key={job.id} className={styles.c94}>
              <div className={styles.c95}>
                <span>
                  {videoJobStatusLabel(job.status)} ·{" "}
                  {job.results.length
                    ? `已归档 ${job.results.length} 个 AI 草稿`
                    : "暂无可采用结果"}
                </span>
                <div className={styles.c96}>
                  {["queued", "running"].includes(job.status) && (
                    <BareButton
                      className={styles.c50}
                      onClick={() => void check(job.id)}
                    >
                      {copyText("app/features/media/impl.110")}
                    </BareButton>
                  )}
                  {["queued", "running"].includes(job.status) && (
                    <BareButton
                      className={styles.c97}
                      onClick={() => void cancel(job.id)}
                    >
                      {copyText("app/features/media/impl.111")}
                    </BareButton>
                  )}
                  {["failed", "canceled"].includes(job.status) && (
                    <BareButton
                      className={styles.c50}
                      onClick={() => void retry(job.id)}
                    >
                      {copyText("app/features/media/impl.112")}
                    </BareButton>
                  )}
                </div>
              </div>
              <p className={styles.c38}>{job.prompt}</p>
              {job.error && <p className={styles.c98}>{job.error}</p>}
              {job.results.length > 0 && (
                <div className={styles.c99}>
                  <p className={styles.c100}>
                    {copyText("app/features/media/impl.113")}
                  </p>
                  {job.results.map((candidate) => {
                    const adopted =
                      recordPayload(candidate.payload)["采用状态"] === "已采用";
                    return (
                      <div key={candidate.id} className={styles.c101}>
                        <span>{candidate.title}</span>
                        <MediaSourceReviewPanel
                          recordId={candidate.id}
                          kind="video"
                          shotId={props.shotId}
                          adopted={adopted}
                          adoptLabel="采用此视频"
                          onAdopt={() => adopt(candidate.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {notice && <p className={styles.c22}>{notice}</p>}
    </section>
  );
}

export function videoJobStatusLabel(
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
): string {
  return {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已停止",
  }[status];
}
export function videoJobNotice(
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
): string {
  return {
    queued: "视频任务已提交，正在等待服务商开始执行。",
    running: "视频正在生成，系统会定期查询状态。",
    succeeded: "视频已完成并归档为分镜 AI 草稿。",
    failed: "视频服务商报告任务失败。",
    canceled: "视频任务已停止。",
  }[status];
}

export function AudioProductionPanel(props: {
  projectId: string;
  episodeId: string;
  shotId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [voiceTitle, setVoiceTitle] = useState("");
  const [providerVoice, setProviderVoice] = useState("");
  const [trackLabel, setTrackLabel] = useState("");
  const [trackKind, setTrackKind] = useState<
    "dialogue" | "narration" | "bgm" | "sfx"
  >("narration");
  const [assetId, setAssetId] = useState("");
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [startSeconds, setStartSeconds] = useState("0");
  const [durationSeconds, setDurationSeconds] = useState("3");
  const [clipText, setClipText] = useState("");
  const [ttsProviderId, setTtsProviderId] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [runningTts, setRunningTts] = useState(false);
  const audioAdoptionKeys = useRef(new Map<string, string>());
  const [notice, setNotice] = useState<string>();
  const { data: voiceProfiles = [] } = useQuery({
    queryKey: ["voice-profiles", props.projectId],
    queryFn: () => client.episodeMedia.listVoiceProfiles(props.projectId),
  });
  const { data: audioTracks = [] } = useQuery({
    queryKey: ["audio-tracks", props.episodeId],
    queryFn: () => client.episodeMedia.listAudioTracks(props.episodeId),
    refetchInterval: 5000,
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["resource", "assets", props.projectId],
    queryFn: () => client.resources.list("assets", props.projectId),
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ["resource", "scripts", props.projectId, props.episodeId],
    queryFn: () =>
      client.resources.list("scripts", props.projectId, props.episodeId),
  });
  const { data: dialogueDocuments = [] } = useQuery({
    queryKey: [
      "audio-dialogue",
      props.episodeId,
      scripts.map((script) => `${script.id}:${script.version}`).join(","),
    ],
    queryFn: () =>
      Promise.all(scripts.map((script) => client.screenplays.get(script.id))),
    enabled: Boolean(scripts.length),
  });
  const { data: characters = [] } = useQuery({
    queryKey: ["resource", "characters", props.projectId],
    queryFn: () => client.resources.list("characters", props.projectId),
  });
  const dialogue = dialogueDocuments.flatMap((document) => {
    let speaker = "";
    return document.blocks.flatMap((block) => {
      if (block.type === "character") speaker = block.text;
      return block.type === "dialogue"
        ? [{ id: block.id, speaker, text: block.text }]
        : [];
    });
  });
  const useDialogue = (id: string) => {
    const line = dialogue.find((item) => item.id === id);
    if (!line) return;
    setTtsText(line.text);
    setTrackKind("dialogue");
    setTrackLabel(`${line.speaker} · 对白`);
    const character = characters.find(
      (item) => item.title.trim() === line.speaker.trim(),
    );
    const matches = voiceProfiles.filter(
      (profile) =>
        profile.status === "adopted" &&
        ((character && profile.characterId === character.id) ||
          profile.title.trim() === line.speaker.trim()),
    );
    if (matches.length === 1 && matches[0]?.providerVoice) {
      setVoiceProfileId(matches[0].id);
      setTtsVoice(matches[0].providerVoice);
      setNotice("已从剧本提取台词并匹配已采用音色。");
    } else {
      setVoiceProfileId("");
      setTtsVoice("");
      setNotice("台词已提取，请选择角色的音色后确认生成。");
    }
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["voice-profiles", props.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["audio-tracks", props.episodeId],
      }),
    ]);
  };
  const createVoice = async () => {
    if (!voiceTitle.trim()) {
      setNotice("请填写音色名称。");
      return;
    }
    try {
      await client.episodeMedia.createVoiceProfile({
        projectId: props.projectId,
        title: voiceTitle.trim(),
        ...(providerVoice.trim()
          ? { providerVoice: providerVoice.trim() }
          : {}),
      });
      setVoiceTitle("");
      setProviderVoice("");
      setNotice("已创建音色草案。采用后可供当前项目音轨引用。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const adoptVoice = async (id: string) => {
    try {
      await client.episodeMedia.adoptVoiceProfile(id);
      setNotice("已采用音色；同一角色只会保留一个已采用版本。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const saveTrack = async () => {
    if (!trackLabel.trim()) {
      setNotice("请填写音轨名称。");
      return;
    }
    const start = Number(startSeconds);
    const duration = Number(durationSeconds);
    if (
      !Number.isFinite(start) ||
      start < 0 ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      setNotice("请填写有效的片段起点和时长。");
      return;
    }
    try {
      await client.episodeMedia.createAudioTrack({
        projectId: props.projectId,
        episodeId: props.episodeId,
        kind: trackKind,
        label: trackLabel.trim(),
        clips: [
          {
            ...(props.shotId ? { shotId: props.shotId } : {}),
            ...(assetId ? { assetId } : {}),
            ...(voiceProfileId ? { voiceProfileId } : {}),
            startSeconds: start,
            durationSeconds: duration,
            ...(clipText.trim() ? { text: clipText.trim() } : {}),
          },
        ],
      });
      setTrackLabel("");
      setClipText("");
      setNotice("已另存音轨草案；采用时会再次校验当前镜头版本。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const adoptTrack = async (track: AudioTrack) => {
    try {
      const identity = `${track.id}:${track.version}`;
      let key = audioAdoptionKeys.current.get(identity);
      if (!key) {
        key = crypto.randomUUID();
        audioAdoptionKeys.current.set(identity, key);
      }
      await client.episodeMedia.adoptAudioTrack(track.id, track.version, key);
      setNotice(
        "已采用音轨并核对实际来源版本；镜头、素材、音色或正式来源变化后须另行复核。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const runTts = async () => {
    if (!ttsProviderId || !ttsVoice.trim() || !ttsText.trim()) {
      setNotice("请选择语音服务商，并填写音色标识和要生成的文本。");
      return;
    }
    setRunningTts(true);
    try {
      const result = await client.ttsGeneration.run(
        {
          providerId: ttsProviderId,
          projectId: props.projectId,
          episodeId: props.episodeId,
          ...(props.shotId ? { shotId: props.shotId } : {}),
          ...(voiceProfileId ? { voiceProfileId } : {}),
          kind: trackKind === "dialogue" ? "dialogue" : "narration",
          input: ttsText.trim(),
          voice: ttsVoice.trim(),
          responseFormat: "mp3",
        },
        crypto.randomUUID(),
      );
      setAssetId(result.asset.id);
      setTtsText("");
      setNotice("已归档语音素材，并已选入当前音轨草案。请另存并采用音轨。");
      await queryClient.invalidateQueries({
        queryKey: ["resource", "assets", props.projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setRunningTts(false);
    }
  };
  return (
    <section className={styles.c72}>
      <div>
        <h2 className={styles.c30}>
          {copyText("app/features/media/impl.114")}
        </h2>
        <p className={styles.c31}>{copyText("app/features/media/impl.115")}</p>
      </div>
      <section className={styles.c102}>
        <div>
          <h3 className={styles.c60}>
            {copyText("app/features/media/impl.116")}
          </h3>
          <div className={styles.c103}>
            <input
              className={styles.c85}
              placeholder={copyText("app/features/media/impl.117")}
              value={voiceTitle}
              onChange={(event) => setVoiceTitle(event.target.value)}
            />
            <input
              className={styles.c85}
              placeholder={copyText("app/features/media/impl.118")}
              value={providerVoice}
              onChange={(event) => setProviderVoice(event.target.value)}
            />
            <BareButton
              className={styles.c104}
              onClick={() => void createVoice()}
            >
              {copyText("app/features/media/impl.119")}
            </BareButton>
          </div>
        </div>
        <div>
          <h3 className={styles.c60}>
            {copyText("app/features/media/impl.120")}
          </h3>
          <div className={styles.c105}>
            {!voiceProfiles.length && (
              <p className={styles.c14}>
                {copyText("app/features/media/impl.121")}
              </p>
            )}
            {voiceProfiles.map((profile) => (
              <div key={profile.id} className={styles.c106}>
                <span>
                  {profile.title} ·{" "}
                  {profile.status === "adopted" ? "已采用" : "草案"}
                </span>
                {profile.status !== "adopted" && (
                  <BareButton
                    className={styles.c50}
                    onClick={() => void adoptVoice(profile.id)}
                  >
                    {copyText("app/features/media/impl.122")}
                  </BareButton>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className={styles.c81}>
        <h3 className={styles.c60}>
          {copyText("app/features/media/impl.123")}
        </h3>
        <label className={styles.c107}>
          {copyText("app/features/media/impl.124")}
          <NativeSelect
            aria-label={copyText("app/features/media/impl.125")}
            className={styles.c76}
            value=""
            onChange={(event) => useDialogue(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.126")}</option>
            {dialogue.map((line) => (
              <option key={line.id} value={line.id}>
                {line.speaker}：{line.text.slice(0, 100)}
              </option>
            ))}
          </NativeSelect>
        </label>

        <p className={styles.c38}>{copyText("app/features/media/impl.127")}</p>
        <div className={styles.c108}>
          <NativeSelect
            aria-label={copyText("app/features/media/impl.128")}
            className={styles.c84}
            value={ttsProviderId}
            onChange={(event) => setTtsProviderId(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.129")}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </NativeSelect>
          <input
            className={styles.c85}
            placeholder={copyText("app/features/media/impl.130")}
            value={ttsVoice}
            onChange={(event) => setTtsVoice(event.target.value)}
          />
          <BareButton
            className={styles.c86}
            disabled={runningTts}
            onClick={() => void runTts()}
          >
            {runningTts ? "正在生成语音…" : "生成并归档语音"}
          </BareButton>
          <textarea
            className={styles.c109}
            placeholder={copyText("app/features/media/impl.131")}
            value={ttsText}
            onChange={(event) => setTtsText(event.target.value)}
          />
        </div>
      </section>
      <section className={styles.c81}>
        <h3 className={styles.c60}>
          {copyText("app/features/media/impl.132")}
        </h3>
        <p className={styles.c38}>{copyText("app/features/media/impl.133")}</p>
        <div className={styles.c108}>
          <input
            className={styles.c85}
            placeholder={copyText("app/features/media/impl.134")}
            value={trackLabel}
            onChange={(event) => setTrackLabel(event.target.value)}
          />
          <NativeSelect
            aria-label={copyText("app/features/media/impl.135")}
            className={styles.c84}
            value={trackKind}
            onChange={(event) =>
              setTrackKind(event.target.value as typeof trackKind)
            }
          >
            <option value="dialogue">
              {copyText("app/features/media/impl.37")}
            </option>
            <option value="narration">
              {copyText("app/features/media/impl.136")}
            </option>
            <option value="bgm">
              {copyText("app/features/media/impl.137")}
            </option>
            <option value="sfx">
              {copyText("app/features/media/impl.138")}
            </option>
          </NativeSelect>
          <NativeSelect
            aria-label={copyText("app/features/media/impl.139")}
            className={styles.c84}
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.140")}</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={copyText("app/features/media/impl.141")}
            className={styles.c84}
            value={voiceProfileId}
            onChange={(event) => setVoiceProfileId(event.target.value)}
          >
            <option value="">{copyText("app/features/media/impl.142")}</option>
            {voiceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title}
              </option>
            ))}
          </NativeSelect>
          <input
            className={styles.c85}
            type="number"
            min="0"
            step="0.1"
            placeholder={copyText("app/features/media/impl.143")}
            value={startSeconds}
            onChange={(event) => setStartSeconds(event.target.value)}
          />
          <input
            className={styles.c85}
            type="number"
            min="0.1"
            step="0.1"
            placeholder={copyText("app/features/media/impl.144")}
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(event.target.value)}
          />
          <textarea
            className={styles.c109}
            placeholder={copyText("app/features/media/impl.145")}
            value={clipText}
            onChange={(event) => setClipText(event.target.value)}
          />
          <BareButton className={styles.c104} onClick={() => void saveTrack()}>
            {copyText("app/features/media/impl.146")}
          </BareButton>
        </div>
      </section>
      <section className={styles.c81}>
        <h3 className={styles.c60}>
          {copyText("app/features/media/impl.147")}
        </h3>
        {assetId && props.shotId && (
          <MediaSourceReviewPanel
            recordId={assetId}
            kind="assets"
            shotId={props.shotId}
          />
        )}
        <div className={styles.c82}>
          {!audioTracks.length && (
            <p className={styles.c14}>
              {copyText("app/features/media/impl.148")}
            </p>
          )}
          {audioTracks.map((track) => (
            <article key={track.id} className={styles.c94}>
              <div className={styles.c95}>
                <span className={styles.c60}>
                  {track.label} · {audioTrackKindLabel(track.kind)} ·{" "}
                  {track.status === "adopted" ? "已采用" : "草案"}
                </span>
                {track.status !== "adopted" && !track.stale && (
                  <BareButton
                    className={styles.c50}
                    onClick={() => void adoptTrack(track)}
                  >
                    {copyText("app/features/media/impl.149")}
                  </BareButton>
                )}
              </div>
              <p className={styles.c38}>
                {track.clips.length}
                {copyText("app/features/media/impl.150")}
                {track.stale
                  ? ` · 已过期：${track.staleReason}`
                  : " · 实际来源版本一致（不代表音频质量／授权通过）"}
              </p>
              {track.clips.map((clip) => (
                <p key={clip.id} className={styles.c38}>
                  {copyText("app/features/media/impl.151")}
                  {clip.sourceVersions
                    ?.map(
                      (source) =>
                        `${source.kind} ${source.id.slice(0, 8)} · v${source.version}`,
                    )
                    .join("；") || "手工文本／未指定外部素材"}
                </p>
              ))}
              <AudioRevisionPanel track={track} />
            </article>
          ))}
        </div>
      </section>
      {notice && <p className={styles.c22}>{notice}</p>}
    </section>
  );
}

export function AnimaticProductionPanel(props: {
  projectId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [annotations, setAnnotations] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: initialization, error: initializationError } = useQuery({
    queryKey: ["animatic-initialization", props.episodeId],
    queryFn: () => client.episodeMedia.initializeAnimatic(props.episodeId),
  });
  const { data: drafts = [] } = useQuery({
    queryKey: ["animatics", props.episodeId],
    queryFn: () => client.episodeMedia.listAnimatics(props.episodeId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["animatic-initialization", props.episodeId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["animatics", props.episodeId],
      }),
    ]);
  };
  const save = async () => {
    if (!initialization) return;
    try {
      await client.episodeMedia.createAnimatic({
        projectId: props.projectId,
        episodeId: props.episodeId,
        sourceFingerprint: initialization.sourceFingerprint,
        clips: initialization.clips,
        ...(annotations.trim() ? { annotations: annotations.trim() } : {}),
      });
      setAnnotations("");
      setNotice("已另存动态分镜草案。审核前将再次校验当前镜头谱系。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const review = async (
    id: string,
    status: "approved" | "returned",
    version: number,
  ) => {
    try {
      await client.episodeMedia.reviewAnimatic(id, { status, version });
      setNotice(
        status === "approved" ? "已通过动态分镜版本。" : "已退回动态分镜版本。",
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className={styles.c72}>
      <div>
        <h2 className={styles.c30}>
          {copyText("app/features/media/impl.152")}
        </h2>
        <p className={styles.c31}>{copyText("app/features/media/impl.153")}</p>
      </div>
      {initializationError && (
        <p className={styles.c110}>{message(initializationError)}</p>
      )}
      {initialization && (
        <section className={styles.c81}>
          <div className={styles.c95}>
            <h3 className={styles.c60}>
              {copyText("app/features/media/impl.154")}
            </h3>
            <span className={styles.c32}>
              {initialization.clips.length}
              {copyText("app/features/media/impl.31")}
            </span>
          </div>
          <div className={styles.c111}>
            {initialization.clips.map((clip) => (
              <div key={clip.shotId} className={styles.c112}>
                {clip.startSeconds.toFixed(1)}
                {copyText("app/features/media/impl.155")}
                {clip.title} · {animaticMediaLabel(clip.mediaKind)}
              </div>
            ))}
            {!initialization.clips.length && (
              <p className={styles.c14}>
                {copyText("app/features/media/impl.156")}
              </p>
            )}
          </div>
          <label className={styles.c113}>
            {copyText("app/features/media/impl.157")}
            <textarea
              className={styles.c79}
              value={annotations}
              onChange={(event) => setAnnotations(event.target.value)}
              placeholder={copyText("app/features/media/impl.158")}
            />
          </label>
          <BareButton
            className={styles.c114}
            disabled={!initialization.clips.length}
            onClick={() => void save()}
          >
            {copyText("app/features/media/impl.159")}
          </BareButton>
        </section>
      )}
      <section className={styles.c81}>
        <h3 className={styles.c60}>
          {copyText("app/features/media/impl.160")}
        </h3>
        <div className={styles.c82}>
          {!drafts.length && (
            <p className={styles.c14}>
              {copyText("app/features/media/impl.161")}
            </p>
          )}
          {drafts.map((draft) => (
            <article key={draft.id} className={styles.c94}>
              <div className={styles.c95}>
                <span>
                  {draft.clips.length}
                  {copyText("app/features/media/impl.162")}{" "}
                  {animaticStatusLabel(draft.status)}
                </span>
                {draft.status === "draft" && (
                  <div className={styles.c96}>
                    <BareButton
                      className={styles.c50}
                      onClick={() =>
                        void review(draft.id, "approved", draft.version)
                      }
                    >
                      {copyText("app/features/media/impl.163")}
                    </BareButton>
                    <BareButton
                      className={styles.c97}
                      onClick={() =>
                        void review(draft.id, "returned", draft.version)
                      }
                    >
                      {copyText("app/features/media/impl.164")}
                    </BareButton>
                  </div>
                )}
              </div>
              {draft.annotations && (
                <p className={styles.c38}>
                  {copyText("app/features/media/impl.165")}
                  {draft.annotations}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
      {notice && <p className={styles.c22}>{notice}</p>}
    </section>
  );
}

export function timelineTrackLabel(
  kind: TimelineManifest["tracks"][number]["kind"],
): string {
  return {
    video: "视频",
    dialogue: "对白",
    narration: "旁白",
    bgm: "配乐",
    sfx: "音效",
    subtitle: "字幕",
  }[kind];
}

export function timelineMediaStatusLabel(
  status: TimelineManifest["tracks"][number]["clips"][number]["mediaStatus"],
): string {
  return {
    linked: "已链接",
    missing: "文件缺失",
    unsupported: "编码不支持",
    proxy: "使用代理",
    unattached: "未附加媒体",
  }[status];
}

export function TimelineEditorPanel(props: {
  projectId: string;
  adaptationId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const playback = useRef<TimelinePreviewControls | undefined>(undefined);
  const seekPreview = (value: number) => {
    if (playback.current) playback.current.seek(value);
    else setPlayhead(value);
  };
  const [zoom, setZoom] = useState(56);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [moveStart, setMoveStart] = useState("");
  const [trimStart, setTrimStart] = useState("");
  const [trimDuration, setTrimDuration] = useState("");
  const [relinkAssetId, setRelinkAssetId] = useState("");
  const [clipVolume, setClipVolume] = useState("1");
  const [includeAssemblySubtitles, setIncludeAssemblySubtitles] =
    useState(true);
  const [selectedAssemblyTrackIds, setSelectedAssemblyTrackIds] = useState<
    string[]
  >([]);
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  const [deliveryWorking, setDeliveryWorking] = useState<
    TimelineDeliveryExportFormat | undefined
  >();
  const assemblyRequestKeys = useRef(new Map<string, string>());
  const { data: timeline, error } = useQuery({
    queryKey: ["timeline", props.episodeId],
    queryFn: () => client.timeline.get(props.episodeId),
  });
  const framesPerSecond = timeline
    ? timeline.profile.frameRate.numerator /
      timeline.profile.frameRate.denominator
    : 25;
  const timelineDurationSeconds = timeline
    ? timeline.durationFrames / framesPerSecond
    : 0;
  const frameToSeconds = (frame: number) => frame / framesPerSecond;
  const secondsToFrame = (seconds: number) =>
    Math.max(0, Math.round(seconds * framesPerSecond));
  const { data: history } = useQuery({
    queryKey: ["timeline", "history", timeline?.id],
    queryFn: () => client.timeline.history(timeline!.id),
    enabled: Boolean(timeline?.id),
  });
  const { data: deliveryManifest, error: deliveryError } = useQuery({
    queryKey: [
      "timeline",
      "delivery",
      props.projectId,
      props.episodeId,
      timeline?.version,
    ],
    queryFn: () => client.timeline.deliveryManifest(props.episodeId),
    enabled: Boolean(timeline?.id),
  });
  const {
    data: audioAssembly,
    isFetching: isLoadingAudioAssembly,
    refetch: refetchAudioAssembly,
  } = useQuery({
    queryKey: ["timeline", "audio-assembly", props.episodeId],
    queryFn: () => client.timeline.audioAssemblyPreview(props.episodeId),
    enabled: false,
  });
  const { data: mediaAssets = [] } = useQuery({
    queryKey: ["timeline", "media-assets", props.projectId],
    queryFn: async () =>
      (
        await Promise.all(
          ["assets", "visual-assets", "video", "shot-stills"].map((domain) =>
            client.resources.list(domain, props.projectId),
          ),
        )
      ).flat(),
  });
  const selected = timeline?.tracks
    .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .find((item) => item.clip.id === selectedClipId);
  useEffect(() => {
    if (!timeline) return;
    const found = timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === selectedClipId);
    if (!found)
      setSelectedClipId(
        timeline.tracks.flatMap((track) => track.clips)[0]?.id ?? "",
      );
  }, [selectedClipId, timeline]);
  useEffect(() => {
    if (!selected) return;
    setMoveStart(String(frameToSeconds(selected.clip.startFrame)));
    setTrimStart(String(frameToSeconds(selected.clip.startFrame)));
    setTrimDuration(String(frameToSeconds(selected.clip.durationFrames)));
    setRelinkAssetId(selected.clip.assetId ?? "");
    setClipVolume(String(selected.clip.volume ?? 1));
  }, [selectedClipId]);

  const refreshHistory = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["timeline", "history", timeline?.id],
    });
  };
  const apply = async (command: TimelineEditCommand) => {
    if (!timeline) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const saved = await client.timeline.command(timeline.id, {
        version: timeline.version,
        command,
      });
      queryClient.setQueryData(["timeline", props.episodeId], saved);
      setNotice("编辑已自动保存；源媒体没有被修改。");
      await Promise.all([
        refreshHistory(),
        queryClient.invalidateQueries({
          queryKey: ["timeline", "delivery", props.episodeId],
        }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const restore = async (direction: "undo" | "redo") => {
    if (!timeline) return;
    setWorking(true);
    try {
      const saved = await client.timeline[direction](timeline.id);
      queryClient.setQueryData(["timeline", props.episodeId], saved);
      setNotice(
        direction === "undo" ? "已撤销最近一次编辑。" : "已重做最近一次编辑。",
      );
      await Promise.all([
        refreshHistory(),
        queryClient.invalidateQueries({
          queryKey: ["timeline", "delivery", props.episodeId],
        }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const selectClip = (id: string) => {
    setSelectedClipId(id);
    const found = timeline?.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === id);
    if (found) seekPreview(frameToSeconds(found.startFrame));
  };
  const reviewAudioAssembly = async () => {
    try {
      const result = await refetchAudioAssembly();
      if (result.data) {
        setSelectedAssemblyTrackIds([
          ...new Set(result.data.clips.map((clip) => clip.audioTrackId)),
        ]);
        setNotice("已生成自动编排预览；请试听、核对字幕和保护项后再采用。");
      }
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const applyAudioAssembly = async () => {
    if (!timeline || !audioAssembly) return;
    setWorking(true);
    try {
      const input = {
        timelineId: audioAssembly.timelineId,
        timelineVersion: audioAssembly.timelineVersion,
        sourceFingerprint: audioAssembly.sourceFingerprint,
        audioTrackIds: selectedAssemblyTrackIds,
        includeSubtitles: includeAssemblySubtitles,
      };
      const identity = JSON.stringify(input);
      let key = assemblyRequestKeys.current.get(identity);
      if (!key) {
        key = crypto.randomUUID();
        assemblyRequestKeys.current.set(identity, key);
      }
      const saved = await client.timeline.applyAudioAssembly(
        props.episodeId,
        input,
        key,
      );
      queryClient.setQueryData(["timeline", props.episodeId], saved);
      setNotice(
        "已采用选中的自动编排；人工移动、裁切、音量和锁定片段保持不变。",
      );
      await Promise.all([
        refreshHistory(),
        queryClient.invalidateQueries({
          queryKey: ["timeline", "audio-assembly", props.episodeId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["timeline", "delivery", props.episodeId],
        }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const onKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) void restore("redo");
      else void restore("undo");
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      playback.current?.toggle();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekPreview(Math.max(0, playhead - 1));
    }
    if (event.key === "ArrowRight" && timeline) {
      event.preventDefault();
      seekPreview(Math.min(timelineDurationSeconds, playhead + 1));
    }
  };
  const exportDelivery = async (format: TimelineDeliveryExportFormat) => {
    setDeliveryWorking(format);
    setNotice(undefined);
    try {
      const document = await client.timeline.exportDelivery(
        props.episodeId,
        format,
      );
      const result = await client.host.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setNotice(result.saved ? "已导出可重链接时间线资料。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setDeliveryWorking(undefined);
    }
  };

  if (error) return <p className={styles.c54}>{message(error)}</p>;
  if (!timeline)
    return (
      <p className={styles.c11}>{copyText("app/features/media/impl.166")}</p>
    );
  const pixels = Math.max(680, timelineDurationSeconds * zoom + 120);
  return (
    <section
      className={styles.c72}
      aria-label={copyText("app/features/media/impl.167")}
      tabIndex={0}
      onKeyDown={onKeyboard}
    >
      <div className={styles.c13}>
        <div>
          <p className={styles.c14}>
            {copyText("app/features/media/impl.168")}
          </p>
          <h2 className={styles.c115}>
            {copyText("app/features/media/impl.169")}
          </h2>
          <p className={styles.c31}>
            {copyText("app/features/media/impl.170")}
          </p>
        </div>
        <p className={styles.c32}>
          {copyText("app/features/media/impl.171")}
          {timeline.version}
          {copyText("app/features/media/impl.172")}
          {timelineDurationSeconds.toFixed(2)}
          {copyText("app/features/media/impl.173")} {timeline.durationFrames}
          {copyText("app/features/media/impl.174")}
        </p>
      </div>
      <section
        className={styles.c116}
        aria-label={copyText("app/features/media/impl.175")}
      >
        <div className={styles.c13}>
          <div>
            <h3 className={styles.c60}>
              {copyText("app/features/media/impl.176")}
            </h3>
            <p className={styles.c38}>
              {copyText("app/features/media/impl.177")}
            </p>
          </div>
          <BareButton
            className={styles.c117}
            disabled={isLoadingAudioAssembly || working}
            onClick={() => void reviewAudioAssembly()}
          >
            {isLoadingAudioAssembly ? "正在生成预览…" : "审查自动编排"}
          </BareButton>
        </div>
        {audioAssembly && (
          <div className={styles.c118}>
            <div className={styles.c119}>
              <p>
                {copyText("app/features/media/impl.178")}
                {audioAssembly.clips.length}
                {copyText("app/features/media/impl.179")}{" "}
                {audioAssembly.subtitleCues.length}
                {copyText("app/features/media/impl.180")}{" "}
                {audioAssembly.protectedClipIds.length}
                {copyText("app/features/media/impl.104")}
              </p>
              {[
                ...new Set(
                  audioAssembly.clips.map((clip) => clip.audioTrackId),
                ),
              ].map((trackId) => {
                const clips = audioAssembly.clips.filter(
                  (clip) => clip.audioTrackId === trackId,
                );
                const first = clips[0]!;
                const checked = selectedAssemblyTrackIds.includes(trackId);
                return (
                  <label key={trackId} className={styles.c120}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedAssemblyTrackIds((current) =>
                          checked
                            ? current.filter((id) => id !== trackId)
                            : [...current, trackId],
                        )
                      }
                    />
                    <span>
                      {timelineTrackLabel(first.kind)} · {first.name} ·{" "}
                      {clips.length}
                      {copyText("app/features/media/impl.181")}{" "}
                      {first.rightsStatus === "cleared"
                        ? "权利已核验"
                        : first.rightsStatus === "restricted"
                          ? "权利受限"
                          : "权利待核验"}
                    </span>
                  </label>
                );
              })}
              <label className={styles.c121}>
                <input
                  type="checkbox"
                  checked={includeAssemblySubtitles}
                  onChange={(event) =>
                    setIncludeAssemblySubtitles(event.target.checked)
                  }
                />
                {copyText("app/features/media/impl.182")}
              </label>
              <BareButton
                className={styles.c122}
                disabled={
                  working ||
                  !selectedAssemblyTrackIds.length ||
                  selectedAssemblyTrackIds.some((trackId) =>
                    audioAssembly.clips.some(
                      (clip) =>
                        clip.audioTrackId === trackId &&
                        clip.rightsStatus === "restricted",
                    ),
                  )
                }
                onClick={() => void applyAudioAssembly()}
              >
                {copyText("app/features/media/impl.183")}
              </BareButton>
            </div>
            <div className={styles.c123}>
              {audioAssembly.warnings.map((warning) => (
                <p key={warning} className={styles.c124}>
                  {warning}
                </p>
              ))}
              {audioAssembly.srt && (
                <details>
                  <summary className={styles.c125}>
                    {copyText("app/features/media/impl.184")}
                  </summary>
                  <pre className={styles.c126}>{audioAssembly.srt}</pre>
                </details>
              )}
            </div>
          </div>
        )}
      </section>
      <section
        className={styles.c116}
        aria-label={copyText("app/features/media/impl.185")}
      >
        <div className={styles.c13}>
          <div>
            <h3 className={styles.c60}>
              {copyText("app/features/media/impl.185")}
            </h3>
            <p className={styles.c38}>
              {copyText("app/features/media/impl.186")}
            </p>
          </div>
          <div className={styles.c20}>
            {(
              [
                ["fcpxml", "导出 FCPXML"],
                ["otio", "导出 OTIO"],
                ["edl", "导出 EDL"],
                ["srt", "导出 SRT"],
                ["vtt", "导出 WebVTT"],
                ["relink", "导出重链接清单"],
                ["manifest", "导出交付清单"],
              ] as const
            ).map(([format, label]) => (
              <BareButton
                key={format}
                className={styles.c127}
                disabled={working || Boolean(deliveryWorking)}
                onClick={() => void exportDelivery(format)}
              >
                {deliveryWorking === format ? "正在导出…" : label}
              </BareButton>
            ))}
          </div>
        </div>
        {deliveryManifest && (
          <div className={styles.c128}>
            <p>
              {copyText("app/features/media/impl.187")}
              {deliveryManifest.timeline.version}
              {copyText("app/features/media/impl.188")}{" "}
              {deliveryManifest.media.length}
              {copyText("app/features/media/impl.189")}{" "}
              {
                deliveryManifest.media.filter((item) => Boolean(item.archive))
                  .length
              }{" "}
              {copyText("app/features/media/impl.190")}
            </p>
            <p>{copyText("app/features/media/impl.191")}</p>
            {deliveryManifest.unsupportedFeatures.length > 0 && (
              <p className={styles.c124}>
                {copyText("app/features/media/impl.192")}
                {deliveryManifest.unsupportedFeatures.join("；")}
              </p>
            )}
            {deliveryManifest.warnings.map((warning) => (
              <p key={warning} className={styles.c124}>
                {warning}
              </p>
            ))}
          </div>
        )}
        {deliveryManifest && (
          <NleMediaVerificationPanel
            manifest={deliveryManifest}
            projectId={props.projectId}
            episodeId={props.episodeId}
            timelineId={timeline.id}
            timelineVersion={timeline.version}
          />
        )}
        {deliveryError && (
          <p className={styles.c129}>{message(deliveryError)}</p>
        )}
      </section>
      <AudioResolutionPanel timeline={timeline} />
      <section className={styles.c130}>
        <div>
          <div className={styles.c131}>
            <BareButton
              className={styles.c132}
              disabled={!previewReady}
              onClick={() => playback.current?.toggle()}
            >
              {playing ? "暂停" : "播放"}
            </BareButton>
            <BareButton className={styles.c133} onClick={() => seekPreview(0)}>
              {copyText("app/features/media/impl.193")}
            </BareButton>
            <BareButton
              className={styles.c134}
              disabled={working || !history?.canUndo}
              onClick={() => void restore("undo")}
            >
              {copyText("app/features/media/impl.194")}
            </BareButton>
            <BareButton
              className={styles.c134}
              disabled={working || !history?.canRedo}
              onClick={() => void restore("redo")}
            >
              {copyText("app/features/media/impl.195")}
            </BareButton>
            <span className={styles.c14}>
              {playhead.toFixed(2)}
              {copyText("app/features/media/impl.196")}
            </span>
          </div>
          <input
            className={styles.c135}
            aria-label={copyText("app/features/media/impl.197")}
            type="range"
            min="0"
            max={timelineDurationSeconds}
            step="0.04"
            value={Math.min(playhead, timelineDurationSeconds)}
            onChange={(event) => seekPreview(Number(event.target.value))}
          />
          <label className={styles.c136}>
            {copyText("app/features/media/impl.198")}
            <input
              aria-label={copyText("app/features/media/impl.199")}
              type="range"
              min="24"
              max="160"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            {zoom}
            {copyText("app/features/media/impl.200")}
          </label>
        </div>
        <TimelinePlaybackPanel
          key={`${timeline.projectId}:${timeline.id}:${timeline.version}`}
          timeline={timeline}
          position={playhead}
          controls={playback}
          onPosition={setPlayhead}
          onPlaying={setPlaying}
          onReady={setPreviewReady}
        />
      </section>
      <section
        className={styles.c137}
        aria-label={copyText("app/features/media/impl.201")}
      >
        <div className={styles.c138} style={{ width: pixels }}>
          <div className={styles.c139}>
            {Array.from(
              { length: Math.ceil(timelineDurationSeconds) + 1 },
              (_, second) => (
                <span
                  key={second}
                  className={styles.c140}
                  style={{ left: second * zoom }}
                >
                  {second}
                  {copyText("app/features/media/impl.202")}
                </span>
              ),
            )}
            <span className={styles.c141} style={{ left: playhead * zoom }} />
          </div>
          <div className={styles.c142}>
            {timeline.tracks.map((track) => (
              <div key={track.id} className={styles.c143}>
                <div className={styles.c144}>
                  <p className={styles.c60}>{timelineTrackLabel(track.kind)}</p>
                  <div className={styles.c145}>
                    <BareButton
                      aria-label={copyText("app/features/media/impl.235", {
                        p1: timelineTrackLabel(track.kind),
                      })}
                      className={clsx(
                        styles.c146,
                        track.muted ? styles.k11 : styles.k12,
                      )}
                      onClick={() =>
                        void apply({
                          type: "set-track-audio",
                          trackId: track.id,
                          muted: !track.muted,
                        })
                      }
                    >
                      {copyText("app/features/media/impl.203")}
                    </BareButton>
                    <BareButton
                      aria-label={copyText("app/features/media/impl.236", {
                        p1: timelineTrackLabel(track.kind),
                      })}
                      className={clsx(
                        styles.c146,
                        track.solo ? styles.k13 : styles.k12,
                      )}
                      onClick={() =>
                        void apply({
                          type: "set-track-audio",
                          trackId: track.id,
                          solo: !track.solo,
                        })
                      }
                    >
                      {copyText("app/features/media/impl.204")}
                    </BareButton>
                  </div>
                </div>
                <div className={styles.c147} style={{ width: pixels - 120 }}>
                  <span
                    className={styles.c148}
                    style={{ left: playhead * zoom }}
                  />
                  {track.clips.map((clip) => (
                    <BareButton
                      key={clip.id}
                      aria-label={copyText("app/features/media/impl.237", {
                        p1: clip.name,
                      })}
                      className={clsx(
                        styles.c149,
                        selectedClipId === clip.id
                          ? styles.k14
                          : clip.mediaStatus === "linked"
                            ? styles.k15
                            : styles.k16,
                      )}
                      style={{
                        left: frameToSeconds(clip.startFrame) * zoom,
                        width: Math.max(
                          42,
                          frameToSeconds(clip.durationFrames) * zoom - 2,
                        ),
                      }}
                      onClick={() => selectClip(clip.id)}
                    >
                      {clip.name} · {timelineMediaStatusLabel(clip.mediaStatus)}
                    </BareButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {selected && (
        <section className={styles.c150}>
          <div>
            <h3 className={styles.c60}>{selected.clip.name}</h3>
            <p className={styles.c38}>
              {timelineTrackLabel(selected.track.kind)} ·{" "}
              {timelineMediaStatusLabel(selected.clip.mediaStatus)} ·{" "}
              {selected.clip.locked
                ? "已锁定，自动编排受保护"
                : selected.clip.manuallyEdited
                  ? "有人工编辑"
                  : "源装配"}
            </p>
            {selected.clip.text && (
              <p className={styles.c151}>{selected.clip.text}</p>
            )}
          </div>
          <div className={styles.c152}>
            <label className={styles.c153}>
              {copyText("app/features/media/impl.205")}
              <input
                className={styles.c154}
                type="number"
                min="0"
                step="0.04"
                value={moveStart}
                onChange={(event) => setMoveStart(event.target.value)}
              />
            </label>
            <BareButton
              className={styles.c155}
              disabled={working}
              onClick={() =>
                void apply({
                  type: "move",
                  clipId: selected.clip.id,
                  startFrame: secondsToFrame(Number(moveStart)),
                })
              }
            >
              {copyText("app/features/media/impl.206")}
            </BareButton>
            <label className={styles.c153}>
              {copyText("app/features/media/impl.207")}
              <input
                className={styles.c154}
                type="number"
                min="0"
                step="0.04"
                value={trimStart}
                onChange={(event) => setTrimStart(event.target.value)}
              />
            </label>
            <label className={styles.c153}>
              {copyText("app/features/media/impl.208")}
              <input
                className={styles.c154}
                type="number"
                min="0.04"
                step="0.04"
                value={trimDuration}
                onChange={(event) => setTrimDuration(event.target.value)}
              />
            </label>
            <BareButton
              className={styles.c156}
              disabled={working}
              onClick={() =>
                void apply({
                  type: "trim",
                  clipId: selected.clip.id,
                  startFrame: secondsToFrame(Number(trimStart)),
                  durationFrames: Math.max(
                    1,
                    secondsToFrame(Number(trimDuration)),
                  ),
                })
              }
            >
              {copyText("app/features/media/impl.209")}
            </BareButton>
            <BareButton
              className={styles.c156}
              disabled={working}
              onClick={() =>
                void apply({
                  type: "split",
                  clipId: selected.clip.id,
                  atFrame:
                    selected.clip.startFrame +
                    Math.floor(selected.clip.durationFrames / 2),
                })
              }
            >
              {copyText("app/features/media/impl.210")}
            </BareButton>
            {["dialogue", "narration", "bgm", "sfx"].includes(
              selected.track.kind,
            ) && (
              <>
                <label className={styles.c153}>
                  {copyText("app/features/media/impl.211")}
                  <input
                    className={styles.c154}
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    value={clipVolume}
                    onChange={(event) => setClipVolume(event.target.value)}
                  />
                </label>
                <BareButton
                  className={styles.c155}
                  disabled={working}
                  onClick={() =>
                    void apply({
                      type: "set-clip-audio",
                      clipId: selected.clip.id,
                      volume: Number(clipVolume),
                    })
                  }
                >
                  {copyText("app/features/media/impl.212")}
                </BareButton>
                <BareButton
                  className={styles.c157}
                  disabled={working}
                  onClick={() =>
                    void apply({
                      type: "set-clip-audio",
                      clipId: selected.clip.id,
                      locked: !selected.clip.locked,
                    })
                  }
                >
                  {selected.clip.locked ? "解除编排锁定" : "锁定，保护自动编排"}
                </BareButton>
              </>
            )}
          </div>
          <div className={styles.c158}>
            <label className={styles.c153}>
              {copyText("app/features/media/impl.213")}
              <NativeSelect
                className={styles.c159}
                value={relinkAssetId}
                onChange={(event) => setRelinkAssetId(event.target.value)}
              >
                <option value="">
                  {copyText("app/features/media/impl.214")}
                </option>
                {mediaAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <BareButton
              className={styles.c160}
              disabled={working || !relinkAssetId}
              onClick={() =>
                void apply({
                  type: "relink",
                  clipId: selected.clip.id,
                  assetId: relinkAssetId,
                })
              }
            >
              {copyText("app/features/media/impl.215")}
            </BareButton>
          </div>
        </section>
      )}
      {notice && <p className={styles.c22}>{notice}</p>}
    </section>
  );
}

export function EpisodeRenderPreflightPanel(props: { episodeId: string }) {
  const client = useStudio();
  const {
    data: preflight,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["episode-render-preflight", props.episodeId],
    queryFn: () => client.episodeMedia.renderPreflight(props.episodeId),
  });
  return (
    <section className={styles.c28}>
      <div className={styles.c13}>
        <div>
          <h2 className={styles.c30}>
            {copyText("app/features/media/impl.216")}
          </h2>
          <p className={styles.c31}>
            {copyText("app/features/media/impl.217")}
          </p>
        </div>
        <BareButton
          className={styles.c161}
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "正在预检…" : "重新执行预检"}
        </BareButton>
      </div>
      {error && <p className={styles.c162}>{message(error)}</p>}
      {preflight && (
        <div className={styles.c163}>
          <section
            className={clsx(styles.c164, preflight.ok ? styles.k7 : styles.k8)}
          >
            <h3 className={styles.c60}>
              {preflight.ok ? "制作输入完整" : "尚不能提交渲染"}
            </h3>
            <p className={styles.c165}>
              {copyText("app/features/media/impl.218")}
              {preflight.durationSeconds.toFixed(1)}
              {copyText("app/features/media/impl.219")}
              {preflight.audioTrackIds.length}
              {copyText("app/features/media/impl.220")}
            </p>
          </section>
          <section className={styles.c88}>
            <h3 className={styles.c60}>
              {copyText("app/features/media/impl.221")}
            </h3>
            {preflight.blockers.length ? (
              <ul className={styles.c166}>
                {preflight.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.c167}>
                {copyText("app/features/media/impl.222")}
              </p>
            )}
          </section>
          <section className={styles.c168}>
            <h3 className={styles.c60}>
              {copyText("app/features/media/impl.223")}
            </h3>
            <ul className={styles.c166}>
              {preflight.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}

export function audioTrackKindLabel(kind: AudioTrack["kind"]): string {
  return { dialogue: "对白", narration: "旁白", bgm: "配乐", sfx: "音效" }[
    kind
  ];
}

export function animaticMediaLabel(
  kind: AnimaticInitialization["clips"][number]["mediaKind"],
): string {
  return { video: "视频", still: "静帧", missing: "缺少媒体" }[kind];
}

export function animaticStatusLabel(
  status: "draft" | "approved" | "returned",
): string {
  return { draft: "待审核", approved: "已通过", returned: "已退回" }[status];
}

export function ProductionGraphPanel(props: { projectId: string }) {
  const client = useStudio();
  const { data: graph, error } = useQuery({
    queryKey: ["production-graph", props.projectId],
    queryFn: () => client.production.graph(props.projectId),
  });
  const [impact, setImpact] =
    useState<Awaited<ReturnType<typeof client.production.impact>>>();
  const impactPreview = useMutation({
    mutationFn: (sourceId: string) =>
      client.production.impact({ projectId: props.projectId, sourceId }),
    onSuccess: setImpact,
  });
  if (error) return <p className={styles.c54}>{message(error)}</p>;
  if (!graph)
    return (
      <p className={styles.c169}>{copyText("app/features/media/impl.224")}</p>
    );
  const stages = [
    ["分集", graph.coverage.episodes],
    ["剧本", graph.coverage.scripts],
    ["场景", graph.coverage.scenes],
    ["分镜", graph.coverage.shots],
    ["素材", graph.coverage.assets],
    ["静帧已采用", `${graph.coverage.adoptedStills}/${graph.coverage.stills}`],
  ] as const;
  return (
    <section className={styles.c28}>
      <div>
        <h2 className={styles.c30}>
          {copyText("app/features/media/impl.225")}
        </h2>
        <p className={styles.c31}>{copyText("app/features/media/impl.226")}</p>
      </div>
      <dl className={styles.c170}>
        {stages.map(([label, value]) => (
          <div key={label} className={styles.c171}>
            <dt className={styles.c32}>{label}</dt>
            <dd className={styles.c115}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.c172}>
        {graph.nodes.slice(1, 30).map((node) => (
          <BareButton
            key={node.id}
            className={styles.c173}
            disabled={
              impactPreview.isPending ||
              node.kind === "chapter" ||
              node.kind === "project"
            }
            onClick={() => impactPreview.mutate(node.id)}
            title={copyText("app/features/media/impl.227")}
          >
            {domainLabel(node.kind)} · {node.title} ·{" "}
            {productStatusLabel(node.status)}
          </BareButton>
        ))}
        {graph.nodes.length <= 1 && (
          <p className={styles.c14}>
            {copyText("app/features/media/impl.228")}
          </p>
        )}
      </div>
      {impactPreview.isPending && (
        <p className={styles.c174}>{copyText("app/features/media/impl.229")}</p>
      )}
      {impactPreview.error && (
        <p className={styles.c162}>{message(impactPreview.error)}</p>
      )}
      {impact && (
        <div className={styles.c175}>
          <p className={styles.c176}>{impact.summary}</p>
          {impact.affected.length > 0 && (
            <p className={styles.c177}>
              {impact.affected
                .slice(0, 12)
                .map((node) => `${domainLabel(node.kind)}：${node.title}`)
                .join("；")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function useMediaDraft(key: string, initial: string) {
  const [draft, setDraft] = useState<{ key: string; value: string }>();
  return [
    draft?.key === key
      ? draft.value
      : (window.localStorage.getItem(key) ?? initial),
    (value: string) => {
      setDraft({ key, value });
      window.localStorage.setItem(key, value);
    },
  ] as const;
}
