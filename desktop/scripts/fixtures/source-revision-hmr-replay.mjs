import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bootRuntime, loadProfile } from "./packages/runtime/src/index.js";
import { createDesktopHost } from "./packages/desktop-host/src/index.js";
import { openDatabase } from "./packages/database/src/index.js";

// This fixture runs in a second OS process with the same isolated SQLite file.
assert.equal(process.versions.node, "24.18.0");
assert.equal(process.versions.bun, undefined);
const checkpoint = JSON.parse(
  await readFile(
    new URL("./source-file-hmr-checkpoint.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(checkpoint.entryPath, process.argv[2]);
assert.equal(checkpoint.lifecycle, process.argv[3]);
const databasePath = fileURLToPath(
  new URL("./source-state.sqlite", import.meta.url),
);
let modelCalls = 0;
const host = createDesktopHost({
  accessToken: "fresh-source-replay-host",
  capabilities: [],
  actions: {
    engineHealth: async () => ({
      available: true,
      healthy: true,
      configured: true,
      authenticated: true,
      generation: 1,
    }),
    engineOperation: async () => {
      throw new Error(
        "fresh-process receipt replay must not allocate a model session",
      );
    },
    async *engineStream() {
      modelCalls++;
      throw new Error("fresh-process receipt replay must not call any model");
    },
  },
});
const hostServer = await host.start({ hostname: "127.0.0.1", port: 0 });
let runtime;
let database;
let server;
try {
  runtime = await bootRuntime({
    databasePath,
    profile: loadProfile(new URL("./profiles/e2e.json", import.meta.url)),
    runtimeKind: "node",
    mode: "headless",
    accessToken: "fresh-source-replay-runtime",
    host: {
      baseUrl: "http://127.0.0.1:" + hostServer.port,
      accessToken: "fresh-source-replay-host",
    },
  });
  server = await runtime.start({ hostname: "127.0.0.1", port: 0 });
  database = openDatabase(databasePath);
  const state = () =>
    database.uow.execute((tx) => ({
      previews: tx.all(
        "SELECT * FROM production_episode_source_revisions ORDER BY id",
      ),
      receipts: tx.all(
        "SELECT * FROM production_episode_source_revision_requests ORDER BY request_key",
      ),
      results: tx.all("SELECT * FROM production_episode_results ORDER BY id"),
      heads: tx.all(
        "SELECT * FROM production_episode_result_heads ORDER BY project_id,episode_key,operation",
      ),
      events: tx.all(
        "SELECT * FROM domain_events WHERE plugin_id='production' AND aggregate_type IN ('episode-result','episode-source-revision') ORDER BY cursor",
      ),
      documents: tx.all("SELECT * FROM screenplay_documents ORDER BY id"),
      snapshots: tx.all("SELECT * FROM agent_context_snapshots ORDER BY id"),
      contextPreviews: tx.all(
        "SELECT * FROM agent_context_previews ORDER BY id",
      ),
      contextPreparations: tx.all(
        "SELECT * FROM agent_context_preparations ORDER BY preparation_scope,key_sha256",
      ),
      originalProjects: tx.all("SELECT * FROM projects ORDER BY id"),
      originalProductionRecords: tx.all(
        "SELECT * FROM production_records ORDER BY id",
      ),
      originalChapters: tx.all("SELECT * FROM chapters ORDER BY id"),
      originalVolumes: tx.all("SELECT * FROM writing_volumes ORDER BY id"),
      originalMemories: tx.all(
        "SELECT * FROM knowledge_chapter_memories ORDER BY id",
      ),
      originalKnowledge: tx.all("SELECT * FROM knowledge_records ORDER BY id"),
      originalHigher: tx.all(
        "SELECT * FROM knowledge_narrative_summaries ORDER BY id",
      ),
      originalHigherHeads: tx.all(
        "SELECT * FROM knowledge_narrative_summary_heads ORDER BY project_id,target_kind,target_id",
      ),
    }));
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(
    sha(
      await readFile(
        new URL(
          "./plugins/production/src/episode-source-revision.js",
          import.meta.url,
        ),
      ),
    ),
    checkpoint.changedModuleSha256,
  );
  const before = state();
  assert.equal(sha(JSON.stringify(before)), checkpoint.exactReceiptSha256);
  const json = async (path, init = {}) => {
    const response = await fetch(
      new Request("http://127.0.0.1:" + server.port + path, {
        ...init,
        headers: {
          Authorization: "Bearer fresh-source-replay-runtime",
          "Content-Type": "application/json",
          ...init.headers,
        },
      }),
    );
    assert.equal(
      response.status,
      200,
      "fresh-process original receipt route must succeed",
    );
    return response.json();
  };
  assert.deepEqual(
    await json(checkpoint.adoptPath, {
      method: "POST",
      headers: {
        "If-Match": '"' + checkpoint.requestVersion + '"',
        "Idempotency-Key": checkpoint.adoptKey,
      },
      body: JSON.stringify(checkpoint.adoption),
    }),
    checkpoint.adopted,
  );
  assert.deepEqual(
    await json(checkpoint.previewPath, {
      method: "POST",
      headers: {
        "If-Match": '"' + checkpoint.sourceInput.sourceVersion + '"',
        "Idempotency-Key": checkpoint.previewKey,
      },
      body: JSON.stringify(checkpoint.sourceInput),
    }),
    checkpoint.adopted,
  );
  assert.deepEqual(
    await json("/api/v2/scripts/" + checkpoint.scriptRecordId + "/screenplay"),
    checkpoint.manuscript,
  );
  const changedBranch = await fetch(
    new Request("http://127.0.0.1:" + server.port + checkpoint.adoptPath, {
      method: "POST",
      headers: {
        Authorization: "Bearer fresh-source-replay-runtime",
        "Content-Type": "application/json",
        "If-Match":
          '"' +
          (checkpoint.lifecycle === "create-preview"
            ? checkpoint.sourceInput.sourceVersion
            : 1) +
          '"',
        "Idempotency-Key":
          checkpoint.lifecycle === "create-preview"
            ? checkpoint.previewKey
            : randomUUID(),
      },
      body: JSON.stringify(
        checkpoint.lifecycle === "create-preview"
          ? {
              ...checkpoint.sourceInput,
              tokenBudget: checkpoint.sourceInput.tokenBudget + 1,
            }
          : { ...checkpoint.adoption, stateVersion: 1 },
      ),
    }),
  );
  assert.equal(changedBranch.status, 409);
  assert.equal(
    (await changedBranch.json()).detail,
    checkpoint.newMessage,
    "the fresh OS process must load the actual changed owner implementation",
  );
  assert.deepEqual(
    await json(
      "/api/v2/episode-source-revisions/" +
        checkpoint.adopted.id +
        "/source-context",
    ),
    checkpoint.sourceContext,
  );
  assert.deepEqual(state(), before);
  assert.equal(modelCalls, 0);
  assert.equal(runtime.kernel.diagnostics().plugins.length, 14);
  assert.ok(
    runtime.kernel
      .diagnostics()
      .plugins.every((plugin) => plugin.status === "active"),
  );
  process.send({
    type: "passed",
    entryPath: checkpoint.entryPath,
    lifecycle: checkpoint.lifecycle,
    processId: process.pid,
    exactReceiptSha256: checkpoint.exactReceiptSha256,
    freshProcessOriginalReceiptReplay: true,
    changedModuleSha256: checkpoint.changedModuleSha256,
    actualChangedOwnerBranchObserved: true,
    newModelCalls: modelCalls,
  });
} finally {
  await runtime?.stop();
  database?.close();
  hostServer.close();
}
