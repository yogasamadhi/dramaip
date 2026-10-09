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
import { BareButton } from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildStoryboard,
  reorderStoryboardShots,
  type StoryboardScene,
  type StoryboardShot,
} from "../../storyboard-board";
import {
  StageNavigation,
  WorkspaceIntro,
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
      label: "导演看板",
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
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="制作工作区"
        title="素材与视听制作"
        description="素材、版权和视觉资产归属项目；静帧与视频归属分镜；音频、动态分镜与渲染预检归属分集。"
        badge="远程媒体生成"
      />
      <div className="workbench space-y-4 rounded-xl border border-line bg-surface-muted p-4 shadow-float dark:bg-studio-dark">
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
          <section className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1 text-sm">
              项目
              <select
                className="rounded-lg border border-line px-3 py-2"
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
                <option value="">选择项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              改编项目
              <select
                className="rounded-lg border border-line px-3 py-2"
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
                <option value="">选择改编项目</option>
                {adaptations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              分集
              <select
                className="rounded-lg border border-line px-3 py-2"
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
                <option value="">选择分集</option>
                {episodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              剧本
              <select
                className="rounded-lg border border-line px-3 py-2"
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
                <option value="">选择剧本</option>
                {scripts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              场景
              <select
                className="rounded-lg border border-line px-3 py-2"
                disabled={!scriptId}
                value={sceneId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSceneId(nextId);
                  setShotId("");
                  syncRoute({ sceneId: nextId, shotId: "" });
                }}
              >
                <option value="">选择场景</option>
                {scenes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              分镜
              <select
                className="rounded-lg border border-line px-3 py-2"
                disabled={!sceneId}
                value={shotId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setShotId(nextId);
                  syncRoute({ shotId: nextId });
                }}
              >
                <option value="">选择分镜</option>
                {shots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </WorkspaceObjectControls>
        <nav
          aria-label="制作工作分组"
          className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1 lg:grid-cols-4"
        >
          {stageGroups.map((group) => (
            <BareButton
              key={group.id}
              className={`rounded-md px-3 py-2 text-sm font-medium ${activeStageGroup.id === group.id ? "bg-surface-raised text-ink shadow-control" : "text-muted hover:text-ink"}`}
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
        {projectId ? (
          <details className="rounded-lg border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-muted">
              查看完整依赖与覆盖摘要
            </summary>
            <div className="mt-3">
              <ProductionGraphPanel projectId={projectId} />
            </div>
          </details>
        ) : null}
        {!projectId ? (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            请先选择项目，再登记或制作素材。
          </p>
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
          <div className="space-y-4">
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
            title="制作"
            domains={[stage]}
            projectId={projectId}
            parentId={parentId}
            parentRequired={parentRequired}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            请先选择此制作阶段所需的分集或分镜。
          </p>
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
    <section className="space-y-5" aria-label="导演分镜看板">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">集级导演工作台</p>
          <h2 className="mt-1 text-2xl font-semibold">卡片式导演分镜看板</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            按场景扫视镜头、静帧和锁定资产。重排只提交同一场景的完整镜头集合，并以版本号防止并发覆盖。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-3 py-1.5 text-sm text-brand">
          {storyboard.reduce((total, scene) => total + scene.shots.length, 0)}{" "}
          个镜头
        </span>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          搜索镜头、对白或资产
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：雨夜、门缝、林晚"
          />
        </label>
        <div className="grid gap-1 text-sm">
          风险筛选
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="分镜筛选"
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
                className={`rounded-full px-3 py-1.5 text-sm ${filter === value ? "bg-brand text-white" : "bg-canvas text-muted ring-1 ring-line"}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </BareButton>
            ))}
          </div>
        </div>
      </div>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {contextShot && (
        <p
          className="rounded-lg border border-brand/25 bg-brand-soft p-3 text-sm text-brand-strong"
          aria-label="当前分镜上下文"
        >
          当前分镜：{contextShot.shot.title}
          。后续资产与智能任务会沿用该镜头上下文。
        </p>
      )}
      {(selectedIds.length > 0 || undo) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          {selectedIds.length > 0 && (
            <span>已选 {selectedIds.length} 个镜头</span>
          )}
          {selectedShot && (
            <BareButton
              className="rounded-lg border border-brand px-3 py-1.5 text-brand"
              onClick={() =>
                props.onOpenAssetCenter(
                  selectedShot.shot.id,
                  selectedShot.scene.id,
                  selectedShot.scene.scriptId,
                )
              }
            >
              查看选定镜头的资产用途
            </BareButton>
          )}
          {selectedIds.length > 0 && (
            <BareButton
              className="rounded-lg border border-line px-3 py-1.5 text-muted"
              onClick={() => setSelectedIds([])}
            >
              清除选择
            </BareButton>
          )}
          {undo && (
            <BareButton
              className="rounded-lg border border-brand px-3 py-1.5 text-brand disabled:opacity-50"
              disabled={Boolean(savingSceneId)}
              onClick={() => void undoReorder()}
            >
              撤销上次重排
            </BareButton>
          )}
        </div>
      )}
      {visibleScenes.map((scene) => {
        const shownShots = scene.shots.slice(0, visiblePerScene);
        return (
          <section
            key={scene.id}
            className="rounded-xl border border-line bg-surface p-4"
            aria-label={`场景：${scene.title}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{scene.title}</h3>
                <p className="mt-1 text-sm text-muted">
                  {scene.location || "未填写地点与时间"} · {scene.shots.length}{" "}
                  个镜头
                </p>
              </div>
              <span className="text-xs text-muted">
                {savingSceneId === scene.id
                  ? "正在保存顺序…"
                  : "可拖拽或用 Alt + ↑/↓ 重排"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
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
                    className={`rounded-xl border p-4 ${props.selectedShotId === shot.id ? "border-brand bg-brand-soft" : "border-line bg-canvas"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <BareButton
                          className="text-left text-sm font-semibold hover:text-brand"
                          aria-label={`选择分镜：${shot.title}`}
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
                        <p className="mt-1 text-xs text-muted">
                          {shot.visualDescription}
                        </p>
                      </div>
                      <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(shot.id)}
                          aria-label={`批量选择：${shot.title}`}
                          onChange={() => toggleSelected(shot.id)}
                        />
                        选择
                      </label>
                    </div>
                    <div
                      className="mt-3 rounded-lg border border-dashed border-line bg-surface-raised p-3 text-xs text-muted"
                      aria-label={`静帧预览：${stillStateLabel(shot.stillState)}`}
                    >
                      {stillStateLabel(shot.stillState)}
                      ；本卡片只显示真实静帧状态，未附带受控媒体时不伪造缩略图。
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted">对白</dt>
                        <dd>{shot.dialogue || "无对白"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">景别 / 机位</dt>
                        <dd>{shot.camera || "未填写"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">运镜 / 时长</dt>
                        <dd>
                          {[shot.movement, shot.duration]
                            .filter(Boolean)
                            .join(" · ") || "未填写"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">任务状态</dt>
                        <dd>{shot.taskStatus}</dd>
                      </div>
                    </dl>
                    <div
                      className="mt-3 flex flex-wrap gap-1.5"
                      aria-label={`${shot.title} 资产覆盖`}
                    >
                      {(["character", "scene", "prop", "voice"] as const).map(
                        (category) => (
                          <span
                            key={category}
                            className="rounded-full bg-surface-raised px-2 py-1 text-xs text-muted ring-1 ring-line"
                          >
                            {ASSET_CATEGORY_LABELS[category]}{" "}
                            {shot.categoryCounts[category]}
                          </span>
                        ),
                      )}
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${shot.lockedAssetCount ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                      >
                        {shot.lockedAssetCount
                          ? `已锁 ${shot.lockedAssetCount}`
                          : "暂无锁定资产"}
                      </span>
                      {shot.missingAssetReference && (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          缺资产引用
                        </span>
                      )}
                      {shot.rightsBlocked && (
                        <span className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-700">
                          权利 / stale 阻断
                        </span>
                      )}
                      {shot.costRisk && (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          费用或服务风险
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                        disabled={Boolean(savingSceneId) || fullIndex === 0}
                        onClick={() => move(scene, shot.id, -1)}
                      >
                        上移
                      </BareButton>
                      <BareButton
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                        disabled={
                          Boolean(savingSceneId) ||
                          fullIndex === scene.shots.length - 1
                        }
                        onClick={() => move(scene, shot.id, 1)}
                      >
                        下移
                      </BareButton>
                      <BareButton
                        className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                        onClick={() =>
                          props.onOpenAssetCenter(
                            shot.id,
                            scene.id,
                            scene.scriptId,
                          )
                        }
                      >
                        查看资产用途
                      </BareButton>
                    </div>
                  </article>
                );
              })}
            </div>
            {scene.shots.length > shownShots.length && (
              <BareButton
                className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-muted"
                onClick={() => setVisiblePerScene((current) => current + 50)}
              >
                继续加载该场景的{" "}
                {Math.min(50, scene.shots.length - shownShots.length)} 个镜头
              </BareButton>
            )}
          </section>
        );
      })}
      {!visibleScenes.length && (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          当前分集尚无可展示的分镜；可先在改编区建立场景和镜头，或调整筛选条件。
        </p>
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
  return asset.adopted ? "已采用" : "候选版本";
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
        setNotice("最多并排比较 4 个候选版本。");
        return current;
      }
      return [...current, id];
    });
  };
  return (
    <section className="space-y-5" aria-label="资产中心">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">导演资产工作台</p>
          <h2 className="mt-1 text-2xl font-semibold">统一资产中心</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            角色、场景、道具和音色的候选版本共用同一份本地实体记录；媒体只保留受控归档引用，不在此复制二进制或暴露路径。
          </p>
        </div>
        <BareButton
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
          onClick={props.onOpenCatalog}
        >
          新建资产候选
        </BareButton>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          搜索资产或关联对象
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：林晚、雨夜门口"
          />
        </label>
        <label className="grid gap-1 text-sm">
          镜头用途
          <select
            className="min-w-56 rounded-lg border border-line px-3 py-2"
            value={shotId}
            onChange={(event) => setShotId(event.target.value)}
          >
            <option value="">选择镜头以分配或迁移</option>
            {shots.map((shot) => (
              <option key={shot.id} value={shot.id}>
                {shot.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="资产类型筛选"
      >
        {(["all", "character", "scene", "prop", "voice"] as const).map(
          (item) => (
            <BareButton
              key={item}
              className={`rounded-full px-3 py-1.5 text-sm ${category === item ? "bg-brand text-white" : "bg-surface text-muted ring-1 ring-line"}`}
              onClick={() => setCategory(item)}
            >
              {item === "all" ? "全部资产" : ASSET_CATEGORY_LABELS[item]}
            </BareButton>
          ),
        )}
      </div>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {message(error)}
        </p>
      )}
      {compared.length > 0 && (
        <section
          className="rounded-xl border border-brand bg-brand-soft/30 p-4"
          aria-label="资产版本比较"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">候选版本比较</h3>
              <p className="mt-1 text-sm text-muted">
                比较不会改变采用、锁定或镜头引用。
              </p>
            </div>
            <BareButton
              className="text-sm text-brand"
              onClick={() => setCompareIds([])}
            >
              清空比较
            </BareButton>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {compared.map((asset) => (
              <article
                key={asset.id}
                className="rounded-xl border border-line bg-surface-raised p-3 text-sm"
              >
                <p className="font-medium">{asset.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {asset.assetVersion} · {assetStatusLabel(asset)}
                </p>
                <p className="mt-3 line-clamp-3 text-muted">
                  {asset.preview.label ?? "没有可展示的本地预览说明。"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((asset) => (
          <article
            key={asset.id}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-brand">
                  {ASSET_CATEGORY_LABELS[asset.category]} · {asset.subject}
                </p>
                <h3 className="mt-1 truncate font-semibold">{asset.title}</h3>
                <p className="mt-1 text-xs text-muted">
                  版本 {asset.assetVersion}
                </p>
              </div>
              <BareButton
                className={`rounded-md px-2 py-1 text-xs ${compareIds.includes(asset.id) ? "bg-brand text-white" : "border border-line text-muted"}`}
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
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted">采用</dt>
                <dd>{asset.adopted ? "已采用" : "候选"}</dd>
              </div>
              <div>
                <dt className="text-muted">锁定</dt>
                <dd>{asset.lockStatus === "locked" ? "已锁定" : "未锁定"}</dd>
              </div>
              <AssetDeclarationStatus asset={asset} />
            </dl>
            {asset.usages.length > 0 && (
              <p className="mt-3 rounded-lg bg-brand-soft/50 p-2 text-xs text-brand">
                正在用于：
                {asset.usages.map((usage) => usage.shotTitle).join("、")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {!asset.adopted && (
                <BareButton
                  className="rounded-md border border-brand px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "adopt")}
                >
                  采用此版本
                </BareButton>
              )}
              {asset.adopted && asset.lockStatus === "unlocked" && (
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "lock")}
                >
                  锁定版本
                </BareButton>
              )}
              {asset.lockStatus === "locked" && (
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "unlock")}
                >
                  解除锁定
                </BareButton>
              )}
              {asset.adopted && asset.lockStatus === "locked" && (
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "assign-shot")}
                >
                  分配到镜头
                </BareButton>
              )}
              {asset.usages.some((usage) => usage.shotId === shotId) && (
                <BareButton
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                  disabled={workingId === asset.id}
                  onClick={() => void action(asset, "remove-shot")}
                >
                  移除镜头用途
                </BareButton>
              )}
            </div>
          </article>
        ))}
        {!filtered.length && (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            当前筛选下没有资产候选。可先新建角色、场景、道具或音色版本。
          </p>
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
        `已归档 ${result.candidates.length} 张候选图片，请人工采用后进入动态分镜。`,
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
      setNotice("已采用该静帧候选。后续动态分镜会优先引用它。");
      await queryClient.invalidateQueries({
        queryKey: ["resource", "shot-stills", props.projectId, props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <details className="mb-3">
        <summary className="cursor-pointer text-sm text-brand">
          AI 完善本镜头提示词
        </summary>
        <CreationRecordWorkbench
          projectId={props.projectId}
          targetId={props.shotId}
          domain="shots"
          operation="shot-prompt"
        />
      </details>
      <div>
        <h2 className="font-semibold">图片生成与静帧采用</h2>
        <p className="mt-1 text-sm text-muted">
          服务端只会请求已配置的厂商图片 API 或 Stable Diffusion WebUI
          服务；结果先归档为候选静帧，不会自动替换已采用版本。
        </p>
      </div>
      <div className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm">
          图片服务商
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">选择已配置服务商</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          候选类型
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="still">静帧</option>
            <option value="first_frame">首帧</option>
            <option value="last_frame">尾帧</option>
            <option value="cover">封面</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          尺寸
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          生成提示
          <textarea
            className="min-h-24 rounded-lg border border-line px-3 py-2"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述构图、角色、场景、光线与竖屏画面要求"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">
          反向提示词（可选）
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2"
            placeholder="例如：低清晰度、文字水印、变形手部"
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </label>
        <BareButton
          className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? "正在生成并归档…" : "生成候选图片"}
        </BareButton>
      </div>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">当前分镜候选</h3>
        <div className="mt-3 space-y-2">
          {!candidates.length && (
            <p className="text-sm text-muted">尚无候选图片。</p>
          )}
          {candidates.map((candidate) => {
            const payload = recordPayload(candidate.payload);
            const adopted = payload["采用状态"] === "已采用";
            return (
              <div
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm"
              >
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
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
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
      setNotice("已采用视频候选。分镜将引用此版本，其他候选仍会保留以供比较。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section
      aria-label="镜头视频提交前检查"
      className="space-y-4 rounded-xl border border-line bg-surface p-4"
    >
      <details className="mb-3">
        <summary className="cursor-pointer text-sm text-brand">
          AI 完善本镜头提示词
        </summary>
        <CreationRecordWorkbench
          projectId={props.projectId}
          targetId={props.shotId}
          domain="shots"
          operation="shot-prompt"
        />
      </details>
      <div>
        <h2 className="font-semibold">视频生成与候选采用</h2>
        <p className="mt-1 text-sm text-muted">
          先核对静帧来源、资产和费用，再以服务端签发的快照提交已配置的 Seedance
          或 MiniMax H3 Cloud 接口；预检阻断会在厂商调用前停止。
        </p>
      </div>
      <section className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2 xl:grid-cols-3">
        <select
          aria-label="视频生成服务商"
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          <option value="">选择视频服务商</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.title}
            </option>
          ))}
        </select>
        <input
          aria-label="视频生成时长（秒）"
          className="rounded-lg border border-line px-3 py-2 text-sm"
          type="number"
          min="1"
          max="60"
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
        />
        <BareButton
          className="w-fit rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={
            creating || checkingReadiness || !providerId || !prompt.trim()
          }
          onClick={() => void checkReadiness()}
        >
          {checkingReadiness ? "正在检查…" : "检查静帧与视频预检"}
        </BareButton>
        <BareButton
          className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
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
          aria-label="视频生成提示"
          className="min-h-24 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
          placeholder="描述动作、镜头运动、角色、场景和竖屏构图"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </section>
      <section className="rounded-xl border border-line p-3 text-sm">
        <h3 className="font-medium">静帧优先预检</h3>
        <p className="mt-1 text-xs text-muted">
          必须已采用未过期静帧，且当前镜头分配的视觉资产均已采用、锁定且来源有效；明确受限、撤回或过期的权利声明会阻断，未知权利仍未核验。参数须在服务商声明能力内；提示、时长或资产版本变化后需重新检查。
        </p>
        {preflight?.costStatus === "unknown" && (
          <label className="mt-3 flex items-start gap-2 text-xs text-amber-700">
            <input
              type="checkbox"
              checked={confirmUnknownCost}
              onChange={(event) => setConfirmUnknownCost(event.target.checked)}
            />
            我理解当前视频费用或单位未知，生成后仍需另核真实结算凭证。
          </label>
        )}
        {preflight && (
          <div className="mt-3 space-y-2 text-xs">
            <p>
              快照 {preflight.snapshotHash.slice(0, 18)}… · 静帧{" "}
              {preflight.adoptedStillId ? "已采用" : "未采用"} · 已锁定资产{" "}
              {preflight.lockedAssetIds.length} 个
              {` · ${configuredEstimateLabel(preflight.estimatedCost, preflight.currency)}`}
            </p>
            {preflight.blockers.map((blocker) => (
              <p
                key={blocker}
                className="rounded-md bg-red-50 px-2 py-1 text-red-700"
              >
                阻断：{blocker}
              </p>
            ))}
            {preflight.warnings.map((warning) => (
              <p
                key={warning}
                className="rounded-md bg-amber-50 px-2 py-1 text-amber-700"
              >
                注意：{warning}
              </p>
            ))}
            {preflight.ready && (
              <p className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                已通过：提交按钮会携带此快照；服务端会再次校验，避免静默继承变化。
              </p>
            )}
          </div>
        )}
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">本分镜生成任务</h3>
        <div className="mt-3 space-y-2">
          {!jobs.length && (
            <p className="text-sm text-muted">尚未提交视频生成任务。</p>
          )}
          {jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {videoJobStatusLabel(job.status)} ·{" "}
                  {job.results.length
                    ? `已归档 ${job.results.length} 个候选`
                    : "暂无可采用结果"}
                </span>
                <div className="flex gap-2">
                  {["queued", "running"].includes(job.status) && (
                    <BareButton
                      className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() => void check(job.id)}
                    >
                      查询状态
                    </BareButton>
                  )}
                  {["queued", "running"].includes(job.status) && (
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() => void cancel(job.id)}
                    >
                      停止追踪
                    </BareButton>
                  )}
                  {["failed", "canceled"].includes(job.status) && (
                    <BareButton
                      className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() => void retry(job.id)}
                    >
                      重试生成
                    </BareButton>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted">{job.prompt}</p>
              {job.error && (
                <p className="mt-1 text-xs text-red-600">{job.error}</p>
              )}
              {job.results.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <p className="text-xs font-medium text-muted">视频候选</p>
                  {job.results.map((candidate) => {
                    const adopted =
                      recordPayload(candidate.payload)["采用状态"] === "已采用";
                    return (
                      <div
                        key={candidate.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs"
                      >
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
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
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
    succeeded: "视频已完成并归档为分镜候选。",
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
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">音色与音轨版本</h2>
        <p className="mt-1 text-sm text-muted">
          音轨只能关联当前分集的分镜、当前项目的音色和素材；采用前会验证镜头谱系。
        </p>
      </div>
      <section className="grid gap-3 rounded-xl border border-line p-3 lg:grid-cols-2">
        <div>
          <h3 className="font-medium">新建音色草案</h3>
          <div className="mt-3 grid gap-2">
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="音色名称，例如：主角旁白"
              value={voiceTitle}
              onChange={(event) => setVoiceTitle(event.target.value)}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="服务商音色标识（可选）"
              value={providerVoice}
              onChange={(event) => setProviderVoice(event.target.value)}
            />
            <BareButton
              className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white"
              onClick={() => void createVoice()}
            >
              创建音色草案
            </BareButton>
          </div>
        </div>
        <div>
          <h3 className="font-medium">已保存音色</h3>
          <div className="mt-3 max-h-40 space-y-2 overflow-auto">
            {!voiceProfiles.length && (
              <p className="text-sm text-muted">尚未创建音色档案。</p>
            )}
            {voiceProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm"
              >
                <span>
                  {profile.title} ·{" "}
                  {profile.status === "adopted" ? "已采用" : "草案"}
                </span>
                {profile.status !== "adopted" && (
                  <BareButton
                    className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adoptVoice(profile.id)}
                  >
                    采用音色
                  </BareButton>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">生成对白或旁白</h3>
        <label className="mt-3 grid gap-2 text-sm">
          从本集剧本选取台词
          <select
            aria-label="剧本台词"
            className="rounded border border-line p-2"
            value=""
            onChange={(event) => useDialogue(event.target.value)}
          >
            <option value="">选择人物与台词</option>
            {dialogue.map((line) => (
              <option key={line.id} value={line.id}>
                {line.speaker}：{line.text.slice(0, 100)}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-1 text-xs text-muted">
          语音结果会安全归档为素材，并自动选入下方音轨草案；不会自动采用。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <select
            aria-label="音频服务商"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={ttsProviderId}
            onChange={(event) => setTtsProviderId(event.target.value)}
          >
            <option value="">选择语音服务商</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="服务商音色标识"
            value={ttsVoice}
            onChange={(event) => setTtsVoice(event.target.value)}
          />
          <BareButton
            className="w-fit rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={runningTts}
            onClick={() => void runTts()}
          >
            {runningTts ? "正在生成语音…" : "生成并归档语音"}
          </BareButton>
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
            placeholder="从剧本选择台词；需要时补充配音修改要求"
            value={ttsText}
            onChange={(event) => setTtsText(event.target.value)}
          />
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">另存音轨版本</h3>
        <p className="mt-1 text-xs text-muted">
          可先在“素材”中归档音频文件；手工文本轨可保存与采用，但不等于可播放音频、声音授权或成片验收。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="音轨名称"
            value={trackLabel}
            onChange={(event) => setTrackLabel(event.target.value)}
          />
          <select
            aria-label="音轨类别"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={trackKind}
            onChange={(event) =>
              setTrackKind(event.target.value as typeof trackKind)
            }
          >
            <option value="dialogue">对白</option>
            <option value="narration">旁白</option>
            <option value="bgm">配乐</option>
            <option value="sfx">音效</option>
          </select>
          <select
            aria-label="音轨素材"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">不绑定归档音频（仅草案）</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
          <select
            aria-label="音轨音色"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={voiceProfileId}
            onChange={(event) => setVoiceProfileId(event.target.value)}
          >
            <option value="">不绑定音色</option>
            {voiceProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            type="number"
            min="0"
            step="0.1"
            placeholder="起点（秒）"
            value={startSeconds}
            onChange={(event) => setStartSeconds(event.target.value)}
          />
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            type="number"
            min="0.1"
            step="0.1"
            placeholder="时长（秒）"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(event.target.value)}
          />
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
            placeholder="对白、旁白或制作说明（可选）"
            value={clipText}
            onChange={(event) => setClipText(event.target.value)}
          />
          <BareButton
            className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void saveTrack()}
          >
            另存音轨草案
          </BareButton>
        </div>
      </section>
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">本分集音轨版本</h3>
        {assetId && props.shotId && (
          <MediaSourceReviewPanel
            recordId={assetId}
            kind="assets"
            shotId={props.shotId}
          />
        )}
        <div className="mt-3 space-y-2">
          {!audioTracks.length && (
            <p className="text-sm text-muted">尚未保存音轨。</p>
          )}
          {audioTracks.map((track) => (
            <article
              key={track.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {track.label} · {audioTrackKindLabel(track.kind)} ·{" "}
                  {track.status === "adopted" ? "已采用" : "草案"}
                </span>
                {track.status !== "adopted" && !track.stale && (
                  <BareButton
                    className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                    onClick={() => void adoptTrack(track)}
                  >
                    采用此音轨
                  </BareButton>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {track.clips.length} 个片段
                {track.stale
                  ? ` · 已过期：${track.staleReason}`
                  : " · 实际来源版本一致（不代表音频质量／授权通过）"}
              </p>
              {track.clips.map((clip) => (
                <p key={clip.id} className="mt-1 text-xs text-muted">
                  片段来源：
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
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
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
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">动态分镜审核</h2>
        <p className="mt-1 text-sm text-muted">
          初始化从当前镜头生成时间线，并优先引用已采用的视频或静帧。缺少媒体的镜头会明确标出，不会伪造成片。
        </p>
      </div>
      {initializationError && (
        <p className="text-sm text-red-600">{message(initializationError)}</p>
      )}
      {initialization && (
        <section className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">当前镜头时间线</h3>
            <span className="text-xs text-muted">
              {initialization.clips.length} 个镜头
            </span>
          </div>
          <div className="mt-3 max-h-48 space-y-2 overflow-auto">
            {initialization.clips.map((clip) => (
              <div
                key={clip.shotId}
                className="rounded-lg bg-canvas p-2 text-sm"
              >
                {clip.startSeconds.toFixed(1)} 秒 · {clip.title} ·{" "}
                {animaticMediaLabel(clip.mediaKind)}
              </div>
            ))}
            {!initialization.clips.length && (
              <p className="text-sm text-muted">请先建立场景与分镜。</p>
            )}
          </div>
          <label className="mt-3 grid gap-1 text-sm">
            节奏与审核说明（可选）
            <textarea
              className="min-h-20 rounded-lg border border-line px-3 py-2"
              value={annotations}
              onChange={(event) => setAnnotations(event.target.value)}
              placeholder="例如：第 3 个镜头的停留需更短"
            />
          </label>
          <BareButton
            className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={!initialization.clips.length}
            onClick={() => void save()}
          >
            另存动态分镜草案
          </BareButton>
        </section>
      )}
      <section className="rounded-xl border border-line p-3">
        <h3 className="font-medium">版本与审核结论</h3>
        <div className="mt-3 space-y-2">
          {!drafts.length && (
            <p className="text-sm text-muted">尚无动态分镜版本。</p>
          )}
          {drafts.map((draft) => (
            <article
              key={draft.id}
              className="rounded-lg border border-line p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {draft.clips.length} 个镜头 ·{" "}
                  {animaticStatusLabel(draft.status)}
                </span>
                {draft.status === "draft" && (
                  <div className="flex gap-2">
                    <BareButton
                      className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                      onClick={() =>
                        void review(draft.id, "approved", draft.version)
                      }
                    >
                      通过
                    </BareButton>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-muted"
                      onClick={() =>
                        void review(draft.id, "returned", draft.version)
                      }
                    >
                      退回
                    </BareButton>
                  </div>
                )}
              </div>
              {draft.annotations && (
                <p className="mt-1 text-xs text-muted">
                  说明：{draft.annotations}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
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

  if (error)
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {message(error)}
      </p>
    );
  if (!timeline)
    return (
      <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
        正在建立当前分集的时间线…
      </p>
    );
  const pixels = Math.max(680, timelineDurationSeconds * zoom + 120);
  return (
    <section
      className="space-y-4 rounded-xl border border-line bg-surface p-4"
      aria-label="多轨时间线编辑器"
      tabIndex={0}
      onKeyDown={onKeyboard}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">版本化剪辑工作区</p>
          <h2 className="mt-1 text-lg font-semibold">多轨时间线</h2>
          <p className="mt-1 text-sm text-muted">
            1080×1920、25 fps、48 kHz 双声道、整数帧
            timebase；编辑逐条自动保存并可撤销。媒体始终以引用方式使用，不会复制或改写源文件。
          </p>
        </div>
        <p className="text-xs text-muted">
          v{timeline.version} · 总长 {timelineDurationSeconds.toFixed(2)} 秒 ·{" "}
          {timeline.durationFrames} 帧
        </p>
      </div>
      <section
        className="rounded-xl border border-line bg-page p-3"
        aria-label="自动音频字幕编排"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">自动音频与字幕编排</h3>
            <p className="mt-1 text-xs text-muted">
              基于已采用音轨生成可审查 change
              set；不会覆盖人工移动、裁切、音量调整或锁定片段。
            </p>
          </div>
          <BareButton
            className="rounded-md border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={isLoadingAudioAssembly || working}
            onClick={() => void reviewAudioAssembly()}
          >
            {isLoadingAudioAssembly ? "正在生成预览…" : "审查自动编排"}
          </BareButton>
        </div>
        {audioAssembly && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p>
                候选 {audioAssembly.clips.length} 段 · 字幕{" "}
                {audioAssembly.subtitleCues.length} 条 · 受保护人工片段{" "}
                {audioAssembly.protectedClipIds.length} 个
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
                  <label
                    key={trackId}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface p-2"
                  >
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
                      {clips.length} 段 ·{" "}
                      {first.rightsStatus === "cleared"
                        ? "权利已核验"
                        : first.rightsStatus === "restricted"
                          ? "权利受限"
                          : "权利待核验"}
                    </span>
                  </label>
                );
              })}
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={includeAssemblySubtitles}
                  onChange={(event) =>
                    setIncludeAssemblySubtitles(event.target.checked)
                  }
                />
                同时采用由对白/旁白切分的可编辑字幕（SRT / WebVTT 已预览）
              </label>
              <BareButton
                className="rounded-md bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
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
                采用选中的自动编排
              </BareButton>
            </div>
            <div className="space-y-2 text-xs text-muted">
              {audioAssembly.warnings.map((warning) => (
                <p
                  key={warning}
                  className="rounded-md bg-amber-50 p-2 text-amber-900"
                >
                  {warning}
                </p>
              ))}
              {audioAssembly.srt && (
                <details>
                  <summary className="cursor-pointer text-brand">
                    查看 SRT / WebVTT 字幕预览
                  </summary>
                  <pre className="mt-2 max-h-36 overflow-auto rounded-md bg-surface p-2 whitespace-pre-wrap">
                    {audioAssembly.srt}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
      </section>
      <section
        className="rounded-xl border border-line bg-page p-3"
        aria-label="NLE 交付与媒体核验"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">NLE 交付与媒体核验</h3>
            <p className="mt-1 text-xs text-muted">
              从当前 canonical timeline 生成 FCPXML、OTIO、CMX 3600
              EDL、字幕和重链接清单；核对冻结来源及 owner
              存档元数据。相对路径不是已复制文件，存档 SHA-256
              不等于字节／权利核验。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
                className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                disabled={working || Boolean(deliveryWorking)}
                onClick={() => void exportDelivery(format)}
              >
                {deliveryWorking === format ? "正在导出…" : label}
              </BareButton>
            ))}
          </div>
        </div>
        {deliveryManifest && (
          <div className="mt-3 grid gap-3 text-xs text-muted lg:grid-cols-2">
            <p>
              时间线版本 {deliveryManifest.timeline.version} · 媒体{" "}
              {deliveryManifest.media.length} 个 · 精确来源存档元数据{" "}
              {
                deliveryManifest.media.filter((item) => Boolean(item.archive))
                  .length
              }{" "}
              个
            </p>
            <p>
              NLE 交付不包含 MP4 成片。独立本地实验渲染须校验签名
              sidecar；本地混音按冻结来源与控制值编码，仍不等于正式发行或字幕烧录。
            </p>
            {deliveryManifest.unsupportedFeatures.length > 0 && (
              <p className="rounded-md bg-amber-50 p-2 text-amber-900">
                兼容性报告：{deliveryManifest.unsupportedFeatures.join("；")}
              </p>
            )}
            {deliveryManifest.warnings.map((warning) => (
              <p
                key={warning}
                className="rounded-md bg-amber-50 p-2 text-amber-900"
              >
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
          <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">
            {message(deliveryError)}
          </p>
        )}
      </section>
      <AudioResolutionPanel timeline={timeline} />
      <section className="grid gap-3 rounded-xl border border-line bg-page p-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BareButton
              className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
              disabled={!previewReady}
              onClick={() => playback.current?.toggle()}
            >
              {playing ? "暂停" : "播放"}
            </BareButton>
            <BareButton
              className="rounded-md border border-line px-3 py-2 text-sm"
              onClick={() => seekPreview(0)}
            >
              回到开头
            </BareButton>
            <BareButton
              className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50"
              disabled={working || !history?.canUndo}
              onClick={() => void restore("undo")}
            >
              撤销
            </BareButton>
            <BareButton
              className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50"
              disabled={working || !history?.canRedo}
              onClick={() => void restore("redo")}
            >
              重做
            </BareButton>
            <span className="text-sm text-muted">{playhead.toFixed(2)} 秒</span>
          </div>
          <input
            className="mt-3 w-full accent-brand"
            aria-label="播放头定位"
            type="range"
            min="0"
            max={timelineDurationSeconds}
            step="0.04"
            value={Math.min(playhead, timelineDurationSeconds)}
            onChange={(event) => seekPreview(Number(event.target.value))}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            缩放
            <input
              aria-label="时间线缩放"
              type="range"
              min="24"
              max="160"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            {zoom} px/秒
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
        className="overflow-x-auto rounded-xl border border-line bg-page p-3"
        aria-label="时间线轨道"
      >
        <div className="min-w-max" style={{ width: pixels }}>
          <div className="relative mb-2 h-5 border-b border-line text-[10px] text-muted">
            {Array.from(
              { length: Math.ceil(timelineDurationSeconds) + 1 },
              (_, second) => (
                <span
                  key={second}
                  className="absolute top-0"
                  style={{ left: second * zoom }}
                >
                  {second}s
                </span>
              ),
            )}
            <span
              className="absolute -bottom-1 top-0 w-0.5 bg-red-500"
              style={{ left: playhead * zoom }}
            />
          </div>
          <div className="space-y-2">
            {timeline.tracks.map((track) => (
              <div key={track.id} className="grid grid-cols-[7rem_1fr] gap-2">
                <div className="rounded-lg border border-line bg-surface p-2 text-xs">
                  <p className="font-medium">
                    {timelineTrackLabel(track.kind)}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <BareButton
                      aria-label={`${timelineTrackLabel(track.kind)}静音`}
                      className={`rounded-md px-1.5 py-0.5 ${track.muted ? "bg-red-100 text-red-700" : "bg-page text-muted"}`}
                      onClick={() =>
                        void apply({
                          type: "set-track-audio",
                          trackId: track.id,
                          muted: !track.muted,
                        })
                      }
                    >
                      静音
                    </BareButton>
                    <BareButton
                      aria-label={`${timelineTrackLabel(track.kind)}独听`}
                      className={`rounded-md px-1.5 py-0.5 ${track.solo ? "bg-brand-soft text-brand" : "bg-page text-muted"}`}
                      onClick={() =>
                        void apply({
                          type: "set-track-audio",
                          trackId: track.id,
                          solo: !track.solo,
                        })
                      }
                    >
                      独听
                    </BareButton>
                  </div>
                </div>
                <div
                  className="relative h-14 overflow-hidden rounded-lg bg-canvas"
                  style={{ width: pixels - 120 }}
                >
                  <span
                    className="absolute bottom-0 top-0 z-10 w-0.5 bg-red-500"
                    style={{ left: playhead * zoom }}
                  />
                  {track.clips.map((clip) => (
                    <BareButton
                      key={clip.id}
                      aria-label={`选择片段：${clip.name}`}
                      className={`absolute top-2 h-10 overflow-hidden rounded-md border px-2 text-left text-xs ${selectedClipId === clip.id ? "border-brand bg-brand-soft text-brand" : clip.mediaStatus === "linked" ? "border-line bg-surface" : "border-amber-300 bg-amber-50 text-amber-900"}`}
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
        <section className="grid gap-3 rounded-xl border border-line p-3 xl:grid-cols-3">
          <div>
            <h3 className="font-medium">{selected.clip.name}</h3>
            <p className="mt-1 text-xs text-muted">
              {timelineTrackLabel(selected.track.kind)} ·{" "}
              {timelineMediaStatusLabel(selected.clip.mediaStatus)} ·{" "}
              {selected.clip.locked
                ? "已锁定，自动编排受保护"
                : selected.clip.manuallyEdited
                  ? "有人工编辑"
                  : "源装配"}
            </p>
            {selected.clip.text && (
              <p className="mt-2 text-sm">{selected.clip.text}</p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              移动到秒
              <input
                className="rounded-md border border-line px-2 py-1 text-sm"
                type="number"
                min="0"
                step="0.04"
                value={moveStart}
                onChange={(event) => setMoveStart(event.target.value)}
              />
            </label>
            <BareButton
              className="self-end rounded-md border border-line px-2 py-1 text-sm text-brand disabled:opacity-50"
              disabled={working}
              onClick={() =>
                void apply({
                  type: "move",
                  clipId: selected.clip.id,
                  startFrame: secondsToFrame(Number(moveStart)),
                })
              }
            >
              移动
            </BareButton>
            <label className="grid gap-1 text-xs">
              裁切起点
              <input
                className="rounded-md border border-line px-2 py-1 text-sm"
                type="number"
                min="0"
                step="0.04"
                value={trimStart}
                onChange={(event) => setTrimStart(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs">
              裁切时长
              <input
                className="rounded-md border border-line px-2 py-1 text-sm"
                type="number"
                min="0.04"
                step="0.04"
                value={trimDuration}
                onChange={(event) => setTrimDuration(event.target.value)}
              />
            </label>
            <BareButton
              className="rounded-md border border-line px-2 py-1 text-sm text-brand disabled:opacity-50"
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
              裁切
            </BareButton>
            <BareButton
              className="rounded-md border border-line px-2 py-1 text-sm text-brand disabled:opacity-50"
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
              在中点分割
            </BareButton>
            {["dialogue", "narration", "bgm", "sfx"].includes(
              selected.track.kind,
            ) && (
              <>
                <label className="grid gap-1 text-xs">
                  片段音量（0–2）
                  <input
                    className="rounded-md border border-line px-2 py-1 text-sm"
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    value={clipVolume}
                    onChange={(event) => setClipVolume(event.target.value)}
                  />
                </label>
                <BareButton
                  className="self-end rounded-md border border-line px-2 py-1 text-sm text-brand disabled:opacity-50"
                  disabled={working}
                  onClick={() =>
                    void apply({
                      type: "set-clip-audio",
                      clipId: selected.clip.id,
                      volume: Number(clipVolume),
                    })
                  }
                >
                  保存音量
                </BareButton>
                <BareButton
                  className="rounded-md border border-brand px-2 py-1 text-sm text-brand disabled:opacity-50"
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
          <div className="grid gap-2">
            <label className="grid gap-1 text-xs">
              重链接到项目媒体
              <select
                className="rounded-md border border-line px-2 py-1 text-sm"
                value={relinkAssetId}
                onChange={(event) => setRelinkAssetId(event.target.value)}
              >
                <option value="">选择归档媒体</option>
                {mediaAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title}
                  </option>
                ))}
              </select>
            </label>
            <BareButton
              className="w-fit rounded-md border border-brand px-2 py-1 text-sm text-brand disabled:opacity-50"
              disabled={working || !relinkAssetId}
              onClick={() =>
                void apply({
                  type: "relink",
                  clipId: selected.clip.id,
                  assetId: relinkAssetId,
                })
              }
            >
              保存重链接
            </BareButton>
          </div>
        </section>
      )}
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">成片渲染预检</h2>
          <p className="mt-1 text-sm text-muted">
            核对已通过的动态分镜、已采用音轨、归档媒体和当前镜头谱系；不会将占位资料冒充最终
            MP4。
          </p>
        </div>
        <BareButton
          className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "正在预检…" : "重新执行预检"}
        </BareButton>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{message(error)}</p>}
      {preflight && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <section
            className={`rounded-xl p-3 text-sm ${preflight.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}
          >
            <h3 className="font-medium">
              {preflight.ok ? "制作输入完整" : "尚不能提交渲染"}
            </h3>
            <p className="mt-1">
              总时长：{preflight.durationSeconds.toFixed(1)} 秒 · 已采用音轨：
              {preflight.audioTrackIds.length} 条
            </p>
          </section>
          <section className="rounded-xl border border-line p-3 text-sm">
            <h3 className="font-medium">待处理阻断项</h3>
            {preflight.blockers.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {preflight.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">未发现输入阻断项。</p>
            )}
          </section>
          <section className="rounded-xl border border-line p-3 text-sm lg:col-span-2">
            <h3 className="font-medium">提示</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
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
  if (error)
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        {message(error)}
      </p>
    );
  if (!graph)
    return (
      <p className="rounded-lg border border-line p-3 text-sm text-muted">
        正在整理制作依赖关系…
      </p>
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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">制作依赖图</h2>
        <p className="mt-1 text-sm text-muted">
          从项目到分镜、素材和审核交付记录的实时依赖摘要。下级资料会显示为上级的依赖项。
        </p>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {stages.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-canvas p-3 text-center">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-auto text-xs">
        {graph.nodes.slice(1, 30).map((node) => (
          <BareButton
            key={node.id}
            className="rounded-full border border-line bg-surface-raised px-2 py-1 text-left hover:border-brand disabled:opacity-50"
            disabled={
              impactPreview.isPending ||
              node.kind === "chapter" ||
              node.kind === "project"
            }
            onClick={() => impactPreview.mutate(node.id)}
            title="查看此条目变更后需要复核的下游内容"
          >
            {domainLabel(node.kind)} · {node.title} ·{" "}
            {productStatusLabel(node.status)}
          </BareButton>
        ))}
        {graph.nodes.length <= 1 && (
          <p className="text-sm text-muted">
            建立分集、剧本或素材后，这里会显示生产依赖关系。
          </p>
        )}
      </div>
      {impactPreview.isPending && (
        <p className="mt-3 text-sm text-muted">正在评估变更影响…</p>
      )}
      {impactPreview.error && (
        <p className="mt-3 text-sm text-red-600">
          {message(impactPreview.error)}
        </p>
      )}
      {impact && (
        <div className="mt-3 rounded-lg bg-brand-soft/40 p-3 text-sm">
          <p className="font-medium text-brand">{impact.summary}</p>
          {impact.affected.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-muted">
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
