import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { BareButton } from "@dramaip/infra-ui-primitives";
import type {
  StoryAssertion,
  StoryDeclaration,
  StorySourceReplaceInput,
  StorySourceWithdrawInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";
import styles from "./StorySourceLifecycleReview.module.css";
import { copyText } from "../../copy";

type Props = (
  | { kind: "node"; original: StoryDeclaration }
  | { kind: "assertion"; original: StoryAssertion }
) & {
  disabled: boolean;
  openOriginal: (id: string) => void;
};
const button = styles.c1;
const field = styles.c2;

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
      aria-label={copyText(
        "app/features/creative/StorySourceLifecycleReview.1",
      )}
      className={styles.c3}
    >
      <p className={styles.c4}>
        {copyText("app/features/creative/StorySourceLifecycleReview.2")}
        {lifecycle.state === "active"
          ? "生效"
          : lifecycle.state === "withdrawn"
            ? "已撤回"
            : "已替换"}{" "}
        {copyText("app/features/creative/StorySourceLifecycleReview.3")}
        {lifecycle.version}
      </p>
      <p className={styles.c5}>
        {copyText("app/features/creative/StorySourceLifecycleReview.4")}
        {lifecycle.record.kind} · {lifecycle.record.id}
        {copyText("app/features/creative/StorySourceLifecycleReview.5")}
        {lifecycle.record.version}
        {copyText("app/features/creative/StorySourceLifecycleReview.6")}
      </p>
      <p className={styles.c6}>
        {copyText("app/features/creative/StorySourceLifecycleReview.7")}
      </p>
      {lifecycle.transitions.map((item) => (
        <p key={item.version} className={styles.c5}>
          {copyText("app/features/creative/StorySourceLifecycleReview.8")}
          {item.version} · {item.action === "withdraw" ? "撤回" : "替换"} ·{" "}
          {item.reason} · {item.createdAt}
          {item.replacementId ? ` · 新候选 ${item.replacementId}` : ""}
        </p>
      ))}
      {lifecycle.replacementId && (
        <BareButton
          className={button}
          onClick={() => props.openOriginal(lifecycle.replacementId!)}
        >
          {copyText("app/features/creative/StorySourceLifecycleReview.9")}
        </BareButton>
      )}
      {!terminal && (
        <>
          <label className={styles.c7}>
            {copyText("app/features/creative/StorySourceLifecycleReview.10")}
            <textarea
              aria-label={copyText(
                "app/features/creative/StorySourceLifecycleReview.11",
              )}
              className={field}
              value={reason}
              maxLength={2000}
              disabled={busy || props.disabled}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className={styles.c7}>
            <input
              aria-label={copyText(
                "app/features/creative/StorySourceLifecycleReview.12",
              )}
              type="checkbox"
              checked={retirementReviewed}
              disabled={busy || props.disabled}
              onChange={(e) => setRetirementReviewed(e.target.checked)}
            />{" "}
            {copyText("app/features/creative/StorySourceLifecycleReview.13")}
          </label>
          {!retired && (
            <BareButton
              className={button}
              disabled={!canAct}
              onClick={() => void act("withdraw")}
            >
              {copyText("app/features/creative/StorySourceLifecycleReview.14")}
            </BareButton>
          )}
          <label className={styles.c7}>
            {copyText("app/features/creative/StorySourceLifecycleReview.15")}
            <input
              aria-label={copyText(
                "app/features/creative/StorySourceLifecycleReview.15",
              )}
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
            {copyText("app/features/creative/StorySourceLifecycleReview.16")}
          </BareButton>
          {query.isError && (
            <p role="alert">
              {copyText("app/features/creative/StorySourceLifecycleReview.17")}
              {message(query.error)}
              {copyText("app/features/creative/StorySourceLifecycleReview.18")}
            </p>
          )}
          {query.isFetching && (
            <p>
              {copyText("app/features/creative/StorySourceLifecycleReview.19")}
            </p>
          )}
          {candidate && (
            <section
              aria-label={copyText(
                "app/features/creative/StorySourceLifecycleReview.20",
              )}
              className={styles.c8}
            >
              <p className={styles.c5}>
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.21",
                )}
                {candidate.id} · {candidate.input.title} · {candidate.status}
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.22",
                )}
                {candidate.sourceStatus.state}
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.23",
                )}
                {candidate.version}
              </p>
              <p className={styles.c9}>
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.24",
                )}
                {candidate.input.statement}
              </p>
              <pre className={styles.c10}>
                {JSON.stringify(candidate.input, null, 2)}
              </pre>
              {("sourceBasis" in candidate.basis
                ? candidate.basis.sourceBasis.sources
                : candidate.basis.sources
              ).map((source, index) => (
                <div key={index} className={styles.c11}>
                  <p className={styles.c12}>
                    {copyText(
                      "app/features/creative/StorySourceLifecycleReview.25",
                    )}
                    {source.quote}
                  </p>
                  <p className={styles.c13}>
                    {copyText(
                      "app/features/creative/StorySourceLifecycleReview.26",
                    )}
                    {JSON.stringify(source.anchors)}
                  </p>
                </div>
              ))}
              {"nodes" in candidate.basis &&
                candidate.basis.nodes.map((node) => (
                  <p key={node.id} className={styles.c5}>
                    {copyText(
                      "app/features/creative/StorySourceLifecycleReview.27",
                    )}
                    {node.title} · {node.id}
                    {copyText(
                      "app/features/creative/StorySourceLifecycleReview.23",
                    )}
                    {node.version} · {node.summary}
                  </p>
                ))}
              <p className={styles.c5}>
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.28",
                )}
                {candidate.basis.fingerprint}
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.29",
                )}
              </p>
              {!validNew && (
                <p role="alert">
                  {copyText(
                    "app/features/creative/StorySourceLifecycleReview.30",
                  )}
                </p>
              )}
              <label className={styles.c7}>
                <input
                  aria-label={copyText(
                    "app/features/creative/StorySourceLifecycleReview.31",
                  )}
                  type="checkbox"
                  disabled={!validNew || busy || props.disabled}
                  checked={sourceReviewed}
                  onChange={(e) => setSourceReviewed(e.target.checked)}
                />{" "}
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.32",
                )}
              </label>
              <label className={styles.c7}>
                <input
                  aria-label={copyText(
                    "app/features/creative/StorySourceLifecycleReview.33",
                  )}
                  type="checkbox"
                  disabled={!validNew || busy || props.disabled}
                  checked={interpretationReviewed}
                  onChange={(e) => setInterpretationReviewed(e.target.checked)}
                />{" "}
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.34",
                )}
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
                {copyText(
                  "app/features/creative/StorySourceLifecycleReview.35",
                )}
              </BareButton>
            </section>
          )}
        </>
      )}
      {notice && (
        <p role="status" className={styles.c4}>
          {notice}
        </p>
      )}
    </section>
  );
}
