import { describe, expect, it } from "vitest";
import type {
  StoryCausalNode,
  StoryCausalEdge,
  AudienceKnowledgeState,
} from "@dramaip/contracts";
import { analyzeStoryStructure } from "./story-rules.js";

const id = (index: number) =>
  `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const projectId = id(0),
  at = "2026-10-03T00:00:00.000Z";
const node = (
  index: number,
  kind: StoryCausalNode["kind"] = "event",
): StoryCausalNode => ({
  id: id(index),
  projectId,
  kind,
  title: `声明 ${index}`,
  summary: "作者声明，不是文学质量证明。",
  sourceType: "manual",
  sourceId: id(index),
  sourceVersion: 0,
  confirmed: true,
  version: index,
  createdAt: at,
  updatedAt: at,
});
const edge = (
  index: number,
  from: StoryCausalNode,
  to: StoryCausalNode,
  relation: StoryCausalEdge["relation"] = "causes",
): StoryCausalEdge => ({
  id: id(index),
  projectId,
  fromNodeId: from.id,
  toNodeId: to.id,
  relation,
  rationale: "作者意图可能为有意闭环。",
  confidence: 0.7,
  confirmed: true,
  version: index,
  createdAt: at,
  updatedAt: at,
});
const cognition = (
  index: number,
  target: StoryCausalNode,
  storyOrder: number,
  state: AudienceKnowledgeState["state"],
): AudienceKnowledgeState => ({
  id: id(index),
  projectId,
  subjectType: "audience",
  subjectId: "reader",
  knowledgeNodeId: target.id,
  storyOrder,
  state,
  evidence: "作者声明失忆；规则不能判断这段解释是否充分。",
  version: index,
  createdAt: at,
  updatedAt: at,
});
describe("frozen story structural rules, not semantic judgements", () => {
  it("uses prerequisite direction for depends_on and reports complete separate cycle components", () => {
    const a = node(1),
      b = node(2),
      c = node(3),
      d = node(4),
      detached = node(5);
    expect(
      analyzeStoryStructure(
        [a, b],
        [edge(11, a, b), edge(12, b, a, "depends_on")],
        [],
      ).findings,
    ).toEqual([]);
    const result = analyzeStoryStructure(
      [a, b, c, d, detached],
      [
        edge(11, a, b),
        edge(12, a, b, "depends_on"),
        edge(13, c, d),
        edge(14, d, c),
        edge(15, detached, a),
      ],
      [],
    );
    const cycles = result.findings.filter(
      (value) => value.code === "causal-cycle",
    );
    expect(cycles).toHaveLength(2);
    expect(
      cycles
        .flatMap((value) =>
          value.records
            .filter((ref) => ref.kind === "edge")
            .map((ref) => ref.id),
        )
        .sort(),
    ).toEqual([id(11), id(12), id(13), id(14)]);
    expect(
      cycles
        .flatMap((value) => value.records)
        .some((value) => value.id === detached.id),
    ).toBe(false);
    expect(
      cycles.every(
        (value) =>
          value.severity === "review" && value.advice.includes("不能直接判定"),
      ),
    ).toBe(true);
  });

  it("reports self causality and an explicit declared conflict with exact versions, not every self relation", () => {
    const a = node(1);
    const result = analyzeStoryStructure(
      [a],
      [
        edge(11, a, a),
        edge(12, a, a, "conflicts_with"),
        edge(13, a, a, "reveals"),
      ],
      [],
    );
    expect(result.findings.map((value) => value.code)).toEqual([
      "declared-conflict",
      "self-causal-link",
    ]);
    expect(
      result.findings.every((value) =>
        value.records.some(
          (ref) =>
            ref.kind === "node" && ref.id === a.id && ref.version === a.version,
        ),
      ),
    ).toBe(true);
    expect(
      result.findings
        .flatMap((value) => value.records)
        .some((value) => value.id === id(13)),
    ).toBe(false);
  });

  it("flags the actual decrease without denying its explanation and keeps subject/target tracks distinct", () => {
    const target = node(1),
      character = node(2, "character");
    const prior = cognition(11, target, 1, "knows"),
      later = cognition(12, target, 2, "unknown");
    const other: AudienceKnowledgeState = {
      ...cognition(13, target, 3, "knows"),
      subjectType: "character",
      subjectId: character.id,
    };
    const result = analyzeStoryStructure(
      [target, character],
      [],
      [other, later, prior],
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe("cognition-decrease");
    expect(result.findings[0]!.summary).not.toContain("无解释");
    expect(result.findings[0]!.advice).toContain("有意失忆");
    expect(
      result.findings[0]!.records.filter(
        (value) => value.kind === "cognition",
      ).map((value) => value.id),
    ).toEqual([prior.id, later.id]);
  });

  it("does not invent chronological order for tied inconsistent states, and duplicate same-state claims are not regressions", () => {
    const target = node(1),
      unknown = cognition(11, target, 0, "unknown"),
      knows = cognition(12, target, 0, "knows");
    const values = [unknown, knows, cognition(13, target, 1, "unknown")];
    const result = analyzeStoryStructure([target], [], values);
    expect(result.findings.map((value) => value.code)).toEqual([
      "cognition-order-conflict",
    ]);
    expect(analyzeStoryStructure([target], [], [...values].reverse())).toEqual(
      result,
    );
    expect(
      analyzeStoryStructure([target], [], [unknown, { ...unknown, id: id(14) }])
        .findings,
    ).toEqual([]);
  });

  it("requires a reveal into the secret, without claiming leak timing or treating absence as original-text proof", () => {
    const secret = node(1, "secret"),
      event = node(2),
      knows = cognition(11, secret, 0, "knows");
    const result = analyzeStoryStructure(
      [secret, event],
      [edge(12, secret, event, "reveals")],
      [knows],
    );
    expect(result.findings[0]!.code).toBe("secret-without-incoming-reveal");
    expect(result.findings[0]!.records.map((value) => value.id).sort()).toEqual(
      [secret.id, knows.id].sort(),
    );
    expect(result.findings[0]!.advice).toContain("不能据此判定提前泄露");
    expect(
      analyzeStoryStructure(
        [secret, event],
        [edge(12, event, secret, "reveals")],
        [knows],
      ).findings,
    ).toEqual([]);
  });

  it("keeps findings deterministic across row order and does not mutate the frozen graph", () => {
    const a = node(1),
      b = node(2),
      nodes = [a, b],
      edges = [
        edge(11, a, b),
        edge(12, b, a),
        edge(13, a, b, "conflicts_with"),
      ];
    const states = [
      cognition(21, a, 0, "knows"),
      cognition(22, a, 1, "unknown"),
    ];
    const before = JSON.stringify({ nodes, edges, states });
    const result = analyzeStoryStructure(nodes, edges, states);
    expect(
      analyzeStoryStructure(
        [...nodes].reverse(),
        [...edges].reverse(),
        [...states].reverse(),
      ),
    ).toEqual(result);
    expect(JSON.stringify({ nodes, edges, states })).toBe(before);
    expect(result.evidencePolicy).toBe(
      "frozen-author-declarations-not-semantic-proof",
    );
    expect(result.coverage).toEqual({
      nodeCount: 2,
      edgeCount: 3,
      cognitionCount: 2,
    });
  });

  it("handles ten thousand nodes and retains every actual cycle witness without recursive stack limits or truncation", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => node(index + 1));
    const edges = nodes
      .slice(1)
      .map((value, index) => edge(index + 20_000, nodes[index]!, value));
    expect(analyzeStoryStructure(nodes, edges, []).findings).toEqual([]);
    edges.push(edge(40_000, nodes[nodes.length - 1]!, nodes[0]!));
    const result = analyzeStoryStructure(nodes, edges, []);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.records).toHaveLength(20_000);
    expect(result.coverage.nodeCount).toBe(10_000);
  });

  it("refuses a dangling reference instead of manufacturing a complete-looking rule result", () => {
    const a = node(1),
      missing = node(2);
    expect(() =>
      analyzeStoryStructure([a], [edge(11, a, missing)], []),
    ).toThrow("无法核对");
  });
});
