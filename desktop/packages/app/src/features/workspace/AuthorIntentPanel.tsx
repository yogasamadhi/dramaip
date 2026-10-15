import {
  currentOwnerQuery,
  CURRENT_OWNER_READ_OPTIONS,
  exactNavigationError,
  sameFrozenOwnerSnapshot,
} from "../../current-owner-read";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, confirmDialog } from "@dramaip/ui-shared";
import type { Project } from "@dramaip/contracts/product";
import {
  AuthorIntentContentSchema,
  type AuthorIntent,
  type AuthorIntentContent,
  type AuthorIntentSummary,
} from "@dramaip/contracts/workspace";
import { message, useStudio } from "../../studio-shared";
import { AuthorIntentCreationPanel } from "./AuthorIntentCreationPanel";
import {
  clearAuthorIntentDraft,
  emptyAuthorIntentEdit,
  readAuthorIntentDraft,
  saveAuthorIntentDraft,
  type AuthorIntentEdit,
  type AuthorIntentEditFields,
} from "../../author-intent-draft";

export const INTENT_FIELDS: ReadonlyArray<{
  key: keyof AuthorIntentContent;
  label: string;
  list?: boolean;
}> = [
  { key: "themeStatement", label: "作品主题" },
  { key: "emotionalPromise", label: "情绪承诺" },
  { key: "targetAudience", label: "目标受众" },
  { key: "mustKeep", label: "必须保留", list: true },
  { key: "mayChange", label: "允许改变", list: true },
  { key: "mustAvoid", label: "必须避免", list: true },
  { key: "endingContract", label: "结局约束（可暂不决定）" },
  { key: "toneAndVoice", label: "叙事声音与风格" },
];
type Draft = AuthorIntentEditFields;
const draftStore = () => window.localStorage;
const text = (value: string | string[]) =>
  Array.isArray(value) ? value.join("\n") : value;
const labels: Record<AuthorIntent["status"], string> = {
  pending: "等待审阅采用",
  adopted: "已正式采用",
  discarded: "已放弃",
  conflicted: "采用冲突，需重新预览",
};

