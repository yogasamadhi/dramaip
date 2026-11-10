// Level 2 §10 architecture gates for the DSH-structured tree
// (REFACTOR_PLAN_DSH_LEVEL2 P1-b). Everything is read from source and
// manifests, so the gates pass or fail without booting a Profile:
//
//   ownership  every route, Remote namespace, storage domain and Slot
//              contribution has exactly one owning package
//   imports    a plugin package never imports a sibling's implementation
//              (a `src/`, `lib/` or `tests/` subpath, or a relative path that
//              leaves the package) and never opens another package's storage
//              domain
//   names      every bare plugin name in a bundle patch is a dependency of
//              that bundle; every bundle a shipped Profile template lists is
//              a dependency of the launcher
//   launch     every root script, package bin and executable source has an
//              explicit category in architecture/launch-entries.json, and no
//              Node application path bypasses the dramaip launcher
//   kernel     no business plugin, compat package or package of the new tree
//              depends on or imports the pre-refactor Kernel (P2)
//   ui         a domain client plugin (P4/P5, plan §4.7) builds on Slots, CSS
//              Modules, theme tokens and its locale dictionary: no Tailwind,
//              Radix/shadcn or cva (the control component owns them),
//              react-query or zustand, no global stylesheet, no literal class
//              names, no copy written into its JSX, and no color literal or
//              theme selector in its stylesheets
//   arity      a client plugin calls each generated Remote method with its
//              exact parameter count, as the Client enforces at runtime
//
// The launch and bare-name checks are adapted from the MIT DeepSeek Harness
// gates `scripts/verify-application-entrypoints.ts` and
// `scripts/verify-cordis-config.ts` (see THIRD_PARTY_NOTICES.md).
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Workspace groups holding the per-domain packages (P4/P5): one per domain. */
export const domainGroups = [
  "packages/system",
  "packages/insights",
  "packages/production",
  "packages/workspace",
  "packages/writing",
  "packages/agents",
  "packages/automation",
];

/** Workspace groups whose packages are plugins of the DSH-structured tree. */
export const pluginGroups = [
  "packages/infra",
  "packages/boot",
  ...domainGroups,
  "packages/testing",
];

/**
 * Packages in those groups that are not plugins and may assemble sibling
 * internals: the browser test harness boots the Client from its sources.
 */
export const nonPluginPackages = new Set(["@dramaip/infra-test-runtime"]);

const sourcePattern = /\.(?:[cm]?ts|tsx)$/u;
const nonSourcePattern =
  /(?:\.d\.ts|\.(?:test|spec|integration)\.[cm]?[jt]sx?)$/u;
const skipped = new Set([
  "node_modules",
  "lib",
  "dist",
  "out",
  "build",
  ".turbo",
  "coverage",
]);

const slash = (path) => path.split(sep).join("/");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A package without src/ contributes no sources.
    return [];
  }
  return entries
    .filter((entry) => !skipped.has(entry.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
}

/**
 * Reads every plugin package of the given groups with its `src/` sources.
 * @returns `[{ name, dir, manifest, sources: [{ path, file, source }] }]`,
 *   `path` root-relative and `/`-separated.
 */
export function readPluginPackages(root, groups = pluginGroups) {
  const packages = [];
  for (const group of groups) {
    for (const entry of safeEntries(join(root, group))) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, group, entry.name);
      const manifestPath = join(dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      // The Kernel-era handlers a Host face carries (`handlers/<id>`) are
      // its sources too.
      const sources = [
        ...walk(join(dir, "src")),
        ...walk(join(dir, "handlers")),
      ]
        .filter(
          (path) => sourcePattern.test(path) && !nonSourcePattern.test(path),
        )
        .sort()
        .map((path) => {
          const source = readFileSync(path, "utf8");
          const kind = path.endsWith("x")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS;
          return {
            path: slash(relative(root, path)),
            file: ts.createSourceFile(
              path,
              source,
              ts.ScriptTarget.Latest,
              true,
              kind,
            ),
          };
        });
      packages.push({
        name: manifest.name,
        dir: slash(relative(root, dir)),
        manifest,
        sources,
      });
    }
  }
  return packages;
}

