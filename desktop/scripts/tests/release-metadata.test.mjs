import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateReleaseMetadata } from "../generate-release-metadata.mjs";

const realRoot = fileURLToPath(new URL("../..", import.meta.url));
const sha = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const version = JSON.parse(
  await readFile(join(realRoot, "apps/desktop/package.json"), "utf8"),
).version;
async function fixture({ count = 20, product = "TestProduct" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "dramaip-release-metadata-"));
  const dist = join(root, "dist"),
    output = join(dist, "release-metadata");
  await mkdir(dist);
  await mkdir(join(root, "apps/desktop"), { recursive: true });
  await writeFile(
    join(root, "apps/desktop/package.json"),
    JSON.stringify({ name: "fixture-desktop-app", version }),
  );
  await writeFile(
    join(root, "apps/desktop/electron-builder.yml"),
    JSON.stringify({ productName: product }),
  );
  const filename = `${product}-${version}-arm64-mac.zip`;
  const bytes = Buffer.from(
    "private-installer-canary: inert fixture, never execute",
  );
  await writeFile(join(dist, filename), bytes);
  const metadata = {
    version,
    files: [
      {
        url: filename,
        size: bytes.length,
        sha512: sha(bytes, "sha512", "base64"),
      },
    ],
  };
  await writeFile(join(dist, "alpha-mac.yml"), JSON.stringify(metadata));
  await writeFile(
    join(dist, "latest-mac.yml"),
    JSON.stringify({ version: "1.0.0", files: [{ url: "old-package.zip" }] }),
  );
  await writeFile(
    join(dist, `${product}-1.0.0-arm64.zip`),
    "historical-bytes-preserve",
  );
  await writeFile(
    join(dist, "builder-debug.yml"),
    "private debug content, invalid YAML",
  );
  await mkdir(join(dist, "mac-arm64"));
  await writeFile(
    join(dist, "mac-arm64/private-unpacked.txt"),
    "private-unpacked-body",
  );
  for (let i = 0; i < count; i++) {
    const directory = join(
      root,
      `node_modules/.bun/fixture-${i}@1.0.0/node_modules/fixture-${i}`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: `fixture-${i}`,
        version: "1.0.0",
        license: "MIT",
      }),
    );
  }
  return {
    root,
    dist,
    output,
    filename,
    bytes,
    metadata,
    run: () => generateReleaseMetadata({ root, dist, output }),
    close: () => rm(root, { recursive: true, force: true }),
  };
}
async function absentOutput(f) {
  await assert.rejects(readFile(join(f.output, "SHA256SUMS")), {
    code: "ENOENT",
  });
  assert(
    !(await readdir(f.dist)).some((name) =>
      name.startsWith(".dramaip-release-metadata-"),
    ),
  );
}

test("元数据只选当前版本安装文件／更新清单／现有blockmap，旧包与解包debug不混入", async () => {
  const f = await fixture();
  try {
    const additional = ["x64.exe", "x64.zip", "x64.deb", "x64.AppImage"].map(
      (suffix) => `TestProduct-${version}-${suffix}`,
    );
    for (const name of additional)
      await writeFile(join(f.dist, name), `inert-${name}`);
    await writeFile(join(f.dist, `${f.filename}.blockmap`), "inert blockmap");
    const r = await f.run();
    assert.equal(r.artifacts, 7);
    assert.equal(r.components, 20);
    assert.equal(r.manifest.releaseReady, false);
    assert.deepEqual(r.manifest.historicalUpdateFiles, ["latest-mac.yml"]);
    assert.equal(
      r.manifest.dependencyInventoryScope,
      "installed-desktop-bun-dependencies-not-packaged-byte-proof",
    );
    const sums = await readFile(join(f.output, "SHA256SUMS"), "utf8");
    assert.equal(sums.trim().split("\n").length, 7);
    for (const file of r.manifest.files) {
      assert(
        sums.includes(
          `${sha(await readFile(join(f.dist, file.file)))}  ${file.file}\n`,
        ),
      );
    }
    assert(!JSON.stringify(r.manifest).includes("private-installer-canary"));
    assert(!JSON.stringify(r.manifest).includes(f.root));
    for (const ignored of [
      "builder-debug.yml",
      "latest-mac.yml",
      "private-unpacked.txt",
      "TestProduct-1.0.0-arm64.zip",
    ])
      assert(!sums.includes(ignored));
    assert.equal(
      await readFile(join(f.dist, "TestProduct-1.0.0-arm64.zip"), "utf8"),
      "historical-bytes-preserve",
    );
    assert.deepEqual(await readFile(join(f.dist, f.filename)), f.bytes);
  } finally {
    await f.close();
  }
});

