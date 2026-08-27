import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { bootRuntime, loadProfile } from "../../runtime/src/index.js";

const outputUrl = new URL("./openapi.json", import.meta.url);

export async function generateEffectiveOpenApi(check: boolean): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dramaip-openapi-"));
  const runtime = await bootRuntime({
    databasePath: join(temporaryDirectory, "openapi.db"),
    profile: loadProfile(
      fileURLToPath(new URL("../../../profiles/studio.json", import.meta.url)),
    ),
    accessToken: "openapi-generation-token",
    mode: "headless",
    runtimeKind: "bun",
    backupDirectory: join(temporaryDirectory, "backups"),
  });
  try {
    const response = await runtime.fetch(
      new Request("http://runtime.test/api/v2/openapi.json", {
        headers: { Authorization: `Bearer ${runtime.accessToken}` },
      }),
    );
    if (!response.ok)
      throw new Error(`Effective OpenAPI request failed: ${response.status}`);
    const document = (await response.json()) as Record<string, unknown>;
    const generated = await format(JSON.stringify(document), {
      filepath: outputUrl.pathname,
    });
    if (check) {
      const current = await readFile(outputUrl, "utf8").catch(() => "");
      if (current !== generated)
        throw new Error(
          "Effective Runtime OpenAPI is stale; run bun run --filter @dramaip/client generate",
        );
    } else await writeFile(outputUrl, generated);
  } finally {
    await runtime.stop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
