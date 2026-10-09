import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type {
  StoryCausalNode,
  IPTwinSnapshot,
  ScenarioRun,
} from "@dramaip/contracts/creative-intelligence";

const projectId = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "10000000-0000-4000-8000-000000000003";
const runId = "10000000-0000-4000-8000-000000000004";
const at = "2026-10-03T00:00:00.000Z";
const node: StoryCausalNode = {
  id,
  projectId,
  kind: "event",
  title: "手工声明",
  summary: "不是原文核验",
  sourceType: "manual",
  sourceId: id,
  sourceVersion: 0,
  confirmed: true,
  version: 0,
  createdAt: at,
  updatedAt: at,
};
const snapshot: IPTwinSnapshot = {
  id,
  projectId,
  sourceFingerprint: "a".repeat(64),
  stale: false,
  nodes: [node],
  edges: [],
  audienceStates: [],
  conflicts: [],
  createdAt: at,
};
const simulation: ScenarioRun = {
  id: runId,
  projectId,
  snapshotId: id,
  hypothesis: "人工假设",
  status: "preview",
  deterministicFindings: ["仅规则检查"],
  modelInferences: [],
  affectedNodeIds: [],
  version: 0,
  createdAt: at,
  updatedAt: at,
};
function client(respond: (request: Request) => Response | Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  }).storyIntelligence;
}
test("story SDK restores exact original snapshot and simulation by scoped read routes without writes or latest substitution", async () => {
  const calls: Request[] = [];
  const sdk = client((request) => {
    calls.push(request);
    return Response.json(
      request.url.includes("/ip-twins/")
        ? { ...snapshot, stale: true }
        : simulation,
    );
  });
  expect(await sdk.getTwin(projectId, id)).toEqual({
    ...snapshot,
    stale: true,
  });
  expect(await sdk.getSimulation(projectId, runId)).toEqual(simulation);
  expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  expect(calls[0]!.url).toEndWith(`/projects/${projectId}/ip-twins/${id}`);
  expect(calls[1]!.url).toEndWith(
    `/projects/${projectId}/story-simulations/${runId}`,
  );
  expect(calls.every((call) => call.body === null)).toBe(true);
});
test("story SDK rejects foreign/other-id snapshots, candidates, dangling relations and foreign cognition", async () => {
  for (const raw of [
    { ...snapshot, id: other },
    { ...snapshot, projectId: other },
    { ...snapshot, nodes: [{ ...node, confirmed: false }] },
    { ...snapshot, nodes: [{ ...node, projectId: other }] },
    { ...snapshot, nodes: [node, node] },
    {
      ...snapshot,
      edges: [
        {
          id: other,
          projectId,
          fromNodeId: id,
          toNodeId: other,
          relation: "causes",
          rationale: "悬空",
          confidence: 1,
          confirmed: true,
          version: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
    },
    {
      ...snapshot,
      audienceStates: [
        {
          id: other,
          projectId,
          subjectType: "character",
          subjectId: other,
          knowledgeNodeId: id,
          storyOrder: 0,
          state: "knows",
          evidence: "不同项目",
          version: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
    },
  ])
    await expect(
      client(() => Response.json(raw)).getTwin(projectId, id),
    ).rejects.toThrow();
  for (const raw of [
    { ...simulation, id: other },
    { ...simulation, projectId: other },
  ])
    await expect(
      client(() => Response.json(raw)).getSimulation(projectId, runId),
    ).rejects.toThrow();
});
test("story SDK keeps declared candidates visible in own graph but rejects cross-project or dangling graph data", async () => {
  expect(
    (
      await client(() =>
        Response.json({
          nodes: [{ ...node, confirmed: false }],
          edges: [],
          audienceStates: [],
        }),
      ).graph(projectId)
    ).nodes[0]!.confirmed,
  ).toBe(false);
  for (const nodes of [[{ ...node, projectId: other }], [node, node]])
    await expect(
      client(() =>
        Response.json({ nodes, edges: [], audienceStates: [] }),
      ).graph(projectId),
    ).rejects.toThrow();
});
test("story SDK does not auto-build a snapshot during simulation and preserves supplied same-request keys", async () => {
  const calls: Array<{ request: Request; body: unknown }> = [];
  const sdk = client(async (request) => {
    calls.push({ request, body: await request.json() });
    return Response.json(simulation);
  });
  expect(
    await sdk.createSimulation(
      projectId,
      { snapshotId: id, hypothesis: simulation.hypothesis },
      "same-request",
    ),
  ).toEqual(simulation);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.request.url).toEndWith(
    `/projects/${projectId}/story-simulations`,
  );
  expect(calls[0]!.request.headers.get("Idempotency-Key")).toBe("same-request");
  expect(calls[0]!.body).toEqual({
    snapshotId: id,
    hypothesis: simulation.hypothesis,
  });
  for (const raw of [
    { ...simulation, snapshotId: other },
    { ...simulation, hypothesis: "其他假设" },
  ])
    await expect(
      client(() => Response.json(raw)).createSimulation(projectId, {
        snapshotId: id,
        hypothesis: simulation.hypothesis,
      }),
    ).rejects.toThrow();
});

test("story SDK accepts exact frozen rule locations and does not fill missing historical analysis", async () => {
  const raw: IPTwinSnapshot = {
    ...snapshot,
    conflicts: ["原声明待复核"],
    ruleAnalysis: {
      ruleSet: "story-structure-rules-v1",
      evidencePolicy: "frozen-author-declarations-not-semantic-proof",
      coverage: { nodeCount: 1, edgeCount: 0, cognitionCount: 0 },
      findings: [
        {
          id: "b".repeat(64),
          code: "self-causal-link",
          severity: "review",
          summary: "原声明待复核",
          advice: "人工核对，不判定质量。",
          records: [{ kind: "node", id, version: 0 }],
        },
      ],
    },
  };
  expect(await client(() => Response.json(raw)).getTwin(projectId, id)).toEqual(
    raw,
  );
  expect(
    await client(() => Response.json(snapshot)).getTwin(projectId, id),
  ).not.toHaveProperty("ruleAnalysis");
  const analysis = raw.ruleAnalysis!,
    finding = analysis.findings[0]!;
  for (const ruleAnalysis of [
    { ...analysis, coverage: { ...analysis.coverage, nodeCount: 2 } },
    {
      ...analysis,
      findings: [
        { ...finding, records: [{ kind: "node", id: other, version: 0 }] },
      ],
    },
    {
      ...analysis,
      findings: [{ ...finding, records: [{ kind: "node", id, version: 1 }] }],
    },
    {
      ...analysis,
      findings: [{ ...finding, records: [{ kind: "edge", id, version: 0 }] }],
    },
    {
      ...analysis,
      findings: [
        { ...finding, records: [...finding.records, ...finding.records] },
      ],
    },
    { ...analysis, findings: [finding, finding] },
    { ...analysis, findings: [{ ...finding, summary: "另一提示" }] },
    { ...analysis, evidencePolicy: "semantic-quality-proven" },
  ])
    await expect(
      client(() => Response.json({ ...raw, ruleAnalysis })).getTwin(
        projectId,
        id,
      ),
    ).rejects.toThrow();
});
