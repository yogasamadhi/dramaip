// Type-checks the DSH-architecture packages (packages/infra, packages/boot,
// packages/compat, packages/host, packages/seams, packages/system, packages/insights, packages/production, packages/workspace, packages/writing, packages/agents, packages/automation, packages/testing, apps/cli) the way DSH's project references do.
//
// Sources: every package face is its own program, reporting only that
// package's diagnostics. A face sees its dependencies' module augmentations
// (generated Remote namespaces, Context services) only through what it
// imports, so a Gateway service implementing `ClientRemote` is checked
// against the Remote surface it knows, not against every namespace another
// package selects.
//
// Tests: two aggregates, Host and Client, because both faces merge Cordis
// `Context` under the same keys (`remoteAccess`, `remote`, ...) with
// different services. They report only test-file diagnostics, since tests
// declare fixture-only augmentations that would otherwise leak into sources.
//
// A package's face configs say which sources belong to which face:
// `tsconfig.host.json` / `tsconfig.client.json` for packages with both faces,
// otherwise `tsconfig.json`, whose `extends` names the face base. A test of a
// two-faced package names its face by suffix: `*.client.*` belongs to the
// Client aggregate, every other test to the Host aggregate. Tests of a
// one-faced package (and their helpers) take that face unless the suffix
// names the other one.
//
// The Host aggregate `tsconfig.host.json`, which the Typert generator reads,
// must reference exactly the Host package projects found here.
//
//   node scripts/typecheck-infra.mjs
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyHandlers } from "./legacy-handlers.mjs";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const infra = join(desktop, "packages/infra");
const cli = join(desktop, "apps/cli");

// The copies are written against the TypeScript the DSH sources use, which
// the typert generator also depends on; the rest of Desktop keeps its own.
const ts = createRequire(join(infra, "typert-generator/package.json"))(
  "typescript",
);

/** Generated or upstream-shaped inputs that no program compiles. */
const excluded = [
  /\/typert-generator\/tests\/fixtures\//u,
  /\/node_modules\//u,
];

/**
 * Packages under these groups that compile under the root compiler options
 * with their own `tsc` (the workspace typecheck): the plugin suites drive
 * the Host faces' Kernel-era `handlers/*`, which are not DSH-architecture
 * code.
 */
const rootCompiled = new Set([
  "packages/testing/plugin-suites",
  "packages/workspace/studio-client",
]);

/**
 * Packages that keep the Desktop compiler options of their own tsconfig (the
 * Studio app and the Kernel-era handlers were written against them): one
 * program each, reporting only the directory's own diagnostics.
 */
const ownOptions = [
  "packages/workspace/studio-client",
  ...new Set(
    legacyHandlers(desktop).map(({ directory }) => dirname(directory)),
  ),
];

const isTest = (file) => /\/tests\//u.test(file);
const isClientTest = (file) => /\.client(?:\.[\w-]+)*\.[cm]?tsx?$/u.test(file);
const isHostTest = (file) => /\.host(?:\.[\w-]+)*\.[cm]?tsx?$/u.test(file);
const kept = (files) =>
  files.filter((file) => !excluded.some((pattern) => pattern.test(file)));

function parse(configPath) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => fail([d]) },
  );
  if (parsed === undefined) throw new Error(`cannot read ${configPath}`);
  if (parsed.errors.length > 0) fail(parsed.errors);
  return parsed;
}

function packageDirs() {
  const groups = [
    infra,
    join(desktop, "packages/boot"),
    join(desktop, "packages/compat"),
    join(desktop, "packages/host"),
    join(desktop, "packages/seams"),
    join(desktop, "packages/system"),
    join(desktop, "packages/insights"),
    join(desktop, "packages/production"),
    join(desktop, "packages/workspace"),
    join(desktop, "packages/writing"),
    join(desktop, "packages/agents"),
    join(desktop, "packages/automation"),
    join(desktop, "packages/testing"),
  ];
  const dirs = groups.flatMap((group) =>
    readdirSync(group, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(group, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")))
      .filter((dir) => !rootCompiled.has(relative(desktop, dir))),
  );
  return [...dirs, cli];
}

/** One package face checked as its own program. */
const units = [];
const hostTests = new Set();
const clientTests = new Set();
const addAll = (set, files) => {
  for (const file of kept(files)) set.add(file);
};

for (const dir of packageDirs()) {
  const hostConfig = join(dir, "tsconfig.host.json");
  const clientConfig = join(dir, "tsconfig.client.json");
  const ownConfig = join(dir, "tsconfig.json");
  const tests = existsSync(ownConfig)
    ? parse(ownConfig).fileNames.filter(isTest)
    : [];
  if (existsSync(hostConfig) || existsSync(clientConfig)) {
    for (const [face, config] of [
      ["host", hostConfig],
      ["client", clientConfig],
    ]) {
      if (!existsSync(config)) continue;
      // The aggregate references a two-faced package's face config itself.
      units.push({
        dir,
        face,
        project: config,
        files: kept(parse(config).fileNames),
      });
    }
    addAll(
      hostTests,
      tests.filter((file) => !isClientTest(file)),
    );
    addAll(clientTests, tests.filter(isClientTest));
  } else if (existsSync(ownConfig)) {
    const own = parse(ownConfig);
    const clientOnly = own.options.jsx !== undefined;
    units.push({
      dir,
      face: clientOnly ? "client" : "host",
      project: dir,
      files: kept(own.fileNames.filter((file) => !isTest(file))),
    });
    const other = clientOnly ? isHostTest : isClientTest;
    addAll(
      clientOnly ? clientTests : hostTests,
      tests.filter((file) => !other(file)),
    );
    addAll(clientOnly ? hostTests : clientTests, tests.filter(other));
  }
}
addAll(hostTests, [
  join(desktop, "vitest.infra.config.ts"),
  ...readdirSync(join(desktop, "scripts/vitest")).map((name) =>
    join(desktop, "scripts/vitest", name),
  ),
]);

function report(diagnostics) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => desktop,
      getNewLine: () => "\n",
    }),
  );
}

