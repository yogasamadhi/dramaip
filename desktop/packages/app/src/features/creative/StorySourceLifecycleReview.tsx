import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BareButton } from "@dramaip/ui-shared";
import type {
  StoryAssertion,
  StoryDeclaration,
  StorySourceReplaceInput,
  StorySourceWithdrawInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";

type Props = (
  | { kind: "node"; original: StoryDeclaration }
  | { kind: "assertion"; original: StoryAssertion }
) & {
  disabled: boolean;
  openOriginal: (id: string) => void;
};
const button =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
const field =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

/** Explicit retirement + separately reviewed new source. No auto-retargeting. */
export function StorySourceLifecycleReview(props: Props) {
  const client = useStudio(),
    cache = useQueryClient(),
    { original } = props;
  const [reason, setReason] = useState(""),
    [retirementReviewed, setRetirementReviewed] = useState(false);
  const [candidateInput, setCandidateInput] = useState(""),
    [candidateId, setCandidateId] = useState("");
  const [sourceReviewed, setSourceReviewed] = useState(false),
    [interpretationReviewed, setInterpretationReviewed] = useState(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>();
  const requests = useRef(new Map<string, string>());
  const view = `${props.kind}:${original.projectId}:${original.id}`,
    active = useRef(view);
  active.current = view;
  useEffect(
    () => () => {
      active.current = "unmounted";
    },
    [],
  );
  const query = useQuery<StoryDeclaration | StoryAssertion>({
    queryKey: [
      "story-lifecycle",
      props.kind,
      original.projectId,
      original.id,
      "replacement",
      candidateId,
    ],
    enabled: Boolean(candidateId),
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<StoryDeclaration | StoryAssertion> =>
      props.kind === "node"
        ? client.storyDeclarations.get(original.projectId, candidateId)
        : client.storyAssertions.get(original.projectId, candidateId),
  });
  const candidate = query.isError || query.isFetching ? undefined : query.data;
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          /^(knowledge|writing|production)\./u.test(event.type) &&
          event.payload &&
          typeof event.payload === "object" &&
          "projectId" in event.payload &&
          event.payload.projectId === original.projectId
        )
          void cache.invalidateQueries({
            queryKey: [
              "story-lifecycle",
              props.kind,
              original.projectId,
              original.id,
            ],
          });
      }),
    [client, cache, props.kind, original.projectId, original.id],
  );
  useEffect(() => {
    setRetirementReviewed(false);
    setSourceReviewed(false);
    setInterpretationReviewed(false);
  }, [original.etag, candidate?.etag, query.isError, query.isFetching]);
  const lifecycle = original.lifecycle;
  if (!lifecycle || original.status !== "adopted") return null;
  const retired = lifecycle.state !== "active",
    terminal = lifecycle.state === "replaced";
  const validNew =
    candidate &&
    candidate.id !== original.id &&
    candidate.projectId === original.projectId &&
    candidate.status === "pending" &&
    candidate.sourceStatus.state === "current" &&
    candidate.input.kind === original.input.kind;
  const canAct =
    !props.disabled &&
    !busy &&
    !terminal &&
    retirementReviewed &&
    Boolean(reason.trim());
  const act = async (action: "withdraw" | "replace") => {
    if (
      !canAct ||
      (action === "withdraw" && retired) ||
      (action === "replace" &&
        (!validNew || !sourceReviewed || !interpretationReviewed))
    )
      return;
    const basic: StorySourceWithdrawInput = {
      lifecycleVersion: lifecycle.version,
      record: lifecycle.record,
      reason: reason.trim(),
      confirmedRetirementReview: true,
    };
    const input: StorySourceWithdrawInput | StorySourceReplaceInput =
      action === "replace" && candidate
        ? {
            ...basic,
            replacement: {
              id: candidate.id,
              etag: candidate.etag,
              sourceFingerprint: candidate.basis.fingerprint,
              confirmedSourceReview: true,
              confirmedInterpretationReview: true,
            },
          }
        : basic;
    const identity = JSON.stringify({
      view,
      action,
      etag: original.etag,
      input,
    });
    let key = requests.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      requests.current.set(identity, key);
    }
    const scope = active.current;
    setBusy(true);
    setNotice(undefined);
    try {
      if (props.kind === "node") {
        if (action === "withdraw")
          await client.storyDeclarations.withdraw(
            original.projectId,
            props.original,
            basic,
            key,
          );
        else
          await client.storyDeclarations.replace(
            original.projectId,
            props.original,
            candidate as StoryDeclaration,
            input as StorySourceReplaceInput,
            key,
          );
      } else {
        if (action === "withdraw")
          await client.storyAssertions.withdraw(
            original.projectId,
            props.original,
            basic,
            key,
          );
        else
          await client.storyAssertions.replace(
            original.projectId,
            props.original,
            candidate as StoryAssertion,
            input as StorySourceReplaceInput,
            key,
          );
      }
      requests.current.delete(identity);
      if (active.current !== scope) return;
      setNotice(
        action === "withdraw"
          ? "原实际记录已退役；原采用、冻结证据和回执保留。"
          : "已独立采用明确的新 AI 草稿；原记录退役，不自动重连已有关系／认知。",
      );
      setReason("");
      setCandidateInput("");
      setCandidateId("");
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["story-declaration", original.projectId],
        }),
        cache.invalidateQueries({
          queryKey: ["story-assertion", original.projectId],
        }),
        cache.invalidateQueries({
          queryKey: ["story-intelligence", original.projectId],
        }),
        cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      ]);
    } catch (cause) {
      if (active.current === scope)
        setNotice(
          `${message(cause)}；未自动换源。可先重读原 ID 核对实际结果；相同输入保留原请求键。`,
        );
    } finally {
      if (active.current === scope) {
        setBusy(false);
        setRetirementReviewed(false);
        setSourceReviewed(false);
        setInterpretationReviewed(false);
      }
    }
  };
  return (
    <section
      aria-label="来源声明撤回与替换"
      className="mt-4 space-y-3 rounded-lg border border-line p-3"
    >
      <p className="text-sm">
        当前生效状态：
        {lifecycle.state === "active"
          ? "生效"
          : lifecycle.state === "withdrawn"
            ? "已撤回"
            : "已替换"}{" "}
        · 生命周期 v{lifecycle.version}
      </p>
      <p className="break-all text-xs">
        原实际记录：{lifecycle.record.kind} · {lifecycle.record.id} ·
        生命周期绑定版本 v{lifecycle.record.version}；上方 adopted /
        原版本仅表示历史独立采用，不表示退役记录仍生效。
      </p>
      <p className="text-xs text-muted">
        撤回不会删除原证据，也不会把正式来源降级为手工事实。替换使用新的实际
        ID；已有关系、认知、快照和规则不会自动重连或重写。
      </p>
      {lifecycle.transitions.map((item) => (
        <p key={item.version} className="break-all text-xs">
          决定 v{item.version} · {item.action === "withdraw" ? "撤回" : "替换"}{" "}
          · {item.reason} · {item.createdAt}
          {item.replacementId ? ` · 新候选 ${item.replacementId}` : ""}
        </p>
      ))}
      {lifecycle.replacementId && (
        <BareButton
          className={button}
          onClick={() => props.openOriginal(lifecycle.replacementId!)}
        >
          打开明确替换记录
        </BareButton>
      )}
      {!terminal && (
        <>
          <label className="block text-sm">
            撤回／替换理由
            <textarea
              aria-label="撤回替换理由"
              className={field}
              value={reason}
              maxLength={2000}
              disabled={busy || props.disabled}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <input
              aria-label="已审阅原记录退役与不自动重连"
              type="checkbox"
              checked={retirementReviewed}
              disabled={busy || props.disabled}
              onChange={(e) => setRetirementReviewed(e.target.checked)}
            />{" "}
            已核对上方原记录、当前版本及退役影响；不自动重连下游
          </label>
          {!retired && (
            <BareButton
              className={button}
              disabled={!canAct}
              onClick={() => void act("withdraw")}
            >
              明确撤回该原声明
            </BareButton>
          )}
          <label className="block text-sm">
            指定新来源候选 ID
            <input
              aria-label="指定新来源候选 ID"
              className={field}
              value={candidateInput}
              disabled={busy || props.disabled}
              onChange={(e) => {
                setCandidateInput(e.target.value);
                setCandidateId("");
                setSourceReviewed(false);
                setInterpretationReviewed(false);
              }}
            />
          </label>
          <BareButton
            className={button}
            disabled={
              busy ||
              props.disabled ||
              !/^[a-f\d-]{36}$/iu.test(candidateInput.trim()) ||
              candidateInput.trim() === original.id
            }
            onClick={() => {
              const id = candidateInput.trim();
              if (id === candidateId) void query.refetch();
              else setCandidateId(id);
            }}
          >
            读取并审阅此新候选
          </BareButton>
          {query.isError && (
            <p role="alert">
              指定新候选读取失败：{message(query.error)}
              ；不使用旧缓存或最新候选。
            </p>
          )}
          {query.isFetching && <p>正在核对明确新 AI 草稿 ID…</p>}
          {candidate && (
            <section
              aria-label="替换新候选独立审阅"
              className="space-y-2 rounded-lg border border-line p-2"
            >
              <p className="break-all text-xs">
                新候选 {candidate.id} · {candidate.input.title} ·{" "}
                {candidate.status} · 来源 {candidate.sourceStatus.state} · v
                {candidate.version}
              </p>
              <p className="whitespace-pre-wrap text-sm">
                新解释：{candidate.input.statement}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(candidate.input, null, 2)}
              </pre>
              {("sourceBasis" in candidate.basis
                ? candidate.basis.sourceBasis.sources
                : candidate.basis.sources
              ).map((source, index) => (
                <div key={index} className="text-xs">
                  <p className="whitespace-pre-wrap">
                    实际新来源引文：{source.quote}
                  </p>
                  <p className="break-all">
                    精确位置：{JSON.stringify(source.anchors)}
                  </p>
                </div>
              ))}
              {"nodes" in candidate.basis &&
                candidate.basis.nodes.map((node) => (
                  <p key={node.id} className="break-all text-xs">
                    实际新节点 {node.title} · {node.id} · v{node.version} ·{" "}
                    {node.summary}
                  </p>
                ))}
              <p className="break-all text-xs">
                新冻结指纹：{candidate.basis.fingerprint}
                ；禁止外发依赖完整继承，不由此次替换放宽。
              </p>
              {!validNew && (
                <p role="alert">
                  必须另选本项目同类型、当前未采用的新 AI 草稿；未自动调整选择。
                </p>
              )}
              <label className="block text-sm">
                <input
                  aria-label="已核对替换新候选实际来源"
                  type="checkbox"
                  disabled={!validNew || busy || props.disabled}
                  checked={sourceReviewed}
                  onChange={(e) => setSourceReviewed(e.target.checked)}
                />{" "}
                已核对新候选实际来源及节点版本
              </label>
              <label className="block text-sm">
                <input
                  aria-label="已审阅替换新候选解释"
                  type="checkbox"
                  disabled={!validNew || busy || props.disabled}
                  checked={interpretationReviewed}
                  onChange={(e) => setInterpretationReviewed(e.target.checked)}
                />{" "}
                已单独审阅新解释；不视作语义证明
              </label>
              <BareButton
                className={button}
                disabled={
                  !canAct ||
                  !validNew ||
                  !sourceReviewed ||
                  !interpretationReviewed
                }
                onClick={() => void act("replace")}
              >
                明确替换并独立采用此新候选
              </BareButton>
            </section>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
