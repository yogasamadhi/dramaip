import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectReleaseCandidate } from "../check-release-candidate.mjs";

const sha512 = (bytes) => createHash("sha512").update(bytes).digest("base64");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dramaip-release-inspect-"));
  const dist = join(root, "apps/desktop/dist");
  const resources = join(dist, "mac-arm64/TestProduct.app/Contents/Resources");
  const files = new Map([
    ["out/main/index.js", Buffer.from("private-source-body-canary")],
    ["out/renderer/index.html", Buffer.from("fixture-renderer")],
  ]);
  const source = "fixture-runtime";
  const artifact = Buffer.from("local fixture, not a runnable installer");
  const filename = "TestProduct-3.0.0-alpha.3-arm64-mac.zip";
  for (const path of [
    dist,
    resources,
    join(root, "build/runtime/plugins/review"),
    join(resources, "runtime/plugins/review"),
    join(root, "apps/desktop/out/main"),
    join(root, "apps/desktop/out/renderer"),
  ])
    await mkdir(path, { recursive: true });
  await writeFile(
    join(root, "apps/desktop/package.json"),
    JSON.stringify({ version: "3.0.0-alpha.3" }),
  );
  await writeFile(
    join(root, "apps/desktop/electron-builder.yml"),
    JSON.stringify({ productName: "TestProduct" }),
  );
  await writeFile(join(root, "build/runtime/core-runtime.js"), source);
  await writeFile(join(resources, "runtime/core-runtime.js"), source);
  await writeFile(
    join(root, "build/runtime/plugins/review/index.js"),
    "review-source",
  );
  await writeFile(
    join(resources, "runtime/plugins/review/index.js"),
    "review-source",
  );
  await writeFile(
    join(root, "build/runtime/.watch-state.json"),
    "volatile-state",
  );
  await writeFile(
    join(root, "build/runtime/.last-good.json"),
    "private-recovery-copy",
  );
  for (const [path, bytes] of files)
    await writeFile(join(root, "apps/desktop", path), bytes);
  await writeFile(join(dist, filename), artifact);
  const metadata = {
    version: "3.0.0-alpha.3",
    files: [{ url: filename, sha512: sha512(artifact), size: artifact.length }],
    path: filename,
    sha512: sha512(artifact),
  };
  await writeFile(join(dist, "alpha-mac.yml"), JSON.stringify(metadata));
  await writeFile(
    join(dist, "latest-mac.yml"),
    JSON.stringify({ version: "1.0.0", files: [{ url: "old-package.zip" }] }),
  );
  await writeFile(
    join(dist, "builder-debug.yml"),
    "not valid YAML; this is not an update file!",
  );
  const adapters = {
    yaml: JSON.parse,
    asar: {
      extractFile: (_, path) => {
        assert(files.has(path));
        return files.get(path);
      },
    },
    signature: () => ({
      integrity: "verified",
      identity: "ad-hoc",
      notarization: "not-checked",
    }),
  };
  return {
    root,
    dist,
    resources,
    files,
    metadata,
    filename,
    artifact,
    adapters,
    inspect: () => inspectReleaseCandidate(root, dist, adapters),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("只读候选检查核当前原更新描述符／完整字节，旧版本与debug文件不计当前产物", async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.dist, f.filename));
    const r = await f.inspect();
    assert.equal(r.currentUpdates.length, 1);
    assert.equal(r.artifacts.length, 1);
    assert.equal(r.artifacts[0].sha512, sha512(f.artifact));
    assert.deepEqual(r.historicalUpdateFiles, ["latest-mac.yml"]);
    assert.equal(r.macBundles[0].runtime.files, 2);
    assert.equal(r.macBundles[0].runtime.matches, true);
    assert.equal(r.macBundles[0].rendererAndMain.matches, true);
    assert.equal(r.releaseReady, false);
    assert(r.blockers.includes("MACOS_DISTRIBUTION_SIGNATURE_UNVERIFIED"));
    assert(r.blockers.includes("MACOS_NOTARIZATION_NOT_VERIFIED"));
    assert(
      r.targetDevices.every(
        (p) =>
          p.install === "not-run" &&
          p.upgrade === "not-run" &&
          p.recovery === "not-run",
      ),
    );
    assert(!JSON.stringify(r).includes("private-source-body-canary"));
    assert(!JSON.stringify(r).includes(f.root));
    assert.deepEqual(await readFile(join(f.dist, f.filename)), before);
  } finally {
    await f.close();
  }
});

test("同版本旧包仍按实际Runtime／Renderer与Main字节拒绝，不由版本号冒称当前构建", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.resources, "runtime/plugins/review/index.js"),
      "old-review-source",
    );
    f.files.set("out/renderer/index.html", Buffer.from("old-renderer"));
    const r = await f.inspect();
    assert.equal(r.macBundles[0].runtime.mismatchCount, 1);
    assert.equal(r.macBundles[0].rendererAndMain.mismatchCount, 1);
    assert(r.blockers.includes("PACKAGED_BUILD_DIFFERS_FROM_LOCAL_BUILD"));
    assert.equal(r.releaseReady, false);
  } finally {
    await f.close();
  }
});