test("三文档摘要与最后库存回执绑定实际生成字节，SBOM保留独立版本与许可范围", async () => {
  const f = await fixture();
  try {
    await f.run();
    assert.deepEqual((await readdir(f.output)).sort(), [
      "SHA256SUMS",
      "THIRD_PARTY_LICENSES.json",
      "release-inventory.json",
      "sbom.cdx.json",
    ]);
    const manifest = JSON.parse(
      await readFile(join(f.output, "release-inventory.json")),
    );
    for (const document of manifest.documents)
      assert.equal(
        document.sha256,
        sha(await readFile(join(f.output, document.file))),
      );
    const sbom = JSON.parse(await readFile(join(f.output, "sbom.cdx.json")));
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.equal(sbom.metadata.component.version, version);
    assert.equal(sbom.components.length, 20);
    assert(sbom.components.every((c) => c.licenses[0].license.id === "MIT"));
    assert.equal(sbom.metadata.timestamp, manifest.generatedAt);
    assert.equal(manifest.releaseReady, false);
  } finally {
    await f.close();
  }
});

test("SBOM数量门必须在任何校验文件输出前通过，失败不留假成功或暂存目录", async () => {
  const f = await fixture({ count: 19 });
  try {
    await assert.rejects(f.run(), /SBOM_COMPONENTS_INCOMPLETE/);
    await absentOutput(f);
  } finally {
    await f.close();
  }
});

test("坏依赖manifest不靠其他组件数量掩盖；重复依赖不抬高最低组件数", async () => {
  for (const invalid of [true, false]) {
    const f = await fixture({ count: 19 });
    try {
      const extra = join(f.root, "node_modules/.bun/extra/node_modules/extra");
      await mkdir(extra, { recursive: true });
      await writeFile(
        join(extra, "package.json"),
        invalid
          ? "private-corrupt-canary"
          : JSON.stringify({ name: "fixture-0", version: "1.0.0" }),
      );
      await assert.rejects(
        f.run(),
        invalid ? /DEPENDENCY_MANIFEST_INVALID/ : /SBOM_COMPONENTS_INCOMPLETE/,
      );
      await absentOutput(f);
    } finally {
      await f.close();
    }
  }
});

test("缺当前更新清单不能借历史清单生成，等长安装文件篡改也不留下输出", async () => {
  for (const missing of [true, false]) {
    const f = await fixture();
    try {
      if (missing) await rm(join(f.dist, "alpha-mac.yml"));
      else
        await writeFile(
          join(f.dist, f.filename),
          Buffer.alloc(f.bytes.length, 42),
        );
      await assert.rejects(
        f.run(),
        missing
          ? /CURRENT_UPDATE_METADATA_MISSING/
          : /UPDATE_ARTIFACT_BYTES_CHANGED/,
      );
      await absentOutput(f);
    } finally {
      await f.close();
    }
  }
});

test("当前未被update引用的安装文件与blockmap符号链接拒绝，旧目录不递归访问", async () => {
  for (const blockmap of [false, true]) {
    const f = await fixture();
    try {
      const name = blockmap
        ? `${f.filename}.blockmap`
        : `TestProduct-${version}-x64.deb`;
      await symlink(join(f.dist, f.filename), join(f.dist, name));
      await assert.rejects(
        f.run(),
        blockmap ? /BLOCKMAP_NOT_REGULAR/ : /CURRENT_ARTIFACT_NOT_REGULAR/,
      );
      await absentOutput(f);
    } finally {
      await f.close();
    }
  }
});

