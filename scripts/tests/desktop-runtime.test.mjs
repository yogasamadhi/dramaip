import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  verifyDesktopRuntime,
  writeDesktopRuntimeManifest,
} from "../desktop-runtime.mjs";
import {
  assertRuntimeOutput,
  bundlePrivateRuntime,
  optimizeRuntimeJavaScript,
  privateRuntimeBundles,
  releaseFileAllowed,
} from "../runtime-release.mjs";
import runtimeTarget from "../check-runtime-target.cjs";

const facts = {
  version: "3.0.0-alpha.3",
  entry: "apps/desktop-host/src/index.js",
  safeOverlay: "apps/desktop-host/overlays/safe.yml",
};

test("generated output cannot erase source packages or the framework snapshot", () => {
  const desktop = join(tmpdir(), "desktop-output-guard");
  const framework = join(desktop, "build/dsh-framework");
  for (const output of [
    desktop,
    join(desktop, "apps"),
    join(desktop, "packages/output"),
    join(desktop, "build"),
    framework,
  ])
    assert.throws(() => assertRuntimeOutput(output, desktop, framework));
  assert.doesNotThrow(() =>
    assertRuntimeOutput(join(desktop, "build/runtime"), desktop, framework),
  );
});

async function closure() {
  const root = await mkdtemp(join(tmpdir(), "dramaip-desktop-runtime-"));
  await mkdir(join(root, "apps/desktop-host/src"), { recursive: true });
  await mkdir(join(root, "apps/desktop-host/overlays"), { recursive: true });
  await mkdir(join(root, "node_modules/.store/dep@1.0.0"), { recursive: true });
  await writeFile(join(root, facts.entry), "export {};\n");
  await writeFile(join(root, facts.safeOverlay), "plugins: {}\n");
  await writeFile(join(root, "node_modules/.store/dep@1.0.0/index.js"), "1");
  await symlink(".store/dep@1.0.0", join(root, "node_modules/dep"), "dir");
  await writeFile(join(root, ".watch-state.json"), "volatile");
  return root;
}

