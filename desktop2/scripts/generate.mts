import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import type { EngineEvent } from "@dramaip/contracts";
import type { EngineControlBridge, EngineKind } from "@dramaip/agents";
import { foundationMigrations } from "@dramaip/database";
import { bootServerKernel } from "@dramaip/kernel";
import { prepareDramaRuntime } from "@dramaip/runtime";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "..");
const generated = join(root, "generated");

class GenerationBridge implements EngineControlBridge {
  async call<T>(kind: EngineKind, method: string): Promise<T> {
    if (method === "health")
      return { status: "unavailable", version: "generation" } as T;
    if (method === "capabilities") {
      return {
        streaming: true,
        interrupt: true,
        resume: true,
        fork: true,
        tools: [],
      } as T;
    }
    throw new Error(`generation bridge cannot execute ${kind}.${method}`);
  }
  async *stream(): AsyncIterable<EngineEvent> {
    yield* [] as EngineEvent[];
    throw new Error("generation bridge cannot stream");
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
}

async function files(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "lib", ".git"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else output.push(path);
  }
  return output.sort();
}

async function treeHash(
  directory: string,
): Promise<{ files: number; sha256: string }> {
  const hash = createHash("sha256");
  const info = await stat(directory);
  const entries = info.isDirectory() ? await files(directory) : [directory];
  for (const path of entries) {
    const content = await readFile(path);
    const name = info.isDirectory()
      ? relative(directory, path)
      : path.split(/[\\/]/).at(-1)!;
    hash.update(`${name.replaceAll("\\", "/")}\0`);
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  }
  return { files: entries.length, sha256: hash.digest("hex") };
}

const temporary = await mkdtemp(join(tmpdir(), "dramaip-next-generation-"));
const profileText = await readFile(join(root, "profiles/studio.json"), "utf8");
const prepared = prepareDramaRuntime({
  profileText,
  databaseFile: join(temporary, "dramaip.db"),
  backupDirectory: join(temporary, "backups"),
  username: "generation",
  password: "generation-only",
  allowedOrigins: [],
  engineBridge: new GenerationBridge(),
  engineTokens: {
    opencode: "generation-opencode",
    codex: "generation-codex",
    dsh: "generation-dsh",
    pi: "generation-pi",
    langgraph: "generation-langgraph",
  },
});
const kernel = await bootServerKernel(prepared);

try {
  await writeJson(
    join(generated, "openapi.json"),
    kernel.context.http.openapiDocument(),
  );
  const pluginManifest = kernel.pluginOrder.map((id, order) => {
    const descriptor = prepared.builtins.get(id)!.descriptor;
    return { order, ...descriptor };
  });
  await writeJson(join(generated, "plugin-manifest.json"), {
    profile: prepared.profile.name,
    plugins: pluginManifest,
  });
  const migrations = [
    ...foundationMigrations,
    ...kernel.pluginOrder.flatMap(
      (id) => prepared.builtins.get(id)?.migrations ?? [],
    ),
  ];
  await writeJson(join(generated, "migration-manifest.json"), {
    migrations: migrations.map((migration) => ({
      id: migration.id,
      pluginId: migration.pluginId,
      version: migration.version,
      dependsOn: migration.dependsOn,
      foreignKeysOff: migration.foreignKeysOff ?? false,
      checksum: createHash("sha256").update(migration.sql).digest("hex"),
    })),
  });
} finally {
  await kernel.dispose();
  await rm(temporary, { recursive: true, force: true });
}

const vendorRoot = join(repository, "desktop/vendor/deepseek-harness/vendor");
await writeJson(join(generated, "vendor-lock.json"), {
  cordis: { version: "4.0.1", ...(await treeHash(join(vendorRoot, "cordis"))) },
  cosmokit: {
    version: "1.8.2",
    ...(await treeHash(join(vendorRoot, "cosmokit"))),
  },
  loader: { version: "1.0.2", ...(await treeHash(join(vendorRoot, "loader"))) },
  group: { version: "1.0.1", ...(await treeHash(join(vendorRoot, "group"))) },
  engines: {
    opencode: {
      version: "1.18.15",
      lock: await treeHash(
        join(repository, "desktop/vendor/opencode.lock.json"),
      ),
    },
    codex: {
      version: "0.147.0",
      lock: await treeHash(join(repository, "desktop/vendor/codex.lock.json")),
    },
    dsh: {
      version: "0.1.0-rc.5",
      lock: await treeHash(
        join(repository, "desktop/vendor/deepseek-harness.lock.json"),
      ),
    },
    pi: {
      version: "0.84.2",
      lock: await treeHash(join(repository, "desktop/vendor/pi.lock.json")),
    },
    langgraph: { version: "0.2.43", source: "npm lock in desktop2/bun.lock" },
  },
});

await writeJson(join(generated, "third-party-licenses.json"), {
  packages: [
    { name: "@deepseek-ai/cordis", version: "4.0.1", license: "MIT" },
    { name: "@deepseek-ai/cosmokit", version: "1.8.2", license: "MIT" },
    {
      name: "@deepseek-ai/cordis-plugin-loader",
      version: "1.0.2",
      license: "MIT",
    },
    {
      name: "@deepseek-ai/cordis-plugin-group",
      version: "1.0.1",
      license: "MIT",
    },
    { name: "Electron", version: "43.2.0", license: "MIT" },
    { name: "Hono", version: "4.13.2", license: "MIT" },
    { name: "React", version: "19.2.7", license: "MIT" },
    { name: "Tiptap", version: "2.27.2", license: "MIT" },
    { name: "tiptap-markdown", version: "0.8.10", license: "MIT" },
    { name: "lucide-react", version: "0.454.0", license: "ISC" },
    { name: "Zod", version: "4.4.3", license: "MIT" },
    { name: "Drizzle ORM", version: "1.0.0-rc.2", license: "Apache-2.0" },
    {
      name: "@earendil-works/pi-agent-core",
      version: "0.84.2",
      license: "MIT",
    },
  ],
});

const openapiInfo = await stat(join(generated, "openapi.json"));
process.stdout.write(
  `Generated Desktop2 contracts (${openapiInfo.size} bytes OpenAPI)\n`,
);
