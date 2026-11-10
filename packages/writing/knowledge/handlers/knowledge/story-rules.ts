import { createHash } from "node:crypto";
import {
  StoryRuleAnalysisSchema,
  type StoryRuleAnalysis,
  type StoryRuleFinding,
  type StoryCausalNode,
  type StoryCausalEdge,
  type AudienceKnowledgeState,
} from "@dramaip/contracts";

type Reference = StoryRuleFinding["records"][number];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const record = (
  kind: Reference["kind"],
  value: { id: string; version: number },
): Reference => ({
  kind,
  id: value.id,
  version: value.version,
});

/** Pure structural checks over one already frozen, owner-validated graph.
 * No source read, model, semantic judgement, score or adoption is performed.
 * A depends_on B means B is the prerequisite of A (B -> A), unlike A causes B.
 */
export function analyzeStoryStructure(
  nodes: readonly StoryCausalNode[],
  edges: readonly StoryCausalEdge[],
  states: readonly AudienceKnowledgeState[],
): StoryRuleAnalysis {
  const byNode = new Map(nodes.map((value) => [value.id, value]));
  const findings: StoryRuleFinding[] = [];
  const add = (
    code: StoryRuleFinding["code"],
    summary: string,
    advice: string,
    refs: Reference[],
  ) => {
    const records = [
      ...new Map(
        refs.map((value) => [`${value.kind}:${value.id}`, value]),
      ).values(),
    ].sort((a, b) => compare(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`));
    findings.push({
      id: createHash("sha256")
        .update(JSON.stringify({ code, records }))
        .digest("hex"),
      code,
      severity: "review",
      summary,
      advice,
      records,
    });
  };
  const nodeRefs = (...ids: string[]) =>
    ids.map((id) => {
      const value = byNode.get(id);
      if (!value) throw new Error("冻结规则图包含无法核对的节点引用。");
      return record("node", value);
    });
  const adjacency = new Map(nodes.map((value) => [value.id, [] as string[]]));
  const reverse = new Map(nodes.map((value) => [value.id, [] as string[]]));
  const causal: Array<{ from: string; to: string; edge: StoryCausalEdge }> = [];
  for (const value of [...edges].sort((a, b) => compare(a.id, b.id))) {
    const refs = [
      record("edge", value),
      ...nodeRefs(value.fromNodeId, value.toNodeId),
    ];
    if (value.relation === "conflicts_with")
      add(
        "declared-conflict",
        "作者已声明两个节点存在冲突关系。",
        "核对这条冻结关系的原说明与两个节点；可能是有意对立，不据此判定设定矛盾或文学质量不合格。",
        refs,
      );
    if (!["causes", "enables", "depends_on"].includes(value.relation)) continue;
    const from =
      value.relation === "depends_on" ? value.toNodeId : value.fromNodeId;
    const to =
      value.relation === "depends_on" ? value.fromNodeId : value.toNodeId;
    causal.push({ from, to, edge: value });
    adjacency.get(from)!.push(to);
    reverse.get(to)!.push(from);
    if (from === to)
      add(
        "self-causal-link",
        "冻结声明中存在自我因果／依赖连接。",
        "核对同一节点是否需要拆分为不同故事时点，或是否为作者有意闭环；不要自动删改原节点或关系。",
        refs,
      );
  }

  // Iterative Kosaraju: long novels must not exhaust the JavaScript call stack.
  const visited = new Set<string>(),
    finished: string[] = [];
  for (const id of [...byNode.keys()].sort(compare)) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!,
        next = adjacency.get(frame.id)!;
      if (frame.index < next.length) {
        const child = next[frame.index++]!;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push({ id: child, index: 0 });
        }
      } else {
        finished.push(frame.id);
        stack.pop();
      }
    }
  }
  const component = new Map<string, number>(),
    groups: string[][] = [];
  for (const id of finished.reverse()) {
    if (component.has(id)) continue;
    const index = groups.length,
      members: string[] = [],
      stack = [id];
    component.set(id, index);
    while (stack.length) {
      const current = stack.pop()!;
      members.push(current);
      for (const child of reverse.get(current)!)
        if (!component.has(child)) {
          component.set(child, index);
          stack.push(child);
        }
    }
    groups.push(members);
  }
  const componentEdges = new Map<number, StoryCausalEdge[]>();
  for (const value of causal) {
    const index = component.get(value.from)!;
    if (index === component.get(value.to)) {
      const group = componentEdges.get(index) ?? [];
      group.push(value.edge);
      componentEdges.set(index, group);
    }
  }
  for (const [index, members] of groups.entries()) {
    if (members.length < 2) continue;
    add(
      "causal-cycle",
      `冻结因果／依赖声明有 ${members.length} 个节点形成循环。`,
      "按导致／使之可能的起点→终点，以及依赖的终点→起点核对所列关系；可为有意时间闭环，不能直接判定叙事错误。",
      [
        ...members.map((id) => record("node", byNode.get(id)!)),
        ...(componentEdges.get(index) ?? []).map((value) =>
          record("edge", value),
        ),
      ],
    );
  }

  const tracks = new Map<string, AudienceKnowledgeState[]>();
  for (const value of states) {
    nodeRefs(value.knowledgeNodeId);
    if (value.subjectType === "character") nodeRefs(value.subjectId);
    const key = JSON.stringify([
      value.subjectType,
      value.subjectId,
      value.knowledgeNodeId,
    ]);
    const track = tracks.get(key) ?? [];
    track.push(value);
    tracks.set(key, track);
  }
  const rank = { unknown: 0, suspects: 1, misbelieves: 1, knows: 2 } as const;
  for (const track of tracks.values()) {
    const positions = new Map<number, AudienceKnowledgeState[]>();
    for (const value of track) {
      const group = positions.get(value.storyOrder) ?? [];
      group.push(value);
      positions.set(value.storyOrder, group);
    }
    const ordered = [...positions.entries()].sort(([a], [b]) => a - b);
    const refs = (values: AudienceKnowledgeState[]) => [
      ...values.map((value) => record("cognition", value)),
      ...nodeRefs(
        track[0]!.knowledgeNodeId,
        ...(track[0]!.subjectType === "character" ? [track[0]!.subjectId] : []),
      ),
    ];
    for (const [position, values] of ordered)
      if (new Set(values.map((value) => value.state)).size > 1)
        add(
          "cognition-order-conflict",
          `同一故事顺序 ${position} 存在不同认知状态声明。`,
          "核对同一主体／对象的实际声明及是否需要区分故事时点；不按记录 ID、创建时间或读取顺序擅自选择一个状态。",
          refs(values),
        );
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]![1],
        current = ordered[index]![1];
      if (
        new Set(previous.map((value) => value.state)).size !== 1 ||
        new Set(current.map((value) => value.state)).size !== 1
      )
        continue;
      if (rank[current[0]!.state] < rank[previous[0]!.state])
        add(
          "cognition-decrease",
          `认知声明从顺序 ${previous[0]!.storyOrder} 的 ${previous[0]!.state} 变为顺序 ${current[0]!.storyOrder} 的 ${current[0]!.state}。`,
          "阅读所列原声明的证据说明，核对有意失忆、误导或叙事变化；规则不理解解释是否充分，不判定回退错误。",
          refs([...previous, ...current]),
        );
    }
  }
  const incomingReveals = new Set(
    edges
      .filter((value) => value.relation === "reveals")
      .map((value) => value.toNodeId),
  );
  const knownByTarget = new Map<string, AudienceKnowledgeState[]>();
  for (const value of states)
    if (value.state === "knows") {
      const values = knownByTarget.get(value.knowledgeNodeId) ?? [];
      values.push(value);
      knownByTarget.set(value.knowledgeNodeId, values);
    }
  for (const secret of nodes.filter((value) => value.kind === "secret")) {
    const knowledge = knownByTarget.get(secret.id) ?? [];
    if (knowledge.length && !incomingReveals.has(secret.id))
      add(
        "secret-without-incoming-reveal",
        `秘密“${secret.title}”有知晓声明，但本快照无指向该秘密的揭示关系。`,
        "核对所列知晓说明与原故事；原文可能已有未建图的揭示，且图未声明揭示时点，不能据此判定提前泄露。",
        [
          record("node", secret),
          ...knowledge.map((value) => record("cognition", value)),
        ],
      );
  }
  return StoryRuleAnalysisSchema.parse({
    ruleSet: "story-structure-rules-v1",
    evidencePolicy: "frozen-author-declarations-not-semantic-proof",
    coverage: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      cognitionCount: states.length,
    },
    findings: findings.sort((a, b) =>
      compare(`${a.code}:${a.id}`, `${b.code}:${b.id}`),
    ),
  });
}