function safeEntries(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    // A missing group holds no packages.
    return [];
  }
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function literalText(node) {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function property(object, name) {
  for (const element of object.properties) {
    if (ts.isPropertyAssignment(element) && element.name.getText() === name)
      return element.initializer;
    if (ts.isShorthandPropertyAssignment(element) && element.name.text === name)
      return element.name;
  }
  return undefined;
}

/**
 * String constants a package declares (`const NAME = 'literal'`), so a claim
 * written through a named constant resolves. A name bound to two different
 * literals in one package does not resolve.
 */
function packageConstants(pkg) {
  const values = new Map();
  for (const { file } of pkg.sources)
    visit(file, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name))
        return;
      const value = literalText(node.initializer);
      if (value === undefined) return;
      const previous = values.get(node.name.text);
      values.set(
        node.name.text,
        previous === undefined || previous === value ? value : null,
      );
    });
  return values;
}

/**
 * Ownership claims one package makes. A value the package cannot resolve to a
 * literal (a parameter a carrier passes through, such as a registration API's
 * own `path` argument) is mechanism, not a claim.
 * @returns `[{ kind, key, path }]`.
 */
export function ownershipClaims(pkg) {
  const constants = packageConstants(pkg);
  const resolveValue = (node) => {
    const literal = literalText(node);
    if (literal !== undefined) return literal;
    if (node !== undefined && ts.isIdentifier(node))
      return constants.get(node.text) ?? undefined;
    return undefined;
  };
  const claims = [];
  for (const { path, file } of pkg.sources)
    visit(file, (node) => {
      const claim = (kind, key) => {
        if (key !== undefined && key !== null) claims.push({ kind, key, path });
      };
      if (ts.isObjectLiteralExpression(node)) {
        const kind = literalText(property(node, "kind"));
        if (
          (kind === "exact" || kind === "prefix") &&
          property(node, "path") !== undefined
        )
          claim("route", resolveValue(property(node, "path")));
      }
      if (
        ts.isVariableDeclaration(node) &&
        node.type !== undefined &&
        node.type.getText() === "WebUpgradeRoute" &&
        node.initializer !== undefined &&
        ts.isObjectLiteralExpression(node.initializer)
      )
        claim(
          "upgrade route",
          resolveValue(property(node.initializer, "path")),
        );
      if (ts.isClassDeclaration(node) && extendsRemoteService(node)) {
        const call = superCall(node);
        if (call !== undefined) {
          const options = call.arguments[2];
          const namespace =
            options !== undefined && ts.isObjectLiteralExpression(options)
              ? resolveValue(property(options, "namespace"))
              : undefined;
          claim(
            "Remote namespace",
            namespace ?? resolveValue(call.arguments[1]),
          );
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const [first] = node.arguments;
        if (
          ts.isIdentifier(callee) &&
          callee.text === "defineDomain" &&
          first &&
          ts.isObjectLiteralExpression(first)
        )
          claim("storage domain", resolveValue(property(first, "name")));
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "register" &&
          /(?:^|\.)slots$/u.test(callee.expression.getText()) &&
          first &&
          ts.isObjectLiteralExpression(first)
        ) {
          const name = resolveValue(property(first, "name"));
          // A list entry is told apart by its `id`, a keyed entry by its `key`.
          const id = property(first, "id") ?? property(first, "key");
          const idValue = id === undefined ? "" : resolveValue(id);
          // A `priority` entry deliberately shadows a framework seat (the
          // Studio shell over ui-layout's root frame); it claims nothing.
          const shadows = property(first, "priority") !== undefined;
          if (name !== undefined && idValue !== undefined && !shadows)
            claim(
              "Slot contribution",
              idValue === "" ? name : `${name}#${idValue}`,
            );
        }
      }
    });
  return claims;
}

