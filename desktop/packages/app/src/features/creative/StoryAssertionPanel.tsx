import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { BareButton } from "@dramaip/ui-shared";
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

const field =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const button =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";

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
    <label className="block text-sm">
      {label}
      <select
        aria-label={label}
        className={field}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">明确选择实际节点，不默认选中</option>
        {nodes
          .filter((node) => !character || node.kind === "character")
          .map((node) => (
            <option key={node.id} value={node.id}>
              {node.title} · {node.kind} · v{node.version}
            </option>
          ))}
      </select>
    </label>
  );
  const content = (
    <fieldset
      disabled={busy || graph.isError || graph.isFetching}
      className="space-y-3"
    >
      <label className="block text-sm">
        关系认知名称
        <input
          aria-label="关系认知名称"
          className={field}
          maxLength={240}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        关系认知作者解释
        <textarea
          aria-label="关系认知作者解释"
          className={field}
          maxLength={4000}
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        关系认知解释类型
        <select
          aria-label="关系认知解释类型"
          className={field}
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
          <option value="">明确选择，不默认推断</option>
          <option value="source-stated">
            作者认为来源明示（仍非语义证明）
          </option>
          <option value="author-inferred">作者推断（保留不确定性）</option>
        </select>
      </label>
      {kind === "relationship" ? (
        <>
          {selectNode("关系来源节点", from, setFrom)}
          {selectNode("关系目标节点", to, setTo)}
          <label className="block text-sm">
            来源关系类型
            <select
              aria-label="来源关系类型"
              className={field}
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
            </select>
          </label>
          <label className="block text-sm">
            作者关系置信估计（非校准概率）
            <input
              aria-label="作者关系置信估计"
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
          <label className="block text-sm">
            来源认知主体类型
            <select
              aria-label="来源认知主体类型"
              className={field}
              value={subjectKind}
              onChange={(event) => {
                setSubjectKind(
                  event.target.value === "audience" ? "audience" : "character",
                );
                setSubject("");
                setAudience("");
              }}
            >
              <option value="character">实际角色节点</option>
              <option value="audience">明确观众组</option>
            </select>
          </label>
          {subjectKind === "character" ? (
            selectNode("来源认知角色", subject, setSubject, true)
          ) : (
            <label className="block text-sm">
              观众组身份
              <input
                aria-label="观众组身份"
                className={field}
                maxLength={200}
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              />
            </label>
          )}
          {selectNode("来源认知目标节点", to, setTo)}
          <label className="block text-sm">
            作者认知故事顺序
            <input
              aria-label="作者认知故事顺序"
              className={field}
              type="number"
              min="0"
              step="1"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            来源认知状态
            <select
              aria-label="来源认知状态"
              className={field}
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
            </select>
          </label>
        </>
      )}
    </fieldset>
  );
  return (
    <details
      aria-label="关系认知来源工作台"
      data-project-id={projectId}
      className="mt-4 rounded-lg border border-line p-3"
      open={open || Boolean(assertionId)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        给关系或认知单独绑定实际来源
      </summary>
      {(open || assertionId) && (
        <>
          <p className="mt-3 text-sm text-muted">
            节点证据不自动证明关系／认知。保存时冻结所选原文与实际节点版本，双重审阅后才采用；作者顺序与置信估计不是自动语义结论、时间定位或概率证明。不改原稿、不调用模型。
          </p>
          {notice && (
            <p role="status" className="mt-3 text-sm">
              {notice}
            </p>
          )}
          {graph.isError && (
            <p role="alert">
              节点读取失败：{message(graph.error)}；旧节点缓存不作为当前依据。
            </p>
          )}
          <label className="mt-3 block text-sm">
            来源声明结果
            <select
              aria-label="来源声明结果"
              className={field}
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
              <option value="relationship">因果／关系</option>
              <option value="cognition">角色／观众认知</option>
            </select>
          </label>
          <label className="mt-3 block text-sm">
            关系认知来源类型
            <select
              aria-label="关系认知来源类型"
              className={field}
              value={mode}
              disabled={busy}
              onChange={(event) =>
                setMode(
                  event.target.value === "screenplay" ? "screenplay" : "novel",
                )
              }
            >
              <option value="novel">小说段落／精确采用资料</option>
              <option value="screenplay">已保存剧本块（不要求小说）</option>
            </select>
          </label>
          <BareButton
            className={`${button} mt-3`}
            disabled={!projectId || busy}
            onClick={refresh}
          >
            重读关系认知来源与原候选
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
              aria-label="原关系认知来源审阅"
              data-assertion-id={assertionId}
              className="mt-4 space-y-3 rounded-lg border border-line p-3"
            >
              {query.isError && (
                <p role="alert">
                  原关系／认知读取失败：{message(query.error)}；未选择最新候选。
                </p>
              )}
              {original && (
                <>
                  <p className="break-all text-xs">
                    原声明 {original.id} · v{original.version} ·{" "}
                    {original.status} · 来源 {original.sourceStatus.state}
                  </p>
                  <h4>{original.input.title}</h4>
                  <StorySourceLifecycleReview
                    key={`assertion:${projectId}:${original.id}`}
                    kind="assertion"
                    original={original}
                    disabled={busy || query.isFetching}
                    openOriginal={go}
                  />
                  <p className="whitespace-pre-wrap text-sm">
                    {original.input.statement}
                  </p>
                  <p className="text-xs text-muted">
                    解释：{original.input.interpretation}
                    ；作者审阅不是语义证明。
                    {original.input.kind === "relationship"
                      ? `关系 ${original.input.relation} · 作者估计 ${original.input.confidence}（非校准概率）`
                      : `认知 ${original.input.state} · 作者故事顺序 ${original.input.storyOrder}`}
                  </p>
                  <p className="break-all text-xs">
                    冻结指纹 {original.basis.fingerprint}
                  </p>
                  {original.basis.nodes.map((node) => (
                    <p key={node.id} className="break-all text-xs">
                      冻结节点 {node.title} · {node.id} · v{node.version} ·{" "}
                      {node.sourceType}
                    </p>
                  ))}
                  {original.basis.sourceBasis.sources.map((source, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-line p-2"
                    >
                      <p className="break-all text-xs">
                        实际来源 {JSON.stringify(source.selection)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">
                        {source.quote}
                      </p>
                      <p className="break-all text-xs">
                        实际锚点 {JSON.stringify(source.anchors)} · 引文 hash{" "}
                        {source.quoteHash}
                      </p>
                    </div>
                  ))}
                  {original.sourceStatus.reasons.map((reason, index) => (
                    <p key={index} className="text-sm">
                      {reason}
                    </p>
                  ))}
                  {original.adoptedRecord && (
                    <p className="break-all text-xs">
                      实际采用 {original.adoptedRecord.kind} ·{" "}
                      {original.adoptedRecord.id} · v
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
                    className="space-y-2"
                  >
                    <label className="block text-sm">
                      <input
                        aria-label="已核对关系认知原文与节点版本"
                        type="checkbox"
                        checked={sourceReviewed}
                        onChange={(event) =>
                          setSourceReviewed(event.target.checked)
                        }
                      />{" "}
                      已核对原文、实际锚点与冻结节点版本
                    </label>
                    <label className="block text-sm">
                      <input
                        aria-label="已审阅关系认知解释与不确定性"
                        type="checkbox"
                        checked={interpretationReviewed}
                        onChange={(event) =>
                          setInterpretationReviewed(event.target.checked)
                        }
                      />{" "}
                      已审阅关系／认知解释与不确定性，不视作语义证明
                    </label>
                    <BareButton
                      className={button}
                      disabled={!sourceReviewed || !interpretationReviewed}
                      onClick={() => act("adopt")}
                    >
                      明确采用该原关系认知声明
                    </BareButton>
                  </fieldset>
                  <BareButton
                    className={button}
                    disabled={
                      busy || query.isFetching || original.status !== "pending"
                    }
                    onClick={() => act("discard")}
                  >
                    放弃该原关系认知候选
                  </BareButton>
                </>
              )}
            </section>
          )}
          <section aria-label="关系认知来源历史" className="mt-4 space-y-2">
            <h4 className="text-sm">
              原关系／认知历史（二十项分页，不自动选最新）
            </h4>
            {history.isError && (
              <p role="alert">历史读取失败：{message(history.error)}</p>
            )}
            {!history.isError &&
              history.data?.items.map((item) => (
                <BareButton
                  key={item.id}
                  className={`${button} block w-full text-left`}
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
                回到关系认知历史首页
              </BareButton>
            )}
            {!history.isError && history.data?.nextCursor && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => setCursor(history.data!.nextCursor)}
              >
                下一页关系认知历史
              </BareButton>
            )}
            {assertionId && (
              <BareButton
                className={button}
                disabled={busy}
                onClick={() => go()}
              >
                关闭原关系认知审阅
              </BareButton>
            )}
          </section>
        </>
      )}
    </details>
  );
}