function fail(diagnostics) {
  report(diagnostics);
  process.exit(1);
}

let failed = 0;

// The Host aggregate lists the same Host package projects as the units above.
{
  const listed = (
    parse(join(desktop, "tsconfig.host.json")).projectReferences ?? []
  )
    .map((reference) => relative(desktop, reference.path))
    .sort();
  const expected = units
    .filter((unit) => unit.face === "host" && unit.dir !== cli)
    .map((unit) => relative(desktop, unit.project))
    .sort();
  const missing = expected.filter((path) => !listed.includes(path));
  const extra = listed.filter((path) => !expected.includes(path));
  if (missing.length > 0 || extra.length > 0) {
    failed += 1;
    console.error(
      "tsconfig.host.json references are out of step with the Host packages:" +
        missing.map((path) => `\n  missing ${path}`).join("") +
        extra.map((path) => `\n  extra ${path}`).join(""),
    );
  }
}

/** Compiler options of one face, and a compiler host whose parsed files all of that face's programs share. */
function faceSetup(base) {
  // Tests of both faces run under Vitest on Node.
  const options = { ...parse(base).options, types: ["node"], noEmit: true };
  const host = ts.createCompilerHost(options);
  const parsed = new Map();
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const key = `${fileName}\0${JSON.stringify(languageVersion)}`;
    if (!shouldCreate && parsed.has(key)) return parsed.get(key);
    const file = getSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreate,
    );
    parsed.set(key, file);
    return file;
  };
  return { options, host };
}

const faces = {
  host: faceSetup(join(infra, "tsconfig.base.json")),
  client: faceSetup(join(infra, "tsconfig.base.client.json")),
};

for (const face of ["host", "client"]) {
  const { options, host } = faces[face];
  let checked = 0;
  let count = 0;
  for (const unit of units) {
    if (unit.face !== face || unit.files.length === 0) continue;
    checked += 1;
    const inside = `${unit.dir}${sep}`;
    const program = ts.createProgram(unit.files, options, host);
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter(
        (diagnostic) =>
          diagnostic.file === undefined ||
          diagnostic.file.fileName.startsWith(inside),
      );
    report(diagnostics);
    count += diagnostics.length;
  }
  failed += count;
  console.log(`${face} sources: ${checked} packages, ${count} diagnostics`);
}

const isSource = (file) =>
  file !== undefined &&
  !isTest(file) &&
  !file.startsWith(join(desktop, "scripts/")) &&
  !file.endsWith("/vitest.infra.config.ts");

for (const [face, roots] of [
  ["host", hostTests],
  ["client", clientTests],
]) {
  const { options, host } = faces[face];
  // Sources stay roots so their ambient declarations (CSS modules, globals) apply.
  const sources = units
    .filter((unit) => unit.face === face)
    .flatMap((unit) => unit.files);
  const program = ts.createProgram([...sources, ...roots], options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !isSource(diagnostic.file?.fileName));
  report(diagnostics);
  failed += diagnostics.length;
  console.log(
    `${face} tests: ${roots.size} root files, ${diagnostics.length} diagnostics`,
  );
}
for (const dir of ownOptions) {
  const own = parse(join(desktop, dir, "tsconfig.json"));
  const inside = `${join(desktop, dir)}${sep}`;
  const program = ts.createProgram(own.fileNames, own.options);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file === undefined ||
        diagnostic.file.fileName.startsWith(inside),
    );
  report(diagnostics);
  failed += diagnostics.length;
  console.log(`${dir}: ${diagnostics.length} diagnostics`);
}
process.exit(failed === 0 ? 0 : 1);
