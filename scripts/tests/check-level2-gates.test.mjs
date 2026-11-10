import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import {
  findBareNameViolations,
  findDomainUiViolations,
  findImportViolations,
  findKernelImportViolations,
  findLaunchViolations,
  findOwnershipViolations,
  findRemoteArityViolations,
  level2Violations,
  readPluginPackages,
} from "../check-level2-gates.mjs";

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "dramaip-level2-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return root;
}

const manifest = (name, extra = {}) => ({ name, type: "module", ...extra });

function ownership(files) {
  return findOwnershipViolations(readPluginPackages(fixture(files)));
}

function imports(files) {
  return findImportViolations(readPluginPackages(fixture(files)));
}

test("accepts the repository tree", () => {
  assert.deepEqual(level2Violations(), {
    ownership: [],
    imports: [],
    names: [],
    launch: [],
    kernel: [],
    ui: [],
    arity: [],
  });
});

const arityTree = (call) => ({
  "packages/system/alpha/package.json": manifest("@dramaip/system-alpha"),
  "packages/system/alpha/src/index.ts": [
    "export default class AlphaController extends TypertRemoteService {",
    '  constructor(ctx) { super(ctx, "alphaController", { namespace: "alpha" }); }',
    "  @Remote list(query?: Query) { return []; }",
    "  @Remote create(input: Input, ifMatch?: string, idempotencyKey?: string) {}",
    "  @Remote watch(id: string, signal: AbortSignal) {}",
    "  helper(a, b) {}",
    "}",
  ].join("\n"),
  "packages/system/alpha-client/package.json": manifest(
    "@dramaip/system-alpha-client",
    { dramaip: { client: { platform: "web" } } },
  ),
  "packages/system/alpha-client/src/client/use.ts": call,
});

test("arity: rejects a client call that drops an optional Remote argument", () => {
  const path = "packages/system/alpha-client/src/client/use.ts";
  assert.deepEqual(
    findRemoteArityViolations(
      readPluginPackages(
        fixture(
          arityTree(
            [
              "alpha.list();",
              "ctx.remote.alpha.create(input);",
              "alpha.watch();",
            ].join("\n"),
          ),
        ),
      ),
    ),
    [
      `${path}:1: alpha.list takes 1 argument(s), got 0; pass every optional one as undefined`,
      `${path}:2: alpha.create takes 3 argument(s), got 1; pass every optional one as undefined`,
      `${path}:3: alpha.watch takes 1 argument(s) plus an optional AbortSignal, got 0; pass every optional one as undefined`,
    ],
  );
});

test("arity: accepts exact calls, a trailing signal, spreads and non-Remote methods", () => {
  assert.deepEqual(
    findRemoteArityViolations(
      readPluginPackages(
        fixture(
          arityTree(
            [
              "alpha.list(undefined);",
              "alpha.create(input, undefined, key);",
              "alpha.watch(id);",
              "alpha.watch(id, signal);",
              "alpha.create(...args);",
              "alpha.helper(1);",
              "other.list();",
            ].join("\n"),
          ),
        ),
      ),
    ),
    [],
  );
});

test("ui: rejects a domain client off the Slots, CSS Modules and locale stack", () => {
  const root = fixture({
    "packages/system/alpha-client/package.json": manifest(
      "@dramaip/system-alpha-client",
      {
        dramaip: { client: { platform: "web" } },
        dependencies: { zustand: "^4.5.5", "radix-ui": "^1.8.1" },
      },
    ),
    "packages/system/alpha-client/src/client/Page.module.css": [
      "/* #fff in a comment is fine */",
      ".title { color: #fff; }",
      ".hint { color: rgb(0 0 0 / 40%); }",
      ":global(.dark) .title { color: var(--dsw-alias-label-primary); }",
    ].join("\n"),
    "packages/system/alpha-client/src/client/Page.tsx": [
      'import { create } from "zustand";',
      'import { useQuery } from "@tanstack/react-query";',
      'import * as Dialog from "@radix-ui/react-dialog";',
      'import "./page.css";',
      'import css from "./Page.module.css";',
      "export const Page = ({ t }) => (",
      '  <div className="p-4"><h1 className={css.title}>{t("title")}</h1>',
      '    <p title="Hint" aria-label={t("label")}>设置</p></div>',
      ");",
    ].join("\n"),
  });
  const page = "packages/system/alpha-client/src/client/Page.tsx";
  const styles = "packages/system/alpha-client/src/client/Page.module.css";
  assert.deepEqual(findDomainUiViolations(root), [
    "packages/system/alpha-client/package.json: @dramaip/system-alpha-client lists zustand in dependencies",
    "packages/system/alpha-client/package.json: @dramaip/system-alpha-client lists radix-ui in dependencies",
    `${page}:1: imports zustand`,
    `${page}:2: imports @tanstack/react-query`,
    `${page}:3: imports @radix-ui/react-dialog`,
    `${page}:4: imports the global stylesheet ./page.css; use a CSS Module`,
    `${page}:7: className "p-4"; use a CSS Module class`,
    `${page}:8: title "Hint"; take copy from the locale dictionary`,
    `${page}:8: JSX text "设置"; take copy from the locale dictionary`,
    `${styles}:2: color literal; read a --dsw-* theme token`,
    `${styles}:3: color literal; read a --dsw-* theme token`,
    `${styles}:4: theme selector; the theme component switches the tokens`,
  ]);
});

