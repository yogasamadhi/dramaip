import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const listCopiedFiles = process.argv.includes("--files");
const requiredFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
for (const file of requiredFiles)
  assert.ok(
    existsSync(join(root, file)),
    `missing Desktop release file: ${file}`,
  );

const license = readFileSync(join(root, "LICENSE"), "utf8");
assert.match(license, /Apache License\s+Version 2\.0/u);
assert.match(readFileSync(join(root, "NOTICE"), "utf8"), /DramaIP Desktop/u);

/** Manifests one level under each directory. */
function manifestsUnder(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, directory, entry.name, "package.json"))
    .filter(existsSync);
}

// Packages copied from DeepSeek Harness keep its MIT license (see below);
// every other DramaIP-owned package is Apache-2.0. An infra package written
// for DramaIP records no `dramaip.copiedFrom`.
const selfWritten = (file) =>
  JSON.parse(readFileSync(file, "utf8")).dramaip?.copiedFrom === undefined;
const infraPackageFiles = manifestsUnder("packages/infra");
const copiedPackageFiles = [
  ...infraPackageFiles.filter((file) => !selfWritten(file)),
  join(root, "apps/cli/package.json"),
];

const packageFiles = [
  join(root, "package.json"),
  join(root, "apps/desktop/package.json"),
  join(root, "apps/web/package.json"),
  join(root, "apps/desktop-host/package.json"),
  ...infraPackageFiles.filter(selfWritten),
  ...manifestsUnder("packages/boot"),
  ...manifestsUnder("packages/compat"),
  ...manifestsUnder("packages/host"),
  ...manifestsUnder("packages/seams"),
  ...manifestsUnder("packages/system"),
  ...manifestsUnder("packages/insights"),
  ...manifestsUnder("packages/production"),
  ...manifestsUnder("packages/workspace"),
  ...manifestsUnder("packages/writing"),
  ...manifestsUnder("packages/agents"),
  ...manifestsUnder("packages/automation"),
  ...manifestsUnder("packages/testing"),
  ...["packages"].flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, directory, entry.name, "package.json"))
      .filter(existsSync),
  ),
];
for (const file of packageFiles) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    manifest.license,
    "Apache-2.0",
    `${file.slice(root.length + 1)} must declare SPDX Apache-2.0`,
  );
  if (file !== join(root, "package.json"))
    assert.equal(
      manifest.private,
      true,
      `${file.slice(root.length + 1)} must remain private`,
    );
}

const builder = readFileSync(
  join(root, "apps/desktop/electron-builder.yml"),
  "utf8",
);
for (const packagedNotice of [
  "build/third-party-notices",
  "vendor/pi/LICENSE",
  "pi-adapter/THIRD_PARTY_NOTICES.md",
])
  assert.ok(
    builder.includes(packagedNotice),
    `release package omits ${packagedNotice}`,
  );

const rootNotice = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const component of ["Pi 1.5.0"])
  assert.ok(rootNotice.includes(component), `notice omits ${component}`);

// DeepSeek Harness copies (MIT): provenance, license, notice, and a
// THIRD_PARTY_NOTICES entry per package; each copied file must map to a file
// in the pinned upstream snapshot or be named as a DramaIP addition.
const harnessLock = JSON.parse(
  readFileSync(join(root, "vendor/deepseek-harness.lock.json"), "utf8"),
);
const harnessRoot = join(root, "vendor/deepseek-harness");
// App-owned copies retain their original provenance when the live framework
// snapshot advances. Verify paths against the release each copy names.
const sourceTrees = new Map();
function sourceTree(version) {
  if (!sourceTrees.has(version)) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u);
    const paths = execFileSync(
      "git",
      ["ls-tree", "-r", "-z", "--name-only", `dsh-v${version}`],
      { cwd: harnessRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    sourceTrees.set(version, new Set(paths.split("\0")));
  }
  return sourceTrees.get(version);
}
const copiedRoots = ["src", "tests", "scripts", "locale"];
/** Files written for DramaIP inside a copied package, with no upstream counterpart. */
const dramaipAdditions = new Set([
  "packages/infra/ui-primitives/src/icons/navigation.tsx",
  "packages/infra/settings/tests/default-model.ts",
  "packages/infra/remotes/tests/selected-remotes.client.spec.ts",
  "packages/infra/ui-renderer/tests/session-scope.client.ts",
  // The Radix-based control components (baseline §6.7) and their stacking layers.
  "packages/infra/ui-primitives/src/ControlLabels.tsx",
  "packages/infra/ui-primitives/src/FormControls.tsx",
  "packages/infra/ui-primitives/src/FormControls.module.css",
  "packages/infra/ui-primitives/src/Tabs.tsx",
  "packages/infra/ui-primitives/src/Tabs.module.css",
  "packages/infra/ui-primitives/src/Surfaces.tsx",
  "packages/infra/ui-primitives/src/Surfaces.module.css",
  "packages/infra/ui-primitives/src/Dialog.tsx",
  "packages/infra/ui-primitives/src/Dialog.module.css",
  "packages/infra/ui-primitives/src/DropdownMenu.tsx",
  "packages/infra/ui-primitives/src/DropdownMenu.module.css",
  "packages/infra/ui-primitives/src/ScrollArea.tsx",
  "packages/infra/ui-primitives/src/ScrollArea.module.css",
  "packages/infra/ui-primitives/src/Feedback.tsx",
  "packages/infra/ui-primitives/src/Feedback.module.css",
  "packages/infra/ui-primitives/src/Confirm.tsx",
  "packages/infra/ui-primitives/src/Confirm.module.css",
  "packages/infra/ui-primitives/src/ToastQueue.tsx",
  "packages/infra/ui-primitives/src/ToastQueue.module.css",
  "packages/infra/ui-primitives/tests/controls.client.spec.tsx",
  "packages/infra/ui-theme/src/styles/layers.css",
  "packages/infra/ui-theme/src/styles/nexta-tokens.css",
  "apps/cli/tests/baseline-readback.spec.ts",
  "apps/cli/tests/business-plugins-acceptance.spec.ts",
  "apps/cli/tests/desktop-migration.spec.ts",
  "apps/cli/tests/studio-browser-smoke.spec.ts",
  "apps/cli/tests/profile-acceptance.spec.ts",
  "apps/cli/tests/sample-plugin-acceptance.spec.ts",
  "apps/cli/tests/web-harness.ts",
]);
/** Copied files that live at another path than upstream: copy -> upstream path in the snapshot. */
const relocatedCopies = new Map([
  // Test copy of the tool JSON Schema subset the generator's metadata checks use.
  [
    "packages/infra/typert-generator/tests/json-schema.ts",
    "packages/core/tools/src/json-schema.ts",
  ],
]);
/** DramaIP-owned directories inside a copied package (generated snapshots). */
const dramaipDirectories = ["apps/cli/tests/snapshots"];

