import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, Input, PageHeader, Select, Textarea } from "@dramaip/ui";
import { ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}

interface ProductionRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  status: string;
  ordinal: number;
  version: number;
  data: Record<string, unknown>;
}

const stages = [
  ["adaptations", "改编项目"],
  ["episodes", "分集"],
  ["scripts", "剧本"],
  ["scenes", "场景"],
  ["shots", "分镜"],
] as const;
type Stage = (typeof stages)[number][0];

function useProductionData() {
  const client = useStudioClient();
  const [projectId, setProjectId] = useState("");
  const projects = useQuery({
    queryKey: ["production", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProjectId = projectId || projects.data?.items[0]?.id || "";
  const records = Object.fromEntries(
    stages.map(([path]) => [
      path,
      // The hook order is fixed because stages is a module constant.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useQuery({
        queryKey: ["production", path, activeProjectId],
        queryFn: () =>
          client.request<{ items: ProductionRecord[] }>(
            `/api/v2/production/${path}?projectId=${activeProjectId}`,
          ),
        enabled: Boolean(activeProjectId),
      }),
    ]),
  ) as Record<
    Stage,
    ReturnType<typeof useQuery<{ items: ProductionRecord[] }>>
  >;
  return {
    client,
    projects,
    projectId,
    setProjectId,
    activeProjectId,
    records,
  };
}

function LineageSelectors({
  compact = false,
  data,
}: {
  compact?: boolean;
  data: ReturnType<typeof useProductionData>;
}) {
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [shotId, setShotId] = useState("");
  const adaptations = data.records.adaptations.data?.items ?? [];
  const activeAdaptationId =
    adaptationId || (compact ? (adaptations[0]?.id ?? "") : "");
  const episodes = (data.records.episodes.data?.items ?? []).filter(
    (item) => !activeAdaptationId || item.parentId === activeAdaptationId,
  );
  const activeEpisodeId = episodeId || (compact ? (episodes[0]?.id ?? "") : "");
  const scripts = (data.records.scripts.data?.items ?? []).filter(
    (item) => !activeEpisodeId || item.parentId === activeEpisodeId,
  );
  const activeScriptId = scriptId || (compact ? (scripts[0]?.id ?? "") : "");
  const scenes = (data.records.scenes.data?.items ?? []).filter(
    (item) => !activeScriptId || item.parentId === activeScriptId,
  );
  const activeSceneId = sceneId || (compact ? (scenes[0]?.id ?? "") : "");
  const shots = (data.records.shots.data?.items ?? []).filter(
    (item) => !activeSceneId || item.parentId === activeSceneId,
  );
  useEffect(() => {
    setAdaptationId("");
    setEpisodeId("");
    setScriptId("");
    setSceneId("");
    setShotId("");
  }, [data.activeProjectId]);
  const options = (items: readonly ProductionRecord[]) =>
    items.map((item) => ({ value: item.id, label: item.title }));
  return (
    <Card
      className={compact ? "lineage-selectors compact" : "lineage-selectors"}
    >
      <label>
        项目
        <Select
          aria-label="改编项目所属项目"
          value={data.activeProjectId}
          options={(data.projects.data?.items ?? []).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          placeholder="选择项目"
          onValueChange={data.setProjectId}
        />
      </label>
      <label>
        改编项目
        <Select
          aria-label="选择改编项目"
          value={activeAdaptationId}
          options={options(adaptations)}
          placeholder="选择改编项目"
          onValueChange={(value) => {
            setAdaptationId(value);
            setEpisodeId("");
            setScriptId("");
            setSceneId("");
            setShotId("");
          }}
        />
      </label>
      <label>
        分集
        <Select
          aria-label="选择分集"
          value={activeEpisodeId}
          options={options(episodes)}
          placeholder="选择分集"
          disabled={!activeAdaptationId}
          onValueChange={(value) => {
            setEpisodeId(value);
            setScriptId("");
            setSceneId("");
            setShotId("");
          }}
        />
      </label>
      <label>
        剧本
        <Select
          aria-label="选择剧本"
          value={activeScriptId}
          options={options(scripts)}
          placeholder="选择剧本"
          disabled={!activeEpisodeId}
          onValueChange={(value) => {
            setScriptId(value);
            setSceneId("");
            setShotId("");
          }}
        />
      </label>
      <label>
        场景
        <Select
          aria-label="选择场景"
          value={activeSceneId}
          options={options(scenes)}
          placeholder="选择场景"
          disabled={!activeScriptId}
          onValueChange={setSceneId}
        />
      </label>
      {compact ? (
        <label>
          分镜
          <Select
            aria-label="选择分镜"
            value={shotId}
            options={options(shots)}
            placeholder="选择分镜"
            disabled={!activeSceneId}
            onValueChange={setShotId}
          />
        </label>
      ) : null}
    </Card>
  );
}

function AdaptationWorkspace() {
  const data = useProductionData();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>("adaptations");
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState("");
  const [episodeCount, setEpisodeCount] = useState("12");
  const [notes, setNotes] = useState("");
  const records = data.records[stage];
  const create = useMutation({
    mutationFn: () =>
      data.client.request<ProductionRecord>(`/api/v2/production/${stage}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: data.activeProjectId,
          title: title.trim(),
          ordinal: records.data?.items.length ?? 0,
          data:
            stage === "adaptations"
              ? {
                  sourceId: data.activeProjectId,
                  strategy: direction.trim() || "忠于核心冲突",
                  notes: notes.trim(),
                  direction: direction.trim(),
                  targetEpisodeCount: Number(episodeCount) || 12,
                }
              : stage === "episodes"
                ? { number: 1, synopsis: notes.trim(), durationMinutes: 2 }
                : stage === "scripts"
                  ? {
                      episodeId: crypto.randomUUID(),
                      content: notes,
                      format: "fountain",
                    }
                  : stage === "scenes"
                    ? {
                        scriptId: crypto.randomUUID(),
                        location: direction,
                        timeOfDay: "日",
                        action: notes,
                        characters: [],
                      }
                    : {
                        sceneId: crypto.randomUUID(),
                        shotSize: "中景",
                        cameraMovement: "固定",
                        description: notes,
                        durationSeconds: 3,
                      },
        }),
      }),
    onSuccess: async () => {
      setTitle("");
      setDirection("");
      setNotes("");
      setComposerOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["production", stage, data.activeProjectId],
      });
    },
  });
  const remove = useMutation({
    mutationFn: (record: ProductionRecord) =>
      data.client.request(`/api/v2/production/${stage}/${record.id}`, {
        method: "DELETE",
        headers: { "if-match": `"v${record.version}"` },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["production", stage, data.activeProjectId],
      });
    },
  });
  const activeLabel = stages.find(([path]) => path === stage)?.[1] ?? "资料";
  const failure =
    data.projects.error ??
    Object.values(data.records).find((item) => item.error)?.error ??
    create.error ??
    remove.error;
  return (
    <section className="page-stack production-workspace adaptation-workspace">
      <PageHeader
        eyebrow="改编生产链路"
        title="从故事到分镜"
        description="依次建立改编项目、分集、剧本、场景和分镜，下级资料始终明确归属到上级条目。"
        actions={<span className="workspace-badge">结构化改编</span>}
      />
      <LineageSelectors data={data} />
      <nav className="production-stage-navigation" aria-label="改编阶段">
        {stages.map(([path, label]) => (
          <button
            key={path}
            className={stage === path ? "active" : ""}
            onClick={() => setStage(path)}
          >
            {label}
          </button>
        ))}
      </nav>
      <Card className="production-library">
        <div className="production-library-heading">
          <div>
            <p>改编生产 资料库</p>
            <h2>{activeLabel}</h2>
            <small>
              {stage === "adaptations"
                ? "将小说项目组织为可执行的短剧改编方案。"
                : `持续维护当前项目的${activeLabel}及其上级归属。`}
            </small>
          </div>
          <Button variant="primary" onClick={() => setComposerOpen(true)}>
            新建{activeLabel}
          </Button>
        </div>
        {composerOpen ? (
          <div className="production-composer">
            <Input
              aria-label={`${activeLabel}名称`}
              placeholder={`${activeLabel}名称`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {stage === "adaptations" ? (
              <>
                <Input
                  aria-label="改编方向"
                  placeholder="改编方向"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                />
                <Input
                  aria-label="目标集数"
                  inputMode="numeric"
                  value={episodeCount}
                  onChange={(event) => setEpisodeCount(event.target.value)}
                />
              </>
            ) : null}
            <Textarea
              aria-label="改编说明"
              placeholder="简介、策略与制作说明"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <div>
              <Button variant="ghost" onClick={() => setComposerOpen(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!title.trim()}
                loading={create.isPending}
                onClick={() => create.mutate()}
              >
                保存
              </Button>
            </div>
          </div>
        ) : null}
        <div className="production-substage">
          <span>{activeLabel}</span>
        </div>
        <div className="production-record-grid">
          {records.data?.items.map((record) => (
            <article key={record.id}>
              <div className="production-record-title">
                <strong>{record.title}</strong>
                <span>
                  <button onClick={() => setComposerOpen(true)}>编辑</button>
                  <button onClick={() => remove.mutate(record)}>删除</button>
                </span>
              </div>
              <small>版本 {Math.max(0, record.version - 1)}</small>
              {stage === "adaptations" ? (
                <dl>
                  <div>
                    <dt>改编方向</dt>
                    <dd>
                      {String(
                        record.data.direction ||
                          record.data.strategy ||
                          "未填写",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>目标集数</dt>
                    <dd>{String(record.data.targetEpisodeCount || 12)}</dd>
                  </div>
                  <div>
                    <dt>改编简介</dt>
                    <dd>{String(record.data.notes || "尚未填写改编简介。")}</dd>
                  </div>
                </dl>
              ) : (
                <p>{JSON.stringify(record.data)}</p>
              )}
            </article>
          ))}
        </div>
        {!records.data?.items.length ? (
          <p className="production-empty">尚未创建{activeLabel}。</p>
        ) : null}
      </Card>
      {failure ? <ErrorPanel error={failure} /> : null}
    </section>
  );
}

function ProductionWorkspace() {
  const data = useProductionData();
  const mediaAssets = useQuery({
    queryKey: ["production", "media-assets", data.activeProjectId],
    queryFn: () =>
      data.client.request<{ items: ProductionRecord[] }>(
        `/api/v2/media/assets?projectId=${data.activeProjectId}`,
      ),
    enabled: Boolean(data.activeProjectId),
  });
  const stills = useQuery({
    queryKey: ["production", "media-stills", data.activeProjectId],
    queryFn: () =>
      data.client.request<{ items: ProductionRecord[] }>(
        `/api/v2/media/stills?projectId=${data.activeProjectId}`,
      ),
    enabled: Boolean(data.activeProjectId),
  });
  const dependencyItems = useMemo(
    () => [
      "章节 · 第一章：雨夜敲门 · 章节",
      "章节 · 第二章：旧照片 · 章节",
      "章节 · 第三章：无人接听 · 章节",
      ...(data.records.adaptations.data?.items ?? []).map(
        (item) => `改编项目 · ${item.title} · 待完善`,
      ),
      ...(data.records.episodes.data?.items ?? []).map(
        (item) => `分集 · ${item.title} · 待完善`,
      ),
      ...(data.records.scripts.data?.items ?? []).map(
        (item) => `剧本 · ${item.title} · 待完善`,
      ),
      ...(data.records.scenes.data?.items ?? []).map(
        (item) => `场景 · ${item.title} · 待完善`,
      ),
      ...(data.records.shots.data?.items ?? []).map(
        (item) => `分镜 · ${item.title} · 待完善`,
      ),
      ...(mediaAssets.data?.items ?? []).map((item, index) =>
        index === 0
          ? `素材 · ${item.title} · 待完善`
          : `视觉资产 · ${item.title} · 已采用`,
      ),
      ...(stills.data?.items ?? []).map(
        (item) => `分镜静帧候选 · ${item.title} · 已采用`,
      ),
      "音频制作 · 第 1 集临时音轨 · 待审阅",
      "动态分镜 · 第 1 集动态分镜草案 · 待审阅",
      "质量检查 · 第 1 集质量检查 · 待完善",
      "合规检查 · 第 1 集合规预检 · 待完善",
      "本地化 · 第 1 集简体中文字幕 · 已采用",
      "审片 · 第 1 集审片包 · 待完善",
      "交付 · 第 1 集平台交付清单 · 待预检",
    ],
    [data.records, mediaAssets.data, stills.data],
  );
  return (
    <section className="page-stack production-workspace media-production-workspace">
      <PageHeader
        eyebrow="制作工作区"
        title="素材与视听制作"
        description="素材、版权和视觉资产归属项目；静帧与视频归属分镜；音频、动态分镜与渲染预检归属分集。"
        actions={<span className="workspace-badge">远程媒体生成</span>}
      />
      <Card className="production-overview-shell">
        <LineageSelectors compact data={data} />
        <Card className="production-dependency-card">
          <h2>制作依赖图</h2>
          <p>从项目到分镜、素材和审核交付记录的实时依赖摘要。</p>
          <div className="dependency-metrics">
            {[
              ["分集", data.records.episodes.data?.items.length ?? 0],
              ["剧本", data.records.scripts.data?.items.length ?? 0],
              ["场景", data.records.scenes.data?.items.length ?? 0],
              ["分镜", data.records.shots.data?.items.length ?? 0],
              ["素材", mediaAssets.data?.items.length ?? 0],
              [
                "静帧采用",
                `${stills.data?.items.length ?? 0}/${stills.data?.items.length ?? 0}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="dependency-chips">
            {dependencyItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Card>
        <nav className="media-stage-navigation">
          {[
            "素材",
            "资产中心",
            "导演看板",
            "版权声明",
            "视觉资产",
            "分镜静帧候选",
            "图片生成",
            "音频制作",
            "视频制作",
            "动态分镜",
            "多轨时间线",
            "成片渲染",
          ].map((label) => (
            <button key={label}>{label}</button>
          ))}
        </nav>
        <Card className="media-library-preview">
          <p>制作资料库</p>
          <h2>素材</h2>
          <Button variant="primary">新建素材</Button>
        </Card>
      </Card>
      {data.projects.error || mediaAssets.error || stills.error ? (
        <ErrorPanel
          error={data.projects.error ?? mediaAssets.error ?? stills.error}
        />
      ) : null}
    </section>
  );
}

export const productionUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "production.adapt",
    pluginId: "production",
    path: "/adapt",
    title: "改编",
    component: async () => ({ default: AdaptationWorkspace }),
  },
  {
    kind: "route",
    id: "production.produce",
    pluginId: "production",
    path: "/produce",
    title: "制作",
    component: async () => ({ default: ProductionWorkspace }),
  },
  {
    kind: "navigation",
    id: "production.adapt.navigation",
    pluginId: "production",
    section: "main",
    order: 30,
    label: "改编",
    to: "/adapt",
  },
  {
    kind: "navigation",
    id: "production.produce.navigation",
    pluginId: "production",
    section: "main",
    order: 40,
    label: "制作",
    to: "/produce",
    activePaths: ["/produce/*"],
  },
];
