import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge } from "@dramaip/ui-shared";
import { WorkspaceIntro, message, useStudio } from "../../studio-shared";
import { AgentProviderActionPreviewCard } from "../studio-widgets";
import { readProjectProviderReview } from "../../provider-action-review";
import {
  loadConfirmations,
  type ConfirmationCategory,
} from "../../pending-confirmations";

const CATEGORIES: Array<{ id: ConfirmationCategory; label: string }> = [
  { id: "waiting", label: "待确认" },
  { id: "running", label: "进行中" },
  { id: "attention", label: "需要处理" },
];

export function PendingConfirmationPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const projectId = params.get("projectId") ?? undefined;
  const providerPreviewId = params.get("providerActionPreviewId") ?? undefined;
  const hasProviderLink = params.has("providerActionPreviewId");
  const invalidProjectScope =
    params.has("projectId") &&
    (params.getAll("projectId").length !== 1 || !projectId?.trim());
  const invalidProviderLink = Boolean(
    hasProviderLink &&
    (!projectId ||
      ["projectId", "providerActionPreviewId"].some(
        (key) => params.getAll(key).length !== 1 || !params.get(key)?.trim(),
      )),
  );
  const requestedCategory = params.get("category");
  const category =
    CATEGORIES.find((item) => item.id === requestedCategory)?.id ?? "waiting";
  const evidence = useQuery({
    queryKey: ["pending-confirmations", projectId],
    queryFn: () => loadConfirmations(client, projectId),
    enabled: !invalidProjectScope,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15_000,
    retry: false,
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.events.subscribe((event) => {
      if (
        !/^(automation\.|delivery\.(manuscript|pilot-package)|knowledge\.|workspace\.|writing\.|creative-quality\.(narrative-report-|local-review-changed\.)|production\.(diagnosis-|season-plan-|episode-source-revision-))/.test(
          event.type,
        ) ||
        timer
      )
        return;
      // Coalesce status bursts; token streaming must not rescan every project.
      timer = setTimeout(() => {
        timer = undefined;
        void queryClient.invalidateQueries({
          queryKey: ["pending-confirmations"],
        });
      }, 1000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [client, queryClient]);
  const update = (key: string, value?: string) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`/pending?${next}`);
  };
  // A failed refresh can retain React Query's earlier data. It is no longer
  // verified: do not keep old object links or silently switch project scope.
  const verified =
    !invalidProjectScope &&
    evidence.isSuccess &&
    !evidence.error &&
    evidence.isFetchedAfterMount
      ? evidence.data
      : undefined;
  const items =
    verified?.items.filter((item) => item.category === category) ?? [];
  const incomplete = Boolean(
    invalidProjectScope || evidence.error || verified?.unavailable.length,
  );
  return (
    <section className="space-y-5">
      <WorkspaceIntro
        eyebrow="审阅与恢复"
        title="待确认中心"
        description="统一查看真实候选、独立人工／规则评议、来源声明、记忆变更、稿件／内部试制包权利确认、厂商费用预览和任务异常。列表只读元数据并返回原对象独立审阅；人工与规则不认证文学质量，打开本页不会采用内容、保存文件或授权费用。"
        badge={projectId ? "当前项目" : "全部项目"}
      />
      {invalidProjectScope && (
        <p role="alert">指定项目引用重复／为空，未忽略或替换项目范围。</p>
      )}
      {hasProviderLink &&
        (invalidProviderLink ? (
          <p role="alert">
            指定费用预览的项目或身份重复／为空，未打开其他调用。
          </p>
        ) : (
          <ProviderConfirmation
            key={`${projectId}:${providerPreviewId}`}
            projectId={projectId!}
            id={providerPreviewId!}
          />
        ))}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          项目范围
          <select
            aria-label="待确认项目范围"
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={projectId ?? ""}
            onChange={(event) =>
              update("projectId", event.target.value || undefined)
            }
          >
            <option value="">全部项目</option>
            {projectId &&
            !verified?.projects.some((project) => project.id === projectId) ? (
              <option value={projectId}>当前链接项目（状态未核对）</option>
            ) : null}
            {verified?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          size="sm"
          loading={evidence.isFetching}
          onClick={() => void evidence.refetch()}
        >
          刷新状态
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link
            to={
              projectId
                ? `/tasks?projectId=${encodeURIComponent(projectId)}`
                : "/tasks?scope=all"
            }
          >
            任务历史与配置
          </Link>
        </Button>
      </div>
      <div
        role="tablist"
        aria-label="待确认分类"
        className="flex flex-wrap gap-2"
      >
        {CATEGORIES.map((tab) => (
          <Button
            key={tab.id}
            role="tab"
            aria-selected={category === tab.id}
            variant={category === tab.id ? "secondary" : "ghost"}
            onClick={() => update("category", tab.id)}
          >
            {tab.label} ·{" "}
            {evidence.isLoading
              ? "读取中"
              : incomplete
                ? "未核全"
                : (verified?.items.filter((item) => item.category === tab.id)
                    .length ?? 0)}
          </Button>
        ))}
      </div>
      {evidence.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft p-4 text-sm text-danger-strong"
        >
          {message(evidence.error)}{" "}
          待确认状态未核验，已隐藏旧缓存中的对象入口，不能视为空列表。请刷新重新核对。
        </p>
      )}
      {verified?.unavailable.length ? (
        <div
          role="alert"
          className="rounded-lg border border-line bg-surface-muted p-4 text-sm"
        >
          部分资料未能读取，下方仅展示已完整读取的领域资料，计数未核全；请刷新或检查连接。
          <ul className="mt-2 list-inside list-disc">
            {verified.unavailable.map((item) => (
              <li key={`${item.source}:${item.projectId ?? "global"}`}>
                {item.source}
                {item.projectId
                  ? ` · ${verified.projects.find((project) => project.id === item.projectId)?.title ?? "项目不可用"}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div role="tabpanel" aria-label="待确认项目列表" className="space-y-3">
        {items.map((item) => (
          <article
            key={item.key}
            data-confirmation-key={item.key}
            className="rounded-lg border border-line bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{item.title}</h2>
                <p className="mt-1 text-xs text-muted">
                  {item.projectTitle} ·{" "}
                  {new Date(item.updatedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <StatusBadge
                tone={
                  category === "attention"
                    ? "danger"
                    : category === "running"
                      ? "info"
                      : "warning"
                }
              >
                {item.status}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm text-muted">{item.detail}</p>
            <Button className="mt-3" variant="secondary" size="sm" asChild>
              <Link to={item.to}>返回对应对象</Link>
            </Button>
          </article>
        ))}
        {evidence.isLoading ? (
          <p className="text-sm text-muted">正在核对各领域的实际状态…</p>
        ) : !incomplete && !items.length ? (
          <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            此分类没有待处理项。已采用、已放弃和已取消的结果保留在各自历史中。
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ProviderConfirmation({
  projectId,
  id,
}: {
  projectId: string;
  id: string;
}) {
  const client = useStudio();
  const actual = useQuery({
    queryKey: ["pending-provider-preview", projectId, id],
    queryFn: () => readProjectProviderReview(client, { projectId, id }),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    refetchInterval: 1500,
  });
  return (
    <section
      aria-label="指定费用与外部调用确认"
      className="rounded-lg border border-brand p-4"
    >
      <h2 className="text-sm font-semibold">指定费用与外部调用确认</h2>
      {actual.error || !actual.data || !actual.isFetchedAfterMount ? (
        <p role={actual.error ? "alert" : "status"}>
          {actual.error
            ? message(actual.error)
            : "正在读取指定原预览和实际项目，未使用历史缓存…"}
        </p>
      ) : (
        <AgentProviderActionPreviewCard
          preview={actual.data}
          projectId={projectId}
        />
      )}
    </section>
  );
}
