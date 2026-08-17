import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { EngineEvent } from "@dramaip/contracts";
import type { EngineControlBridge, EngineKind } from "@dramaip/agents";
import { applyMigrations, foundationMigrations } from "@dramaip/database";
import { bootDramaRuntime, prepareDramaRuntime } from "@dramaip/runtime";

class MigrationBridge implements EngineControlBridge {
  async call<T>(kind: EngineKind, method: string): Promise<T> {
    if (method === "health")
      return { status: "unavailable", version: `migration-${kind}` } as T;
    if (method === "capabilities") {
      return {
        streaming: true,
        interrupt: true,
        resume: true,
        fork: true,
        tools: [],
      } as T;
    }
    throw new Error(`unexpected migration bridge call ${kind}.${method}`);
  }

  async *stream(): AsyncIterable<EngineEvent> {
    yield* [] as EngineEvent[];
  }
}

test("forward migration converts persisted Hermes selections to Pi without losing relations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-next-pi-migrate-"));
  const databaseFile = join(directory, "dramaip.db");
  const backupDirectory = join(directory, "backups");
  const profileText = await readFile(
    new URL("../../profiles/studio.json", import.meta.url),
    "utf8",
  );
  const bridge = new MigrationBridge();
  const engineTokens = {
    opencode: "migration-opencode",
    codex: "migration-codex",
    dsh: "migration-dsh",
    pi: "migration-pi",
    langgraph: "migration-langgraph",
  } as const;
  const config = {
    profileText,
    databaseFile,
    backupDirectory,
    username: "migration",
    password: "migration-secret",
    allowedOrigins: [] as string[],
    engineBridge: bridge,
    engineTokens,
  };
  const prepared = prepareDramaRuntime(config);
  const currentMigrations = [
    ...foundationMigrations,
    ...prepared.profile.plugins.flatMap(
      ({ id }) => prepared.builtins.get(id)?.migrations ?? [],
    ),
  ];
  const legacyMigrations = currentMigrations.filter(
    (migration) =>
      migration.id !== "agents-0003" && migration.id !== "agents-0004",
  );
  const database = new DatabaseSync(databaseFile);
  database.exec("PRAGMA foreign_keys = ON");
  applyMigrations(database, legacyMigrations);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO workspace_projects
       (id, name, description, status, version, created_at, updated_at)
       VALUES ('project', '旧引擎项目', '', 'active', 1, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO agents_provider_settings
       (kind, credential_ref, config_json, enabled, version, updated_at)
       VALUES ('hermes', 'credential', '{}', 1, 2, ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO agents_sessions
       (id, engine_session_id, project_id, engine_kind, title, state,
        version, created_at, updated_at)
       VALUES ('session', 'engine-session', 'project', 'hermes', '旧会话',
               'active', 1, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO assistant_conversations
       (id, project_id, session_id, title, engine_kind, model, status,
        version, created_at, updated_at)
       VALUES ('conversation', 'project', 'session', '旧对话', 'hermes',
               'legacy-model', 'active', 1, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO assistant_turns
       (id, conversation_id, role, content, created_at)
       VALUES ('turn', 'conversation', 'user', '保留内容', ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO agent_task_settings
       (scope_type, scope_id, engine_kind, model, advanced_mode, version, updated_at)
       VALUES ('project', 'project', 'hermes', 'legacy-model', 1, 1, ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO agent_experiments
       (id, project_id, prompt, task_type, status, version, created_at, updated_at)
       VALUES ('experiment', 'project', '比较', 'project-chat', 'ready', 1, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO agent_experiment_candidates
       (id, experiment_id, engine_kind, ordinal, state, output, created_at)
       VALUES ('candidate', 'experiment', 'hermes', 4, 'succeeded', '候选', ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO agent_experiment_reviews
       (id, experiment_id, selected_candidate_id, scores_json, notes, created_at)
       VALUES ('review', 'experiment', 'candidate', '{}', '', ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO agents_assistants
       (id, project_id, name, instructions, engine_kind, version, created_at, updated_at)
       VALUES ('assistant', 'project', '旧助手', '', 'hermes', 1, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO agents_experiments
       (id, project_id, name, config_json, state, version, created_at, updated_at)
       VALUES ('legacy-experiment', 'project', '旧盲测',
               '{"engines":["hermes"]}', 'ready', 1, ?, ?)`,
    )
    .run(now, now);
  database.close();

  const kernel = await bootDramaRuntime(config);
  try {
    const engineKinds = kernel.context.uow.execute((tx) => ({
      provider: tx.get<{ value: string }>(
        "SELECT kind AS value FROM agents_provider_settings",
      )!.value,
      session: tx.get<{ value: string }>(
        "SELECT engine_kind AS value FROM agents_sessions WHERE id = 'session'",
      )!.value,
      conversation: tx.get<{ value: string }>(
        "SELECT engine_kind AS value FROM assistant_conversations WHERE id = 'conversation'",
      )!.value,
      setting: tx.get<{ value: string }>(
        "SELECT engine_kind AS value FROM agent_task_settings WHERE scope_id = 'project'",
      )!.value,
      candidate: tx.get<{ value: string }>(
        "SELECT engine_kind AS value FROM agent_experiment_candidates WHERE id = 'candidate'",
      )!.value,
      assistant: tx.get<{ value: string }>(
        "SELECT engine_kind AS value FROM agents_assistants WHERE id = 'assistant'",
      )!.value,
    }));
    assert.deepEqual(new Set(Object.values(engineKinds)), new Set(["pi"]));
    const retained = kernel.context.uow.execute((tx) => ({
      turn: tx.get<{ value: string }>(
        "SELECT content AS value FROM assistant_turns WHERE id = 'turn'",
      )!.value,
      review: tx.get<{ value: string }>(
        "SELECT selected_candidate_id AS value FROM agent_experiment_reviews WHERE id = 'review'",
      )!.value,
      config: tx.get<{ value: string }>(
        "SELECT config_json AS value FROM agents_experiments WHERE id = 'legacy-experiment'",
      )!.value,
      violations: tx.all("PRAGMA foreign_key_check").length,
    }));
    assert.equal(retained.turn, "保留内容");
    assert.equal(retained.review, "candidate");
    assert.equal(retained.config, '{"engines":["pi"]}');
    assert.equal(retained.violations, 0);
    const backups = await readdir(backupDirectory);
    assert.ok(backups.some((name) => name.endsWith(".db")));
  } finally {
    await kernel.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
