import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
} from "../../current-owner-read";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@dramaip/ui-shared";
import {
  sameAuthorIntentCreationSource,
  type AuthorIntentCreationRequest,
} from "@dramaip/contracts/workspace";
import type { Project } from "@dramaip/contracts/product";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";
import { NovelContextPicker } from "../novel/NovelContextPicker";
import { CreationWorkbench } from "../creation-workbench";
import { message, useStudio } from "../../studio-shared";
import { confirmAuthorIntentCreationRequest } from "../../author-intent-creation-request";

export function AuthorIntentCreationPanel({ project }: { project: Project }) {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const workflowId =
    new URLSearchParams(location.search).get("intentWorkflowId") ?? undefined;
  const navigationError = exactNavigationError(
    new URLSearchParams(location.search),
    ["intentWorkflowId", "intentId"],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [expressions, setExpressions] = useState<NarrativeContextRequest>();
  const [confirmed, setConfirmed] = useState<AuthorIntentCreationRequest>();
  const [notice, setNotice] = useState<string>();
  const catalog = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intent-sources", project.id],
      queryFn: () => client.authorIntents.sources(project.id),
      staleTime: 0,
    }),
  );
  const recovered = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intent-workflow", project.id, workflowId],
      queryFn: () => client.creation.get(workflowId!),
      enabled: Boolean(workflowId) && !navigationError,
      staleTime: 0,
      refetchInterval: 1500,
    }),
  );
  const original =
    !navigationError &&
    recovered.data &&
    recovered.data.id === workflowId &&
    recovered.data.input.projectId === project.id &&
    recovered.data.input.operation === "author-intent" &&
    recovered.data.input.authorIntentRequest
      ? recovered.data
      : undefined;
  // An exact restored workflow always displays its own frozen request, never
  // the selection left in this component by another run on the same project.
  const request = navigationError
    ? undefined
    : workflowId
      ? original?.input.authorIntentRequest
      : confirmed;
  const openWorkflow = (id: string) => {
    const search = new URLSearchParams(location.search);
    search.set("intentWorkflowId", id);
    navigate(`${location.pathname}?${search}`);
  };
  const available = catalog.data;
  const allowedChapters =
    available?.items
      .filter(
        (item) =>
          item.source.kind === "chapter" && selected.includes(item.source.id),
      )
      .map((item) => item.source) ?? [];
  const directory = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: [
        "author-intent-expression-directory",
        project.id,
        allowedChapters,
      ],
      enabled: Boolean(
        expressions && available?.chapterAvailable && allowedChapters.length,
      ),
      queryFn: async () => {
        const rows = await client.chapters.list(project.id);
        if (
          new Set(rows.map((row) => row.id)).size !== rows.length ||
          rows.some((row) => row.projectId !== project.id)
        )
          throw new Error("原章节目录归属未核对，未改选来源。");
        const selectedRows = rows.filter((row) =>
          allowedChapters.some((source) => source.id === row.id),
        );
        if (
          selectedRows.length !== allowedChapters.length ||
          allowedChapters.some(
            (source) =>
              !selectedRows.some(
                (row) => row.id === source.id && row.version === source.version,
              ),
          )
        )
          throw new Error("原允许章节版本已变化，请核对后重新选择表达。");
        return selectedRows.sort(
          (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
        );
      },
      staleTime: 0,
    }),
  );
  const mixedReady =
    !expressions ||
    Boolean(
      allowedChapters.length &&
      directory.data &&
      !directory.error &&
      (expressions.chapters.length || expressions.summaries?.length),
    );
  const stale =
    request &&
    original?.stage !== "applied" &&
    original?.stage !== "discarded" &&
    available &&
    (request.projectVersion !== available.projectVersion ||
      request.baseAdoptedId !== available.baseAdoptedId ||
      request.sources.some(
        (source) =>
          !available.items.some((item) =>
            sameAuthorIntentCreationSource(item.source, source),
          ),
      ));
  return (
    <section
      aria-label="AI 作者意图候选"
      className="rounded-xl border border-line bg-surface p-5 space-y-3"
    >
      <h3 className="font-semibold">AI 辅助提出作者意图</h3>
      <p className="text-sm text-muted">
        项目简报可以单独生成建议，也可明确选择非空章节或已有剧本。模型推测不是作者已确认的思想；这里只提出八字段候选，经检查后在下方比较并明确采用，不改小说正文或剧本。不声明读过未选材料，实际
        usage／费用仍以运行证据为准，未知不是零。
      </p>
      {catalog.isLoading && <p role="status">正在核对可选来源…</p>}
      {navigationError && <p role="alert">{navigationError}</p>}
      {catalog.error && (
        <p role="alert">来源未能核全：{message(catalog.error)}</p>
      )}
      {workflowId && !original && (
        <p role={recovered.isLoading ? "status" : "alert"}>
          {recovered.isLoading
            ? "正在恢复指定意图工作流…"
            : "指定工作流不存在、未能读取或不属于此项目的意图操作；未打开其他运行代替。"}
        </p>
      )}
      {catalog.data && (
        <>
          <p className="text-xs text-muted">
            当前项目 v{catalog.data.projectVersion} ·{" "}
            {catalog.data.baseAdoptedId ? "有正式意图比较基准" : "尚无正式意图"}
            ；不选择条目即仅用项目简报。
          </p>
          {!catalog.data.chapterAvailable && (
            <p className="text-xs text-muted">当前 Profile 未启用章节来源。</p>
          )}
          {!catalog.data.scriptAvailable && (
            <p className="text-xs text-muted">
              当前 Profile 未启用剧本来源；不会强制启用媒体生产。
            </p>
          )}
          <div
            className="max-h-56 overflow-y-auto space-y-2"
            aria-label="AI 意图可选来源"
          >
            {catalog.data.items.map(({ source, title }) => (
              <label key={source.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`意图来源：${title}`}
                  checked={selected.includes(source.id)}
                  onChange={(event) => {
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, source.id]
                        : old.filter((id) => id !== source.id),
                    );
                    setConfirmed(undefined);
                    setExpressions((old) =>
                      old
                        ? { format: "narrative-context-v1", chapters: [] }
                        : undefined,
                    );
                  }}
                />
                <span>
                  {source.kind === "chapter" ? "章节" : "剧本"} · {title} · v
                  {source.version}
                  {source.kind === "script"
                    ? ` / 实际文档 ${source.documentVersion === null ? "未存在" : `v${source.documentVersion}`}`
                    : ""}
                </span>
              </label>
            ))}
          </div>
          <section
            aria-label="AI 意图明确来源表达"
            className="space-y-2 rounded border border-line p-3 text-sm"
          >
            <label className="flex gap-2">
              <input
                type="checkbox"
                aria-label="AI 意图使用明确混合表达"
                checked={Boolean(expressions)}
                disabled={
                  !available?.chapterAvailable || Boolean(catalog.error)
                }
                onChange={(event) => {
                  setExpressions(
                    event.target.checked
                      ? { format: "narrative-context-v1", chapters: [] }
                      : undefined,
                  );
                  setConfirmed(undefined);
                }}
              />
              明确选择原文／已采用摘要／段落／叙事解释，替代所选章节的整章外发
            </label>
            <p className="text-muted">
              范围中的章节必须有明确表达；叙事解释不增加整章阅读覆盖。未启用此选项时保留原完整来源协议；不选择材料仍可只用项目简报，不强制小说、剧本或媒体。
            </p>
            {expressions && !allowedChapters.length && (
              <p role="status">
                请先明确选择至少一章允许范围；简报独立入口请关闭混合表达。
              </p>
            )}
            {expressions && directory.isLoading && (
              <p role="status">正在核对原允许章节版本…</p>
            )}
            {expressions && directory.error && (
              <p role="alert">
                表达来源未核全：{message(directory.error)}；旧工作流与候选保持。
              </p>
            )}
            {expressions && directory.data && (
              <NovelContextPicker
                scope={{ projectId: project.id, title: "AI 意图来源表达" }}
                purpose="production"
                chapters={directory.data}
                request={expressions}
                disabled={Boolean(directory.error)}
                onChange={(value) => {
                  setExpressions(value);
                  setConfirmed(undefined);
                }}
              />
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={
                Boolean(catalog.error) ||
                Boolean(workflowId && !original) ||
                !mixedReady
              }
              onClick={() => {
                const data = catalog.data!;
                const result = confirmAuthorIntentCreationRequest(
                  data,
                  selected,
                  expressions,
                );
                if ("error" in result) {
                  setNotice(result.error);
                  return;
                }
                setConfirmed(result.request);
                const search = new URLSearchParams(location.search);
                search.delete("intentWorkflowId");
                navigate(`${location.pathname}?${search}`);
                setNotice(
                  "已明确确认本次允许范围与表达；下一步生成前仍核每章表达、隐私和完整预算。未选材料不补入，旧工作流与候选保持不变。",
                );
              }}
            >
              确认 AI 意图来源
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await catalog.refetch();
                setNotice(
                  "已重新读取可选来源，旧工作流基准未自动更新；新运行须重新确认来源。",
                );
              }}
            >
              重新读取 AI 可选来源
            </Button>
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {request && (
        <p className="text-xs text-muted">
          本次冻结项目 v{request.projectVersion} ·{" "}
          {request.context
            ? "所选允许来源（实际表达另行冻结，不代表全文已读）"
            : "所选完整来源"}{" "}
          {request.sources.length} 份 ·{" "}
          {request.baseAdoptedId ? "绑定原正式意图头" : "冻结当时尚无正式意图"}
          ；各阶段、失败重试和重启保留同一基准。
        </p>
      )}
      {stale && (
        <p role="alert">
          原项目、正式意图头或选定来源已变化。原运行与候选保留，重试仍使用旧快照；不能直接采用为当前方向。新运行请明确重新确认来源。
        </p>
      )}
      {request && (!workflowId || original) && (
        <CreationWorkbench
          projectId={project.id}
          operation="author-intent"
          workflowId={workflowId}
          authorIntentRequest={request}
          externalReview
          onStarted={(workflow) => openWorkflow(workflow.id)}
          defaultInstruction="提出供我审阅的作品主题、情绪承诺、受众、声音与保留／可改／禁止及结局约束，不改写原稿。"
          renderCandidate={(workflow) => (
            <div className="space-y-2 text-sm">
              <p>AI 建议仍是候选，结构与模型检查不是作者确认或真实质量证明。</p>
              {workflow.authorIntentId ? (
                <Link
                  className="text-brand underline"
                  to={`${location.pathname}?${new URLSearchParams({ intentId: workflow.authorIntentId, intentWorkflowId: workflow.id })}`}
                >
                  比较并确认此 AI 意图候选
                </Link>
              ) : (
                <p role="alert">
                  尚未取得实际意图候选身份，不打开最新版本代替。
                </p>
              )}
            </div>
          )}
        />
      )}
    </section>
  );
}
