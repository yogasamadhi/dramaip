import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyExtensionPackage } from "../packages/extension-host/src/index.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return resolve(value);
}

async function main(): Promise<void> {
const archive = new Uint8Array(await readFile(argument("package")));
const publisherPublicKey = await readFile(argument("publisher-public-key"), "utf8");
const verified = verifyExtensionPackage(archive, publisherPublicKey);
process.stdout.write(
  `${JSON.stringify({
    id: verified.manifest.id,
    version: verified.manifest.version,
    contentHash: verified.contentHash,
    publisher: verified.signature.publisherId,
  })}\n`,
);
}

void main();
