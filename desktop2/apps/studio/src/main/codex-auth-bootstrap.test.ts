import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bootstrapCodexAuthentication,
  disableCodexAuthBootstrap,
} from "./codex-auth-bootstrap.ts";

test("Codex auth bootstrap imports only a validated credential file", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-bootstrap-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  await mkdir(source);
  await writeFile(
    join(source, "auth.json"),
    JSON.stringify({ tokens: { access_token: "access" } }),
  );

  assert.equal(
    await bootstrapCodexAuthentication({
      sourceHome: source,
      destinationHome: destination,
    }),
    "imported",
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(destination, "auth.json"), "utf8")),
    { tokens: { access_token: "access" } },
  );
  assert.equal(
    (await stat(join(destination, "auth.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    await bootstrapCodexAuthentication({
      sourceHome: source,
      destinationHome: destination,
    }),
    "already_configured",
  );
});

test("Codex auth bootstrap rejects symlinks and can be disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-bootstrap-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  await mkdir(source);
  await mkdir(destination);
  await writeFile(
    join(source, "real.json"),
    JSON.stringify({ OPENAI_API_KEY: "x" }),
  );
  await writeFile(join(source, "auth.json"), "invalid");
  assert.equal(
    await bootstrapCodexAuthentication({
      sourceHome: source,
      destinationHome: destination,
    }),
    "source_invalid",
  );
  await disableCodexAuthBootstrap(destination);
  assert.equal(
    await bootstrapCodexAuthentication({
      sourceHome: source,
      destinationHome: destination,
    }),
    "disabled",
  );
  await chmod(destination, 0o700);
});