function extendsRemoteService(node) {
  return (node.heritageClauses ?? []).some(
    (clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword &&
      clause.types.some(
        (type) => type.expression.getText() === "TypertRemoteService",
      ),
  );
}

function superCall(node) {
  const constructor = node.members.find(ts.isConstructorDeclaration);
  let found;
  if (constructor?.body)
    visit(constructor.body, (child) => {
      if (
        found === undefined &&
        ts.isCallExpression(child) &&
        child.expression.kind === ts.SyntaxKind.SuperKeyword
      )
        found = child;
    });
  return found;
}

/** Duplicate ownership claims across packages. */
export function findOwnershipViolations(packages) {
  const owners = new Map();
  for (const pkg of packages)
    for (const claim of ownershipClaims(pkg)) {
      const key = `${claim.kind} ${claim.key}`;
      if (!owners.has(key)) owners.set(key, new Map());
      const byOwner = owners.get(key);
      if (!byOwner.has(pkg.name)) byOwner.set(pkg.name, claim.path);
    }
  const violations = [];
  for (const [key, byOwner] of [...owners].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    if (byOwner.size > 1)
      violations.push(
        `${key} has ${byOwner.size} owners: ${[...byOwner].map(([owner, path]) => `${owner} (${path})`).join(", ")}`,
      );
  return violations;
}

/** The package a bare specifier names, or undefined for relative and URL specifiers. */
export function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    /^[a-z][a-z+.-]*:/iu.test(specifier)
  )
    return undefined;
  const segments = specifier.split("/");
  if (specifier.startsWith("@"))
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  return segments[0] || undefined;
}

function moduleSpecifiers(file) {
  const specifiers = [];
  visit(file, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      specifiers.push({ specifier: literalText(node.moduleSpecifier), node });
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      specifiers.push({ specifier: literalText(node.arguments[0]), node });
  });
  return specifiers.filter(({ specifier }) => specifier !== undefined);
}

/** Bindings a file imports from another package: local name → package. */
function foreignBindings(file, ownName) {
  const bindings = new Map();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const owner = packageNameFromSpecifier(
      literalText(statement.moduleSpecifier) ?? ".",
    );
    if (owner === undefined || owner === ownName) continue;
    const clause = statement.importClause;
    if (clause.name) bindings.set(clause.name.text, owner);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named))
      bindings.set(named.name.text, owner);
    if (named && ts.isNamedImports(named))
      for (const element of named.elements)
        bindings.set(element.name.text, owner);
  }
  return bindings;
}

/**
 * Sibling implementation imports and storage-domain writes across packages.
 * @param packages - from {@link readPluginPackages}.
 * @param workspaceNames - every workspace package name an import may target.
 */
export function findImportViolations(
  packages,
  workspaceNames = new Set(packages.map((pkg) => pkg.name)),
) {
  const violations = [];
  for (const pkg of packages.filter(
    (candidate) => !nonPluginPackages.has(candidate.name),
  ))
    for (const { path, file } of pkg.sources) {
      for (const { specifier } of moduleSpecifiers(file)) {
        if (specifier.startsWith(".")) {
          const target = slash(join(dirname(path), specifier));
          if (target !== pkg.dir && !target.startsWith(`${pkg.dir}/`))
            violations.push(
              `${path}: relative import ${specifier} leaves package ${pkg.name}`,
            );
          continue;
        }
        const owner = packageNameFromSpecifier(specifier);
        if (
          owner === undefined ||
          owner === pkg.name ||
          !workspaceNames.has(owner)
        )
          continue;
        const subpath = specifier.slice(owner.length + 1);
        if (/^(?:src|lib|tests)(?:\/|$)/u.test(subpath))
          violations.push(
            `${path}: imports the implementation of sibling package ${owner} (${specifier})`,
          );
      }
      const foreign = foreignBindings(file, pkg.name);
      visit(file, (node) => {
        if (
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression)
        )
          return;
        const callee = node.expression;
        if (
          callee.name.text !== "open" ||
          !/(?:^|\.)(?:domain|storageDomain)$/u.test(
            callee.expression.getText(),
          )
        )
          return;
        const [spec] = node.arguments;
        const root =
          spec === undefined
            ? undefined
            : ts.isPropertyAccessExpression(spec)
              ? spec.expression
              : spec;
        if (
          root === undefined ||
          !ts.isIdentifier(root) ||
          !foreign.has(root.text)
        )
          return;
        violations.push(
          `${path}: opens storage domain ${spec.getText()} owned by ${foreign.get(root.text)}; write through the owner's service`,
        );
      });
    }
  return violations;
}

