import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const AUTH_FILE = "auth.json";
const DISABLED_MARKER = ".dramaip-auth-bootstrap-disabled";
const MAX_AUTH_FILE_BYTES = 128 * 1024;

export type CodexAuthBootstrapResult =
  | "imported"
  | "already_configured"
  | "disabled"
  | "source_missing"
  | "source_invalid";

/**
 * Imports only the Codex authentication cache. Config, sessions, logs and
 * MCP state remain inside the isolated DramaIP userData directory.
 */
export async function bootstrapCodexAuthentication(input: {
  sourceHome: string;
  destinationHome: string;
}): Promise<CodexAuthBootstrapResult> {
  const sourceHome = resolve(input.sourceHome);
  const destinationHome = resolve(input.destinationHome);
  await preparePrivateDirectory(destinationHome);

  if (sourceHome === destinationHome) return "already_configured";
  if (await isRegularFile(join(destinationHome, AUTH_FILE)))
    return "already_configured";
  if (await isRegularFile(join(destinationHome, DISABLED_MARKER)))
    return "disabled";

  const sourcePath = join(sourceHome, AUTH_FILE);
  let source: Buffer;
  try {
    const metadata = await lstat(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > MAX_AUTH_FILE_BYTES
    )
      return "source_invalid";
    source = await readFile(sourcePath);
  } catch (cause) {
    return isMissingFile(cause) ? "source_missing" : "source_invalid";
  }

  if (!containsCodexCredential(source)) return "source_invalid";
  await writePrivateFile(destinationHome, AUTH_FILE, source);
  await disableCodexAuthBootstrap(destinationHome);
  return "imported";
}

/** Prevent a deliberate logout from being undone on the next launch. */
export async function disableCodexAuthBootstrap(
  destinationHome: string,
): Promise<void> {
  const directory = resolve(destinationHome);
  await preparePrivateDirectory(directory);
  if (await isRegularFile(join(directory, DISABLED_MARKER))) return;
  await writePrivateFile(directory, DISABLED_MARKER, Buffer.from("disabled\n"));
}

async function preparePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
}

async function writePrivateFile(
  directory: string,
  name: string,
  contents: Buffer,
): Promise<void> {
  const target = join(directory, name);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function containsCodexCredential(contents: Buffer): boolean {
  try {
    const parsed = JSON.parse(contents.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return false;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.OPENAI_API_KEY === "string" &&
      record.OPENAI_API_KEY.trim()
    )
      return true;
    if (!record.tokens || typeof record.tokens !== "object") return false;
    const tokens = record.tokens as Record<string, unknown>;
    return ["access_token", "refresh_token", "id_token"].some(
      (key) => typeof tokens[key] === "string" && tokens[key].trim(),
    );
  } catch {
    return false;
  }
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
