import { describe, expect, it } from "vitest";
import { openDatabase } from "@dramaip/database";
import { createProductionPlugin } from "@dramaip/production";
import { createMediaPlugin } from "@dramaip/media";
import { createTimelinePlugin } from "@dramaip/timeline";

describe("storyboard record retirement forward migration", () => {
  it("preserves every historical record field and private JSON byte without inferring retirement", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createProductionPlugin().migrations!;
      const original = migrations.find(
        (value) => value.id === "production.0001.records",
      )!;
      const next = migrations.find(
        (value) => value.id === "production.0012.storyboard-record-retirement",
      )!;
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      database.sqlite.exec(original.sql);
      const insert = database.sqlite.prepare(
        "INSERT INTO production_records VALUES (?, ?, 'actual-project', ?, ?, ?, ?, ?, '2026-09-30T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
      );
      insert.run(
        "actual-scene",
        "scenes",
        null,
        "作者原场景",
        '{"stableId":"scene-0", "作者旁注": "旧值保留"}',
        2,
        7,
      );
      insert.run(
        "actual-shot",
        "shots",
        "actual-scene",
        "作者原镜头",
        '{"stableId":"shot-0", "私人字段": {"original": true}, "镜头描述":"原表达"}',
        3,
        9,
      );
      const before = database.sqlite
        .prepare("SELECT * FROM production_records ORDER BY id")
        .all() as Array<Record<string, unknown>>;
      database.sqlite.exec(next.sql);
      expect(
        database.sqlite
          .prepare("SELECT * FROM production_records ORDER BY id")
          .all(),
      ).toEqual(
        before.map((row) => ({
          ...row,
          retired_result_id: null,
          retired_at: null,
        })),
      );
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM production_records WHERE retired_result_id IS NULL",
          )
          .get(),
      ).toMatchObject({ count: 2 });
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
});

