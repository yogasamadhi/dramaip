import {
  CreationWorkbench,
  CreationRecordWorkbench,
  CreationRunCard,
} from "../creation-workbench";
import type { DomainEntity } from "@dramaip/contracts/product";
import { BareButton, NativeSelect, confirmDialog } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  buildEpisodePacingBoard,
  type PacingKind,
  type PacingPoint,
} from "../../episode-pacing";
import {
  StageNavigation,
  WorkspaceIntro,
  type WorkspaceStageItem,
  domainLabel,
  message,
  useStudio,
} from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
} from "../../current-owner-read";
import { readLegacyEpisodeAnalysis } from "../../legacy-quality-history";
import { PluginResourceWorkspace, recordPayload } from "../studio-widgets";
import { StoryBibleSidecar } from "../workspace/impl";
import { AdaptationPipeline } from "./AdaptationPipeline";
import { LegacyEpisodeCompatibility } from "./LegacyEpisodeCompatibility";
import {
  ProductionContextBoundary,
  WorkspaceObjectControls,
} from "../ProductionContextBoundary";
import {
  productionReferenceKey,
  withExactProductionRecord,
  type ProductionObjectContext,
} from "../../production-object-context";

function ScriptContextControls(props: {
  context?: { projectId: string; episodeTitle: string; scriptTitle: string };
  awaitingOriginalScript?: boolean;
  projectTitle?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!props.context) return props.children;
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <h1 className="font-semibold">{props.projectTitle}</h1>
          <p className="mt-1 text-sm text-muted">
            {props.context.episodeTitle} · {props.context.scriptTitle}
            {props.awaitingOriginalScript
              ? "；先从故事构思创作本集 AI 草稿，审阅采用后再检查与拆分。"
              : "；先核对剧本与连续性，再按需拆分场景和分镜。"}
          </p>
        </div>
        <Link
          className="text-sm font-medium text-link"
          to={`/projects/${props.context.projectId}/tools`}
        >
          项目工具
        </Link>
      </header>
      <details
        className="rounded-xl border border-line bg-surface p-4"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm">
          切换项目或分集（高级）
        </summary>
        <div className="mt-3">{props.children}</div>
      </details>
    </>
  );
}
export function AdaptationWorkspace() {
  const location = useLocation();
  return (
    <ProductionContextBoundary>
      {(projectId, context) => (
        <AdaptationWorkspaceInstance
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
function AdaptationWorkspaceInstance(props: {
  projectId: string;
  context: ProductionObjectContext;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
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
  const [notice, setNotice] = useState<string>();
  const [stage, setStage] = useState<
    "adaptations" | "episodes" | "scripts" | "scenes" | "shots"
  >("adaptations");
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
      ["adaptations", "episodes", "scripts", "scenes", "shots"].includes(
        requested,
      )
    )
      setStage(requested as typeof stage);
  }, [location.search]);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    const project = projects.find((item) => item.id === projectId);
    if (
      !adaptationId &&
      project?.currentAdaptationId &&
      adaptations.some((item) => item.id === project.currentAdaptationId)
    )
      setAdaptationId(project.currentAdaptationId);
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
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
    const requested = new URLSearchParams(location.search).get("scriptId");
    if (requested && scripts.some((item) => item.id === requested))
      setScriptId(requested);
  }, [scripts, location.search]);
  useEffect(() => {
    if (sceneId && !scenes.some((item) => item.id === sceneId)) setSceneId("");
  }, [sceneId, scenes]);
  useEffect(() => {
    if (shotId && !shots.some((item) => item.id === shotId)) setShotId("");
  }, [shotId, shots]);
  const parentId =
    stage === "episodes"
      ? adaptationId
      : stage === "scripts"
        ? episodeId
        : stage === "scenes"
          ? scriptId
          : stage === "shots"
            ? sceneId
            : undefined;
  const parentRequired = stage !== "adaptations";
  const selectedScript = scripts.find((item) => item.id === scriptId);
  const selectedProject = projects.find((item) => item.id === projectId);
  const routeParams = new URLSearchParams(location.search);
  const legacyWorkflowId = routeParams.get("workflowId") ?? undefined;
  const legacyRun = useQuery({
    queryKey: ["creation-workflow", legacyWorkflowId],
    queryFn: () => client.creation.get(legacyWorkflowId!),
    enabled: Boolean(legacyWorkflowId),
  });
  const originalScriptProject =
    selectedProject?.modeConfig.mode === "single_season" &&
    selectedProject.modeConfig.entryPath === "inspiration";
  const awaitingOriginalScript =
    originalScriptProject &&
    selectedScript &&
    !String(recordPayload(selectedScript.payload)["剧本内容"] ?? "").trim();
  const directScriptContext =
    new URLSearchParams(location.search).get("context") === "inherited" &&
    new URLSearchParams(location.search).get("scriptId") === scriptId &&
    selectedScript &&
    episodeId &&
    adaptationId
      ? {
          projectId,
          episodeTitle:
            episodes.find((item) => item.id === episodeId)?.title ?? "本集",
          scriptTitle: selectedScript.title,
        }
      : undefined;
  const requestedStage = new URLSearchParams(location.search).get("stage");
  const structurallyRecommended = !adaptations.length
    ? "adaptations"
    : !episodes.length
      ? "episodes"
      : !scripts.length
        ? "scripts"
        : !scenes.length
          ? "scenes"
          : "shots";
  const recommendedStage =
    requestedStage &&
    ["adaptations", "episodes", "scripts", "scenes", "shots"].includes(
      requestedStage,
    )
      ? requestedStage
      : structurallyRecommended;
  const stageItems: WorkspaceStageItem[] = [
    {
      id: "adaptations",
      label: "改编项目",
      availability: projectId ? "available" : "blocked",
      recommended: recommendedStage === "adaptations",
      reason: "请先创建或选择一个项目。",
      recoveryLabel: "返回项目工作台",
      recoveryTarget: "/",
    },
    {
      id: "episodes",
      label: "分集",
      availability: adaptationId ? "available" : "blocked",
      recommended: recommendedStage === "episodes",
      reason: "请先在改编项目阶段创建或选择改编方案。",
      recoveryLabel: "去选择改编方案",
      recoveryTarget: `/adapt?${new URLSearchParams({ projectId, stage: "adaptations" })}`,
    },
    {
      id: "scripts",
      label: "剧本",
      availability: episodeId ? "available" : "blocked",
      recommended: recommendedStage === "scripts",
      reason: "请先创建或选择一个分集。",
      recoveryLabel: "去选择分集",
      recoveryTarget: `/adapt?${new URLSearchParams({ projectId, stage: "episodes" })}`,
    },
    {
      id: "scenes",
      label: "场景",
      availability: scriptId ? "available" : "blocked",
      recommended: recommendedStage === "scenes",
      reason: "请先创建或选择一个剧本。",
      recoveryLabel: "去选择剧本",
      recoveryTarget: `/adapt?${new URLSearchParams({ projectId, stage: "scripts" })}`,
    },
    {
      id: "shots",
      label: "分镜",
      availability: sceneId ? "available" : "blocked",
      recommended: recommendedStage === "shots",
      reason: "请先创建或选择一个场景。",
      recoveryLabel: "去选择场景",
      recoveryTarget: `/adapt?${new URLSearchParams({ projectId, stage: "scenes" })}`,
    },
  ];
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
      context: new URLSearchParams(location.search).get("context") ?? "",
      compatibility:
        new URLSearchParams(location.search).get("compatibility") ?? "",
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
    navigate(`/adapt?${search}`);
  };
  return (
    <section className="space-y-5">
      <WorkspaceIntro
        title={originalScriptProject ? "从创意到分集剧本" : "从故事到单集开发"}
        description={
          originalScriptProject
            ? "从故事构思直接生成分集剧本，不必先写小说。"
            : "按诊断、策略、季纲、单集剧本逐步推进，每一步由你确认。"
        }
      />
      <WorkspaceObjectControls
        projectTitle={directScriptContext ? undefined : selectedProject?.title}
        objectTitles={[
          episodes.find((record) => record.id === episodeId)?.title,
          selectedScript?.title,
          shots.find((record) => record.id === shotId)?.title,
        ].filter((title): title is string => Boolean(title))}
      >
        <ScriptContextControls
          context={directScriptContext}
          projectTitle={selectedProject?.title}
          awaitingOriginalScript={Boolean(awaitingOriginalScript)}
        >
          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1 text-sm">
              项目
              <NativeSelect
                value={projectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  if (nextProjectId) session.selectProject(nextProjectId);
                  setAdaptationId("");
                  setEpisodeId("");
                  setScriptId("");
                  setSceneId("");
                  setShotId("");
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
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              改编项目
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
                  setNotice(undefined);
                  if (!nextId || !projectId) return;
                  void client.productionStructure
                    .selectCurrentAdaptation(projectId, {
                      adaptationId: nextId,
                    })
                    .then(() => {
                      setNotice(
                        "已设为当前改编方案。下次打开项目会自动恢复此选择。",
                      );
                      void queryClient.invalidateQueries({
                        queryKey: ["projects"],
                      });
                    })
                    .catch((cause) => setNotice(message(cause)));
                }}
              >
                <option value="">选择改编项目</option>
                {adaptations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              分集
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
                <option value="">选择分集</option>
                {episodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              剧本
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
                <option value="">选择剧本</option>
                {scripts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              场景
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
                <option value="">选择场景</option>
                {scenes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {stage === "shots" && (
              <label className="grid gap-1 text-sm">
                分镜
                <NativeSelect
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
                </NativeSelect>
              </label>
            )}
          </section>
        </ScriptContextControls>
      </WorkspaceObjectControls>
      {projectId && (
        <>
          {selectedProject && <AdaptationPipeline project={selectedProject} />}
          <div
            className={
              originalScriptProject
                ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]"
                : "grid gap-4"
            }
          >
            {originalScriptProject && (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm leading-6">
                <h2 className="mb-1 font-semibold">故事构思</h2>
                <p>
                  {selectedProject.synopsis.trim() ||
                    "还没有填写故事构思。请在右侧补充本集目标，再生成剧本草稿。"}
                </p>
                <p className="mt-2 text-muted">
                  {awaitingOriginalScript
                    ? "本集剧本尚未创作：目前只有分集目录和空草稿。"
                    : "正式正文来自你保存或明确采用的内容。"}
                  生成结果在你采用前不会写入正式剧本。
                </p>
              </div>
            )}
            {legacyWorkflowId ? (
              <LegacyEpisodeCompatibility explicit>
                {legacyRun.error ? (
                  <p role="alert">{message(legacyRun.error)}</p>
                ) : !legacyRun.data ? (
                  <p>正在核对指定旧工作流…</p>
                ) : legacyRun.data.input.projectId !== projectId ||
                  legacyRun.data.input.operation !== "episode" ? (
                  <p role="alert">
                    指定工作流不属于当前项目的旧 episode 路径；未替换为最新 AI
                    草稿。
                  </p>
                ) : (
                  <CreationRunCard
                    key={legacyWorkflowId}
                    id={legacyWorkflowId}
                    projectId={projectId}
                  />
                )}
              </LegacyEpisodeCompatibility>
            ) : stage === "scripts" && scriptId ? (
              <CreationRecordWorkbench
                projectId={projectId}
                targetId={scriptId}
                domain="scripts"
                operation="script-revision"
                resultLabel={awaitingOriginalScript ? "本集剧本" : undefined}
                defaultInstruction={
                  awaitingOriginalScript
                    ? "根据项目中保存的故事构思和创作简报，创作本集完整 Fountain 剧本。保持作者的题材、人物与表达方向；不要先写小说，不要声称已生成场景、分镜或媒体。"
                    : undefined
                }
              />
            ) : stage === "shots" && shotId ? (
              <CreationRecordWorkbench
                projectId={projectId}
                targetId={shotId}
                domain="shots"
                operation="shot-prompt"
              />
            ) : (
              <LegacyEpisodeCompatibility
                explicit={routeParams.get("compatibility") === "episode"}
              >
                {episodeId || adaptationId ? (
                  <CreationRecordWorkbench
                    projectId={projectId}
                    targetId={episodeId || adaptationId}
                    domain={episodeId ? "episodes" : "adaptations"}
                    operation="episode"
                  />
                ) : (
                  <CreationWorkbench
                    projectId={projectId}
                    operation="episode"
                  />
                )}
              </LegacyEpisodeCompatibility>
            )}
          </div>
        </>
      )}
      <StageNavigation
        label="改编阶段"
        numbered
        items={stageItems}
        active={stage}
        onChange={(value) => {
          const nextStage = value as typeof stage;
          setStage(nextStage);
          syncRoute({ stage: nextStage });
        }}
      />
      {notice && <p className="text-sm text-brand">{notice}</p>}
      {!projectId ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
          请先创建或选择项目，再开始改编生产。
        </p>
      ) : (
        <>
          {adaptationId && <EpisodeAnalysisPanel adaptationId={adaptationId} />}
          {episodeId && (
            <EpisodePacingPanel
              projectId={projectId}
              episodeId={episodeId}
              episode={episodes.find((item) => item.id === episodeId)}
              onOpenScript={(nextScriptId) => {
                setScriptId(nextScriptId);
                setStage("scripts");
                syncRoute({
                  scriptId: nextScriptId,
                  sceneId: "",
                  shotId: "",
                  stage: "scripts",
                });
              }}
            />
          )}
          <ProductionOrderPanel
            stage={stage}
            parentId={parentId}
            records={
              stage === "episodes"
                ? episodes
                : stage === "scenes"
                  ? scenes
                  : stage === "shots"
                    ? shots
                    : []
            }
          />
          {stage === "scripts" && scriptId && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-4">
                <ScreenplayReader scriptId={scriptId} />
                <ScriptReviewPanel scriptId={scriptId} />
              </div>
              {selectedScript && (
                <StoryBibleSidecar
                  projectId={projectId}
                  context={{
                    kind: "script",
                    id: scriptId,
                    title: selectedScript.title,
                    content: String(
                      recordPayload(selectedScript.payload)["剧本内容"] ?? "",
                    ),
                    version: selectedScript.version,
                  }}
                />
              )}
            </div>
          )}
          {stage === "shots" && shotId && <ShotReviewPanel shotId={shotId} />}
          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm">资料管理与导入</summary>
            <PluginResourceWorkspace
              owner="production"
              title="改编生产"
              domains={[stage]}
              projectId={projectId}
              parentId={parentId}
              parentRequired={parentRequired}
            />
          </details>
        </>
      )}
    </section>
  );
}

