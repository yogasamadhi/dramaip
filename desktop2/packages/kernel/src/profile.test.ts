import assert from "node:assert/strict";
import test from "node:test";

import type { DramaPluginExports } from "@dramaip/plugin-api";

import {
  parseProfileText,
  ProfileValidationError,
  validatePluginGraph,
} from "./profile.ts";

const known = new Set(["foundation", "system"]);

test("profile accepts only strict builtin JSON entries", () => {
  const profile = parseProfileText(
    '{"name":"test","plugins":[{"id":"foundation"}]}',
    known,
  );
  assert.equal(profile.plugins[0]?.id, "foundation");
});

for (const [name, source] of [
  ["package name", '{"name":"test","plugins":[{"id":"@scope/plugin"}]}'],
  ["relative path", '{"name":"test","plugins":[{"id":"./plugin"}]}'],
  [
    "environment expression",
    '{"name":"test","plugins":[{"id":"foundation","config":"${TOKEN}"}]}',
  ],
  ["yaml JavaScript", "name: test\nplugins: !!js/function >\n  process.exit()"],
] as const) {
  test(`profile rejects ${name}`, () => {
    assert.throws(
      () => parseProfileText(source, known),
      ProfileValidationError,
    );
  });
}

test("plugin graph sorts dependencies and rejects cycles", () => {
  const module = (
    id: string,
    requires: string[],
  ): DramaPluginExports<unknown> => ({
    descriptor: {
      id,
      version: "1.0.0",
      runtime: "server",
      requires,
      provides: [],
      critical: true,
    },
    contracts: {},
  });
  const graph = new Map([
    ["foundation", module("foundation", [])],
    ["system", module("system", ["foundation"])],
  ]);
  assert.deepEqual(validatePluginGraph(graph, ["system", "foundation"]), [
    "foundation",
    "system",
  ]);
  graph.set("foundation", module("foundation", ["system"]));
  assert.throws(
    () => validatePluginGraph(graph, ["foundation", "system"]),
    /cycle/,
  );
});