test("ui: accepts Slots, CSS Modules and dictionary copy, and skips non-client domain packages", () => {
  const root = fixture({
    "packages/system/alpha-client/package.json": manifest(
      "@dramaip/system-alpha-client",
      { dramaip: { client: { platform: "web" } } },
    ),
    "packages/system/alpha-client/src/client/Page.module.css": [
      ".nav { color: var(--dsw-alias-label-primary); background: transparent; }",
      ".nav:hover { background: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 60%, transparent); }",
    ].join("\n"),
    "packages/system/alpha-client/src/client/Page.tsx": [
      'import css from "./Page.module.css";',
      "export const Page = ({ t, renderSlot }) => (",
      '  <nav className={css.nav} aria-label={t("nav")}>',
      '    {renderSlot("alpha.item", {})} {t("title")}',
      "  </nav>",
      ");",
    ].join("\n"),
    "packages/system/alpha/package.json": manifest("@dramaip/system-alpha"),
    "packages/system/alpha/src/index.ts": 'import "./reset.css";',
  });
  assert.deepEqual(findDomainUiViolations(root), []);
});

test("kernel: rejects a business plugin that depends on or imports the Kernel", () => {
  const root = fixture({
    "packages/writing/alpha/package.json": manifest("@dramaip/writing-alpha", {
      dependencies: { "@dramaip/kernel": "workspace:*" },
    }),
    "packages/writing/alpha/handlers/alpha/index.ts":
      "import { bootKernel } from '@dramaip/kernel'\nexport { bootKernel }\n",
    "packages/writing/beta/package.json": manifest("@dramaip/writing-beta"),
    "packages/writing/beta/handlers/beta/index.ts":
      "export * from '../../../../../packages/kernel/src/index'\n",
    "packages/compat/gamma/package.json": manifest("@dramaip/compat-gamma"),
    "packages/compat/gamma/src/index.ts":
      "const kernel = await import('@dramaip/kernel/internal')\n",
    "packages/writing/delta/package.json": manifest("@dramaip/writing-delta"),
    "packages/writing/delta/handlers/delta/index.ts":
      "import { definePlugin } from '@dramaip/plugin-api'\n",
  });
  assert.deepEqual(findKernelImportViolations(root), [
    "packages/compat/gamma/src/index.ts: imports the Kernel (@dramaip/kernel/internal)",
    "packages/writing/alpha/package.json: @dramaip/writing-alpha lists @dramaip/kernel in dependencies",
    "packages/writing/alpha/handlers/alpha/index.ts: imports the Kernel (@dramaip/kernel)",
    "packages/writing/beta/handlers/beta/index.ts: imports the Kernel (../../../../../packages/kernel/src/index)",
  ]);
});

test("ownership: rejects a route claimed by two packages, through a constant or a literal", () => {
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/index.ts":
        "const ROUTE = '/files'\nctx.webServer.register({ kind: 'prefix', path: ROUTE, handler })\n",
      "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
      "packages/infra/beta/src/index.ts":
        "ctx.webServer.register({ kind: 'exact', path: '/files', handler })\n",
    }),
    [
      "route /files has 2 owners: @dramaip/infra-alpha (packages/infra/alpha/src/index.ts), @dramaip/infra-beta (packages/infra/beta/src/index.ts)",
    ],
  );
});

test("ownership: a carrier passing a caller's path through is not a claim", () => {
  assert.deepEqual(
    ownership({
      "packages/infra/carrier/package.json": manifest("@dramaip/infra-carrier"),
      "packages/infra/carrier/src/index.ts":
        "export function serve(channel: string) { return { kind: 'prefix', path: channel, handler } }\n",
      "packages/infra/user/package.json": manifest("@dramaip/infra-user"),
      "packages/infra/user/src/index.ts":
        "ctx.webServer.register({ kind: 'prefix', path: '/rpc', handler })\n",
    }),
    [],
  );
});

