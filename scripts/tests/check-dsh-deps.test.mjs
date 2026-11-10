import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { findDshDependencyViolations } from "../check-dsh-deps.mjs";

const base = await mkdtemp(join(tmpdir(), "dramaip-dsh-deps-"));
after(() => rm(base, { recursive: true, force: true }));

async function samplePackage(name, manifest, source = "") {
  const directory = join(base, "packages", name);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "src", "index.ts"), source);
}

test("accepts the nine Cordis framework packages", async () => {
  await samplePackage(
    "framework-only",
    {
      name: "@dramaip/framework-only",
      dependencies: {
        "@deepseek-ai/cordis": "workspace:*",
        "@deepseek-ai/cordis-plugin-loader": "workspace:*",
      },
    },
    'import { Context } from "@deepseek-ai/cordis";\nimport "@deepseek-ai/cordis-plugin-hmr/src/index";\n',
  );
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/framework-only"]),
    [],
  );
});

test("rejects a package that depends on a DSH component package", async () => {
  await samplePackage("uses-dsh-webserver", {
    name: "@dramaip/uses-dsh-webserver",
    dependencies: { "@deepseek-ai/dsh-host-webserver": "0.2.1-rc.3" },
  });
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/uses-dsh-webserver"]),
    [
      "packages/uses-dsh-webserver/package.json: dependencies @deepseek-ai/dsh-host-webserver",
    ],
  );
});

test("rejects source that imports a DSH component package", async () => {
  await samplePackage(
    "imports-dsh-storage",
    { name: "@dramaip/imports-dsh-storage" },
    'import type { Storage } from "@deepseek-ai/dsh-storage";\n',
  );
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/imports-dsh-storage"]),
    [
      "packages/imports-dsh-storage/src/index.ts: imports @deepseek-ai/dsh-storage",
    ],
  );
});

test("rejects retired stacks even when they are declared only for development", async () => {
  await samplePackage("retired", {
    name: "@dramaip/retired",
    devDependencies: { effect: "4.0.0-beta.83", "lucide-react": "0.454.0" },
  });
  const problems = await findDshDependencyViolations(base, [
    "packages/retired",
  ]);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => problem.includes("is retired")));
});

test("rejects retired subpath imports but permits the Cordis effect lifecycle", async () => {
  await samplePackage(
    "retired-import",
    { name: "@dramaip/retired-import" },
    'import { Schema } from "effect/Schema";\n',
  );
  assert.equal(
    (await findDshDependencyViolations(base, ["packages/retired-import"]))
      .length,
    1,
  );
  await samplePackage(
    "cordis-effect",
    { name: "@dramaip/cordis-effect" },
    'import { Context } from "@deepseek-ai/cordis";\nctx.effect(() => () => {});\n',
  );
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/cordis-effect"]),
    [],
  );
});

test("keeps the TypeScript loader in development dependencies", async () => {
  await samplePackage("host", {
    name: "@dramaip/desktop-host-process",
    dependencies: { tsx: "4.22.4" },
  });
  assert.equal(
    (await findDshDependencyViolations(base, ["packages/host"])).length,
    1,
  );
  await samplePackage("host", {
    name: "@dramaip/desktop-host-process",
    devDependencies: { tsx: "4.22.4" },
  });
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/host"]),
    [],
  );
});

test("keeps browser bundles' editor dependencies out of the Host closure", async () => {
  const manifest = {
    name: "@dramaip/browser-plugin",
    dramaip: { client: { platform: "web" } },
  };
  await samplePackage("browser", {
    ...manifest,
    dependencies: { "@tiptap/react": "2.27.3" },
  });
  assert.equal(
    (await findDshDependencyViolations(base, ["packages/browser"])).length,
    1,
  );
  await samplePackage("browser", {
    ...manifest,
    devDependencies: { "@tiptap/react": "2.27.3" },
  });
  assert.deepEqual(
    await findDshDependencyViolations(base, ["packages/browser"]),
    [],
  );
});
