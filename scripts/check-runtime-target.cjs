// Native pruning is target-specific. Refuse a stale development closure or a
// different architecture instead of silently packaging the wrong native files.
const { readFile } = require("node:fs/promises");
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");

function checkTarget(manifest, platform, arch) {
  if (!manifest.release)
    throw new Error("Packaging requires pnpm run build:release");
  if (manifest.target?.platform !== platform || manifest.target?.arch !== arch)
    throw new Error(
      `Runtime target ${manifest.target?.platform}/${manifest.target?.arch} does not match package ${platform}/${arch}; build on the target platform and architecture`,
    );
}

module.exports = async function checkRuntimeTarget(context) {
  const app = createRequire(join(__dirname, "../apps/desktop/package.json"));
  const builder = createRequire(app.resolve("electron-builder"));
  const { Arch } = builder("builder-util");
  const root = resolve(
    __dirname,
    "..",
    process.env.DRAMAIP_RUNTIME_BUILD ?? "build/runtime",
  );
  checkTarget(
    JSON.parse(await readFile(join(root, "desktop-runtime.json"), "utf8")),
    context.electronPlatformName,
    Arch[context.arch],
  );
};
module.exports.checkTarget = checkTarget;