test("ownership: rejects a Remote namespace two services claim, by option or by service key", () => {
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/index.ts":
        "export class A extends TypertRemoteService { constructor(ctx) { super(ctx, 'alphaController', { namespace: 'notes' }) } }\n",
      "packages/testing/beta/package.json": manifest("@dramaip/test-beta"),
      "packages/testing/beta/src/index.ts":
        "export class B extends TypertRemoteService { constructor(ctx) { super(ctx, 'notes') } }\n",
    }),
    [
      "Remote namespace notes has 2 owners: @dramaip/infra-alpha (packages/infra/alpha/src/index.ts), @dramaip/test-beta (packages/testing/beta/src/index.ts)",
    ],
  );
});

test("ownership: rejects an upgrade route two packages claim", () => {
  const route =
    "const route: WebUpgradeRoute = { path: '/api/stream', handler }\n";
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/index.ts": route,
      "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
      "packages/infra/beta/src/index.ts": route,
    }),
    [
      "upgrade route /api/stream has 2 owners: @dramaip/infra-alpha (packages/infra/alpha/src/index.ts), @dramaip/infra-beta (packages/infra/beta/src/index.ts)",
    ],
  );
});

test("ownership: rejects a storage domain two packages define", () => {
  const domain =
    "export const Notes = defineDomain({ name: 'notes', tables: {} })\n";
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/domain.ts": domain,
      "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
      "packages/infra/beta/src/domain.ts": domain,
    }),
    [
      "storage domain notes has 2 owners: @dramaip/infra-alpha (packages/infra/alpha/src/domain.ts), @dramaip/infra-beta (packages/infra/beta/src/domain.ts)",
    ],
  );
});

test("ownership: rejects a Slot contribution id two packages register under one Slot", () => {
  const slot =
    "ctx.slots.register({ name: 'settings.general.item', id: 'theme' }, Panel)\n";
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/client/index.tsx": slot,
      "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
      "packages/infra/beta/src/client/index.tsx": slot,
      "packages/infra/gamma/package.json": manifest("@dramaip/infra-gamma"),
      "packages/infra/gamma/src/client/index.tsx":
        "ctx.slots.register({ name: 'settings.general.item', id: 'locale' }, Panel)\n",
    }),
    [
      "Slot contribution settings.general.item#theme has 2 owners: @dramaip/infra-alpha (packages/infra/alpha/src/client/index.tsx), @dramaip/infra-beta (packages/infra/beta/src/client/index.tsx)",
    ],
  );
});

test("ownership: tells keyed Slot entries apart by their key", () => {
  const route = (key) =>
    `ctx.slots.register({ name: 'studio.route', key: '${key}' }, Page)\n`;
  assert.deepEqual(
    ownership({
      "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
      "packages/infra/alpha/src/client/index.tsx": route("/settings"),
      "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
      "packages/infra/beta/src/client/index.tsx": route("/insights"),
      "packages/infra/gamma/package.json": manifest("@dramaip/infra-gamma"),
      "packages/infra/gamma/src/client/index.tsx": route("/insights"),
    }),
    [
      "Slot contribution studio.route#/insights has 2 owners: @dramaip/infra-beta (packages/infra/beta/src/client/index.tsx), @dramaip/infra-gamma (packages/infra/gamma/src/client/index.tsx)",
    ],
  );
});

const siblings = {
  "packages/infra/alpha/package.json": manifest("@dramaip/infra-alpha"),
  "packages/infra/beta/package.json": manifest("@dramaip/infra-beta"),
  "packages/infra/beta/src/index.ts":
    "export const Notes = defineDomain({ name: 'notes', tables: {} })\n",
};

test("imports: accepts public exports and a package's own domain", () => {
  assert.deepEqual(
    imports({
      ...siblings,
      "packages/infra/alpha/src/index.ts": [
        "import { NotesClient } from '@dramaip/infra-beta/client'",
        "import type { Note } from '@dramaip/infra-beta'",
        "import { Own } from './domain.ts'",
        "await ctx.storage.domain.open(Own)",
      ].join("\n"),
    }),
    [],
  );
});

