// Build both faces of the plugin:
//   1. tsc compiles src/host and src/shared to lib/ (ESM, run by the DSH Host).
//   2. esbuild bundles src/client into lib/client.js in the DSH Client
//      loader's closure-factory format: the file calls
//      window.__ModuleLoader__.load({ id, factory }) and resolves shared
//      modules through the factory's `require` (the page's module table).
//   3. A purity check rejects a client bundle that requires anything outside
//      the module table or carries its own React.
//
// The format and the module table mirror the locked DSH 0.2.1-rc.3
// packages/client/tsdown.client.ts and packages/client/web/src/platform.ts.

import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Modules the DSH Web shell shares with every Client plugin. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]
const externals = [...PLATFORM_MODULES, ...(manifest.dsh.client.external ?? [])]

rmSync(join(root, 'lib'), { recursive: true, force: true })

execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.host.json')],
  { stdio: 'inherit' },
)

// Bundle private dependencies (schemas) while preserving host-provided peers.
await build({
  entryPoints: [join(root, 'src/host/index.ts')],
  outfile: join(root, 'lib/host/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['@deepseek-ai/*'],
  legalComments: 'none',
})

const out = join(root, 'lib', 'client.js')
await build({
  entryPoints: [join(root, 'src', 'client', 'index.tsx')],
  outfile: out,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: externals,
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

const bundle = readFileSync(out, 'utf8')
const required = new Set(
  [...bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
)
const stray = [...required].filter((name) => !externals.includes(name))
if (stray.length > 0)
  throw new Error(
    `client bundle requires modules outside the DSH module table: ${stray.join(', ')}`,
  )
if (
  /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED|__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE|react\.production/.test(
    bundle,
  )
) {
  throw new Error('client bundle embeds its own React copy')
}
if (
  !bundle.startsWith(
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
  )
) {
  throw new Error('client bundle does not start with the DSH loader registration')
}
writeFileSync(
  join(root, 'lib', 'client.meta.json'),
  `${JSON.stringify({ id: manifest.name, requires: [...required].sort(), bytes: bundle.length }, null, 2)}\n`,
)
console.log(
  `built lib/host, lib/shared and lib/client.js (${bundle.length} bytes; requires ${[...required].join(', ') || 'nothing'})`,
)
