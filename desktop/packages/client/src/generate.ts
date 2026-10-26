import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import { format } from "prettier";
import { generateEffectiveOpenApi } from "./generate-openapi.js";

const openApiUrl = new URL("./openapi.json", import.meta.url);
const generatedUrl = new URL("./openapi.generated.ts", import.meta.url);
const temporaryUrl = new URL(
  `./openapi.generated.${process.pid}.tmp.ts`,
  import.meta.url,
);
await generateEffectiveOpenApi(process.argv.includes("--check"));
await writeFile(
  temporaryUrl,
  `${COMMENT_HEADER}${astToString(await openapiTS(openApiUrl))}`,
);
const generated = await format(await readFile(temporaryUrl, "utf8"), {
  filepath: temporaryUrl.pathname,
});
await writeFile(temporaryUrl, generated);
const fingerprint = createHash("sha256")
  .update(await readFile(openApiUrl))
  .digest("hex");
if (process.argv.includes("--check")) {
  const current = await readFile(generatedUrl, "utf8").catch(() => "");
  await unlink(temporaryUrl);
  if (current !== generated) {
    process.stderr.write(
      "v2 OpenAPI client is stale; run pnpm --filter @dramaip/client run generate\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `v2 OpenAPI client is current (SHA-256 ${fingerprint})\n`,
    );
  }
} else {
  await rename(temporaryUrl, generatedUrl);
  await writeFile(
    new URL("./openapi.sha256", import.meta.url),
    `${fingerprint}\n`,
  );
  process.stdout.write(`generated v2 OpenAPI types (SHA-256 ${fingerprint})\n`);
}