test("imports: rejects a sibling's src, lib or tests subpath", () => {
  assert.deepEqual(
    imports({
      ...siblings,
      "packages/infra/alpha/src/index.ts": [
        "import { store } from '@dramaip/infra-beta/src/store.ts'",
        "export * from '@dramaip/infra-beta/lib/index.js'",
        "const fixture = await import('@dramaip/infra-beta/tests/fixture.ts')",
      ].join("\n"),
    }),
    [
      "packages/infra/alpha/src/index.ts: imports the implementation of sibling package @dramaip/infra-beta (@dramaip/infra-beta/src/store.ts)",
      "packages/infra/alpha/src/index.ts: imports the implementation of sibling package @dramaip/infra-beta (@dramaip/infra-beta/lib/index.js)",
      "packages/infra/alpha/src/index.ts: imports the implementation of sibling package @dramaip/infra-beta (@dramaip/infra-beta/tests/fixture.ts)",
    ],
  );
});

test("imports: rejects a relative path that leaves the package", () => {
  assert.deepEqual(
    imports({
      ...siblings,
      "packages/infra/alpha/src/index.ts":
        "import { store } from '../../beta/src/index.ts'\n",
    }),
    [
      "packages/infra/alpha/src/index.ts: relative import ../../beta/src/index.ts leaves package @dramaip/infra-alpha",
    ],
  );
});

test("imports: rejects opening another package's storage domain", () => {
  assert.deepEqual(
    imports({
      ...siblings,
      "packages/infra/alpha/src/index.ts": [
        "import { Notes } from '@dramaip/infra-beta'",
        "import * as Beta from '@dramaip/infra-beta'",
        "await ctx.storage.domain.open(Notes)",
        "await ctx.storageDomain.open(Beta.Notes)",
      ].join("\n"),
    }),
    [
      "packages/infra/alpha/src/index.ts: opens storage domain Notes owned by @dramaip/infra-beta; write through the owner's service",
      "packages/infra/alpha/src/index.ts: opens storage domain Beta.Notes owned by @dramaip/infra-beta; write through the owner's service",
    ],
  );
});

const bundle = (dependencies) =>
  manifest("@dramaip/boot-bundle-demo", {
    dependencies,
    dramaip: { bundle: { patch: "./cordis.patch.yml" } },
  });
const patch = [
  "- insert:",
  "    - id: demo",
  "      name: '@dramaip/boot-bundle-demo/startup'",
  "    - id: notes",
  "      name: '@dramaip/infra-notes'",
  "      disabled: !!js \"!ctx.get('profileContext')\"",
  "      config:",
  "        name: not-a-plugin",
  "",
].join("\n");

test("names: accepts bundle rows its manifest declares, its own entries and config data", () => {
  const root = fixture({
    "packages/boot/bundle-demo/package.json": bundle({
      "@dramaip/infra-notes": "workspace:*",
    }),
    "packages/boot/bundle-demo/cordis.patch.yml": patch,
  });
  assert.deepEqual(findBareNameViolations(root), []);
});

test("names: rejects a bundle row whose package is not a bundle dependency", () => {
  const root = fixture({
    "packages/boot/bundle-demo/package.json": bundle({}),
    "packages/boot/bundle-demo/cordis.patch.yml": patch,
  });
  assert.deepEqual(findBareNameViolations(root), [
    "packages/boot/bundle-demo/cordis.patch.yml: @dramaip/infra-notes must be declared in packages/boot/bundle-demo/package.json dependencies",
  ]);
});

test("names: rejects a Profile template bundle the launcher does not depend on", () => {
  const root = fixture({
    "apps/cli/package.json": manifest("@dramaip/cli", {
      dependencies: { "@dramaip/boot-bundle-base": "workspace:*" },
    }),
    "packages/infra/app-boot/src/profile.ts": [
      "export const PROFILE_TEMPLATES = { web: { bundles: ['@dramaip/boot-bundle-base', '@dramaip/boot-bundle-web'] } }",
      "export const DEFAULT_PROFILE_BUNDLES = ['@dramaip/boot-bundle-base']",
      "export const OPTIONAL_BUNDLES = ['@dramaip/optional-bundle']",
    ].join("\n"),
  });
  assert.deepEqual(findBareNameViolations(root), [
    "packages/infra/app-boot/src/profile.ts: Profile bundle @dramaip/boot-bundle-web must be declared in apps/cli/package.json dependencies",
    "packages/infra/app-boot/src/profile.ts: Profile bundle @dramaip/optional-bundle must be declared in apps/cli/package.json dependencies",
  ]);
});

function launch(files, table) {
  return findLaunchViolations(fixture(files), table);
}

