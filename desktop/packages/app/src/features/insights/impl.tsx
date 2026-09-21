import {
  CreationWorkbench,
  CreationRecordWorkbench,
} from "../creation-workbench";
import type { FeedbackKind, FeedbackPreview } from "@dramaip/contracts/product";
import { BareButton } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WorkspaceIntro, message, useStudio } from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import { importWarning } from "../workspace/impl";
export function FeedbackPage() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(
    () => session.activeProjectId ?? "",
  );
  const [revisionClusterId, setRevisionClusterId] = useState<string>();
  const [revisionTargetId, setRevisionTargetId] = useState("");
  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ["resource", "scripts", projectId],
    queryFn: () => client.resources.list("scripts", projectId),
    enabled: Boolean(projectId),
  });
  const [preview, setPreview] = useState<FeedbackPreview>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { data: dashboard, error } = useQuery({
    queryKey: ["feedback", projectId],
    queryFn: () => client.feedback.dashboard(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (session.activeProjectId && projectId !== session.activeProjectId)
      setProjectId(session.activeProjectId);
  }, [projectId, session.activeProjectId]);
  const choose = async (kind: FeedbackKind) => {
    if (!projectId) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const selected = await client.host.pickFiles({
        multiple: false,
        extensions: ["csv", "json"],
      });
      const file = selected?.[0];
      if (!file) return;
      const result = await client.feedback.preview({
        projectId,
        kind,
        capabilityToken: file.grantId,
      });
      setPreview(result);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const batch = await client.feedback.commit(preview.importId, {
        projectId: preview.projectId,
      });
      setPreview(undefined);
      setNotice(
        `已导入 ${batch.rowCount} 条${batch.kind === "metrics" ? "运营指标" : "用户评论"}。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["feedback", preview.projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const cluster = async (batchId: string) => {
    if (!projectId) return;
    setWorking(true);
    setNotice(undefined);
    try {
      const clusters = await client.feedback.cluster({ projectId, batchId });
      setNotice(`已按内容主题整理为 ${clusters.length} 个评论簇。`);
      await queryClient.invalidateQueries({
        queryKey: ["feedback", projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const batches = dashboard?.batches ?? [];
  return (
    <section className="space-y-5">
      {revisionClusterId && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <h2 className="font-semibold">反馈修订</h2>
          <p className="text-sm text-muted">
            反馈没有可靠的内容定位，请选择本次要修订的章节或剧本。
          </p>
          <select
            aria-label="反馈修订目标"
            className="rounded border border-line p-2"
            value={revisionTargetId}
            onChange={(event) => setRevisionTargetId(event.target.value)}
          >
            <option value="">选择内容</option>
            {chapters.map((item) => (
              <option key={item.id} value={item.id}>
                章节 · {item.title}
              </option>
            ))}
            {scripts.map((item) => (
              <option key={item.id} value={item.id}>
                剧本 · {item.title}
              </option>
            ))}
          </select>
          {chapters.find((item) => item.id === revisionTargetId) ? (
            <CreationWorkbench
              projectId={projectId}
              operation="chapter"
              targetId={revisionTargetId}
              baseVersion={
                chapters.find((item) => item.id === revisionTargetId)!.version
              }
              feedbackClusterId={revisionClusterId}
              defaultInstruction="分析观众反馈与原文，核对定位和证据，结合创作方向生成修订候选并检查。"
            />
          ) : scripts.some((item) => item.id === revisionTargetId) ? (
            <CreationRecordWorkbench
              projectId={projectId}
              domain="scripts"
              operation="script-revision"
              targetId={revisionTargetId}
              feedbackClusterId={revisionClusterId}
              defaultInstruction="分析观众反馈与剧本，生成有依据的局部修订并检查。"
            />
          ) : null}
        </section>
      )}
      <WorkspaceIntro
        eyebrow="反馈闭环"
        title="运营数据与用户反馈"
        description="先预览再导入指标与评论；数据只保存在本地项目数据库，关联原文与目标，由 AI 分析反馈并提出修订候选。"
        badge="数据洞察"
      />
      <section className="rounded-xl border border-line bg-surface p-4">
        <label className="grid max-w-md gap-1 text-sm">
          所属项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              if (nextProjectId) session.selectProject(nextProjectId);
              setPreview(undefined);
              setNotice(undefined);
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
        <div className="mt-4 flex flex-wrap gap-2">
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!projectId || working}
            onClick={() => void choose("metrics")}
          >
            导入运营指标
          </BareButton>
          <BareButton
            className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
            disabled={!projectId || working}
            onClick={() => void choose("comments")}
          >
            导入用户评论
          </BareButton>
        </div>
      </section>
      {preview && (
        <section className="rounded-xl border border-brand bg-brand-soft/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">导入预览：{preview.sourceName}</h2>
              <p className="mt-1 text-sm text-muted">
                已识别 {preview.validCount} 条
                {preview.kind === "metrics" ? "运营指标" : "用户评论"}
                ；确认后才会写入。
              </p>
            </div>
            <BareButton
              className="text-sm text-muted hover:text-brand"
              disabled={working}
              onClick={() => setPreview(undefined)}
            >
              取消预览
            </BareButton>
          </div>
          {preview.warnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"
            >
              {importWarning(warning)}
            </p>
          ))}
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {preview.sample.map((item, index) => (
              <p
                key={index}
                className="rounded-lg border border-line bg-surface-raised p-3 text-xs leading-5 text-muted"
              >
                {feedbackSampleText(item, preview.kind)}
              </p>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <BareButton
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={working}
              onClick={() => void commit()}
            >
              {working ? "正在导入…" : "确认导入"}
            </BareButton>
          </div>
        </section>
      )}
      {working && (
        <p className="text-sm text-muted">正在读取、校验或整理本地反馈数据…</p>
      )}
      {(notice || error) && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice ?? message(error)}
        </p>
      )}
      {projectId && (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">导入批次</h2>
            <div className="mt-3 space-y-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{batch.sourceName}</p>
                    <p className="mt-1 text-xs text-muted">
                      {batch.kind === "metrics" ? "运营指标" : "用户评论"} ·{" "}
                      {batch.rowCount} 条
                    </p>
                  </div>
                  {batch.kind === "comments" && (
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={working}
                      onClick={() => void cluster(batch.id)}
                    >
                      整理评论主题
                    </BareButton>
                  )}
                </div>
              ))}
              {!batches.length && (
                <p className="text-sm text-muted">
                  尚未导入任何运营数据或用户评论。
                </p>
              )}
            </div>
          </article>
          <article className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">数据摘要</h2>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">指标</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.metrics.length ?? 0}
                </dd>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">评论</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.comments.length ?? 0}
                </dd>
              </div>
              <div className="rounded-lg bg-canvas p-3">
                <dt className="text-xs text-muted">主题簇</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {dashboard?.clusters.length ?? 0}
                </dd>
              </div>
            </dl>
            <div className="mt-4 space-y-2">
              {(dashboard?.clusters ?? []).map((cluster) => (
                <article
                  key={cluster.id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      {cluster.title}（{cluster.commentCount} 条）
                    </p>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
                      disabled={working}
                      onClick={() => {
                        setRevisionClusterId(cluster.id);
                        setRevisionTargetId("");
                      }}
                    >
                      分析反馈并修订
                    </BareButton>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {cluster.summary}
                  </p>
                </article>
              ))}
              {dashboard?.comments.slice(0, 3).map((comment) => (
                <p
                  key={comment.id}
                  className="rounded-lg bg-canvas p-3 text-sm text-muted"
                >
                  <span className="mr-2 text-xs text-brand">
                    {comment.category}
                  </span>
                  {comment.content}
                </p>
              ))}
            </div>
          </article>
        </section>
      )}
    </section>
  );
}

export function feedbackSampleText(value: unknown, kind: FeedbackKind): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "已识别一条数据。";
  const item = value as Record<string, unknown>;
  if (kind === "metrics")
    return `指标：${String(item.name ?? "未命名")}；数值：${String(item.value ?? "未提供")}`;
  return `评论：${String(item.content ?? "未提供").slice(0, 100)}`;
}
