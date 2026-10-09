import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
class CandidateError extends Error {}
const fact = (ok, code) => {
  if (!ok) throw new CandidateError(code);
};
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
function tooling(root) {
  const app = createRequire(join(root, "apps/desktop/package.json"));
  const builder = createRequire(app.resolve("electron-builder"));
  const yaml = builder("js-yaml");
  return {
    yaml: (bytes) => yaml.load(bytes, { schema: yaml.JSON_SCHEMA }),
    asar: () => builder("@electron/asar"),
  };
}
/** Open the selected file, never recursively follow dist directories or links. */
async function hashes(path) {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    fact(before.isFile(), "ARTIFACT_NOT_REGULAR");
    const sha256 = createHash("sha256"),
      sha512 = createHash("sha512");
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      sha256.update(buffer.subarray(0, bytesRead));
      sha512.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    fact(
      size === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "ARTIFACT_CHANGED_DURING_READ",
    );
    return {
      size,
      sha256: sha256.digest("hex"),
      sha512: sha512.digest("base64"),
    };
  } finally {
    await handle.close();
  }
}
export { hashes as hashReleaseFile };
async function ownFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".watch-state.json" ||
      entry.name.startsWith(".last-good.json")
    )
      continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    fact(!entry.isSymbolicLink(), "BUILD_TREE_SYMLINK");
    if (entry.isDirectory()) result.push(...(await ownFiles(root, path)));
    else if (entry.isFile()) result.push(path);
    else throw new CandidateError("BUILD_TREE_NOT_REGULAR");
    fact(result.length <= 8192, "BUILD_TREE_TOO_LARGE");
  }
  return result.sort();
}
async function compareTree(current, readPackaged) {
  const paths = await ownFiles(current),
    differences = [],
    entries = [];
  fact(paths.length > 0, "CURRENT_BUILD_MISSING");
  for (const path of paths) {
    const expected = digest(await readFile(join(current, path)));
    let actual = null;
    try {
      actual = digest(await readPackaged(path));
    } catch {
      /* Missing original files are mismatches, never current-build success. */
    }
    entries.push({ path, expected, actual });
    if (expected !== actual) differences.push(path);
  }
  return {
    scope: "listed-local-build-owned-files-only",
    files: paths.length,
    mismatchCount: differences.length,
    firstDifferences: differences.slice(0, 8),
    comparisonDigest: digest(JSON.stringify(entries)),
    matches: differences.length === 0,
  };
}
function macSignature(app) {
  const verified = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", app],
    { encoding: "utf8", timeout: 20_000 },
  );
  const detail = spawnSync("codesign", ["-dv", "--verbose=4", app], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const text = detail.stderr ?? "";
  return {
    integrity: verified.status === 0 ? "verified" : "unverified",
    identity: /Signature=adhoc/u.test(text)
      ? "ad-hoc"
      : /Authority=Developer ID Application:/u.test(text) &&
          /TeamIdentifier=[A-Z0-9]+\s/u.test(text)
        ? "developer-id-present"
        : "unverified",
    notarization: "not-checked",
  };
}

