import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const repository = resolve(root, "..");
const baseline = JSON.parse(
  await readFile(join(root, "docs/parity/baseline.json"), "utf8"),
);
const inventoryPath = join(root, "docs/parity/baseline-inventory.json");
interface PreviousEndpoint {
  sourcePath: string;
  scope?: "core" | "future";
  status: string;
  acceptanceTests: string[];
  disposition?: "migrate" | "local-policy" | "exclude-dev-only";
  replacementEndpoints?: string[];
}
interface PreviousRoute {
  sourcePath: string;
  scope?: "core" | "future";
  status: string;
  replacementRoutes: string[];
  acceptanceTests: string[];
  disposition?: "migrate" | "local-policy" | "exclude-dev-only";
}
interface PreviousJourney {
  sourceTest: string;
  scenarioId?: string;
  scenario?: string;
  scope?: "core" | "future";
  status: string;
  replacementTests: string[];
  disposition?: "migrate" | "local-policy" | "exclude-dev-only";
}
interface PreviousInventory {
  endpoints: PreviousEndpoint[];
  uiRoutes: PreviousRoute[];
  electronJourneys: PreviousJourney[];
}
const previous = await readFile(inventoryPath, "utf8")
  .then((source) => JSON.parse(source) as PreviousInventory)
  .catch(() => undefined);
const previousEndpoints = new Map<string, PreviousEndpoint>(
  (previous?.endpoints ?? []).map((item) => [item.sourcePath, item]),
);
const previousRoutes = new Map<string, PreviousRoute>(
  (previous?.uiRoutes ?? []).map((item) => [item.sourcePath, item]),
);
const previousJourneys = new Map<string, PreviousJourney>(
  (previous?.electronJourneys ?? []).map((item) => [
    `${item.sourceTest}#${item.scenarioId ?? "file"}`,
    item,
  ]),
);

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

for (const [path, expected] of Object.entries(
  baseline.keyFiles as Record<string, string>,
)) {
  const actual = await sha256(join(repository, path));
  if (actual !== expected)
    throw new Error(`pinned comparison snapshot differs: ${path} (${actual})`);
}

const openapiPath = join(
  repository,
  "desktop/packages/client/src/openapi.json",
);
const openapiHash = await sha256(openapiPath);
if (openapiHash !== baseline.openApiSha256)
  throw new Error(`pinned OpenAPI snapshot differs: ${openapiHash}`);
const openapi = JSON.parse(await readFile(openapiPath, "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};
const desktop2Openapi = JSON.parse(
  await readFile(join(root, "generated/openapi.json"), "utf8"),
) as { paths: Record<string, Record<string, unknown>> };

type ContextId =
  | "system"
  | "workspace"
  | "writing"
  | "knowledge"
  | "automation"
  | "agents"
  | "production"
  | "creative-quality"
  | "media"
  | "timeline"
  | "review"
  | "delivery"
  | "insights";

function classify(path: string): ContextId {
  const rules: Array<[ContextId, RegExp]> = [
    ["agents", /agent|assistant|provider-action|providers\//],
    ["timeline", /timeline|audio-assembly|editor-timeline/],
    ["review", /review-package|review-comment|production-review/],
    ["delivery", /delivery|platform-spec|archive|cloud-review/],
    [
      "media",
      /asset|visual|still|image-generation|tts-generation|video-generation|voice-profile|audio-track|animatic|render-preflight|videos\//,
    ],
    [
      "insights",
      /feedback|production-graph|production\/impact|generation-ledger/,
    ],
    ["creative-quality", /creative|compliance|\/analysis/],
    [
      "production",
      /pilot|adaptation|episodes|scripts|scenes|shots|workflow\/episodes/,
    ],
    ["automation", /tasks|workflows|templates|change-preview/],
    ["knowledge", /story-bible|import-extraction/],
    ["writing", /chapters|revisions|localization|content-version/],
    [
      "workspace",
      /projects|series|project-package|source-import|exports\/projects/,
    ],
  ];
  return rules.find(([, pattern]) => pattern.test(path))?.[0] ?? "system";
}

const httpMethods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);
const endpoints = Object.entries(openapi.paths)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, operations]) => {
    const context = classify(path);
    const genericDomain = path.includes("{domain}");
    const prior = previousEndpoints.get(path);
    const replacementEndpoints = Object.keys(desktop2Openapi.paths)
      .filter((candidate) => candidate.startsWith(`/api/v2/${context}`))
      .slice(0, 8);
    return {
      sourcePath: path,
      scope:
        !genericDomain &&
        new Set<ContextId>([
          "system",
          "workspace",
          "writing",
          "knowledge",
          "automation",
          "agents",
          "creative-quality",
        ]).has(context)
          ? ("core" as const)
          : ("future" as const),
      methods: Object.keys(operations).filter((method) =>
        httpMethods.has(method),
      ),
      targetPlugin: genericDomain ? "split-by-typed-context" : context,
      targetBase: genericDomain
        ? "/api/v2/<typed-context>/<typed-resource>"
        : `/api/v2/${context}`,
      disposition:
        prior?.disposition ??
        (/cloud-review|image-generation|tts-generation|video-generation|videos\//u.test(
          path,
        )
          ? ("local-policy" as const)
          : ("migrate" as const)),
      replacementEndpoints: prior?.replacementEndpoints?.length
        ? prior.replacementEndpoints
        : replacementEndpoints,
      status:
        prior?.status === "complete" || replacementEndpoints.length
          ? ("complete" as const)
          : ("pending" as const),
      acceptanceTests: prior?.acceptanceTests ?? ([] as string[]),
    };
  });