describe("production project purge request forward migration", () => {
  it("preserves original request keys, hashes, responses and parent bytes while cascading only the physically deleted project", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createProductionPlugin().migrations!;
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY, deleted_at TEXT); INSERT INTO projects VALUES ('original-project', NULL), ('other-project', NULL);",
      );
      const owners = [
        {
          migration: "production.0005.adaptation-diagnoses",
          parent: "production_diagnoses",
          requests: "production_diagnosis_requests",
          head: "production_diagnosis_heads",
          reference: "diagnosis_id",
        },
        {
          migration: "production.0006.season-plans",
          parent: "production_season_plans",
          requests: "production_season_plan_requests",
          head: "production_season_plan_heads",
          reference: "plan_id",
        },
        {
          migration: "production.0011.adaptation-strategies",
          parent: "production_adaptation_strategies",
          requests: "production_adaptation_strategy_requests",
          head: "production_adaptation_strategy_heads",
          reference: "strategy_id",
        },
      ];
      for (const owner of owners) {
        database.sqlite.exec(
          migrations.find((value) => value.id === owner.migration)!.sql,
        );
        for (const projectId of ["original-project", "other-project"]) {
          const parentId = `${owner.parent}:${projectId}`;
          const columns =
            owner.parent === "production_season_plans" ? ", origin" : "";
          const values =
            owner.parent === "production_season_plans" ? ", 'model'" : "";
          database.sqlite
            .prepare(
              `INSERT INTO ${owner.parent}(id,project_id,workflow_id,version,state_version,status,value_json,created_at,updated_at${columns}) VALUES (?, ?, ?, 3, 7, 'adopted', ?, '2026-09-30T00:00:00.000Z', '2026-10-01T00:00:00.000Z'${values})`,
            )
            .run(
              parentId,
              projectId,
              `${parentId}:workflow`,
              '{ "PRIVATE 原稿": "保留字节", "version": 3 }',
            );
          database.sqlite
            .prepare(`INSERT INTO ${owner.head} VALUES (?, ?)`)
            .run(projectId, parentId);
          for (const status of [200, 409])
            database.sqlite
              .prepare(`INSERT INTO ${owner.requests} VALUES (?, ?, ?, ?, ?)`)
              .run(
                `${parentId}:${status}`,
                `original-hash:${status}`,
                parentId,
                status,
                status === 200
                  ? null
                  : 'PRIVATE 原冲突响应：{ "unchanged": true }',
              );
        }
      }
      const snapshot = () =>
        Object.fromEntries(
          owners.flatMap((owner) =>
            [owner.parent, owner.requests, owner.head].map((table) => [
              table,
              database.sqlite
                .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
                .all(),
            ]),
          ),
        );
      const before = snapshot();
      expect(() =>
        database.sqlite
          .prepare("DELETE FROM projects WHERE id='original-project'")
          .run(),
      ).toThrow("FOREIGN KEY");
      expect(snapshot()).toEqual(before);
      database.uow.execute(() =>
        database.sqlite.exec(
          migrations.find(
            (value) => value.id === "production.0014.project-purge-requests",
          )!.sql,
        ),
      );
      expect(snapshot()).toEqual(before);
      database.sqlite.exec(
        "UPDATE projects SET deleted_at='2026-10-04T00:00:00.000Z' WHERE id='original-project'",
      );
      expect(snapshot()).toEqual(before);
      database.sqlite.exec(
        "UPDATE projects SET deleted_at=NULL WHERE id='original-project'",
      );
      expect(snapshot()).toEqual(before);
      for (const owner of owners) {
        expect(
          database.sqlite
            .prepare(`PRAGMA foreign_key_list(${owner.requests})`)
            .all(),
        ).toEqual([
          expect.objectContaining({
            table: owner.parent,
            from: owner.reference,
            on_delete: "CASCADE",
          }),
        ]);
        expect(() =>
          database.sqlite
            .prepare(
              `INSERT INTO ${owner.requests} VALUES ('new-key', 'hash', 'missing-parent', 200, NULL)`,
            )
            .run(),
        ).toThrow("FOREIGN KEY");
        expect(() =>
          database.sqlite
            .prepare(
              `INSERT INTO ${owner.requests} SELECT * FROM ${owner.requests} LIMIT 1`,
            )
            .run(),
        ).toThrow("UNIQUE");
      }
      database.sqlite
        .prepare("DELETE FROM projects WHERE id='original-project'")
        .run();
      for (const owner of owners) {
        expect(
          database.sqlite.prepare(`SELECT * FROM ${owner.parent}`).all(),
        ).toEqual(
          before[owner.parent]!.filter(
            (row) =>
              (row as { project_id: string }).project_id === "other-project",
          ),
        );
        expect(
          database.sqlite.prepare(`SELECT * FROM ${owner.head}`).all(),
        ).toEqual(
          before[owner.head]!.filter(
            (row) =>
              (row as { project_id: string }).project_id === "other-project",
          ),
        );
        expect(
          database.sqlite
            .prepare(`SELECT * FROM ${owner.requests} ORDER BY rowid`)
            .all(),
        ).toEqual(
          before[owner.requests]!.filter((row) =>
            String((row as Record<string, unknown>)[owner.reference]).endsWith(
              ":other-project",
            ),
          ),
        );
      }
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
});

describe("author script revision forward migration", () => {
  it("preserves old immutable JSON/version/workflow and supports human adoption without inventing a workflow", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createProductionPlugin().migrations!;
      const old = migrations.find(
        (value) => value.id === "production.0007.episode-development",
      )!;
      const next = migrations.find(
        (value) => value.id === "production.0010.author-script-revisions",
      )!;
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      database.sqlite.exec(old.sql);
      const json =
        '{"id":"old-real-result","workflowId":"old-real-workflow","version":3,"content":{"actual":"original bytes"}}';
      database.sqlite
        .prepare(
          "INSERT INTO production_episode_results VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "old-real-result",
          "actual-project",
          "episode",
          "episode-script",
          "old-real-workflow",
          3,
          json,
          "2026-09-30T00:00:00.000Z",
        );
      database.sqlite
        .prepare(
          "INSERT INTO production_episode_result_heads VALUES (?, ?, ?, ?)",
        )
        .run("actual-project", "episode", "episode-script", "old-real-result");
      database.sqlite.exec(next.sql);
      const restored = database.sqlite
        .prepare("SELECT * FROM production_episode_results WHERE id = ?")
        .get("old-real-result");
      expect(restored).toMatchObject({
        workflow_id: "old-real-workflow",
        adoption_key: "old-real-workflow",
        version: 3,
        value_json: json,
      });
      expect(
        database.sqlite
          .prepare("SELECT result_id FROM production_episode_result_heads")
          .get(),
      ).toMatchObject({ result_id: "old-real-result" });
      const insert = database.sqlite.prepare(
        "INSERT INTO production_episode_results(id,project_id,episode_key,operation,adoption_key,version,value_json,adopted_at,workflow_id) VALUES (?, 'actual-project', 'episode', 'episode-script', ?, ?, '{}', '2026-10-02T00:00:00.000Z', ?)",
      );
      insert.run("human-1", "human-script-revision:preview-1", 4, null);
      insert.run("human-2", "human-script-revision:preview-2", 5, null);
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM production_episode_results WHERE workflow_id IS NULL",
          )
          .get(),
      ).toMatchObject({ count: 2 });
      expect(() =>
        insert.run(
          "duplicate-adoption",
          "human-script-revision:preview-1",
          6,
          null,
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          "duplicate-workflow",
          "different-key",
          6,
          "old-real-workflow",
        ),
      ).toThrow();
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
});