function* filesUnder(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path);
    else yield path;
  }
}

let copiedFileCount = 0;
let addedFileCount = 0;
for (const file of copiedPackageFiles) {
  const label = relative(root, file);
  const packageRoot = join(file, "..");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(
    manifest.license,
    "MIT",
    `${label} copies MIT sources and must declare MIT`,
  );
  assert.equal(manifest.private, true, `${label} must remain private`);
  const origin = manifest.dramaip?.copiedFrom;
  assert.ok(origin, `${label} must record dramaip.copiedFrom`);
  assert.equal(
    origin.repository,
    "vendor/deepseek-harness",
    `${label} copiedFrom.repository`,
  );
  const upstreamFiles = sourceTree(origin.version);
  assert.match(
    origin.package,
    /^@deepseek-ai\//u,
    `${label} copiedFrom.package`,
  );
  const upstream = join(harnessRoot, origin.path);
  assert.ok(
    upstreamFiles.has(`${origin.path}/package.json`),
    `${label} copiedFrom.path ${origin.path} is missing upstream`,
  );
  assert.match(
    readFileSync(join(packageRoot, "LICENSE"), "utf8"),
    /^MIT License\s+Copyright \(c\) \d{4} DeepSeek/u,
    `${label} must keep the DeepSeek MIT LICENSE`,
  );
  const notice = readFileSync(join(packageRoot, "NOTICE"), "utf8");
  assert.ok(
    notice.includes(origin.package),
    `${label} NOTICE must name ${origin.package}`,
  );
  assert.ok(
    notice.includes(origin.version),
    `${label} NOTICE must name ${origin.version}`,
  );
  for (const directory of copiedRoots) {
    for (const copied of filesUnder(join(packageRoot, directory))) {
      const path = relative(root, copied);
      if (
        dramaipAdditions.has(path) ||
        dramaipDirectories.some((directory) => path.startsWith(`${directory}/`))
      ) {
        addedFileCount += 1;
        if (listCopiedFiles) console.log(`${path} <- DramaIP addition`);
        continue;
      }
      const source = relocatedCopies.has(path)
        ? join(harnessRoot, relocatedCopies.get(path))
        : join(upstream, relative(packageRoot, copied));
      assert.ok(
        upstreamFiles.has(relative(harnessRoot, source)),
        `${path} has no upstream file at ${relative(harnessRoot, source)}; restore it or list it as a DramaIP addition`,
      );
      copiedFileCount += 1;
      if (listCopiedFiles)
        console.log(
          `${path} <- deepseek-harness@${origin.version}:${relative(harnessRoot, source)}`,
        );
    }
  }
}

const copiedNotice = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const file of copiedPackageFiles) {
  const name = JSON.parse(readFileSync(file, "utf8")).name;
  assert.ok(
    copiedNotice.includes(`\`${name}\``),
    `THIRD_PARTY_NOTICES.md omits ${name}`,
  );
}
assert.match(
  readFileSync(join(root, "scripts/vitest/standard-decorators.ts"), "utf8"),
  /Copied from DeepSeek Harness/u,
  "scripts/vitest/standard-decorators.ts must name its DeepSeek Harness source",
);

console.log(
  `Desktop Apache-2.0 metadata verified for ${packageFiles.length} manifests.`,
);
console.log(
  `DeepSeek Harness copies (${[...sourceTrees.keys()].join(", ")}) verified against their source releases; framework ${harnessLock.version}: ${copiedPackageFiles.length} MIT packages, ` +
    `${copiedFileCount} copied files, ${addedFileCount} DramaIP additions` +
    (listCopiedFiles
      ? "."
      : " (pass --files to list each file and its source)."),
);
