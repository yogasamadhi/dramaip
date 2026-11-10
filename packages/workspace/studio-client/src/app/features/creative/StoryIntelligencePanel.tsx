import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { useLocation, useNavigate } from "../../router";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import {
  StoryCausalNodeKindSchema,
  StoryCausalEdgeRelationSchema,
  AudienceKnowledgeValueSchema,
  type StoryCausalNode,
  type StoryCausalEdge,
  type AudienceKnowledgeState,
} from "@dramaip/contracts";
import { message, useStudio } from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import { StoryDeclarationPanel } from "./StoryDeclarationPanel";
import { StoryAssertionPanel } from "./StoryAssertionPanel";
import { StoryRuleReview } from "./StoryRuleReview";
import styles from "./StoryIntelligencePanel.module.css";
import { copyText } from "../../copy";

const field = styles.c1;
const button = styles.c2;
const kinds: Record<StoryCausalNode["kind"], string> = {
  character: "人物",
  event: "事件",
  secret: "秘密",
  rule: "规则",
  location: "地点",
  organization: "组织",
  resource: "资源",
  relationship: "关系",
  inspiration: "灵感",
};
const relations: Record<StoryCausalEdge["relation"], string> = {
  causes: "导致",
  enables: "使之可能",
  blocks: "阻止",
  reveals: "揭示",
  conflicts_with: "冲突",
  depends_on: "依赖",
};
const states: Record<AudienceKnowledgeState["state"], string> = {
  unknown: "未知",
  suspects: "怀疑",
  misbelieves: "误信",
  knows: "知晓",
};

