import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  applyMigrations,
  foundationMigrations,
  openDatabase,
} from "@dramaip/database";
import type { DomainEvent } from "@dramaip/contracts";
import {
  NarrativePlanningOperationSchema,
  CreationWorkflowSchema,
  NarrativePlanningRequestSchema,
  type NarrativePlanningRequest,
} from "@dramaip/contracts/creation";
import { creationMigrations } from "../../../plugins/automation/src/creation.js";
import {
  planningMetricMigration,
  recordPlanningRequest,
  recordPlanningCandidate,
  recordPlanningMetricState,
} from "../../../plugins/automation/src/planning-metrics.js";
import {
  CreativePlanningAdoptionFactSchema,
  CreativePlanningFunnelFactSchema,
  CreativePlanningAdoptionSummarySchema,
  CreativePlanningFunnelSummarySchema,
  canonicalCreativeMetricJSON,
} from "@dramaip/contracts/insights";
import {
  creativePlanningAdoptionMigration,
  projectCreativePlanningAdoption,
  measureCreativePlanningAdoptions,
} from "../../../plugins/insights/src/planning-adoptions.js";
import {
  projectCreativePlanningFunnel,
  measureCreativePlanningFunnel,
} from "../../../plugins/insights/src/planning-funnel.js";
const id = () => crypto.randomUUID(),
  at = "2026-10-04T00:00:00.000Z";
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalCreativeMetricJSON(value)).digest("hex");
function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database.sqlite, foundationMigrations);
  database.sqlite.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  database.sqlite.exec(creativePlanningAdoptionMigration.sql);
  const projectId = id(),
    other = id();
  database.uow.execute((tx) => {
    tx.run("INSERT INTO projects VALUES (?)", projectId);
    tx.run("INSERT INTO projects VALUES (?)", other);
  });
  return { database, projectId, other };
}
function batch(
  projectId: string,
  operation:
    | "characters"
    | "book-outline"
    | "chapter-outline"
    | "story-arc"
    | "knowledge-plan" = "characters",
  count = 2,
) {
  return CreativePlanningAdoptionFactSchema.parse({
    eventVersion: 1,
    kind: "story.planning-batch-adopted",
    workflowPath: "story-planning",
    projectId,
    workflowId: id(),
    operation,
    candidate: { id: id(), contentFingerprint: "a".repeat(64) },
    records: Array.from({ length: count }, () => ({
      id: id(),
      kind:
        operation === "characters"
          ? "characters"
          : operation === "story-arc"
            ? "story-arcs"
            : operation === "knowledge-plan"
              ? "story-bible"
              : "outlines",
      version: 0,
    })),
    sourceVersions: [],
    evidenceKind: "human",
    modelEvidence: "unknown",
    qualityState: "unverified",
    resultStatus: "adopted",
  });
}
function adopted(fact: ReturnType<typeof batch>, cursor = 3): DomainEvent {
  const owner = fact.operation === "knowledge-plan" ? "knowledge" : "writing";
  return {
    eventId: id(),
    cursor,
    type: `${owner}.planning-batch-adopted.v1`,
    pluginId: owner,
    aggregateType: "creation",
    aggregateId: fact.workflowId,
    aggregateVersion: 1,
    occurredAt: at,
    payload: fact,
  };
}
function request(
  fact: ReturnType<typeof batch>,
  root = fact.workflowId,
  parent?: string,
) {
  return CreativePlanningFunnelFactSchema.parse({
    eventVersion: 1,
    projectId: fact.projectId,
    workflowId: fact.workflowId,
    workflowVersion: 0,
    operation: fact.operation,
    rootWorkflowId: root,
    targetKey: digest([
      fact.projectId,
      fact.operation,
      "independent-planning-request-v1",
      root,
    ]),
    requestedAt: at,
    evidenceKind: "rule",
    modelEvidence: "unknown",
    kind: "request",
    targetAttempt: parent ? 2 : 1,
    requestKind: parent ? "retry" : "new-request",
    ...(parent ? { parentWorkflowId: parent } : {}),
    sourceVersions: [],
  });
}
function funnel(fact: ReturnType<typeof request>, cursor = 1): DomainEvent {
  return {
    eventId: id(),
    cursor,
    type:
      fact.kind === "request"
        ? "automation.planning-requested.v1"
        : fact.kind === "candidate-ready"
          ? "automation.planning-candidate-ready.v1"
          : fact.kind === "source-conflict"
            ? "automation.planning-source-conflict.v1"
            : "automation.planning-metric-state.v1",
    pluginId: "automation",
    aggregateType: "creation",
    aggregateId: fact.workflowId,
    aggregateVersion: fact.workflowVersion,
    occurredAt: at,
    payload: fact,
  };
}
function candidate(
  original: ReturnType<typeof request>,
  fact: ReturnType<typeof batch>,
) {
  const { kind: _kind, ...common } = original;
  return CreativePlanningFunnelFactSchema.parse({
    eventVersion: common.eventVersion,
    projectId: common.projectId,
    workflowId: common.workflowId,
    workflowVersion: 3,
    operation: common.operation,
    rootWorkflowId: common.rootWorkflowId,
    targetKey: common.targetKey,
    requestedAt: common.requestedAt,
    evidenceKind: common.evidenceKind,
    modelEvidence: common.modelEvidence,
    kind: "candidate-ready",
    candidate: fact.candidate,
  });
}
describe("independent complete planning batch projections", () => {
  it("Automation records only actual original receipts, preserves retry roots, never backfills legacy parents and atomically rolls back event failure", () => {
    const { database, projectId } = fixture();
    try {
      database.sqlite.exec(creationMigrations[0]!.sql);
      database.sqlite.exec(planningMetricMigration.sql);
      const confirmedRequest: NarrativePlanningRequest = {
        format: "narrative-planning-v1",
        chapterScope: { mode: "none", chapters: [] },
        context: { format: "narrative-context-v1", chapters: [] },
      };
      const make = (sourceWorkflowId?: string) =>
        CreationWorkflowSchema.parse({
          id: id(),
          taskId: id(),
          input: {
            projectId,
            operation: "characters",
            instruction: "PRIVATE",
            engineKind: "codex",
            narrativePlanningRequest: confirmedRequest,
          },
          stage: "preparing",
          version: 0,
          sourceWorkflowId,
          runIds: [],
          contextSnapshotIds: [],
          sources: [],
          preparedPrompt: "PRIVATE",
          issues: [],
          createdAt: at,
          updatedAt: at,
          narrativePlanningBasis: {
            kind: "author-selected-narrative-planning",
            projectId,
            operation: "characters",
            request: confirmedRequest,
            sourceBasis: {
              kind: "author-selected-narrative-sources",
              projectId,
              chapters: [],
              omitted: [],
              references: [],
            },
            coverage: {
              included: [],
              excluded: [],
              totalChapterCount: 0,
              nonEmptyChapterCount: 0,
            },
            references: [
              {
                sourceKind: "project",
                sourceId: projectId,
                sourceVersion: 0,
                fieldPath: "/project",
                contentHash: "a".repeat(64),
                policyDependencies: [],
              },
            ],
          },
        });
      const persist = (value: ReturnType<typeof make>) =>
        database.uow.execute((tx) =>
          tx.run(
            "INSERT INTO automation_creation_workflows VALUES (?,?,NULL,?,?,?,?,?,?,?)",
            value.id,
            projectId,
            value.stage,
            value.version,
            id(),
            "hash",
            JSON.stringify(value),
            at,
            at,
          ),
        );
      const legacy = make();
      persist(legacy);
      const retryLegacy = make(legacy.id);
      persist(retryLegacy);
      database.uow.execute((tx) => recordPlanningRequest(tx, retryLegacy));
      const ready = (value: ReturnType<typeof make>) =>
        CreationWorkflowSchema.parse({
          ...value,
          stage: "awaiting-review",
          version: 3,
          previewId: id(),
          output: {
            title: "PRIVATE",
            content: "PRIVATE",
            items: [
              {
                ref: "plan",
                kind: "characters",
                title: "PRIVATE",
                data: { content: "PRIVATE" },
              },
            ],
          },
        });
      database.uow.execute((tx) => recordPlanningCandidate(tx, ready(legacy)));
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_planning_request_receipts"),
        ),
      ).toEqual([]);
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_planning_candidate_receipts"),
        ),
      ).toEqual([]);
      const first = make();
      const unconfirmed = structuredClone(first);
      delete unconfirmed.input.narrativePlanningRequest;
      expect(CreationWorkflowSchema.safeParse(unconfirmed).success).toBe(false);
      const mismatched = structuredClone(first);
      const differentChapter = { id: id(), version: 0 };
      mismatched.input.narrativePlanningRequest = {
        format: "narrative-planning-v1",
        chapterScope: { mode: "selection", chapters: [differentChapter] },
        context: {
          format: "narrative-context-v1",
          chapters: [{ ...differentChapter, representation: "original" }],
        },
      };
      expect(
        NarrativePlanningRequestSchema.safeParse(
          mismatched.input.narrativePlanningRequest,
        ).success,
      ).toBe(true);
      expect(CreationWorkflowSchema.safeParse(mismatched).success).toBe(false);
      persist(first);
      database.sqlite.exec(
        "CREATE TEMP TRIGGER planning_request_failure BEFORE INSERT ON domain_events WHEN NEW.type='automation.planning-requested.v1' BEGIN SELECT RAISE(ABORT,'controlled planning request failure'); END",
      );
      expect(() =>
        database.uow.execute((tx) => recordPlanningRequest(tx, first)),
      ).toThrow("controlled planning request failure");
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_planning_request_receipts"),
        ),
      ).toEqual([]);
      database.sqlite.exec("DROP TRIGGER planning_request_failure");
      database.uow.execute((tx) => recordPlanningRequest(tx, first));
      const retry = make(first.id);
      persist(retry);
      database.uow.execute((tx) => recordPlanningRequest(tx, retry));
      const independent = make();
      persist(independent);
      database.uow.execute((tx) => recordPlanningRequest(tx, independent));
      const receipts = database.uow
        .execute((tx) =>
          tx.all<{ value_json: string }>(
            "SELECT value_json FROM automation_planning_request_receipts",
          ),
        )
        .map((row) => JSON.parse(row.value_json));
      expect(receipts).toHaveLength(3);
      expect(
        receipts.find((item) => item.workflowId === retry.id),
      ).toMatchObject({
        rootWorkflowId: first.id,
        parentWorkflowId: first.id,
        targetAttempt: 2,
        requestKind: "retry",
      });
      expect(
        receipts.find((item) => item.workflowId === independent.id),
      ).toMatchObject({ rootWorkflowId: independent.id, targetAttempt: 1 });
      expect(new Set(receipts.map((item) => item.targetKey)).size).toBe(2);
      const candidate = ready(first);
      database.uow.execute((tx) => {
        recordPlanningCandidate(tx, candidate);
        recordPlanningCandidate(tx, candidate);
        recordPlanningMetricState(
          tx,
          { ...candidate, version: 4 },
          "adoption-rejected",
        );
      });
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_planning_candidate_receipts"),
        ),
      ).toHaveLength(1);
      const events = database.uow.execute((tx) =>
        tx.all<{ payload_json: string; type: string }>(
          "SELECT type,payload_json FROM domain_events",
        ),
      );
      expect(events.map((item) => item.type)).toEqual([
        "automation.planning-requested.v1",
        "automation.planning-requested.v1",
        "automation.planning-requested.v1",
        "automation.planning-candidate-ready.v1",
        "automation.planning-metric-state.v1",
      ]);
      expect(JSON.stringify(events)).not.toContain("PRIVATE");
      database.uow.execute((tx) =>
        tx.run("DELETE FROM projects WHERE id=?", projectId),
      );
      for (const table of [
        "automation_planning_request_receipts",
        "automation_planning_candidate_receipts",
      ])
        expect(
          database.uow.execute((tx) => tx.all(`SELECT * FROM ${table}`)),
        ).toEqual([]);
    } finally {
      database.close();
    }
  });
  it("all five strict contracts bind one complete owner batch and deny private fields, foreign kinds, options and duplicate records", () => {
    for (const operation of NarrativePlanningOperationSchema.options) {
      const value = batch(id(), operation);
      expect(CreativePlanningAdoptionFactSchema.safeParse(value).success).toBe(
        true,
      );
      for (const patch of [
        { body: "PRIVATE" },
        { title: "PRIVATE" },
        { path: "/private" },
        { workflowPath: "novel" },
        { modelEvidence: "real" },
        { qualityState: "passed" },
        { records: [] },
        { records: [value.records[0], value.records[0]] },
        { records: [{ ...value.records[0], kind: "chapter" }] },
        { records: [{ ...value.records[0], version: 1 }] },
        {
          candidate: {
            ...value.candidate,
            selectionOptions: [
              { id: id(), contentFingerprint: "b".repeat(64) },
            ],
          },
        },
      ])
        expect(
          CreativePlanningAdoptionFactSchema.safeParse({ ...value, ...patch })
            .success,
        ).toBe(false);
    }
  });
  it("owner envelopes, replay identities and original material are immutable; records cannot be reused by another batch and failure rolls back the batch", () => {
    const { database, projectId, other } = fixture();
    try {
      const fact = batch(projectId),
        event = adopted(fact);
      for (const patch of [
        { pluginId: "knowledge" },
        { aggregateId: id() },
        { aggregateVersion: 0 },
        { type: "writing.creation-adopted.v1" },
      ])
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativePlanningAdoption(tx, { ...event, ...patch }),
          ),
        ).toThrow();
      database.uow.execute((tx) => projectCreativePlanningAdoption(tx, event));
      database.uow.execute((tx) => projectCreativePlanningAdoption(tx, event));
      database.uow.execute((tx) =>
        projectCreativePlanningAdoption(tx, {
          ...event,
          eventId: id(),
          cursor: 4,
        }),
      );
      const foreignOwner = batch(projectId, "knowledge-plan");
      foreignOwner.workflowId = fact.workflowId;
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningAdoption(tx, adopted(foreignOwner, 5)),
        ),
      ).toThrow();
      for (const patch of [
        { payload: { ...fact, projectId: other } },
        { occurredAt: "2026-10-04T00:00:01.000Z" },
        {
          payload: {
            ...fact,
            candidate: {
              ...fact.candidate,
              contentFingerprint: "b".repeat(64),
            },
          },
        },
      ])
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativePlanningAdoption(tx, { ...event, ...patch }),
          ),
        ).toThrow();
      const reused = batch(projectId);
      reused.records[1] = fact.records[0]!;
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningAdoption(tx, adopted(reused, 5)),
        ),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          measureCreativePlanningAdoptions(tx, projectId),
        ),
      ).toMatchObject({
        recordedBatches: 1,
        counts: expect.arrayContaining([
          { operation: "characters", batches: 1, actualRecords: 2 },
        ]),
      });
      expect(
        database.uow.execute((tx) =>
          measureCreativePlanningAdoptions(tx, other),
        ),
      ).toMatchObject({ recordedBatches: 0, items: [] });
    } finally {
      database.close();
    }
  });
  it("recent history truncates at twenty batches and five actual record refs without shrinking full counters or replacing originals", () => {
    const { database, projectId } = fixture();
    try {
      for (let n = 1; n <= 26; n++)
        database.uow.execute((tx) =>
          projectCreativePlanningAdoption(
            tx,
            adopted(batch(projectId, "knowledge-plan", 7), n),
          ),
        );
      const summary = database.uow.execute((tx) =>
        measureCreativePlanningAdoptions(tx, projectId),
      );
      expect(summary.recordedBatches).toBe(26);
      expect(summary.items).toHaveLength(20);
      expect(
        summary.counts.find((row) => row.operation === "knowledge-plan"),
      ).toEqual({
        operation: "knowledge-plan",
        batches: 26,
        actualRecords: 182,
      });
      expect(
        summary.items.every(
          (item) =>
            item.fact.recordCount === 7 && item.fact.records.length === 5,
        ),
      ).toBe(true);
      expect(
        CreativePlanningAdoptionSummarySchema.safeParse({
          ...summary,
          recordedBatches: 20,
        }).success,
      ).toBe(false);
      const exaggerated = structuredClone(summary);
      exaggerated.counts.find(
        (item) => item.operation === "characters",
      )!.actualRecords = 1;
      expect(
        CreativePlanningAdoptionSummarySchema.safeParse(exaggerated).success,
      ).toBe(false);
      exaggerated.counts.find(
        (item) => item.operation === "characters",
      )!.actualRecords = 0;
      exaggerated.counts.find(
        (item) => item.operation === "knowledge-plan",
      )!.actualRecords = 52001;
      expect(
        CreativePlanningAdoptionSummarySchema.safeParse(exaggerated).success,
      ).toBe(false);
      expect(
        CreativePlanningAdoptionSummarySchema.safeParse({
          ...summary,
          items: [
            {
              ...summary.items[0],
              fact: { ...summary.items[0]!.fact, recordCount: 2 },
            },
            ...summary.items.slice(1),
          ],
        }).success,
      ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("independent new requests are separate targets, exact two-record adoption counts once and actual retries retain the original root", () => {
    const { database, projectId } = fixture();
    try {
      const first = batch(projectId),
        second = batch(projectId),
        retry = batch(projectId),
        original = request(first),
        next = request(second),
        retried = request(retry, first.workflowId, first.workflowId);
      for (const event of [
        funnel(original, 1),
        funnel(candidate(original, first), 2),
        funnel(next, 3),
        funnel(candidate(next, second), 4),
        funnel(retried, 5),
        funnel(candidate(retried, retry), 6),
      ])
        database.uow.execute((tx) => projectCreativePlanningFunnel(tx, event));
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningFunnel(
            tx,
            funnel(candidate(original, first), 7),
          ),
        ),
      ).toThrow("one actual immutable first review candidate");
      database.uow.execute((tx) =>
        projectCreativePlanningAdoption(tx, adopted(first, 7)),
      );
      database.uow.execute((tx) =>
        projectCreativePlanningAdoption(tx, adopted(retry, 8)),
      );
      const summary = database.uow.execute((tx) =>
        measureCreativePlanningFunnel(tx, projectId),
      );
      expect(
        summary.measures.find((row) => row.operation === "characters"),
      ).toMatchObject({
        recordedRequests: 3,
        requestedTargets: 2,
        firstCandidates: 2,
        firstAdopted: 1,
        pendingDecision: 1,
        retryCandidates: 1,
        firstCandidateAdoptionRatio: 0.5,
        firstAccepted: {
          workflowId: first.workflowId,
          adoptionMode: "exact-candidate",
          requestToReadyMs: 0,
          readyToAdoptMs: 0,
          requestToAdoptMs: 0,
        },
      });
      expect(summary.unmatchedAdoptionBatches).toBe(0);
      expect(
        CreativePlanningFunnelSummarySchema.safeParse({
          ...summary,
          measures: [
            { ...summary.measures[0], firstCandidateAdoptionRatio: 1 },
            ...summary.measures.slice(1),
          ],
        }).success,
      ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("unknown historical batches do not invent first candidates; candidates, retries and cross-project facts require their exact prior request", () => {
    const { database, projectId, other } = fixture();
    try {
      const value = batch(projectId),
        original = request(value),
        ready = candidate(original, value);
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningFunnel(tx, funnel(ready, 2)),
        ),
      ).toThrow();
      const retry = batch(projectId);
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningFunnel(
            tx,
            funnel(request(retry, value.workflowId, value.workflowId), 3),
          ),
        ),
      ).toThrow();
      database.uow.execute((tx) =>
        projectCreativePlanningAdoption(tx, adopted(value, 4)),
      );
      const unknown = database.uow.execute((tx) =>
        measureCreativePlanningFunnel(tx, projectId),
      );
      expect(unknown.unmatchedAdoptionBatches).toBe(1);
      expect(unknown.measures[0]).toMatchObject({
        recordedRequests: 0,
        requestedTargets: 0,
        firstCandidates: 0,
        firstAccepted: null,
        firstCandidateAdoptionRatio: null,
      });
      database.uow.execute((tx) =>
        projectCreativePlanningFunnel(tx, funnel(original, 5)),
      );
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningFunnel(
            tx,
            funnel({ ...ready, projectId: other } as typeof ready, 6),
          ),
        ),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          measureCreativePlanningFunnel(tx, projectId),
        ).unmatchedAdoptionBatches,
      ).toBe(1);
      expect(
        CreativePlanningFunnelFactSchema.safeParse({
          ...original,
          parentWorkflowId: id(),
        }).success,
      ).toBe(false);
      expect(
        CreativePlanningFunnelFactSchema.safeParse({
          ...original,
          body: "PRIVATE",
        }).success,
      ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("edited material remains revised adoption, actual state closes the first decision, and inconsistent clocks never invent positive elapsed time", () => {
    const { database, projectId } = fixture();
    try {
      const value = batch(projectId),
        original = request(value),
        ready = candidate(original, value);
      database.uow.execute((tx) =>
        projectCreativePlanningFunnel(tx, funnel(original, 1)),
      );
      const observed = funnel(ready, 2);
      observed.occurredAt = "2026-10-03T23:59:59.000Z";
      database.uow.execute((tx) => projectCreativePlanningFunnel(tx, observed));
      value.candidate.contentFingerprint = "b".repeat(64);
      database.uow.execute((tx) =>
        projectCreativePlanningAdoption(tx, adopted(value, 3)),
      );
      const summary = database.uow.execute((tx) =>
        measureCreativePlanningFunnel(tx, projectId),
      );
      expect(summary.measures[0]).toMatchObject({
        firstCandidates: 1,
        firstAdopted: 0,
        revisedAdoption: 1,
        pendingDecision: 0,
        firstAccepted: {
          adoptionMode: "edited-candidate",
          clockState: "inconsistent",
          requestToReadyMs: null,
          readyToAdoptMs: 1000,
          requestToAdoptMs: 0,
        },
      });
      const next = batch(projectId),
        nr = request(next),
        nc = candidate(nr, next);
      database.uow.execute((tx) =>
        projectCreativePlanningFunnel(tx, funnel(nr, 4)),
      );
      database.uow.execute((tx) =>
        projectCreativePlanningFunnel(tx, funnel(nc, 5)),
      );
      const { candidate: _candidate, ...common } = nc as Extract<
        typeof nc,
        { kind: "candidate-ready" }
      >;
      const state = CreativePlanningFunnelFactSchema.parse({
        ...common,
        kind: "state",
        state: "discarded",
        workflowVersion: 4,
      });
      const event = funnel(state, 6);
      database.uow.execute((tx) => projectCreativePlanningFunnel(tx, event));
      database.uow.execute((tx) => projectCreativePlanningFunnel(tx, event));
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativePlanningFunnel(tx, {
            ...event,
            occurredAt: "2026-10-04T00:00:01.000Z",
          }),
        ),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          measureCreativePlanningFunnel(tx, projectId),
        ).measures[0],
      ).toMatchObject({
        firstCandidates: 2,
        revisedAdoption: 1,
        closedWithoutFirstAdoption: 1,
        pendingDecision: 0,
      });
    } finally {
      database.close();
    }
  });
  it("foreign-key purge removes every actual planning projection and immutable storage corruption is rejected, not shown as current quality", () => {
    const { database, projectId } = fixture();
    try {
      const fact = batch(projectId),
        original = request(fact);
      database.uow.execute((tx) => {
        projectCreativePlanningFunnel(tx, funnel(original, 1));
        projectCreativePlanningFunnel(tx, funnel(candidate(original, fact), 2));
        projectCreativePlanningAdoption(tx, adopted(fact, 3));
      });
      database.uow.execute((tx) =>
        tx.run(
          "UPDATE insights_creative_planning_adoptions SET fact_json=? WHERE project_id=?",
          JSON.stringify({ ...fact, projectId: id() }),
          projectId,
        ),
      );
      expect(() =>
        database.uow.execute((tx) =>
          measureCreativePlanningAdoptions(tx, projectId),
        ),
      ).toThrow();
      database.uow.execute((tx) =>
        tx.run("DELETE FROM projects WHERE id=?", projectId),
      );
      for (const table of [
        "insights_creative_planning_adoptions",
        "insights_creative_planning_records",
        "insights_creative_planning_funnel",
      ])
        expect(
          database.uow.execute((tx) => tx.all(`SELECT * FROM ${table}`)),
        ).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("accurate independent planning source conflicts", () => {
  function setup() {
    const scope = fixture(),
      fact = batch(scope.projectId);
    const frozen = { id: id(), version: 2 },
      current = { id: frozen.id, version: 3 };
    const original = CreativePlanningFunnelFactSchema.parse({
      ...request(fact),
      sourceVersions: [frozen],
    });
    const ready = candidate(original, fact);
    const {
      kind: _kind,
      candidate: _candidate,
      ...common
    } = ready as Extract<typeof ready, { kind: "candidate-ready" }>;
    const state = CreativePlanningFunnelFactSchema.parse({
      ...common,
      workflowVersion: 4,
      kind: "state",
      state: "adoption-rejected",
    });
    const conflict = CreativePlanningFunnelFactSchema.parse({
      ...common,
      workflowVersion: 4,
      kind: "source-conflict",
      candidate: fact.candidate,
      sourceConflict: {
        projectId: scope.projectId,
        workflowId: fact.workflowId,
        changes: [{ sourceKind: "chapter", frozen, current }],
      },
    }) as Extract<ReturnType<typeof request>, { kind: "source-conflict" }>;
    const project = (event: DomainEvent) =>
      scope.database.uow.execute((tx) =>
        projectCreativePlanningFunnel(tx, event),
      );
    return {
      ...scope,
      fact,
      frozen,
      current,
      original,
      ready,
      state,
      conflict,
      project,
    };
  }
  it("strict evidence refuses mismatched scope, unchanged sources, private body and strategy options; older missing fields stay unrecorded", () => {
    const s = setup();
    try {
      for (const invalid of [
        {
          ...s.conflict,
          sourceConflict: { ...s.conflict.sourceConflict, projectId: s.other },
        },
        {
          ...s.conflict,
          sourceConflict: { ...s.conflict.sourceConflict, workflowId: id() },
        },
        {
          ...s.conflict,
          candidate: {
            ...s.fact.candidate,
            selectionOptions: [
              { id: "choice", contentFingerprint: "c".repeat(64) },
            ],
          },
        },
        {
          ...s.conflict,
          sourceConflict: { ...s.conflict.sourceConflict, body: "PRIVATE" },
        },
        {
          ...s.conflict,
          sourceConflict: {
            ...s.conflict.sourceConflict,
            changes: [
              { sourceKind: "chapter", frozen: s.frozen, current: s.frozen },
            ],
          },
        },
      ])
        expect(
          CreativePlanningFunnelFactSchema.safeParse(invalid).success,
        ).toBe(false);
      const measured = s.database.uow.execute((tx) =>
        measureCreativePlanningFunnel(tx, s.projectId),
      );
      const older = structuredClone(measured);
      for (const row of older.measures) delete row.sourceConflicts;
      expect(
        CreativePlanningFunnelSummarySchema.parse(older).measures.every(
          (row) => row.sourceConflicts === undefined,
        ),
      ).toBe(true);
      const inflated = structuredClone(measured);
      inflated.measures[0]!.sourceConflicts = {
        candidateCount: 1,
        last: {
          candidate: s.fact.candidate,
          sourceConflict: s.conflict.sourceConflict,
          eventId: id(),
          cursor: 4,
          occurredAt: at,
        },
      };
      expect(
        CreativePlanningFunnelSummarySchema.safeParse(inflated).success,
      ).toBe(false);
    } finally {
      s.database.close();
    }
  });
  it("requires original request, exact ready material, frozen source and preceding same-version actual rejection; projection faults roll back", () => {
    const s = setup();
    try {
      expect(() => s.project(funnel(s.conflict, 4))).toThrow();
      s.project(funnel(s.original, 1));
      expect(() => s.project(funnel(s.conflict, 4))).toThrow();
      s.project(funnel(s.ready, 2));
      expect(() => s.project(funnel(s.conflict, 4))).toThrow();
      s.project(funnel(s.state, 3));
      const rows = () =>
        s.database.uow.execute((tx) =>
          tx.all(
            "SELECT * FROM insights_creative_planning_funnel ORDER BY source_cursor",
          ),
        );
      const before = rows();
      for (const invalid of [
        { ...s.conflict, workflowVersion: 5 },
        {
          ...s.conflict,
          candidate: {
            ...s.fact.candidate,
            contentFingerprint: "c".repeat(64),
          },
        },
        {
          ...s.conflict,
          sourceConflict: {
            ...s.conflict.sourceConflict,
            changes: [
              {
                sourceKind: "chapter",
                frozen: { id: id(), version: 2 },
                current: s.current,
              },
            ],
          },
        },
      ])
        expect(() =>
          s.project(funnel(CreativePlanningFunnelFactSchema.parse(invalid), 4)),
        ).toThrow();
      expect(rows()).toEqual(before);
      s.database.sqlite.exec(
        "CREATE TEMP TRIGGER planning_conflict_projection_failure BEFORE INSERT ON insights_creative_planning_funnel WHEN json_extract(NEW.value_json,'$.fact.kind')='source-conflict' BEGIN SELECT RAISE(ABORT,'controlled projection fault'); END",
      );
      expect(() => s.project(funnel(s.conflict, 4))).toThrow(
        "controlled projection fault",
      );
      expect(rows()).toEqual(before);
      s.database.sqlite.exec(
        "DROP TRIGGER planning_conflict_projection_failure",
      );
      s.project(funnel(s.conflict, 4));
      expect(rows()).toHaveLength(4);
    } finally {
      s.database.close();
    }
  });
  it("replay preserves one conflicting candidate and exact latest fact without changing first-candidate adoption; changed replay or foreign owner is rejected", () => {
    const s = setup();
    try {
      s.project(funnel(s.original, 1));
      s.project(funnel(s.ready, 2));
      s.project(funnel(s.state, 3));
      const event = funnel(s.conflict, 4);
      s.project(event);
      s.project(event);
      s.project({ ...event, eventId: id(), cursor: 5 });
      expect(() =>
        s.project({ ...event, occurredAt: "2026-10-04T00:00:01.000Z" }),
      ).toThrow();
      expect(() =>
        s.project({ ...event, eventId: id(), cursor: 6, pluginId: "writing" }),
      ).toThrow();
      const measured = s.database.uow.execute((tx) =>
        measureCreativePlanningFunnel(tx, s.projectId),
      ).measures[0]!;
      expect(measured).toMatchObject({
        recordedRequests: 1,
        requestedTargets: 1,
        firstCandidates: 1,
        firstAdopted: 0,
        pendingDecision: 1,
        adoptionRejectedCount: 1,
        sourceConflicts: {
          candidateCount: 1,
          last: {
            cursor: 5,
            candidate: s.fact.candidate,
            sourceConflict: s.conflict.sourceConflict,
          },
        },
      });
      expect(measured.firstCandidateAdoptionRatio).toBe(0);
      expect(JSON.stringify(measured)).not.toContain("PRIVATE");
    } finally {
      s.database.close();
    }
  });
  it("physical project purge removes planning conflict projections and keeps the other project's actual facts", () => {
    const s = setup();
    try {
      s.project(funnel(s.original, 1));
      s.project(funnel(s.ready, 2));
      s.project(funnel(s.state, 3));
      s.project(funnel(s.conflict, 4));
      const other = batch(s.other),
        otherRequest = request(other);
      s.project(funnel(otherRequest, 5));
      s.database.uow.execute((tx) =>
        tx.run("DELETE FROM projects WHERE id=?", s.projectId),
      );
      expect(
        s.database.uow.execute((tx) =>
          tx.all(
            "SELECT * FROM insights_creative_planning_funnel WHERE project_id=?",
            s.projectId,
          ),
        ),
      ).toEqual([]);
      expect(
        s.database.uow.execute((tx) =>
          measureCreativePlanningFunnel(tx, s.other),
        ).measures[0],
      ).toMatchObject({
        recordedRequests: 1,
        firstCandidates: 0,
        sourceConflicts: { candidateCount: 0, last: null },
      });
    } finally {
      s.database.close();
    }
  });
});
