import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import {
  agentContextManifestJSON,
  type AgentContextPreviewInput,
  type AgentContextReference,
} from "@dramaip/contracts/agent-context";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import type { PluginContext } from "@dramaip/plugin-api/internal";
import { agentMigrations } from "../../../plugins/agents/src/migrations/index.js";
import { createAgentContextStore } from "../../../plugins/agents/src/context/store.js";

const directories: string[] = [];
const databases = new Set<ReturnType<typeof openDatabase>>();
afterEach(() => {
  for (const database of databases) database.close();
  databases.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(currentMigration = true) {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-context-preparation-"));
  directories.push(directory);
  const path = join(directory, "context.sqlite");
  const open = () => {
    const database = openDatabase(path);
    databases.add(database);
    return database;
  };
  let database = open();
  applyMigrations(database.sqlite, [
    ...foundationPlugin.migrations!,
    ...agentMigrations.filter(
      (migration) => currentMigration || migration.id < "agents.0015.",
    ),
  ]);
  const project = {
    id: randomUUID(),
    version: 0,
    title: "独立上下文恢复测试",
    mode: "script",
    productionBrief: "PRIVATE original preparation brief",
  };
  const input: AgentContextPreviewInput = {
    projectId: project.id,
    runIntent: "author-source-revision",
    basePrompt: "PRIVATE original source preparation prompt",
    tokenBudget: 60_000,
    destination: { kind: "local", provider: "author-source-review" },
    temporaryOverrides: [],
  };
  const reference: AgentContextReference = {
    sourceKind: "production",
    sourceId: randomUUID(),
    sourceVersion: 0,
    fieldPath: "/production/original",
    value: { manuscript: "PRIVATE original explicitly reviewed expression" },
    sensitivity: "project",
  };
  const request = {
    scope: "production.episode-source-revision",
    keySha256: sha("PRIVATE opaque original request key"),
    requestSha256: sha("PRIVATE exact original request body"),
  };
  const store = () =>
    createAgentContextStore({
      uow: database.uow,
      get: (key: string) =>
        key === WORKSPACE_PROJECT_SERVICE.id
          ? { get: (id: string) => (id === project.id ? project : undefined) }
          : undefined,
    } as unknown as PluginContext);
  const read = (table: string) =>
    database.uow.execute((tx) =>
      tx.all<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid`),
    );
  const storage = () => ({
    previews: read("agent_context_previews"),
    snapshots: read("agent_context_snapshots"),
    receipts: read("agent_context_preparations"),
    events: read("domain_events"),
  });
  const prepare = () =>
    store().prepareCreationOnce!(input, [reference], request);
  return {
    get database() {
      return database;
    },
    project,
    input,
    reference,
    request,
    store,
    read,
    storage,
    prepare,
    restart() {
      databases.delete(database);
      database.close();
      database = open();
    },
  };
}

describe("Agents original context preparations", () => {
  it.each(["preview", "snapshot", "receipt", "event"] as const)(
    "rolls back every owned row on its actual %s write failure and then prepares exactly once",
    (stage) => {
      const data = fixture();
      const table = {
        preview: "agent_context_previews",
        snapshot: "agent_context_snapshots",
        receipt: "agent_context_preparations",
        event: "domain_events",
      }[stage];
      data.database.sqlite.exec(
        `CREATE TEMP TRIGGER controlled_prepare_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'PRIVATE controlled own preparation failure'); END`,
      );
      const before = data.storage();
      expect(() => data.prepare()).toThrow();
      expect(data.storage()).toEqual(before);
      data.database.sqlite.exec("DROP TRIGGER controlled_prepare_failure");
      const prepared = data.prepare();
      expect(prepared.status).toBe("prepared");
      const after = data.storage();
      expect(after.previews).toHaveLength(1);
      expect(after.snapshots).toHaveLength(1);
      expect(after.receipts).toHaveLength(1);
      expect(after.events).toHaveLength(1);
      expect(after.previews[0]!.status).toBe("frozen");
      expect(JSON.stringify(after.receipts)).not.toContain("PRIVATE");
      expect(JSON.stringify(after.events)).not.toContain("PRIVATE");
      expect(data.prepare()).toEqual(prepared);
      expect(data.storage()).toEqual(after);
      data.restart();
      expect(data.prepare()).toEqual(prepared);
      expect(data.storage()).toEqual(after);
    },
  );

  it("refuses an old key with another body, budget, explicit source identity, expression or current denial without allocating or modifying its original preparation", () => {
    const data = fixture();
    const original = data.prepare();
    expect(original.status).toBe("prepared");
    const before = data.storage();
    const conflict = (
      input = data.input,
      references = [data.reference],
      request = data.request,
    ) => {
      expect(
        data.store().prepareCreationOnce!(input, references, request),
      ).toEqual({
        status: "conflict",
      });
      expect(data.storage()).toEqual(before);
    };
    conflict(data.input, [data.reference], {
      ...data.request,
      requestSha256: sha("PRIVATE another request"),
    });
    conflict({ ...data.input, tokenBudget: 59_000 });
    conflict({ ...data.input, basePrompt: "PRIVATE changed base prompt" });
    conflict(data.input, [
      { ...data.reference, value: "PRIVATE changed expression" },
    ]);
    // Prepared references are the explicit owner's complete scope. Unselected
    // project metadata must not be implicitly inserted into that scope.
    data.reference.sourceVersion++;
    conflict();
    data.reference.sourceVersion--;
    expect(data.prepare()).toEqual(original);
    expect(
      data
        .store()
        .replacePolicies(data.project.id, 0, [
          { fieldPath: data.reference.fieldPath, mode: "never" },
        ]),
    ).not.toBe("conflict");
    conflict();
    expect(data.store().replacePolicies(data.project.id, 1, [])).not.toBe(
      "conflict",
    );
    expect(data.prepare()).toEqual(original);
    expect(data.storage()).toEqual(before);
  });

  it("refuses even self-consistent replacement snapshot hashes and damaged original preview state without repairing from current sources", () => {
    const data = fixture();
    const original = data.prepare();
    if (original.status !== "prepared")
      throw new Error("Original preparation required");
    const snapshot = data.read("agent_context_snapshots")[0]!;
    const entries = JSON.parse(snapshot.entries_json as string);
    entries.find(
      (entry: AgentContextReference) => entry.sourceKind === "production",
    ).value = "PRIVATE self-consistent substitute expression";
    const manifest = sha(
      agentContextManifestJSON({
        projectId: original.snapshot.projectId,
        destination: original.snapshot.destination,
        tokenBudget: original.snapshot.tokenBudget,
        entries,
      }),
    );
    const rewrite = (sql: string, ...values: (string | number)[]) =>
      data.database.uow.execute((tx) => tx.run(sql, ...values));
    const unavailable = () => {
      const before = data.storage();
      expect(data.prepare()).toEqual({ status: "unavailable" });
      expect(data.storage()).toEqual(before);
    };
    rewrite(
      "UPDATE agent_context_snapshots SET entries_json=?,manifest_sha256=? WHERE id=?",
      JSON.stringify(entries),
      manifest,
      original.snapshot.id,
    );
    unavailable();
    rewrite(
      "UPDATE agent_context_snapshots SET entries_json=?,manifest_sha256=? WHERE id=?",
      snapshot.entries_json as string,
      snapshot.manifest_sha256 as string,
      original.snapshot.id,
    );
    const changedPrompt = "PRIVATE self-consistent substitute prompt";
    rewrite(
      "UPDATE agent_context_snapshots SET final_prompt=?,final_prompt_sha256=? WHERE id=?",
      changedPrompt,
      sha(changedPrompt),
      original.snapshot.id,
    );
    unavailable();
    rewrite(
      "UPDATE agent_context_snapshots SET final_prompt=?,final_prompt_sha256=? WHERE id=?",
      snapshot.final_prompt as string,
      snapshot.final_prompt_sha256 as string,
      original.snapshot.id,
    );
    const preview = data.read("agent_context_previews")[0]!;
    rewrite(
      "UPDATE agent_context_previews SET input_json=? WHERE id=?",
      JSON.stringify({
        ...data.input,
        basePrompt: "PRIVATE changed original preview",
      }),
      original.snapshot.previewId,
    );
    unavailable();
    rewrite(
      "UPDATE agent_context_previews SET input_json=?,status='pending' WHERE id=?",
      preview.input_json as string,
      original.snapshot.previewId,
    );
    unavailable();
    rewrite(
      "UPDATE agent_context_previews SET status='frozen' WHERE id=?",
      original.snapshot.previewId,
    );
    expect(data.prepare()).toEqual(original);
    // A corrupt database can have lost the row despite its FK. No fallback is
    // permitted, including after restarting with its durable receipt intact.
    data.database.sqlite.exec("PRAGMA foreign_keys=OFF");
    rewrite(
      "DELETE FROM agent_context_snapshots WHERE id=?",
      original.snapshot.id,
    );
    data.database.sqlite.exec("PRAGMA foreign_keys=ON");
    unavailable();
    data.restart();
    unavailable();
  });

  it("forward migration preserves legacy previews and snapshots without manufacturing original preparation receipts", () => {
    const data = fixture(false);
    const original = data.store().prepareCreation!(data.input, [
      data.reference,
    ]);
    const before = {
      previews: data.read("agent_context_previews"),
      snapshots: data.read("agent_context_snapshots"),
    };
    applyMigrations(data.database.sqlite, [
      ...foundationPlugin.migrations!,
      ...agentMigrations,
    ]);
    expect(data.storage()).toEqual({ ...before, receipts: [], events: [] });
    expect(data.store().getSnapshot(original.id)).toEqual(original);
    const prepared = data.prepare();
    if (prepared.status !== "prepared")
      throw new Error("New preparation required");
    expect(prepared.snapshot.id).not.toBe(original.id);
    expect(data.read("agent_context_preparations")).toHaveLength(1);
    expect(data.read("agent_context_snapshots")).toContainEqual(
      before.snapshots[0],
    );
  });
});
