import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  normalizeExternalClaudeConfigDir,
  resolveExternalClaudeUsageDirs
} from './claude-external-config-dir-usage'

const home = join('/home', 'user')

describe('normalizeExternalClaudeConfigDir', () => {
  it('expands ~ and resolves relative segments', () => {
    expect(normalizeExternalClaudeConfigDir('~', home)).toBe(home)
    expect(normalizeExternalClaudeConfigDir(`~/.claude-work`, home)).toBe(
      join(home, '.claude-work')
    )
    expect(normalizeExternalClaudeConfigDir('/tmp/a/../b', home)).toBe(join('/tmp', 'b'))
  })

  it('drops blank and relative entries instead of guessing against the cwd', () => {
    expect(normalizeExternalClaudeConfigDir('   ', home)).toBeNull()
    expect(normalizeExternalClaudeConfigDir('claude-profiles/work', home)).toBeNull()
  })
})

describe('resolveExternalClaudeUsageDirs', () => {
  it('dedupes and excludes the system dir and managed account folders', () => {
    const systemDir = join(home, '.claude')
    const managedDir = join(home, 'managed-account')
    expect(
      resolveExternalClaudeUsageDirs(
        [systemDir, managedDir, `~/work//`, `${managedDir}/`, '/tmp/other', '/tmp/other'],
        { systemConfigDir: systemDir, managedConfigDirs: [managedDir], home }
      )
    ).toEqual([join(home, 'work'), '/tmp/other'])
  })

  it('keeps a managed folder only when its own path was not listed', () => {
    expect(
      resolveExternalClaudeUsageDirs(['/tmp/a'], {
        managedConfigDirs: [null, undefined, ''],
        home
      })
    ).toEqual(['/tmp/a'])
  })
})
