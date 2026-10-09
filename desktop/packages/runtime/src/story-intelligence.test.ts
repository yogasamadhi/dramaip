import { afterEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { workspacePlugin } from "@dramaip/workspace";
import { writingPlugin } from "@dramaip/writing";
import { knowledgePlugin } from "@dramaip/knowledge";
import {
  ProjectInputSchema,
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import type { IPTwinSnapshot, StoryCausalNode } from "@dramaip/contracts";
import type { RouteContribution } from "@dramaip/plugin-api/internal";
import { DomainEventSchemaRegistry } from "@dramaip/events";
import {
  DOMAIN_EVENT_MANIFEST,
  DOMAIN_EVENT_PATTERNS,
} from "./event-manifest.generated.js";
import { mountTestPlugin } from "./plugin-test-fixture.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database.sqlite, [
    ...(foundationPlugin.migrations ?? []),
    ...(workspacePlugin.migrations ?? []),
    ...(writingPlugin.migrations ?? []),
    ...(knowledgePlugin.migrations ?? []),
  ]);
  const eventSchemas = new DomainEventSchemaRegistry(
    DOMAIN_EVENT_MANIFEST,
    DOMAIN_EVENT_PATTERNS,
  );
  database.uow.setEventValidator((event) => eventSchemas.validate(event));
  const routes: RouteContribution[] = [];
  const services = {
    uow: database.uow,
    http: {
      routeIds: [],
      register: (route: RouteContribution) => {
        routes.push(route);
        return () => undefined;
      },
    },
  };
  const workspace = await mountTestPlugin(workspacePlugin, services);
  const projects = workspace.get(
    WORKSPACE_PROJECT_SERVICE.id,
  ) as WorkspaceProjectService;
  const knowledge = await mountTestPlugin(knowledgePlugin, services, {
    [WORKSPACE_PROJECT_SERVICE.id]: projects,
    // This fixture tests graph declarations, not novel evidence compilation.
    // No chapter source is fabricated or read by these graph requests.
    [WRITING_CHAPTER_SERVICE.id]: { get: () => undefined, list: () => [] },
  });
  cleanups.push(async () => {
    await knowledge.fiber.dispose();
    await workspace.fiber.dispose();
    database.close();
  });
  const project = projects.create(
    ProjectInputSchema.parse({ title: "实际本机认知图" }),
  );
  const other = projects.create(
    ProjectInputSchema.parse({ title: "不同项目" }),
  );
  const app = new OpenAPIHono();
  for (const route of routes) {
    const register = app.openapi as unknown as (
      declaration: unknown,
      handler: (...args: never[]) => unknown,
    ) => void;
    register.call(app, route.declaration, route.handler);
  }
  const post = (projectId: string, path: string, body?: unknown) =>
    app.request(`/api/v2/projects/${projectId}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const node = async (projectId: string, confirmed = true, kind = "event") => {
    const response = await post(projectId, "story-graph/nodes", {
      kind,
      title: `人工声明 ${kind} ${crypto.randomUUID()}`,
      summary: "人工声明，不作为小说原文已核验事实。",
      sourceType: "manual",
      sourceId: crypto.randomUUID(),
      sourceVersion: 0,
      confirmed,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()) as StoryCausalNode;
  };
  const counts = () => ({
    records: Object.fromEntries(
      [
        "knowledge_causal_nodes",
        "knowledge_causal_edges",
        "knowledge_audience_states",
        "knowledge_ip_twin_snapshots",
        "knowledge_scenario_runs",
        "domain_events",
      ].map((table) => [
        table,
        (
          database.sqlite
            .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
            .get() as { count: number }
        ).count,
      ]),
    ),
    snapshots: database.sqlite
      .prepare(
        "SELECT id, snapshot_json FROM knowledge_ip_twin_snapshots ORDER BY id",
      )
      .all(),
  });
  const events = () =>
    database.sqlite
      .prepare(
        "SELECT type, payload_json FROM domain_events WHERE plugin_id = 'knowledge' ORDER BY cursor",
      )
      .all() as Array<{ type: string; payload_json: string }>;
  const failEvents = (enabled: boolean) => {
    database.sqlite.exec(
      "DROP TRIGGER IF EXISTS controlled_story_event_failure",
    );
    if (enabled)
      database.sqlite.exec(
        "CREATE TEMP TRIGGER controlled_story_event_failure BEFORE INSERT ON domain_events WHEN NEW.plugin_id = 'knowledge' BEGIN SELECT RAISE(ABORT, 'controlled story event failure'); END",
      );
  };
  const historicalSnapshot = (id: string) => {
    const row = database.sqlite
      .prepare(
        "SELECT snapshot_json FROM knowledge_ip_twin_snapshots WHERE id = ?",
      )
      .get(id) as { snapshot_json: string };
    const value = JSON.parse(row.snapshot_json) as IPTwinSnapshot;
    delete value.ruleAnalysis;
    value.conflicts = ["历史文本规则，不回填新版定位。"];
    database.sqlite
      .prepare(
        "UPDATE knowledge_ip_twin_snapshots SET snapshot_json = ? WHERE id = ?",
      )
      .run(JSON.stringify(value), id);
    return value;
  };
  return {
    app,
    post,
    node,
    project,
    other,
    counts,
    events,
    failEvents,
    historicalSnapshot,
  };
}

describe("actual story intelligence project and declared-candidate boundaries", () => {
  it("does not return a valid empty graph for a nonexistent project", async () => {
    const f = await fixture(),
      before = f.counts();
    const response = await f.app.request(
      `/api/v2/projects/${crypto.randomUUID()}/story-graph`,
    );
    expect(response.status).toBe(404);
    expect(f.counts()).toEqual(before);
  });

  it("rejects a cross-project causal endpoint before inserting or staling a snapshot", async () => {
    const f = await fixture();
    const own = await f.node(f.project.id),
      foreign = await f.node(f.other.id);
    await f.post(f.project.id, "ip-twin");
    const before = f.counts();
    const response = await f.post(f.project.id, "story-graph/edges", {
      fromNodeId: own.id,
      toNodeId: foreign.id,
      relation: "causes",
      rationale: "外项目节点不可替代当前来源。",
      confidence: 1,
      confirmed: true,
    });
    expect(response.status).toBe(404);
    expect(f.counts()).toEqual(before);
  });

  it("rejects a cross-project knowledge target and a foreign character subject", async () => {
    const f = await fixture();
    const own = await f.node(f.project.id),
      foreign = await f.node(f.other.id, true, "character");
    const before = f.counts();
    for (const [subjectId, knowledgeNodeId] of [
      ["reader", foreign.id],
      [foreign.id, own.id],
    ]) {
      const response = await f.post(f.project.id, "audience-knowledge", {
        subjectType: subjectId === "reader" ? "audience" : "character",
        subjectId,
        knowledgeNodeId,
        storyOrder: 0,
        state: "knows",
        evidence: "人工说明。",
      });
      expect(response.status).toBe(404);
      expect(f.counts()).toEqual(before);
    }
  });

  it("refuses confirmed relations to unconfirmed candidate nodes without promoting either candidate", async () => {
    const f = await fixture();
    const candidate = await f.node(f.project.id, false),
      own = await f.node(f.project.id);
    const before = f.counts();
    const response = await f.post(f.project.id, "story-graph/edges", {
      fromNodeId: own.id,
      toNodeId: candidate.id,
      relation: "causes",
      rationale: "候选仍然未经作者确认。",
      confidence: 1,
      confirmed: true,
    });
    expect(response.status).toBe(409);
    expect(f.counts()).toEqual(before);
  });

  it("keeps unconfirmed nodes and relationships out of a confirmed snapshot", async () => {
    const f = await fixture();
    const own = await f.node(f.project.id),
      candidate = await f.node(f.project.id, false);
    const edge = await f.post(f.project.id, "story-graph/edges", {
      fromNodeId: own.id,
      toNodeId: candidate.id,
      relation: "causes",
      rationale: "只是待核对候选。",
      confidence: 0.5,
      confirmed: false,
    });
    expect(edge.status).toBe(201);
    const response = await f.post(f.project.id, "ip-twin");
    expect(response.status).toBe(200);
    const twin = (await response.json()) as IPTwinSnapshot;
    expect(twin.nodes.map((item) => item.id)).toEqual([own.id]);
    expect(twin.edges).toEqual([]);
    const graph = (await (
      await f.app.request(`/api/v2/projects/${f.project.id}/story-graph`)
    ).json()) as { nodes: StoryCausalNode[] };
    expect(graph.nodes).toHaveLength(2);
    expect(
      graph.nodes.find((item) => item.id === candidate.id)?.confirmed,
    ).toBe(false);
  });

  it("does not create a simulation from a snapshot explicitly invalidated by a later graph change", async () => {
    const f = await fixture();
    await f.node(f.project.id);
    const twin = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    await f.node(f.project.id);
    const before = f.counts();
    const response = await f.post(f.project.id, "story-simulations", {
      snapshotId: twin.id,
      hypothesis: "明确要求沿原快照推演，不能自动換成最新。",
    });
    expect(response.status).toBe(409);
    expect(f.counts()).toEqual(before);
  });

  it("returns structured not-found for nonexistent-project declarations, snapshots and simulations without allocating", async () => {
    const f = await fixture(),
      before = f.counts(),
      missing = crypto.randomUUID();
    for (const [path, input] of [
      [
        "story-graph/nodes",
        {
          kind: "event",
          title: "不落库",
          summary: "",
          sourceType: "manual",
          sourceId: "declaration",
          sourceVersion: 0,
          confirmed: false,
        },
      ],
      ["ip-twin", undefined],
      [
        "story-simulations",
        { snapshotId: crypto.randomUUID(), hypothesis: "不可编造空项目" },
      ],
    ] as const) {
      const response = await f.post(missing, path, input);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      expect(f.counts()).toEqual(before);
    }
  });

  it("requires an actual same-project character and confirmed target before saving cognition; unknown and supported manual declarations stay distinct", async () => {
    const f = await fixture(),
      knowledge = await f.node(f.project.id),
      character = await f.node(f.project.id, true, "character"),
      candidate = await f.node(f.project.id, false);
    const before = f.counts();
    for (const input of [
      {
        subjectType: "character",
        subjectId: knowledge.id,
        knowledgeNodeId: knowledge.id,
        evidence: "错类型主体。",
      },
      {
        subjectType: "character",
        subjectId: crypto.randomUUID(),
        knowledgeNodeId: knowledge.id,
        evidence: "缺失主体。",
      },
      {
        subjectType: "audience",
        subjectId: "reader",
        knowledgeNodeId: candidate.id,
        evidence: "不能提升候选。",
      },
      {
        subjectType: "character",
        subjectId: character.id,
        knowledgeNodeId: knowledge.id,
        evidence: "   ",
      },
    ]) {
      const response = await f.post(f.project.id, "audience-knowledge", {
        storyOrder: 0,
        state: "knows",
        ...input,
      });
      expect([404, 409]).toContain(response.status);
      expect(f.counts()).toEqual(before);
    }
    for (const [state, evidence, storyOrder] of [
      ["unknown", "", 0],
      ["knows", "作者独立人工说明，不代表原文引用已核验。", 1],
    ] as const) {
      const response = await f.post(f.project.id, "audience-knowledge", {
        subjectType: "character",
        subjectId: character.id,
        knowledgeNodeId: knowledge.id,
        storyOrder,
        state,
        evidence,
      });
      expect(response.status).toBe(201);
    }
    const twin = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    expect(twin.audienceStates.map((item) => item.state)).toEqual([
      "unknown",
      "knows",
    ]);
    expect(twin.nodes.some((item) => item.id === candidate.id)).toBe(false);
  });

  it("keeps graph writes and metadata-only owner events atomic, including snapshot invalidation", async () => {
    const f = await fixture();
    await f.node(f.project.id);
    await f.post(f.project.id, "ip-twin");
    const before = f.counts();
    f.failEvents(true);
    const response = await f.post(f.project.id, "story-graph/nodes", {
      kind: "event",
      title: "不得部分落库",
      summary: "只在实际回滚夹具中使用。",
      sourceType: "manual",
      sourceId: "declaration",
      sourceVersion: 0,
      confirmed: false,
    });
    expect(response.status).toBe(500);
    f.failEvents(false);
    expect(f.counts()).toEqual(before);
    expect(f.events().map((item) => item.type)).toEqual([
      "knowledge.story-node-created.v1",
      "knowledge.ip-twin-created.v1",
    ]);
    for (const entry of f.events()) {
      const payload = JSON.parse(entry.payload_json);
      expect(payload.projectId).toBe(f.project.id);
      expect(payload).not.toHaveProperty("summary");
      expect(payload).not.toHaveProperty("evidence");
    }
  });

  it("retrieves exact project-bound snapshots and simulations without allocating or switching to latest", async () => {
    const f = await fixture();
    const own = await f.node(f.project.id);
    const snapshot = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    const response = await f.post(f.project.id, "story-simulations", {
      snapshotId: snapshot.id,
      hypothesis: `如果 ${own.title} 提前发生`,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const simulation = await response.json();
    const before = f.counts();
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/ip-twins/${snapshot.id}`,
        )
      ).json(),
    ).toEqual(snapshot);
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/story-simulations/${simulation.id}`,
        )
      ).json(),
    ).toEqual(simulation);
    for (const suffix of [
      `ip-twins/${snapshot.id}`,
      `story-simulations/${simulation.id}`,
    ]) {
      expect(
        (await f.app.request(`/api/v2/projects/${f.other.id}/${suffix}`))
          .status,
      ).toBe(404);
      expect(
        (
          await f.app.request(
            `/api/v2/projects/${crypto.randomUUID()}/${suffix}`,
          )
        ).status,
      ).toBe(404);
    }
    expect(f.counts()).toEqual(before);
    await f.node(f.project.id);
    const afterChange = f.counts();
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/ip-twins/${snapshot.id}`,
        )
      ).json(),
    ).toEqual({ ...snapshot, stale: true });
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/story-simulations/${simulation.id}`,
        )
      ).json(),
    ).toEqual(simulation);
    expect(f.counts()).toEqual(afterChange);
    const event = f
      .events()
      .find((item) => item.type === "knowledge.story-simulation-created.v1")!;
    expect(JSON.parse(event.payload_json)).toEqual({
      id: simulation.id,
      projectId: f.project.id,
      snapshotId: snapshot.id,
      version: 0,
      status: "preview",
    });
  });

  it("rolls back the entire simulation when its metadata owner event cannot be appended", async () => {
    const f = await fixture();
    await f.node(f.project.id);
    const snapshot = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    const before = f.counts();
    f.failEvents(true);
    expect(
      (
        await f.post(f.project.id, "story-simulations", {
          snapshotId: snapshot.id,
          hypothesis: "回滚不留下推演或正文事件",
        })
      ).status,
    ).toBe(500);
    f.failEvents(false);
    expect(f.counts()).toEqual(before);
  });

  it("does not mistake causes plus its equivalent dependency declaration for a causal loop", async () => {
    const f = await fixture();
    const cause = await f.node(f.project.id),
      effect = await f.node(f.project.id);
    for (const [fromNodeId, toNodeId, relation] of [
      [cause.id, effect.id, "causes"],
      [effect.id, cause.id, "depends_on"],
    ]) {
      expect(
        (
          await f.post(f.project.id, "story-graph/edges", {
            fromNodeId,
            toNodeId,
            relation,
            rationale: "结果依赖原因，不是时间闭环。",
            confidence: 1,
            confirmed: true,
          })
        ).status,
      ).toBe(201);
    }
    const twin = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    expect(twin.conflicts.some((value) => value.includes("循环"))).toBe(false);
  });

  it("does not claim a cognition decrease has no explanation when the actual declaration contains one", async () => {
    const f = await fixture();
    const target = await f.node(f.project.id);
    for (const [storyOrder, state, evidence] of [
      [1, "knows", "作者声明此前已经获知。"],
      [2, "unknown", "作者声明角色此处失忆，此为有意回退。"],
    ]) {
      expect(
        (
          await f.post(f.project.id, "audience-knowledge", {
            subjectType: "audience",
            subjectId: "reader",
            knowledgeNodeId: target.id,
            storyOrder,
            state,
            evidence,
          })
        ).status,
      ).toBe(201);
    }
    const twin = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    expect(twin.conflicts.some((value) => value.includes("无解释"))).toBe(
      false,
    );
  });

  it("does not treat a secret revealing another event as evidence that this secret was revealed", async () => {
    const f = await fixture();
    const secret = await f.node(f.project.id, true, "secret"),
      event = await f.node(f.project.id);
    expect(
      (
        await f.post(f.project.id, "story-graph/edges", {
          fromNodeId: secret.id,
          toNodeId: event.id,
          relation: "reveals",
          rationale: "秘密提示另一事件，不表示此秘密已经被揭示。",
          confidence: 1,
          confirmed: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await f.post(f.project.id, "audience-knowledge", {
          subjectType: "audience",
          subjectId: "reader",
          knowledgeNodeId: secret.id,
          storyOrder: 0,
          state: "knows",
          evidence: "作者声明读者知晓。",
        })
      ).status,
    ).toBe(201);
    const twin = (await (
      await f.post(f.project.id, "ip-twin")
    ).json()) as IPTwinSnapshot;
    expect(twin.conflicts.some((value) => value.includes(secret.title))).toBe(
      true,
    );
  });

  it("returns a structured conflict for an occupied cognition position without overwriting or staling records", async () => {
    const f = await fixture();
    const target = await f.node(f.project.id);
    expect(
      (
        await f.post(f.project.id, "audience-knowledge", {
          subjectType: "audience",
          subjectId: "reader",
          knowledgeNodeId: target.id,
          storyOrder: 1,
          state: "unknown",
          evidence: "先前作者声明。",
        })
      ).status,
    ).toBe(201);
    await f.post(f.project.id, "ip-twin");
    const before = f.counts();
    const response = await f.post(f.project.id, "audience-knowledge", {
      subjectType: "audience",
      subjectId: "reader",
      knowledgeNodeId: target.id,
      storyOrder: 1,
      state: "knows",
      evidence: "新声明不能擅自替换。",
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(f.counts()).toEqual(before);
  });

  it("keeps an occupied relationship and its snapshot untouched when a new action tries to duplicate it", async () => {
    const f = await fixture();
    const from = await f.node(f.project.id),
      to = await f.node(f.project.id);
    const input = {
      fromNodeId: from.id,
      toNodeId: to.id,
      relation: "causes",
      rationale: "原关系说明。",
      confidence: 1,
      confirmed: true,
    };
    expect(
      (await f.post(f.project.id, "story-graph/edges", input)).status,
    ).toBe(201);
    await f.post(f.project.id, "ip-twin");
    const before = f.counts();
    const response = await f.post(f.project.id, "story-graph/edges", {
      ...input,
      rationale: "不允许覆盖原说明。",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(f.counts()).toEqual(before);
  });

  it("freezes located rule evidence in the original snapshot, while historical text-only snapshots never get upgraded by a read", async () => {
    const f = await fixture();
    const secret = await f.node(f.project.id, true, "secret"),
      event = await f.node(f.project.id);
    for (const [fromNodeId, toNodeId, relation] of [
      [event.id, secret.id, "causes"],
      [secret.id, event.id, "causes"],
      [event.id, secret.id, "conflicts_with"],
    ])
      expect(
        (
          await f.post(f.project.id, "story-graph/edges", {
            fromNodeId,
            toNodeId,
            relation,
            rationale: "声明不代表矛盾已核验。",
            confidence: 0.7,
            confirmed: true,
          })
        ).status,
      ).toBe(201);
    for (const [storyOrder, state] of [
      [1, "knows"],
      [2, "unknown"],
    ])
      expect(
        (
          await f.post(f.project.id, "audience-knowledge", {
            subjectType: "audience",
            subjectId: "reader",
            knowledgeNodeId: secret.id,
            storyOrder,
            state,
            evidence: "此处是作者有意失忆安排。",
          })
        ).status,
      ).toBe(201);
    const response = await f.post(f.project.id, "ip-twin");
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as IPTwinSnapshot;
    expect(snapshot.ruleAnalysis?.findings.map((value) => value.code)).toEqual([
      "causal-cycle",
      "cognition-decrease",
      "declared-conflict",
      "secret-without-incoming-reveal",
    ]);
    expect(snapshot.conflicts).toEqual(
      snapshot.ruleAnalysis!.findings.map((value) => value.summary),
    );
    for (const finding of snapshot.ruleAnalysis!.findings)
      for (const ref of finding.records) {
        const value =
          ref.kind === "node"
            ? snapshot.nodes.find((value) => value.id === ref.id)
            : ref.kind === "edge"
              ? snapshot.edges.find((value) => value.id === ref.id)
              : snapshot.audienceStates.find((value) => value.id === ref.id);
        expect(value?.version).toBe(ref.version);
      }
    const before = f.counts();
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/ip-twins/${snapshot.id}`,
        )
      ).json(),
    ).toEqual(snapshot);
    expect(f.counts()).toEqual(before);
    const legacy = f.historicalSnapshot(snapshot.id),
      historical = f.counts();
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/ip-twins/${snapshot.id}`,
        )
      ).json(),
    ).toEqual(legacy);
    expect(f.counts()).toEqual(historical);
    await f.node(f.project.id);
    expect(
      await (
        await f.app.request(
          `/api/v2/projects/${f.project.id}/ip-twins/${snapshot.id}`,
        )
      ).json(),
    ).toEqual({ ...legacy, stale: true });
    for (const event of f.events())
      expect(event.payload_json).not.toContain("findings");
  });
});
