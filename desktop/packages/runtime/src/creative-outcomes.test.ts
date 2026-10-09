import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DomainEventSchemaRegistry } from "@dramaip/events";
import { DOMAIN_EVENT_MANIFEST } from "./event-manifest.generated.js";
import {
  CreationWorkflowSchema,
  CreationSourceConflictError,
  assertCreationSourceVersionCurrent,
  assertCreationAuthorIntentCurrent,
  assertCreationReferencesCurrent,
} from "@dramaip/contracts/creation";
import {
  creativeContinuationMigration as continuationReceipts,
  recordContinuationRequest,
  recordContinuationStarted,
} from "../../../plugins/automation/src/creative-continuation.js";
import { creationMigrations } from "../../../plugins/automation/src/creation.js";
import {
  creativeMetricMigration,
  recordCreativeRequest,
  recordCreativeCandidate,
  recordCreativeSourceConflict,
} from "../../../plugins/automation/src/creative-metrics.js";
import {
  applyMigrations,
  foundationMigrations,
  openDatabase,
} from "@dramaip/database";
import type { DomainEvent } from "@dramaip/contracts";
import {
  CreativeOutcomeFactSchema,
  CreativeInitialGoalFactSchema,
  CreativeInitialGoalSummarySchema,
  CreativeSourceConfirmationFactSchema,
  CreativeSourceConfirmationSummarySchema,
  CreativeQualityAdoptionFactSchema,
  CreativeQualityAssociationSchema,
  CreativeFunnelFactSchema,
  CreativeFunnelRecordSchema,
  CreativeOwnerRejectionFactSchema,
  CreativeFunnelSummarySchema,
  CreativeFunnelMetricSchema,
  canonicalCreativeMetricJSON,
  type CreativeFunnelFact,
  CreativeContinuationFactSchema,
  CreativeContinuationSummarySchema,
  CreativeContinuationGlobalSchema,
  type CreativeContinuationFact,
} from "@dramaip/contracts/insights";
import {
  creativeFunnelMigration,
  projectCreativeFunnel,
  measureCreativeFunnel,
} from "../../../plugins/insights/src/funnel.js";
import {
  creativeContinuationMigration,
  projectCreativeContinuation,
  measureCreativeContinuation,
  measureGlobalContinuation,
} from "../../../plugins/insights/src/continuation.js";
import {
  creativeOutcomeMigration,
  creativeOutcomeUnitKey,
  countCreativeOutcomes,
  projectCreativeOutcome,
} from "../../../plugins/insights/src/outcomes.js";
import { observedCreativeWholeBookCollection } from "../../../plugins/production/src/creative-rejections.js";
import {
  creativeQualityAssociationMigration,
  projectCreativeQualityAdoption,
  measureCreativeQualityAssociations,
} from "../../../plugins/insights/src/quality-associations.js";
import {
  creativeInitialGoalMigration,
  projectCreativeInitialGoal,
  measureCreativeInitialGoals,
} from "../../../plugins/insights/src/initial-goals.js";
import {
  creativeSourceConfirmationMigration,
  projectCreativeSourceConfirmation,
  measureCreativeSourceConfirmations,
} from "../../../plugins/insights/src/source-confirmations.js";

function sourceFact(projectId: string, count = 2) {
  return CreativeSourceConfirmationFactSchema.parse({
    eventVersion: 1,
    owner: "workspace",
    sourceId: id(),
    projectId,
    projectVersion: 0,
    projectMode: "series_longform",
    workflowPath: "novel",
    entry: "ordinary-import",
    sourceFormat: "markdown",
    contentKind: "novel",
    scopePolicy: "confirmed-parsed-entries-not-entire-file",
    entryCount: count,
    sceneCount: 0,
    bindingFingerprint: "a".repeat(64),
    receiptFingerprint: "b".repeat(64),
    rightsState: "declared-not-verified",
    evidenceKind: "explicit-source-declaration-and-owner-commit",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "not-assessed",
    entries: Array.from({ length: count }, (_, sourceIndex) => ({
      kind: "chapter",
      sourceIndex,
      id: id(),
      version: 0,
    })),
  });
}
function sourceEnvelope(
  value: ReturnType<typeof sourceFact>,
  cursor = 1,
): DomainEvent {
  return {
    eventId: id(),
    cursor,
    type: `${value.owner}.creation-source-confirmed.v1`,
    pluginId: value.owner,
    aggregateType:
      value.owner === "workspace" ? "project" : "screenplay-intake",
    aggregateId: value.owner === "workspace" ? value.projectId : value.sourceId,
    aggregateVersion: value.owner === "workspace" ? value.projectVersion : 3,
    occurredAt: "2026-10-04T00:00:00.000Z",
    payload: value,
  };
}

function initialGoal(projectId: string) {
  return CreativeInitialGoalFactSchema.parse({
    eventVersion: 1,
    projectId,
    projectVersion: 0,
    workflowPath: "novel",
    goal: "novel-first",
    material: "inspiration",
    evidenceKind: "explicit-initial-goal-confirmation",
    modelEvidence: "unknown",
    qualityState: "unverified",
  });
}
function goalEnvelope(projectId: string, cursor = 1): DomainEvent {
  return {
    eventId: id(),
    cursor,
    type: "workspace.creation-goal-confirmed.v1",
    pluginId: "workspace",
    aggregateType: "project",
    aggregateId: projectId,
    aggregateVersion: 0,
    occurredAt: "2026-10-04T00:00:00.000Z",
    payload: initialGoal(projectId),
  };
}

function qualityFact(projectId: string, targetId = id()) {
  return CreativeQualityAdoptionFactSchema.parse({
    eventVersion: 1,
    projectId,
    workflowId: id(),
    report: { id: id(), version: 1 },
    target: { kind: "chapter", id: targetId, version: 1 },
    requestedDimensions: ["causality", "timeline"],
    evidenceKind: "explicit-report-adoption",
    modelEvidence: "unknown",
    qualityState: "unverified",
    currentValidity: "unknown",
  });
}
function qualityEnvelope(
  value: ReturnType<typeof qualityFact>,
  cursor: number,
): DomainEvent {
  return {
    eventId: id(),
    cursor,
    type: "creative-quality.narrative-report-adopted.v1",
    pluginId: "creative-quality",
    aggregateType: "narrative-quality-report",
    aggregateId: value.report.id,
    aggregateVersion: value.report.version,
    occurredAt: "2026-10-04T00:00:00.000Z",
    payload: value,
  };
}

const id = () => crypto.randomUUID();
function fact(projectId: string, objectId: string = id()) {
  return CreativeOutcomeFactSchema.parse({
    eventVersion: 1,
    kind: "novel.chapter-adopted",
    workflowPath: "novel",
    projectId,
    objectId,
    formalVersions: [{ kind: "chapter", id: objectId, version: 1 }],
    sourceVersions: [],
    evidenceKind: "human",
    modelEvidence: "unknown",
    qualityState: "unverified",
    resultStatus: "adopted",
  });
}
function envelope(
  value: ReturnType<typeof fact>,
  cursor: number,
  occurredAt: string,
): DomainEvent {
  return {
    eventId: id(),
    cursor,
    type: "writing.chapter-adopted.v1",
    pluginId: "writing",
    aggregateType: "chapter",
    aggregateId: value.objectId,
    aggregateVersion: value.formalVersions[0]!.version,
    occurredAt,
    payload: value,
  };
}
function fixture() {
  const database = openDatabase(":memory:");
  applyMigrations(database.sqlite, foundationMigrations);
  // This isolated projection test has no business writers, Runtime or engine.
  database.sqlite.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  database.sqlite.exec(creativeOutcomeMigration.sql);
  database.sqlite.exec(creativeFunnelMigration.sql);
  database.sqlite.exec(creativeContinuationMigration.sql);
  const projectId = id();
  const other = id();
  database.uow.execute((tx) => {
    tx.run("INSERT INTO projects VALUES (?)", projectId);
    tx.run("INSERT INTO projects VALUES (?)", other);
  });
  return { database, projectId, other };
}

