import type { DomainEntity } from "@dramaip/contracts/product";
import { BareButton, confirmDialog } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildEpisodePacingBoard,
  type PacingKind,
  type PacingPoint,
} from "../../episode-pacing";
import {
  StageNavigation,
  WorkspaceIntro,
  domainLabel,
  message,
  useStudio,
} from "../../studio-shared";
import { PluginResourceWorkspace, recordPayload } from "../studio-widgets";
import { StoryBibleSidecar } from "../workspace/impl";
export function AdaptationWorkspace() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [shotId, setShotId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [stage, setStage] = useState<
    "adaptations" | "episodes" | "scripts" | "scenes" | "shots"
  >("adaptations");
  const { data: adaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: episodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ["resource", "scripts", projectId, episodeId],
    queryFn: () => client.resources.list("scripts", projectId, episodeId),
    enabled: Boolean(projectId && episodeId),
  });
  const { data: scenes = [] } = useQuery({
    queryKey: ["resource", "scenes", projectId, scriptId],
    queryFn: () => client.resources.list("scenes", projectId, scriptId),
    enabled: Boolean(projectId && scriptId),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ["resource", "shots", projectId, sceneId],
    queryFn: () => client.resources.list("shots", projectId, sceneId),
    enabled: Boolean(projectId && sceneId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
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
  return (
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="改编生产链路"
        title="从故事到分镜"
        description="依次建立改编项目、分集、剧本、场景和分镜，下级资料始终明确归属到上级条目。"
        badge="结构化改编"
      />
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setAdaptationId("");
              setEpisodeId("");
              setScriptId("");
              setSceneId("");
              setShotId("");
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
              setNotice(undefined);
              if (!nextId || !projectId) return;
              void client.productionStructure
                .selectCurrentAdaptation(projectId, { adaptationId: nextId })
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
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          分集
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!adaptationId}
            value={episodeId}
            onChange={(event) => {
              setEpisodeId(event.target.value);
              setScriptId("");
              setSceneId("");
              setShotId("");
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
              setScriptId(event.target.value);
              setSceneId("");
              setShotId("");
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
              setSceneId(event.target.value);
              setShotId("");
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
        {stage === "shots" && (
          <label className="grid gap-1 text-sm">
            分镜
            <select
              className="rounded-lg border border-line px-3 py-2"
              disabled={!sceneId}
              value={shotId}
              onChange={(event) => setShotId(event.target.value)}
            >
              <option value="">选择分镜</option>
              {shots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <StageNavigation
        label="改编阶段"
        items={["adaptations", "episodes", "scripts", "scenes", "shots"]}
        active={stage}
        onChange={(value) => setStage(value as typeof stage)}
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
              <ScriptReviewPanel scriptId={scriptId} />
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
          <PluginResourceWorkspace
            owner="production"
            title="改编生产"
            domains={[stage]}
            projectId={projectId}
            parentId={parentId}
            parentRequired={parentRequired}
          />
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
    if (
      !(await confirmDialog(
        "恢复此修订前检查点吗？当前剧本会先自动保存为新的检查点。",
      ))
    )
      return;
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
                            ? "rounded-md bg-amber-50 p-2 text-amber-800"
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
                                className="text-xs text-brand underline"
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
                              className="mt-2 text-xs text-brand underline"
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
                  className="text-brand underline"
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
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const { data: analysis, isLoading } = useQuery({
    queryKey: ["episode-analysis", props.adaptationId],
    queryFn: () => client.adaptationAnalysis.get(props.adaptationId),
  });
  const run = async () => {
    setNotice(undefined);
    try {
      await client.adaptationAnalysis.run(props.adaptationId);
      setNotice("已根据已保存的分集资料生成覆盖分析；它不会虚构模型评估。");
      void queryClient.invalidateQueries({
        queryKey: ["episode-analysis", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  const remove = async () => {
    if (!(await confirmDialog("删除这份分集分析记录吗？"))) return;
    try {
      await client.adaptationAnalysis.remove(props.adaptationId);
      setNotice("已删除分集分析记录。");
      void queryClient.invalidateQueries({
        queryKey: ["episode-analysis", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">分集结构分析</h2>
          <p className="mt-1 text-sm text-muted">
            汇总分集的钩子、结尾悬念和简介覆盖情况，可随时重新生成或删除。
          </p>
        </div>
        <div className="flex gap-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white"
            onClick={() => void run()}
          >
            {isLoading ? "读取中…" : analysis ? "重新分析" : "开始分析"}
          </BareButton>
          {analysis && (
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
              onClick={() => void remove()}
            >
              删除分析
            </BareButton>
          )}
        </div>
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      {analysis ? (
        <>
          <p className="mt-3 text-sm">{analysis.summary}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-4">
            {[
              ["综合", analysis.overallScore],
              ["钩子", analysis.hookCoverage],
              ["结尾悬念", analysis.cliffhangerCoverage],
              ["分集简介", analysis.outlineCoverage],
            ].map(([label, score]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-brand-soft p-3 text-center"
              >
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{score}%</dd>
              </div>
            ))}
          </dl>
          {analysis.suggestions.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              {analysis.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </>
      ) : !isLoading ? (
        <p className="mt-3 text-sm text-muted">尚未生成分集分析记录。</p>
      ) : null}
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
