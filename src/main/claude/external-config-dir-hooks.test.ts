import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveHookConfigDirs, syncExternalClaudeDirHooks } from './external-config-dir-hooks'
import { ClaudeHookService } from './hook-service'

describe('resolveHookConfigDirs', () => {
  it('keeps only opted-in dirs that are still tracked and not excluded', () => {
    expect(
      resolveHookConfigDirs(['/a', '/b', '/sys'], ['/b', '/c', '/sys'], { systemConfigDir: '/sys' })
    ).toEqual(['/b'])
  })
})

describe('syncExternalClaudeDirHooks', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('installs into opted-in dirs, preserves user hooks, and removes only managed ones', () => {
    // Managed scripts land under $HOME/.orca; never let the test touch the real home.
    const tmpHome = mkdtempSync(join(tmpdir(), 'orca-claude-home-'))
    vi.stubEnv('HOME', tmpHome)
    vi.stubEnv('USERPROFILE', tmpHome)
    const dir = mkdtempSync(join(tmpdir(), 'orca-claude-ext-'))
    tmpDirs.push(tmpHome, dir)
    const settings = join(dir, 'settings.json')
    const user = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }
    writeFileSync(settings, JSON.stringify({ model: 'x', ...user }))
    const service = new ClaudeHookService()

    syncExternalClaudeDirHooks([], [dir], service)
    const installed = JSON.parse(readFileSync(settings, 'utf8'))
    expect(installed.model).toBe('x')
    expect(JSON.stringify(installed)).toContain('echo mine')
    expect(service.getStatus({ configDir: dir }).managedHooksPresent).toBe(true)

    syncExternalClaudeDirHooks([dir], [], service)
    const removed = JSON.parse(readFileSync(settings, 'utf8'))
    expect(removed).toEqual({ model: 'x', ...user })
  })
})