/** Groups whose packages run on Cordis directly, never on the Kernel (P2). */
export const kernelFreeGroups = ["packages/compat", ...pluginGroups];

const KERNEL_PACKAGE = "@dramaip/kernel";
const KERNEL_DIRECTORY = "packages/kernel";

/**
 * Business plugins and the packages composing them must not reach the Kernel:
 * not as a dependency, a bare import or a relative path into its directory.
 * @param root - desktop root.
 * @param groups - workspace groups to check.
 */
export function findKernelImportViolations(root, groups = kernelFreeGroups) {
  const violations = [];
  for (const pkg of readPluginPackages(root, groups)) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      if (pkg.manifest[field]?.[KERNEL_PACKAGE] !== undefined)
        violations.push(
          `${pkg.dir}/package.json: ${pkg.name} lists ${KERNEL_PACKAGE} in ${field}`,
        );
    for (const { path, file } of pkg.sources)
      for (const { specifier } of moduleSpecifiers(file)) {
        const target = specifier.startsWith(".")
          ? slash(join(dirname(path), specifier))
          : undefined;
        if (
          packageNameFromSpecifier(specifier) === KERNEL_PACKAGE ||
          target === KERNEL_DIRECTORY ||
          target?.startsWith(`${KERNEL_DIRECTORY}/`)
        )
          violations.push(`${path}: imports the Kernel (${specifier})`);
      }
  }
  return violations;
}

function loadYaml(root) {
  const require = createRequire(
    join(root, "packages/infra/app-boot/package.json"),
  );
  const yaml = require("js-yaml");
  const js = new yaml.Type("tag:yaml.org,2002:js", {
    kind: "scalar",
    construct: (data) => ({ __jsExpr: data }),
  });
  const schema = yaml.DEFAULT_SCHEMA.extend([js]);
  return (text) => yaml.load(text, { schema });
}

/** Plugin names a Loader patch document mounts; `config` values are data, not rows. */
export function patchPluginNames(document) {
  const names = [];
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (value === null || typeof value !== "object" || "__jsExpr" in value)
      return;
    if (typeof value.name === "string") names.push(value.name);
    for (const [key, child] of Object.entries(value))
      if (key !== "config" && key !== "name") collect(child);
  };
  collect(document);
  return names;
}

function arrayLiteralStrings(node, output) {
  visit(node, (child) => {
    const value = literalText(child);
    if (value !== undefined && ts.isArrayLiteralExpression(child.parent))
      output.push(value);
  });
}

/** Bundle names the launcher's Profile templates and bundle lists reference. */
export function profileBundleNames(profileSource) {
  const file = ts.createSourceFile(
    "profile.ts",
    profileSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const names = [];
  const lists = new Set([
    "PROFILE_TEMPLATES",
    "DEFAULT_PROFILE_BUNDLES",
    "OPTIONAL_BUNDLES",
  ]);
  visit(file, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      lists.has(node.name.text) &&
      node.initializer
    )
      arrayLiteralStrings(node.initializer, names);
  });
  return names;
}

/**
 * Bare plugin names absent from their resolver manifest.
 * @param root - desktop root or a fixture with the same layout.
 */
