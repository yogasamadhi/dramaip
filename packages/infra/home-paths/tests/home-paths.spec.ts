import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_DRAMAIP_HOME_DISPLAY,
  DRAMAIP_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultDramaipHome,
  dramaipCachePath,
  dramaipHomeDisplay,
  dramaipHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveDramaipHome,
} from '@dramaip/infra-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dramaip path helpers', () => {
  it('owns the shared default DramaIP home directory name', () => {
    expect(DRAMAIP_HOME_DIR_NAME).toBe('.dramaip')
    expect(DEFAULT_DRAMAIP_HOME_DISPLAY).toBe('~/.dramaip')
    expect(defaultDramaipHome()).toBe(join(homedir(), '.dramaip'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.dramaip')).toBe(join(homedir(), '.dramaip'))
    expect(expandHomePath('~\\.dramaip')).toBe(join(homedir(), '.dramaip'))
    expect(expandHomePath('/tmp/.dramaip')).toBe('/tmp/.dramaip')
    expect(expandHomePath('~other/.dramaip')).toBe('~other/.dramaip')
  })

  it('resolves explicit path before DRAMAIP_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dramaip')

    expect(resolveDramaipHome('/tmp/explicit-dramaip', { DRAMAIP_HOME: '~/env-dramaip' })).toBe(resolve('/tmp/explicit-dramaip'))
    expect(resolveDramaipHome(undefined, { DRAMAIP_HOME: '~/env-dramaip' })).toBe(envHome)
    expect(resolveDramaipHome(undefined, {})).toBe(defaultDramaipHome())
  })

  it('treats an empty or whitespace-only DRAMAIP_HOME as unset', () => {
    expect(resolveDramaipHome(undefined, { DRAMAIP_HOME: '' })).toBe(defaultDramaipHome())
    expect(resolveDramaipHome(undefined, { DRAMAIP_HOME: '   ' })).toBe(defaultDramaipHome())
  })

  it('joins child segments onto the resolved DRAMAIP_HOME', () => {
    vi.stubEnv('DRAMAIP_HOME', '~/env-dramaip')
    expect(dramaipHomePath()).toBe(join(homedir(), 'env-dramaip'))
    expect(dramaipHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dramaip', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dramaipHomeDisplay(resolve(defaultDramaipHome()))).toBe('~/.dramaip')
    expect(dramaipHomeDisplay('/some/other/root')).toBe('$DRAMAIP_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before DRAMAIP_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { DRAMAIP_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { DRAMAIP_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only DRAMAIP_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { DRAMAIP_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { DRAMAIP_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$DRAMAIP_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.dramaip')],
    ['', join(homedir(), '.dramaip')],
    ['   ', join(homedir(), '.dramaip')],
    ['~/env-dramaip', join(homedir(), 'env-dramaip')],
    ['./relative-dramaip', resolve('./relative-dramaip')],
  ] as const)('resolves cache paths with DRAMAIP_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('DRAMAIP_HOME', home)
    try {
      expect(dramaipCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dramaipCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('DRAMAIP_HOME', '~/env-dramaip')
    try {
      expect(dramaipCachePath({ dramaipHome: '~/explicit-dramaip' })).toBe(join(homedir(), 'explicit-dramaip', 'cache'))
      expect(dramaipCachePath({ dramaipHome: './explicit-dramaip' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dramaip/cache/attachments/request-images'))
      expect(dramaipCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dramaip', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dramaip-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
