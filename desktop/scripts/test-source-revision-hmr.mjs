import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// This runner never rebuilds the shared artifacts or starts an Electron window.
// It copies the built Runtime and exercises the real owner/Host/SQLite boundary.
assert.equal(process.versions.node, "24.18.0");
assert.equal(process.versions.bun, undefined);
const compiled = fileURLToPath(new URL("../build/runtime/", import.meta.url));
const fixtures = new URL("./fixtures/", import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const selected = process.argv[2]
  ? [process.argv[2]]
  : [
      "inspiration",
      "script",
      "volume-original",
      "story-arc-original",
      "volume-summary",
      "story-arc-summary",
    ];
const lifecycles = process.argv[3]
  ? [process.argv[3]]
  : ["create-preview", "adopt", "discard"];
assert.ok(
  lifecycles.every((value) =>
    ["create-preview", "adopt", "discard"].includes(value),
  ),
);
for (const entryPath of selected)
  for (const lifecycle of lifecycles) {
    assert.ok(
      [
        "inspiration",
        "script",
        "volume-original",
        "story-arc-original",
        "volume-summary",
        "story-arc-summary",
      ].includes(entryPath),
    );
    const directory = await mkdtemp(
      join(tmpdir(), "dramaip-source-revision-hmr-"),
    );
    let child;
    try {
      await cp(compiled, directory, {
        recursive: true,
        verbatimSymlinks: true,
        // Shared development runtimes atomically replace their recovery journal.
        // A detached test starts its own journal; these are not build inputs.
        filter: (path) =>
          path !== join(compiled, ".last-good.json") &&
          path !== join(compiled, ".last-good.json.tmp"),
      });
      const worker = join(directory, "source-revision-hmr-worker.mjs");
      const replayWorker = join(directory, "source-revision-hmr-replay.mjs");
      await cp(
        fileURLToPath(new URL("source-revision-hmr-worker.mjs", fixtures)),
        worker,
      );
      await cp(
        fileURLToPath(new URL("source-revision-hmr-replay.mjs", fixtures)),
        replayWorker,
      );
      await cp(
        fileURLToPath(new URL("source-revision-hmr-novel.mjs", fixtures)),
        join(directory, "source-revision-hmr-novel.mjs"),
      );
      const originalModuleSha256 = sha(
        await readFile(
          join(directory, "plugins/production/src/episode-source-revision.js"),
        ),
      );
      const runChild = async (entry) => {
        const messages = [];
        let output = "";
        child = fork(entry, [entryPath, lifecycle], {
          cwd: directory,
          execPath: process.execPath,
          execArgv: ["--expose-internals"],
          env: { ...process.env, DRAMAIP_DEBUG_BACKGROUND: "1" },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.on("message", (message) => messages.push(message));
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "Source revision HMR integration timed out: " + output,
                ),
              ),
            150_000,
          );
          child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child.once("exit", (code, signal) => {
            clearTimeout(timeout);
            if (code !== 0)
              reject(
                new Error(
                  "Source revision HMR integration failed (" +
                    code +
                    ", " +
                    signal +
                    "): " +
                    output,
                ),
              );
            else resolve(messages.find((value) => value.type === "passed"));
          });
        });
      };
      const result = await runChild(worker);
      assert.ok(
        result,
        "the original worker must return its own result and exit normally",
      );
      assert.equal(result.entryPath, entryPath);
      assert.equal(result.lifecycle, lifecycle);
      assert.equal(
        result.modelCallsBeforeHmr,
        ["inspiration", "script"].includes(entryPath) ? 6 : 14,
      );
      if (lifecycle === "create-preview") {
        assert.equal(result.newPreviewCreationInFlightVerified, true);
        assert.equal(result.singleOriginalContextPreparation, true);
      } else assert.equal(result.unchangedContextPreparation, true);
      if (lifecycle !== "adopt")
        assert.equal(result.unchangedFormalHeads, true);
      if (lifecycle === "discard")
        assert.equal(result.discardedCandidateVerified, true);
      assert.equal(result.originalModuleSha256, originalModuleSha256);
      assert.equal(result.actualChangedOwnerBranchObserved, true);
      assert.equal(result.failedActualSourceImportRecovered, true);
      assert.equal(result.sqliteReconstructionVerified, true);
      assert.equal(result.originalSourceRowsPreserved, true);
      assert.equal(result.routerRevisionDelta, 1);
      assert.equal(result.restoredModuleReloadDelta, 1);
      if (!["inspiration", "script"].includes(entryPath))
        assert.equal(result.modelCallsBeforeHmr, 14);
      assert.equal(result.newModelCallsDuringHmrAndReplay, 0);
      const freshProcess = await runChild(replayWorker);
      assert.ok(
        freshProcess,
        "the original fresh process must return its own result and exit normally",
      );
      assert.equal(freshProcess.entryPath, entryPath);
      assert.equal(freshProcess.lifecycle, lifecycle);
      assert.notEqual(freshProcess.processId, result.processId);
      assert.equal(freshProcess.exactReceiptSha256, result.exactReceiptSha256);
      assert.equal(
        freshProcess.changedModuleSha256,
        result.changedModuleSha256,
      );
      assert.equal(freshProcess.actualChangedOwnerBranchObserved, true);
      assert.equal(freshProcess.freshProcessOriginalReceiptReplay, true);
      assert.equal(freshProcess.newModelCalls, 0);
      console.log(
        JSON.stringify({
          scope:
            "shared six entries x actual in-flight new-preview creation/adopt/discard file-HMR lifecycle, failed import recovery, context preparation protection, original manuscript/source rows, actual changed owner branch, SQLite and fresh OS original receipts; controlled model protocol, not semantic quality or whole goal",
          ...result,
          freshProcess,
        }),
      );
    } finally {
      if (child && child.exitCode === null) child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  }
