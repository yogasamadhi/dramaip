import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import type {
  StorySourceLifecycle,
  StorySourceWithdrawInput,
} from "@dramaip/contracts/knowledge";

export class SourceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 412 | 428 | 503,
    message: string,
  ) {
    super(message);
  }
}

// 0009/0010 and their original disposition/binding/receipt bytes are immutable.
// Only active positions are unique; retired graph identities are never reused.
export const storySourceLifecycleMigration: PluginMigration = {
  id: "knowledge.0011.source-lifecycle",
  pluginId: "knowledge",
  version: "3.0.0-alpha.6",
  dependsOn: ["knowledge.0010.source-anchored-assertions"],
  sql: `ALTER TABLE knowledge_causal_nodes ADD COLUMN retired_at TEXT;
  CREATE TABLE knowledge_causal_edges_next (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
    to_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK(relation IN ('causes','enables','blocks','reveals','conflicts_with','depends_on')),
    rationale TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)), version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retired_at TEXT
  );
  INSERT INTO knowledge_causal_edges_next SELECT *, NULL FROM knowledge_causal_edges;
  DROP TABLE knowledge_causal_edges;
  ALTER TABLE knowledge_causal_edges_next RENAME TO knowledge_causal_edges;
  CREATE UNIQUE INDEX knowledge_causal_edges_active_position ON knowledge_causal_edges(project_id,from_node_id,relation,to_node_id) WHERE retired_at IS NULL;
  CREATE TABLE knowledge_audience_states_next (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL CHECK(subject_type IN ('audience','character')), subject_id TEXT NOT NULL,
    knowledge_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
    story_order INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('unknown','suspects','misbelieves','knows')),
    evidence TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retired_at TEXT
  );
  INSERT INTO knowledge_audience_states_next SELECT *, NULL FROM knowledge_audience_states;
  DROP TABLE knowledge_audience_states;
  ALTER TABLE knowledge_audience_states_next RENAME TO knowledge_audience_states;
  CREATE UNIQUE INDEX knowledge_audience_states_active_position ON knowledge_audience_states(project_id,subject_type,subject_id,knowledge_node_id,story_order) WHERE retired_at IS NULL;
  CREATE TABLE knowledge_story_source_transitions (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    declaration_id TEXT REFERENCES knowledge_story_declarations(id) ON DELETE CASCADE,
    assertion_id TEXT REFERENCES knowledge_story_assertions(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('declaration','assertion')), source_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version IN (1,2)), action TEXT NOT NULL CHECK(action IN ('withdraw','replace')),
    record_kind TEXT NOT NULL CHECK(record_kind IN ('node','edge','cognition')), record_id TEXT NOT NULL,
    record_version INTEGER NOT NULL, original_record_json TEXT NOT NULL, retired_at TEXT NOT NULL,
    reason TEXT NOT NULL, replacement_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY(source_kind,source_id,version),
    CHECK((source_kind = 'declaration' AND declaration_id IS NOT NULL AND declaration_id = source_id AND assertion_id IS NULL AND record_kind = 'node')
      OR (source_kind = 'assertion' AND assertion_id IS NOT NULL AND assertion_id = source_id AND declaration_id IS NULL AND record_kind IN ('edge','cognition'))),
    CHECK((action = 'withdraw' AND version = 1 AND replacement_id IS NULL) OR (action = 'replace' AND replacement_id IS NOT NULL))
  );
  CREATE TRIGGER knowledge_story_source_transitions_immutable BEFORE UPDATE ON knowledge_story_source_transitions
    BEGIN SELECT RAISE(ABORT, 'story source transitions are immutable'); END;`,
};
type Kind = "declaration" | "assertion";
type RecordRef = StorySourceLifecycle["record"];
interface TransitionRow {
  version: number;
  action: "withdraw" | "replace";
  record_kind: RecordRef["kind"];
  record_id: string;
  record_version: number;
  original_record_json: string;
  retired_at: string;
  reason: string;
  replacement_id: string | null;
  created_at: string;
}
const transitions = (
  tx: UnitOfWorkTransaction,
  projectId: string,
  kind: Kind,
  id: string,
) =>
  tx.all<TransitionRow>(
    "SELECT * FROM knowledge_story_source_transitions WHERE project_id = ? AND source_kind = ? AND source_id = ? ORDER BY version",
    projectId,
    kind,
    id,
  );