describe("local creative outcome projections", () => {
  it("source confirmation contracts reject private data, false evidence, incomplete original order and fabricated history bounds", () => {
    const value = sourceFact(id());
    for (const patch of [
      { fileName: "PRIVATE" },
      { body: "PRIVATE" },
      { sourceKey: "PRIVATE" },
      { grantId: id() },
      { requestKey: id() },
      { sourceVersion: 0 },
      { rightsState: "verified" },
      { modelEvidence: "real" },
      { qualityState: "passed" },
      { currentValidity: "current" },
      { workflowPath: "adaptation" },
      { lossReportReviewed: true },
      { scopePolicy: "entire-file" },
      { sceneCount: 1 },
      { sourceFormat: "fountain" },
      { entries: value.entries.slice(0, 1) },
      { entries: [value.entries[1], value.entries[0]] },
      { entries: [{ ...value.entries[0], version: 1 }, value.entries[1]] },
      { entries: [value.entries[0], { ...value.entries[0], sourceIndex: 1 }] },
      { entries: [{ ...value.entries[0], grantId: id() }, value.entries[1]] },
    ])
      expect(
        CreativeSourceConfirmationFactSchema.safeParse({ ...value, ...patch })
          .success,
      ).toBe(false);
    const otherMode = {
      ...value,
      projectMode: "creator_channel",
      workflowPath: null,
    };
    expect(
      CreativeSourceConfirmationFactSchema.safeParse(otherMode).success,
    ).toBe(true);
    expect(
      CreativeSourceConfirmationFactSchema.safeParse({
        ...otherMode,
        workflowPath: "novel",
      }).success,
    ).toBe(false);
    const native = {
      ...value,
      owner: "production",
      projectMode: "single_season",
      workflowPath: "adaptation",
      entry: "native-screenplay-intake",
      sourceFormat: "fountain",
      contentKind: "script",
      lossReportReviewed: true,
      entries: value.entries.map((entry) => ({
        kind: "script-document",
        sourceIndex: entry.sourceIndex,
        previewEntryId: id(),
        id: entry.id,
        version: 0,
        scriptId: id(),
        scriptVersion: 0,
      })),
    };
    expect(CreativeSourceConfirmationFactSchema.safeParse(native).success).toBe(
      true,
    );
    for (const patch of [
      { lossReportReviewed: undefined },
      { sourceFormat: "markdown" },
      { entry: "ordinary-import" },
      { projectMode: "personal_theater", workflowPath: null },
      {
        entries: [
          { ...native.entries[0], scriptId: native.entries[0]!.id },
          native.entries[1],
        ],
      },
    ])
      expect(
        CreativeSourceConfirmationFactSchema.safeParse({ ...native, ...patch })
          .success,
      ).toBe(false);
  });
  it("source confirmation projection preserves the first receipt, remains project-scoped and never adds outcome units", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeSourceConfirmationMigration.sql);
    try {
      const fact = sourceFact(projectId, 7),
        event = sourceEnvelope(fact);
      const before = database.uow.execute((tx) =>
        countCreativeOutcomes(tx, projectId, event.occurredAt),
      );
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(tx, event),
      );
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(tx, event),
      );
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(tx, {
          ...event,
          eventId: id(),
          cursor: 2,
          occurredAt: "2026-10-04T01:00:00.000Z",
        }),
      );
      const summary = database.uow.execute((tx) =>
        measureCreativeSourceConfirmations(tx, projectId),
      );
      expect(summary.recordedConfirmations).toBe(1);
      expect(summary.items[0]).toEqual({
        ...fact,
        entries: fact.entries.slice(0, 5),
        eventId: event.eventId,
        cursor: event.cursor,
        occurredAt: event.occurredAt,
        bindingDisplay: "first-five-original-bindings",
      });
      expect(
        database.uow.execute((tx) =>
          measureCreativeSourceConfirmations(tx, other),
        ).recordedConfirmations,
      ).toBe(0);
      expect(
        database.uow.execute((tx) =>
          countCreativeOutcomes(tx, projectId, event.occurredAt),
        ),
      ).toEqual(before);
      const original = database.uow.execute((tx) =>
        tx.get<{ record_json: string }>(
          "SELECT record_json FROM insights_creative_source_confirmations",
        ),
      )!;
      expect(JSON.parse(original.record_json).entries).toEqual(fact.entries);
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(
          tx,
          sourceEnvelope(sourceFact(other), 3),
        ),
      );
      expect(
        database.uow.execute((tx) =>
          measureCreativeSourceConfirmations(tx, projectId),
        ),
      ).toEqual(summary);
    } finally {
      database.close();
    }
  });
  it("source confirmation projection rolls back failures and rejects changed scope, owner phase, fingerprints, event identity or binding", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeSourceConfirmationMigration.sql);
    try {
      const fact = sourceFact(projectId),
        event = sourceEnvelope(fact);
      database.sqlite.exec(
        "CREATE TEMP TRIGGER source_projection_failure BEFORE INSERT ON insights_creative_source_confirmations BEGIN SELECT RAISE(ABORT, 'controlled source projection failure'); END",
      );
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativeSourceConfirmation(tx, event),
        ),
      ).toThrow("controlled source projection failure");
      expect(
        database.uow.execute((tx) =>
          measureCreativeSourceConfirmations(tx, projectId),
        ).recordedConfirmations,
      ).toBe(0);
      database.sqlite.exec("DROP TRIGGER source_projection_failure");
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(tx, event),
      );
      const summary = database.uow.execute((tx) =>
        measureCreativeSourceConfirmations(tx, projectId),
      );
      for (const patch of [
        { pluginId: "production" },
        { type: "workspace.source-import-committed.v1" },
        { aggregateType: "source-import" },
        { aggregateId: other },
        { aggregateVersion: 2 },
        { occurredAt: "2026-10-04T03:00:00.000Z" },
        { payload: { ...fact, receiptFingerprint: "c".repeat(64) } },
        {
          payload: {
            ...fact,
            entries: [{ ...fact.entries[0], id: id() }, fact.entries[1]],
          },
        },
        { aggregateId: other, payload: { ...fact, projectId: other } },
      ]) {
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativeSourceConfirmation(tx, { ...event, ...patch }),
          ),
        ).toThrow();
        expect(
          database.uow.execute((tx) =>
            measureCreativeSourceConfirmations(tx, projectId),
          ),
        ).toEqual(summary);
      }
      // A second owner can legitimately have the same opaque source UUID.
      const native = CreativeSourceConfirmationFactSchema.parse({
        ...fact,
        owner: "production",
        projectMode: "single_season",
        workflowPath: "adaptation",
        entry: "native-screenplay-intake",
        contentKind: "script",
        sourceFormat: "fdx",
        lossReportReviewed: true,
        entries: fact.entries.map((entry) => ({
          kind: "script-document",
          sourceIndex: entry.sourceIndex,
          previewEntryId: id(),
          id: id(),
          version: 0,
          scriptId: id(),
          scriptVersion: 0,
        })),
      });
      const second = sourceEnvelope(native, 4);
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativeSourceConfirmation(tx, {
            ...second,
            aggregateVersion: 2,
          }),
        ),
      ).toThrow();
      database.uow.execute((tx) =>
        projectCreativeSourceConfirmation(tx, second),
      );
      expect(
        database.uow.execute((tx) =>
          measureCreativeSourceConfirmations(tx, projectId),
        ).recordedConfirmations,
      ).toBe(2);
    } finally {
      database.close();
    }
  });
  it("source confirmation summary bounds the last twenty receipts and first five original bindings while retaining full historical counts", () => {
    const { database, projectId } = fixture();
    database.sqlite.exec(creativeSourceConfirmationMigration.sql);
    try {
      for (let index = 1; index <= 22; index++) {
        const original = sourceFact(projectId, 7);
        const fact =
          index % 2
            ? original
            : CreativeSourceConfirmationFactSchema.parse({
                ...original,
                projectMode: "personal_theater",
                workflowPath: null,
              });
        database.uow.execute((tx) =>
          projectCreativeSourceConfirmation(tx, sourceEnvelope(fact, index)),
        );
      }
      const summary = database.uow.execute((tx) =>
        measureCreativeSourceConfirmations(tx, projectId),
      );
      expect(summary.recordedConfirmations).toBe(22);
      expect(summary.byWorkflow).toEqual([
        { workflowPath: "novel", total: 11 },
        { workflowPath: "adaptation", total: 0 },
        { workflowPath: null, total: 11 },
      ]);
      expect(summary.items).toHaveLength(20);
      expect(summary.items.map((item) => item.cursor)).toEqual(
        Array.from({ length: 20 }, (_, index) => 22 - index),
      );
      expect(
        summary.items.every(
          (item) => item.entryCount === 7 && item.entries.length === 5,
        ),
      ).toBe(true);
      for (const patch of [
        { recordedConfirmations: 23 },
        { items: summary.items.slice(0, 19) },
        { items: [...summary.items].reverse() },
        {
          items: [
            {
              ...summary.items[0],
              entries: summary.items[0]!.entries.slice(0, 4),
            },
            ...summary.items.slice(1),
          ],
        },
      ])
        expect(
          CreativeSourceConfirmationSummarySchema.safeParse({
            ...summary,
            ...patch,
          }).success,
        ).toBe(false);
      database.uow.execute((tx) =>
        tx.run("DELETE FROM projects WHERE id=?", projectId),
      );
      expect(
        database.uow.execute((tx) =>
          measureCreativeSourceConfirmations(tx, projectId),
        ).recordedConfirmations,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
  it("initial goal contracts reject inferred quality, invented versions, private data and inconsistent history counts", () => {
    const value = initialGoal(id());
    for (const patch of [
      { projectVersion: 1 },
      { workflowPath: "adaptation" },
      { modelEvidence: "real" },
      { qualityState: "passed" },
      { evidenceKind: "human" },
      { title: "PRIVATE" },
      { body: "PRIVATE" },
      { sourceFingerprint: "a".repeat(64) },
    ])
      expect(
        CreativeInitialGoalFactSchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
    const empty = {
      historyPolicy: "recorded-explicit-initial-goals-only",
      recordedProjects: 0,
      byWorkflow: [
        { workflowPath: "novel", total: 0 },
        { workflowPath: "adaptation", total: 0 },
      ],
      items: [],
    };
    expect(CreativeInitialGoalSummarySchema.safeParse(empty).success).toBe(
      true,
    );
    expect(
      CreativeInitialGoalSummarySchema.safeParse({
        ...empty,
        recordedProjects: 1,
      }).success,
    ).toBe(false);
    expect(
      CreativeInitialGoalSummarySchema.safeParse({
        ...empty,
        byWorkflow: [
          { workflowPath: "novel", total: 1 },
          { workflowPath: "adaptation", total: 0 },
        ],
      }).success,
    ).toBe(false);
  });
  it("initial goal projection preserves the original receipt on replay and stays project-scoped without increasing outcome counts", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeInitialGoalMigration.sql);
    try {
      const event = goalEnvelope(projectId);
      const before = database.uow.execute((tx) =>
        countCreativeOutcomes(tx, projectId, event.occurredAt),
      );
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, projectId))
          .recordedProjects,
      ).toBe(0);
      database.uow.execute((tx) => projectCreativeInitialGoal(tx, event));
      database.uow.execute((tx) => projectCreativeInitialGoal(tx, event));
      database.uow.execute((tx) =>
        projectCreativeInitialGoal(tx, {
          ...event,
          eventId: id(),
          cursor: 2,
          occurredAt: "2026-10-04T01:00:00.000Z",
        }),
      );
      const summary = database.uow.execute((tx) =>
        measureCreativeInitialGoals(tx, projectId),
      );
      expect(summary.recordedProjects).toBe(1);
      expect(summary.items).toEqual([
        {
          ...initialGoal(projectId),
          eventId: event.eventId,
          cursor: event.cursor,
          occurredAt: event.occurredAt,
        },
      ]);
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, other))
          .recordedProjects,
      ).toBe(0);
      expect(
        database.uow.execute((tx) =>
          countCreativeOutcomes(tx, projectId, event.occurredAt),
        ),
      ).toEqual(before);
      database.uow.execute((tx) =>
        projectCreativeInitialGoal(tx, {
          ...goalEnvelope(other, 3),
          payload: {
            ...initialGoal(other),
            workflowPath: "adaptation",
            goal: "screenplay-first",
            material: "script",
          },
        }),
      );
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, other))
          .byWorkflow,
      ).toEqual([
        { workflowPath: "novel", total: 0 },
        { workflowPath: "adaptation", total: 1 },
      ]);
      expect(
        database.uow.execute((tx) =>
          measureCreativeInitialGoals(tx, projectId),
        ),
      ).toEqual(summary);
    } finally {
      database.close();
    }
  });
  it("initial goal projection rolls back write failures and rejects changed original identity, material or owner envelope", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeInitialGoalMigration.sql);
    try {
      const event = goalEnvelope(projectId);
      database.sqlite.exec(
        "CREATE TEMP TRIGGER goal_projection_failure BEFORE INSERT ON insights_creative_initial_goals BEGIN SELECT RAISE(ABORT, 'controlled goal projection failure'); END",
      );
      expect(() =>
        database.uow.execute((tx) => projectCreativeInitialGoal(tx, event)),
      ).toThrow("controlled goal projection failure");
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, projectId))
          .recordedProjects,
      ).toBe(0);
      database.sqlite.exec("DROP TRIGGER goal_projection_failure");
      database.uow.execute((tx) => projectCreativeInitialGoal(tx, event));
      const summary = database.uow.execute((tx) =>
        measureCreativeInitialGoals(tx, projectId),
      );
      for (const patch of [
        { pluginId: "production" },
        { type: "workspace.project-created.v1" },
        { aggregateId: other },
        { aggregateType: "goal" },
        { aggregateVersion: 1 },
        { occurredAt: "2026-10-04T02:00:00.000Z" },
        {
          eventId: id(),
          cursor: 2,
          payload: { ...initialGoal(projectId), material: "source-import" },
        },
        { payload: initialGoal(other), aggregateId: other },
      ])
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativeInitialGoal(tx, { ...event, ...patch }),
          ),
        ).toThrow();
      expect(
        database.uow.execute((tx) =>
          measureCreativeInitialGoals(tx, projectId),
        ),
      ).toEqual(summary);
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, other))
          .recordedProjects,
      ).toBe(0);
      database.uow.execute((tx) =>
        tx.run("DELETE FROM projects WHERE id=?", projectId),
      );
      expect(
        database.uow.execute((tx) => measureCreativeInitialGoals(tx, projectId))
          .recordedProjects,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
  it("quality report adoption contracts reject private prose and fabricated quality, coverage or approximate target associations", () => {
    const projectId = id();
    const value = qualityFact(projectId);
    for (const patch of [
      { qualityState: "passed" },
      { modelEvidence: "real" },
      { currentValidity: "current" },
      { quote: "PRIVATE" },
      { note: "PRIVATE" },
      { score: 100 },
      { requestedDimensions: ["causality", "causality"] },
      { report: { ...value.report, version: 0 } },
      { target: { ...value.target, title: "PRIVATE" } },
      { target: { ...value.target, sourceFingerprint: "a".repeat(64) } },
    ])
      expect(
        CreativeQualityAdoptionFactSchema.safeParse({ ...value, ...patch })
          .success,
      ).toBe(false);
    const scope = {
      mode: "full",
      included: [
        { id: value.target.id, version: 1, representations: ["summary"] },
      ],
      totalChapterCount: 2,
      nonEmptyChapterCount: 1,
    };
    const whole = {
      ...value,
      target: { kind: "chapter-set", id: projectId, version: 0 },
      chapterScope: scope,
    };
    expect(CreativeQualityAdoptionFactSchema.safeParse(whole).success).toBe(
      true,
    );
    for (const changed of [
      { ...whole, target: { ...whole.target, id: id() } },
      { ...whole, chapterScope: { ...scope, nonEmptyChapterCount: 2 } },
      {
        ...whole,
        chapterScope: {
          ...scope,
          included: [...scope.included, ...scope.included],
        },
      },
      {
        ...whole,
        chapterScope: {
          ...scope,
          included: [{ ...scope.included[0], title: "PRIVATE" }],
        },
      },
      {
        ...whole,
        chapterScope: {
          ...scope,
          included: [
            { ...scope.included[0], representations: ["original", "original"] },
          ],
        },
      },
    ])
      expect(CreativeQualityAdoptionFactSchema.safeParse(changed).success).toBe(
        false,
      );
    const record = {
      ...value,
      eventId: id(),
      cursor: 1,
      occurredAt: "2026-10-04T00:00:00.000Z",
    };
    const link = {
      relation: "exact-target-version",
      outcomeKind: "novel.chapter-adopted",
      objectId: value.target.id,
      unitKey: "a".repeat(64),
      formalVersion: { kind: "chapter", id: value.target.id, version: 1 },
    };
    expect(
      CreativeQualityAssociationSchema.safeParse({ ...record, links: [link] })
        .success,
    ).toBe(true);
    for (const changed of [
      { ...link, formalVersion: { ...link.formalVersion, version: 2 } },
      {
        ...link,
        formalVersion: { ...link.formalVersion, kind: "episode-script" },
      },
      { ...link, outcomeKind: "novel.chapter-memory-written" },
      { ...link, relation: "explicit-chapter-scope" },
    ])
      expect(
        CreativeQualityAssociationSchema.safeParse({
          ...record,
          links: [changed],
        }).success,
      ).toBe(false);
    expect(
      CreativeQualityAssociationSchema.safeParse({
        ...record,
        links: [link, link],
      }).success,
    ).toBe(false);
  });

  it("quality associations join exact own historical versions regardless of arrival order, preserving scopes, unmatched saved identities and unchanged outcome counts", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeQualityAssociationMigration.sql);
    const chapterId = id();
    const report = qualityFact(projectId, chapterId);
    const first = qualityEnvelope(report, 2);
    const read = () =>
      database.uow.execute((tx) =>
        measureCreativeQualityAssociations(tx, projectId),
      );
    try {
      database.uow.execute((tx) => projectCreativeQualityAdoption(tx, first));
      expect(read()).toMatchObject({
        recordedReports: 1,
        reportsWithoutRecordedOutcome: 1,
        linkedResultUnits: 0,
      });
      const at = "2026-10-04T00:00:00.000Z";
      const adopted = envelope(fact(projectId, chapterId), 1, at);
      database.uow.execute((tx) => projectCreativeOutcome(tx, adopted));
      expect(read()).toMatchObject({
        recordedReports: 1,
        reportsWithExactTarget: 1,
        linkedResultUnits: 1,
      });
      const scope = CreativeQualityAdoptionFactSchema.parse({
        ...qualityFact(projectId),
        target: { kind: "chapter-set", id: projectId, version: 0 },
        chapterScope: {
          mode: "selection",
          included: [
            {
              id: chapterId,
              version: 1,
              representations: ["summary", "paragraphs"],
            },
            { id: id(), version: 7, representations: ["hierarchical-summary"] },
          ],
          totalChapterCount: 4,
          nonEmptyChapterCount: 3,
        },
      });
      const ordinary = CreativeQualityAdoptionFactSchema.parse({
        ...qualityFact(projectId),
        target: {
          kind: "script",
          id: chapterId,
          version: 1,
          sourceFingerprint: "a".repeat(64),
        },
      });
      const otherVersion = CreativeQualityAdoptionFactSchema.parse({
        ...qualityFact(projectId, chapterId),
        target: { ...report.target, version: 2 },
      });
      for (const [index, value] of [scope, ordinary, otherVersion].entries())
        database.uow.execute((tx) =>
          projectCreativeQualityAdoption(tx, qualityEnvelope(value, 3 + index)),
        );
      const original = read();
      expect(original).toMatchObject({
        recordedReports: 4,
        reportsWithExactTarget: 1,
        reportsWithScopeMembers: 1,
        reportsWithoutRecordedOutcome: 2,
        linkedResultUnits: 1,
      });
      expect(
        original.items.find((item) => item.report.id === scope.report.id),
      ).toMatchObject({
        chapterScope: scope.chapterScope,
        links: [
          {
            relation: "explicit-chapter-scope",
            formalVersion: { kind: "chapter", id: chapterId, version: 1 },
          },
        ],
      });
      expect(
        original.items.find((item) => item.report.id === ordinary.report.id)!
          .links,
      ).toEqual([]);
      for (const event of [
        first,
        {
          ...first,
          eventId: id(),
          cursor: 8,
          occurredAt: "2026-10-05T00:00:00.000Z",
        },
      ])
        database.uow.execute((tx) => projectCreativeQualityAdoption(tx, event));
      database.uow.execute((tx) =>
        projectCreativeOutcome(tx, { ...adopted, eventId: id(), cursor: 9 }),
      );
      expect(read()).toEqual(original);
      database.uow.execute((tx) =>
        projectCreativeOutcome(tx, envelope(fact(other, chapterId), 10, at)),
      );
      expect(read()).toEqual(original);
      expect(
        database.uow
          .execute((tx) => countCreativeOutcomes(tx, projectId, at))
          .find((item) => item.kind === "novel.chapter-adopted")!.total,
      ).toBe(1);
      expect(JSON.stringify(original)).not.toContain("PRIVATE");
      expect(
        original.items.every(
          (item) =>
            item.qualityState === "unverified" &&
            item.currentValidity === "unknown" &&
            item.modelEvidence === "unknown",
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("quality report history keeps all deduplicated counts but only the latest twenty receipts and never counts repeated reports as additional outcome units", () => {
    const { database, projectId } = fixture();
    database.sqlite.exec(creativeQualityAssociationMigration.sql);
    const chapterId = id();
    try {
      const adopted = envelope(
        fact(projectId, chapterId),
        1,
        "2026-10-04T00:00:00.000Z",
      );
      database.uow.execute((tx) => projectCreativeOutcome(tx, adopted));
      const events = Array.from({ length: 25 }, (_, index) =>
        qualityEnvelope(qualityFact(projectId, chapterId), index + 2),
      );
      for (const event of events)
        database.uow.execute((tx) => projectCreativeQualityAdoption(tx, event));
      const original = database.uow.execute((tx) =>
        measureCreativeQualityAssociations(tx, projectId),
      );
      expect(original).toMatchObject({
        recordedReports: 25,
        reportsWithExactTarget: 25,
        reportsWithScopeMembers: 0,
        reportsWithoutRecordedOutcome: 0,
        linkedResultUnits: 1,
      });
      expect(original.items).toHaveLength(20);
      expect(original.items.map((item) => item.report.id)).toEqual(
        events
          .slice(5)
          .reverse()
          .map(
            (event) =>
              (event.payload as ReturnType<typeof qualityFact>).report.id,
          ),
      );
      for (const event of events)
        database.uow.execute((tx) =>
          projectCreativeQualityAdoption(tx, {
            ...event,
            eventId: id(),
            cursor: event.cursor + 100,
          }),
        );
      database.uow.execute((tx) =>
        projectCreativeOutcome(tx, { ...adopted, eventId: id(), cursor: 200 }),
      );
      expect(
        database.uow.execute((tx) =>
          measureCreativeQualityAssociations(tx, projectId),
        ),
      ).toEqual(original);
      expect(
        database.uow
          .execute((tx) =>
            countCreativeOutcomes(tx, projectId, adopted.occurredAt),
          )
          .find((item) => item.kind === "novel.chapter-adopted")!.total,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("quality adoption projection rolls back target failures and rejects mutated report ownership, receipt metadata or version instead of refreshing history", () => {
    const { database, projectId, other } = fixture();
    database.sqlite.exec(creativeQualityAssociationMigration.sql);
    const value = qualityFact(projectId);
    const event = qualityEnvelope(value, 1);
    try {
      database.sqlite.exec(
        "CREATE TEMP TRIGGER quality_target_failure BEFORE INSERT ON insights_creative_quality_targets BEGIN SELECT RAISE(ABORT, 'controlled quality target failure'); END",
      );
      expect(() =>
        database.uow.execute((tx) => projectCreativeQualityAdoption(tx, event)),
      ).toThrow("controlled quality target failure");
      expect(
        database.uow.execute((tx) =>
          measureCreativeQualityAssociations(tx, projectId),
        ).recordedReports,
      ).toBe(0);
      database.sqlite.exec("DROP TRIGGER quality_target_failure");
      database.uow.execute((tx) => projectCreativeQualityAdoption(tx, event));
      const original = database.uow.execute((tx) =>
        measureCreativeQualityAssociations(tx, projectId),
      );
      for (const changed of [
        { ...event, occurredAt: "2026-10-05T00:00:00.000Z" },
        { ...event, pluginId: "production" },
        { ...event, aggregateType: "chapter" },
        { ...event, aggregateVersion: 2 },
        {
          ...event,
          eventId: id(),
          cursor: 2,
          payload: { ...value, projectId: other },
        },
        {
          ...event,
          eventId: id(),
          cursor: 2,
          payload: { ...value, workflowId: id() },
        },
        {
          ...event,
          eventId: id(),
          cursor: 2,
          aggregateVersion: 2,
          payload: { ...value, report: { ...value.report, version: 2 } },
        },
        {
          ...event,
          payload: { ...value, target: { ...value.target, version: 2 } },
        },
      ])
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativeQualityAdoption(tx, changed),
          ),
        ).toThrow();
      expect(
        database.uow.execute((tx) =>
          measureCreativeQualityAssociations(tx, projectId),
        ),
      ).toEqual(original);
      expect(
        database.uow.execute((tx) =>
          measureCreativeQualityAssociations(tx, other),
        ).recordedReports,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
  it("records actual chapter memory write batches without claiming human adoption or current narrative quality", () => {
    const { database, projectId } = fixture();
    try {
      const workflowId = id();
      const chapterId = id();
      const records = [
        {
          id: id(),
          version: 0,
          kind: "chapter-memories",
          contentFingerprint: "b".repeat(64),
        },
        {
          id: id(),
          version: 0,
          kind: "story-events",
          contentFingerprint: "c".repeat(64),
        },
      ];
      const value = {
        eventVersion: 1,
        kind: "novel.chapter-memory-written",
        workflowPath: "novel",
        projectId,
        objectId: workflowId,
        workflowId,
        formalVersions: records.map(({ id, version }) => ({
          kind: "knowledge-record",
          id,
          version,
        })),
        sourceVersions: [{ id: chapterId, version: 4 }],
        memoryWrite: {
          source: {
            id: chapterId,
            version: 4,
            contentFingerprint: "a".repeat(64),
          },
          records,
        },
        evidenceKind: "rule",
        modelEvidence: "unknown",
        qualityState: "unverified",
        resultStatus: "written",
      };
      expect(CreativeOutcomeFactSchema.safeParse(value).success).toBe(true);
      const event: DomainEvent = {
        ...envelope(fact(projectId), 1, new Date().toISOString()),
        type: "knowledge.chapter-memory-written.v1",
        pluginId: "knowledge",
        aggregateType: "creation",
        aggregateId: workflowId,
        aggregateVersion: 1,
        payload: value,
      };
      for (const changed of [
        { ...value, evidenceKind: "human" },
        { ...value, resultStatus: "adopted" },
        { ...value, objectId: id() },
        { ...value, workflowId: undefined },
        { ...value, memoryWrite: undefined },
        { ...value, formalVersions: value.formalVersions.slice(1) },
        { ...value, sourceVersions: [{ id: chapterId, version: 3 }] },
        { ...value, candidate: { workflowId } },
        { ...value, continuationTarget: { id: chapterId } },
        {
          ...value,
          memoryWrite: { ...value.memoryWrite, records: [] },
        },
        {
          ...value,
          memoryWrite: {
            ...value.memoryWrite,
            records: [records[0], records[0]],
          },
        },
        {
          ...value,
          memoryWrite: {
            ...value.memoryWrite,
            source: { ...value.memoryWrite.source, content: "private text" },
          },
        },
        {
          ...value,
          memoryWrite: {
            ...value.memoryWrite,
            records: records.map((record) => ({
              ...record,
              evidence: "private quote",
            })),
          },
        },
        { ...fact(projectId), memoryWrite: value.memoryWrite },
      ])
        expect(CreativeOutcomeFactSchema.safeParse(changed).success).toBe(
          false,
        );
      database.uow.execute((tx) => projectCreativeOutcome(tx, event));
      database.uow.execute((tx) => projectCreativeOutcome(tx, event));
      const duplicate = { ...event, eventId: id(), cursor: 2 };
      database.uow.execute((tx) => projectCreativeOutcome(tx, duplicate));
      for (const changed of [
        { ...event, pluginId: "writing", eventId: id(), cursor: 3 },
        { ...event, aggregateType: "chapter", eventId: id(), cursor: 3 },
        { ...event, aggregateVersion: 0, eventId: id(), cursor: 3 },
      ])
        expect(() =>
          database.uow.execute((tx) => projectCreativeOutcome(tx, changed)),
        ).toThrow();
      const counts = database.uow.execute((tx) =>
        countCreativeOutcomes(tx, projectId, new Date().toISOString()),
      );
      expect(
        counts.find((item) => item.kind === "novel.chapter-memory-written"),
      ).toMatchObject({ total: 1 });
      expect(
        counts.find((item) => item.kind === "novel.chapter-adopted"),
      ).toMatchObject({ total: 0 });
      expect(
        creativeOutcomeUnitKey(CreativeOutcomeFactSchema.parse(value)),
      ).toBe(
        creativeOutcomeUnitKey(
          CreativeOutcomeFactSchema.parse({
            ...value,
            formalVersions: [...value.formalVersions].reverse(),
            memoryWrite: {
              ...value.memoryWrite,
              records: [...records].reverse(),
            },
          }),
        ),
      );
    } finally {
      database.close();
    }
  });
  it("counts the first formal version once, using an exact rolling seven-day boundary and never the newest duplicate receipt time", () => {
    const { database, projectId, other } = fixture();
    try {
      const to = "2026-10-02T12:00:00.000Z";
      const events = [
        envelope(fact(projectId), 1, "2026-09-25T11:59:59.999Z"),
        envelope(fact(projectId), 2, "2026-09-25T12:00:00.000Z"),
        envelope(fact(projectId), 3, to),
        envelope(fact(projectId), 4, "2026-10-02T12:00:00.001Z"),
        envelope(fact(other), 5, to),
      ];
      for (const event of events)
        database.uow.execute((tx) => projectCreativeOutcome(tx, event));
      const duplicate = {
        ...events[0]!,
        eventId: id(),
        cursor: 6,
        occurredAt: to,
      };
      database.uow.execute((tx) => projectCreativeOutcome(tx, duplicate));
      const counts = database.uow.execute((tx) =>
        countCreativeOutcomes(tx, projectId, to),
      );
      expect(
        counts.find((item) => item.kind === "novel.chapter-adopted"),
      ).toEqual({ kind: "novel.chapter-adopted", total: 4, lastSevenDays: 2 });
      expect(
        counts
          .filter((item) => item.kind !== "novel.chapter-adopted")
          .every((item) => item.total === 0),
      ).toBe(true);
      expect(
        database.uow.execute((tx) => countCreativeOutcomes(tx, other, to))[0]!
          .total,
      ).toBe(1);
    } finally {
      database.close();
    }
  });
  it("replays exact immutable events, rejects owner/version/object replacement and rolls back a partial projection", () => {
    const { database, projectId } = fixture();
    try {
      const event = envelope(fact(projectId), 1, new Date().toISOString());
      database.uow.execute((tx) => projectCreativeOutcome(tx, event));
      database.uow.execute((tx) => projectCreativeOutcome(tx, event));
      for (const altered of [
        { ...event, pluginId: "insights" },
        { ...event, aggregateId: id() },
        { ...event, aggregateVersion: 99 },
        { ...event, occurredAt: "2026-10-01T00:00:00.000Z" },
      ])
        expect(() =>
          database.uow.execute((tx) => projectCreativeOutcome(tx, altered)),
        ).toThrow();
      expect(() =>
        database.uow.execute((tx) => {
          projectCreativeOutcome(
            tx,
            envelope(fact(projectId), 2, new Date().toISOString()),
          );
          throw new Error("controlled rollback");
        }),
      ).toThrow("controlled rollback");
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM insights_creative_outcome_events"),
        ),
      ).toHaveLength(1);
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM insights_creative_outcome_units"),
        ),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
  it("strict facts cannot carry manuscript, prompt, key, path, provider-inferred model proof or a false saved receipt", () => {
    const value = fact(id());
    for (const key of [
      "content",
      "prompt",
      "apiKey",
      "absolutePath",
      "title",
      "actualCost",
    ])
      expect(
        CreativeOutcomeFactSchema.safeParse({ ...value, [key]: "private" })
          .success,
      ).toBe(false);
    for (const changed of [
      { ...value, modelEvidence: "real-model" },
      { ...value, evidenceKind: "rule" },
      { ...value, resultStatus: "saved" },
      { ...value, formalVersions: [] },
      {
        ...value,
        formalVersions: [...value.formalVersions, ...value.formalVersions],
      },
    ])
      expect(CreativeOutcomeFactSchema.safeParse(changed).success).toBe(false);
    const manuscript = CreativeOutcomeFactSchema.parse({
      ...value,
      objectId: id(),
      kind: "novel.manuscript-exported",
      evidenceKind: "rule",
      resultStatus: "saved",
      receipt: {
        artifactRef: id(),
        sha256: "a".repeat(64),
        byteSize: 10,
        savedAt: new Date().toISOString(),
      },
      formalVersions: [
        ...value.formalVersions,
        { kind: "chapter", id: id(), version: 0 },
      ],
    });
    expect(creativeOutcomeUnitKey(manuscript)).toBe(
      creativeOutcomeUnitKey({
        ...manuscript,
        objectId: id(),
        formalVersions: [...manuscript.formalVersions].reverse(),
        receipt: {
          ...manuscript.receipt!,
          artifactRef: id(),
          sha256: "b".repeat(64),
        },
      }),
    );
    expect(creativeOutcomeUnitKey(manuscript)).not.toBe(
      creativeOutcomeUnitKey({
        ...manuscript,
        formalVersions: manuscript.formalVersions.map((item) => ({
          ...item,
          version: item.version + 1,
        })),
      }),
    );
  });
});

describe("actual first-candidate metrics", () => {
  const requestedAt = "2026-10-02T00:00:00.000Z";
  it("whole-book collection observations require complete same-project inventory and actual nonempty membership, never a selected scope, hash, reorder or unavailable read", () => {
    const projectId = id();
    const frozenId = id();
    const addedId = id();
    const basis = { scope: "whole-book", chapters: [{ id: frozenId }] };
    const original = { id: frozenId, projectId, content: "PRIVATE body" };
    const added = {
      id: addedId,
      projectId,
      content: "PRIVATE additional body",
    };
    const observe = (
      current: Parameters<typeof observedCreativeWholeBookCollection>[2],
    ) => observedCreativeWholeBookCollection(projectId, basis, current);
    const value = observe([original, added]);
    expect(value).toEqual({
      scope: "whole-book",
      inventory: "nonempty-chapters",
      inventoryOwner: "writing",
      completeness: "complete-owner-inventory",
      frozenIds: [frozenId],
      currentIds: [frozenId, addedId].sort(),
    });
    expect(JSON.stringify(value)).not.toContain("PRIVATE");
    expect(observe(undefined)).toBeUndefined();
    expect(observe([original])).toBeUndefined();
    expect(
      observe([
        { ...original, content: "PRIVATE same identity changed prose" },
      ]),
    ).toBeUndefined();
    expect(observe([original, { ...added, content: " \n " }])).toBeUndefined();
    expect(observe([original, { ...added, projectId: id() }])).toBeUndefined();
    expect(observe([original, added, added])).toBeUndefined();
    expect(
      observedCreativeWholeBookCollection(
        projectId,
        { ...basis, scope: "selected-chapters" },
        [original, added],
      ),
    ).toBeUndefined();
    expect(
      observedCreativeWholeBookCollection(
        projectId,
        { ...basis, chapters: [{ id: frozenId }, { id: frozenId }] },
        [original, added],
      ),
    ).toBeUndefined();
    expect(observe([])).toMatchObject({
      frozenIds: [frozenId],
      currentIds: [],
    });
    expect(observe([{ ...original, content: " " }])).toMatchObject({
      frozenIds: [frozenId],
      currentIds: [],
    });
    expect(
      observedCreativeWholeBookCollection(
        projectId,
        { scope: "whole-book", chapters: [{ id: frozenId }, { id: addedId }] },
        [added, original],
      ),
    ).toBeUndefined();
  });

  it("native complete whole-book collection differences keep original candidates, reject invented versions and partial reads, and never widen ordinary source facts", () => {
    const { database, projectId } = fixture();
    try {
      const originalRequest = request(projectId, "adaptation.diagnosis");
      const originalCandidate = candidate(originalRequest);
      if (originalCandidate.kind !== "candidate-ready")
        throw new Error("fixture");
      const frozenId = id();
      const addedId = id();
      const chapterCollection = {
        scope: "whole-book",
        inventory: "nonempty-chapters",
        inventoryOwner: "writing",
        completeness: "complete-owner-inventory",
        frozenIds: [frozenId],
        currentIds: [frozenId, addedId].sort(),
      };
      const raw = {
        eventVersion: 1,
        kind: "owner-rejection",
        projectId,
        workflowId: originalRequest.workflowId,
        workflowPath: "adaptation",
        metric: "adaptation.diagnosis",
        candidate: originalCandidate.candidate,
        ownerRejection: {
          owner: "production",
          aggregateType: "adaptation-diagnosis",
          stateVersion: 1,
        },
        evidenceKind: "rule",
        modelEvidence: "unknown",
        sourceConflict: {
          projectId,
          workflowId: originalRequest.workflowId,
          changes: [],
          chapterCollection,
        },
      };
      expect(CreativeOwnerRejectionFactSchema.safeParse(raw).success).toBe(
        true,
      );
      const native = CreativeOwnerRejectionFactSchema.parse(raw);
      for (const changed of [
        { ...chapterCollection, scope: "selected-chapters" },
        { ...chapterCollection, completeness: "partial-page" },
        { ...chapterCollection, currentIds: [frozenId] },
        {
          ...chapterCollection,
          frozenIds: [frozenId, addedId],
          currentIds: [addedId, frozenId],
        },
        { ...chapterCollection, currentIds: [frozenId, addedId, addedId] },
        { ...chapterCollection, directoryVersion: 99 },
        { ...chapterCollection, content: "PRIVATE collection prose" },
      ])
        expect(
          CreativeOwnerRejectionFactSchema.safeParse({
            ...raw,
            sourceConflict: {
              ...raw.sourceConflict,
              chapterCollection: changed,
            },
          }).success,
        ).toBe(false);
      expect(
        CreativeOwnerRejectionFactSchema.safeParse({
          ...raw,
          sourceConflict: {
            ...raw.sourceConflict,
            chapterCollection: { ...chapterCollection, currentIds: [] },
          },
        }).success,
      ).toBe(true);
      expect(
        CreativeFunnelFactSchema.safeParse({
          ...originalCandidate,
          kind: "source-conflict",
          workflowVersion: originalCandidate.workflowVersion + 1,
          sourceConflict: raw.sourceConflict,
        }).success,
      ).toBe(false);
      const event: DomainEvent = {
        eventId: id(),
        cursor: 3,
        occurredAt: requestedAt,
        type: "production.creative-adoption-rejected.v1",
        pluginId: "production",
        aggregateType: "adaptation-diagnosis",
        aggregateId: native.candidate.id,
        aggregateVersion: 1,
        payload: native,
      };
      for (const prior of [
        funnelEvent(originalRequest, 1),
        funnelEvent(originalCandidate, 2),
        event,
      ])
        database.uow.execute((tx) => projectCreativeFunnel(tx, prior));
      const measured = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      );
      const actual = measured.measures.find(
        (item) => item.metric === native.metric,
      )!;
      expect(actual).toMatchObject({
        firstCandidates: 1,
        pendingDecision: 1,
        adoptionRejectedCount: 1,
        sourceConflictCandidateCount: 1,
        lastSourceConflict: {
          candidate: originalCandidate.candidate,
          sourceConflict: native.sourceConflict,
          ownerRejection: native.ownerRejection,
        },
      });
      database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, {
          ...event,
          eventId: id(),
          cursor: 4,
          occurredAt: "2026-10-03T00:00:00.000Z",
        }),
      );
      expect(
        database.uow.execute((tx) => measureCreativeFunnel(tx, projectId)),
      ).toEqual(measured);
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativeFunnel(tx, {
            ...event,
            eventId: id(),
            cursor: 5,
            payload: CreativeOwnerRejectionFactSchema.parse({
              ...raw,
              sourceConflict: {
                ...raw.sourceConflict,
                chapterCollection: { ...chapterCollection, currentIds: [] },
              },
            }),
          }),
        ),
      ).toThrow("immutable");
      expect(
        CreativeFunnelSummarySchema.safeParse({
          ...measured,
          measures: measured.measures.map((item) => {
            if (!item.lastSourceConflict) return item;
            const { ownerRejection: _owner, ...ordinary } =
              item.lastSourceConflict;
            return { ...item, lastSourceConflict: ordinary };
          }),
        }).success,
      ).toBe(false);
      expect(JSON.stringify(measured)).not.toContain("PRIVATE");
    } finally {
      database.close();
    }
  });
  it("projects native owner rejections without invented workflow revisions, joins only exact prior candidates and preserves delayed immutable decisions", () => {
    const { database, projectId, other } = fixture();
    try {
      const originalRequest = request(projectId, "adaptation.strategy");
      const originalCandidate = candidate(originalRequest);
      if (originalCandidate.kind !== "candidate-ready")
        throw new Error("candidate required");
      const sourceId = id();
      const native = {
        eventVersion: 1,
        kind: "owner-rejection",
        projectId,
        workflowId: originalRequest.workflowId,
        workflowPath: "adaptation",
        metric: "adaptation.strategy",
        candidate: originalCandidate.candidate,
        ownerRejection: {
          owner: "production",
          aggregateType: "adaptation-strategy",
          stateVersion: 1,
        },
        evidenceKind: "rule",
        modelEvidence: "unknown",
        sourceConflict: {
          projectId,
          workflowId: originalRequest.workflowId,
          changes: [
            {
              sourceKind: "chapter",
              frozen: { id: sourceId, version: 0 },
              current: { id: sourceId, version: 1 },
            },
          ],
        },
      };
      const rejected: DomainEvent = {
        eventId: id(),
        cursor: 3,
        occurredAt: "2026-10-02T00:00:03.000Z",
        type: "production.creative-adoption-rejected.v1",
        pluginId: "production",
        aggregateType: "adaptation-strategy",
        aggregateId: originalCandidate.candidate.id,
        aggregateVersion: 1,
        payload: native,
      };
      expect(
        CreativeFunnelRecordSchema.safeParse({
          eventId: rejected.eventId,
          cursor: 3,
          occurredAt: rejected.occurredAt,
          fact: native,
        }).success,
      ).toBe(true);
      const commit = (event: DomainEvent) =>
        database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      commit(funnelEvent(originalRequest, 1));
      commit(funnelEvent(originalCandidate, 2));
      // A late durable projection never rewinds a subsequently discarded workflow.
      if (originalRequest.kind !== "request")
        throw new Error("request required");
      commit(
        funnelEvent(
          CreativeFunnelFactSchema.parse({
            eventVersion: 1,
            projectId,
            workflowId: originalRequest.workflowId,
            workflowVersion: 2,
            workflowPath: originalRequest.workflowPath,
            metric: originalRequest.metric,
            targetKey: originalRequest.targetKey,
            requestedAt,
            evidenceKind: "rule",
            modelEvidence: "unknown",
            kind: "state",
            state: "discarded",
          }),
          4,
        ),
      );
      const before = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      );
      expect(
        before.measures.find((item) => item.metric === "adaptation.strategy"),
      ).toMatchObject({
        closedWithoutFirstAdoption: 1,
        pendingDecision: 0,
        adoptionRejectedCount: 0,
        sourceConflictCandidateCount: 0,
      });
      commit(rejected);
      commit(rejected);
      commit({
        ...rejected,
        eventId: id(),
        cursor: 5,
        occurredAt: "2026-10-02T01:00:00.000Z",
      });
      const measured = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      );
      expect(
        measured.measures.find((item) => item.metric === "adaptation.strategy"),
      ).toMatchObject({
        closedWithoutFirstAdoption: 1,
        pendingDecision: 0,
        adoptionRejectedCount: 1,
        sourceConflictCandidateCount: 1,
        lastSourceConflict: {
          occurredAt: rejected.occurredAt,
          candidate: native.candidate,
          sourceConflict: native.sourceConflict,
          ownerRejection: native.ownerRejection,
        },
      });
      const stored = database.uow.execute((tx) =>
        tx.all(
          "SELECT * FROM insights_creative_funnel_events ORDER BY source_cursor",
        ),
      );
      expect(() =>
        commit({
          ...rejected,
          eventId: id(),
          cursor: 6,
          payload: {
            ...native,
            sourceConflict: {
              ...native.sourceConflict,
              changes: [
                {
                  ...native.sourceConflict.changes[0],
                  current: { id: sourceId, version: 2 },
                },
              ],
            },
          },
        }),
      ).toThrow(/immutable|replaced/u);
      for (const scope of [
        { projectId, workflowId: id() },
        { projectId: other, workflowId: native.workflowId },
      ])
        expect(() =>
          commit({
            ...rejected,
            eventId: id(),
            cursor: 7,
            payload: {
              ...native,
              ...scope,
              sourceConflict: { ...native.sourceConflict, ...scope },
            },
          }),
        ).toThrow(/immutable|replaced/u);
      for (const wrong of [
        { pluginId: "automation" },
        { aggregateType: "creation" },
        { aggregateId: id() },
        { aggregateVersion: 2 },
        { type: "automation.creative-source-conflict.v1" },
      ])
        expect(() =>
          commit({ ...rejected, eventId: id(), cursor: 7, ...wrong }),
        ).toThrow();
      expect(
        database.uow.execute((tx) =>
          tx.all(
            "SELECT * FROM insights_creative_funnel_events ORDER BY source_cursor",
          ),
        ),
      ).toEqual(stored);
      // The owner's true unclassified decision is not a source difference.
      const nextRequest = request(projectId, "adaptation.strategy", {
        targetAttempt: 2,
      });
      const nextCandidate = candidate(nextRequest);
      if (nextCandidate.kind !== "candidate-ready")
        throw new Error("candidate required");
      commit(funnelEvent(nextRequest, 8));
      commit(funnelEvent(nextCandidate, 9));
      const generic = CreativeOwnerRejectionFactSchema.parse(
        Object.fromEntries(
          Object.entries({
            ...native,
            workflowId: nextRequest.workflowId,
            candidate: nextCandidate.candidate,
          }).filter(([key]) => key !== "sourceConflict"),
        ),
      );
      commit({
        ...rejected,
        eventId: id(),
        cursor: 10,
        aggregateId: nextCandidate.candidate.id,
        payload: generic,
      });
      // Old workflows and human reorder candidates remain owner history, not AI first candidates.
      for (const [cursor, workflowId, candidateId] of [
        [11, id(), id()],
        [12, originalRequest.workflowId, id()],
      ] as const) {
        commit({
          ...rejected,
          eventId: id(),
          cursor,
          aggregateId: candidateId,
          payload: {
            ...generic,
            workflowId,
            candidate: { ...native.candidate, id: candidateId },
          },
        });
      }
      expect(
        database.uow
          .execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures.find((item) => item.metric === "adaptation.strategy"),
      ).toMatchObject({
        recordedRequests: 2,
        firstCandidates: 1,
        adoptionRejectedCount: 2,
        sourceConflictCandidateCount: 1,
      });
      expect(
        database.uow
          .execute((tx) => measureCreativeFunnel(tx, other))
          .measures.every(
            (item) =>
              item.adoptionRejectedCount === 0 &&
              item.sourceConflictCandidateCount === 0,
          ),
      ).toBe(true);
      for (const changed of [
        { ...native, workflowVersion: 99 },
        { ...native, targetKey: "a".repeat(64) },
        { ...native, requestedAt },
        {
          ...native,
          ownerRejection: { ...native.ownerRejection, stateVersion: 0 },
        },
        {
          ...native,
          ownerRejection: {
            ...native.ownerRejection,
            aggregateType: "season-plan",
          },
        },
        {
          ...native,
          candidate: { ...native.candidate, content: "PRIVATE candidate" },
        },
        {
          ...native,
          sourceConflict: { ...native.sourceConflict, projectId: other },
        },
        {
          ...native,
          sourceConflict: {
            ...native.sourceConflict,
            changes: [
              { ...native.sourceConflict.changes[0], sourceKind: "knowledge" },
            ],
          },
        },
      ])
        expect(
          CreativeFunnelRecordSchema.safeParse({
            eventId: id(),
            cursor: 20,
            occurredAt: requestedAt,
            fact: changed,
          }).success,
        ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("observes only actual source differences and adopted intent identity, not unavailable, unchanged or legacy unbound sources", () => {
    const workflow = CreationWorkflowSchema.parse({
      id: id(),
      taskId: id(),
      input: {
        projectId: id(),
        operation: "chapter",
        targetId: id(),
        baseVersion: 0,
        instruction: "private",
        engineKind: "codex",
      },
      stage: "awaiting-review",
      version: 2,
      runIds: [],
      contextSnapshotIds: [],
      sources: [],
      preparedPrompt: "private",
      issues: [],
      createdAt: requestedAt,
      updatedAt: requestedAt,
    });
    const frozen = { id: id(), version: 1 };
    expect(() =>
      assertCreationSourceVersionCurrent(
        workflow,
        "chapter",
        frozen,
        frozen,
        "source changed",
      ),
    ).not.toThrow();
    for (const current of [undefined, { id: "unavailable", version: 2 }]) {
      let caught: unknown;
      try {
        assertCreationSourceVersionCurrent(
          workflow,
          "chapter",
          frozen,
          current,
          "source changed",
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(CreationSourceConflictError);
    }
    expect(() =>
      assertCreationSourceVersionCurrent(
        workflow,
        "chapter",
        frozen,
        { ...frozen, version: 2 },
        "source changed",
      ),
    ).toThrow(CreationSourceConflictError);
    workflow.authorIntent = {
      state: "adopted",
      projectId: workflow.input.projectId,
      ...frozen,
    };
    expect(() =>
      assertCreationAuthorIntentCurrent(workflow, {
        state: "adopted",
        projectId: workflow.input.projectId,
        id: id(),
        version: 1,
      }),
    ).toThrow(CreationSourceConflictError);
    expect(() =>
      assertCreationAuthorIntentCurrent(workflow, {
        state: "none",
        projectId: workflow.input.projectId,
      }),
    ).not.toThrow(CreationSourceConflictError);
    workflow.referenceVersions = [
      { sourceId: frozen.id, sourceVersion: 1, fieldPath: "/project" },
    ];
    expect(() =>
      assertCreationReferencesCurrent(workflow, [
        {
          sourceKind: "project",
          sourceId: frozen.id,
          sourceVersion: 2,
          fieldPath: "/project",
          value: "private",
          sensitivity: "project",
        },
      ]),
    ).toThrow(CreationSourceConflictError);
    let missing: unknown;
    try {
      assertCreationReferencesCurrent(workflow, []);
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(Error);
    expect(missing).not.toBeInstanceOf(CreationSourceConflictError);
  });
  it("requires an actual candidate and body-free differing source versions for source conflicts, dedupes rejected candidates and keeps generic rejections separate", () => {
    const { database, projectId, other } = fixture();
    try {
      const initial = request(projectId);
      const ready = candidate(initial);
      if (ready.kind !== "candidate-ready") throw new Error("fixture");
      const sourceId = id();
      const rejected = CreativeFunnelFactSchema.parse({
        ...ready,
        kind: "source-conflict",
        workflowVersion: ready.workflowVersion + 1,
        sourceConflict: {
          projectId,
          workflowId: initial.workflowId,
          changes: [
            {
              sourceKind: "chapter",
              frozen: { id: sourceId, version: 0 },
              current: { id: sourceId, version: 1 },
            },
          ],
        },
      });
      const event = {
        ...funnelEvent(rejected, 3),
        type: "automation.creative-source-conflict.v1",
      };
      expect(() =>
        database.uow.execute((tx) => projectCreativeFunnel(tx, event)),
      ).toThrow();
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, funnelEvent(initial, 1)),
      );
      expect(() =>
        database.uow.execute((tx) => projectCreativeFunnel(tx, event)),
      ).toThrow();
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, funnelEvent(ready, 2)),
      );
      for (const patch of [
        { pluginId: "writing" },
        { aggregateId: id() },
        { aggregateType: "chapter" },
        {
          payload: {
            ...rejected,
            candidate: {
              ...ready.candidate,
              contentFingerprint: "f".repeat(64),
            },
          },
        },
      ])
        expect(() =>
          database.uow.execute((tx) =>
            projectCreativeFunnel(tx, { ...event, ...patch }),
          ),
        ).toThrow();
      database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, { ...event, eventId: id(), cursor: 4 }),
      );
      const generic = CreativeFunnelFactSchema.parse({
        eventVersion: 1,
        projectId,
        workflowId: initial.workflowId,
        workflowPath: initial.workflowPath,
        metric: initial.metric,
        targetKey: initial.targetKey,
        requestedAt,
        evidenceKind: "rule",
        modelEvidence: "unknown",
        kind: "state",
        workflowVersion: 5,
        state: "adoption-rejected",
      });
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, funnelEvent(generic, 5)),
      );
      const measure = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      ).measures[0]!;
      expect(measure).toMatchObject({
        sourceConflictCandidateCount: 1,
        adoptionRejectedCount: 1,
        pendingDecision: 1,
        firstAdopted: 0,
        lastSourceConflict: {
          candidate: ready.candidate,
          sourceConflict:
            rejected.kind === "source-conflict"
              ? rejected.sourceConflict
              : undefined,
        },
      });
      expect(
        database.uow.execute((tx) => measureCreativeFunnel(tx, other))
          .measures[0],
      ).toMatchObject({
        sourceConflictCandidateCount: 0,
        lastSourceConflict: null,
      });
      for (const change of [
        {
          sourceKind: "chapter",
          frozen: { id: sourceId, version: 0 },
          current: { id: sourceId, version: 0 },
        },
        { sourceKind: "chapter", frozen: { id: sourceId, version: 0 } },
        {
          sourceKind: "chapter",
          frozen: { id: sourceId, version: 0 },
          current: { id: sourceId, version: 1 },
          evidence: "private source prose",
        },
      ])
        expect(
          CreativeFunnelFactSchema.safeParse({
            ...rejected,
            sourceConflict: {
              projectId,
              workflowId: initial.workflowId,
              changes: [change],
            },
          }).success,
        ).toBe(false);
      expect(
        CreativeFunnelFactSchema.safeParse({
          ...rejected,
          sourceConflict: {
            projectId: other,
            workflowId: initial.workflowId,
            changes: [],
          },
        }).success,
      ).toBe(false);
      expect(JSON.stringify(measure)).not.toContain("private");
    } finally {
      database.close();
    }
  });
  it("uses Automation's complete actual request history without backfilling legacy candidates and commits receipt facts together", () => {
    const { database, projectId, other } = fixture();
    const eventSchemas = new DomainEventSchemaRegistry(DOMAIN_EVENT_MANIFEST);
    database.uow.setEventValidator((event) => eventSchemas.validate(event));
    try {
      database.sqlite.exec(creationMigrations[0]!.sql);
      database.sqlite.exec(creativeMetricMigration.sql);
      const chapterId = id();
      const make = (targetId: string = chapterId, sourceWorkflowId?: string) =>
        CreationWorkflowSchema.parse({
          id: id(),
          taskId: id(),
          input: {
            projectId,
            operation: "chapter",
            targetId,
            baseVersion: 0,
            instruction: "private author intent",
            engineKind: "codex",
          },
          stage: "preparing",
          version: 0,
          sourceWorkflowId,
          runIds: [],
          contextSnapshotIds: [],
          sources: [{ kind: "chapter", id: targetId, version: 0 }],
          preparedPrompt: "private prompt",
          issues: [],
          createdAt: requestedAt,
          updatedAt: requestedAt,
        });
      const persist = (value: ReturnType<typeof make>) =>
        database.uow.execute((tx) =>
          tx.run(
            "INSERT INTO automation_creation_workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            value.id,
            projectId,
            value.input.targetId!,
            value.stage,
            value.version,
            id(),
            "hash",
            JSON.stringify(value),
            requestedAt,
            requestedAt,
          ),
        );
      const legacy = CreationWorkflowSchema.parse({
        ...make(),
        stage: "awaiting-review",
        version: 3,
        previewId: id(),
        output: {
          title: "legacy private title",
          content: "legacy private candidate",
          items: [],
        },
      });
      persist(legacy);
      database.uow.execute((tx) => recordCreativeCandidate(tx, legacy));
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_creative_candidate_receipts"),
        ),
      ).toHaveLength(0);
      const current = make();
      persist(current);
      database.uow.execute((tx) => recordCreativeRequest(tx, current));
      const receipt = database.uow.execute((tx) =>
        tx.get<{ value_json: string }>(
          "SELECT value_json FROM automation_creative_request_receipts WHERE workflow_id = ?",
          current.id,
        ),
      )!;
      expect(JSON.parse(receipt.value_json)).toMatchObject({
        targetAttempt: 2,
        requestKind: "new-request",
      });
      const initial = make(id());
      persist(initial);
      database.uow.execute((tx) => recordCreativeRequest(tx, initial));
      const next = make(initial.input.targetId!, initial.id);
      persist(next);
      database.uow.execute((tx) => recordCreativeRequest(tx, next));
      expect(
        JSON.parse(
          database.uow.execute((tx) =>
            tx.get<{ value_json: string }>(
              "SELECT value_json FROM automation_creative_request_receipts WHERE workflow_id = ?",
              next.id,
            ),
          )!.value_json,
        ),
      ).toMatchObject({
        targetAttempt: 2,
        requestKind: "retry",
        parentWorkflowId: initial.id,
      });
      const ready = CreationWorkflowSchema.parse({
        ...initial,
        stage: "awaiting-review",
        version: 1,
        previewId: id(),
        output: {
          title: "private title",
          content: "private candidate",
          items: [],
        },
      });
      database.uow.execute((tx) => recordCreativeCandidate(tx, ready));
      database.uow.execute((tx) => recordCreativeCandidate(tx, ready));
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_creative_candidate_receipts"),
        ),
      ).toHaveLength(1);
      database.sqlite.exec(
        "CREATE TEMP TRIGGER controlled_candidate_receipt BEFORE INSERT ON automation_creative_candidate_receipts BEGIN SELECT RAISE(ABORT, 'controlled candidate receipt'); END;",
      );
      expect(() =>
        database.uow.execute((tx) =>
          recordCreativeCandidate(tx, {
            ...ready,
            output: { ...ready.output!, content: "different actual candidate" },
          }),
        ),
      ).toThrow("controlled candidate receipt");
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM automation_creative_candidate_receipts"),
        ),
      ).toHaveLength(1);
      const facts = database.uow.execute((tx) =>
        tx.all<{ payload_json: string }>(
          "SELECT payload_json FROM domain_events WHERE plugin_id = 'automation'",
        ),
      );
      expect(facts).toHaveLength(4);
      expect(JSON.stringify(facts)).not.toContain("private");
      const changes = [
        {
          sourceKind: "chapter" as const,
          frozen: { id: initial.input.targetId!, version: 0 },
          current: { id: initial.input.targetId!, version: 1 },
        },
      ];
      const observed = { projectId, workflowId: ready.id, changes };
      const rejected = {
        ...ready,
        version: 2,
        output: { ...ready.output!, content: "private edited preview" },
      };
      for (const value of [
        { ...observed, projectId: other },
        { ...observed, workflowId: id() },
        {
          ...observed,
          changes: [{ ...changes[0]!, sourceKind: "project" as const }],
        },
        {
          ...observed,
          changes: [{ ...changes[0]!, frozen: { id: id(), version: 0 } }],
        },
      ])
        database.uow.execute((tx) =>
          recordCreativeSourceConflict(tx, rejected, value),
        );
      database.uow.execute((tx) =>
        recordCreativeSourceConflict(tx, legacy, {
          projectId,
          workflowId: legacy.id,
          changes,
        }),
      );
      expect(
        database.uow.execute((tx) =>
          tx.all(
            "SELECT * FROM domain_events WHERE type = 'automation.creative-source-conflict.v1'",
          ),
        ),
      ).toHaveLength(0);
      const before = database.uow.execute((tx) =>
        tx.get(
          "SELECT * FROM automation_creation_workflows WHERE id = ?",
          ready.id,
        ),
      );
      database.sqlite.exec(
        "CREATE TEMP TRIGGER controlled_source_conflict_fact BEFORE INSERT ON domain_events WHEN NEW.type = 'automation.creative-source-conflict.v1' BEGIN SELECT RAISE(ABORT, 'controlled source conflict fact'); END",
      );
      expect(() =>
        database.uow.execute((tx) => {
          tx.run(
            "UPDATE automation_creation_workflows SET version = ?, value_json = ? WHERE id = ?",
            rejected.version,
            JSON.stringify(rejected),
            rejected.id,
          );
          recordCreativeSourceConflict(tx, rejected, observed);
        }),
      ).toThrow("controlled source conflict fact");
      expect(
        database.uow.execute((tx) =>
          tx.get(
            "SELECT * FROM automation_creation_workflows WHERE id = ?",
            ready.id,
          ),
        ),
      ).toEqual(before);
      database.sqlite.exec("DROP TRIGGER controlled_source_conflict_fact");
      database.uow.execute((tx) =>
        recordCreativeSourceConflict(tx, rejected, observed),
      );
      const rejectionFacts = database.uow.execute((tx) =>
        tx.all<{ payload_json: string }>(
          "SELECT payload_json FROM domain_events WHERE type = 'automation.creative-source-conflict.v1'",
        ),
      );
      expect(rejectionFacts).toHaveLength(1);
      expect(JSON.parse(rejectionFacts[0]!.payload_json)).toMatchObject({
        candidate: {
          id: ready.previewId,
          contentFingerprint: createHash("sha256")
            .update(canonicalCreativeMetricJSON(ready.output!.content))
            .digest("hex"),
        },
        sourceConflict: observed,
      });
      expect(JSON.stringify(rejectionFacts)).not.toContain("private");
      database.sqlite.exec("DROP TRIGGER controlled_candidate_receipt");
      for (const representation of [
        "original",
        "summary",
        "paragraphs",
        "higher-summary",
      ] as const) {
        const selected = id(),
          omitted = id();
        const frozen = { id: selected, version: 9 };
        const selectedTemplate = make(id());
        const initialSelected = CreationWorkflowSchema.parse({
          ...selectedTemplate,
          narrativeContextBasis: {
            kind: "author-selected-novel-context",
            target: { id: selectedTemplate.input.targetId!, version: 0 },
            chapters:
              representation === "higher-summary"
                ? []
                : [
                    {
                      ...frozen,
                      representation,
                      contentHash: "a".repeat(64),
                      ...(representation === "summary"
                        ? { record: { id: id(), version: 1 } }
                        : {}),
                      ...(representation === "paragraphs"
                        ? { paragraphIds: ["private paragraph identity"] }
                        : {}),
                    },
                  ],
            ...(representation === "higher-summary"
              ? {
                  summaries: [
                    {
                      id: id(),
                      version: 2,
                      target: { id: id(), version: 3, kind: "book" },
                      scopeTitle: "private scope title",
                      scopeFingerprint: "b".repeat(64),
                      scopeState: "stale",
                      chapters: [{ ...frozen, contentHash: "c".repeat(64) }],
                    },
                  ],
                }
              : {}),
            omitted: [{ id: omitted, version: 9, reason: "not-selected" }],
            references: [],
          },
        });
        persist(initialSelected);
        database.uow.execute((tx) =>
          recordCreativeRequest(tx, initialSelected),
        );
        const selectedReady = CreationWorkflowSchema.parse({
          ...initialSelected,
          stage: "awaiting-review",
          version: 1,
          previewId: id(),
          output: ready.output,
        });
        database.uow.execute((tx) =>
          recordCreativeCandidate(tx, selectedReady),
        );
        const selectedRejected = { ...selectedReady, version: 2 };
        const selectedEvidence = {
          projectId,
          workflowId: selectedReady.id,
          changes: [
            {
              sourceKind: "chapter" as const,
              frozen,
              current: { ...frozen, version: 10 },
            },
          ],
        };
        const rows = () =>
          database.uow.execute((tx) =>
            tx.all<{ payload_json: string }>(
              "SELECT payload_json FROM domain_events WHERE type = 'automation.creative-source-conflict.v1' AND aggregate_id = ?",
              selectedReady.id,
            ),
          );
        for (const invalid of [
          { ...selectedEvidence, projectId: other },
          {
            ...selectedEvidence,
            changes: [
              {
                ...selectedEvidence.changes[0]!,
                frozen: { id: omitted, version: 9 },
              },
            ],
          },
          {
            ...selectedEvidence,
            changes: [
              {
                ...selectedEvidence.changes[0]!,
                frozen: { ...frozen, version: 8 },
              },
            ],
          },
          {
            ...selectedEvidence,
            changes: [
              {
                ...selectedEvidence.changes[0]!,
                sourceKind: "knowledge" as const,
              },
            ],
          },
        ])
          database.uow.execute((tx) =>
            recordCreativeSourceConflict(tx, selectedRejected, invalid),
          );
        expect(rows()).toHaveLength(0);
        database.uow.execute((tx) =>
          recordCreativeSourceConflict(tx, selectedRejected, selectedEvidence),
        );
        expect(rows()).toHaveLength(1);
        expect(JSON.parse(rows()[0]!.payload_json).sourceConflict).toEqual(
          selectedEvidence,
        );
        expect(JSON.stringify(rows())).not.toContain("private");
      }
    } finally {
      database.close();
    }
  });
  function funnelEvent(
    fact: CreativeFunnelFact,
    cursor: number,
    occurredAt = requestedAt,
  ): DomainEvent {
    return {
      eventId: id(),
      cursor,
      occurredAt,
      pluginId: "automation",
      aggregateType: "creation",
      aggregateId: fact.workflowId,
      aggregateVersion: fact.workflowVersion,
      type:
        fact.kind === "request"
          ? "automation.creative-requested.v1"
          : fact.kind === "candidate-ready"
            ? "automation.creative-candidate-ready.v1"
            : fact.kind === "source-conflict"
              ? "automation.creative-source-conflict.v1"
              : "automation.creative-metric-state.v1",
      payload: fact,
    };
  }
  function request(
    projectId: string,
    metric: (typeof CreativeFunnelMetricSchema.options)[number] = "novel.chapter",
    extra = {},
  ) {
    return CreativeFunnelFactSchema.parse({
      eventVersion: 1,
      projectId,
      workflowId: id(),
      workflowVersion: 0,
      workflowPath: metric.split(".")[0],
      metric,
      targetKey: id().replaceAll("-", "").repeat(2),
      requestedAt,
      evidenceKind: "rule",
      modelEvidence: "unknown",
      kind: "request",
      targetAttempt: 1,
      requestKind: "new-request",
      sourceVersions: [],
      ...extra,
    });
  }
  function candidate(value: CreativeFunnelFact, extra = {}) {
    const {
      projectId,
      workflowId,
      workflowVersion,
      workflowPath,
      metric,
      targetKey,
      requestedAt,
      evidenceKind,
      modelEvidence,
    } = value;
    return CreativeFunnelFactSchema.parse({
      projectId,
      workflowId,
      workflowVersion: workflowVersion + 1,
      workflowPath,
      metric,
      targetKey,
      requestedAt,
      evidenceKind,
      modelEvidence,
      eventVersion: 1,
      kind: "candidate-ready",
      candidate: {
        id: id(),
        contentFingerprint: "a".repeat(64),
        ...(metric === "adaptation.strategy"
          ? {
              selectionOptions: [
                { id: "plain-option-1", contentFingerprint: "b".repeat(64) },
                { id: "plain-option-2", contentFingerprint: "c".repeat(64) },
              ],
            }
          : {}),
      },
      ...extra,
    });
  }
  function adoption(
    value: Extract<CreativeFunnelFact, { kind: "candidate-ready" }>,
    cursor: number,
    at = "2026-10-02T00:00:08.000Z",
    extra = {},
  ): DomainEvent {
    const objectId = id();
    const map = {
      "novel.chapter": [
        "novel.chapter-adopted",
        "writing.chapter-adopted.v1",
        "writing",
        "chapter",
      ],
      "adaptation.diagnosis": [
        "adaptation.diagnosis-adopted",
        "production.diagnosis-result-adopted.v1",
        "production",
        "diagnosis",
      ],
      "adaptation.strategy": [
        "adaptation.strategy-adopted",
        "production.adaptation-strategy-result-adopted.v1",
        "production",
        "adaptation-strategy",
      ],
      "adaptation.season-plan": [
        "adaptation.season-plan-adopted",
        "production.season-plan-result-adopted.v1",
        "production",
        "season-plan",
      ],
      "adaptation.script": [
        "adaptation.script-adopted",
        "production.script-result-adopted.v1",
        "production",
        "episode-script",
      ],
    } as const;
    const [kind, type, pluginId, formalKind] = map[value.metric];
    const payload = CreativeOutcomeFactSchema.parse({
      eventVersion: 1,
      projectId: value.projectId,
      workflowId: value.workflowId,
      workflowPath: value.workflowPath,
      objectId,
      kind,
      formalVersions: [{ id: objectId, kind: formalKind, version: 1 }],
      sourceVersions: [],
      candidate: value.candidate,
      ...(value.metric === "adaptation.strategy"
        ? { selectedOption: value.candidate.selectionOptions![1] }
        : {}),
      evidenceKind: "human",
      modelEvidence: "unknown",
      qualityState: "unverified",
      resultStatus: "adopted",
      ...extra,
    });
    return {
      eventId: id(),
      cursor,
      occurredAt: at,
      type,
      pluginId,
      aggregateType: formalKind,
      aggregateId: objectId,
      aggregateVersion: 1,
      payload,
    };
  }
  it("uses the exact owner candidate for every independent target, preserves strategy single selection and separates actual clocks", () => {
    const { database, projectId, other } = fixture();
    try {
      let cursor = 1;
      for (const metric of CreativeFunnelMetricSchema.options) {
        const initial = request(projectId, metric);
        const ready = candidate(initial);
        if (ready.kind !== "candidate-ready") throw new Error("fixture");
        database.uow.execute((tx) =>
          projectCreativeFunnel(tx, funnelEvent(initial, cursor++)),
        );
        expect(
          database.uow
            .execute((tx) => measureCreativeFunnel(tx, projectId))
            .measures.find((item) => item.metric === metric)!
            .firstCandidateAdoptionRatio,
        ).toBeNull();
        database.uow.execute((tx) =>
          projectCreativeFunnel(
            tx,
            funnelEvent(ready, cursor++, "2026-10-02T00:00:05.000Z"),
          ),
        );
        let measured = database.uow
          .execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures.find((item) => item.metric === metric)!;
        expect(measured).toMatchObject({
          firstCandidates: 1,
          firstAdopted: 0,
          pendingDecision: 1,
          firstAccepted: null,
        });
        database.uow.execute((tx) =>
          projectCreativeOutcome(tx, adoption(ready, cursor++)),
        );
        measured = database.uow
          .execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures.find((item) => item.metric === metric)!;
        expect(measured).toMatchObject({
          firstAdopted: 1,
          firstCandidateAdoptionRatio: 1,
          pendingDecision: 0,
          modelEvidence: "unknown",
          firstAccepted: {
            requestToReadyMs: 5000,
            readyToAdoptMs: 3000,
            requestToAdoptMs: 8000,
            adoptionMode:
              metric === "adaptation.strategy"
                ? "selected-option"
                : "exact-candidate",
          },
        });
      }
      expect(
        database.uow
          .execute((tx) => measureCreativeFunnel(tx, other))
          .measures.every((item) => item.firstCandidateAdoptionRatio === null),
      ).toBe(true);
    } finally {
      database.close();
    }
  });
  it("rejects invented strategy choices, mismatched fingerprints, duplicate choices and whole-candidate adoption labels", () => {
    const projectId = id();
    const ready = candidate(request(projectId, "adaptation.strategy"));
    if (ready.kind !== "candidate-ready") throw new Error("fixture");
    const adopted = adoption(ready, 3).payload as ReturnType<
      typeof CreativeOutcomeFactSchema.parse
    >;
    expect(adopted.selectedOption?.id).toBe("plain-option-2");
    for (const selectedOption of [
      undefined,
      { id: "invented", contentFingerprint: "c".repeat(64) },
      { id: "plain-option-2", contentFingerprint: "b".repeat(64) },
    ])
      expect(
        CreativeOutcomeFactSchema.safeParse({ ...adopted, selectedOption })
          .success,
      ).toBe(false);
    expect(
      CreativeFunnelFactSchema.safeParse({
        ...ready,
        candidate: {
          ...ready.candidate,
          selectionOptions: [
            ready.candidate.selectionOptions![0],
            ready.candidate.selectionOptions![0],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      CreativeOutcomeFactSchema.safeParse({
        ...fact(projectId),
        selectedOption: adopted.selectedOption,
      }).success,
    ).toBe(false);
    const { database } = fixture();
    try {
      const summary = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      );
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativeOutcome(tx, {
            ...adoption(ready, 3),
            aggregateType: "chapter",
          }),
        ),
      ).toThrow(/envelope/u);
      const firstAccepted = {
        workflowId: ready.workflowId,
        candidateId: ready.candidate.id,
        adoptedEventId: id(),
        adoptionMode: "exact-candidate",
        requestToReadyMs: 1,
        readyToAdoptMs: 1,
        requestToAdoptMs: 2,
        clockState: "consistent",
      };
      expect(
        CreativeFunnelSummarySchema.safeParse({
          ...summary,
          measures: summary.measures.map((item) =>
            item.metric === "adaptation.strategy"
              ? { ...item, recordedRequests: 1, firstAccepted }
              : item,
          ),
        }).success,
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it("never resets first-round denominators for failed retries, prior history, discarded candidates or human content edits", () => {
    const { database, projectId } = fixture();
    try {
      let cursor = 1;
      const first = request(projectId);
      const retry = request(projectId, "novel.chapter", {
        targetKey: first.targetKey,
        targetAttempt: 2,
        requestKind: "retry",
        parentWorkflowId: first.workflowId,
      });
      for (const value of [first, retry])
        database.uow.execute((tx) =>
          projectCreativeFunnel(tx, funnelEvent(value, cursor++)),
        );
      const retryReady = candidate(retry);
      if (retryReady.kind !== "candidate-ready") throw new Error("fixture");
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, funnelEvent(retryReady, cursor++)),
      );
      database.uow.execute((tx) =>
        projectCreativeOutcome(tx, adoption(retryReady, cursor++)),
      );
      expect(
        database.uow.execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures[0],
      ).toMatchObject({
        firstCandidates: 0,
        retryCandidates: 1,
        firstCandidateAdoptionRatio: null,
      });
      const legacy = request(projectId, "novel.chapter", { targetAttempt: 4 });
      database.uow.execute((tx) =>
        projectCreativeFunnel(tx, funnelEvent(legacy, cursor++)),
      );
      for (let index = 0; index < 3; index++) {
        const value = request(projectId);
        const ready = candidate(value);
        if (ready.kind !== "candidate-ready") throw new Error("fixture");
        database.uow.execute((tx) =>
          projectCreativeFunnel(tx, funnelEvent(value, cursor++)),
        );
        database.uow.execute((tx) =>
          projectCreativeFunnel(tx, funnelEvent(ready, cursor++)),
        );
        if (index === 0)
          database.uow.execute((tx) =>
            projectCreativeOutcome(
              tx,
              adoption(ready, cursor++, undefined, {
                candidate: {
                  ...ready.candidate,
                  contentFingerprint: "b".repeat(64),
                },
              }),
            ),
          );
        if (index === 1) {
          const { candidate: ignored, ...base } = ready;
          void ignored;
          database.uow.execute((tx) =>
            projectCreativeFunnel(
              tx,
              funnelEvent(
                CreativeFunnelFactSchema.parse({
                  ...base,
                  kind: "state",
                  state: "discarded",
                }),
                cursor++,
              ),
            ),
          );
        }
      }
      expect(
        database.uow.execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures[0],
      ).toMatchObject({
        firstCandidates: 3,
        firstAdopted: 0,
        firstCandidateAdoptionRatio: 0,
        pendingDecision: 1,
        revisedAdoption: 1,
        closedWithoutFirstAdoption: 1,
        unobservedFirstTargets: 1,
      });
    } finally {
      database.close();
    }
  });
  it("replays immutable scoped facts, rejects an unmatched request and preserves unknown timing on a backwards wall clock", () => {
    const { database, projectId } = fixture();
    try {
      const value = request(projectId);
      const ready = candidate(value);
      if (ready.kind !== "candidate-ready") throw new Error("fixture");
      const event = funnelEvent(value, 1);
      database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      database.uow.execute((tx) => projectCreativeFunnel(tx, event));
      for (const altered of [
        { ...event, pluginId: "writing" },
        { ...event, aggregateVersion: 9 },
        { ...event, payload: { ...value, targetAttempt: 8 } },
      ])
        expect(() =>
          database.uow.execute((tx) => projectCreativeFunnel(tx, altered)),
        ).toThrow();
      expect(() =>
        database.uow.execute((tx) =>
          projectCreativeFunnel(
            tx,
            funnelEvent({ ...ready, targetKey: "f".repeat(64) }, 2),
          ),
        ),
      ).toThrow();
      expect(() =>
        database.uow.execute((tx) => {
          projectCreativeFunnel(tx, funnelEvent(ready, 2));
          throw new Error("controlled projection rollback");
        }),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM insights_creative_funnel_events"),
        ),
      ).toHaveLength(1);
      database.uow.execute((tx) =>
        projectCreativeFunnel(
          tx,
          funnelEvent(ready, 2, "2026-10-01T23:59:59.000Z"),
        ),
      );
      database.uow.execute((tx) =>
        projectCreativeOutcome(
          tx,
          adoption(ready, 3, "2026-10-01T23:59:59.500Z"),
        ),
      );
      expect(
        database.uow.execute((tx) => measureCreativeFunnel(tx, projectId))
          .measures[0]!.firstAccepted,
      ).toMatchObject({
        clockState: "inconsistent",
        requestToReadyMs: null,
        requestToAdoptMs: null,
        readyToAdoptMs: 500,
      });
      for (const key of [
        "content",
        "prompt",
        "title",
        "absolutePath",
        "apiKey",
        "actualCost",
      ])
        expect(
          CreativeFunnelFactSchema.safeParse({ ...value, [key]: "private" })
            .success,
        ).toBe(false);
      const result = database.uow.execute((tx) =>
        measureCreativeFunnel(tx, projectId),
      );
      expect(
        CreativeFunnelSummarySchema.safeParse({
          ...result,
          measures: [
            result.measures[0],
            ...result.measures
              .slice(1)
              .map((item) => ({ ...item, metric: "novel.chapter" })),
          ],
        }).success,
      ).toBe(false);
      expect(canonicalCreativeMetricJSON({ b: 1, a: { z: 2, x: 3 } })).toBe(
        canonicalCreativeMetricJSON({ a: { x: 3, z: 2 }, b: 1 }),
      );
    } finally {
      database.close();
    }
  });
});

