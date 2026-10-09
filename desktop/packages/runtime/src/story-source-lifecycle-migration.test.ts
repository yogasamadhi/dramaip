import { describe, expect, it } from "vitest";
import { openDatabase } from "@dramaip/database";
import { createKnowledgePlugin } from "@dramaip/knowledge";

describe("story source lifecycle forward migration", () => {
  it("preserves real graph rows and immutable source/adoption receipts, allowing only active-slot uniqueness", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createKnowledgePlugin().migrations!;
      const graph = migrations.find(
        (m) => m.id === "knowledge.0005.story-intelligence",
      )!;
      const declarations = migrations.find(
        (m) => m.id === "knowledge.0009.source-anchored-declarations",
      )!;
      const assertions = migrations.find(
        (m) => m.id === "knowledge.0010.source-anchored-assertions",
      )!;
      const next = migrations.find(
        (m) => m.id === "knowledge.0011.source-lifecycle",
      )!;
      expect(next).toBeDefined();
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('project');",
      );
      database.sqlite.exec(graph.sql);
      database.sqlite.exec(declarations.sql);
      database.sqlite.exec(assertions.sql);
      const node = database.sqlite.prepare(
        "INSERT INTO knowledge_causal_nodes VALUES (?, 'project', 'event', 'actual title', 'actual private statement', 'manual', 'source', 1, 1, 4, 'old', 'old')",
      );
      node.run("from");
      node.run("to");
      database.sqlite.exec(
        "INSERT INTO knowledge_causal_edges VALUES ('edge','project','from','to','causes','actual old rationale',0.7,1,4,'old','old'); INSERT INTO knowledge_audience_states VALUES ('cognition','project','audience','reader','to',3,'knows','actual old evidence',4,'old','old');",
      );
      database.sqlite.exec(
        "INSERT INTO knowledge_story_declarations VALUES ('declaration','project','exact input bytes','exact frozen basis','adopted',1,'from',4,'old','old'); INSERT INTO knowledge_story_assertions VALUES ('assertion','project','exact assertion bytes','exact frozen basis','adopted',1,'edge','edge',4,'old','old'); INSERT INTO knowledge_story_declaration_requests VALUES ('adopt-key','original-hash','declaration','original receipt bytes',200); INSERT INTO knowledge_story_assertion_requests VALUES ('assert-key','original-hash','assertion','original receipt bytes',200);",
      );
      const historicTables = [
        "knowledge_story_declarations",
        "knowledge_story_assertions",
        "knowledge_story_declaration_requests",
        "knowledge_story_assertion_requests",
      ];
      const before = historicTables.map((table) =>
        database.sqlite.prepare(`SELECT * FROM ${table}`).all(),
      );
      const oldRecords = [
        "knowledge_causal_nodes",
        "knowledge_causal_edges",
        "knowledge_audience_states",
      ].map((table) => database.sqlite.prepare(`SELECT * FROM ${table}`).all());
      database.sqlite.exec(next.sql);
      historicTables.forEach((table, index) =>
        expect(database.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(
          before[index],
        ),
      );
      [
        "knowledge_causal_nodes",
        "knowledge_causal_edges",
        "knowledge_audience_states",
      ].forEach((table, index) => {
        expect(
          database.sqlite
            .prepare(`SELECT * FROM ${table}`)
            .all()
            .map((row) => {
              const { retired_at, ...original } = row as Record<
                string,
                unknown
              >;
              expect(retired_at).toBeNull();
              return original;
            }),
        ).toEqual(oldRecords[index]);
      });
      const insertEdge = database.sqlite.prepare(
        "INSERT INTO knowledge_causal_edges VALUES (?, 'project','from','to','causes','new rationale',0.8,1,0,'new','new',NULL)",
      );
      const insertState = database.sqlite.prepare(
        "INSERT INTO knowledge_audience_states VALUES (?, 'project','audience','reader','to',3,'suspects','new evidence',0,'new','new',NULL)",
      );
      expect(() => insertEdge.run("conflict")).toThrow();
      expect(() => insertState.run("conflict")).toThrow();
      database.sqlite.exec(
        "UPDATE knowledge_causal_edges SET retired_at = 'retired', version = version + 1 WHERE id = 'edge'; UPDATE knowledge_audience_states SET retired_at = 'retired', version = version + 1 WHERE id = 'cognition';",
      );
      insertEdge.run("new-edge");
      insertState.run("new-state");
      expect(() => insertEdge.run("second-conflict")).toThrow();
      expect(() => insertState.run("second-conflict")).toThrow();
      expect(
        database.sqlite
          .prepare("SELECT * FROM knowledge_story_source_transitions")
          .all(),
      ).toEqual([]);
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
    } finally {
      database.close();
    }
  });
});
