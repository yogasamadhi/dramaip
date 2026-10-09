import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashReleaseFile,
  readReleaseArtifacts,
} from "./check-release-candidate.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
class MetadataError extends Error {}
const fact = (ok, code) => {
  if (!ok) throw new MetadataError(code);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Generate only to a new directory after all input gates; never release approval. */
export async function generateReleaseMetadata({
  root = ROOT,
  dist = resolve(
    root,
    process.env.DRAMAIP_RELEASE_ARTIFACT_DIR ?? "apps/desktop/dist",
  ),
  output = resolve(
    root,
    process.env.DRAMAIP_RELEASE_METADATA_DIR ??
      "apps/desktop/dist/release-metadata",
  ),
} = {}) {
  root = resolve(root);
  dist = resolve(dist);
  output = resolve(output);
  fact(
    output !== root &&
      output !== dist &&
      relative(output, dist).startsWith("..") &&
      relative(output, root).startsWith(".."),
    "OUTPUT_SCOPE_INVALID",
  );
  fact(!(await exists(output)), "OUTPUT_ALREADY_EXISTS");
  const inventory = await readReleaseArtifacts(root, dist);
  fact(!inventory.blockers.length, "UPDATE_METADATA_NOT_REGULAR");
  fact(inventory.currentUpdates.length > 0, "CURRENT_UPDATE_METADATA_MISSING");
  const { app, config, names, currentUpdates } = inventory;
  const files = inventory.artifacts.map((file) => ({
    ...file,
    kind: "installer",
  }));
  const selected = new Set(files.map((file) => file.file));
  const prefix = `${config.productName}-${app.version}-`;
  // Windows ZIP and Linux DEB may not be referenced by updater descriptors.
  // They still belong in this version's inventory; never recursively walk dist.
  for (const entry of names) {
    if (
      !entry.name.startsWith(prefix) ||
      !/\.(?:dmg|zip|exe|AppImage|deb)$/u.test(entry.name)
    )
      continue;
    fact(
      entry.isFile() &&
        !entry.isSymbolicLink() &&
        !/[\r\n/\\]/u.test(entry.name),
      "CURRENT_ARTIFACT_NOT_REGULAR",
    );
    if (!selected.has(entry.name)) {
      files.push({
        file: entry.name,
        ...(await hashReleaseFile(join(dist, entry.name))),
        kind: "installer",
      });
      selected.add(entry.name);
    }
  }
  fact(
    files.length > 0 && files.every((file) => file.size > 0),
    "CURRENT_ARTIFACTS_MISSING_OR_EMPTY",
  );
  for (const file of files.filter((entry) => entry.kind === "installer")) {
    const name = `${file.file}.blockmap`;
    const entry = names.find((item) => item.name === name);
    if (!entry) continue;
    fact(entry.isFile() && !entry.isSymbolicLink(), "BLOCKMAP_NOT_REGULAR");
    files.push({
      file: name,
      ...(await hashReleaseFile(join(dist, name))),
      kind: "blockmap",
    });
  }
  for (const update of currentUpdates) {
    const bytes = await hashReleaseFile(join(dist, update.file));
    fact(bytes.sha256 === update.sha256, "UPDATE_METADATA_CHANGED");
    files.push({ file: update.file, ...bytes, kind: "update-metadata" });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  const components = await collectComponents(root);
  fact(components.length >= 20, "SBOM_COMPONENTS_INCOMPLETE");
  const timestamp = new Date().toISOString();
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      component: { type: "application", name: app.name, version: app.version },
    },
    components,
  };
  const licenses = {
    generated_at: timestamp,
    notice:
      "本清单只定位本Desktop已安装依赖的许可；不证明打包依赖完整或法律许可。发布包仍须携带各组件要求的完整许可文本。",
    components: components.map(({ name, version, licenses }) => ({
      name,
      version,
      licenses,
    })),
  };
  const documents = new Map([
    [
      "SHA256SUMS",
      `${files.map((file) => `${file.sha256}  ${file.file}`).join("\n")}\n`,
    ],
    ["sbom.cdx.json", `${JSON.stringify(sbom, null, 2)}\n`],
    ["THIRD_PARTY_LICENSES.json", `${JSON.stringify(licenses, null, 2)}\n`],
  ]);
  const manifest = {
    schemaVersion: 1,
    appVersion: app.version,
    generatedAt: timestamp,
    scope:
      "current-version-top-level-installers-update-metadata-and-present-blockmaps",
    dependencyInventoryScope:
      "installed-desktop-bun-dependencies-not-packaged-byte-proof",
    files,
    historicalUpdateFiles: inventory.historicalUpdateFiles,
    documents: [...documents].map(([file, bytes]) => ({
      file,
      sha256: sha256(bytes),
    })),
    releaseReady: false,
    boundary:
      "Current names and updater hashes do not establish source/build provenance, archive-to-bundle identity, dependency completeness, signing/notarization, device installation/upgrade/recovery or approval. Generate only after a separately verified package. Old artifacts and unpacked/debug directories are not selected or modified.",
  };
  // This receipt is linked last; partial output is never a completed inventory.
  documents.set(
    "release-inventory.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(
    join(dirname(output), ".dramaip-release-metadata-"),
  );
  let created = false;
  const linked = [];
  try {
    for (const [name, bytes] of documents)
      await writeFile(join(stage, name), bytes, { flag: "wx" });
    for (const file of files) {
      const current = await hashReleaseFile(join(dist, file.file));
      fact(
        current.size === file.size &&
          current.sha256 === file.sha256 &&
          current.sha512 === file.sha512,
        "INPUT_CHANGED_BEFORE_OUTPUT",
      );
    }
    // Exclusive mkdir + no-overwrite hard links preserve any existing output.
    await mkdir(output);
    created = true;
    for (const name of documents.keys()) {
      await link(join(stage, name), join(output, name));
      linked.push(name);
    }
    return { artifacts: files.length, components: components.length, manifest };
  } catch (error) {
    if (created) {
      for (const name of linked) {
        const [source, target] = await Promise.all([
          lstat(join(stage, name)),
          lstat(join(output, name)).catch(() => null),
        ]);
        if (target?.dev === source.dev && target?.ino === source.ino)
          await unlink(join(output, name));
      }
      await rmdir(output).catch(() => {}); // Never recursively remove an output.
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function collectComponents(root) {
  const components = [];
  const packageRoot = join(root, "node_modules/.bun");
  for (const directory of await safeReadDir(packageRoot)) {
    const packageJSON = await findPackageJSON(join(packageRoot, directory));
    if (!packageJSON) continue;
    let pkg;
    try {
      pkg = JSON.parse(await readFile(packageJSON, "utf8"));
    } catch {
      throw new MetadataError("DEPENDENCY_MANIFEST_INVALID");
    }
    fact(
      typeof pkg.name === "string" &&
        pkg.name.length > 0 &&
        typeof pkg.version === "string" &&
        pkg.version.length > 0,
      "DEPENDENCY_MANIFEST_INVALID",
    );
    components.push({
      type: "library",
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${encodeURIComponent(pkg.name)}@${pkg.version}`,
      licenses: normalizeLicenses(pkg.license ?? pkg.licenses),
    });
  }
  components.sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
  return [
    ...new Map(
      components.map((component) => [
        `${component.name}@${component.version}`,
        component,
      ]),
    ).values(),
  ];
}
async function safeReadDir(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}
async function findPackageJSON(path) {
  for (const dependency of await safeReadDir(join(path, "node_modules"))) {
    const candidates = dependency.startsWith("@")
      ? (await safeReadDir(join(path, "node_modules", dependency))).map(
          (name) =>
            join(path, "node_modules", dependency, name, "package.json"),
        )
      : [join(path, "node_modules", dependency, "package.json")];
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      }
    }
  }
}
function normalizeLicenses(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((license) => ({
    license: {
      id:
        typeof license === "string"
          ? license
          : String(license?.type ?? "UNKNOWN"),
    },
  }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help")
    process.stdout.write(
      "Generate current-version metadata after package into a NEW directory. Set DRAMAIP_RELEASE_ARTIFACT_DIR / DRAMAIP_RELEASE_METADATA_DIR as needed. Never release approval.\n",
    );
  else if (args.length) {
    process.stderr.write("Release metadata rejected: INVALID_ARGUMENTS\n");
    process.exitCode = 1;
  } else
    generateReleaseMetadata()
      .then((result) =>
        process.stdout.write(
          `release metadata: ${result.artifacts} selected files, ${result.components} installed dependency components; releaseReady=false\n`,
        ),
      )
      .catch((error) => {
        // Do not print input paths, dependency content or parser messages.
        process.stderr.write(
          `Release metadata rejected: ${error instanceof MetadataError ? error.message : "LOCAL_INPUT_INVALID_OR_UNAVAILABLE"}\n`,
        );
        process.exitCode = 1;
      });
}