export function sourceLifecycle(
  tx: UnitOfWorkTransaction,
  projectId: string,
  kind: Kind,
  id: string,
  adopted: RecordRef,
): StorySourceLifecycle {
  const rows = transitions(tx, projectId, kind, id),
    latest = rows.at(-1);
  return {
    state: latest
      ? latest.action === "replace"
        ? "replaced"
        : "withdrawn"
      : "active",
    version: latest?.version ?? 0,
    record: latest
      ? {
          kind: latest.record_kind,
          id: latest.record_id,
          version: latest.record_version,
        }
      : adopted,
    ...(latest?.replacement_id ? { replacementId: latest.replacement_id } : {}),
    transitions: rows.map((row) => ({
      version: row.version,
      action: row.action,
      reason: row.reason,
      ...(row.replacement_id ? { replacementId: row.replacement_id } : {}),
      createdAt: row.created_at,
    })),
  };
}
export function sourceRetirementEvidence(
  tx: UnitOfWorkTransaction,
  projectId: string,
  kind: Kind,
  id: string,
  adopted: RecordRef,
  input: StorySourceWithdrawInput,
  expectedFields: Record<string, unknown>,
) {
  const lifecycle = sourceLifecycle(tx, projectId, kind, id, adopted);
  if (lifecycle.state === "replaced")
    throw new SourceError(409, "原声明已替换，不能重新激活或再次换源。");
  if (
    lifecycle.version !== input.lifecycleVersion ||
    JSON.stringify(lifecycle.record) !== JSON.stringify(input.record)
  )
    throw new SourceError(412, "原生命周期或实际记录版本已变，请重查原 ID。");
  const record =
    adopted.kind === "node"
      ? tx.get<Record<string, unknown>>(
          "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ?",
          adopted.id,
          projectId,
        )
      : adopted.kind === "edge"
        ? tx.get<Record<string, unknown>>(
            "SELECT * FROM knowledge_causal_edges WHERE id = ? AND project_id = ?",
            adopted.id,
            projectId,
          )
        : tx.get<Record<string, unknown>>(
            "SELECT * FROM knowledge_audience_states WHERE id = ? AND project_id = ?",
            adopted.id,
            projectId,
          );
  if (
    !record ||
    record.version !== lifecycle.record.version ||
    Object.entries(expectedFields).some(([key, value]) => record[key] !== value)
  )
    throw new SourceError(
      409,
      "原实际图记录或采用绑定已失效，不覆盖或静默复用。",
    );
  const rows = transitions(tx, projectId, kind, id),
    latest = rows.at(-1);
  if (
    latest
      ? record.retired_at !== latest.retired_at
      : record.retired_at !== null
  )
    throw new SourceError(409, "实际图记录的退役状态无法核对。");
  if (latest) {
    const original = JSON.parse(latest.original_record_json) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(original)) {
      if (
        !["version", "retired_at", "updated_at"].includes(key) &&
        record[key] !== value
      )
        throw new SourceError(409, "原退役记录已被改写，不能换源。");
    }
  }
  return { lifecycle, record, rows };
}
export function retireStorySource(
  tx: UnitOfWorkTransaction,
  projectId: string,
  kind: Kind,
  id: string,
  adopted: RecordRef,
  input: StorySourceWithdrawInput,
  expectedFields: Record<string, unknown>,
  preflight: ReturnType<typeof sourceRetirementEvidence>,
  replacementId?: string,
) {
  const actual = sourceRetirementEvidence(
    tx,
    projectId,
    kind,
    id,
    adopted,
    input,
    expectedFields,
  );
  if (JSON.stringify(actual) !== JSON.stringify(preflight))
    throw new SourceError(412, "原实际记录在提交前变化，未覆盖。");
  if (!replacementId && actual.lifecycle.state !== "active")
    throw new SourceError(409, "原声明已撤回，不重复退役。");
  const now = new Date().toISOString(),
    retiredAt = actual.rows.at(-1)?.retired_at ?? now;
  if (actual.lifecycle.state === "active") {
    const values: [string, string, string, string, number] = [
      now,
      now,
      adopted.id,
      projectId,
      adopted.version,
    ];
    if (adopted.kind === "node")
      tx.run(
        "UPDATE knowledge_causal_nodes SET retired_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
        ...values,
      );
    else if (adopted.kind === "edge")
      tx.run(
        "UPDATE knowledge_causal_edges SET retired_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
        ...values,
      );
    else
      tx.run(
        "UPDATE knowledge_audience_states SET retired_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
        ...values,
      );
  }
  tx.run(
    "INSERT INTO knowledge_story_source_transitions(project_id,declaration_id,assertion_id,source_kind,source_id,version,action,record_kind,record_id,record_version,original_record_json,retired_at,reason,replacement_id,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    projectId,
    kind === "declaration" ? id : null,
    kind === "assertion" ? id : null,
    kind,
    id,
    actual.lifecycle.version + 1,
    replacementId ? "replace" : "withdraw",
    adopted.kind,
    adopted.id,
    actual.lifecycle.state === "active"
      ? adopted.version + 1
      : actual.lifecycle.record.version,
    actual.rows[0]?.original_record_json ?? JSON.stringify(actual.record),
    retiredAt,
    input.reason,
    replacementId ?? null,
    now,
  );
  tx.append({
    type: `knowledge.story-${kind}-${replacementId ? "replaced" : "withdrawn"}.v1`,
    pluginId: "knowledge",
    aggregateType: `story-${kind}-lifecycle`,
    aggregateId: id,
    aggregateVersion: actual.lifecycle.version + 1,
    payload: {
      projectId,
      id,
      lifecycleVersion: actual.lifecycle.version + 1,
      recordKind: adopted.kind,
      recordId: adopted.id,
      ...(replacementId ? { replacementId } : {}),
    },
  });
}
