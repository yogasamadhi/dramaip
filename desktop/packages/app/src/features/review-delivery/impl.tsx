import type {
  ChangePreview,
  CloudReviewPublishPreview,
  DeliveryCreativeVariant,
  EpisodeCompliancePreflight,
  EpisodeWorkflowKind,
  PlatformDeliveryArchive,
  PlatformDeliveryPreflight,
} from "@dramaip/contracts/product";
import { BareButton } from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  StageNavigation,
  WorkspaceIntro,
  domainLabel,
  type WorkspaceStageItem,
  message,
  productStatusLabel,
  useStudio,
} from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import {
  AgentChangePreviewCard,
  PluginResourceWorkspace,
} from "../studio-widgets";
export function ReviewDeliveryWorkspace() {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useStudioSession();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(session.activeProjectId ?? "");
  const [adaptationId, setAdaptationId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [stage, setStage] = useState<
    "quality" | "compliance" | "localization" | "review" | "delivery"
  >("quality");
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
  useEffect(() => {
    if (
      session.activeProjectId &&
      projects.some((project) => project.id === session.activeProjectId) &&
      projectId !== session.activeProjectId
    )
      setProjectId(session.activeProjectId);
  }, [projectId, projects, session.activeProjectId]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("projectId");
    if (requested && projects.some((project) => project.id === requested))
      setProjectId(requested);
  }, [location.search, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("stage");
    if (
      requested &&
      ["quality", "compliance", "localization", "review", "delivery"].includes(
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
  const requestedStage = new URLSearchParams(location.search).get("stage");
  const reviewStageIds = [
    "quality",
    "compliance",
    "localization",
    "review",
    "delivery",
  ] as const;
  const recommendedStage =
    requestedStage &&
    reviewStageIds.includes(requestedStage as (typeof reviewStageIds)[number])
      ? requestedStage
      : "quality";
  const stageItems: WorkspaceStageItem[] = reviewStageIds.map((id) => ({
    id,
    label: domainLabel(id),
    availability:
      projectId && adaptationId && episodeId ? "available" : "blocked",
    recommended: recommendedStage === id,
    reason: !projectId
      ? "请先创建或选择一个项目。"
      : !adaptationId
        ? "审核资料必须归属改编方案，请先创建或选择改编方案。"
        : "审核资料必须归属具体分集，请先创建或选择分集。",
    recoveryLabel: !projectId ? "返回项目工作台" : "去改编工作区补齐",
    recoveryTarget: !projectId
      ? "/"
      : `/adapt?${new URLSearchParams({
          projectId,
          stage: adaptationId ? "episodes" : "adaptations",
        })}`,
  }));
  const syncRoute = (next: {
    projectId?: string;
    stage?: typeof stage;
    adaptationId?: string;
    episodeId?: string;
  }) => {
    const search = new URLSearchParams();
    const values = { projectId, stage, adaptationId, episodeId, ...next };
    Object.entries(values).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    navigate(`/review?${search}`);
  };
  return (
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="审核交付工作区"
        title="质量、审片与交付"
        description="质量、合规、本地化、审片和平台交付记录统一归属到具体分集。"
        badge="交付就绪"
      />
      <div className="workbench space-y-4 rounded-xl border border-line bg-surface-muted p-4 shadow-float dark:bg-studio-dark">
        <section className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            项目
            <select
              className="rounded-lg border border-line px-3 py-2"
              value={projectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                setProjectId(nextProjectId);
                if (nextProjectId) session.selectProject(nextProjectId);
                setAdaptationId("");
                setEpisodeId("");
                syncRoute({
                  projectId: nextProjectId,
                  adaptationId: "",
                  episodeId: "",
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
                syncRoute({ adaptationId: nextId, episodeId: "" });
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
                syncRoute({ episodeId: nextId });
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
        </section>
        <StageNavigation
          label="审核交付阶段"
          items={stageItems}
          active={stage}
          onChange={(value) => {
            const nextStage = value as typeof stage;
            setStage(nextStage);
            syncRoute({ stage: nextStage });
          }}
        />
        {projectId && episodeId && (
          <EpisodeWorkflowPanel projectId={projectId} episodeId={episodeId} />
        )}
        {!projectId ? (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
            请先选择项目。
          </p>
        ) : stage === "delivery" && adaptationId && episodeId ? (
          <PlatformDeliveryPanel
            projectId={projectId}
            adaptationId={adaptationId}
            episodeId={episodeId}
          />
        ) : stage === "review" && adaptationId && episodeId ? (
          <ReviewEditorPanel episodeId={episodeId} />
        ) : stage === "compliance" && adaptationId && episodeId ? (
          <CompliancePreflightPanel
            episodeId={episodeId}
            episodeTitle={
              episodes.find((item) => item.id === episodeId)?.title ?? ""
            }
          />
        ) : stage === "quality" ? (
          <PluginResourceWorkspace
            owner="creative-quality"
            title="质量审核"
            domains={[stage]}
            projectId={projectId}
            parentId={episodeId}
            parentRequired
          />
        ) : stage === "localization" || stage === "delivery" ? (
          <PluginResourceWorkspace
            owner="delivery"
            title="本地化与交付"
            domains={[stage]}
            projectId={projectId}
            parentId={episodeId}
            parentRequired
          />
        ) : (
          <PluginResourceWorkspace
            owner="review"
            title="合规与审片"
            domains={[stage]}
            projectId={projectId}
            parentId={episodeId}
            parentRequired
          />
        )}
      </div>
    </section>
  );
}

export function PlatformDeliveryPanel(props: {
  projectId: string;
  adaptationId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [label, setLabel] = useState("方案一");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [coverAssetId, setCoverAssetId] = useState("");
  const [manualFieldsConfirmed, setManualFieldsConfirmed] = useState(false);
  const [preflight, setPreflight] = useState<PlatformDeliveryPreflight>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState<
    "保存候选" | "采用候选" | "运行预检" | "创建归档" | "导出" | undefined
  >();
  const { data: profiles = [] } = useQuery({
    queryKey: ["platform-delivery", "profiles"],
    queryFn: client.platformDelivery.listProfiles,
  });
  const { data: variants = [] } = useQuery({
    queryKey: ["platform-delivery", "variants", props.adaptationId],
    queryFn: () => client.platformDelivery.listVariants(props.adaptationId),
  });
  const { data: archives = [] } = useQuery({
    queryKey: ["platform-delivery", "archives", props.episodeId],
    queryFn: () => client.platformDelivery.listArchives(props.episodeId),
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["resource", "assets", props.projectId],
    queryFn: () => client.resources.list("assets", props.projectId),
  });
  useEffect(() => {
    if (!profileId && profiles[0]) setProfileId(profiles[0].id);
  }, [profileId, profiles]);
  useEffect(() => {
    if (!variants.some((variant) => variant.id === variantId))
      setVariantId(
        variants.find((variant) => variant.status === "adopted")?.id ??
          variants[0]?.id ??
          "",
      );
  }, [variantId, variants]);
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const resetPreflight = () => setPreflight(undefined);
  const saveVariant = async () => {
    const tagList = tags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !label.trim() ||
      !title.trim() ||
      !description.trim() ||
      !tagList.length
    ) {
      setNotice("候选必须填写标签、标题、简介和至少一个标签词。");
      return;
    }
    setWorking("保存候选");
    setNotice(undefined);
    try {
      const created = await client.platformDelivery.createVariant(
        props.adaptationId,
        {
          label: label.trim(),
          title: title.trim(),
          description: description.trim(),
          tags: tagList,
          ...(coverAssetId ? { coverAssetId } : {}),
          source: "manual",
        },
      );
      setVariantId(created.id);
      setTitle("");
      setDescription("");
      setTags("");
      setLabel(
        `方案 ${String.fromCharCode(65 + Math.min(variants.length + 1, 25))}`,
      );
      resetPreflight();
      setNotice(`已保存候选「${created.label}」，仍需显式采用后才能归档。`);
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "variants", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const adoptVariant = async (id: string) => {
    setWorking("采用候选");
    setNotice(undefined);
    try {
      const adopted = await client.platformDelivery.adoptVariant(id);
      setVariantId(adopted.id);
      resetPreflight();
      setNotice(`已采用「${adopted.label}」，此前采用的候选已归档保留。`);
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "variants", props.adaptationId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const currentInput = () => ({
    profileId,
    creativeVariantId: variantId,
    manualFieldsConfirmed,
  });
  const runPreflight = async () => {
    if (!profileId || !variantId) {
      setNotice("请先选择平台档案和创意候选。");
      return;
    }
    setWorking("运行预检");
    setNotice(undefined);
    try {
      const result = await client.platformDelivery.preflight(
        props.episodeId,
        currentInput(),
      );
      setPreflight(result);
      setNotice(
        result.ok
          ? "预检通过，可以创建可追溯的平台提交资料清单。"
          : `预检发现 ${result.blockers.length} 项阻断，请补齐后重试。`,
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createArchive = async () => {
    if (!preflight?.ok) {
      setNotice("请先运行并通过平台交付预检。");
      return;
    }
    setWorking("创建归档");
    setNotice(undefined);
    try {
      const archive = await client.platformDelivery.createArchive(
        props.episodeId,
        currentInput(),
      );
      setNotice(
        `已创建提交资料归档 v${String(archive.deliveryVersion).padStart(3, "0")}，不会覆盖历史记录。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["platform-delivery", "archives", props.episodeId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const exportArchive = async (archive: PlatformDeliveryArchive) => {
    setWorking("导出");
    setNotice(undefined);
    try {
      const document = await client.platformDelivery.exportArchive(archive.id);
      const result = await client.host.saveTextFile({
        suggestedName: document.fileName,
        content: document.content,
      });
      setNotice(result.saved ? "提交资料清单已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const assetTitle = (id?: string) =>
    assets.find((asset) => asset.id === id)?.title ?? "未引用";
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">平台交付</p>
        <h2 className="mt-1 text-lg font-semibold">
          提交文案、封面与版本化资料归档
        </h2>
        <p className="mt-1 text-sm text-muted">
          这里不会保存平台账号、登录或代投。它只创建可追溯的提交资料清单；真实成片、字幕和封面仍须由人工核验并附加。
        </p>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          平台交付档案
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">选择平台档案</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title} · {profile.video.width}×{profile.video.height}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          当前创意候选
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={variantId}
            onChange={(event) => {
              setVariantId(event.target.value);
              resetPreflight();
            }}
          >
            <option value="">选择创意候选</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label} · v{variant.versionNumber} · {variant.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedProfile && (
        <section className="rounded-xl border border-line p-3 text-sm">
          <p className="font-medium">{selectedProfile.title}</p>
          <p className="mt-1 text-muted">
            {selectedProfile.platform} · {selectedProfile.region} ·{" "}
            {selectedProfile.video.videoCodec}/
            {selectedProfile.video.audioCodec} · {selectedProfile.video.width}×
            {selectedProfile.video.height}
          </p>
          <p className="mt-1 text-xs text-muted">
            时长：{selectedProfile.duration.note} 字幕安全区：底部{" "}
            {selectedProfile.subtitleSafeZone.bottomMarginPx} 像素。
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={manualFieldsConfirmed}
              onChange={(event) => {
                setManualFieldsConfirmed(event.target.checked);
                resetPreflight();
              }}
            />
            <span>
              我已人工核对：{selectedProfile.manualFields.join("；")}。
            </span>
          </label>
        </section>
      )}
      <section className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          候选标签
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="例如：方案一"
          />
        </label>
        <label className="grid gap-1 text-sm">
          封面素材
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={coverAssetId}
            onChange={(event) => setCoverAssetId(event.target.value)}
          >
            <option value="">选择已归档封面素材</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          平台标题
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="用户可见的成品标题"
          />
        </label>
        <label className="grid gap-1 text-sm">
          标签词
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="用逗号分隔，例如：悬疑、反转"
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          平台简介
          <textarea
            className="min-h-24 rounded-lg border border-line bg-surface px-3 py-2"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="描述冲突、钩子和卖点；不会自动发布。"
          />
        </label>
        <div className="md:col-span-2">
          <BareButton
            className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={Boolean(working)}
            onClick={() => void saveVariant()}
          >
            {working === "保存候选" ? "正在保存…" : "保存为新候选"}
          </BareButton>
        </div>
      </section>
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">创意候选与采用历史</h3>
        {!variants.length && (
          <p className="text-sm text-muted">
            尚无候选。请先保存一个完整的标题、简介、标签词和封面组合。
          </p>
        )}
        {variants.map((variant: DeliveryCreativeVariant) => (
          <article
            key={variant.id}
            className={`rounded-lg border p-3 ${variant.id === variantId ? "border-brand" : "border-line"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                {variant.status === "adopted"
                  ? "已采用"
                  : variant.status === "archived"
                    ? "历史采用"
                    : "候选"}
              </span>
              <span className="text-sm font-medium">
                {variant.label} · v{variant.versionNumber} · {variant.title}
              </span>
              {variant.status !== "adopted" && (
                <BareButton
                  className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={Boolean(working)}
                  onClick={() => void adoptVariant(variant.id)}
                >
                  {working === "采用候选" ? "正在采用…" : "采用此候选"}
                </BareButton>
              )}
            </div>
            <p className="mt-2 text-sm">{variant.description}</p>
            <p className="mt-1 text-xs text-muted">
              标签：{variant.tags.join("、")} · 封面：
              {assetTitle(variant.coverAssetId)}
            </p>
          </article>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <BareButton
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={Boolean(working)}
          onClick={() => void runPreflight()}
        >
          {working === "运行预检" ? "正在预检…" : "运行平台交付预检"}
        </BareButton>
        <BareButton
          className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
          disabled={Boolean(working) || !preflight?.ok}
          onClick={() => void createArchive()}
        >
          {working === "创建归档" ? "正在归档…" : "创建提交资料归档"}
        </BareButton>
      </div>
      {preflight && <PlatformDeliveryPreflightView preflight={preflight} />}
      {notice && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">提交资料归档历史</h3>
        {!archives.length && (
          <p className="text-sm text-muted">尚未创建提交资料归档。</p>
        )}
        {archives.map((archive) => (
          <div
            key={archive.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm"
          >
            <span>v{String(archive.deliveryVersion).padStart(3, "0")}</span>
            <span className="text-muted">
              {archive.profileId} · {archive.createdAt}
            </span>
            <BareButton
              className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
              disabled={Boolean(working)}
              onClick={() => void exportArchive(archive)}
            >
              {working === "导出" ? "正在导出…" : "导出提交资料清单"}
            </BareButton>
          </div>
        ))}
      </section>
    </section>
  );
}

export function PlatformDeliveryPreflightView(props: {
  preflight: PlatformDeliveryPreflight;
}) {
  return (
    <section
      className={`rounded-xl border p-3 text-sm ${props.preflight.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
    >
      <p className="font-medium">
        {props.preflight.ok ? "预检通过：可创建提交资料归档" : "预检未通过"}
      </p>
      {props.preflight.finalBaseName && (
        <p className="mt-1 text-xs text-muted">
          建议文件前缀：{props.preflight.finalBaseName}
        </p>
      )}
      {props.preflight.blockers.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700">
          {props.preflight.blockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {props.preflight.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800">
          {props.preflight.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">
        归档将列明：{props.preflight.expectedFiles.join("、")}。
      </p>
    </section>
  );
}

export function CompliancePreflightPanel(props: {
  episodeId: string;
  episodeTitle: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(props.episodeTitle);
  const [subtitleLanguage, setSubtitleLanguage] = useState("中文");
  const [targetPlatform, setTargetPlatform] = useState("");
  const [targetRegion, setTargetRegion] = useState("中国大陆");
  const [deliveryDate, setDeliveryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [aigcDeclared, setAigcDeclared] = useState(false);
  const [manualReview, setManualReview] = useState(false);
  const [result, setResult] = useState<EpisodeCompliancePreflight>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  const { data: profiles = [] } = useQuery({
    queryKey: ["compliance", "profiles"],
    queryFn: client.compliance.listProfiles,
  });
  useEffect(() => {
    if (!title && props.episodeTitle) setTitle(props.episodeTitle);
  }, [props.episodeTitle, title]);
  const activate = async (id: string) => {
    setWorking(true);
    setNotice(undefined);
    try {
      const profile = await client.compliance.activateProfile(id);
      setNotice(`已启用规则档案「${profile.title}」。`);
      await queryClient.invalidateQueries({
        queryKey: ["compliance", "profiles"],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const preflight = async () => {
    if (!title.trim() || !subtitleLanguage.trim() || !deliveryDate) {
      setNotice("请填写交付剧名、字幕语言和交付日期。");
      return;
    }
    setWorking(true);
    setNotice(undefined);
    try {
      const next = await client.compliance.preflight(props.episodeId, {
        title: title.trim(),
        subtitleLanguage: subtitleLanguage.trim(),
        ...(targetPlatform.trim()
          ? { targetPlatform: targetPlatform.trim() }
          : {}),
        ...(targetRegion.trim() ? { targetRegion: targetRegion.trim() } : {}),
        deliveryDate,
        aigcDeclared,
        manualContentReviewConfirmed: manualReview,
      });
      setResult(next);
      setNotice(
        next.ok
          ? "合规预检通过，可作为后续受控媒体封装的依据。"
          : "合规预检存在阻断项。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">合规规则与预检</p>
        <h2 className="mt-1 text-lg font-semibold">
          版本化规则、人工声明与交付前核验
        </h2>
        <p className="mt-1 text-sm text-muted">
          规则档案是本地证据而非法律意见；预检不会伪造合规
          MP4、水印或平台审核结果。
        </p>
      </div>
      <section className="space-y-2 rounded-xl border border-line p-3">
        <h3 className="font-medium">规则档案</h3>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="rounded-lg border border-line p-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{profile.title}</span>
              <span className="text-muted">{profile.version}</span>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                {profile.active
                  ? "当前启用"
                  : profile.sourceStatus === "official"
                    ? "正式规则"
                    : "仅供参考"}
              </span>
              {!profile.active &&
                profile.sourceStatus === "official" &&
                profile.integrityStatus === "verified" && (
                  <BareButton
                    className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                    disabled={working}
                    onClick={() => void activate(profile.id)}
                  >
                    启用此规则
                  </BareButton>
                )}
            </div>
            <p className="mt-1 text-xs text-muted">
              发布：{profile.publishedAt.slice(0, 10)} · 完整性：
              {profile.integrityStatus === "verified"
                ? "已验证"
                : profile.integrityStatus === "invalid"
                  ? "无效"
                  : "未验证"}{" "}
              · 范围：{profile.regions.join("、") || "未限定"}
            </p>
          </div>
        ))}
      </section>
      <section className="grid gap-3 rounded-xl border border-line bg-page p-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          交付剧名
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          字幕语言
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={subtitleLanguage}
            onChange={(event) => setSubtitleLanguage(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标平台（可选）
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={targetPlatform}
            onChange={(event) => setTargetPlatform(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          目标地区（可选）
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={targetRegion}
            onChange={(event) => setTargetRegion(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          交付日期
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
          />
        </label>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={aigcDeclared}
              onChange={(event) => setAigcDeclared(event.target.checked)}
            />
            <span>
              我确认本交付包含 AI
              生成或合成内容，并同意按规则写入显式和隐式标识。
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={manualReview}
              onChange={(event) => setManualReview(event.target.checked)}
            />
            <span>
              我已完成人工核对：未成年人、历史/民俗、版权、许可证和备案。
            </span>
          </label>
        </div>
        <div className="md:col-span-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={working}
            onClick={() => void preflight()}
          >
            {working ? "正在预检…" : "运行合规预检"}
          </BareButton>
        </div>
      </section>
      {result && (
        <section
          className={`rounded-xl border p-3 text-sm ${result.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
        >
          <p className="font-medium">
            {result.ok ? "合规预检通过" : "合规预检未通过"}
            {result.visibleLabel
              ? ` · 固定可见标识：${result.visibleLabel}`
              : ""}
          </p>
          {result.blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-700">
              {result.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-800">
              {result.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            证据指纹：{result.sourceFingerprint}
          </p>
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

export function ReviewEditorPanel(props: { episodeId: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [packageId, setPackageId] = useState("");
  const [shotId, setShotId] = useState("");
  const [authorAlias, setAuthorAlias] = useState("");
  const [timecode, setTimecode] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [decision, setDecision] = useState<
    "approve" | "return" | "request_changes" | "note"
  >("note");
  const [decisionNote, setDecisionNote] = useState("");
  const [cloudBaseUrl, setCloudBaseUrl] = useState("");
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState("");
  const [cloudPin, setCloudPin] = useState("");
  const [cloudMedia, setCloudMedia] = useState<
    Array<{
      id: string;
      shotId: string;
      relativePath: string;
      mimeType: string;
      capabilityToken: string;
      name: string;
    }>
  >([]);
  const [cloudShareUrl, setCloudShareUrl] = useState<string>();
  const [cloudPublishPreview, setCloudPublishPreview] =
    useState<CloudReviewPublishPreview>();
  const [cloudPublishPreviewKey, setCloudPublishPreviewKey] = useState("");
  const [reviewRevisionScriptId, setReviewRevisionScriptId] = useState("");
  const [reviewRevisionContent, setReviewRevisionContent] = useState("");
  const [reviewRevisionPreview, setReviewRevisionPreview] =
    useState<ChangePreview>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState<string>();
  const { data: timeline, error: timelineError } = useQuery({
    queryKey: ["review-editor", "timeline", props.episodeId],
    queryFn: () => client.reviewEditor.timeline(props.episodeId),
  });
  const { data: preflight } = useQuery({
    queryKey: ["review-editor", "preflight", props.episodeId],
    queryFn: () => client.reviewEditor.preflight(props.episodeId),
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["review-editor", "packages", props.episodeId],
    queryFn: () => client.reviewEditor.listPackages(props.episodeId),
  });
  const selectedReviewPackage = packages.find((item) => item.id === packageId);
  const { data: reviewScripts = [] } = useQuery({
    queryKey: [
      "review-editor",
      "revision-scripts",
      selectedReviewPackage?.projectId,
      props.episodeId,
    ],
    queryFn: () =>
      client.resources.list(
        "scripts",
        selectedReviewPackage!.projectId,
        props.episodeId,
      ),
    enabled: Boolean(selectedReviewPackage),
  });
  const { data: cloudConnection } = useQuery({
    queryKey: ["cloud-review", "connection"],
    queryFn: () => client.cloudReview.connection(),
  });
  const { data: cloudBinding } = useQuery({
    queryKey: ["cloud-review", "binding", packageId],
    queryFn: () => client.cloudReview.binding(packageId),
    enabled: Boolean(packageId),
    retry: false,
  });
  const { data: credentialStorage } = useQuery({
    queryKey: ["credential-storage-status"],
    queryFn: () => client.host.getCredentialStorageStatus(),
  });
  useEffect(() => {
    if (!cloudConnection?.configured) return;
    setCloudBaseUrl((current) => current || cloudConnection.baseUrl);
    setCloudWorkspaceId((current) => current || cloudConnection.workspaceId);
  }, [cloudConnection]);
  useEffect(() => {
    if (!packages.some((item) => item.id === packageId))
      setPackageId(packages[0]?.id ?? "");
  }, [packageId, packages]);
  useEffect(() => {
    if (
      reviewRevisionScriptId &&
      !reviewScripts.some((item) => item.id === reviewRevisionScriptId)
    )
      setReviewRevisionScriptId("");
    if (!reviewRevisionScriptId && reviewScripts[0])
      setReviewRevisionScriptId(reviewScripts[0].id);
  }, [reviewRevisionScriptId, reviewScripts]);
  useEffect(() => {
    setReviewRevisionPreview(undefined);
  }, [packageId]);
  const { data: comments = [] } = useQuery({
    queryKey: ["review-editor", "comments", packageId],
    queryFn: () => client.reviewEditor.listComments(packageId),
    enabled: Boolean(packageId),
  });
  const { data: decisions = [] } = useQuery({
    queryKey: ["review-editor", "decisions", packageId],
    queryFn: () => client.reviewEditor.listDecisions(packageId),
    enabled: Boolean(packageId),
  });
  const cloudSelectionKey = JSON.stringify({
    packageId,
    media: cloudMedia.map((item) => ({
      id: item.id,
      shotId: item.shotId,
      relativePath: item.relativePath,
      mimeType: item.mimeType,
      capabilityToken: item.capabilityToken,
    })),
  });
  const currentCloudPublishPreview =
    cloudPublishPreviewKey === cloudSelectionKey
      ? cloudPublishPreview
      : undefined;
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "packages", props.episodeId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "comments", packageId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["review-editor", "decisions", packageId],
    });
  };
  const saveDocument = async (fileName: string, content: string) =>
    client.host.saveTextFile({ suggestedName: fileName, content });
  const exportTimeline = async (
    format: "manifest" | "edl" | "fcpxml" | "srt",
  ) => {
    setWorking(`时间线-${format}`);
    setNotice(undefined);
    try {
      const document = await client.timeline.exportDelivery(
        props.episodeId,
        format,
      );
      const result = await saveDocument(document.fileName, document.content);
      setNotice(result.saved ? "剪辑交换资料已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createPackage = async () => {
    setWorking("创建审片包");
    setNotice(undefined);
    try {
      const created = await client.reviewEditor.createPackage(props.episodeId);
      setPackageId(created.id);
      setNotice("已创建离线审片包记录；可以导出单文件审阅页分发给审片人。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const exportPackage = async () => {
    if (!packageId) return;
    setWorking("导出审片包");
    setNotice(undefined);
    try {
      const document = await client.reviewEditor.exportPackage(packageId);
      const result = await saveDocument(document.fileName, document.content);
      setNotice(
        result.saved
          ? "离线审片页已导出。审片人可在浏览器中填写意见并导出 JSON。"
          : "已取消导出。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const importOffline = async () => {
    if (!packageId) return;
    setWorking("导入审片意见");
    setNotice(undefined);
    try {
      const files = await client.host.pickFiles({
        multiple: false,
        extensions: ["json"],
      });
      const file = files?.[0];
      if (!file) return;
      const result = await client.reviewEditor.importOffline(packageId, {
        capabilityToken: file.grantId,
      });
      setNotice(
        `已导入 ${result.commentCount} 条审阅意见和 ${result.decisionCount} 条决定。`,
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const cloudMimeType = (name: string) => {
    const extension = name.split(".").pop()?.toLowerCase();
    return extension === "mp4"
      ? "video/mp4"
      : extension === "webp"
        ? "image/webp"
        : extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "mp3"
              ? "audio/mpeg"
              : extension === "wav"
                ? "audio/wav"
                : "text/vtt";
  };
  const chooseCloudMedia = async () => {
    const files = await client.host.pickFiles({
      multiple: true,
      extensions: ["mp4", "jpg", "jpeg", "png", "webp", "mp3", "wav", "vtt"],
    });
    if (!files?.length) return;
    setCloudMedia(
      files.map((file, index) => ({
        id: `cloud-${Date.now()}-${index}`,
        shotId: timeline?.clips[index]?.shotId ?? "",
        relativePath: `review/${file.displayName.replace(/[\\/]/g, "-")}`,
        mimeType: cloudMimeType(file.displayName),
        capabilityToken: file.grantId,
        name: file.displayName,
      })),
    );
  };
  const saveCloudConnection = async () => {
    if (!cloudBaseUrl.trim() || !cloudWorkspaceId.trim()) {
      setNotice("请填写平台地址、workspace 和短期访问令牌。");
      return;
    }
    if (credentialStorage?.available !== true) {
      setNotice("本机加密凭据库不可用，不能保存云审片令牌。");
      return;
    }
    setWorking("保存云审片连接");
    setNotice(undefined);
    let credentialRef: string | undefined;
    try {
      credentialRef = (
        await client.host.captureCredential({
          purpose: "cloud-review",
          label: "云审片短期访问令牌",
          policyId: "review.cloud.v1",
          allowedOrigin: new URL(cloudBaseUrl.trim()).origin,
        })
      ).credentialRef;
      await client.cloudReview.saveConnection({
        baseUrl: cloudBaseUrl.trim(),
        workspaceId: cloudWorkspaceId.trim(),
        credentialRef,
      });
      await queryClient.invalidateQueries({
        queryKey: ["cloud-review", "connection"],
      });
      setNotice("云审片连接已保存；令牌只保存在本机加密凭据库。");
    } catch (cause) {
      if (credentialRef)
        await client.host.removeCredential(credentialRef).catch(() => {});
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const publishCloudReview = async () => {
    if (!packageId || !cloudConnection?.configured || !cloudMedia.length) {
      setNotice("请先选择本地审片包、保存连接并选择至少一个媒体文件。");
      return;
    }
    if (cloudMedia.some((item) => !item.shotId)) {
      setNotice("每个上传媒体都必须显式关联一个分镜。");
      return;
    }
    if (!currentCloudPublishPreview) {
      setNotice("请先计算 SHA-256 发布预览并确认当前上传清单。");
      return;
    }
    setWorking("发布云审片");
    setNotice(undefined);
    try {
      const published = await client.cloudReview.publish(packageId, {
        ...(cloudPin.trim() ? { pin: cloudPin.trim() } : {}),
        media: cloudMedia.map(({ name: _name, ...item }) => item),
      });
      setCloudPin("");
      setCloudShareUrl(published.shareUrl);
      setNotice(
        `云审片包已发布，保留至 ${published.expiresAt}；请只分享下方链接。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["cloud-review", "binding", packageId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const previewCloudReview = async () => {
    if (!packageId || !cloudConnection?.configured || !cloudMedia.length) {
      setNotice("请先选择本地审片包、保存连接并选择至少一个媒体文件。");
      return;
    }
    if (cloudMedia.some((item) => !item.shotId)) {
      setNotice("每个上传媒体都必须显式关联一个分镜。");
      return;
    }
    setWorking("计算云审片发布预览");
    setNotice(undefined);
    try {
      const preview = await client.cloudReview.preview(packageId, {
        media: cloudMedia.map(({ name: _name, ...item }) => item),
      });
      setCloudPublishPreview(preview);
      setCloudPublishPreviewKey(cloudSelectionKey);
      setNotice("已在本机计算 SHA-256；尚未创建云端审片包或上传媒体。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const syncCloudReview = async () => {
    if (!packageId) return;
    setWorking("同步云端意见");
    setNotice(undefined);
    try {
      const synced = await client.cloudReview.sync(packageId);
      setNotice(
        `已按游标同步 ${synced.commentCount} 条意见和 ${synced.decisionCount} 条决定。`,
      );
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const deleteCloudReview = async () => {
    if (!packageId || !cloudBinding) return;
    setWorking("删除云审片");
    setNotice(undefined);
    try {
      const deleted = await client.cloudReview.delete(packageId);
      setCloudShareUrl(undefined);
      setCloudMedia([]);
      setNotice(
        deleted.localFeedbackPreserved
          ? "云审片包已删除；本地已同步的意见和决定已保留。"
          : "云审片包已删除。",
      );
      await queryClient.invalidateQueries({
        queryKey: ["cloud-review", "binding", packageId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createReviewRevisionPreview = async () => {
    if (
      !packageId ||
      !reviewRevisionScriptId ||
      !reviewRevisionContent.trim()
    ) {
      setNotice("请选择目标剧本并填写修订草案。");
      return;
    }
    setWorking("创建审片修订预览");
    setNotice(undefined);
    try {
      const preview = await client.reviewEditor.createRevisionPreview(
        packageId,
        {
          scriptId: reviewRevisionScriptId,
          proposedContent: reviewRevisionContent.trim(),
        },
      );
      setReviewRevisionPreview(preview);
      setNotice("已创建待确认修订预览；正式剧本尚未改写。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createComment = async () => {
    if (!packageId || !commentBody.trim()) {
      setNotice("请先选择审片包并填写意见。");
      return;
    }
    const parsedTimecode = Number(timecode);
    setWorking("保存意见");
    setNotice(undefined);
    try {
      await client.reviewEditor.createComment(packageId, {
        ...(shotId ? { shotId } : {}),
        ...(Number.isFinite(parsedTimecode) && parsedTimecode >= 0
          ? { timecodeSeconds: parsedTimecode }
          : {}),
        ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
        body: commentBody.trim(),
      });
      setCommentBody("");
      setNotice("审阅意见已保存到本地审片包记录。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const createDecision = async () => {
    if (!packageId) {
      setNotice("请先选择审片包。");
      return;
    }
    setWorking("保存决定");
    setNotice(undefined);
    try {
      await client.reviewEditor.createDecision(packageId, {
        ...(shotId ? { shotId } : {}),
        decision,
        ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
        ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
      });
      setDecisionNote("");
      setNotice("审片决定已保存，可作为后续返工和交付复核依据。");
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const resolveComment = async (id: string, resolved: boolean) => {
    setWorking(`处理意见-${id}`);
    try {
      await client.reviewEditor.resolveComment(id, resolved);
      await refresh();
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const decisionLabel = (value: string) =>
    value === "approve"
      ? "通过"
      : value === "return"
        ? "退回"
        : value === "request_changes"
          ? "需要修改"
          : "仅备注";
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <p className="text-sm text-muted">审片与剪辑交接</p>
        <h2 className="mt-1 text-lg font-semibold">
          离线审片包与可重链接剪辑时间线
        </h2>
        <p className="mt-1 text-sm text-muted">
          时间线不暴露绝对路径、不复制媒体，也不伪装为成片。导入剪辑软件后请人工重链接已核验媒体。
        </p>
      </div>
      {timelineError && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {message(timelineError)}
        </p>
      )}
      {timeline && (
        <section className="rounded-xl border border-line bg-page p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{timeline.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {timeline.clips.length} 个分镜 · {timeline.width}×
                {timeline.height} · {timeline.frameRate} 帧
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["manifest", "导出时间线数据"],
                  ["edl", "导出剪辑清单"],
                  ["fcpxml", "导出剪辑工程"],
                  ["srt", "导出字幕"],
                ] as const
              ).map(([format, label]) => (
                <BareButton
                  key={format}
                  className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                  disabled={Boolean(working)}
                  onClick={() => void exportTimeline(format)}
                >
                  {working === `时间线-${format}` ? "正在导出…" : label}
                </BareButton>
              ))}
            </div>
          </div>
          {preflight && (
            <div className="mt-3 rounded-lg border border-line bg-surface p-2 text-sm">
              <p>
                {preflight.canExport ? "时间线可导出" : "时间线存在阻断项"} ·
                已引用 {preflight.referencedClipCount} 个 · 待重链接{" "}
                {preflight.relinkRequiredCount} 个
              </p>
              {preflight.blockers.length > 0 && (
                <p className="mt-1 text-red-700">
                  {preflight.blockers.join("；")}
                </p>
              )}
              {preflight.warnings.map((item) => (
                <p key={item} className="mt-1 text-xs text-muted">
                  {item}
                </p>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1">
            {timeline.clips.map((clip) => (
              <div
                key={clip.id}
                className="rounded-lg border border-line bg-surface p-2 text-sm"
              >
                <span className="font-medium">
                  {clip.orderIndex + 1}. {clip.name}
                </span>
                <span className="ml-2 text-muted">
                  {clip.startSeconds.toFixed(1)}–
                  {(clip.startSeconds + clip.durationSeconds).toFixed(1)} 秒 ·{" "}
                  {clip.mediaStatus === "referenced"
                    ? "已引用媒体"
                    : "待人工重链接"}
                </span>
                {clip.subtitle && (
                  <p className="mt-1 text-xs text-muted">
                    字幕：{clip.subtitle}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">离线审片包</h3>
            <p className="mt-1 text-sm text-muted">
              导出的是中文单文件审阅页；意见 JSON 需要显式导回当前审片包。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BareButton
              className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={Boolean(working)}
              onClick={() => void createPackage()}
            >
              {working === "创建审片包" ? "正在创建…" : "创建离线审片包"}
            </BareButton>
            <BareButton
              className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={Boolean(working) || !packageId}
              onClick={() => void exportPackage()}
            >
              {working === "导出审片包" ? "正在导出…" : "导出离线审片页"}
            </BareButton>
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={Boolean(working) || !packageId}
              onClick={() => void importOffline()}
            >
              {working === "导入审片意见" ? "正在导入…" : "导入离线审片意见"}
            </BareButton>
          </div>
        </div>
        <label className="mt-3 grid gap-1 text-sm">
          当前审片包
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            <option value="">选择审片包</option>
            {packages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.createdAt}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">可选云审片</h3>
            <p className="mt-1 text-sm text-muted">
              仅上传下方明确选择的媒体。令牌只进入本机加密凭据库；不上传项目数据库、Provider
              密钥或未选文件。
            </p>
          </div>
          <span className="rounded-md bg-page px-2 py-1 text-xs text-muted">
            {cloudConnection?.configured ? "连接已保存" : "尚未配置"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            平台地址
            <input
              className="rounded-lg border border-line px-3 py-2"
              value={cloudBaseUrl}
              onChange={(event) => setCloudBaseUrl(event.target.value)}
              placeholder="例如：https://审片平台.example.com"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Workspace ID
            <input
              className="rounded-lg border border-line px-3 py-2"
              value={cloudWorkspaceId}
              onChange={(event) => setCloudWorkspaceId(event.target.value)}
              placeholder="已授权的 workspace"
            />
          </label>
          <div className="rounded-lg border border-line px-3 py-2 text-sm">
            <p className="font-medium">短期访问令牌</p>
            <p className="mt-1 text-xs text-muted">
              点击保存连接后，由独立安全窗口输入；主界面不会接触明文。
            </p>
          </div>
          <label className="grid gap-1 text-sm">
            分享 PIN（可选）
            <input
              className="rounded-lg border border-line px-3 py-2"
              type="password"
              inputMode="numeric"
              value={cloudPin}
              onChange={(event) => setCloudPin(event.target.value)}
              placeholder="4–12 位数字，仅本次发布使用"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BareButton
            className="rounded-md border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={Boolean(working) || credentialStorage?.available !== true}
            onClick={() => void saveCloudConnection()}
          >
            {working === "保存云审片连接" ? "正在保存…" : "保存安全连接"}
          </BareButton>
          <BareButton
            className="rounded-md border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={Boolean(working)}
            onClick={() => void chooseCloudMedia()}
          >
            选择要上传的媒体
          </BareButton>
          <BareButton
            className="rounded-md border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={
              Boolean(working) ||
              !packageId ||
              !cloudConnection?.configured ||
              !cloudMedia.length
            }
            onClick={() => void previewCloudReview()}
          >
            {working === "计算云审片发布预览"
              ? "正在计算…"
              : "计算 SHA-256 发布预览"}
          </BareButton>
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={
              Boolean(working) ||
              !packageId ||
              !cloudConnection?.configured ||
              !cloudMedia.length ||
              !currentCloudPublishPreview
            }
            onClick={() => void publishCloudReview()}
          >
            {working === "发布云审片" ? "正在发布…" : "确认发布选定媒体"}
          </BareButton>
          <BareButton
            className="rounded-md border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={
              Boolean(working) || !packageId || !cloudConnection?.configured
            }
            onClick={() => void syncCloudReview()}
          >
            {working === "同步云端意见" ? "正在同步…" : "按游标同步意见"}
          </BareButton>
          <BareButton
            className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
            disabled={Boolean(working) || !cloudBinding}
            onClick={() => void deleteCloudReview()}
          >
            {working === "删除云审片" ? "正在删除…" : "撤销并删除云审片"}
          </BareButton>
        </div>
        {credentialStorage?.available === false && (
          <p className="mt-2 text-xs text-red-700">
            {credentialStorage.message ?? "本机加密凭据库不可用。"}
          </p>
        )}
        {cloudMedia.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg bg-page p-3 text-sm">
            <p className="font-medium">发布清单（确认后才会上传）</p>
            {cloudMedia.map((item) => (
              <label
                key={item.id}
                className="grid gap-1 md:grid-cols-[1fr_220px] md:items-center"
              >
                <span className="truncate" title={item.relativePath}>
                  {item.name} · {item.mimeType} · {item.relativePath}
                </span>
                <select
                  className="rounded-md border border-line bg-surface px-2 py-1"
                  value={item.shotId}
                  onChange={(event) =>
                    setCloudMedia((current) =>
                      current.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, shotId: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                >
                  <option value="">关联分镜（必填）</option>
                  {timeline?.clips.map((clip) => (
                    <option key={clip.shotId} value={clip.shotId}>
                      {clip.orderIndex + 1}. {clip.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {currentCloudPublishPreview && (
          <div className="mt-3 space-y-2 rounded-lg border border-brand/30 bg-brand-soft/30 p-3 text-sm">
            <p className="font-medium">已计算的发布预览（尚未上传）</p>
            <p>
              Workspace：{currentCloudPublishPreview.workspaceId} · 存储：
              {currentCloudPublishPreview.storageBytes} /{" "}
              {currentCloudPublishPreview.maxStorageBytes} 字节
            </p>
            <p className="text-muted">
              保留期：{currentCloudPublishPreview.retention}
              <br />
              费用：{currentCloudPublishPreview.costEstimate}
            </p>
            {currentCloudPublishPreview.media.map((item) => (
              <p
                key={item.id}
                className="break-all rounded-md bg-surface p-2 text-xs"
              >
                {item.relativePath} · {item.sizeBytes} 字节 · SHA-256{" "}
                {item.sha256}
              </p>
            ))}
            <details className="rounded-md bg-surface p-2 text-xs">
              <summary className="cursor-pointer text-brand">
                查看 review manifest
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">
                {currentCloudPublishPreview.manifestJson}
              </pre>
            </details>
          </div>
        )}
        {cloudPublishPreview && !currentCloudPublishPreview && (
          <p className="mt-3 text-xs text-amber-800">
            上传清单已变化，请重新计算发布预览后再确认发布。
          </p>
        )}
        {(cloudShareUrl || cloudBinding?.shareUrl) && (
          <p className="mt-3 break-all rounded-lg bg-brand-soft p-3 text-sm text-brand">
            已创建受控分享链接：{cloudShareUrl ?? cloudBinding?.shareUrl}
            {cloudBinding &&
              ` · 状态：${productStatusLabel(cloudBinding.status)} · 到期：${cloudBinding.expiresAt}`}
          </p>
        )}
      </section>
      {packageId &&
        (comments.some((item) => !item.resolved) ||
          decisions.some(
            (item) =>
              item.decision === "return" || item.decision === "request_changes",
          )) && (
          <section className="rounded-xl border border-brand/30 bg-brand-soft/30 p-3">
            <h3 className="font-medium">从审片反馈创建修订预览</h3>
            <p className="mt-1 text-sm text-muted">
              未解决意见以及“退回 /
              需要修改”决定会作为上下文写入预览；确认应用前不会改写正式剧本。
            </p>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm">
                目标剧本
                <select
                  className="rounded-lg border border-line bg-surface px-3 py-2"
                  value={reviewRevisionScriptId}
                  onChange={(event) =>
                    setReviewRevisionScriptId(event.target.value)
                  }
                >
                  <option value="">选择本集剧本</option>
                  {reviewScripts.map((script) => (
                    <option key={script.id} value={script.id}>
                      {script.title} · 版本 {script.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                修订草案
                <textarea
                  className="min-h-36 rounded-lg border border-line bg-surface px-3 py-2"
                  value={reviewRevisionContent}
                  onChange={(event) =>
                    setReviewRevisionContent(event.target.value)
                  }
                  placeholder="基于审片反馈填写拟采用的剧本内容"
                />
              </label>
              <BareButton
                className="w-fit rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
                disabled={
                  Boolean(working) ||
                  !reviewRevisionScriptId ||
                  !reviewRevisionContent.trim()
                }
                onClick={() => void createReviewRevisionPreview()}
              >
                {working === "创建审片修订预览"
                  ? "正在创建…"
                  : "创建待确认修订预览"}
              </BareButton>
            </div>
            {reviewRevisionPreview && (
              <AgentChangePreviewCard preview={reviewRevisionPreview} />
            )}
          </section>
        )}
      {packageId && (
        <section className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-line p-3">
            <h3 className="font-medium">记录审阅意见</h3>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm">
                关联分镜
                <select
                  className="rounded-lg border border-line px-3 py-2"
                  value={shotId}
                  onChange={(event) => setShotId(event.target.value)}
                >
                  <option value="">项目级意见</option>
                  {timeline?.clips.map((clip) => (
                    <option key={clip.shotId} value={clip.shotId}>
                      {clip.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                时间码（秒）
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  type="number"
                  min="0"
                  step="0.1"
                  value={timecode}
                  onChange={(event) => setTimecode(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                署名（可选）
                <input
                  className="rounded-lg border border-line px-3 py-2"
                  value={authorAlias}
                  onChange={(event) => setAuthorAlias(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                审阅意见
                <textarea
                  className="min-h-24 rounded-lg border border-line px-3 py-2"
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="描述问题、建议或确认事项"
                />
              </label>
              <BareButton
                className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={Boolean(working)}
                onClick={() => void createComment()}
              >
                {working === "保存意见" ? "正在保存…" : "保存审阅意见"}
              </BareButton>
            </div>
            <div className="mt-4 space-y-2">
              {!comments.length && (
                <p className="text-sm text-muted">尚无审阅意见。</p>
              )}
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-line p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {comment.resolved ? "已解决" : "待处理"} ·{" "}
                      {comment.authorAlias ?? "未署名"}
                    </span>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={Boolean(working)}
                      onClick={() =>
                        void resolveComment(comment.id, !comment.resolved)
                      }
                    >
                      {comment.resolved ? "标为待处理" : "标为已解决"}
                    </BareButton>
                  </div>
                  <p className="mt-1">{comment.body}</p>
                  {comment.timecodeSeconds !== undefined && (
                    <p className="mt-1 text-xs text-muted">
                      时间码：{comment.timecodeSeconds} 秒
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-line p-3">
            <h3 className="font-medium">记录审片决定</h3>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm">
                决定
                <select
                  className="rounded-lg border border-line px-3 py-2"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as typeof decision)
                  }
                >
                  <option value="note">仅备注</option>
                  <option value="approve">通过</option>
                  <option value="return">退回</option>
                  <option value="request_changes">需要修改</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                决定说明（可选）
                <textarea
                  className="min-h-24 rounded-lg border border-line px-3 py-2"
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                />
              </label>
              <BareButton
                className="w-fit rounded-lg bg-brand px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={Boolean(working)}
                onClick={() => void createDecision()}
              >
                {working === "保存决定" ? "正在保存…" : "保存审片决定"}
              </BareButton>
            </div>
            <div className="mt-4 space-y-2">
              {!decisions.length && (
                <p className="text-sm text-muted">尚无审片决定。</p>
              )}
              {decisions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-line p-2 text-sm"
                >
                  <p>
                    {decisionLabel(item.decision)}
                    {item.authorAlias ? ` · ${item.authorAlias}` : ""}
                  </p>
                  {item.note && <p className="mt-1 text-muted">{item.note}</p>}
                </div>
              ))}
            </div>
          </section>
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

export function EpisodeWorkflowPanel(props: {
  projectId: string;
  episodeId: string;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const workflow = useMutation({
    mutationFn: (kind: EpisodeWorkflowKind) =>
      client.workflows.runEpisode(
        { projectId: props.projectId, episodeId: props.episodeId, kind },
        crypto.randomUUID(),
      ),
    onSuccess: async (result) => {
      setNotice(result.summary);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["resource"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const actions: Array<{
    kind: EpisodeWorkflowKind;
    label: string;
    description: string;
  }> = [
    {
      kind: "quality-check",
      label: "执行质量检查",
      description: "检查剧本、场景、分镜和素材是否具备继续制作的基础。",
    },
    {
      kind: "compliance-check",
      label: "执行合规预检",
      description: "结合基础风险词与素材归档状态，标出需人工核验的内容。",
    },
    {
      kind: "review-package",
      label: "生成审片包",
      description: "汇总当前剧本、场景、分镜和待审项目，形成审阅清单。",
    },
    {
      kind: "minimal-redo-plan",
      label: "生成最小返工计划",
      description: "按依赖关系整理优先处理步骤，不会直接改写任何内容。",
    },
    {
      kind: "delivery-preflight",
      label: "执行交付预检",
      description: "核查质量、合规、审片和本地化记录是否具备交付条件。",
    },
    {
      kind: "animatic-draft",
      label: "生成动态分镜草案",
      description: "根据分镜创建可审阅的节奏时间线，不伪造实际视频成片。",
    },
    {
      kind: "render-preflight",
      label: "执行渲染预检",
      description: "确认剧本、场景、分镜和素材是否具备提交真实渲染任务的条件。",
    },
  ];
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">分集审核与制作工具</h2>
        <p className="mt-1 text-sm text-muted">
          每次执行都会创建可追踪任务和持久化报告；不会修改剧本、分镜或正式交付内容。
        </p>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <BareButton
            key={action.kind}
            className="rounded-xl border border-line p-3 text-left transition hover:border-brand disabled:opacity-50"
            disabled={workflow.isPending}
            onClick={() => workflow.mutate(action.kind)}
          >
            <span className="block text-sm font-medium text-brand">
              {action.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              {action.description}
            </span>
          </BareButton>
        ))}
      </div>
      {workflow.isPending && (
        <p className="mt-3 text-sm text-muted">正在执行检查并保存报告…</p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}
