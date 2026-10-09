import type { DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_QUALITY_ADOPTION_EVENT,
  CreativeQualityAdoptionFactSchema,
  CreativeQualityAdoptionRecordSchema,
  CreativeQualityAssociationSummarySchema,
  type CreativeQualityAdoptionFact,
  type CreativeOutcomeSummary,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const creativeQualityAssociationMigration: PluginMigration = {
  id: "insights.0006.quality-associations",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0002.creative-outcomes"],
  sql: `CREATE TABLE insights_creative_quality_reports (
    report_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
    source_cursor INTEGER NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),
    record_json TEXT NOT NULL CHECK(json_valid(record_json))
  ); CREATE INDEX insights_creative_quality_page ON insights_creative_quality_reports(project_id,source_cursor DESC);
  CREATE TABLE insights_creative_quality_targets (
    report_id TEXT NOT NULL REFERENCES insights_creative_quality_reports(report_id) ON DELETE CASCADE,
    formal_kind TEXT NOT NULL, formal_id TEXT NOT NULL, formal_version INTEGER NOT NULL,
    relation TEXT NOT NULL,
    PRIMARY KEY(report_id,formal_kind,formal_id,formal_version)
  ); CREATE INDEX insights_creative_quality_target_version ON insights_creative_quality_targets(formal_kind,formal_id,formal_version);`,
};

const formalKinds = {
  chapter: "chapter",
  diagnosis: "diagnosis",
  "season-plan": "season-plan",
  "episode-result": "episode-script",
} as const;
function targets(fact: CreativeQualityAdoptionFact) {
  const formalKind = formalKinds[fact.target.kind as keyof typeof formalKinds];
  if (formalKind)
    return [
      {
        formalKind,
        id: fact.target.id,
        version: fact.target.version,
        relation: "exact-target-version",
      },
    ];
  if (fact.target.kind === "chapter-set" && fact.chapterScope)
    return fact.chapterScope.included.map(({ id, version }) => ({
      formalKind: "chapter",
      id,
      version,
      relation: "explicit-chapter-scope",
    }));
  // Ordinary script / scene IDs and composite hashes are different identities.
  // Keeping their receipt does not manufacture a corresponding M4 result.
  return [];
}

export function projectCreativeQualityAdoption(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
): void {
  const fact = CreativeQualityAdoptionFactSchema.parse(event.payload);
  if (
    event.type !== CREATIVE_QUALITY_ADOPTION_EVENT ||
    event.pluginId !== "creative-quality" ||
    event.aggregateType !== "narrative-quality-report" ||
    event.aggregateId !== fact.report.id ||
    event.aggregateVersion !== fact.report.version
  )
    throw new Error(
      "Report adoption does not match its committed owner envelope.",
    );
  const record = CreativeQualityAdoptionRecordSchema.parse({
    ...fact,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    cursor: event.cursor,
  });
  const factJSON = JSON.stringify(fact);
  const recordJSON = JSON.stringify(record);
  const existing = tx.all<{
    report_id: string;
    event_id: string;
    source_cursor: number;
    fact_json: string;
    record_json: string;
  }>(
    "SELECT * FROM insights_creative_quality_reports WHERE report_id = ? OR event_id = ? OR source_cursor = ?",
    fact.report.id,
    event.eventId,
    event.cursor,
  );
  for (const row of existing)
    if (
      row.report_id !== fact.report.id ||
      row.fact_json !== factJSON ||
      ((row.event_id === event.eventId || row.source_cursor === event.cursor) &&
        row.record_json !== recordJSON)
    )
      throw new Error(
        "A report adoption identity, owner version or historical receipt cannot be replaced on replay.",
      );
  if (existing.length) return;
  tx.run(
    "INSERT INTO insights_creative_quality_reports VALUES (?,?,?,?,?,?)",
    fact.report.id,
    event.eventId,
    event.cursor,
    fact.projectId,
    factJSON,
    recordJSON,
  );
  for (const target of targets(fact))
    tx.run(
      "INSERT INTO insights_creative_quality_targets VALUES (?,?,?,?,?)",
      fact.report.id,
      target.formalKind,
      target.id,
      target.version,
      target.relation,
    );
}

/** Only joins two Insights-owned projections. Source arrival order is irrelevant. */
export function measureCreativeQualityAssociations(
  tx: UnitOfWorkTransaction,
  projectId: string,
): CreativeOutcomeSummary["qualityAssociations"] {
  type LinkRow = {
    report_id: string;
    relation: "exact-target-version" | "explicit-chapter-scope";
    outcome_kind: string;
    object_id: string;
    unit_key: string;
    formal_kind: string;
    formal_id: string;
    formal_version: number;
  };
  const links = tx.all<LinkRow>(
    `
    SELECT t.report_id,t.relation,json_extract(e.value_json,'$.kind') AS outcome_kind,
      json_extract(e.value_json,'$.objectId') AS object_id,e.unit_key,t.formal_kind,t.formal_id,t.formal_version
    FROM insights_creative_quality_targets t
    JOIN insights_creative_quality_reports r ON r.report_id=t.report_id
    JOIN insights_creative_outcome_events e ON e.project_id=r.project_id
    JOIN insights_creative_outcome_units u ON u.project_id=e.project_id
      AND u.kind=e.kind AND u.unit_key=e.unit_key AND u.first_event_id=e.event_id
    JOIN json_each(e.value_json,'$.formalVersions') f
      ON json_extract(f.value,'$.kind')=t.formal_kind
      AND json_extract(f.value,'$.id')=t.formal_id
      AND json_extract(f.value,'$.version')=t.formal_version
    WHERE r.project_id=?
    GROUP BY t.report_id,t.relation,e.unit_key,t.formal_kind,t.formal_id,t.formal_version
    ORDER BY t.report_id,e.unit_key,t.formal_kind,t.formal_id,t.formal_version`,
    projectId,
  );
  const recordedReports = tx.get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM insights_creative_quality_reports WHERE project_id=?",
    projectId,
  )!.total;
  const exact = new Set(
    links
      .filter((link) => link.relation === "exact-target-version")
      .map((link) => link.report_id),
  );
  const scope = new Set(
    links
      .filter((link) => link.relation === "explicit-chapter-scope")
      .map((link) => link.report_id),
  );
  const records = tx.all<{ record_json: string }>(
    "SELECT record_json FROM insights_creative_quality_reports WHERE project_id=? ORDER BY source_cursor DESC LIMIT 20",
    projectId,
  );
  return CreativeQualityAssociationSummarySchema.parse({
    historyPolicy: "recorded-report-adoptions-only",
    associationPolicy: "exact-owner-version-not-current-quality",
    recordedReports,
    reportsWithExactTarget: exact.size,
    reportsWithScopeMembers: scope.size,
    reportsWithoutRecordedOutcome: recordedReports - exact.size - scope.size,
    linkedResultUnits: new Set(links.map((link) => link.unit_key)).size,
    items: records.map(({ record_json }) => {
      const record = CreativeQualityAdoptionRecordSchema.parse(
        JSON.parse(record_json),
      );
      return {
        ...record,
        links: links
          .filter((link) => link.report_id === record.report.id)
          .map((link) => ({
            relation: link.relation,
            outcomeKind: link.outcome_kind,
            objectId: link.object_id,
            unitKey: link.unit_key,
            formalVersion: {
              kind: link.formal_kind,
              id: link.formal_id,
              version: link.formal_version,
            },
          })),
      };
    }),
  });
}
