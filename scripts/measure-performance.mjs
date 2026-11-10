// P0 performance baseline (REFACTOR_PLAN_DSH_LEVEL2 §7.4).
//
// Runs each workload five times against the built Desktop and records the
// median, together with the machine it ran on. Electron stays hidden.
//
//   pnpm run build && node scripts/measure-performance.mjs [--runs 5] [--out <file>]
//
// Workloads:
//   coldStartMs / openProjectMs / saveChapterMs / idleMemoryMb / engineMemoryMb
//       tests/perf/desktop-baseline.perf.ts on a copy of the baseline user data
//   engineReadyMs     wall time of tests/electron/engine-runtime.spec.ts
//                     (Pi started; no model call)
//   timelineRenderMs  wall time of tests/electron/timeline-render-sources.spec.ts
//                     (needs DRAMAIP_TEST_FFMPEG_PATH / DRAMAIP_TEST_FFPROBE_PATH
//                     naming a local FFmpeg; otherwise the spec skips)
//
// Wall time is the Playwright run duration, so it includes the spec's
// beforeAll launch rather than only the test bodies.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem, arch } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const runs = Number(option("--runs", "5"));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const output = resolve(
  option(
    "--out",
    join(root, "tests/perf", `baseline-${manifest.version}.json`),
  ),
);

function playwright(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-electron-playwright.ts", "test", ...args],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return result;
}

function specDuration(spec) {
  const result = playwright([`tests/electron/${spec}`, "--reporter=json"]);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  const results = report.suites
    .flatMap(function flatten(suite) {
      return [
        ...suite.specs.flatMap((s) => s.tests.flatMap((t) => t.results)),
        ...(suite.suites ?? []).flatMap(flatten),
      ];
    })
    .filter(Boolean);
  if (result.status !== 0 || results.some((r) => r.status !== "passed"))
    return {
      error: `${spec} did not pass: ${results.map((r) => r.status).join(", ")}`,
    };
  return { value: report.stats.duration };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const samples = {
  coldStartMs: [],
  openProjectMs: [],
  saveChapterMs: [],
  idleMemoryMb: [],
  // Engine processes the Host started; outside idleMemoryMb, as in P0.
  engineMemoryMb: [],
  engineReadyMs: [],
  timelineRenderMs: [],
};
const errors = [];
const scratch = await mkdtemp(join(tmpdir(), "dramaip-perf-run-"));
try {
  for (let run = 1; run <= runs; run += 1) {
    const file = join(scratch, `run-${run}.json`);
    const result = playwright(
      ["--config", "playwright.perf.config.ts", "--reporter=list"],
      { DRAMAIP_PERF_OUTPUT: file },
    );
    if (result.status !== 0) {
      errors.push(`baseline run ${run}: ${result.stdout}\n${result.stderr}`);
    } else {
      const values = JSON.parse(await readFile(file, "utf8"));
      for (const key of [
        "coldStartMs",
        "openProjectMs",
        "saveChapterMs",
        "idleMemoryMb",
        "engineMemoryMb",
      ])
        samples[key].push(values[key]);
    }
    for (const [key, spec] of [
      ["engineReadyMs", "engine-runtime.spec.ts"],
      ["timelineRenderMs", "timeline-render-sources.spec.ts"],
    ]) {
      const measured = specDuration(spec);
      if ("value" in measured) samples[key].push(measured.value);
      else errors.push(`${key} run ${run}: ${measured.error}`);
    }
    process.stdout.write(`performance run ${run}/${runs} done\n`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const round = (value) => Math.round(value * 10) / 10;
const report = {
  version: manifest.version,
  measuredAt: new Date().toISOString(),
  runs,
  machine: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? null,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.versions.node,
  },
  median: Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [
      key,
      values.length === runs ? round(median(values)) : null,
    ]),
  ),
  samples: Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, values.map(round)]),
  ),
  errors,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.median, null, 2)}\n`);
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
}