export function EpisodePacingPanel(props: {
  projectId: string;
  episodeId: string;
  episode?: DomainEntity;
  onOpenScript: (scriptId: string) => void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string>();
  const { data: allScripts = [] } = useQuery({
    queryKey: ["episode-pacing", "scripts", props.projectId],
    queryFn: () => client.resources.list("scripts", props.projectId),
  });
  const { data: allBeats = [] } = useQuery({
    queryKey: ["episode-pacing", "beats", props.projectId],
    queryFn: () => client.resources.list("beats", props.projectId),
  });
  const { data: allScenes = [] } = useQuery({
    queryKey: ["episode-pacing", "scenes", props.projectId],
    queryFn: () => client.resources.list("scenes", props.projectId),
  });
  const { data: allShots = [] } = useQuery({
    queryKey: ["episode-pacing", "shots", props.projectId],
    queryFn: () => client.resources.list("shots", props.projectId),
  });
  const { data: manualMarks = [] } = useQuery({
    queryKey: ["episode-pacing-marks", props.projectId, props.episodeId],
    queryFn: () =>
      client.resources.list(
        "episode-pacing-marks",
        props.projectId,
        props.episodeId,
      ),
  });
  const { data: checkpoints = [] } = useQuery({
    queryKey: ["content-versions", props.projectId],
    queryFn: () => client.contentVersions.list(props.projectId),
  });
  const scripts = allScripts.filter(
    (item) => item.parentId === props.episodeId,
  );
  const scriptIds = new Set(scripts.map((item) => item.id));
  const scenes = allScenes.filter(
    (item) => item.parentId && scriptIds.has(item.parentId),
  );
  const sceneIds = new Set(scenes.map((item) => item.id));
  const shots = allShots.filter(
    (item) => item.parentId && sceneIds.has(item.parentId),
  );
  const beats = allBeats.filter(
    (item) =>
      item.parentId === props.episodeId ||
      Boolean(item.parentId && scriptIds.has(item.parentId)),
  );
  const board = buildEpisodePacingBoard({
    episodeId: props.episodeId,
    episode: props.episode,
    scripts,
    beats,
    scenes,
    shots,
    manualMarks,
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["episode-pacing-marks", props.projectId, props.episodeId],
      }),
      queryClient.invalidateQueries({ queryKey: ["episode-pacing"] }),
      queryClient.invalidateQueries({
        queryKey: ["content-versions", props.projectId],
      }),
    ]);
  };
  const addManual = async (kind: PacingKind) => {
    const evidence = window.prompt("记录该节奏点的依据：", "");
    if (evidence === null) return;
    const source =
      board.points.find(
        (point) =>
          point.sourceId && point.scriptId && point.disposition === "active",
      ) ??
      board.points.find(
        (point) => point.sourceId && point.disposition === "active",
      );
    if (!source?.sourceId || source.sourceVersion === undefined) {
      setNotice("请先保存分集、剧本、场景或镜头，再添加可追溯的人工标记。");
      return;
    }
    try {
      await client.resources.create("episode-pacing-marks", {
        projectId: props.projectId,
        parentId: props.episodeId,
        title: `人工${pacingKindLabel(kind)}标记`,
        payload: {
          类型: kind,
          位置: source.position,
          依据: evidence,
          来源标识: source.sourceId,
          来源版本: source.sourceVersion,
          状态: "已确认",
        },
      });
      setNotice("已保存人工节奏标记；它会保留并在来源版本变化时标为过期。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const editManual = async (point: PacingPoint) => {
    const record = manualMarks.find((item) => item.id === point.id);
    if (!record) return;
    const evidence = window.prompt("调整人工标记依据：", point.evidence);
    if (evidence === null) return;
    const requestedPosition = window.prompt(
      "调整时间轴位置：",
      String(point.position),
    );
    if (requestedPosition === null) return;
    const position = Number(requestedPosition);
    if (!Number.isFinite(position) || position < 1) {
      setNotice("时间轴位置必须是大于等于 1 的数字。");
      return;
    }
    try {
      await client.resources.update("episode-pacing-marks", record.id, {
        title: record.title,
        payload: {
          ...recordPayload(record.payload),
          位置: Math.round(position),
          依据: evidence,
          状态: "已确认",
        },
        version: record.version,
      });
      setNotice("人工标记已调整并保留了来源版本。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const rejectManual = async (point: PacingPoint) => {
    const record = manualMarks.find((item) => item.id === point.id);
    if (
      !record ||
      !(await confirmDialog(
        "否决此人工标记吗？记录会保留在轨道中作为审查历史。",
      ))
    )
      return;
    try {
      await client.resources.update("episode-pacing-marks", record.id, {
        title: record.title,
        payload: { ...recordPayload(record.payload), 状态: "已否决" },
        version: record.version,
      });
      setNotice("已否决人工标记；它不会被当作有效诊断点。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const createAiRecommendation = async (point: PacingPoint) => {
    const script = scripts.find((item) => item.id === point.scriptId);
    if (!script || !point.sourceId || point.sourceVersion === undefined) {
      setNotice("该诊断点尚未关联到可修订的剧本来源。");
      return;
    }
    const scriptPayload = recordPayload(script.payload);
    const prompt = [
      "请仅针对以下节奏诊断生成一份可审阅的剧本修订建议，不能直接修改内容。",
      `诊断类型：${pacingKindLabel(point.kind)}；时间轴位置：${point.position}；依据：${point.evidence.slice(0, 800)}`,
      `目标剧本 ID：${script.id}；基础版本：${script.version}；来源 ID：${point.sourceId}；来源版本：${point.sourceVersion}。`,
      "严格输出 JSON：{summary,content,data:{targets:[{kind:'script',id,baseVersion,patch:{payload:{...原payload,剧本内容:完整候选稿}},displayDiff:{proposedContent:'完整候选稿',pacingSourceId:'来源 ID',pacingSourceVersion:来源版本}}]}}。",
      "完整原 payload 已作为 target.scriptPayload 附在上下文中；必须保留未修改字段。",
    ].join("\n");
    try {
      const session = await client.agentSessions.create({
        projectId: props.projectId,
        taskType: "rewrite_ai_drama_script",
        title: `节奏修订建议：${script.title}`,
      });
      const run = await client.agentSessions.run(session.id, {
        taskType: "rewrite_ai_drama_script",
        prompt,
        target: {
          scriptId: script.id,
          scriptVersion: script.version,
          scriptPayload,
          pacingSourceId: point.sourceId,
          pacingSourceVersion: point.sourceVersion,
          evidence: point.evidence,
        },
      });
      setNotice(
        `已创建智能修订建议任务 ${run.taskId.slice(0, 8)}；请在任务中心确认预览、采用或放弃。`,
      );
      navigate("/tasks");
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const restoreCheckpoint = async (checkpoint: DomainEntity) => {
    try {
      await client.contentVersions.restore(checkpoint.id);
      setNotice("已恢复修订前版本；当前版本也已保存为新的检查点。");
      await invalidate();
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const pacingCheckpoints = checkpoints.filter((checkpoint) => {
    const checkpointPayload = recordPayload(checkpoint.payload);
    return (
      checkpointPayload["来源"] === "节奏修订预览采用前检查点" &&
      scriptIds.has(checkpoint.parentId ?? "")
    );
  });
  return (
    <section
      className="rounded-xl border border-line bg-surface p-4"
      aria-label="集级节奏看板"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">集级节奏看板</h2>
          <p className="mt-1 text-sm text-muted">
            四条轨道只呈现带来源的节奏点；这是编辑辅助，不预测市场成功。
          </p>
        </div>
        <span className="text-xs text-muted">
          {board.staleCount
            ? `${board.staleCount} 个标记待复核`
            : "来源均为当前版本"}
          {board.rejectedCount ? `；${board.rejectedCount} 个已否决` : ""}
        </span>
      </div>
      {!board.hasSources ? (
        <p className="mt-3 text-sm text-muted">
          尚无已采用分集、剧本、节拍、场景或镜头来源，无法生成可信的节奏曲线。
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {(["density", "highlight", "reversal", "cliffhanger"] as const).map(
            (kind) => (
              <section
                key={kind}
                className="rounded-lg border border-line p-3"
                aria-label={`${pacingKindLabel(kind)}轨道`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {pacingKindLabel(kind)}
                  </h3>
                  <BareButton
                    className="text-xs text-brand"
                    onClick={() => void addManual(kind)}
                  >
                    人工标记
                  </BareButton>
                </div>
                <ol className="mt-2 space-y-2 text-xs">
                  {board.points
                    .filter((point) => point.kind === kind)
                    .map((point) => (
                      <li
                        key={point.id}
                        className={
                          point.stale
                            ? "rounded-md bg-warning-soft p-2 text-warning-strong"
                            : "rounded-md bg-canvas p-2"
                        }
                      >
                        <BareButton
                          className="text-left underline"
                          onClick={() =>
                            point.scriptId && props.onOpenScript(point.scriptId)
                          }
                        >
                          {point.position}. {point.title}
                        </BareButton>
                        <p className="mt-1">{point.evidence}</p>
                        <p className="mt-1 text-muted">
                          {point.confidence === "manual"
                            ? "人工确认"
                            : "规则派生"}
                          {point.disposition === "rejected" ? " · 已否决" : ""}
                          {point.stale ? " · 来源已变化" : ""}
                        </p>
                        {point.confidence === "manual" &&
                          point.disposition === "active" && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <BareButton
                                className="text-xs text-link underline"
                                onClick={() => void editManual(point)}
                              >
                                调整
                              </BareButton>
                              <BareButton
                                className="text-xs text-muted underline"
                                onClick={() => void rejectManual(point)}
                              >
                                否决
                              </BareButton>
                            </div>
                          )}
                        {point.confidence === "derived" &&
                          point.disposition === "active" &&
                          point.scriptId && (
                            <BareButton
                              className="mt-2 text-xs text-link underline"
                              onClick={() => void createAiRecommendation(point)}
                            >
                              创建上下文 AI 修订预览
                            </BareButton>
                          )}
                      </li>
                    ))}
                  {!board.points.some((point) => point.kind === kind) && (
                    <li className="text-muted">暂无可追溯标记</li>
                  )}
                </ol>
              </section>
            ),
          )}
        </div>
      )}
      {scripts[0] && (
        <BareButton
          className="mt-3 rounded-md border border-brand px-3 py-2 text-sm text-brand"
          onClick={() => props.onOpenScript(scripts[0].id)}
        >
          定位到剧本
        </BareButton>
      )}
      {pacingCheckpoints.length > 0 && (
        <section
          className="mt-3 rounded-lg border border-line p-3"
          aria-label="节奏修订检查点"
        >
          <h3 className="text-sm font-medium">节奏修订检查点</h3>
          <p className="mt-1 text-xs text-muted">
            已采用的建议保留修订前内容，可随时恢复；恢复也会先保存当前版本。
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {pacingCheckpoints.slice(0, 3).map((checkpoint) => (
              <li
                key={checkpoint.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>{checkpoint.title}</span>
                <BareButton
                  className="text-link underline"
                  onClick={() => void restoreCheckpoint(checkpoint)}
                >
                  恢复此版本
                </BareButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
    </section>
  );
}

export function pacingKindLabel(kind: PacingKind): string {
  return {
    density: "节拍密度",
    highlight: "爽点",
    reversal: "反转",
    cliffhanger: "结尾悬念",
  }[kind];
}

export function EpisodeAnalysisPanel(props: { adaptationId: string }) {
  const client = useStudio();
  const history = currentOwnerQuery(
    useQuery({
      queryKey: ["episode-analysis", props.adaptationId],
      queryFn: async () =>
        readLegacyEpisodeAnalysis(
          await client.adaptationAnalysis.get(props.adaptationId),
          props.adaptationId,
        ),
      ...CURRENT_OWNER_READ_OPTIONS,
    }),
  );
  const analysis = history.data;
  return (
    <section
      aria-label="旧分集分析（未认证）"
      className="rounded-xl border border-line bg-surface p-4"
    >
      <h2 className="font-semibold">历史分集分析 · 未认证</h2>
      <p className="mt-1 text-sm text-muted">
        旧分析未读取实际分集而填写零分／零覆盖，已停止新生成和自动替换。
        原记录仅供只读查阅，不代表当前覆盖、叙事质量或模型评议。
      </p>
      {history.error ? (
        <p role="alert" className="mt-3 text-sm text-muted">
          原分集分析读取失败；未显示旧缓存，是否存在历史未知。
          {message(history.error)}
        </p>
      ) : analysis === undefined ? (
        <p className="mt-3 text-sm text-muted">
          正在实际读取原分集分析；未显示旧缓存。
        </p>
      ) : analysis === null ? (
        <p className="mt-3 text-sm text-muted">
          已实际读取，没有旧分集分析；不会生成固定零结论。
        </p>
      ) : (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-brand">
            展开原分集分析（未认证／量纲未知）
          </summary>
          <p className="mt-3 text-xs text-muted">
            原 ID：{analysis.id} · 原保存时间：{analysis.createdAt}
          </p>
          <p className="mt-3">原摘要（未认证）：{analysis.summary}</p>
          <p className="mt-3 text-xs text-muted">
            原条目数／数值（未认证，不证明覆盖）：分集 {analysis.episodeCount} ·
            综合 {analysis.overallScore}· 钩子 {analysis.hookCoverage} ·
            结尾悬念 {analysis.cliffhangerCoverage} · 简介{" "}
            {analysis.outlineCoverage}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
            {analysis.suggestions.map((item, index) => (
              <li key={index}>原建议（未认证）：{item}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export type ProductionStructureStage =
  "adaptations" | "episodes" | "scripts" | "scenes" | "shots";

/** A dedicated production-order editor, separate from the generic data editor. */
export function ProductionOrderPanel(props: {
  stage: ProductionStructureStage;
  parentId?: string;
  records: DomainEntity[];
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  if (!props.parentId || !["episodes", "scenes", "shots"].includes(props.stage))
    return null;
  const ordered = [...props.records].sort((left, right) => {
    const leftOrder = Number(recordPayload(left.payload)["排序"]);
    const rightOrder = Number(recordPayload(right.payload)["排序"]);
    const safeLeft =
      Number.isFinite(leftOrder) && leftOrder > 0
        ? leftOrder
        : Number.MAX_SAFE_INTEGER;
    const safeRight =
      Number.isFinite(rightOrder) && rightOrder > 0
        ? rightOrder
        : Number.MAX_SAFE_INTEGER;
    return (
      safeLeft - safeRight || left.createdAt.localeCompare(right.createdAt)
    );
  });
  const move = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ordered.length || !props.parentId) return;
    const next = [...ordered];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setSaving(true);
    setNotice(undefined);
    try {
      const input = {
        items: next.map((record) => ({
          id: record.id,
          version: record.version,
        })),
      };
      if (props.stage === "episodes")
        await client.productionStructure.reorderEpisodes(props.parentId, input);
      else if (props.stage === "scenes")
        await client.productionStructure.reorderScenes(props.parentId, input);
      else await client.productionStructure.reorderShots(props.parentId, input);
      setNotice("已保存顺序。若其他窗口同时修改过条目，请刷新后再次调整。");
      void queryClient.invalidateQueries({
        queryKey: ["resource", props.stage],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{domainLabel(props.stage)}顺序</h2>
          <p className="mt-1 text-sm text-muted">
            顺序会以完整列表和版本号原子保存，不会因局部更新产生重复序号。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand">
          共 {ordered.length} 项
        </span>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <ol className="mt-3 space-y-2">
        {ordered.map((record, index) => (
          <li
            key={record.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm">
              {index + 1}. {record.title}
            </span>
            <span className="flex shrink-0 gap-1">
              <BareButton
                className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                disabled={saving || index === 0}
                onClick={() => void move(index, -1)}
              >
                上移
              </BareButton>
              <BareButton
                className="rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
                disabled={saving || index === ordered.length - 1}
                onClick={() => void move(index, 1)}
              >
                下移
              </BareButton>
            </span>
          </li>
        ))}
      </ol>
      {!ordered.length && (
        <p className="mt-3 text-sm text-muted">
          建立至少两个条目后即可在此调整顺序。
        </p>
      )}
    </section>
  );
}

export function ScriptReviewPanel(props: { scriptId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const { data: review, isLoading } = useQuery({
    queryKey: ["production-review", "script", props.scriptId],
    queryFn: () => client.productionReviews.getScript(props.scriptId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.productionReviews.runScript(props.scriptId);
      setNotice(
        "已完成本地规则审查。它仅依据已保存的剧本和场景，不会冒充模型结论。",
      );
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "script", props.scriptId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!(await confirmDialog("删除这份剧本审查记录吗？"))) return;
    try {
      await client.productionReviews.removeScript(props.scriptId);
      setNotice("已删除剧本审查记录。");
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "script", props.scriptId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const scores = review
    ? [
        ["开场钩子", review.hookStrengthScore],
        ["对白", review.dialogueScore],
        ["冲突", review.conflictScore],
        ["视觉清晰度", review.visualClarityScore],
        ["场景清晰度", review.sceneClarityScore],
        ["分镜就绪度", review.shotReadinessScore],
        ["生成可制作性", review.aiVideoFeasibilityScore],
        ["结尾悬念", review.cliffhangerScore],
      ]
    : [];
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">剧本审查</h2>
          <p className="mt-1 text-sm text-muted">
            检查当前剧本正文、场景和制作准备度，结果可重新生成或删除。
          </p>
        </div>
        <div className="flex gap-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : review ? "重新审查" : "开始审查"}
          </BareButton>
          {review && (
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除审查
            </BareButton>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {review ? (
        <>
          <p className="mt-4 text-sm">
            综合得分：<strong>{review.overallScore}</strong> / 100
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {scores.map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-brand-soft px-3 py-2 text-sm"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="mt-1 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <ReviewFindings
            issues={review.issues}
            suggestions={review.suggestions}
          />
        </>
      ) : !isLoading ? (
        <p className="mt-3 text-sm text-muted">尚未生成审查记录。</p>
      ) : null}
    </section>
  );
}

export function ShotReviewPanel(props: { shotId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [taskType, setTaskType] = useState("人工快照");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [note, setNote] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const { data: review, isLoading } = useQuery({
    queryKey: ["production-review", "shot", props.shotId],
    queryFn: () => client.productionReviews.getShot(props.shotId),
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["prompt-versions", props.shotId],
    queryFn: () => client.productionReviews.listPromptVersions(props.shotId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.productionReviews.runShot(props.shotId);
      setNotice(
        "已完成本地规则审查。结论基于保存的镜头字段和提示词，不代表模型生成结果。",
      );
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "shot", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!(await confirmDialog("删除这份镜头审查记录吗？"))) return;
    try {
      await client.productionReviews.removeShot(props.shotId);
      setNotice("已删除镜头审查记录。");
      void queryClient.invalidateQueries({
        queryKey: ["production-review", "shot", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const append = async () => {
    if (!taskType.trim()) {
      setNotice("请填写版本来源。");
      return;
    }
    setSavingVersion(true);
    setNotice(undefined);
    try {
      const version = await client.productionReviews.appendPromptVersion(
        props.shotId,
        {
          taskType: taskType.trim(),
          ...(videoPrompt.trim() ? { videoPrompt: videoPrompt.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      );
      setNotice(`已保存提示词版本 ${version.version}。`);
      setVideoPrompt("");
      setNote("");
      void queryClient.invalidateQueries({
        queryKey: ["prompt-versions", props.shotId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setSavingVersion(false);
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">镜头审查与提示词版本</h2>
          <p className="mt-1 text-sm text-muted">
            审查可生成制作风险说明；提示词每次保存都会追加不可覆盖的版本。
          </p>
        </div>
        <div className="flex gap-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : review ? "重新审查" : "开始审查"}
          </BareButton>
          {review && (
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除审查
            </BareButton>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {review && (
        <>
          <p className="mt-4 text-sm">
            综合得分：<strong>{review.overallScore}</strong> / 100 · 制作难度：
            {review.aiVideoDifficulty === "low"
              ? "低"
              : review.aiVideoDifficulty === "medium"
                ? "中"
                : "高"}
          </p>
          <ReviewFindings
            issues={review.issues}
            suggestions={review.suggestions}
          />
        </>
      )}
      <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-line p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          版本来源
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          版本备注
          <input
            className="rounded-lg border border-line px-3 py-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：缩短动作后的可控版本"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          视频提示词（留空时会快照当前已保存的生成提示）
          <textarea
            className="min-h-20 rounded-lg border border-line px-3 py-2"
            value={videoPrompt}
            onChange={(event) => setVideoPrompt(event.target.value)}
          />
        </label>
        <div className="md:col-span-2">
          <BareButton
            className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={savingVersion}
            onClick={() => void append()}
          >
            {savingVersion ? "保存中…" : "保存提示词版本"}
          </BareButton>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-medium">提示词版本历史</h3>
        {versions.map((version) => (
          <article
            key={version.id}
            className="rounded-lg border border-line p-3 text-sm"
          >
            <p className="font-medium">
              版本 {version.version} · {version.taskType}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-muted">
              {version.videoPrompt || "（当前镜头尚未填写生成提示）"}
            </p>
            {version.note && (
              <p className="mt-1 text-xs text-muted">备注：{version.note}</p>
            )}
          </article>
        ))}
        {!versions.length && (
          <p className="text-sm text-muted">尚未保存提示词版本。</p>
        )}
      </div>
    </section>
  );
}

export function ReviewFindings(props: {
  issues: string[];
  suggestions: string[];
}) {
  if (!props.issues.length && !props.suggestions.length)
    return (
      <p className="mt-3 text-sm text-muted">当前规则未发现必须处理的问题。</p>
    );
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
      <div>
        <h3 className="font-medium">待核对项</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
          {props.issues.length ? (
            props.issues.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>暂无</li>
          )}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">改进建议</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
          {props.suggestions.length ? (
            props.suggestions.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>暂无</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function ScreenplayReader(props: { scriptId: string }) {
  const client = useStudio();
  const { data, error } = useQuery({
    queryKey: ["screenplay", props.scriptId],
    queryFn: () => client.screenplays.get(props.scriptId),
  });
  return (
    <article className="max-h-[600px] overflow-auto overscroll-contain rounded-lg border border-line bg-surface p-6">
      <h2 className="mb-4 font-semibold">{data?.title ?? "本集剧本"}</h2>
      {error && <p className="text-sm text-danger">{message(error)}</p>}
      {data && !data.blocks.length && (
        <p className="text-sm text-muted">
          剧本正文尚未创作。补充本集目标，生成、审阅并采用 AI
          草稿，或在资料管理中保存你自己的剧本。
        </p>
      )}
      {data?.blocks.map((block) => (
        <div
          key={block.id}
          className={
            block.type === "scene_heading"
              ? "mb-3 mt-6 border-b border-line pb-2 font-semibold"
              : block.type === "character"
                ? "mt-4 text-center font-medium"
                : block.type === "dialogue"
                  ? "mx-auto max-w-md whitespace-pre-wrap text-sm leading-7"
                  : "my-2 whitespace-pre-wrap text-sm leading-7"
          }
        >
          {"text" in block ? block.text : <hr />}
        </div>
      ))}
    </article>
  );
}