test("已有输出和输出符号链接不覆盖，root／dist／祖先目录不可作为输出", async () => {
  const f = await fixture();
  try {
    await mkdir(f.output);
    await writeFile(
      join(f.output, "SHA256SUMS"),
      "existing-user-output-canary",
    );
    await assert.rejects(f.run(), /OUTPUT_ALREADY_EXISTS/);
    assert.equal(
      await readFile(join(f.output, "SHA256SUMS"), "utf8"),
      "existing-user-output-canary",
    );
    const alias = join(f.dist, "output-alias");
    await symlink(f.output, alias);
    await assert.rejects(
      generateReleaseMetadata({ ...f, output: alias }),
      /OUTPUT_ALREADY_EXISTS/,
    );
    for (const output of [f.root, f.dist, tmpdir()])
      await assert.rejects(
        generateReleaseMetadata({ ...f, output }),
        /OUTPUT_SCOPE_INVALID/,
      );
  } finally {
    await f.close();
  }
});

test("并发生成同一新目录只成功一次，失败者不删除成功者文件或留下假完整清单", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      JSON.parse(await readFile(join(f.output, "release-inventory.json"))).files
        .length,
      2,
    );
    assert.equal((await readdir(f.output)).length, 4);
    assert(
      !(await readdir(f.dist)).some((name) =>
        name.startsWith(".dramaip-release-metadata-"),
      ),
    );
  } finally {
    await f.close();
  }
});

test("真实Node CLI仅向新临时目录生成且不打印路径／文件正文；错误与help无发行批准", async () => {
  const product = (
    await readFile(join(realRoot, "apps/desktop/electron-builder.yml"), "utf8")
  ).match(/^productName: (.+)$/m)[1];
  const f = await fixture({ product });
  try {
    const script = join(realRoot, "scripts/generate-release-metadata.mjs");
    const env = {
      ...process.env,
      DRAMAIP_RELEASE_ARTIFACT_DIR: f.dist,
      DRAMAIP_RELEASE_METADATA_DIR: f.output,
    };
    const ok = spawnSync(process.execPath, [script], {
      env,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /releaseReady=false/);
    assert(!ok.stdout.includes(f.root));
    assert(!ok.stdout.includes("private-installer-canary"));
    const bunOutput = join(f.dist, "bun-release-metadata");
    const bun = spawnSync("bun", ["run", "release:metadata"], {
      cwd: realRoot,
      env: { ...env, DRAMAIP_RELEASE_METADATA_DIR: bunOutput },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(bun.status, 0, bun.stderr);
    assert.match(bun.stdout, /releaseReady=false/);
    assert.equal(
      JSON.parse(await readFile(join(bunOutput, "release-inventory.json")))
        .files.length,
      2,
    );
    const repeat = spawnSync(process.execPath, [script], {
      env,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /OUTPUT_ALREADY_EXISTS/);
    assert(!repeat.stderr.includes(f.root));
    const bad = spawnSync(process.execPath, [script, "/private-path-canary"], {
      env,
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert(!bad.stderr.includes("private-path-canary"));
    const help = spawnSync(process.execPath, [script, "--help"], {
      env,
      encoding: "utf8",
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Never release approval/);
  } finally {
    await f.close();
  }
});

test("元数据回归接正常unit与显式format范围，现有检查不删且生成入口继续使用Bun", async () => {
  const pkg = JSON.parse(
    await readFile(join(realRoot, "package.json"), "utf8"),
  );
  assert.equal(
    pkg.scripts["release:metadata"],
    "bun run scripts/generate-release-metadata.mjs",
  );
  assert.equal(
    pkg.scripts["test:release-metadata"],
    "bun scripts/run-node.mjs --test scripts/tests/release-metadata.test.mjs",
  );
  assert(pkg.scripts["test:unit"].includes("bun run test:release-metadata"));
  for (const name of ["format", "format:check"])
    for (const path of [
      "scripts/generate-release-metadata.mjs",
      "scripts/tests/release-metadata.test.mjs",
    ])
      assert(pkg.scripts[name].split(" ").includes(path));
});
