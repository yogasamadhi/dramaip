import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  sha256,
  signCanonical,
  verifyExtensionPackage,
  type ExtensionRegistryPayload,
} from "../packages/extension-host/src/index.ts";

interface RegistryBuildConfig {
  registryId: string;
  keyId: string;
  privateKeyPath: string;
  packages: Array<{
    path: string;
    packageUrl: string;
    publisherPublicKeyPath: string;
  }>;
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return resolve(value);
}

async function main(): Promise<void> {
const configPath = argument("config");
const outputPath = argument("out");
const config = JSON.parse(
  await readFile(configPath, "utf8"),
) as RegistryBuildConfig;
const grouped = new Map<
  string,
  ExtensionRegistryPayload["extensions"][number]
>();
for (const item of config.packages) {
  const bytes = new Uint8Array(await readFile(resolve(item.path)));
  const publisherPublicKey = await readFile(
    resolve(item.publisherPublicKeyPath),
    "utf8",
  );
  const verified = verifyExtensionPackage(bytes, publisherPublicKey);
  const current = grouped.get(verified.manifest.id) ?? {
    id: verified.manifest.id,
    name: verified.manifest.name,
    ...(verified.manifest.description
      ? { description: verified.manifest.description }
      : {}),
    versions: [],
  };
  current.versions.push({
    version: verified.manifest.version,
    packageUrl: item.packageUrl,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    manifest: verified.manifest,
    publisherPublicKey,
  });
  grouped.set(verified.manifest.id, current);
}
const payload: ExtensionRegistryPayload = {
  schemaVersion: 1,
  registryId: config.registryId,
  generatedAt: new Date().toISOString(),
  extensions: [...grouped.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
};
const signature = signCanonical(
  payload,
  await readFile(resolve(config.privateKeyPath), "utf8"),
);
await writeFile(
  outputPath,
  `${JSON.stringify({ payload, keyId: config.keyId, signature }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${outputPath}\n`);
}

void main();
