import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
for (const file of requiredFiles)
  assert.ok(existsSync(join(root, file)), `missing Desktop release file: ${file}`);

const license = readFileSync(join(root, "LICENSE"), "utf8");
assert.match(license, /Apache License\s+Version 2\.0/u);
assert.match(
  readFileSync(join(root, "NOTICE"), "utf8"),
  /DramaIP Desktop/u,
);

const packageFiles = [
  join(root, "package.json"),
  join(root, "apps/desktop/package.json"),
  ...["packages", "plugins"].flatMap((directory) =>
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
for (const component of ["Pi 0.84.2", "Codex CLI 0.147.0", "LangGraph.js 1.4.9"])
  assert.ok(rootNotice.includes(component), `notice omits ${component}`);

console.log(`Desktop Apache-2.0 metadata verified for ${packageFiles.length} manifests.`);