describe("media shot source forward migration", () => {
  it("audio revision migration preserves old track/proof bytes, has no inferred lineage backfill and enforces immutable linked owners", () => {
    const database = openDatabase(":memory:");
    try {
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      const migrations = createMediaPlugin().migrations!;
      const next = migrations.find(
        (value) => value.id === "media.0009.explicit-audio-revisions",
      )!;
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_tracks VALUES ('old-track','actual-project','old-episode','dialogue','old-label','actual-hash',?,'adopted',0,NULL,4,'2026-09-30T00:00:00.000Z','2026-09-30T00:00:00.000Z')",
        )
        .run('[{"id":"old-clip","text":"old exact text"}]');
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_track_sources VALUES ('old-track','original-proof','actual-hash')",
        )
        .run();
      const before = database.sqlite
        .prepare("SELECT * FROM media_audio_tracks")
        .all();
      const proof = database.sqlite
        .prepare("SELECT * FROM media_audio_track_sources")
        .all();
      database.sqlite.exec(next.sql);
      expect(
        database.sqlite.prepare("SELECT * FROM media_audio_tracks").all(),
      ).toEqual(before);
      expect(
        database.sqlite
          .prepare("SELECT * FROM media_audio_track_sources")
          .all(),
      ).toEqual(proof);
      for (const table of [
        "media_audio_revisions",
        "media_audio_revision_heads",
        "media_audio_track_revision_links",
        "media_audio_revision_adopted_heads",
        "media_audio_revision_requests",
      ])
        expect(database.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(
          [],
        );
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_revisions VALUES ('review','old-track','exact-frozen-review','2026-10-02T00:00:00.000Z')",
        )
        .run();
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_track_revision_links VALUES ('old-track','original-lineage')",
        )
        .run();
      expect(() =>
        database.sqlite
          .prepare(
            "UPDATE media_audio_track_revision_links SET value_json = 'forged'",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO media_audio_revision_heads VALUES ('old-track','missing')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO media_audio_track_revision_links VALUES ('missing','forged')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO media_audio_revision_requests VALUES ('key','hash','missing')",
          )
          .run(),
      ).toThrow();
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
  it("audio source migration preserves historical track bytes without backfill and enforces immutable owner proof", () => {
    const database = openDatabase(":memory:");
    try {
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      const migrations = createMediaPlugin().migrations!;
      const next = migrations.find(
        (value) => value.id === "media.0008.audio-source-snapshots",
      )!;
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_tracks VALUES ('old-track','actual-project','old-episode','dialogue','old-label','old-text-only-fingerprint',?,'adopted',0,NULL,4,'2026-09-30T00:00:00.000Z','2026-09-30T00:00:00.000Z')",
        )
        .run('[{"id":"old-clip","text":"old exact text","shotId":"old-shot"}]');
      const before = database.sqlite
        .prepare("SELECT * FROM media_audio_tracks")
        .get();
      database.sqlite.exec(next.sql);
      expect(
        database.sqlite.prepare("SELECT * FROM media_audio_tracks").get(),
      ).toEqual(before);
      expect(
        database.sqlite
          .prepare("SELECT * FROM media_audio_track_sources")
          .all(),
      ).toEqual([]);
      database.sqlite
        .prepare(
          "INSERT INTO media_audio_track_sources VALUES ('old-track','{\"actual\":\"original proof\"}','actual-hash')",
        )
        .run();
      expect(() =>
        database.sqlite
          .prepare(
            "UPDATE media_audio_track_sources SET fingerprint = 'forged'",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO media_audio_track_sources VALUES ('old-track','{}','duplicate')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO media_audio_track_sources VALUES ('missing','{}','no-owner')",
          )
          .run(),
      ).toThrow();
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });

  it("audio resolution migrates forward without rewriting historical Timeline, undo/redo, assembly receipts or inventing confirmations", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createTimelinePlugin().migrations!;
      const next = migrations.find(
        (item) => item.id === "timeline.0004.explicit-audio-source-resolutions",
      )!;
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      database.sqlite
        .prepare(
          "INSERT INTO timelines(id,episode_id,manifest_json,undo_json,redo_json) VALUES ('actual-timeline','actual-episode','{\"PRIVATE\":\"original\"}','[{\"undo\":1}]','[{\"redo\":2}]')",
        )
        .run();
      database.sqlite
        .prepare(
          "INSERT INTO timeline_audio_assembly_requests VALUES ('old-key','old-hash','actual-timeline','{\"old\":true}')",
        )
        .run();
      const timeline = database.sqlite.prepare("SELECT * FROM timelines").all();
      const assembly = database.sqlite
        .prepare("SELECT * FROM timeline_audio_assembly_requests")
        .all();
      database.sqlite.exec(next.sql);
      expect(database.sqlite.prepare("SELECT * FROM timelines").all()).toEqual(
        timeline,
      );
      expect(
        database.sqlite
          .prepare("SELECT * FROM timeline_audio_assembly_requests")
          .all(),
      ).toEqual(assembly);
      expect(
        database.sqlite
          .prepare("SELECT * FROM timeline_audio_resolutions")
          .all(),
      ).toEqual([]);
      expect(
        database.sqlite
          .prepare("SELECT * FROM timeline_audio_resolution_requests")
          .all(),
      ).toEqual([]);
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO timeline_audio_resolutions VALUES ('bad','missing','{}','2026-10-02T00:00:00.000Z')",
          )
          .run(),
      ).toThrow();
      database.sqlite
        .prepare(
          "INSERT INTO timeline_audio_resolutions VALUES ('actual-preview','actual-timeline','{}','2026-10-02T00:00:00.000Z')",
        )
        .run();
      database.sqlite
        .prepare(
          "INSERT INTO timeline_audio_resolution_requests VALUES ('key','hash','actual-preview')",
        )
        .run();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO timeline_audio_resolution_requests VALUES ('key','changed','actual-preview')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO timeline_audio_resolution_requests VALUES ('foreign','hash','missing')",
          )
          .run(),
      ).toThrow();
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });

  it("audio assembly receipts migrate forward without altering timeline, undo or redo bytes", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createTimelinePlugin().migrations!;
      const next = migrations.find(
        (value) => value.id === "timeline.0003.audio-assembly-receipts",
      )!;
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      database.sqlite
        .prepare(
          "INSERT INTO timelines(id,episode_id,manifest_json,undo_json,redo_json) VALUES ('actual-timeline','actual-episode','{\"old\":true}','[{\"undo\":1}]','[{\"redo\":2}]')",
        )
        .run();
      const before = database.sqlite.prepare("SELECT * FROM timelines").get();
      database.sqlite.exec(next.sql);
      expect(database.sqlite.prepare("SELECT * FROM timelines").get()).toEqual(
        before,
      );
      expect(
        database.sqlite
          .prepare("SELECT * FROM timeline_audio_assembly_requests")
          .all(),
      ).toEqual([]);
      database.sqlite
        .prepare(
          "INSERT INTO timeline_audio_assembly_requests VALUES ('key','hash','actual-timeline','{\"actual\":true}')",
        )
        .run();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO timeline_audio_assembly_requests VALUES ('key','other','actual-timeline','{}')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        database.sqlite
          .prepare(
            "INSERT INTO timeline_audio_assembly_requests VALUES ('missing-owner','other','missing','{}')",
          )
          .run(),
      ).toThrow();
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
  it("does not promote historical editable payloads to proof and protects append-only bindings", () => {
    const database = openDatabase(":memory:");
    try {
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      const migrations = createMediaPlugin().migrations!;
      const next = migrations.find(
        (item) => item.id === "media.0007.immutable-source-bindings",
      )!;
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      const oldPayload =
        '{"sourceShotId":"actual-shot","sourceShotVersion":999,"stale":false,"actual":"PRIVATE original bytes"}';
      database.sqlite
        .prepare(
          "INSERT INTO media_records VALUES ('old-media','shot-stills','actual-project','actual-shot','old title',?,4,'2026-09-30T00:00:00.000Z','2026-09-30T00:00:00.000Z')",
        )
        .run(oldPayload);
      const before = database.sqlite
        .prepare("SELECT * FROM media_records")
        .all();
      database.sqlite.exec(next.sql);
      expect(
        database.sqlite.prepare("SELECT * FROM media_records").all(),
      ).toEqual(before);
      expect(
        database.sqlite
          .prepare("SELECT * FROM media_record_source_bindings")
          .all(),
      ).toEqual([]);
      expect(
        database.sqlite
          .prepare("SELECT * FROM media_record_source_heads")
          .all(),
      ).toEqual([]);
      const insert = database.sqlite.prepare(
        "INSERT INTO media_record_source_bindings VALUES (?, 'old-media','actual-shot',?, ?,?,'human-review','2026-10-02T00:00:00.000Z')",
      );
      insert.run("actual-proof", 2, "a".repeat(64), 1);
      database.sqlite
        .prepare(
          "INSERT INTO media_record_source_heads VALUES ('old-media','actual-proof')",
        )
        .run();
      expect(() =>
        database.sqlite
          .prepare("UPDATE media_record_source_bindings SET shot_version = 999")
          .run(),
      ).toThrow("immutable");
      expect(() => insert.run("bad-negative", -1, "a".repeat(64), 2)).toThrow();
      expect(() =>
        insert.run("duplicate-version", 2, "a".repeat(64), 1),
      ).toThrow();
      insert.run("second-proof", 3, "b".repeat(64), 2);
      database.sqlite
        .prepare(
          "UPDATE media_record_source_heads SET binding_id = 'second-proof'",
        )
        .run();
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM media_record_source_bindings")
          .get(),
      ).toMatchObject({ count: 2 });
      expect(
        database.sqlite.prepare("SELECT * FROM media_records").all(),
      ).toEqual(before);
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
  it("keeps historical provider jobs byte-for-byte, leaves unknown source versions NULL and enforces nonnegative actual versions", () => {
    const database = openDatabase(":memory:");
    try {
      const migrations = createMediaPlugin().migrations!;
      const next = migrations.find(
        (value) => value.id === "media.0006.shot-source-versions",
      )!;
      database.sqlite.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('actual-project');",
      );
      for (const migration of migrations) {
        if (migration.id === next.id) break;
        database.sqlite.exec(migration.sql);
      }
      const request =
        '{"prompt":"historical original bytes","shotId":"old-shot"}';
      const results = '["old-actual-media-record"]';
      database.sqlite
        .prepare(
          `INSERT INTO media_video_jobs(
          id, task_id, project_id, episode_id, shot_id, provider_id,
          remote_job_id, prompt, request_json, status, results_json,
          created_at, updated_at, provider_kind, model_revision,
          idempotency_key, request_sha256, remote_status, archive_status
        ) VALUES ('historical-job', 'old-task', 'actual-project', 'old-episode',
          'old-shot', 'old-provider', 'old-remote-job', 'historical prompt', ?,
          'running', ?, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z',
          'seedance', 'old-model-revision', 'old-idempotency-key', ?,
          'succeeded', 'pending')`,
        )
        .run(request, results, "a".repeat(64));
      const before = database.sqlite
        .prepare("SELECT * FROM media_video_jobs")
        .get() as Record<string, unknown>;
      database.sqlite.exec(next.sql);
      expect(
        database.sqlite.prepare("SELECT * FROM media_video_jobs").get(),
      ).toEqual({
        ...before,
        source_shot_version: null,
      });
      const update = database.sqlite.prepare(
        "UPDATE media_video_jobs SET source_shot_version = ? WHERE id = 'historical-job'",
      );
      expect(() => update.run(-1)).toThrow();
      update.run(0);
      expect(
        database.sqlite
          .prepare("SELECT source_shot_version FROM media_video_jobs")
          .get(),
      ).toEqual({ source_shot_version: 0 });
      update.run(7);
      expect(
        database.sqlite
          .prepare(
            "SELECT request_json, results_json, source_shot_version FROM media_video_jobs",
          )
          .get(),
      ).toEqual({
        request_json: request,
        results_json: results,
        source_shot_version: 7,
      });
      expect(
        database.sqlite.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
});
