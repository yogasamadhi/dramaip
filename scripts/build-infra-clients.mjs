// Builds the browser bundle `lib/client.js` of every package that declares
// `dramaip.client.platform: "web"`, in the artifact format the module system
// loads (adapted from DSH `packages/client/tsdown.client.ts`, MIT):
//
// - one CommonJS factory registered through
//   `window.__ModuleLoader__.load({ id, factory: (require) => ... })`, whose
//   `require` answers from the loader module table;
// - the platform modules, the preloaded externals and the package's own
//   `dramaip.client.external` stay `require` calls; everything else inlines;
// - a value import of another `@dramaip/*` package fails the build unless it
//   is an inline-safe wire layer or a generated `/remote` contribution, since
//   an inlined copy would duplicate that package's runtime identity;
// - `x.module.css` yields its hashed class map and injects a tagged style when
//   the factory runs, a plain `.css` import only injects, and `x.css?inline`
//   exports the compiled text; SVG, PNG and WebP imports become data URLs;
// - a transitional package (`dramaip.transitional`) may list pre-refactor
//   packages in `dramaip.client.inline`: it inlines them whole, since no other
//   client imports them.
//
// The Typert generator runs first: a generated `/remote` contribution is
// bundled from `lib/typert.remote-client.js`.
//
//   node scripts/build-infra-clients.mjs [package-name...]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform as transformJavaScript } from "esbuild";
import { transform } from "lightningcss";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = process.env.DRAMAIP_RELEASE === "1";

/** Shell-seeded module specifiers (`client-web/src/platform.ts`), read as data so this stays a Node script. */
function platformModules() {
  const source = readFileSync(
    join(desktop, "packages/infra/client-web/src/platform.ts"),
    "utf8",
  );
  const list = (name) => {
    const body = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`, "u").exec(
      source,
    );
    if (body === null)
      throw new Error(`client-web platform.ts declares no ${name}`);
    return [...body[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  };
  return [...list("PLATFORM_MODULES"), ...list("PRELOADED_CLIENT_EXTERNALS")];
}

/** Contract layers and pure folds a bundle may inline: browser-safe values with no runtime identity to share. */
const INLINE_SAFE =
  /^@dramaip\/(?:infra-(?:brand|deque|typert-protocol|util-crypto|values|workspace-path)|contracts)(?:\/|$)/u;

/** Generated descriptor/codec contribution or legacy route table, with no shared runtime identity. */
const GENERATED_REMOTE =
  /^@dramaip\/(?:infra|test|system|insights|production|workspace|writing|agents|automation)-[a-z0-9]+(?:-[a-z0-9]+)*\/(?:remote|legacy)$/u;

const IMAGE_MEDIA_TYPES = new Map([
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function clientPackages() {
  const groups = [
    "packages/infra",
    "packages/boot",
    "packages/compat",
    "packages/system",
    "packages/insights",
    "packages/production",
    "packages/workspace",
    "packages/writing",
    "packages/agents",
    "packages/automation",
    "packages/testing",
  ].map((group) => join(desktop, group));
  return groups
    .flatMap((group) => readdirSync(group).map((name) => join(group, name)))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    }))
    .filter(({ manifest }) => manifest.dramaip?.client?.platform === "web")
    .filter(({ dir }) => existsSync(join(dir, "src/client/index.ts")));
}

/** The directory of the package that owns `file`. */
function owningPackage(file) {
  let dir = dirname(file);
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir)
    dir = dirname(dir);
  return dir;
}

/**
 * Emit one plugin-owned style injector and an optional CSS Modules export.
 * The tag id carries the stylesheet's path in its package, since one package
 * can hold several stylesheets of the same name and the injector skips an id
 * already in the head.
 */
function styleInjectionModule(id, file, css, classMap) {
  const name = relative(owningPackage(file), file).split("\\").join("/");
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${name}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    "  tag.dataset.pluginCss = tagId;",
    "  tag.textContent = css;",
    "  document.head.appendChild(tag);",
    "}",
    classMap === undefined
      ? "export {};"
      : `export default ${JSON.stringify(classMap)};`,
  ].join("\n");
}

function compileCss(file, code, cssModules) {
  return transform({
    filename: file,
    code,
    minify: true,
    ...(cssModules ? { cssModules: { pattern: "[hash]_[local]" } } : {}),
  });
}

/** The esbuild plugin carrying the module-table, purity and asset rules for one package. */
function clientRules(id, requested, inline) {
  return {
    name: "dramaip-client-rules",
    setup(builder) {
      if (release)
        builder.onLoad(
          { filter: /[/\\]lib[/\\]typert\.(?:host|remote-client)\.js$/ },
          async ({ path }) => {
            // Compact private generated factory names before the outer build retains
            // component/service names. Public exports and descriptor keys stay intact.
            const { code } = await transformJavaScript(
              await readFile(path, "utf8"),
              {
                loader: "js",
                target: "es2022",
                minify: true,
                legalComments: "eof",
              },
            );
            return { contents: code, loader: "js", resolveDir: dirname(path) };
          },
        );
      builder.onResolve({ filter: /^[^./]/ }, (args) => {
        if (args.kind === "entry-point") return null;
        if (requested.has(args.path))
          return { path: args.path, external: true };
        if (!args.path.startsWith("@dramaip/")) return null;
        if (INLINE_SAFE.test(args.path) || GENERATED_REMOTE.test(args.path))
          return null;
        if (
          inline.some(
            (name) => args.path === name || args.path.startsWith(`${name}/`),
          )
        )
          return null;
        return {
          errors: [
            {
              text:
                `client bundle purity: "${args.path}" is not a platform module, one of ${id}'s ` +
                "dramaip.client.external entries, an inline-safe wire layer, or a generated /remote contribution; " +
                "collaborate through Cordis services instead (type-only imports are erased and never reach this check)",
            },
          ],
        };
      });
      builder.onResolve({ filter: /\.css(?:\?inline)?$/ }, (args) => {
        const inline = args.path.endsWith("?inline");
        const specifier = inline
          ? args.path.slice(0, -"?inline".length)
          : args.path;
        // A bare specifier names a package's exported stylesheet.
        const path = /^[./]/u.test(specifier)
          ? resolve(args.resolveDir, specifier)
          : createRequire(join(args.resolveDir, "index.js")).resolve(specifier);
        const namespace = inline
          ? "css-text"
          : path.endsWith(".module.css")
            ? "css-module"
            : "css-global";
        return { path, namespace };
      });
      builder.onLoad(
        { filter: /.*/, namespace: "css-module" },
        async (args) => {
          const { code, exports } = compileCss(
            args.path,
            await readFile(args.path),
            true,
          );
          const classMap = Object.fromEntries(
            Object.entries(exports ?? {})
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              // A class's `composes` list joins its name, local ones by
              // their hashed name and `from global` ones as written.
              .map(([local, value]) => [
                local,
                [
                  value.name,
                  ...(value.composes ?? []).map((item) => item.name),
                ].join(" "),
              ]),
          );
          return {
            contents: styleInjectionModule(
              id,
              args.path,
              code.toString(),
              classMap,
            ),
            loader: "js",
            resolveDir: dirname(args.path),
            watchFiles: [args.path],
          };
        },
      );
      builder.onLoad(
        { filter: /.*/, namespace: "css-global" },
        async (args) => {
          const { code } = compileCss(
            args.path,
            await readFile(args.path),
            false,
          );
          return {
            contents: styleInjectionModule(id, args.path, code.toString()),
            loader: "js",
            watchFiles: [args.path],
          };
        },
      );
      builder.onLoad({ filter: /.*/, namespace: "css-text" }, async (args) => {
        const { code } = compileCss(
          args.path,
          await readFile(args.path),
          false,
        );
        return {
          contents: `export default ${JSON.stringify(code.toString())};`,
          loader: "js",
          watchFiles: [args.path],
        };
      });
      builder.onLoad({ filter: /\.(?:svg|png|webp)$/ }, async (args) => {
        const mediaType = IMAGE_MEDIA_TYPES.get(
          args.path.slice(args.path.lastIndexOf(".")),
        );
        const data = await readFile(args.path);
        return {
          contents: `export default ${JSON.stringify(`data:${mediaType};base64,${data.toString("base64")}`)};`,
          loader: "js",
        };
      });
    },
  };
}