export function findBareNameViolations(root) {
  const violations = [];
  const parse = loadYaml(
    existsSync(join(root, "packages/infra/app-boot/package.json"))
      ? root
      : desktopRoot,
  );
  for (const manifestPath of globSync("packages/*/*/package.json", {
    cwd: root,
  })
    .map(slash)
    .sort()) {
    const manifest = readJson(join(root, manifestPath));
    const patch = manifest.dramaip?.bundle?.patch;
    if (patch === undefined) continue;
    const dependencies = manifest.dependencies ?? {};
    for (const file of typeof patch === "string" ? [patch] : patch) {
      const patchPath = slash(join(dirname(manifestPath), file));
      for (const name of new Set(
        patchPluginNames(parse(readFileSync(join(root, patchPath), "utf8"))),
      )) {
        const owner = packageNameFromSpecifier(name);
        if (
          owner === undefined ||
          owner === manifest.name ||
          owner in dependencies
        )
          continue;
        violations.push(
          `${patchPath}: ${owner} must be declared in ${manifestPath} dependencies`,
        );
      }
    }
  }
  const profilePath = "packages/infra/app-boot/src/profile.ts";
  const launcherPath = "apps/cli/package.json";
  if (
    existsSync(join(root, profilePath)) &&
    existsSync(join(root, launcherPath))
  ) {
    const dependencies = readJson(join(root, launcherPath)).dependencies ?? {};
    for (const name of new Set(
      profileBundleNames(readFileSync(join(root, profilePath), "utf8")),
    ))
      if (!(name in dependencies))
        violations.push(
          `${profilePath}: Profile bundle ${name} must be declared in ${launcherPath} dependencies`,
        );
  }
  return violations;
}

/**
 * Launch categories; only `launcher` may start the application, and `shell`
 * the Electron shell that starts its Host through the same Profile runner.
 */
export const launchCategories = new Set([
  "launcher",
  "shell",
  "build",
  "test",
  "check",
  "generate",
  "format",
  "release",
  "maintenance",
  "legacy-application",
]);