export function AuthorIntentPanel(props: { project: Project }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search),
    navigationError = exactNavigationError(params, [
      "intentId",
      "intentWorkflowId",
    ]),
    selectedId = params.get("intentId"),
    workflowId = params.get("intentWorkflowId");
  const [recovered] = useState(() =>
    readAuthorIntentDraft(props.project.id, draftStore),
  );
  const [edit, setEdit] = useState<AuthorIntentEdit>(
    () => recovered.record ?? emptyAuthorIntentEdit(props.project.version),
  );
  const editRef = useRef(edit);
  const storedRaw = useRef(recovered.raw);
  const restoreBlocked = useRef(Boolean(recovered.error));
  const [draftNotice, setDraftNotice] = useState<string | undefined>(
    recovered.error ??
      (recovered.record
        ? "已恢复本机编辑草稿和原来源版本，未自动刷新或采用。"
        : undefined),
  );
  const updateEdit = (patch: Partial<AuthorIntentEdit>) => {
    const next = { ...editRef.current, ...patch };
    editRef.current = next;
    setEdit(next);
    if (restoreBlocked.current) return;
    const result = saveAuthorIntentDraft(
      props.project.id,
      next,
      storedRaw.current,
      draftStore,
    );
    if (result.raw !== undefined) {
      storedRaw.current = result.raw;
      setDraftNotice(
        "编辑草稿已保存到本机；不是正式版本，不会发送模型或自动采用。",
      );
    } else setDraftNotice(result.error);
  };
  const { fields: draft, sourceKind, basisVersion, baseAdoptedId } = edit;
  const setDraft = (value: Draft | ((old: Draft) => Draft)) =>
    updateEdit({
      fields:
        typeof value === "function" ? value(editRef.current.fields) : value,
    });
  const setBasisVersion = (value: number) =>
    updateEdit({ basisVersion: value });
  const setBaseAdoptedId = (value: string | undefined) =>
    updateEdit({ baseAdoptedId: value });
  const setSourceKind = (value: "manual" | "legacy-project") =>
    updateEdit({ sourceKind: value });
  const initializedBasis = useRef(Boolean(recovered.record));
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intent-current", props.project.id],
      queryFn: () => client.authorIntents.current(props.project.id),
      staleTime: 0,
    }),
  );
  const list = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intents", props.project.id],
      queryFn: async () => {
        const items: AuthorIntentSummary[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.authorIntents.list(
            props.project.id,
            cursor,
          );
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw new Error("作者意图分页未能完整读取。");
          if (cursor) seen.add(cursor);
        } while (cursor);
        return items;
      },
    }),
  );
  const selected = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intent", props.project.id, selectedId],
      queryFn: () => client.authorIntents.get(selectedId!),
      enabled: Boolean(selectedId) && !navigationError,
      staleTime: 0,
    }),
  );
  const original = currentOwnerQuery(
    useQuery({
      ...CURRENT_OWNER_READ_OPTIONS,
      queryKey: ["author-intent-workflow", props.project.id, workflowId],
      queryFn: () => client.creation.get(workflowId!),
      enabled: Boolean(workflowId && selectedId) && !navigationError,
      refetchInterval: 1500,
    }),
  );
  const candidate =
    !navigationError &&
    selected.data?.projectId === props.project.id &&
    selected.data.id === selectedId &&
    (!workflowId ||
      (original.data?.id === workflowId &&
        original.data.input.projectId === props.project.id &&
        original.data.input.operation === "author-intent" &&
        original.data.authorIntentId === selectedId &&
        selected.data.source.kind === "ai-generated" &&
        selected.data.source.creation.workflowId === workflowId &&
        sameFrozenOwnerSnapshot(
          selected.data.source.creation.basis.request,
          original.data.input.authorIntentRequest,
        )))
      ? selected.data
      : undefined;
  const adopted = current.data?.current;
  useEffect(() => {
    if (current.data && !initializedBasis.current) {
      initializedBasis.current = true;
      setBaseAdoptedId(current.data.current?.id);
    }
  }, [current.data]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["author-intent-current", props.project.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["author-intents", props.project.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["author-intent"] }),
      queryClient.invalidateQueries({ queryKey: ["pending-confirmations"] }),
    ]);
  };
  useEffect(() => {
    const unsubscribe = client.events.subscribe((event) => {
      const intentEvent = event.type.startsWith("workspace.author-intent-");
      const projectEvent = event.type.startsWith("workspace.project-");
      const sourceEvent =
        event.type.startsWith("writing.chapter-") ||
        event.type.startsWith("production.script-") ||
        event.type.startsWith("production.scripts-") ||
        event.type.startsWith("production.screenplay-");
      if (!intentEvent && !projectEvent && !sourceEvent) return;
      if (
        !event.payload ||
        typeof event.payload !== "object" ||
        (projectEvent
          ? (event.payload as { id?: string }).id
          : (event.payload as { projectId?: string }).projectId) !==
          props.project.id
      )
        return;
      void queryClient.invalidateQueries({
        queryKey: ["author-intent-current", props.project.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["author-intents", props.project.id],
      });
      void queryClient.invalidateQueries({ queryKey: ["author-intent"] });
      void queryClient.invalidateQueries({
        queryKey: ["author-intent-sources", props.project.id],
      });
    });
    return unsubscribe;
  }, [client, props.project.id, queryClient]);
  const select = (id: string) => {
    const search = new URLSearchParams(location.search);
    search.set("intentId", id);
    navigate(`${location.pathname}?${search}`);
  };
  const preview = async () => {
    const input = Object.fromEntries(
      INTENT_FIELDS.map(({ key, list }) => [
        key,
        list
          ? draft[key]
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean)
          : draft[key],
      ]),
    );
    const parsed = AuthorIntentContentSchema.safeParse(input);
    if (!parsed.success) {
      setNotice(
        "请填写作品主题、情绪承诺、目标受众与叙事风格；每条约束单独一行，并核对长度限制。",
      );
      return;
    }
    if (!current.data || current.error) {
      setNotice("尚未核对当前正式版本，不能创建预览。");
      return;
    }
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await client.authorIntents.preview(
        props.project.id,
        {
          content: parsed.data,
          projectVersion: basisVersion,
          sourceKind,
          ...(baseAdoptedId ? { baseAdoptedId } : {}),
        },
        crypto.randomUUID(),
      );
      if (!alive.current) return;
      select(result.id);
      setNotice(
        "AI 草稿已保存，请核对差异后明确采用；尚未修改正式作者意图或正文。",
      );
      await refresh();
    } catch (cause) {
      if (alive.current) setNotice(message(cause));
    } finally {
      if (alive.current) setWorking(false);
    }
  };
  const transition = async (
    value: AuthorIntent,
    action: "adopt" | "discard",
  ) => {
    if (
      !(await confirmDialog({
        title: action === "adopt" ? "采用作者意图" : "放弃作者意图候选",
        confirmLabel: action === "adopt" ? "确认采用" : "确认放弃",
        tone: action === "adopt" ? "default" : "danger",
        description:
          action === "adopt"
            ? `正式采用作者意图 v${value.version}？这会改变正式意图版本；不会改写章节、剧本或旧意图，也不会自动触发生成。新的小说、剧本、改编诊断与整季方案会冻结正式版本，旧意图或无正式意图的未采用 AI 草稿将不能直接采用。`
            : `放弃作者意图候选 v${value.version}？不会删除已采用版本或修改正文。`,
      }))
    )
      return;
    if (!alive.current) return;
    setWorking(true);
    try {
      const result = await client.authorIntents[action](
        value.id,
        value.stateVersion,
        crypto.randomUUID(),
      );
      if (!alive.current) return;
      setNotice(
        action === "adopt"
          ? `已正式采用作者意图 v${result.version}。`
          : "已放弃此 AI 草稿，正式内容保持不变。",
      );
    } catch (cause) {
      if (alive.current) setNotice(message(cause));
    } finally {
      if (alive.current) {
        setWorking(false);
        await refresh();
      }
    }
  };
  return (
    <section className="space-y-5" aria-label="正式作者意图工作台">
      <AuthorIntentCreationPanel
        key={props.project.id}
        project={props.project}
      />
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="studio-eyebrow">故事母本与创作约束</p>
        <h2 className="mt-1 text-2xl font-semibold">正式作者意图</h2>
        <p className="mt-2 text-sm text-muted">
          意图版本与 AI 草稿独立保存。旧项目设定不是已采用意图；新 AI
          草稿必须比较、明确采用，来源变化或并发采用会拒绝旧 AI
          草稿。小说不必短剧化，结局可暂不决定。
        </p>
        {current.isLoading ? (
          <p role="status">正在核对正式版本…</p>
        ) : current.error ? (
          <p role="alert">当前正式版本未能读取：{message(current.error)}</p>
        ) : (
          <p
            className="mt-3 font-medium"
            data-current-intent-id={adopted?.id ?? ""}
          >
            {adopted
              ? `当前正式版本 v${adopted.version}`
              : "尚无正式采用版本，旧项目设定待确认。"}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={working || !current.data || Boolean(current.error)}
            onClick={() => {
              setDraft((old) => ({
                ...old,
                targetAudience: props.project.targetAudience ?? "",
                emotionalPromise: props.project.emotionalCore ?? "",
                toneAndVoice: props.project.styleGuide ?? "",
              }));
              setBasisVersion(props.project.version);
              setBaseAdoptedId(adopted?.id);
              setSourceKind("legacy-project");
              setNotice(
                "仅带入原样保存的受众、情感核心和风格；请自行补全主题与约束，不会自动采用。",
              );
            }}
          >
            带入旧项目字段（待确认）
          </Button>
          {adopted && (
            <Button
              variant="secondary"
              disabled={working || Boolean(current.error)}
              onClick={() => {
                setDraft(
                  Object.fromEntries(
                    INTENT_FIELDS.map(({ key }) => [
                      key,
                      text(adopted.content[key]),
                    ]),
                  ) as Draft,
                );
                setSourceKind("manual");
                setBasisVersion(current.data!.projectVersion);
                setBaseAdoptedId(adopted.id);
              }}
            >
              基于当前正式版本创建草稿
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={working}
            onClick={async () => {
              const result = await current.refetch();
              if (result.data && alive.current) {
                setBasisVersion(result.data.projectVersion);
                setBaseAdoptedId(result.data.current?.id);
                setNotice(
                  "已刷新来源版本，编辑内容仍保留；请重新核对后预览。 ",
                );
              }
              await refresh();
            }}
          >
            刷新来源与状态
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-semibold">编辑下一份意图草稿</h3>
        <p className="mt-1 text-xs text-muted">
          冻结项目版本 {basisVersion} ·{" "}
          {sourceKind === "legacy-project" ? "旧字段待确认" : "作者手工填写"}
          ；每条约束单独一行。编辑区按项目仅存本机，不是正式版本；恢复不自动换成最新来源，也不代表重新同意或采用。
        </p>
        {draftNotice && (
          <p
            role="status"
            aria-label="作者意图本地草稿状态"
            className="mt-2 text-sm text-muted"
          >
            {draftNotice}
          </p>
        )}
        {current.data &&
          (basisVersion !== current.data.projectVersion ||
            baseAdoptedId !== current.data.current?.id) && (
            <p role="alert" className="mt-2 text-sm text-danger-strong">
              编辑草稿的项目或正式意图来源已变化。原输入和基准保留；请明确刷新来源并重新核对，不能直接当作当前正式意图。
            </p>
          )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {INTENT_FIELDS.map(({ key, label }) => (
            <label key={key} className="grid gap-1 text-sm">
              {label}
              <textarea
                aria-label={label}
                className="min-h-24 rounded-lg border border-line bg-surface-raised p-3"
                disabled={working || !current.data || Boolean(current.error)}
                value={draft[key]}
                onChange={(event) =>
                  setDraft((old) => ({ ...old, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <Button
          className="mt-4"
          disabled={working || !current.data || Boolean(current.error)}
          onClick={() => void preview()}
        >
          保存意图草稿并预览差异
        </Button>
        <Button
          variant="ghost"
          className="mt-4 ml-2"
          disabled={working || !current.data || Boolean(current.error)}
          onClick={async () => {
            if (
              !(await confirmDialog({
                title: "清空本地意图编辑草稿",
                description:
                  "只清空此项目本机编辑区的八个字段和旧来源基准；已保存草稿、正式意图、章节、剧本及其他项目不变。",
                confirmLabel: "确认清空编辑草稿",
                tone: "danger",
              })) ||
              !alive.current
            )
              return;
            const result = clearAuthorIntentDraft(
              props.project.id,
              storedRaw.current,
              draftStore,
            );
            if (!result.cleared) {
              setDraftNotice(result.error);
              return;
            }
            storedRaw.current = null;
            restoreBlocked.current = false;
            initializedBasis.current = true;
            const next = {
              ...emptyAuthorIntentEdit(current.data!.projectVersion),
              baseAdoptedId: current.data!.current?.id,
            };
            editRef.current = next;
            setEdit(next);
            setDraftNotice(
              "本项目本机编辑草稿已明确清空，正式版本与已保存草稿保持不变。",
            );
          }}
        >
          清空本地编辑草稿
        </Button>
        {notice && (
          <p
            role="status"
            className="mt-3 whitespace-pre-wrap rounded-lg bg-brand-soft p-3 text-sm"
          >
            {notice}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-semibold">意图版本与 AI 草稿</h3>
        {navigationError && <p role="alert">{navigationError}</p>}
        {list.error && (
          <p role="alert">版本列表未核全：{message(list.error)}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {list.data?.map((item) => (
            <Button
              key={item.id}
              variant="secondary"
              data-intent-id={item.id}
              onClick={() => select(item.id)}
            >
              意图 v{item.version} · {labels[item.status]}
              {item.isCurrent ? " · 当前正式" : ""}
              {item.sourceState === "stale" && item.status !== "adopted"
                ? " · 来源已变化"
                : ""}
            </Button>
          ))}
        </div>
        {selectedId && !candidate && !navigationError && (
          <p role={selected.isLoading ? "status" : "alert"} className="mt-3">
            {selected.isLoading
              ? "正在读取指定意图…"
              : "指定意图未能读取或不属于此项目，未打开其他版本代替。"}
          </p>
        )}
        {candidate && (
          <section
            aria-label="指定作者意图预览"
            data-intent-preview-id={candidate.id}
            className="mt-4 space-y-3"
          >
            <h4 className="font-semibold">
              v{candidate.version} · {labels[candidate.status]}
            </h4>
            <p className="text-xs text-muted">
              来源：
              {candidate.source.kind === "legacy-project"
                ? "旧项目字段待确认"
                : candidate.source.kind === "ai-generated"
                  ? "AI 建议，须作者明确确认"
                  : "作者手工填写"}{" "}
              · 项目 v{candidate.source.projectVersion} · 状态版本{" "}
              {candidate.stateVersion}
            </p>
            {candidate.sourceState === "stale" &&
              candidate.status !== "adopted" && (
                <p role="alert">
                  项目设定、选定来源或当前采用版本已变化，不能直接采用旧草稿；请核对并保存新预览。
                </p>
              )}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="mb-2 text-left font-medium">
                  本次 AI 草稿与当前正式版本的差异
                </caption>
                <thead>
                  <tr>
                    <th className="border border-line p-2">字段</th>
                    <th className="border border-line p-2">当前正式版本</th>
                    <th className="border border-line p-2">指定版本内容</th>
                  </tr>
                </thead>
                <tbody>
                  {INTENT_FIELDS.map(({ key, label }) => (
                    <tr key={key}>
                      <th className="border border-line p-2">{label}</th>
                      <td className="max-w-sm whitespace-pre-wrap break-words border border-line p-2">
                        {adopted
                          ? text(adopted.content[key]) || "未设置"
                          : "尚无正式版本"}
                      </td>
                      <td className="max-w-sm whitespace-pre-wrap break-words border border-line p-2">
                        {text(candidate.content[key]) || "未设置"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {candidate.source.kind !== "ai-generated" &&
              candidate.source.legacyFields && (
                <details>
                  <summary>查看原样保存的旧项目来源（不是正式意图）</summary>
                  <dl className="mt-2 space-y-2 text-sm">
                    {Object.entries(candidate.source.legacyFields).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt className="font-medium">{key}</dt>
                          <dd className="whitespace-pre-wrap break-words">
                            {value || "未设置"}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
              )}
            {candidate.source.kind === "ai-generated" && (
              <details>
                <summary>查看 AI 意图实际参考内容与运行身份</summary>
                <p className="mt-2 text-xs break-all">
                  工作流 {candidate.source.creation.workflowId} · 原快照{" "}
                  {candidate.source.creation.sourceSnapshotId} · 引擎{" "}
                  {candidate.source.creation.engineKind} · 运行{" "}
                  {candidate.source.creation.runIds.join("、")}
                </p>
                <p className="text-xs">
                  只使用项目简报、当时的正式意图与明确选择的{" "}
                  {candidate.source.creation.basis.request.sources.length}{" "}
                  份来源；未选材料未读。模型建议不是作者确认。
                </p>
                <ul className="text-xs space-y-1 mt-2">
                  {candidate.source.creation.basis.references.map((ref) => (
                    <li
                      className="break-all"
                      key={`${ref.sourceKind}:${ref.sourceId}`}
                    >
                      {ref.sourceKind} · {ref.sourceId} · v{ref.sourceVersion} ·
                      SHA-256 {ref.contentHash}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              {candidate.status === "pending" &&
                candidate.sourceState === "current" && (
                  <Button
                    disabled={
                      working ||
                      selected.isFetching ||
                      Boolean(selected.error) ||
                      Boolean(current.error)
                    }
                    onClick={() => void transition(candidate, "adopt")}
                  >
                    确认采用此作者意图
                  </Button>
                )}
              {["pending", "conflicted"].includes(candidate.status) && (
                <Button
                  variant="secondary"
                  disabled={
                    working || selected.isFetching || Boolean(selected.error)
                  }
                  onClick={() => void transition(candidate, "discard")}
                >
                  放弃此意图草稿
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