test("正确版本／文件名与元数据也不能放行篡改安装包，大小与SHA512分别核对", async () => {
  for (const mutate of [
    (f) =>
      writeFile(join(f.dist, f.filename), Buffer.alloc(f.artifact.length, 42)),
    (f) => writeFile(join(f.dist, f.filename), "shorter"),
  ]) {
    const f = await fixture();
    try {
      await mutate(f);
      await assert.rejects(f.inspect(), /UPDATE_ARTIFACT_BYTES_CHANGED/);
    } finally {
      await f.close();
    }
  }
});

test("候选路径穿越、绝对路径、符号链接与换产品名拒绝，不递归读整个历史dist", async () => {
  for (const url of [
    "../private.zip",
    "/private.zip",
    "private\\file.zip",
    "OtherProduct-3.0.0-alpha.3-arm64.zip",
    "TestProduct-3.0.0-alpha.3-arm64.zip\nsecret",
  ]) {
    const f = await fixture();
    try {
      f.metadata.files[0].url = url;
      await writeFile(
        join(f.dist, "alpha-mac.yml"),
        JSON.stringify(f.metadata),
      );
      await assert.rejects(f.inspect(), /UPDATE_ARTIFACT_NAME_INVALID/);
    } finally {
      await f.close();
    }
  }
  const f = await fixture();
  try {
    const alias = "TestProduct-3.0.0-alpha.3-arm64-alias.zip";
    await symlink(join(f.dist, f.filename), join(f.dist, alias));
    f.metadata.files[0].url = alias;
    delete f.metadata.path;
    delete f.metadata.sha512;
    await writeFile(join(f.dist, "alpha-mac.yml"), JSON.stringify(f.metadata));
    await assert.rejects(f.inspect(), /UPDATE_ARTIFACT_MISSING_OR_LINK/);
  } finally {
    await f.close();
  }
});

test("多个更新描述符必须绑定同一原文件值，legacy path不能与files分歧", async () => {
  const f = await fixture();
  try {
    const other = structuredClone(f.metadata);
    other.files[0].size++;
    await writeFile(join(f.dist, "alpha-mac-arm64.yml"), JSON.stringify(other));
    await assert.rejects(
      f.inspect(),
      /UPDATE_ARTIFACT_BYTES_CHANGED|UPDATE_DESCRIPTOR_CONFLICT/,
    );
    await rm(join(f.dist, "alpha-mac-arm64.yml"));
    f.metadata.path = "old-package.zip";
    await writeFile(join(f.dist, "alpha-mac.yml"), JSON.stringify(f.metadata));
    await assert.rejects(f.inspect(), /UPDATE_LEGACY_DESCRIPTOR_CONFLICT/);
  } finally {
    await f.close();
  }
});

test("无当前更新文件保持缺失，Developer ID字段也不能补公证或设备验收", async () => {
  const f = await fixture();
  try {
    await rm(join(f.dist, "alpha-mac.yml"));
    f.adapters.signature = () => ({
      integrity: "verified",
      identity: "developer-id-present",
      notarization: "not-checked",
    });
    const r = await f.inspect();
    assert.equal(r.artifacts.length, 0);
    assert(r.blockers.includes("CURRENT_UPDATE_METADATA_MISSING"));
    assert(r.blockers.includes("MACOS_NOTARIZATION_NOT_VERIFIED"));
    assert(!r.blockers.includes("MACOS_DISTRIBUTION_SIGNATURE_UNVERIFIED"));
    assert.equal(r.releaseReady, false);
  } finally {
    await f.close();
  }
});

test("真实CLI错误不打印私有路径，格式检查与正常测试链保留发布候选回归", async () => {
  const script = fileURLToPath(
    new URL("../check-release-candidate.mjs", import.meta.url),
  );
  const help = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert(help.stdout.includes("Read-only"));
  const bad = spawnSync(
    process.execPath,
    [script, "--artifacts", "/missing/PRIVATE_RELEASE_PATH"],
    { encoding: "utf8" },
  );
  assert.equal(bad.status, 1);
  assert(!bad.stderr.includes("PRIVATE_RELEASE_PATH"));
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    pkg.scripts["test:release-candidate"],
    "bun scripts/run-node.mjs --test scripts/tests/release-candidate.test.mjs",
  );
  assert(pkg.scripts["test:unit"].includes("bun run test:release-candidate"));
  for (const name of ["format", "format:check"])
    for (const path of [
      "scripts/check-release-candidate.mjs",
      "scripts/tests/release-candidate.test.mjs",
    ])
      assert(pkg.scripts[name].split(" ").includes(path));
});