function defines() {
  const mode = process.env.NODE_ENV ?? "production";
  const values = {
    "process.env": "{}",
    "process.env.NODE_ENV": JSON.stringify(mode),
    "import.meta.env": JSON.stringify({ MODE: mode }),
    "import.meta.env.MODE": JSON.stringify(mode),
  };
  if (process.env.DRAMAIP_CLIENT_TITLE !== undefined) {
    values["process.env.DRAMAIP_CLIENT_TITLE"] = JSON.stringify(
      process.env.DRAMAIP_CLIENT_TITLE,
    );
  }
  return values;
}

async function buildPackage({ dir, manifest }, shared) {
  const id = manifest.name;
  const external = manifest.dramaip.client.external ?? [];
  if (
    !Array.isArray(external) ||
    !external.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`${id}: dramaip.client.external must be a string array`);
  }
  const requested = new Set([...shared, ...external]);
  const inline = manifest.dramaip.client.inline ?? [];
  if (
    !Array.isArray(inline) ||
    !inline.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`${id}: dramaip.client.inline must be a string array`);
  }
  if (inline.length > 0 && manifest.dramaip.transitional === undefined) {
    throw new Error(
      `${id}: dramaip.client.inline is reserved for transitional packages`,
    );
  }
  const mode = process.env.NODE_ENV ?? "production";
  await build({
    absWorkingDir: dir,
    entryPoints: { client: "src/client/index.ts" },
    outdir: "lib",
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    conditions: [
      mode === "development" ? "development" : "production",
      "browser",
      "import",
      "module",
      "default",
    ],
    mainFields: ["browser", "module", "main"],
    define: defines(),
    sourcemap: !release,
    sourcesContent: !release,
    minify: release,
    keepNames: release,
    logLevel: "warning",
    plugins: [clientRules(id, requested, inline)],
    banner: {
      js:
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n` +
        "var module = { exports: {} }; var exports = module.exports;",
    },
    footer: { js: "return module.exports; } });" },
  });
  return id;
}

const only = new Set(process.argv.slice(2));
const shared = platformModules();
const packages = clientPackages().filter(
  ({ manifest }) => only.size === 0 || only.has(manifest.name),
);
if (only.size > 0 && packages.length !== only.size) {
  const found = new Set(packages.map(({ manifest }) => manifest.name));
  throw new Error(
    `not a web client package: ${[...only].filter((name) => !found.has(name)).join(", ")}`,
  );
}
const results = await Promise.allSettled(
  packages.map((entry) => buildPackage(entry, shared)),
);
let failed = 0;
for (const [index, result] of results.entries()) {
  const name = packages[index].manifest.name;
  if (result.status === "fulfilled") {
    console.log(`built ${name} lib/client.js`);
  } else {
    failed += 1;
    console.error(
      `failed ${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
  }
}
process.exit(failed === 0 ? 0 : 1);
