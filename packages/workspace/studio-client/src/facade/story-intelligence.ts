import {
  AudienceKnowledgeStateSchema,
  IPTwinSnapshotSchema,
  OriginalityRiskSchema,
  ScenarioRunSchema,
  StoryCausalEdgeSchema,
  StoryCausalNodeSchema,
} from "@dramaip/contracts";
import type { StudioClient as BaseClient } from "./generated.js";

export function createStoryIntelligenceClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}`;
  const own = <T extends { projectId: string }>(
    value: T,
    projectId: string,
  ): T => {
    if (value.projectId !== projectId)
      throw new Error("故事声明返回了其他项目的数据，已拒绝使用。");
    return value;
  };
  const snapshot = (raw: unknown, projectId: string, id?: string) => {
    const value = own(IPTwinSnapshotSchema.strict().parse(raw), projectId);
    const ids = new Set(value.nodes.map((node) => node.id));
    if (
      (id && value.id !== id) ||
      ids.size !== value.nodes.length ||
      new Set(value.edges.map((edge) => edge.id)).size !== value.edges.length ||
      new Set(value.audienceStates.map((state) => state.id)).size !==
        value.audienceStates.length ||
      value.nodes.some(
        (node) => node.projectId !== projectId || !node.confirmed,
      ) ||
      value.edges.some(
        (edge) =>
          edge.projectId !== projectId ||
          !edge.confirmed ||
          !ids.has(edge.fromNodeId) ||
          !ids.has(edge.toNodeId),
      ) ||
      value.audienceStates.some(
        (state) =>
          state.projectId !== projectId ||
          !ids.has(state.knowledgeNodeId) ||
          (state.subjectType === "character" &&
            !value.nodes.some(
              (node) =>
                node.id === state.subjectId && node.kind === "character",
            )),
      )
    )
      throw new Error("原故事声明快照身份或确认边界无法核对。");
    if (value.ruleAnalysis) {
      const analysis = value.ruleAnalysis;
      const records = {
        node: new Map(value.nodes.map((item) => [item.id, item.version])),
        edge: new Map(value.edges.map((item) => [item.id, item.version])),
        cognition: new Map(
          value.audienceStates.map((item) => [item.id, item.version]),
        ),
      };
      if (
        analysis.coverage.nodeCount !== value.nodes.length ||
        analysis.coverage.edgeCount !== value.edges.length ||
        analysis.coverage.cognitionCount !== value.audienceStates.length ||
        new Set(analysis.findings.map((finding) => finding.id)).size !==
          analysis.findings.length ||
        JSON.stringify(value.conflicts) !==
          JSON.stringify(analysis.findings.map((finding) => finding.summary)) ||
        analysis.findings.some(
          (finding) =>
            new Set(finding.records.map((item) => `${item.kind}:${item.id}`))
              .size !== finding.records.length ||
            finding.records.some(
              (item) => records[item.kind].get(item.id) !== item.version,
            ),
        )
      )
        throw new Error(
          "规则定位与原冻结记录／版本或覆盖无法核对，不使用错配提示。",
        );
    }
    return value;
  };
  const post = (
    body?: unknown,
    key: string = crypto.randomUUID(),
  ): RequestInit => {
    if (!key.trim() || key.length > 200)
      throw new Error("须提供同次声明请求键。");
    return {
      method: "POST",
      headers: { "Idempotency-Key": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  };
  return {
    graph: async (projectId: string) => {
      const raw = await request<
        Awaited<ReturnType<BaseClient["storyIntelligence"]["graph"]>>
      >(`${path(projectId)}/story-graph`);
      const nodes = raw.nodes.map((value) =>
        own(StoryCausalNodeSchema.strict().parse(value), projectId),
      );
      const edges = raw.edges.map((value) =>
        own(StoryCausalEdgeSchema.strict().parse(value), projectId),
      );
      const audienceStates = raw.audienceStates.map((value) =>
        own(AudienceKnowledgeStateSchema.strict().parse(value), projectId),
      );
      const ids = new Set(nodes.map((value) => value.id));
      if (
        ids.size !== nodes.length ||
        edges.some(
          (value) => !ids.has(value.fromNodeId) || !ids.has(value.toNodeId),
        ) ||
        audienceStates.some(
          (value) =>
            !ids.has(value.knowledgeNodeId) ||
            (value.subjectType === "character" &&
              !nodes.some(
                (node) =>
                  node.id === value.subjectId && node.kind === "character",
              )),
        )
      )
        throw new Error("实际故事声明图的节点归属无法核对。");
      return { nodes, edges, audienceStates };
    },
    createNode: async (
      projectId: string,
      input: Parameters<BaseClient["storyIntelligence"]["createNode"]>[1],
      key?: string,
    ) =>
      own(
        StoryCausalNodeSchema.strict().parse(
          await request(
            `${path(projectId)}/story-graph/nodes`,
            post(input, key),
          ),
        ),
        projectId,
      ),
    createEdge: async (
      projectId: string,
      input: Parameters<BaseClient["storyIntelligence"]["createEdge"]>[1],
      key?: string,
    ) =>
      own(
        StoryCausalEdgeSchema.strict().parse(
          await request(
            `${path(projectId)}/story-graph/edges`,
            post(input, key),
          ),
        ),
        projectId,
      ),
    createAudienceState: async (
      projectId: string,
      input: Parameters<
        BaseClient["storyIntelligence"]["createAudienceState"]
      >[1],
      key?: string,
    ) =>
      own(
        AudienceKnowledgeStateSchema.strict().parse(
          await request(
            `${path(projectId)}/audience-knowledge`,
            post(input, key),
          ),
        ),
        projectId,
      ),
    buildTwin: async (projectId: string, key?: string) =>
      snapshot(
        await request(`${path(projectId)}/ip-twin`, post(undefined, key)),
        projectId,
      ),
    getTwin: async (projectId: string, snapshotId: string) =>
      snapshot(
        await request(
          `${path(projectId)}/ip-twins/${encodeURIComponent(snapshotId)}`,
        ),
        projectId,
        snapshotId,
      ),
    createSimulation: async (
      projectId: string,
      input: { snapshotId: string; hypothesis: string },
      key?: string,
    ) => {
      const value = own(
        ScenarioRunSchema.strict().parse(
          await request(
            `${path(projectId)}/story-simulations`,
            post(input, key),
          ),
        ),
        projectId,
      );
      if (
        value.snapshotId !== input.snapshotId ||
        value.hypothesis !== input.hypothesis.trim()
      )
        throw new Error("实际推演回执与原声明快照或假设不一致。");
      return value;
    },
    getSimulation: async (projectId: string, simulationId: string) => {
      const value = own(
        ScenarioRunSchema.strict().parse(
          await request(
            `${path(projectId)}/story-simulations/${encodeURIComponent(simulationId)}`,
          ),
        ),
        projectId,
      );
      if (value.id !== simulationId)
        throw new Error("实际推演返回了其他结果，已拒绝使用。");
      return value;
    },
    originalityRisks: async (projectId: string) => {
      const raw = await request<{ items: unknown[] }>(
        `${path(projectId)}/originality-risks`,
      );
      return raw.items.map((value) =>
        own(OriginalityRiskSchema.strict().parse(value), projectId),
      );
    },
  };
}
export type StoryIntelligenceClient = ReturnType<
  typeof createStoryIntelligenceClient
>;