/** Shared read-only update descriptors and byte inventory, not release approval. */
export async function readReleaseArtifacts(
  root = ROOT,
  dist = join(root, "apps/desktop/dist"),
  adapters = {},
) {
  // Load inspection code only from this tool's own workspace, never a supplied
  // artifact/data directory or an untrusted candidate dependency tree.
  const tools = tooling(ROOT),
    yaml = adapters.yaml ?? tools.yaml;
  const app = await json(join(root, "apps/desktop/package.json"));
  const config = yaml(
    await readFile(join(root, "apps/desktop/electron-builder.yml"), "utf8"),
  );
  fact(
    typeof app.version === "string" &&
      /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(app.version),
    "APP_VERSION_INVALID",
  );
  fact(
    typeof config?.productName === "string" &&
      config.productName.length > 0 &&
      !/[\r\n/\\]/u.test(config.productName),
    "PRODUCT_NAME_INVALID",
  );
  const names = await readdir(dist, { withFileTypes: true });
  fact(names.length <= 2048, "ARTIFACT_DIRECTORY_TOO_LARGE");
  const currentUpdates = [],
    artifacts = [],
    blockers = [],
    history = [];
  const seen = new Map();
  const prefix = `${config.productName}-${app.version}-`;
  const channels = new Set([
    "latest",
    "alpha",
    "beta",
    "rc",
    app.version.split("-")[1]?.split(".")[0],
  ]);
  for (const entry of names.filter(
    (n) =>
      /^(?:latest|[a-zA-Z0-9]+)(?:-[a-zA-Z0-9]+)*\.yml$/u.test(n.name) &&
      channels.has(n.name.split(/[.-]/u)[0]),
  )) {
    if (!entry.isFile()) {
      blockers.push("UPDATE_METADATA_NOT_REGULAR");
      continue;
    }
    const metadataPath = join(dist, entry.name),
      metadataSize = await lstat(metadataPath);
    fact(metadataSize.size <= 1_048_576, "UPDATE_METADATA_TOO_LARGE");
    const metadataBytes = await readFile(metadataPath);
    const metadata = yaml(metadataBytes.toString("utf8"));
    if (metadata?.version !== app.version) {
      history.push(entry.name);
      continue;
    }
    const metadataDigest = digest(metadataBytes);
    fact(
      Array.isArray(metadata.files) &&
        metadata.files.length > 0 &&
        metadata.files.length <= 32,
      "UPDATE_FILES_INVALID",
    );
    const referenced = [];
    for (const item of metadata.files) {
      fact(
        typeof item.url === "string" &&
          item.url === basename(item.url) &&
          !/[\r\n/\\]/u.test(item.url) &&
          item.url.startsWith(prefix) &&
          /\.(?:dmg|zip|exe|AppImage|deb)$/u.test(item.url),
        "UPDATE_ARTIFACT_NAME_INVALID",
      );
      fact(
        typeof item.sha512 === "string" &&
          /^[A-Za-z0-9+/]{86}==$/u.test(item.sha512) &&
          Number.isSafeInteger(item.size) &&
          item.size >= 0,
        "UPDATE_ARTIFACT_DESCRIPTOR_INVALID",
      );
      const descriptor = { sha512: item.sha512, size: item.size };
      fact(
        !seen.has(item.url) ||
          JSON.stringify(seen.get(item.url)) === JSON.stringify(descriptor),
        "UPDATE_DESCRIPTOR_CONFLICT",
      );
      if (!seen.has(item.url)) {
        const file = names.find((n) => n.name === item.url);
        fact(
          file?.isFile() && !file.isSymbolicLink(),
          "UPDATE_ARTIFACT_MISSING_OR_LINK",
        );
        const bytes = await hashes(join(dist, item.url));
        fact(
          bytes.size === item.size && bytes.sha512 === item.sha512,
          "UPDATE_ARTIFACT_BYTES_CHANGED",
        );
        artifacts.push({ file: item.url, ...bytes });
        seen.set(item.url, descriptor);
      }
      referenced.push(item.url);
    }
    if (metadata.path !== undefined || metadata.sha512 !== undefined)
      fact(
        typeof metadata.path === "string" &&
          metadata.files.some(
            (f) => f.url === metadata.path && f.sha512 === metadata.sha512,
          ),
        "UPDATE_LEGACY_DESCRIPTOR_CONFLICT",
      );
    currentUpdates.push({
      file: entry.name,
      sha256: metadataDigest,
      artifacts: referenced,
    });
  }
  return {
    app,
    config,
    names,
    currentUpdates,
    artifacts,
    historicalUpdateFiles: history.sort(),
    blockers,
  };
}