/** Manual declarations only: no implicit manuscript read, model call, or adoption. */
export function StoryIntelligencePanel(props: { projectId?: string }) {
  const client = useStudio(),
    session = useStudioSession();
  const queryClient = useQueryClient(),
    location = useLocation(),
    navigate = useNavigate();
  const projectId = props.projectId ?? "";
  const params = new URLSearchParams(location.search);
  const requestedSnapshot = params.get("storySnapshotId") ?? "";
  const simulationId = params.get("storySimulationId") ?? "";
  const [notice, setNotice] = useState<string>(),
    [running, setRunning] = useState(false);
  const [title, setTitle] = useState(""),
    [summary, setSummary] = useState("");
  const [kind, setKind] = useState<StoryCausalNode["kind"]>("event");
  const [confirmed, setConfirmed] = useState(false);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [rationale, setRationale] = useState("");
  const [relation, setRelation] =
    useState<StoryCausalEdge["relation"]>("causes");
  const [edgeConfirmed, setEdgeConfirmed] = useState(false);
  const [subject, setSubject] = useState("audience"),
    [target, setTarget] = useState("");
  const [order, setOrder] = useState("0"),
    [evidence, setEvidence] = useState("");
  const [state, setState] =
    useState<AudienceKnowledgeState["state"]>("unknown");
  const [hypothesis, setHypothesis] = useState("");
  const [snapshotConfirmed, setSnapshotConfirmed] = useState(false);
  const active = useRef(true),
    currentView = useRef(location.search);
  currentView.current = location.search;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
    retry: false,
  });
  const graphQuery = useQuery({
    queryKey: ["story-intelligence", projectId, "graph"],
    queryFn: () => client.storyIntelligence.graph(projectId),
    enabled: Boolean(projectId),
    staleTime: 0,
    retry: false,
  });
  const graph = graphQuery.isError ? undefined : graphQuery.data;
  const available = Boolean(
    projectId && graph && !graphQuery.isFetching && !running,
  );
  const riskQuery = useQuery({
    queryKey: ["story-intelligence", projectId, "risks"],
    queryFn: () => client.storyIntelligence.originalityRisks(projectId),
    enabled: Boolean(projectId),
    staleTime: 0,
    retry: false,
  });
  const simulationQuery = useQuery({
    queryKey: ["story-intelligence", projectId, "simulation", simulationId],
    queryFn: () =>
      client.storyIntelligence.getSimulation(projectId, simulationId),
    enabled: Boolean(projectId && simulationId),
    staleTime: 0,
    retry: false,
  });
  const simulation = simulationQuery.isError ? undefined : simulationQuery.data;
  const snapshotId = requestedSnapshot || simulation?.snapshotId || "";
  const snapshotQuery = useQuery({
    queryKey: ["story-intelligence", projectId, "snapshot", snapshotId],
    queryFn: () => client.storyIntelligence.getTwin(projectId, snapshotId),
    enabled: Boolean(projectId && snapshotId),
    staleTime: 0,
    retry: false,
  });
  const snapshot = snapshotQuery.isError ? undefined : snapshotQuery.data;
  const mismatched = Boolean(
    simulation &&
    requestedSnapshot &&
    simulation.snapshotId !== requestedSnapshot,
  );
  useEffect(() => {
    setSnapshotConfirmed(false);
  }, [
    snapshotId,
    snapshot?.stale,
    snapshot?.sourceFingerprint,
    snapshotQuery.isError,
  ]);
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          event.type.startsWith("knowledge.") &&
          event.payload &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          "projectId" in event.payload &&
          event.payload.projectId === projectId
        )
          void queryClient.invalidateQueries({
            queryKey: ["story-intelligence", projectId],
          });
      }),
    [client, projectId, queryClient],
  );
  const bind = (selectedSnapshot: string, selectedSimulation = "") => {
    const next = new URLSearchParams(location.search);
    next.set("projectId", projectId);
    next.set("storySnapshotId", selectedSnapshot);
    if (selectedSimulation) next.set("storySimulationId", selectedSimulation);
    else next.delete("storySimulationId");
    navigate(
      { pathname: location.pathname, search: `?${next}` },
      { replace: true },
    );
  };
  const execute = async (operation: () => Promise<void>) => {
    if (!available) return;
    setRunning(true);
    setNotice(undefined);
    const view = currentView.current;
    try {
      await operation();
    } catch (cause) {
      if (active.current && currentView.current === view)
        setNotice(message(cause));
    } finally {
      if (active.current) setRunning(false);
    }
  };
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["story-intelligence", projectId],
    });
  const declared = graph?.nodes.filter((node) => node.confirmed) ?? [];
  const fromNode = graph?.nodes.find((node) => node.id === from),
    toNode = graph?.nodes.find((node) => node.id === to);
  const safeOrder = Number(order);

  return (
    <section
      aria-label={copyText("app/features/creative/StoryIntelligencePanel.1")}
      data-project-id={projectId}
      className={styles.c3}
    >
      <h2 className={styles.c4}>
        {copyText("app/features/creative/StoryIntelligencePanel.2")}
      </h2>
      <p className={styles.c5}>
        {copyText("app/features/creative/StoryIntelligencePanel.3")}
      </p>
      <label className={styles.c6}>
        {copyText("app/features/creative/StoryIntelligencePanel.4")}
        <NativeSelect
          aria-label={copyText(
            "app/features/creative/StoryIntelligencePanel.4",
          )}
          value={projectId}
          disabled={running || projects.isError}
          onChange={(event) => {
            const id = event.target.value;
            if (!id) return;
            session.selectProject(id);
            const next = new URLSearchParams(location.search);
            next.delete("storySnapshotId");
            next.delete("storySimulationId");
            if (id) next.set("projectId", id);
            else next.delete("projectId");
            navigate({ pathname: location.pathname, search: `?${next}` });
          }}
        >
          <option value="">
            {copyText("app/features/creative/StoryIntelligencePanel.5")}
          </option>
          {projects.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </NativeSelect>
      </label>
      {projects.isError && (
        <p role="alert" className={styles.c7}>
          {copyText("app/features/creative/StoryIntelligencePanel.6")}
          {message(projects.error)}
        </p>
      )}
      {graphQuery.isError ? (
        <div role="alert" className={styles.c7}>
          {copyText("app/features/creative/StoryIntelligencePanel.7")}
          {message(graphQuery.error)}{" "}
          <BareButton
            className={button}
            onClick={() => void graphQuery.refetch()}
          >
            {copyText("app/features/creative/StoryIntelligencePanel.8")}
          </BareButton>
        </div>
      ) : projectId && !graph ? (
        <p className={styles.c8}>
          {copyText("app/features/creative/StoryIntelligencePanel.9")}
        </p>
      ) : (
        graph && (
          <div
            aria-label={copyText(
              "app/features/creative/StoryIntelligencePanel.10",
            )}
            className={styles.c9}
          >
            <p>
              {copyText("app/features/creative/StoryIntelligencePanel.11")}
              {declared.length}
            </p>
            <p>
              {copyText("app/features/creative/StoryIntelligencePanel.12")}
              {graph.nodes.length - declared.length}
            </p>
            <p>
              {copyText("app/features/creative/StoryIntelligencePanel.13")}
              {graph.edges.length}
            </p>
            <p>
              {copyText("app/features/creative/StoryIntelligencePanel.14")}
              {graph.audienceStates.length}
            </p>
          </div>
        )
      )}
      <StoryDeclarationPanel
        key={projectId || "no-project"}
        projectId={projectId}
      />
      <StoryAssertionPanel
        key={`assertions:${projectId || "no-project"}`}
        projectId={projectId}
      />
      <details className={styles.c10}>
        <summary className={styles.c11}>
          {copyText("app/features/creative/StoryIntelligencePanel.15")}
        </summary>
        <form
          aria-label={copyText(
            "app/features/creative/StoryIntelligencePanel.16",
          )}
          className={styles.c12}
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            void execute(async () => {
              await client.storyIntelligence.createNode(projectId, {
                kind,
                title: title.trim(),
                summary,
                sourceType: "manual",
                sourceId: crypto.randomUUID(),
                sourceVersion: 0,
                confirmed,
              });
              if (active.current) {
                setTitle("");
                setSummary("");
                setConfirmed(false);
                setNotice(
                  "节点声明已保存；AI 草稿不会进入声明快照，人工确认不等于原文核验。",
                );
              }
              await refresh();
            });
          }}
        >
          <fieldset disabled={!available} className={styles.c13}>
            <label className={styles.c14}>
              {copyText("app/features/creative/StoryIntelligencePanel.17")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.17",
                )}
                value={kind}
                onChange={(event) =>
                  setKind(StoryCausalNodeKindSchema.parse(event.target.value))
                }
              >
                {StoryCausalNodeKindSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {kinds[value]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c14}>
              {copyText("app/features/creative/StoryIntelligencePanel.18")}
              <input
                className={field}
                value={title}
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className={styles.c14}>
              {copyText("app/features/creative/StoryIntelligencePanel.19")}
              <textarea
                className={field}
                value={summary}
                maxLength={4000}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            <label className={styles.c15}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {copyText("app/features/creative/StoryIntelligencePanel.20")}
            </label>
            <BareButton
              type="submit"
              className={button}
              disabled={!title.trim()}
            >
              {copyText("app/features/creative/StoryIntelligencePanel.21")}
            </BareButton>
          </fieldset>
        </form>
      </details>
      <details className={styles.c16}>
        <summary className={styles.c11}>
          {copyText("app/features/creative/StoryIntelligencePanel.22")}
        </summary>
        <form
          aria-label={copyText(
            "app/features/creative/StoryIntelligencePanel.23",
          )}
          className={styles.c12}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !fromNode ||
              !toNode ||
              !rationale.trim() ||
              (edgeConfirmed && (!fromNode.confirmed || !toNode.confirmed))
            )
              return;
            void execute(async () => {
              await client.storyIntelligence.createEdge(projectId, {
                fromNodeId: from,
                toNodeId: to,
                relation,
                rationale: rationale.trim(),
                confidence: 1,
                confirmed: edgeConfirmed,
              });
              if (active.current) {
                setRationale("");
                setEdgeConfirmed(false);
                setNotice("关系声明已保存；不是模型概率或原文因果已核验结果。");
              }
              await refresh();
            });
          }}
        >
          <fieldset disabled={!available} className={styles.c17}>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.24")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.24",
                )}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              >
                <option value="">
                  {copyText("app/features/creative/StoryIntelligencePanel.25")}
                </option>
                {graph?.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}（{node.confirmed ? "人工确认" : "草稿"}）
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.26")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.26",
                )}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                <option value="">
                  {copyText("app/features/creative/StoryIntelligencePanel.25")}
                </option>
                {graph?.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}（{node.confirmed ? "人工确认" : "草稿"}）
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.27")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.27",
                )}
                value={relation}
                onChange={(event) =>
                  setRelation(
                    StoryCausalEdgeRelationSchema.parse(event.target.value),
                  )
                }
              >
                {StoryCausalEdgeRelationSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {relations[value]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.28")}
              <input
                className={field}
                value={rationale}
                maxLength={4000}
                onChange={(event) => setRationale(event.target.value)}
              />
            </label>
            <label className={styles.c19}>
              <input
                type="checkbox"
                checked={edgeConfirmed}
                onChange={(event) => setEdgeConfirmed(event.target.checked)}
              />
              {copyText("app/features/creative/StoryIntelligencePanel.29")}
            </label>
            <BareButton
              type="submit"
              className={button}
              disabled={
                !fromNode ||
                !toNode ||
                !rationale.trim() ||
                (edgeConfirmed && (!fromNode.confirmed || !toNode.confirmed))
              }
            >
              {copyText("app/features/creative/StoryIntelligencePanel.30")}
            </BareButton>
          </fieldset>
        </form>
        <form
          aria-label={copyText(
            "app/features/creative/StoryIntelligencePanel.31",
          )}
          className={styles.c20}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !target ||
              !Number.isSafeInteger(safeOrder) ||
              safeOrder < 0 ||
              !order.trim() ||
              (state !== "unknown" && !evidence.trim())
            )
              return;
            void execute(async () => {
              await client.storyIntelligence.createAudienceState(projectId, {
                subjectType: subject === "audience" ? "audience" : "character",
                subjectId: subject === "audience" ? "audience" : subject,
                knowledgeNodeId: target,
                storyOrder: safeOrder,
                state,
                evidence: evidence.trim(),
              });
              if (active.current) {
                setEvidence("");
                setNotice(
                  "认知声明已保存；人工证据说明不是原文位置或语义核验。",
                );
              }
              await refresh();
            });
          }}
        >
          <fieldset disabled={!available} className={styles.c17}>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.32")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.32",
                )}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              >
                <option value="audience">
                  {copyText("app/features/creative/StoryIntelligencePanel.33")}
                </option>
                {declared
                  .filter((node) => node.kind === "character")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.34")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.34",
                )}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">
                  {copyText("app/features/creative/StoryIntelligencePanel.35")}
                </option>
                {declared.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.36")}
              <input
                className={field}
                type="number"
                min={0}
                step={1}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </label>
            <label className={styles.c18}>
              {copyText("app/features/creative/StoryIntelligencePanel.37")}
              <NativeSelect
                aria-label={copyText(
                  "app/features/creative/StoryIntelligencePanel.37",
                )}
                value={state}
                onChange={(event) =>
                  setState(
                    AudienceKnowledgeValueSchema.parse(event.target.value),
                  )
                }
              >
                {AudienceKnowledgeValueSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {states[value]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={styles.c21}>
              {copyText("app/features/creative/StoryIntelligencePanel.38")}
              <textarea
                className={field}
                value={evidence}
                maxLength={4000}
                onChange={(event) => setEvidence(event.target.value)}
              />
            </label>
            <BareButton
              type="submit"
              className={button}
              disabled={
                !target ||
                !Number.isSafeInteger(safeOrder) ||
                safeOrder < 0 ||
                !order.trim() ||
                (state !== "unknown" && !evidence.trim())
              }
            >
              {copyText("app/features/creative/StoryIntelligencePanel.39")}
            </BareButton>
          </fieldset>
        </form>
      </details>
      {graph && (
        <details className={styles.c16}>
          <summary className={styles.c11}>
            {copyText("app/features/creative/StoryIntelligencePanel.40")}
          </summary>
          <ul className={styles.c22}>
            {graph.nodes.map((node) => (
              <li key={node.id} data-node-id={node.id}>
                <strong>{node.title}</strong> · {kinds[node.kind]} ·{" "}
                {node.confirmed ? "人工确认" : "AI 草稿，不进入快照"}
                <p className={styles.c23}>{node.summary}</p>
              </li>
            ))}
          </ul>
          <p className={styles.c24}>
            {copyText("app/features/creative/StoryIntelligencePanel.41")}
          </p>
        </details>
      )}
      <div
        className={styles.c25}
        aria-label={copyText("app/features/creative/StoryIntelligencePanel.42")}
      >
        <p className={styles.c18}>
          {copyText("app/features/creative/StoryIntelligencePanel.43")}
        </p>
        <BareButton
          className={button}
          disabled={!available || graphQuery.isError}
          onClick={() => {
            const view = currentView.current;
            void execute(async () => {
              const value = await client.storyIntelligence.buildTwin(projectId);
              if (active.current && currentView.current === view) {
                bind(value.id);
                setSnapshotConfirmed(false);
                setNotice("已保存独立声明快照；未自动创建推演或采用内容。");
              }
              await refresh();
            });
          }}
        >
          {copyText("app/features/creative/StoryIntelligencePanel.44")}
        </BareButton>
        {(snapshotQuery.isError || simulationQuery.isError || mismatched) && (
          <p role="alert" className={styles.c26}>
            {copyText("app/features/creative/StoryIntelligencePanel.45")}
            {mismatched
              ? "链接中的快照与原推演不一致。"
              : message(snapshotQuery.error ?? simulationQuery.error)}
          </p>
        )}
        {snapshot && !mismatched && (
          <div
            data-snapshot-id={snapshot.id}
            aria-label={copyText(
              "app/features/creative/StoryIntelligencePanel.46",
            )}
            className={styles.c27}
          >
            <p className={styles.c28}>
              {copyText("app/features/creative/StoryIntelligencePanel.47")}
              {snapshot.id}
              {copyText("app/features/creative/StoryIntelligencePanel.48")}
              {snapshot.sourceFingerprint}
            </p>
            <p>
              {copyText("app/features/creative/StoryIntelligencePanel.49")}
              {snapshot.nodes.length}
              {copyText("app/features/creative/StoryIntelligencePanel.50")}{" "}
              {snapshot.edges.length}
              {copyText("app/features/creative/StoryIntelligencePanel.51")}
              {snapshot.audienceStates.length}
              {copyText("app/features/creative/StoryIntelligencePanel.52")}
            </p>
            <ul>
              {snapshot.nodes.map((node) => (
                <li key={node.id}>
                  {node.title}
                  {copyText("app/features/creative/StoryIntelligencePanel.53")}
                </li>
              ))}
            </ul>
            <StoryRuleReview snapshot={snapshot} />
            {snapshot.stale && (
              <p role="alert" className={styles.c29}>
                {copyText("app/features/creative/StoryIntelligencePanel.54")}
              </p>
            )}
            <label className={styles.c30}>
              <input
                type="checkbox"
                checked={snapshotConfirmed}
                disabled={
                  !available ||
                  snapshot.stale ||
                  snapshotQuery.isFetching ||
                  simulationQuery.isError
                }
                onChange={(event) => setSnapshotConfirmed(event.target.checked)}
              />
              {copyText("app/features/creative/StoryIntelligencePanel.55")}
            </label>
          </div>
        )}
        <label className={styles.c14}>
          {copyText("app/features/creative/StoryIntelligencePanel.56")}
          <input
            className={field}
            value={hypothesis}
            maxLength={4000}
            disabled={running}
            onChange={(event) => setHypothesis(event.target.value)}
            placeholder={copyText(
              "app/features/creative/StoryIntelligencePanel.57",
            )}
          />
        </label>
        <BareButton
          className={button}
          disabled={
            !available ||
            !snapshot ||
            snapshot.stale ||
            !snapshotConfirmed ||
            !hypothesis.trim() ||
            snapshotQuery.isFetching ||
            simulationQuery.isFetching ||
            simulationQuery.isError ||
            mismatched
          }
          onClick={() => {
            if (
              !snapshot ||
              snapshot.stale ||
              !snapshotConfirmed ||
              !hypothesis.trim() ||
              mismatched
            )
              return;
            const view = currentView.current;
            void execute(async () => {
              const result = await client.storyIntelligence.createSimulation(
                projectId,
                { snapshotId: snapshot.id, hypothesis: hypothesis.trim() },
              );
              if (active.current && currentView.current === view) {
                bind(result.snapshotId, result.id);
                setNotice(
                  "规则推演已保存，仍是只读参考；未采用、改写或调用模型。",
                );
              }
              await refresh();
            });
          }}
        >
          {copyText("app/features/creative/StoryIntelligencePanel.58")}
        </BareButton>
        {simulation && !mismatched && !snapshotQuery.isError && (
          <article
            aria-label={copyText(
              "app/features/creative/StoryIntelligencePanel.59",
            )}
            data-simulation-id={simulation.id}
            data-snapshot-id={simulation.snapshotId}
            className={styles.c27}
          >
            <p className={styles.c28}>
              {copyText("app/features/creative/StoryIntelligencePanel.60")}
              {simulation.id}
              {copyText("app/features/creative/StoryIntelligencePanel.61")}
              {simulation.status}
            </p>
            <p className={styles.c31}>
              {copyText("app/features/creative/StoryIntelligencePanel.62")}
              {simulation.hypothesis}
            </p>
            <ul>
              {simulation.deterministicFindings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
            <p className={styles.c32}>
              {copyText("app/features/creative/StoryIntelligencePanel.63")}
              {simulation.modelInferences.length
                ? "历史记录中的推断仍需人工评议"
                : "未调用模型，无模型推断"}
              {copyText("app/features/creative/StoryIntelligencePanel.64")}
            </p>
            <a
              className={styles.c33}
              href={`#${location.pathname}?${new URLSearchParams({ projectId, storySnapshotId: simulation.snapshotId, storySimulationId: simulation.id })}`}
            >
              {copyText("app/features/creative/StoryIntelligencePanel.65")}
            </a>
          </article>
        )}
      </div>
      {notice && (
        <p role="status" className={styles.c34}>
          {notice}
        </p>
      )}
      {riskQuery.isError ? (
        <p role="alert" className={styles.c7}>
          {copyText("app/features/creative/StoryIntelligencePanel.66")}
          {message(riskQuery.error)}
        </p>
      ) : (
        riskQuery.data && (
          <p className={styles.c35}>
            {copyText("app/features/creative/StoryIntelligencePanel.67")}
            {riskQuery.data.length}{" "}
            {copyText("app/features/creative/StoryIntelligencePanel.68")}
          </p>
        )
      )}
    </section>
  );
}
