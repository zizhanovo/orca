import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  it('installs into opted-in dirs, preserves user hooks, and removes only managed ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-claude-ext-'))
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