/** Read-only inventory, not a release authorization or an installer/device execution. */
export async function inspectReleaseCandidate(
  root = ROOT,
  dist = join(root, "apps/desktop/dist"),
  adapters = {},
) {
  const {
    app,
    config,
    names,
    currentUpdates,
    artifacts,
    historicalUpdateFiles,
    blockers,
  } = await readReleaseArtifacts(root, dist, adapters);
  const tools = tooling(ROOT);
  if (!currentUpdates.length) blockers.push("CURRENT_UPDATE_METADATA_MISSING");
  const macBundles = [];
  for (const entry of names.filter(
    (n) => /^mac(?:-[a-zA-Z0-9]+)?$/u.test(n.name) && n.isDirectory(),
  )) {
    const directory = join(dist, entry.name);
    for (const bundle of await readdir(directory, { withFileTypes: true })) {
      if (
        bundle.name !== `${config.productName}.app` ||
        !bundle.isDirectory() ||
        bundle.isSymbolicLink()
      )
        continue;
      const bundlePath = join(directory, bundle.name),
        resources = join(bundlePath, "Contents/Resources");
      const runtime = await compareTree(join(root, "build/runtime"), (path) =>
        readFile(join(resources, "runtime", path)),
      );
      const asar = adapters.asar ?? tools.asar();
      const rendererAndMain = await compareTree(
        join(root, "apps/desktop/out"),
        (path) => asar.extractFile(join(resources, "app.asar"), `out/${path}`),
      );
      const signature = await (adapters.signature ?? macSignature)(bundlePath);
      if (!runtime.matches || !rendererAndMain.matches)
        blockers.push("PACKAGED_BUILD_DIFFERS_FROM_LOCAL_BUILD");
      if (
        signature.integrity !== "verified" ||
        signature.identity !== "developer-id-present"
      )
        blockers.push("MACOS_DISTRIBUTION_SIGNATURE_UNVERIFIED");
      blockers.push("MACOS_NOTARIZATION_NOT_VERIFIED");
      macBundles.push({
        scope: entry.name,
        runtime,
        rendererAndMain,
        signature,
      });
    }
  }
  if (!macBundles.length) blockers.push("MACOS_BUNDLE_NOT_INSPECTED");
  const git = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  const cleanWorktree =
    git.status === 0 ? git.stdout.trim().length === 0 : null;
  if (cleanWorktree !== true) blockers.push("SOURCE_WORKTREE_NOT_CLEAN");
  return {
    schemaVersion: 1,
    scope: "read-only-local-packaging-inventory",
    appVersion: app.version,
    cleanWorktree,
    currentUpdates,
    artifacts,
    historicalUpdateFiles,
    macBundles,
    targetDevices: ["macos", "windows", "linux"].map((platform) => ({
      platform,
      install: "not-run",
      upgrade: "not-run",
      recovery: "not-run",
    })),
    blockers: [...new Set(blockers)],
    releaseReady: false,
    boundary:
      "Current update metadata hashes bind selected installer bytes only. Adjacent unpacked mac bundles are inspected separately; no archive-to-bundle identity is established. Local-build comparisons exclude Runtime node_modules, watcher state and recovery copies and do not prove current source/build provenance. Ad-hoc integrity is not a distribution identity or notarization. No installer, updater, application, network, signing, deployment or release approval is executed. Real-model/user evidence and three target-device gates remain independent.",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help")
    process.stdout.write(
      "Read-only local candidate inspection. Usage: bun scripts/run-node.mjs scripts/check-release-candidate.mjs [--artifacts <directory>]. Prints inventory only, never release approval.\n",
    );
  else if (!(
    args.length === 0 ||
    (args.length === 2 && args[0] === "--artifacts")
  )) {
    process.stderr.write("Candidate inspection rejected: INVALID_ARGUMENTS\n");
    process.exitCode = 1;
  } else
    inspectReleaseCandidate(ROOT, args.length ? resolve(args[1]) : undefined)
      .then((result) =>
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
      )
      .catch((error) => {
        process.stderr.write(
          `Candidate inspection rejected: ${error instanceof CandidateError ? error.message : "LOCAL_INPUT_UNAVAILABLE"}\n`,
        );
        process.exitCode = 1;
      });
}
