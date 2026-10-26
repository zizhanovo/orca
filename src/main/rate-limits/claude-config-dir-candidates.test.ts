import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverClaudeConfigDirCandidates } from './claude-config-dir-candidates'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'orca-candidates-'))
  roots.push(home)
  return home
}

function makeConfigDir(path: string, kind: 'projects' | 'settings' = 'projects'): void {
  mkdirSync(path, { recursive: true })
  if (kind === 'projects') {
    mkdirSync(join(path, 'projects'))
  } else {
    writeFileSync(join(path, 'settings.json'), '{}')
  }
}

describe('discoverClaudeConfigDirCandidates', () => {
  it('finds .claude* siblings and ~/.claude-profiles children, skipping empty or unrelated dirs', () => {
    const home = makeHome()
    makeConfigDir(join(home, '.claude'))
    makeConfigDir(join(home, '.claude-work'), 'settings')
    makeConfigDir(join(home, '.claude-profiles', 'c3'))
    makeConfigDir(join(home, '.claude-profiles', 'c5'), 'settings')
    mkdirSync(join(home, '.claude-profiles', 'empty'))
    makeConfigDir(join(home, '.config-other'))

    const result = discoverClaudeConfigDirCandidates({
      home,
      systemConfigDir: join(home, '.claude')
    })

    expect(result.sort()).toEqual(
      [
        join(home, '.claude-profiles', 'c3'),
        join(home, '.claude-profiles', 'c5'),
        join(home, '.claude-work')
      ].sort()
    )
  })

  it('omits folders already tracked or owned by a managed account, and adds observed ones', () => {
    const home = makeHome()
    const tracked = join(home, '.claude-profiles', 'c3')
    const managed = join(home, '.claude-profiles', 'c5')
    const observed = join(home, 'elsewhere', 'cfg')
    makeConfigDir(tracked)
    makeConfigDir(managed)
    makeConfigDir(join(home, '.claude-profiles', 'c9'))
    makeConfigDir(observed)

    const result = discoverClaudeConfigDirCandidates({
      home,
      observed: [observed],
      alreadyTracked: [tracked],
      managedConfigDirs: [managed]
    })

    expect(result.sort()).toEqual([join(home, '.claude-profiles', 'c9'), observed].sort())
  })

  it('returns an empty list when the home has nothing to offer', () => {
    expect(discoverClaudeConfigDirCandidates({ home: makeHome() })).toEqual([])
  })
})
