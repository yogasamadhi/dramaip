import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Bun 在包目录下执行 workspace 脚本，cwd 即 apps/desktop
const root = process.cwd()
const pkgSrc = (p: string) => resolve(root, '../../packages', p, 'src/index.ts')

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'electron/main.ts') },
        external: ['better-sqlite3'],
      },
    },
    resolve: {
      alias: {
        '@sdns/core': pkgSrc('core'),
        '@sdns/db': pkgSrc('db'),
        '@sdns/ai': pkgSrc('ai'),
        '@sdns/export': pkgSrc('export'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve(root, 'renderer'),
    server: {
      port: 5177,
    },
    build: {
      rollupOptions: {
        input: resolve(root, 'renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(root, 'renderer/src'),
        '@sdns/core': pkgSrc('core'),
      },
    },
    plugins: [react()],
  },
})