test("desktop-runtime.json 记录入口与整个闭包摘要，链接不跟随，本地构建状态不计入", async () => {
  const root = await closure();
  try {
    const manifest = await writeDesktopRuntimeManifest(root, facts);
    assert.equal(manifest.files, 3);
    assert.equal(manifest.links, 1);
    const verified = await verifyDesktopRuntime(root, facts.version);
    assert.deepEqual(verified.problems, []);
    await writeFile(join(root, ".watch-state.json"), "changed");
    assert.deepEqual(
      (await verifyDesktopRuntime(root, facts.version)).problems,
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("改动依赖字节、改链接目标、版本不符或缺入口都不通过校验", async () => {
  const root = await closure();
  try {
    await writeDesktopRuntimeManifest(root, facts);
    assert.deepEqual(
      (await verifyDesktopRuntime(root, "3.0.0-alpha.4")).problems,
      ["VERSION_MISMATCH"],
    );
    await writeFile(join(root, "node_modules/.store/dep@1.0.0/index.js"), "2");
    assert.deepEqual(
      (await verifyDesktopRuntime(root, facts.version)).problems,
      ["DIGEST_MISMATCH"],
    );
    await writeDesktopRuntimeManifest(root, facts);
    await rm(join(root, "node_modules/dep"));
    await symlink(".store", join(root, "node_modules/dep"), "dir");
    assert.deepEqual(
      (await verifyDesktopRuntime(root, facts.version)).problems,
      ["DIGEST_MISMATCH"],
    );
    await writeDesktopRuntimeManifest(root, facts);
    await rm(join(root, facts.entry));
    assert.deepEqual(
      (await verifyDesktopRuntime(root, facts.version)).problems,
      ["ENTRY_MISSING", "DIGEST_MISMATCH"],
    );
    await rm(join(root, "desktop-runtime.json"));
    assert.deepEqual(
      (await verifyDesktopRuntime(root, facts.version)).problems,
      ["MANIFEST_MISSING"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release filtering preserves runtime assets and licenses while excluding debug and test files", () => {
  const target = { name: "dependency", platform: "darwin", arch: "arm64" };
  for (const path of [
    "dist/index.js",
    "data/schema.json",
    "LICENSE.md",
    "NOTICE",
    "assets/font.woff2",
    "native/addon.node",
  ])
    assert.equal(releaseFileAllowed(path, target), true, path);
  for (const path of [
    "index.js.map",
    "index.d.ts",
    "index.d.cts",
    "debug.pdb",
    "test/fixture.json",
    "__tests__/api.js",
    "src/api.spec.ts",
    ".yarn/plugins/plugin-version.cjs",
    ".watch-state.json",
    ".last-good.json",
  ])
    assert.equal(releaseFileAllowed(path, target), false, path);
  assert.equal(releaseFileAllowed("profiles/test/cordis.yml"), true);
  assert.equal(
    releaseFileAllowed("src/v4/core/api.ts", { name: "zod" }),
    false,
  );
  assert.equal(releaseFileAllowed("v4/core/api.js", { name: "zod" }), true);
  assert.equal(releaseFileAllowed("lib/2020.ts", { name: "ajv" }), false);
  assert.equal(
    releaseFileAllowed("dist/refs/json-schema-2020-12/schema.json", {
      name: "ajv",
    }),
    true,
  );
});

test("release native pruning selects the requested platform and architecture", () => {
  for (const [platform, arch] of [
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["linux", "x64"],
    ["win32", "arm64"],
  ]) {
    const target = { name: "node-pty", platform, arch };
    assert.equal(
      releaseFileAllowed(`prebuilds/${platform}-${arch}/pty.node`, target),
      true,
    );
    assert.equal(
      releaseFileAllowed("prebuilds/win32-x64/conpty.pdb", target),
      false,
    );
    assert.equal(
      releaseFileAllowed("prebuilds/darwin-arm64/pty.node", target),
      platform === "darwin" && arch === "arm64",
    );
    assert.equal(
      releaseFileAllowed(
        "third_party/conpty/1/win10-arm64/OpenConsole.exe",
        target,
      ),
      platform === "win32" && arch === "arm64",
    );
  }
});

test("private bundles cannot absorb workspace/framework boundaries or undeclared packages", () => {
  const manifest = {
    name: "@dramaip/engine",
    dependencies: { sdk: "1.0.0", "@dramaip/contracts": "workspace:*" },
  };
  const declaration = (entry, dependencies) => ({
    ...manifest,
    dramaip: { release: { bundles: { [entry]: dependencies } } },
  });
  assert.deepEqual(
    privateRuntimeBundles(declaration("src/engine.ts", ["sdk"])),
    [{ entry: "src/engine.ts", dependencies: ["sdk"] }],
  );
  for (const [entry, dependencies] of [
    ["../escape.ts", ["sdk"]],
    ["src/../escape.ts", ["sdk"]],
    ["src/engine.ts", ["missing"]],
    ["src/engine.ts", ["@dramaip/contracts"]],
  ])
    assert.throws(() =>
      privateRuntimeBundles(declaration(entry, dependencies)),
    );
});

test("release optimization retains exported function/class names and module state", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-release-module-"));
  try {
    await mkdir(join(root, "packages/example"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    const file = join(root, "packages/example/index.js");
    await writeFile(
      file,
      "let counter = 0; export class ExampleService { next() { return ++counter; } } export function apply() { return new ExampleService(); }\n",
    );
    assert.equal(await optimizeRuntimeJavaScript(root), 1);
    const module = await import(pathToFileURL(file).href);
    assert.equal(module.apply.name, "apply");
    assert.equal(module.ExampleService.name, "ExampleService");
    assert.equal(module.apply().next(), 1);
    assert.equal(module.apply().next(), 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private SDK bundles keep required behavior and redistribute bundled licenses", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-release-bundle-"));
  try {
    const sdk = join(root, "node_modules/tiny-sdk");
    await mkdir(join(sdk, "nested"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      '{"name":"@dramaip/fixture","version":"1.0.0","type":"module"}',
    );
    await writeFile(
      join(sdk, "package.json"),
      '{"name":"tiny-sdk","version":"1.0.0","type":"module","exports":"./nested/index.js","license":"MIT"}',
    );
    await writeFile(
      join(sdk, "nested/index.js"),
      'export function increment(n) { return n + 1; } export const unused = "' +
        "x".repeat(100_000) +
        '";',
    );
    await writeFile(join(sdk, "LICENSE"), "MIT fixture license");
    await writeFile(join(sdk, "nested/package.json"), '{"type":"module"}');
    const source = join(root, "engine.ts"),
      target = join(root, "output/engine.mjs");
    await writeFile(
      source,
      'import { increment } from "tiny-sdk"; export function run(value: number) { return increment(value); }',
    );
    const dependencies = await bundlePrivateRuntime(source, target, root);
    assert.equal((await import(pathToFileURL(target).href)).run(41), 42);
    assert.ok((await readFile(target, "utf8")).length < 5000);
    assert.deepEqual(dependencies, [
      {
        name: "tiny-sdk",
        version: "1.0.0",
        license: "MIT",
        files: ["LICENSE"],
      },
    ]);
    assert.equal(
      await readFile(
        join(root, "third-party-notices/bundled/tiny-sdk@1.0.0/LICENSE"),
        "utf8",
      ),
      "MIT fixture license",
    );
    assert.ok(
      (await readdir(join(root, "third-party-notices/bundled"))).some((name) =>
        name.endsWith(".json"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaging rejects a development runtime or a mismatched native target", () => {
  assert.throws(() => runtimeTarget.checkTarget({}, "darwin", "arm64"));
  assert.throws(() =>
    runtimeTarget.checkTarget(
      { release: true, target: { platform: "darwin", arch: "arm64" } },
      "win32",
      "arm64",
    ),
  );
  assert.doesNotThrow(() =>
    runtimeTarget.checkTarget(
      { release: true, target: { platform: "darwin", arch: "arm64" } },
      "darwin",
      "arm64",
    ),
  );
});