const launcherReferences = [
  "apps/cli/src/bin.ts",
  "--filter @dramaip/cli run dramaip",
];
const packageEntry = /packages\/[^\s'"`]+\.(?:[cm]?[jt]sx?)\b/gu;
const testEntry = /\.(?:test|spec|integration)\.[cm]?[jt]sx?$/u;

function entry(value) {
  return typeof value === "string" ? { category: value } : (value ?? {});
}

function categoryViolations(label, value) {
  const { category, until } = entry(value);
  if (!launchCategories.has(category))
    return [`${label}: unknown launch category ${JSON.stringify(category)}`];
  if (category === "legacy-application" && typeof until !== "string")
    return [
      `${label}: legacy-application entries name the phase that removes them ("until")`,
    ];
  return [];
}

/** Package entries a command or wrapper runs directly, test files excepted. */
function directPackageEntries(text) {
  return [...text.matchAll(packageEntry)]
    .map(([path]) => path)
    .filter((path) => !testEntry.test(path));
}

function normalizedBin(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return undefined;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

/**
 * Root scripts, package bins and executable sources without a launch
 * category, and application paths that bypass the launcher.
 * @param root - desktop root or a fixture with the same layout.
 * @param table - parsed `architecture/launch-entries.json`.
 */
export function findLaunchViolations(root, table) {
  const violations = [];
  const scripts = existsSync(join(root, "package.json"))
    ? (readJson(join(root, "package.json")).scripts ?? {})
    : {};
  const classified = table.scripts ?? {};
  for (const name of Object.keys(classified))
    if (!(name in scripts))
      violations.push(
        `architecture/launch-entries.json scripts.${name}: no such root script`,
      );
  for (const [name, command] of Object.entries(scripts).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const label = `package.json scripts.${name}`;
    if (!(name in classified)) {
      violations.push(`${label}: root script has no launch category`);
      continue;
    }
    const categoryProblems = categoryViolations(label, classified[name]);
    violations.push(...categoryProblems);
    if (categoryProblems.length > 0) continue;
    const { category, wrapper } = entry(classified[name]);
    if (category === "legacy-application") continue;
    const texts = [{ where: label, text: command }];
    if (wrapper !== undefined) {
      if (!command.includes(wrapper))
        violations.push(`${label}: classified wrapper must be ${wrapper}`);
      else if (!existsSync(join(root, wrapper)))
        violations.push(`${wrapper}: classified launcher wrapper is missing`);
      else
        texts.push({
          where: wrapper,
          text: readFileSync(join(root, wrapper), "utf8"),
        });
    }
    for (const { where, text } of texts)
      for (const path of directPackageEntries(text))
        violations.push(
          `${where}: runs package entry ${path} directly; applications start through the dramaip launcher`,
        );
    if (
      category === "launcher" &&
      !texts.some(({ text }) =>
        launcherReferences.some((ref) => text.includes(ref)),
      )
    )
      violations.push(
        `${label}: launcher script must start apps/cli/src/bin.ts`,
      );
  }

  const bins = table.bins ?? {};
  const manifests = globSync(
    [
      "apps/*/package.json",
      "packages/*/package.json",
      "packages/*/*/package.json",
    ],
    {
      cwd: root,
      exclude: (path) => path.includes("node_modules"),
    },
  )
    .map(slash)
    .sort();
  for (const path of manifests) {
    const manifest = readJson(join(root, path));
    if (manifest.bin === undefined) continue;
    const expected = bins[path];
    if (expected === undefined) {
      violations.push(
        `${path}: package bin has no launch category; applications start through the dramaip launcher`,
      );
      continue;
    }
    violations.push(...categoryViolations(path, expected));
    if (normalizedBin(manifest.bin) !== normalizedBin(expected.bin))
      violations.push(
        `${path}: classified bin must remain ${JSON.stringify(expected.bin)}, got ${JSON.stringify(manifest.bin)}`,
      );
  }

  const executables = table.executables ?? {};
  const sources = globSync(
    [
      "*.{ts,js,mjs,cjs}",
      "{apps,packages,plugins,scripts}/**/*.{ts,tsx,js,mjs,cjs}",
    ],
    {
      cwd: root,
      exclude: (path) => skipped.has(path.split(/[\\/]/u).at(-1)),
    },
  )
    .map(slash)
    .sort();
  for (const path of sources) {
    if (!readFileSync(join(root, path), "utf8").startsWith("#!")) continue;
    if (executables[path] === undefined) {
      violations.push(`${path}: executable source has no launch category`);
      continue;
    }
    violations.push(...categoryViolations(path, executables[path]));
  }
  return violations;
}

/**
 * Packages a domain client plugin replaces with Slots, CSS Modules, the
 * Client store and the control component (which alone builds on Radix and cva).
 */
const FORBIDDEN_UI_PACKAGE =
  /^(?:tailwindcss|@tailwindcss\/.+|radix-ui|@radix-ui\/.+|class-variance-authority|shadcn(?:-ui)?|@shadcn\/.+|@tanstack\/react-query|zustand)$/u;

/** A color written as a value instead of read from a theme token. */
const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|:\s*(?:white|black)\b/iu;

/** A selector that branches on the color scheme, which the theme component owns. */
const THEME_SELECTOR =
  /data-ds-dark-theme|prefers-color-scheme|(?:^|[\s,>+~(])\.dark\b/u;

/**
 * Color literals and theme selectors in one stylesheet.
 * @param path - root-relative stylesheet path, for the messages.
 * @param source - the stylesheet text.
 * @returns one message per offending line.
 */
function stylesheetViolations(path, source) {
  const violations = [];
  // Blank out comments but keep their newlines, so line numbers hold.
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, (comment) =>
    comment.replace(/[^\n]/gu, " "),
  );
  code.split("\n").forEach((text, index) => {
    if (COLOR_LITERAL.test(text))
      violations.push(
        `${path}:${index + 1}: color literal; read a --dsw-* theme token`,
      );
    if (THEME_SELECTOR.test(text))
      violations.push(
        `${path}:${index + 1}: theme selector; the theme component switches the tokens`,
      );
  });
  return violations;
}

/** JSX attributes whose value is user-facing copy. */
const COPY_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "alt",
  "placeholder",
  "title",
]);

