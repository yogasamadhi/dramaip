import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { BareButton } from "@dramaip/ui-shared";
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

const field =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const button =
  "rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
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
      aria-label="认知与因果声明工作台"
      data-project-id={projectId}
      className="rounded-xl border border-line bg-surface p-5"
    >
      <h2 className="font-semibold">认知与因果声明</h2>
      <p className="mt-1 text-sm text-muted">
        勾选确认只表达你的人工判断，不证明语义质量或授权。普通手工表单不读取小说正文；来源工作台只读你明确选择的来源，不调用模型或改写原稿。
      </p>
      <label className="mt-3 block text-sm">
        声明所属项目
        <select
          aria-label="声明所属项目"
          className={field}
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
          <option value="">选择项目</option>
          {projects.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>
      {projects.isError && (
        <p role="alert" className="mt-3 text-sm text-warning">
          项目目录读取失败：{message(projects.error)}
        </p>
      )}
      {graphQuery.isError ? (
        <div role="alert" className="mt-3 text-sm text-warning">
          声明图读取失败，旧缓存不作为可用来源：{message(graphQuery.error)}{" "}
          <BareButton
            className={button}
            onClick={() => void graphQuery.refetch()}
          >
            重查声明图
          </BareButton>
        </div>
      ) : projectId && !graph ? (
        <p className="mt-3 text-sm text-muted">正在读取实际声明图…</p>
      ) : (
        graph && (
          <div
            aria-label="实际声明数量"
            className="mt-3 grid gap-2 text-sm sm:grid-cols-4"
          >
            <p>人工确认节点：{declared.length}</p>
            <p>候选节点：{graph.nodes.length - declared.length}</p>
            <p>关系声明：{graph.edges.length}</p>
            <p>认知声明：{graph.audienceStates.length}</p>
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
      <details className="mt-4 rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">添加节点声明</summary>
        <form
          aria-label="节点声明表单"
          className="mt-3 space-y-3"
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
          <fieldset disabled={!available} className="space-y-3">
            <label className="block text-sm">
              节点类型
              <select
                aria-label="节点类型"
                className={field}
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
              </select>
            </label>
            <label className="block text-sm">
              节点名称
              <input
                className={field}
                value={title}
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              人工说明
              <textarea
                className={field}
                value={summary}
                maxLength={4000}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我明确确认这项人工声明；未勾选时仅保存 AI 草稿
            </label>
            <BareButton
              type="submit"
              className={button}
              disabled={!title.trim()}
            >
              保存节点声明
            </BareButton>
          </fieldset>
        </form>
      </details>
      <details className="mt-3 rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">
          添加因果关系与认知声明
        </summary>
        <form
          aria-label="关系声明表单"
          className="mt-3 space-y-3"
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
          <fieldset disabled={!available} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              关系起点
              <select
                aria-label="关系起点"
                className={field}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              >
                <option value="">选择节点</option>
                {graph?.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}（{node.confirmed ? "人工确认" : "候选"}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              关系终点
              <select
                aria-label="关系终点"
                className={field}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                <option value="">选择节点</option>
                {graph?.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}（{node.confirmed ? "人工确认" : "候选"}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              关系类型
              <select
                aria-label="关系类型"
                className={field}
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
              </select>
            </label>
            <label className="text-sm">
              关系说明
              <input
                className={field}
                value={rationale}
                maxLength={4000}
                onChange={(event) => setRationale(event.target.value)}
              />
            </label>
            <label className="flex gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={edgeConfirmed}
                onChange={(event) => setEdgeConfirmed(event.target.checked)}
              />
              我确认这条人工关系；两端须已人工确认
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
              保存关系声明
            </BareButton>
          </fieldset>
        </form>
        <form
          aria-label="认知声明表单"
          className="mt-4 border-t border-line pt-4"
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
          <fieldset disabled={!available} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              认知主体
              <select
                aria-label="认知主体"
                className={field}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              >
                <option value="audience">观众／读者</option>
                {declared
                  .filter((node) => node.kind === "character")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              认知对象
              <select
                aria-label="认知对象"
                className={field}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">选择人工确认节点</option>
                {declared.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              故事顺序
              <input
                className={field}
                type="number"
                min={0}
                step={1}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </label>
            <label className="text-sm">
              认知状态
              <select
                aria-label="认知状态"
                className={field}
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
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              认知证据说明
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
              保存认知声明
            </BareButton>
          </fieldset>
        </form>
      </details>
      {graph && (
        <details className="mt-3 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm">
            核对实际声明（含 AI 草稿）
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {graph.nodes.map((node) => (
              <li key={node.id} data-node-id={node.id}>
                <strong>{node.title}</strong> · {kinds[node.kind]} ·{" "}
                {node.confirmed ? "人工确认" : "AI 草稿，不进入快照"}
                <p className="whitespace-pre-wrap text-muted">{node.summary}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            没有原文位置核验的 sourceType／sourceId 不作为权威来源证据。
          </p>
        </details>
      )}
      <div
        className="mt-4 space-y-3 rounded-lg border border-line p-3"
        aria-label="原声明快照与推演"
      >
        <p className="text-sm">
          先明确保存声明快照，核对其中的人工确认项，再另行推演。推演仅作关键词命中与规则检查，不生成语义结论。
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
          明确创建新声明快照
        </BareButton>
        {(snapshotQuery.isError || simulationQuery.isError || mismatched) && (
          <p role="alert" className="text-sm text-warning">
            原快照／推演无法核对，不自动换到最新来源：
            {mismatched
              ? "链接中的快照与原推演不一致。"
              : message(snapshotQuery.error ?? simulationQuery.error)}
          </p>
        )}
        {snapshot && !mismatched && (
          <div
            data-snapshot-id={snapshot.id}
            aria-label="冻结人工声明快照"
            className="space-y-2 text-sm"
          >
            <p className="break-all">
              快照 {snapshot.id} · 指纹 {snapshot.sourceFingerprint}
            </p>
            <p>
              冻结人工确认节点 {snapshot.nodes.length}／关系{" "}
              {snapshot.edges.length}／认知声明 {snapshot.audienceStates.length}
              。候选未混入。
            </p>
            <ul>
              {snapshot.nodes.map((node) => (
                <li key={node.id}>
                  {node.title}（人工确认，不是原文已核验事实）
                </li>
              ))}
            </ul>
            <StoryRuleReview snapshot={snapshot} />
            {snapshot.stale && (
              <p role="alert" className="text-warning">
                原声明快照已失效；历史内容保留，但不能据此创建新推演。需核对后明确创建新快照。
              </p>
            )}
            <label className="flex gap-2">
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
              我已核对本次声明快照，理解规则推演不证明原文或语义质量
            </label>
          </div>
        )}
        <label className="block text-sm">
          推演假设
          <input
            className={field}
            value={hypothesis}
            maxLength={4000}
            disabled={running}
            onChange={(event) => setHypothesis(event.target.value)}
            placeholder="例如：如果反派提前知道某个秘密……"
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
          基于原快照创建规则推演
        </BareButton>
        {simulation && !mismatched && !snapshotQuery.isError && (
          <article
            aria-label="原规则推演结果"
            data-simulation-id={simulation.id}
            data-snapshot-id={simulation.snapshotId}
            className="space-y-2 text-sm"
          >
            <p className="break-all">
              原推演 {simulation.id} · 状态 {simulation.status}
            </p>
            <p className="whitespace-pre-wrap">
              原假设：{simulation.hypothesis}
            </p>
            <ul>
              {simulation.deterministicFindings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
            <p className="text-muted">
              本次模型推断：
              {simulation.modelInferences.length
                ? "历史记录中的推断仍需人工评议"
                : "未调用模型，无模型推断"}
              ；没有采用或提交入口。
            </p>
            <a
              className="text-link"
              href={`#${location.pathname}?${new URLSearchParams({ projectId, storySnapshotId: simulation.snapshotId, storySimulationId: simulation.id })}`}
            >
              返回这次原推演
            </a>
          </article>
        )}
      </div>
      {notice && (
        <p
          role="status"
          className="mt-3 whitespace-pre-wrap rounded-lg bg-brand-soft p-3 text-sm text-brand"
        >
          {notice}
        </p>
      )}
      {riskQuery.isError ? (
        <p role="alert" className="mt-3 text-sm text-warning">
          原创性复核线索读取失败，不能据此判断无风险：{message(riskQuery.error)}
        </p>
      ) : (
        riskQuery.data && (
          <p className="mt-3 text-xs text-muted">
            原创性账本仅有 {riskQuery.data.length}{" "}
            条复核线索，不构成侵权、合法授权或法律结论。
          </p>
        )
      )}
    </section>
  );
}
