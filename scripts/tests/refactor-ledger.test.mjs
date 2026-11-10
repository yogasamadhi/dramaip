import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLedger, verifyLedger } from "../refactor-ledger.mjs";

function facts(overrides = {}) {
  return {
    operations: [
      { operationId: "review.list", method: "get", path: "/api/v2/review" },
      {
        operationId: "review.update",
        method: "put",
        path: "/api/v2/review/{id}",
      },
      { operationId: "health.get", method: "get", path: "/api/v2/health" },
    ],
    routeOwners: new Map([
      ["review.list", "review"],
      ["review.update", "review"],
      ["health.get", "runtime"],
    ]),
    compat: new Set(),
    replaced: new Map(),
    retired: new Map(),
    specs: ["abc-smoke.spec.ts"],
    migratedSpecs: new Set(),
    plugins: ["review", "system"],
    ...overrides,
  };
}

test("freezes every operation as legacy with its target packages", () => {
  const ledger = buildLedger(facts());
  assert.deepEqual(ledger.summary, {
    legacy: 3,
    compat: 0,
    migrated: 0,
    retired: 0,
  });
  const health = ledger.operations.find(
    (entry) => entry.operationId === "health.get",
  );
  assert.equal(health.domain, "system");
  assert.equal(health.hostPackage, "@dramaip/system-system");
  assert.equal(health.clientPackage, "@dramaip/system-system-client");
  assert.deepEqual(verifyLedger(ledger, facts()), []);
});

test("derives compat, migrated and retired from code facts", () => {
  const frozen = buildLedger(facts());
  const later = facts({
    operations: facts().operations.filter(
      (operation) => operation.operationId === "health.get",
    ),
    compat: new Set(["health.get"]),
    replaced: new Map([["review.list", "packages/review/review/src/index.ts"]]),
    retired: new Map([
      [
        "review.update",
        { operationId: "review.update", reason: "merged into review.save" },
      ],
    ]),
    plugins: ["system"],
  });
  const ledger = buildLedger(later, frozen);
  const states = Object.fromEntries(
    ledger.operations.map((entry) => [entry.operationId, entry.state]),
  );
  assert.deepEqual(states, {
    "health.get": "compat",
    "review.list": "migrated",
    "review.update": "retired",
  });
  assert.deepEqual(
    ledger.plugins.map((plugin) => [plugin.id, plugin.state]),
    [
      ["review", "migrated"],
      ["system", "legacy"],
    ],
  );
  assert.deepEqual(verifyLedger(ledger, later, { domain: "review" }), []);
  assert.deepEqual(verifyLedger(ledger, later, { require: "compat" }), []);
});

test("rejects new operations, silent removals and unfinished domains", () => {
  const frozen = buildLedger(facts());
  const drifted = facts({
    operations: [
      ...facts().operations.filter(
        (operation) => operation.operationId !== "review.update",
      ),
      {
        operationId: "review.extra",
        method: "post",
        path: "/api/v2/review/extra",
      },
    ],
  });
  const ledger = buildLedger(drifted, frozen);
  assert.deepEqual(verifyLedger(ledger, drifted, { domain: "review" }), [
    "new operation outside the frozen ledger: review.extra (feature freeze; compat accepts no new routes)",
    "operation removed without migration or retirement: review.update",
    "review.list is legacy; domain review is not done",
    "review.update is legacy; domain review is not done",
  ]);
});

test("a retirement needs a reason", () => {
  const retiredWithoutReason = facts({
    retired: new Map([["health.get", { operationId: "health.get" }]]),
  });
  const ledger = buildLedger(retiredWithoutReason);
  assert.deepEqual(verifyLedger(ledger, retiredWithoutReason), [
    "retired operation has no reason: health.get",
  ]);
});
