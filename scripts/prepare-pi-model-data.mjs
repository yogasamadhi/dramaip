import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Restore Pi's generated catalog and derive defaults from its own resolver. */
export async function preparePiModelData(repository, desktop, source, lock) {
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const data = join(source, "packages/ai/src/providers/data");
  const archive = join(repository, "vendor/pi-model-data.tgz");
  if (
    lock.modelData?.archive !== "pi-model-data.tgz" ||
    lock.modelData.sourceRevision !== lock.revision ||
    digest(await readFile(archive)) !== lock.modelData.sha256
  )
    throw new Error("Pi 模型目录归档与源码锁不一致");
  const manifest = join(data, ".manifest.json");
  if (
    digest(await readFile(manifest).catch(() => Buffer.alloc(0))) !==
    lock.modelData.manifestSha256
  ) {
    await rm(data, { recursive: true, force: true });
    await mkdir(data, { recursive: true });
    const unpack = spawnSync("tar", ["-xzf", archive, "-C", data], {
      stdio: "inherit",
    });
    if (unpack.status !== 0) throw new Error("Pi 模型目录解包失败");
  }
  if (digest(await readFile(manifest)) !== lock.modelData.manifestSha256)
    throw new Error("Pi 模型目录清单与锁文件不一致");
  const check = spawnSync(
    process.execPath,
    [join(source, "packages/ai/scripts/check-model-data.ts")],
    { stdio: "inherit" },
  );
  if (check.status !== 0) throw new Error("Pi 模型目录校验失败");
  const ts = createRequire(join(desktop, "package.json"))("typescript");
  const filename = join(
    source,
    "packages/coding-agent/src/core/model-resolver.ts",
  );
  const file = ts.createSourceFile(
    filename,
    await readFile(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const defaults = {};
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(file) !== "defaultModelPerProvider")
        continue;
      if (
        !declaration.initializer ||
        !ts.isObjectLiteralExpression(declaration.initializer)
      )
        throw new Error("Pi 默认模型模块格式变化");
      for (const property of declaration.initializer.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isStringLiteral(property.initializer)
        )
          throw new Error("Pi 默认模型必须是字符串映射");
        defaults[property.name.text] = property.initializer.text;
      }
    }
  }
  if (!Object.keys(defaults).length) throw new Error("Pi 默认模型模块不存在");
  await mkdir(join(desktop, "build"), { recursive: true });
  await writeFile(
    join(desktop, "build/pi-default-models.json"),
    `${JSON.stringify(defaults)}\n`,
  );
}