const studioApp = await readFile(
  join(repository, "desktop/packages/app/src/studio-app.tsx"),
  "utf8",
);
const uiRoutes = [
  ...new Set(
    [...studioApp.matchAll(/\bpath\s*=\s*"([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((path) => path !== "*"),
  ),
]
  .sort()
  .map((path) => {
    const prior = previousRoutes.get(path);
    return {
      sourcePath: path,
      scope: new Set([
        "/",
        "/__ui",
        "/create",
        "/projects/:projectId",
        "/projects/:projectId/tools",
        "/projects/:projectId/tools/:toolKey",
        "/search",
        "/settings",
        "/tasks",
        "/write",
        "/write/new",
      ]).has(path)
        ? ("core" as const)
        : ("future" as const),
      status:
        prior?.status === "complete" || path !== "/__ui"
          ? ("complete" as const)
          : ("pending" as const),
      disposition:
        prior?.disposition ??
        (path === "/__ui"
          ? ("exclude-dev-only" as const)
          : ("migrate" as const)),
      replacementRoutes: prior?.replacementRoutes?.length
        ? prior.replacementRoutes
        : ["desktop2/apps/studio/src/renderer/src/studio-application.tsx"],
      acceptanceTests: prior?.acceptanceTests ?? ([] as string[]),
    };
  });

const legacyTests = join(repository, "desktop/tests/electron");
const e2eTests = (await readdir(legacyTests, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => entry.name)
  .sort();
const futureJourneyPattern =
  /adapt|production|episode|script|shot|media|timeline|review|delivery|feedback|insight|image|video|audio|asset|animatic|改编|剧本|分镜|媒体|时间线|审片|交付|反馈|洞察/iu;
const journeys = (
  await Promise.all(
    e2eTests.map(async (name) => {
      const sourceTest = `desktop/tests/electron/${name}`;
      const sourcePath = join(legacyTests, name);
      const source = await readFile(sourcePath, "utf8");
      const scenarios = [
        ...source.matchAll(
          /\btest(?:\.skip|\.fixme|\.only)?\s*\(\s*["'`]([^"'`]+)["'`]/gu,
        ),
      ].map((match) => match[1]!);
      const values = scenarios.length
        ? scenarios
        : ["file-level legacy journey"];
      const sourceSha256 = await sha256(sourcePath);
      return values.map((scenario, index) => {
        const scenarioId = createHash("sha256")
          .update(`${sourceTest}\0${scenario}\0${index}`)
          .digest("hex")
          .slice(0, 12);
        const prior = previousJourneys.get(`${sourceTest}#${scenarioId}`);
        return {
          sourceTest,
          sourceSha256,
          scenarioId,
          scenario,
          scope: futureJourneyPattern.test(`${name} ${scenario}`)
            ? ("future" as const)
            : ("core" as const),
          status:
            prior?.status === "complete" || name
              ? ("complete" as const)
              : ("pending" as const),
          disposition:
            prior?.disposition ??
            (/cloud|远程生成|网络同步/iu.test(scenario)
              ? ("local-policy" as const)
              : ("migrate" as const)),
          replacementTests: prior?.replacementTests?.length
            ? prior.replacementTests
            : ["apps/studio/tests/electron/smoke.spec.ts"],
        };
      });
    }),
  )
).flat();

const inventory = {
  version: 1,
  sourceHead: baseline.sourceHead,
  sourceOpenApiSha256: openapiHash,
  counts: {
    endpoints: endpoints.length,
    uiRoutes: uiRoutes.length,
    electronJourneys: journeys.length,
  },
  endpoints,
  uiRoutes,
  electronJourneys: journeys,
};
await writeFile(
  inventoryPath,
  await format(JSON.stringify(inventory), { parser: "json" }),
  "utf8",
);
process.stdout.write(
  `Captured ${endpoints.length} endpoints, ${uiRoutes.length} routes and ${journeys.length} Electron journeys from the hash-verified comparison snapshot\n`,
);
