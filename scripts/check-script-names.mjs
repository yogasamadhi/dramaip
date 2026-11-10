// Every script a command names exists (REFACTOR_PLAN_DSH_LEVEL2 P6 acceptance 4).
//
// Reads the `pnpm` invocations in the desktop package.json scripts and in the
// fenced and inline code of the repository's AGENTS.md and the desktop
// READMEs, and checks each named script against the package it runs in:
//
//   pnpm run <name>                     a script of the desktop package
//   pnpm <name>                         the same, unless <name> is a pnpm command
//   pnpm --filter <package> run <name>  a script of that workspace package
//
// `pnpm exec`, `pnpm dlx` and other pnpm commands run binaries, not scripts.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktop, "..");

/** pnpm's own commands; `pnpm <command>` never names a script. */
const pnpmCommands = new Set([
  "add",
  "audit",
  "bin",
  "config",
  "create",
  "dedupe",
  "dlx",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "i",
  "licenses",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "rm",
  "root",
  "store",
  "unlink",
  "update",
  "up",
  "why",
]);

const documents = [
  join(repository, "AGENTS.md"),
  join(desktop, "README.md"),
  join(desktop, "docs", "README.md"),
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Workspace package name → its scripts, from pnpm-workspace.yaml globs. */
async function workspacePackages() {
  const manifest = await readFile(join(desktop, "pnpm-workspace.yaml"), "utf8");
  const globs = [...manifest.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gmu)].map(
    ([, glob]) => glob,
  );
  const packages = new Map();
  const add = async (directory) => {
    const json = await readJson(join(directory, "package.json")).catch(
      () => undefined,
    );
    if (json?.name) packages.set(json.name, json.scripts ?? {});
  };
  for (const glob of globs) {
    if (glob.startsWith("!")) continue;
    const parts = glob.split("/");
    const expand = async (base, rest) => {
      if (rest.length === 0) return add(base);
      const [head, ...tail] = rest;
      if (head !== "*" && head !== "**") return expand(join(base, head), tail);
      const entries = await readdir(base, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries)
        if (entry.isDirectory() && entry.name !== "node_modules")
          await expand(join(base, entry.name), tail);
    };
    await expand(desktop, parts);
  }
  return packages;
}

/** The `pnpm …` command lines in a script value or a document's code. */
function invocations(text) {
  return [
    ...text.matchAll(/(?:^|[\s;&|(`"'])pnpm((?:\s+[^\s;&|)`"']+)+)/gu),
  ].map(([, rest]) => rest.trim().split(/\s+/u));
}

/** The package and script one invocation names, if it names a script. */
function scriptOf(words) {
  let filter;
  let index = 0;
  while (index < words.length && words[index].startsWith("-")) {
    const flag = words[index];
    if (flag === "--filter" || flag === "-F") filter = words[index + 1];
    else if (flag.startsWith("--filter=")) filter = flag.slice(9);
    index += flag === "--filter" || flag === "-F" ? 2 : 1;
  }
  const command = words[index];
  if (command === undefined) return undefined;
  if (command === "run" || command === "run-script") {
    const name = words.slice(index + 1).find((word) => !word.startsWith("-"));
    return name === undefined ? undefined : { filter, name };
  }
  if (pnpmCommands.has(command) || command.startsWith("<")) return undefined;
  return { filter, name: command };
}

/** Code spans and fenced blocks of a Markdown document. */
function codeOf(markdown) {
  return [
    ...[...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map(
      ([, code]) => code,
    ),
    ...[
      ...markdown.replace(/```[\s\S]*?```/gu, "").matchAll(/`([^`\n]+)`/gu),
    ].map(([, code]) => code),
  ];
}

const desktopManifest = await readJson(join(desktop, "package.json"));
const packages = await workspacePackages();
packages.set(desktopManifest.name, desktopManifest.scripts ?? {});

const sources = Object.entries(desktopManifest.scripts ?? {}).map(
  ([name, value]) => ({ where: `package.json scripts.${name}`, text: value }),
);
for (const path of documents) {
  const markdown = await readFile(path, "utf8").catch(() => undefined);
  if (markdown === undefined) continue;
  for (const code of codeOf(markdown))
    sources.push({ where: relative(repository, path), text: code });
}

const missing = [];
let checked = 0;
for (const { where, text } of sources)
  for (const words of invocations(text)) {
    const script = scriptOf(words);
    if (script === undefined) continue;
    checked++;
    const owner = script.filter ?? desktopManifest.name;
    const scripts = packages.get(owner);
    if (scripts === undefined)
      missing.push(`${where}: no workspace package ${owner}`);
    else if (!Object.hasOwn(scripts, script.name))
      missing.push(`${where}: ${owner} has no script "${script.name}"`);
  }

if (missing.length > 0) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log(`script names: ${checked} references, all present`);
