import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, PageHeader, Select } from "@dramaip/ui";
import { ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}

interface DomainRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  status: string;
  version: number;
  data: Record<string, unknown>;
}

const reviewStages = [
  ["quality", "质量检查"],
  ["compliance", "合规检查"],
  ["localization", "本地化"],
  ["review", "审片"],
  ["delivery", "交付"],
] as const;
type ReviewStage = (typeof reviewStages)[number][0];

function ReviewWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [stage, setStage] = useState<ReviewStage>("quality");
  const [notice, setNotice] = useState("");
  const projects = useQuery({
    queryKey: ["review", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProjectId = projectId || projects.data?.items[0]?.id || "";
  const adaptations = useQuery({
    queryKey: ["review", "adaptations", activeProjectId],
    queryFn: () =>
      client.request<{ items: DomainRecord[] }>(
        `/api/v2/production/adaptations?projectId=${activeProjectId}`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const activeAdaptationId =
    adaptationId || adaptations.data?.items[0]?.id || "";
  const episodes = useQuery({
    queryKey: ["review", "episodes", activeProjectId],
    queryFn: () =>
      client.request<{ items: DomainRecord[] }>(
        `/api/v2/production/episodes?projectId=${activeProjectId}`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const episodeOptions = useMemo(
    () =>
      (episodes.data?.items ?? [])
        .filter(
          (item) => !activeAdaptationId || item.parentId === activeAdaptationId,
        )
        .map((item) => ({ value: item.id, label: item.title })),
    [activeAdaptationId, episodes.data],
  );
  const activeEpisodeId = episodeId || episodeOptions[0]?.value || "";
  const qualityChecks = useQuery({
    queryKey: ["review", "quality-checks", activeProjectId],
    queryFn: () =>
      client.request<{ items: DomainRecord[] }>(
        `/api/v2/creative-quality/quality-checks?projectId=${activeProjectId}`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const chapters = useQuery({
    queryKey: ["review", "chapters", activeProjectId],
    queryFn: () =>
      client.request<{
        items: Array<{ id: string; content: string; title: string }>;
      }>(`/api/v2/writing/projects/${activeProjectId}/chapters`),
    enabled: Boolean(activeProjectId),
  });
  const assets = useQuery({
    queryKey: ["review", "assets", activeProjectId],
    queryFn: () =>
      client.request<{
        items: Array<{
          id: string;
          data: { rightsStatus: string; adoptionStatus: string };
        }>;
      }>(`/api/v2/media/assets?projectId=${activeProjectId}`),
    enabled: Boolean(activeProjectId),
  });

  const createRecord = async (
    path: `/api/v2/${string}`,
    title: string,
    data: Record<string, unknown>,
    idempotent = false,
  ) =>
    client.request(path, {
      method: "POST",
      headers: idempotent
        ? { "idempotency-key": crypto.randomUUID() }
        : undefined,
      body: JSON.stringify({
        projectId: activeProjectId,
        parentId: activeEpisodeId || undefined,
        title,
        data,
      }),
    });

  const action = useMutation({
    mutationFn: async (kind: string) => {
      if (!activeProjectId || !activeEpisodeId)
        throw new Error("请先选择项目、改编项目和分集。");
      if (kind === "quality") {
        const source = chapters.data?.items.filter((chapter) =>
          chapter.content.trim(),
        );
        if (!source?.length)
          throw new Error("至少完成一章正文后才能执行质量检查。");
        const totalWords = source.reduce(
          (sum, chapter) => sum + chapter.content.replace(/\s/gu, "").length,
          0,
        );
        const score = Math.min(
          100,
          Math.round((totalWords / Math.max(1, source.length * 1200)) * 100),
        );
        return createRecord(
          "/api/v2/creative-quality/quality-checks",
          `第 ${source.length} 章质量检查`,
          {
            targetId: activeEpisodeId,
            score,
            checks: [
              {
                name: "正文长度",
                passed: score >= 60,
                detail: `已检查 ${totalWords} 字`,
              },
            ],
          },
        );
      }
      if (kind === "compliance")
        return createRecord(
          "/api/v2/creative-quality/compliance-checks",
          "第 1 集合规预检",
          {
            targetId: activeEpisodeId,
            profile: "本地交付预检",
            passed: Boolean(assets.data?.items.length),
            findings: assets.data?.items.length
              ? []
              : ["尚未导入可用于交付的本地资产"],
          },
        );
      if (kind === "review-package") {
        const usableAssets = (assets.data?.items ?? [])
          .filter(
            (asset) =>
              asset.data.rightsStatus === "cleared" &&
              asset.data.adoptionStatus !== "rejected",
          )
          .map((asset) => asset.id);
        if (!usableAssets.length)
          throw new Error("请先导入并确认至少一个本地资产后再生成审片包。");
        return createRecord("/api/v2/review/packages", "当前分集审片包", {
          versionId: activeEpisodeId,
          assetIds: usableAssets,
          reviewerIds: [],
        });
      }
      if (kind === "delivery")
        return createRecord(
          "/api/v2/delivery/platform-specs",
          "第 1 集平台交付预检",
          {
            platform: "通用竖屏",
            aspectRatio: "9:16",
            codec: "H.264",
            maxDurationMs: 180_000,
            metadata: {},
          },
        );
      if (kind === "localization")
        return client.request("/api/v2/writing/localizations", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            projectId: activeProjectId,
            sourceId: activeEpisodeId,
            locale: "zh-CN",
            content: "",
          }),
        });
      return createRecord(
        "/api/v2/automation/tasks",
        kind === "animatic" ? "生成动态分镜草案" : "最小返工计划",
        { state: "queued", progress: 0 },
        true,
      );
    },
    onSuccess: async (_, kind) => {
      setNotice(
        `${workflowActions.find((item) => item.id === kind)?.title ?? "操作"}已创建可追踪记录。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["review", "quality-checks", activeProjectId],
      });
      await queryClient.invalidateQueries({ queryKey: ["automation"] });
    },
  });

  const failure =
    projects.error ??
    adaptations.error ??
    episodes.error ??
    qualityChecks.error ??
    chapters.error ??
    assets.error ??
    action.error;
  const stageLabel =
    reviewStages.find(([value]) => value === stage)?.[1] ?? "审核交付";
  return (
    <section className="page-stack review-workspace">
      <PageHeader
        eyebrow="审核交付工作区"
        title="质量、审片与交付"
        description="质量、合规、本地化、审片和平台交付记录统一归属到具体分集。"
        actions={<span className="workspace-badge">交付就绪</span>}
      />
      <Card className="review-overview-shell">
        <Card className="review-lineage-selectors">
          <label>
            项目
            <Select
              aria-label="审核交付项目"
              value={activeProjectId}
              options={(projects.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              placeholder="选择项目"
              onValueChange={(value) => {
                setProjectId(value);
                setAdaptationId("");
                setEpisodeId("");
              }}
            />
          </label>
          <label>
            改编项目
            <Select
              aria-label="审核交付改编项目"
              value={activeAdaptationId}
              options={(adaptations.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.title,
              }))}
              placeholder="选择改编项目"
              onValueChange={(value) => {
                setAdaptationId(value);
                setEpisodeId("");
              }}
            />
          </label>
          <label>
            分集
            <Select
              aria-label="审核交付分集"
              value={activeEpisodeId}
              options={episodeOptions}
              placeholder="选择分集"
              onValueChange={setEpisodeId}
            />
          </label>
        </Card>
        <nav className="review-stage-navigation" aria-label="审核交付阶段">
          {reviewStages.map(([value, label]) => (
            <button
              key={value}
              className={stage === value ? "active" : ""}
              onClick={() => setStage(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <Card className="review-workflow-card">
          <h2>分集审核与制作工具</h2>
          <p>
            每次执行都会创建可追踪任务和持久化报告；不会修改剧本、分镜或正式交付内容。
          </p>
          <div className="review-action-grid">
            {workflowActions.map((item) => (
              <button
                key={item.id}
                disabled={action.isPending || !activeEpisodeId}
                onClick={() => action.mutate(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card className="review-library">
          <div>
            <p>审核交付 资料库</p>
            <h2>{stageLabel}</h2>
            <small>
              {stage === "quality"
                ? "记录质量门禁、问题、返工和确认处理。"
                : `维护当前分集的${stageLabel}记录。`}
            </small>
          </div>
          <Button variant="primary" onClick={() => action.mutate(stage)}>
            新建{stageLabel}
          </Button>
          {stage === "quality" && qualityChecks.data?.items.length ? (
            <div className="review-records">
              {qualityChecks.data.items.map((item) => (
                <article key={item.id}>{item.title}</article>
              ))}
            </div>
          ) : null}
        </Card>
      </Card>
      {notice ? <p className="creative-notice">{notice}</p> : null}
      {failure ? <ErrorPanel error={failure} /> : null}
    </section>
  );
}

const workflowActions = [
  {
    id: "quality",
    title: "执行质量检查",
    description: "检查剧本、场景、分镜和素材是否具备继续制作的基础。",
  },
  {
    id: "compliance",
    title: "执行合规预检",
    description: "结合基础风险词与素材归档状态，标出需人工核验的内容。",
  },
  {
    id: "review-package",
    title: "生成审片包",
    description: "汇总当前剧本、场景、分镜和待审项目，形成审阅清单。",
  },
  {
    id: "rework",
    title: "生成最小返工计划",
    description: "按依赖关系整理优先处理步骤，不会直接改写任何内容。",
  },
  {
    id: "delivery",
    title: "执行交付预检",
    description: "核查质量、合规、审片和本地化记录是否具备交付条件。",
  },
  {
    id: "animatic",
    title: "生成动态分镜草案",
    description: "根据分镜创建可审阅的节奏时间线，不伪造实际视频成片。",
  },
  {
    id: "render",
    title: "执行渲染预检",
    description: "确认剧本、场景、分镜和素材是否具备提交真实渲染任务的条件。",
  },
] as const;

export const reviewUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "review.workspace",
    pluginId: "review",
    path: "/review",
    title: "审核交付",
    component: async () => ({ default: ReviewWorkspace }),
  },
  {
    kind: "navigation",
    id: "review.navigation",
    pluginId: "review",
    section: "main",
    order: 50,
    label: "审核交付",
    to: "/review",
    activePaths: ["/review/*"],
  },
];