test("launch: accepts a classified launcher, wrapper and legacy entry", () => {
  assert.deepEqual(
    launch(
      {
        "package.json": {
          scripts: {
            dramaip: "pnpm --filter @dramaip/cli run dramaip",
            "dev:web": "node scripts/dev-web.mjs",
            "test:runtime":
              "node --import tsx packages/database/src/worker.integration.ts",
            serve: "node scripts/runtime-supervisor.mjs",
          },
        },
        "scripts/dev-web.mjs":
          "spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/bin.ts'])\n",
      },
      {
        scripts: {
          dramaip: "launcher",
          "dev:web": { category: "launcher", wrapper: "scripts/dev-web.mjs" },
          "test:runtime": "test",
          serve: { category: "legacy-application", until: "P6" },
        },
      },
    ),
    [],
  );
});

test("launch: rejects an unclassified root script and a stale table entry", () => {
  assert.deepEqual(
    launch(
      { "package.json": { scripts: { "demo:new-app": "node demo.mjs" } } },
      { scripts: { gone: "build" } },
    ),
    [
      "architecture/launch-entries.json scripts.gone: no such root script",
      "package.json scripts.demo:new-app: root script has no launch category",
    ],
  );
});

test("launch: rejects a script that starts a package entry instead of the launcher", () => {
  assert.deepEqual(
    launch(
      {
        "package.json": {
          scripts: {
            "start:web": "node packages/infra/app-boot/src/index.ts web",
            "check:thing":
              "node --import tsx packages/boot/bundle-headless/src/index.ts",
          },
        },
      },
      { scripts: { "start:web": "launcher", "check:thing": "check" } },
    ),
    [
      "package.json scripts.check:thing: runs package entry packages/boot/bundle-headless/src/index.ts directly; applications start through the dramaip launcher",
      "package.json scripts.start:web: runs package entry packages/infra/app-boot/src/index.ts directly; applications start through the dramaip launcher",
      "package.json scripts.start:web: launcher script must start apps/cli/src/bin.ts",
    ],
  );
});

test("launch: rejects a launcher wrapper that bypasses the launcher", () => {
  assert.deepEqual(
    launch(
      {
        "package.json": { scripts: { "dev:web": "node scripts/dev-web.mjs" } },
        "scripts/dev-web.mjs":
          "spawn('node', ['packages/infra/web-runtime/src/index.ts'])\n",
      },
      {
        scripts: {
          "dev:web": { category: "launcher", wrapper: "scripts/dev-web.mjs" },
        },
      },
    ),
    [
      "scripts/dev-web.mjs: runs package entry packages/infra/web-runtime/src/index.ts directly; applications start through the dramaip launcher",
      "package.json scripts.dev:web: launcher script must start apps/cli/src/bin.ts",
    ],
  );
});

test("launch: rejects an unknown category and a legacy entry without a removal phase", () => {
  assert.deepEqual(
    launch(
      {
        "package.json": {
          scripts: {
            dev: "pnpm run dev:prepare",
            tool: "node scripts/tool.mjs",
          },
        },
      },
      { scripts: { dev: "legacy-application", tool: "utility" } },
    ),
    [
      'package.json scripts.dev: legacy-application entries name the phase that removes them ("until")',
      'package.json scripts.tool: unknown launch category "utility"',
    ],
  );
});

test("launch: rejects an unclassified package bin and a changed classified bin", () => {
  assert.deepEqual(
    launch(
      {
        "packages/infra/app/package.json": manifest("@dramaip/infra-app", {
          bin: { app: "./bin.mjs" },
        }),
        "packages/runtime/package.json": manifest("@dramaip/runtime", {
          bin: { dramaip: "./bin/other.mjs" },
        }),
      },
      {
        bins: {
          "packages/runtime/package.json": {
            bin: { dramaip: "./bin/dramaip.mjs" },
            category: "legacy-application",
            until: "P6",
          },
        },
      },
    ),
    [
      "packages/infra/app/package.json: package bin has no launch category; applications start through the dramaip launcher",
      'packages/runtime/package.json: classified bin must remain {"dramaip":"./bin/dramaip.mjs"}, got {"dramaip":"./bin/other.mjs"}',
    ],
  );
});

test("launch: rejects an unclassified executable source", () => {
  assert.deepEqual(
    launch(
      {
        "apps/cli/src/bin.ts": "#!/usr/bin/env node\n",
        "packages/testing/rogue/src/bin.ts": "#!/usr/bin/env node\n",
        "rogue.mjs": "#!/usr/bin/env node\n",
      },
      { executables: { "apps/cli/src/bin.ts": "launcher" } },
    ),
    [
      "packages/testing/rogue/src/bin.ts: executable source has no launch category",
      "rogue.mjs: executable source has no launch category",
    ],
  );
});