function stringValue(initializer) {
  if (initializer === undefined) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined &&
    (ts.isStringLiteral(initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(initializer.expression) ||
      ts.isTemplateExpression(initializer.expression))
  )
    return initializer.expression;
  return undefined;
}

/**
 * Domain client plugins (`dramaip.client` packages of a domain group) keep to
 * the plan §4.7 UI stack: Slots, CSS Modules with theme tokens, the locale
 * dictionary for copy, the Client store for state.
 * @param root - desktop root.
 * @param groups - domain workspace groups.
 */
export function findDomainUiViolations(root, groups = domainGroups) {
  const violations = [];
  for (const pkg of readPluginPackages(root, groups)) {
    if (pkg.manifest.dramaip?.client === undefined) continue;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ])
      for (const name of Object.keys(pkg.manifest[field] ?? {}))
        if (FORBIDDEN_UI_PACKAGE.test(name))
          violations.push(
            `${pkg.dir}/package.json: ${pkg.name} lists ${name} in ${field}`,
          );
    for (const { path, file } of pkg.sources) {
      const line = (node) =>
        `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      for (const { specifier, node } of moduleSpecifiers(file)) {
        const owner = packageNameFromSpecifier(specifier);
        if (owner !== undefined && FORBIDDEN_UI_PACKAGE.test(owner))
          violations.push(`${line(node)}: imports ${specifier}`);
        else if (
          specifier.endsWith(".css") &&
          !specifier.endsWith(".module.css")
        )
          violations.push(
            `${line(node)}: imports the global stylesheet ${specifier}; use a CSS Module`,
          );
      }
      visit(file, (node) => {
        if (ts.isJsxText(node) && /\p{L}/u.test(node.text))
          violations.push(
            `${line(node)}: JSX text "${node.text.trim()}"; take copy from the locale dictionary`,
          );
        if (!ts.isJsxAttribute(node)) return;
        const name = node.name.getText();
        const literal = stringValue(node.initializer);
        if (literal === undefined) return;
        if (name === "className")
          violations.push(
            `${line(node)}: className ${literal.getText()}; use a CSS Module class`,
          );
        else if (COPY_ATTRIBUTES.has(name))
          violations.push(
            `${line(node)}: ${name} ${literal.getText()}; take copy from the locale dictionary`,
          );
      });
    }
    for (const path of walk(join(root, pkg.dir, "src"))
      .filter((path) => path.endsWith(".css"))
      .sort())
      violations.push(
        ...stylesheetViolations(
          slash(relative(root, path)),
          readFileSync(path, "utf8"),
        ),
      );
  }
  return violations;
}

/**
 * The business arity of every `@Remote` method, keyed `namespace.method`. A
 * trailing `AbortSignal` parameter is the optional cancellation argument.
 * @param packages - plugin packages read from source.
 * @returns `Map<"ns.method", { expected, cancellable }>`.
 */
export function remoteArities(packages) {
  const arities = new Map();
  for (const pkg of packages) {
    const constants = packageConstants(pkg);
    const resolveValue = (node) =>
      literalText(node) ??
      (node !== undefined && ts.isIdentifier(node)
        ? (constants.get(node.text) ?? undefined)
        : undefined);
    for (const { file } of pkg.sources)
      visit(file, (node) => {
        if (!ts.isClassDeclaration(node) || !extendsRemoteService(node)) return;
        const call = superCall(node);
        if (call === undefined) return;
        const options = call.arguments[2];
        const namespace =
          (options !== undefined && ts.isObjectLiteralExpression(options)
            ? resolveValue(property(options, "namespace"))
            : undefined) ?? resolveValue(call.arguments[1]);
        if (typeof namespace !== "string") return;
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name))
            continue;
          const remote = (ts.getDecorators(member) ?? []).some(
            (decorator) => decorator.expression.getText() === "Remote",
          );
          if (!remote) continue;
          const parameters = [...member.parameters];
          const cancellable =
            parameters.at(-1)?.type?.getText() === "AbortSignal";
          arities.set(`${namespace}.${member.name.text}`, {
            expected: parameters.length - (cancellable ? 1 : 0),
            cancellable,
          });
        }
      });
  }
  return arities;
}

/**
 * Client calls to a generated Remote method with the wrong number of
 * arguments. The Client checks the arity exactly: an optional parameter is
 * still passed (as `undefined`), and only a cancellable method takes one more,
 * its `AbortSignal`. A call is matched by the namespace its receiver is named
 * after (`agents.providersList(…)`, `ctx.remote.agents.providersList(…)`).
 * @param packages - plugin packages read from source.
 */
export function findRemoteArityViolations(packages) {
  const arities = remoteArities(packages);
  const namespaces = new Set(
    [...arities.keys()].map((key) => key.slice(0, key.lastIndexOf("."))),
  );
  const violations = [];
  for (const pkg of packages) {
    if (pkg.manifest.dramaip?.client === undefined) continue;
    for (const { path, file } of pkg.sources)
      visit(file, (node) => {
        if (
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression)
        )
          return;
        const receiver = node.expression.expression;
        // `client.<ns>.x(…)` is the Studio request facade, not a Remote call.
        if (
          ts.isPropertyAccessExpression(receiver) &&
          ts.isIdentifier(receiver.expression) &&
          receiver.expression.text === "client"
        )
          return;
        const namespace = ts.isPropertyAccessExpression(receiver)
          ? receiver.name.text
          : ts.isIdentifier(receiver)
            ? receiver.text
            : undefined;
        if (namespace === undefined || !namespaces.has(namespace)) return;
        const method = node.expression.name.text;
        const arity = arities.get(`${namespace}.${method}`);
        if (arity === undefined) return;
        if (node.arguments.some(ts.isSpreadElement)) return;
        const count = node.arguments.length;
        if (
          count === arity.expected ||
          (arity.cancellable && count === arity.expected + 1)
        )
          return;
        const line = file.getLineAndCharacterOfPosition(node.getStart()).line;
        violations.push(
          `${path}:${line + 1}: ${namespace}.${method} takes ${arity.expected} argument(s)${arity.cancellable ? " plus an optional AbortSignal" : ""}, got ${count}; pass every optional one as undefined`,
        );
      });
  }
  return violations;
}

/** Every Level 2 §10 violation under a root, grouped by gate. */
export function level2Violations(root = desktopRoot) {
  const packages = readPluginPackages(root);
  const tablePath = join(root, "architecture/launch-entries.json");
  return {
    ownership: findOwnershipViolations(packages),
    imports: findImportViolations(packages),
    names: findBareNameViolations(root),
    launch: findLaunchViolations(
      root,
      existsSync(tablePath) ? readJson(tablePath) : {},
    ),
    kernel: findKernelImportViolations(root),
    ui: findDomainUiViolations(root),
    arity: findRemoteArityViolations(packages),
  };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = level2Violations();
  const failures = Object.entries(result).flatMap(([gate, list]) =>
    list.map((violation) => `[${gate}] ${violation}`),
  );
  if (failures.length > 0) {
    console.error("check-level2-gates: Level 2 §10 violations:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    const packages = readPluginPackages(desktopRoot);
    const claims = packages.reduce(
      (total, pkg) => total + ownershipClaims(pkg).length,
      0,
    );
    console.log(
      `check-level2-gates: ${packages.length} plugin packages, ${claims} ownership claims; ownership, imports, bare names, launch entries, Kernel isolation, the domain UI stack and the Remote call arity pass.`,
    );
  }
}
