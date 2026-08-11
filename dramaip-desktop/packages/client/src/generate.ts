import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OpenApi } from "effect/unstable/httpapi";
import { StudioApi } from "@sdns/protocol";
import { format } from "prettier";

const templateUrl = new URL("./generated.template.ts", import.meta.url);
const outputUrl = new URL("./generated.ts", import.meta.url);
const openApiUrl = new URL("./openapi.json", import.meta.url);

const specification = OpenApi.fromApi(StudioApi);
const serialized = await format(JSON.stringify(specification), {
  parser: "json",
});
const fingerprint = createHash("sha256").update(serialized).digest("hex");
const template = await Bun.file(templateUrl).text();
if (!template.includes("__DRAMAIP_API_SHA256__")) {
  throw new Error("生成模板缺少 OpenAPI 指纹占位符");
}

const generated = await format(
  template.replace("__DRAMAIP_API_SHA256__", fingerprint),
  { filepath: fileURLToPath(outputUrl) },
);
if (process.argv.includes("--check")) {
  const [currentGenerated, currentOpenApi] = await Promise.all([
    readFile(outputUrl, "utf8").catch(() => ""),
    readFile(openApiUrl, "utf8").catch(() => ""),
  ]);
  if (currentGenerated !== generated || currentOpenApi !== serialized) {
    process.stderr.write(
      "生成客户端或 OpenAPI 快照已过期，请运行 bun run --filter @sdns/client generate\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`生成客户端契约一致（SHA-256 ${fingerprint}）\n`);
  }
} else {
  await Promise.all([
    writeFile(outputUrl, generated),
    writeFile(openApiUrl, serialized),
  ]);

  process.stdout.write(
    `已从 Effect HttpApi 生成客户端契约（SHA-256 ${fingerprint}）\n`,
  );
}
