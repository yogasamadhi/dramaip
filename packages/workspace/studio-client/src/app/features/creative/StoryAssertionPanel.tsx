import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { useLocation, useNavigate } from "../../router";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import {
  AudienceKnowledgeValueSchema,
  StoryCausalEdgeRelationSchema,
  type StoryCausalEdge,
} from "@dramaip/contracts";
import {
  StoryAssertionInputSchema,
  type StoryAssertionInput,
  type StoryDeclarationInput,
} from "@dramaip/contracts/knowledge";
import { message, useStudio } from "../../studio-shared";
import { ScreenplayDeclarationComposer } from "./ScreenplayDeclarationComposer";
import { NovelAssertionSources } from "./NovelAssertionSources";
import { StorySourceLifecycleReview } from "./StorySourceLifecycleReview";
import styles from "./StoryAssertionPanel.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

const field = styles.c1;
const button = styles.c2;

export function StoryAssertionPanel({ projectId }: { projectId: string }) {
  const client = useStudio(),
    cache = useQueryClient(),
    location = useLocation(),
    navigate = useNavigate();
  const assertionId =
    new URLSearchParams(location.search).get("storyAssertionId") ?? "";
  const [open, setOpen] = useState(Boolean(assertionId)),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>();
  const [mode, setMode] = useState<"novel" | "screenplay">("novel"),
    [kind, setKind] = useState<"relationship" | "cognition">("relationship");
  const [title, setTitle] = useState(""),
    [statement, setStatement] = useState(""),
    [interpretation, setInterpretation] = useState<
      "" | StoryAssertionInput["interpretation"]
    >("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [relation, setRelation] = useState<StoryCausalEdge["relation"]>("reveals"),
    [confidence, setConfidence] = useState("");
  const [subjectKind, setSubjectKind] = useState<"character" | "audience">(
      "character",
    ),
    [subject, setSubject] = useState(""),
    [audience, setAudience] = useState(""),
    [state, setState] = useState<
      "unknown" | "suspects" | "misbelieves" | "knows"
    >("unknown"),
    [order, setOrder] = useState("");
  const [sourceReviewed, setSourceReviewed] = useState(false),
    [interpretationReviewed, setInterpretationReviewed] = useState(false),
    [cursor, setCursor] = useState<string>();
  const view = `${projectId}:${assertionId}`,
    active = useRef(view),
    requests = useRef(new Map<string, string>());
  active.current = view;
  useEffect(() => {
    setBusy(false);
    setNotice(undefined);
  }, [view]);
  useEffect(() => {
    setFrom("");
    setTo("");
    setSubject("");
    setTitle("");
    setStatement("");
    setInterpretation("");
    setAudience("");
    setConfidence("");
    setOrder("");
    setCursor(undefined);
  }, [projectId]);
  useEffect(
    () => () => {
      active.current = "unmounted";
    },
    [],
  );
  const graph = useQuery({
    queryKey: ["story-intelligence", projectId, "graph"],
    enabled: Boolean(projectId && (open || assertionId)),
    staleTime: 0,
    retry: false,
    queryFn: () => client.storyIntelligence.graph(projectId),
  });
  const history = useQuery({
    queryKey: ["story-assertion", projectId, "history", cursor],
    enabled: Boolean(projectId && (open || assertionId)),
    staleTime: 0,
    retry: false,
    queryFn: () =>
      client.storyAssertions.list(projectId, { cursor, limit: 20 }),
  });
  const query = useQuery({
    queryKey: ["story-assertion", projectId, "original", assertionId],
    enabled: Boolean(projectId && assertionId),
    staleTime: 0,
    retry: false,
    queryFn: () => client.storyAssertions.get(projectId, assertionId),
  });
  const original = query.isError ? undefined : query.data;
  const nodes = graph.isError
    ? []
    : (graph.data?.nodes.filter(
        (node) =>
          node.confirmed &&
          (node.sourceType === "manual" ||
            node.sourceType === "source-anchored-declaration-v1"),
      ) ?? []);
  useEffect(() => {
    setSourceReviewed(false);
    setInterpretationReviewed(false);
  }, [view, original?.etag, query.isError]);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["story-assertion", projectId] });
    void cache.invalidateQueries({
      queryKey: ["story-declaration", projectId],
    });
    void cache.invalidateQueries({
      queryKey: ["story-intelligence", projectId],
    });
  };
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("knowledge.") ||
          event.type.startsWith("writing.") ||
          event.type.startsWith("production.")
        )
          refresh();
      }),
    [client, projectId],
  );
  const go = (id?: string) => {
    const params = new URLSearchParams(location.search);
    params.set("projectId", projectId);
    if (id) params.set("storyAssertionId", id);
    else params.delete("storyAssertionId");
    navigate(
      { pathname: location.pathname, search: `?${params}` },
      { replace: true },
    );
  };
  const build = (sources: StoryDeclarationInput["sources"]) => {
    const node = (id: string) => {
      const current = nodes.find((node) => node.id === id);
      return current ? { id: current.id, version: current.version } : undefined;
    };
    const common = { title, statement, interpretation, sources };
    return StoryAssertionInputSchema.safeParse(
      kind === "relationship"
        ? {
            ...common,
            kind,
            from: node(from),
            to: node(to),
            relation,
            confidence: confidence.trim() ? Number(confidence) : undefined,
          }
        : {
            ...common,
            kind,
            target: node(to),
            subject:
              subjectKind === "character"
                ? { kind: subjectKind, node: node(subject) }
                : { kind: subjectKind, id: audience },
            storyOrder: order.trim() ? Number(order) : undefined,
            state,
          },
    );
  };
  const canCompose = Boolean(
    projectId &&
    graph.data &&
    !graph.isError &&
    !graph.isFetching &&
    !busy &&
    title.trim() &&
    statement.trim() &&
    interpretation &&
    nodes.some((node) => node.id === to) &&
    (kind === "relationship"
      ? from !== to &&
        nodes.some((node) => node.id === from) &&
        confidence.trim() &&
        Number.isFinite(Number(confidence)) &&
        Number(confidence) >= 0 &&
        Number(confidence) <= 1
      : order.trim() &&
        Number.isInteger(Number(order)) &&
        Number(order) >= 0 &&
        (subjectKind === "audience"
          ? audience.trim()
          : nodes.some(
              (node) => node.id === subject && node.kind === "character",
            ))),
  );
  const keyFor = (identity: string) => {
    let key = requests.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      requests.current.set(identity, key);
    }
    return key;
  };
  const save = (sources: StoryDeclarationInput["sources"]) => {
    const draft = build(sources);
    if (!canCompose || !draft.success) return;
    const captured = view,
      identity = JSON.stringify({
        projectId,
        action: "create",
        input: draft.data,
      });
    setBusy(true);
    setNotice(undefined);
    void client.storyAssertions
      .create(projectId, draft.data, keyFor(identity))
      .then((result) => {
        requests.current.delete(identity);
        if (active.current !== captured) return;
        refresh();
        go(result.id);
      })
      .catch((error) => {
        if (active.current === captured) setNotice(message(error));
      })
      .finally(() => {
        if (active.current === captured) setBusy(false);
      });
  };
  const act = (action: "adopt" | "discard") => {
    if (
      !original ||
      busy ||
      query.isFetching ||
      (action === "adopt" &&
        (!sourceReviewed ||
          !interpretationReviewed ||
          original.sourceStatus.state !== "current"))
    )
      return;
    const captured = view,
      input = {
        sourceFingerprint: original.basis.fingerprint,
        confirmedSourceReview: true as const,
        confirmedInterpretationReview: true as const,
      },
      identity = JSON.stringify({
        projectId,
        action,
        id: original.id,
        etag: original.etag,
        input: action === "adopt" ? input : {},
      });
    setBusy(true);
    setNotice(undefined);
    const result =
      action === "adopt"
        ? client.storyAssertions.adopt(
            projectId,
            original,
            input,
            keyFor(identity),
          )
        : client.storyAssertions.discard(projectId, original, keyFor(identity));
    void result
      .then(() => {
        requests.current.delete(identity);
        if (active.current !== captured) return;
        refresh();
        setSourceReviewed(false);
        setInterpretationReviewed(false);
      })
      .catch((error) => {
        if (active.current === captured) {
          setNotice(message(error));
          refresh();
        }
      })
      .finally(() => {
        if (active.current === captured) setBusy(false);
      });
  };
  const selectNode = (
    label: string,
    value: string,
    change: (value: string) => void,
    character = false,
  ) => (
    <label className={styles.c3}>
      {label}
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">
          {copyText("app/features/creative/StoryAssertionPanel.1")}
        </option>
        {nodes
          .filter((node) => !character || node.kind === "character")
          .map((node) => (
            <option key={node.id} value={node.id}>
              {node.title} · {node.kind}
              {copyText("app/features/creative/StoryAssertionPanel.2")}
              {node.version}
            </option>
          ))}
      </NativeSelect>
    </label>
  );
  const content = (
    <fieldset
      disabled={busy || graph.isError || graph.isFetching}
      className={styles.c4}
    >
      <label className={styles.c3}>
        {copyText("app/features/creative/StoryAssertionPanel.3")}
        <input
          aria-label={copyText("app/features/creative/StoryAssertionPanel.3")}
          className={field}
          maxLength={240}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className={styles.c3}>
        {copyText("app/features/creative/StoryAssertionPanel.4")}
        <textarea
          aria-label={copyText("app/features/creative/StoryAssertionPanel.4")}
          className={field}
          maxLength={4000}
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
        />
      </label>
      <label className={styles.c3}>
        {copyText("app/features/creative/StoryAssertionPanel.5")}
        <NativeSelect
          aria-label={copyText("app/features/creative/StoryAssertionPanel.5")}
          value={interpretation}
          onChange={(event) =>
            setInterpretation(
              event.target.value === "source-stated"
                ? "source-stated"
                : event.target.value === "author-inferred"
                  ? "author-inferred"
                  : "",
            )
          }
        >
          <option value="">
            {copyText("app/features/creative/StoryAssertionPanel.6")}
          </option>
          <option value="source-stated">
            {copyText("app/features/creative/StoryAssertionPanel.7")}
          </option>
          <option value="author-inferred">
            {copyText("app/features/creative/StoryAssertionPanel.8")}
          </option>
        </NativeSelect>
      </label>
      {kind === "relationship" ? (
        <>
          {selectNode("关系来源节点", from, setFrom)}
          {selectNode("关系目标节点", to, setTo)}
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryAssertionPanel.9")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.9",
              )}
              value={relation}
              onChange={(event) =>
                setRelation(
                  StoryCausalEdgeRelationSchema.parse(event.target.value),
                )
              }
            >
              {StoryCausalEdgeRelationSchema.options.map((relation) => (
                <option key={relation} value={relation}>
                  {relation}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryAssertionPanel.10")}
            <input
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.11",
              )}
              className={field}
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={confidence}
              onChange={(event) => setConfidence(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryAssertionPanel.12")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.12",
              )}
              value={subjectKind}
              onChange={(event) => {
                setSubjectKind(
                  event.target.value === "audience" ? "audience" : "character",
                );
                setSubject("");
                setAudience("");
              }}
            >
              <option value="character">
                {copyText("app/features/creative/StoryAssertionPanel.13")}
              </option>
              <option value="audience">
                {copyText("app/features/creative/StoryAssertionPanel.14")}
              </option>
            </NativeSelect>
          </label>
          {subjectKind === "character" ? (
            selectNode("来源认知角色", subject, setSubject, true)
          ) : (
            <label className={styles.c3}>
              {copyText("app/features/creative/StoryAssertionPanel.15")}
              <input
                aria-label={copyText(
                  "app/features/creative/StoryAssertionPanel.15",
                )}
                className={field}
                maxLength={200}
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              />
            </label>
          )}
          {selectNode("来源认知目标节点", to, setTo)}
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryAssertionPanel.16")}
            <input
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.16",
              )}
              className={field}
              type="number"
              min="0"
              step="1"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            />
          </label>
          <label className={styles.c3}>
            {copyText("app/features/creative/StoryAssertionPanel.17")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.17",
              )}
              value={state}
              onChange={(event) =>
                setState(AudienceKnowledgeValueSchema.parse(event.target.value))
              }
            >
              {AudienceKnowledgeValueSchema.options.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </NativeSelect>
          </label>
        </>
      )}
    </fieldset>
  );
  return (
    <details
      aria-label={copyText("app/features/creative/StoryAssertionPanel.18")}
      data-project-id={projectId}
      className={styles.c5}
      open={open || Boolean(assertionId)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.c6}>
        {copyText("app/features/creative/StoryAssertionPanel.19")}
      </summary>
      {(open || assertionId) && (
        <>
          <p className={styles.c7}>
            {copyText("app/features/creative/StoryAssertionPanel.20")}
          </p>
          {notice && (
            <p role="status" className={styles.c8}>
              {notice}
            </p>
          )}
          {graph.isError && (
            <p role="alert">
              {copyText("app/features/creative/StoryAssertionPanel.21")}
              {message(graph.error)}
              {copyText("app/features/creative/StoryAssertionPanel.22")}
            </p>
          )}
          <label className={styles.c9}>
            {copyText("app/features/creative/StoryAssertionPanel.23")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.23",
              )}
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(
                  event.target.value === "cognition"
                    ? "cognition"
                    : "relationship",
                );
                setFrom("");
                setTo("");
                setSubject("");
              }}
            >
              <option value="relationship">
                {copyText("app/features/creative/StoryAssertionPanel.24")}
              </option>
              <option value="cognition">
                {copyText("app/features/creative/StoryAssertionPanel.25")}
              </option>
            </NativeSelect>
          </label>
          <label className={styles.c9}>
            {copyText("app/features/creative/StoryAssertionPanel.26")}
            <NativeSelect
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.26",
              )}
              value={mode}
              disabled={busy}
              onChange={(event) =>
                setMode(
                  event.target.value === "screenplay" ? "screenplay" : "novel",
                )
              }
            >
              <option value="novel">
                {copyText("app/features/creative/StoryAssertionPanel.27")}
              </option>
              <option value="screenplay">
                {copyText("app/features/creative/StoryAssertionPanel.28")}
              </option>
            </NativeSelect>
          </label>
          <BareButton
            className={clsx(button, styles.c10)}
            disabled={!projectId || busy}
            onClick={refresh}
          >
            {copyText("app/features/creative/StoryAssertionPanel.29")}
          </BareButton>
          {mode === "screenplay" ? (
            <ScreenplayDeclarationComposer
              key={`${view}:screenplay`}
              projectId={projectId}
              busy={busy}
              sourceOnly={{ content, canSubmit: canCompose, submit: save }}
            />
          ) : (
            <NovelAssertionSources
              key={`${view}:novel`}
              projectId={projectId}
              busy={busy}
              content={content}
              canSubmit={canCompose}
              submit={save}
            />
          )}
          {assertionId && (
            <section
              aria-label={copyText(
                "app/features/creative/StoryAssertionPanel.30",
              )}
              data-assertion-id={assertionId}
              className={styles.c11}
            >
              {query.isError && (
                <p role="alert">
                  {copyText("app/features/creative/StoryAssertionPanel.31")}
                  {message(query.error)}
                  {copyText("app/features/creative/StoryAssertionPanel.32")}
                </p>
              )}
              {original && (
                <>
                  <p className={styles.c12}>
                    {copyText("app/features/creative/StoryAssertionPanel.33")}
                    {original.id}
                    {copyText("app/features/creative/StoryAssertionPanel.2")}
                    {original.version} · {original.status}
                    {copyText("app/features/creative/StoryAssertionPanel.34")}
                    {original.sourceStatus.state}
                  </p>
                  <h4>{original.input.title}</h4>
                  <StorySourceLifecycleReview
                    key={`assertion:${projectId}:${original.id}`}
                    kind="assertion"
                    original={original}
                    disabled={busy || query.isFetching}
                    openOriginal={go}
                  />
                  <p className={styles.c13}>{original.input.statement}</p>
                  <p className={styles.c14}>
                    {copyText("app/features/creative/StoryAssertionPanel.35")}
                    {original.input.interpretation}
                    {copyText("app/features/creative/StoryAssertionPanel.36")}
                    {original.input.kind === "relationship"
                      ? `关系 ${original.input.relation} · 作者估计 ${original.input.confidence}（非校准概率）`
                      : `认知 ${original.input.state} · 作者故事顺序 ${original.input.storyOrder}`}
                  </p>
                  <p className={styles.c12}>
                    {copyText("app/features/creative/StoryAssertionPanel.37")}
                    {original.basis.fingerprint}
                  </p>
                  {original.basis.nodes.map((node) => (
                    <p key={node.id} className={styles.c12}>
                      {copyText("app/features/creative/StoryAssertionPanel.38")}
                      {node.title} · {node.id}
                      {copyText("app/features/creative/StoryAssertionPanel.2")}
                      {node.version} · {node.sourceType}
                    </p>
                  ))}
                  {original.basis.sourceBasis.sources.map((source, index) => (
                    <div key={index} className={styles.c15}>
                      <p className={styles.c12}>
                        {copyText(
                          "app/features/creative/StoryAssertionPanel.39",
                        )}
                        {JSON.stringify(source.selection)}
                      </p>
                      <p className={styles.c13}>{source.quote}</p>
                      <p className={styles.c12}>
                        {copyText(
                          "app/features/creative/StoryAssertionPanel.40",
                        )}
                        {JSON.stringify(source.anchors)}
                        {copyText(
                          "app/features/creative/StoryAssertionPanel.41",
                        )}{" "}
                        {source.quoteHash}
                      </p>
                    </div>
                  ))}
                  {original.sourceStatus.reasons.map((reason, index) => (
                    <p key={index} className={styles.c16}>
                      {reason}
                    </p>
                  ))}
                  {original.adoptedRecord && (
                    <p className={styles.c12}>
                      {copyText("app/features/creative/StoryAssertionPanel.42")}
                      {original.adoptedRecord.kind} ·{" "}
                      {original.adoptedRecord.id}
                      {copyText("app/features/creative/StoryAssertionPanel.2")}
                      {original.adoptedRecord.version}
                    </p>
                  )}
                  <fieldset
                    disabled={
                      busy ||
                      query.isFetching ||
                      original.status !== "pending" ||
                      original.sourceStatus.state !== "current"
                    }
                    className={styles.c17}
                  >
                    <label className={styles.c3}>
                      <input
                        aria-label={copyText(
                          "app/features/creative/StoryAssertionPanel.43",
                        )}
                        type="checkbox"
                        checked={sourceReviewed}
                        onChange={(event) =>
                          setSourceReviewed(event.target.checked)
                        }
                      />{" "}
                      {copyText("app/features/creative/StoryAssertionPanel.44")}
                    </label>
                    <label className={styles.c3}>
                      <input
                        aria-label={copyText(
                          "app/features/creative/StoryAssertionPanel.45",
                        )}
                        type="checkbox"
                        checked={interpretationReviewed}
                        onChange={(event) =>
                          setInterpretationReviewed(event.target.checked)
                        }
                      />{" "}
                      {copyText("app/features/creative/StoryAssertionPanel.46")}
                    </label>
                    <BareButton
                      className={button}
                      disabled={!sourceReviewed || !interpretationReviewed}
                      onClick={() => act("adopt")}
                    >
                      {copyText("app/features/creative/StoryAssertionPanel.47")}
                    </BareButton>
                  </fieldset>
                  <BareButton
                    className={button}
                    disabled={
                      busy || query.isFetching || original.status !== "pending"
                    }
                    onClick={() => act("discard")}
                  >
                    {copyText("app/features/creative/StoryAssertionPanel.48")}
                  </BareButton>
                </>
              )}
            </section>
          )}
          <section
            aria-label={copyText(
              "app/features/creative/StoryAssertionPanel.49",
            )}
            className={styles.c18}
          >
            <h4 className={styles.c16}>
              {copyText("app/features/creative/StoryAssertionPanel.50")}
            </h4>
            {history.isError && (
              <p role="alert">
                {copyText("app/features/creative/StoryAssertionPanel.51")}
                {message(history.error)}
              </p>
            )}
            {!history.isError &&
              history.data?.items.map((item) => (
                <BareButton
                  key={item.id}
                  className={clsx(button, styles.c19)}
                  disabled={busy}
                  onClick={() => go(item.id)}
                >
                  {item.title} · {item.kind} · {item.status} ·{" "}
                  {item.sourceStatus.state}
                </BareButton>
              ))}
            {cursor && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => setCursor(undefined)}
              >
                {copyText("app/features/creative/StoryAssertionPanel.52")}
              </BareButton>
            )}
            {!history.isError && history.data?.nextCursor && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => setCursor(history.data!.nextCursor)}
              >
                {copyText("app/features/creative/StoryAssertionPanel.53")}
              </BareButton>
            )}
            {assertionId && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => go()}
              >
                {copyText("app/features/creative/StoryAssertionPanel.54")}
              </BareButton>
            )}
          </section>
        </>
      )}
    </details>
  );
}