describe("exact local seven-day project continuation windows", () => {
  const at = "2026-10-02T12:00:00.000Z";
  const end = "2026-10-09T12:00:00.000Z";
  function anchor(
    projectId: string,
    path: "novel" | "adaptation",
    cursor: number,
    occurredAt = at,
    objectId: string = id(),
    version = 1,
    targetKey = "a".repeat(64),
    position = 0,
  ) {
    const value = CreativeOutcomeFactSchema.parse({
      ...fact(projectId, objectId),
      kind:
        path === "novel"
          ? "novel.chapter-adopted"
          : "adaptation.script-adopted",
      workflowPath: path,
      formalVersions: [
        {
          kind: path === "novel" ? "chapter" : "episode-script",
          id: objectId,
          version,
        },
      ],
      continuationTarget: { targetKey, position },
    });
    return {
      ...envelope(value, cursor, occurredAt),
      type:
        path === "novel"
          ? "writing.chapter-adopted.v1"
          : "production.script-result-adopted.v1",
      pluginId: path === "novel" ? "writing" : "production",
      aggregateType: path === "novel" ? "chapter" : "episode-result",
    };
  }
  function request(
    source: DomainEvent,
    cursor: number,
    occurredAt = at,
    extra: Partial<CreativeContinuationFact> = {},
  ): DomainEvent {
    const owner = CreativeOutcomeFactSchema.parse(source.payload);
    const value = CreativeContinuationFactSchema.parse({
      kind: "request",
      eventVersion: 1,
      projectId: owner.projectId,
      workflowId: id(),
      workflowVersion: 0,
      operation: owner.workflowPath === "novel" ? "chapter" : "episode-outline",
      basis: {
        workflowPath: owner.workflowPath,
        source: {
          ...owner.continuationTarget!,
          id: owner.objectId,
          version: owner.formalVersions[0]!.version,
          kind: owner.formalVersions[0]!.kind,
        },
        target: {
          targetKey: "b".repeat(64),
          position: owner.continuationTarget!.position + 1,
        },
      },
      requestedAt: occurredAt,
      evidenceKind: "rule",
      modelEvidence: "unknown",
      ...extra,
    });
    return {
      eventId: id(),
      cursor,
      type: "automation.creative-continuation-requested.v1",
      pluginId: "automation",
      aggregateType: "creation",
      aggregateId: value.workflowId,
      aggregateVersion: 0,
      occurredAt,
      payload: value,
    };
  }
  function started(
    value: DomainEvent,
    cursor: number,
    occurredAt = at,
  ): DomainEvent {
    return {
      ...value,
      eventId: id(),
      cursor,
      type: "automation.creative-continuation-started.v1",
      aggregateVersion: 2,
      occurredAt,
      payload: CreativeContinuationFactSchema.parse({
        ...CreativeContinuationFactSchema.parse(value.payload),
        kind: "started",
        workflowVersion: 2,
        runId: id(),
        sessionId: id(),
      }),
    };
  }
  function project(
    database: ReturnType<typeof fixture>["database"],
    ...events: DomainEvent[]
  ) {
    for (const event of events)
      database.uow.execute((tx) =>
        event.pluginId === "automation"
          ? projectCreativeContinuation(tx, event)
          : projectCreativeOutcome(tx, event),
      );
  }
  const observation = (
    database: ReturnType<typeof fixture>["database"],
    projectId: string,
    asOf = end,
  ) =>
    database.uow.execute((tx) =>
      measureCreativeContinuation(tx, projectId, asOf),
    );
  const global = (
    database: ReturnType<typeof fixture>["database"],
    asOf = end,
  ) =>
    database.uow.execute((tx) =>
      measureGlobalContinuation(tx, asOf, { state: "healthy", checkpoint: 20 }),
    );

  it("keeps real early starts pending, matures at the exact seven-day boundary and counts projects rather than chapters, exports or retries", () => {
    const { database, projectId, other } = fixture();
    try {
      const a = anchor(projectId, "novel", 1);
      const b = anchor(other, "novel", 2);
      const r = request(a, 3);
      project(database, a, b, r, started(r, 4, end));
      expect(
        observation(database, projectId, "2026-10-09T11:59:59.999Z")
          .observations[0],
      ).toMatchObject({ state: "clock-inconsistent" });
      expect(observation(database, projectId).observations[0]).toMatchObject({
        state: "continued",
        recordedRequests: 1,
        successfulStarts: 1,
        firstStarted: { withinWindow: true },
      });
      expect(global(database).measures[0]).toMatchObject({
        eligibleProjects: 2,
        maturedProjects: 2,
        continuedProjects: 1,
        closedWithoutStart: 1,
        continuationRatio: 0.5,
      });
      expect(global(database).measures[1]).toMatchObject({
        eligibleProjects: 0,
        maturedProjects: 0,
        unobservedBaselineProjects: 2,
        continuationRatio: null,
      });
      expect(JSON.stringify(global(database))).not.toContain(projectId);
    } finally {
      database.close();
    }
  });
  it("reports early observed continuation separately and excludes both pending and unknown histories from the matured denominator", () => {
    const { database, projectId, other } = fixture();
    try {
      const a = anchor(projectId, "adaptation", 1);
      const r = request(a, 2);
      project(database, a, r, started(r, 3));
      project(database, envelope(fact(other), 4, at)); // historical fact has no new owner anchor
      expect(
        observation(database, projectId, at).observations[1],
      ).toMatchObject({
        state: "pending",
        firstStarted: { withinWindow: true },
      });
      expect(global(database, at).measures[1]).toMatchObject({
        eligibleProjects: 1,
        pendingProjects: 1,
        observedEarlyContinuations: 1,
        maturedProjects: 0,
        unobservedBaselineProjects: 1,
        continuationRatio: null,
      });
      expect(observation(database, other).observations[0]).toMatchObject({
        state: "unobserved",
        baseline: null,
      });
    } finally {
      database.close();
    }
  });
  it("never resets the first recorded window on later formal versions and matches a newer source only with its own exact committed owner fact", () => {
    const { database, projectId } = fixture();
    try {
      const a = anchor(projectId, "novel", 1);
      const nextVersion = anchor(
        projectId,
        "novel",
        2,
        "2026-10-03T12:00:00.000Z",
        a.aggregateId,
        2,
      );
      const r = request(nextVersion, 3, "2026-10-03T12:00:00.000Z");
      const s = started(r, 4, "2026-10-03T12:00:00.000Z");
      const target = anchor(
        projectId,
        "novel",
        5,
        "2026-10-04T12:00:00.000Z",
        id(),
        1,
        "b".repeat(64),
        1,
      );
      target.payload = CreativeOutcomeFactSchema.parse({
        ...CreativeOutcomeFactSchema.parse(target.payload),
        workflowId: r.aggregateId,
      });
      project(database, a, nextVersion, r, s, target, {
        ...target,
        eventId: id(),
        cursor: 6,
      });
      expect(observation(database, projectId).observations[0]).toMatchObject({
        state: "continued",
        baseline: { eventId: a.eventId, version: 1, deadline: end },
        nextAdoptedTargets: 1,
      });
      expect(global(database).measures[0].maturedProjects).toBe(1);
    } finally {
      database.close();
    }
  });
  it("does not treat requests, late starts, unrelated projects or missing exact source revisions as within-window continuation", () => {
    const { database, projectId, other } = fixture();
    try {
      const a = anchor(projectId, "novel", 1);
      const b = anchor(other, "novel", 2);
      const r = request(a, 3);
      const missing = request(b, 4);
      const f = CreativeContinuationFactSchema.parse(missing.payload);
      missing.payload = CreativeContinuationFactSchema.parse({
        ...f,
        basis: { ...f.basis, source: { ...f.basis.source, version: 99 } },
      });
      project(
        database,
        a,
        b,
        r,
        missing,
        started(r, 5, "2026-10-09T12:00:00.001Z"),
        started(missing, 6, "2026-10-09T12:00:00.001Z"),
      );
      expect(
        observation(database, projectId, "2026-10-10T12:00:00.000Z")
          .observations[0],
      ).toMatchObject({
        state: "not-started",
        firstStarted: { withinWindow: false },
      });
      expect(
        observation(database, other, "2026-10-10T12:00:00.000Z")
          .observations[0],
      ).toMatchObject({
        state: "not-started",
        recordedRequests: 1,
        successfulStarts: 0,
        unlinkedRequests: 1,
        firstStarted: null,
      });
    } finally {
      database.close();
    }
  });
  it("rejects forged envelopes, startup without its immutable request, second startup and changed replay while retaining exact replay and atomic rollback", () => {
    const { database, projectId } = fixture();
    try {
      const a = anchor(projectId, "novel", 1),
        r = request(a, 2),
        s = started(r, 3);
      expect(() => project(database, s)).toThrow(
        "exact previously committed request",
      );
      project(database, a, r, s, s);
      for (const altered of [
        { ...s, pluginId: "insights" },
        { ...s, aggregateVersion: 99 },
        { ...s, occurredAt: end },
        started(r, 4),
      ])
        expect(() => project(database, altered)).toThrow();
      const retry = request(a, 5);
      expect(() =>
        database.uow.execute((tx) => {
          projectCreativeContinuation(tx, retry);
          throw new Error("rollback continuation");
        }),
      ).toThrow("rollback continuation");
      expect(
        database.uow.execute((tx) =>
          tx.all("SELECT * FROM insights_creative_continuation_events"),
        ),
      ).toHaveLength(2);
    } finally {
      database.close();
    }
  });
  it("keeps backwards/future clock evidence unknown and validates privacy, exact next position and cohort arithmetic", () => {
    const { database, projectId } = fixture();
    try {
      const a = anchor(projectId, "adaptation", 1);
      const r = request(a, 2);
      project(database, a, r, started(r, 3, "2026-10-02T11:59:59.999Z"));
      expect(observation(database, projectId).observations[1]).toMatchObject({
        state: "clock-inconsistent",
        firstStarted: { withinWindow: false },
      });
      expect(global(database).measures[1]).toMatchObject({
        eligibleProjects: 1,
        maturedProjects: 0,
        clockUnknownProjects: 1,
        continuationRatio: null,
      });
      const f = CreativeContinuationFactSchema.parse(r.payload);
      for (const change of [
        { ...f, content: "private" },
        {
          ...f,
          basis: { ...f.basis, target: { ...f.basis.target, position: 3 } },
        },
        { ...f, modelEvidence: "real-model" },
      ])
        expect(CreativeContinuationFactSchema.safeParse(change).success).toBe(
          false,
        );
      const measured = global(database);
      expect(
        CreativeContinuationGlobalSchema.safeParse({
          ...measured,
          measures: measured.measures.map((item) => ({
            ...item,
            continuationRatio: 0,
          })),
        }).success,
      ).toBe(false);
      const summary = observation(database, projectId);
      expect(
        CreativeContinuationSummarySchema.safeParse({
          ...summary,
          observations: summary.observations.map((item) =>
            item.workflowPath === "adaptation"
              ? { ...item, state: "continued" }
              : item,
          ),
        }).success,
      ).toBe(false);
    } finally {
      database.close();
    }
  });
  it("commits request/startup receipts with strict JSON, never emits for allocation/checking/mismatched sessions, and rolls back failed startup persistence", () => {
    const { database, projectId } = fixture();
    try {
      database.sqlite.exec(creationMigrations[0]!.sql);
      database.sqlite.exec(continuationReceipts.sql);
      const schemas = new DomainEventSchemaRegistry(DOMAIN_EVENT_MANIFEST);
      database.uow.setEventValidator((event) => schemas.validate(event));
      const a = anchor(projectId, "novel", 1),
        r = request(a, 2);
      const rf = CreativeContinuationFactSchema.parse(r.payload);
      const workflow = CreationWorkflowSchema.parse({
        id: rf.workflowId,
        taskId: id(),
        input: {
          projectId,
          operation: "chapter",
          targetId: id(),
          baseVersion: 0,
          instruction: "private",
          engineKind: "codex",
        },
        stage: "preparing",
        version: 0,
        continuationBasis: rf.basis,
        runIds: [],
        contextSnapshotIds: [],
        sources: [],
        preparedPrompt: "private",
        issues: [],
        createdAt: at,
        updatedAt: at,
      });
      database.uow.execute((tx) => {
        tx.run(
          "INSERT INTO automation_creation_workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          workflow.id,
          projectId,
          workflow.input.targetId!,
          workflow.stage,
          0,
          id(),
          "hash",
          JSON.stringify(workflow),
          at,
          at,
        );
        recordContinuationRequest(tx, workflow);
      });
      const accepted = { runId: id(), sessionId: id() };
      const generating = {
        ...workflow,
        stage: "generating" as const,
        version: 2,
        ...accepted,
      };
      for (const value of [
        workflow,
        { ...generating, stage: "checking" as const },
        { ...generating, sessionId: id() },
      ])
        database.uow.execute((tx) =>
          recordContinuationStarted(tx, value, accepted),
        );
      expect(
        database.uow.execute((tx) => tx.all("SELECT * FROM domain_events")),
      ).toHaveLength(1);
      database.sqlite.exec(
        "CREATE TEMP TRIGGER fail_continuation_start BEFORE UPDATE ON automation_creative_continuation_receipts BEGIN SELECT RAISE(ABORT, 'startup receipt rollback'); END;",
      );
      expect(() =>
        database.uow.execute((tx) =>
          recordContinuationStarted(tx, generating, accepted),
        ),
      ).toThrow("startup receipt rollback");
      expect(
        database.uow.execute((tx) => tx.all("SELECT * FROM domain_events")),
      ).toHaveLength(1);
      database.sqlite.exec("DROP TRIGGER fail_continuation_start");
      database.uow.execute((tx) =>
        recordContinuationStarted(tx, generating, accepted),
      );
      database.uow.execute((tx) =>
        recordContinuationStarted(tx, generating, accepted),
      );
      expect(
        database.uow.execute((tx) => tx.all("SELECT * FROM domain_events")),
      ).toHaveLength(2);
      expect(
        JSON.stringify(
          database.uow.execute((tx) => tx.all("SELECT * FROM domain_events")),
        ),
      ).not.toContain("private");
    } finally {
      database.close();
    }
  });
});
