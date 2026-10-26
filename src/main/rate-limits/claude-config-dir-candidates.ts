import { lstatSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveExternalClaudeUsageDirs } from './claude-external-config-dir-usage'

const MAX_CANDIDATES = 24

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

function listDirNames(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** A Claude config dir carries a transcript root or a settings file; empty `.claude*` leftovers do not. */
function looksLikeClaudeConfigDir(dir: string): boolean {
  return isDir(join(dir, 'projects')) || listDirNames(dir).includes('settings.json')
}

/**
 * Likely CLAUDE_CONFIG_DIR folders to offer for one-click tracking: `~/.claude*` siblings,
 * children of `~/.claude-profiles`, and folders Orca already saw in hook transcript paths.
 * Read-only; nothing is tracked or modified until the user accepts a suggestion.
 */
export function discoverClaudeConfigDirCandidates(options: {
  home?: string
  observed?: string[]
  alreadyTracked?: string[]
  managedConfigDirs?: (string | null | undefined)[]
  systemConfigDir?: string | null
}): string[] {
  const home = options.home ?? homedir()
  const found: string[] = []
  for (const name of listDirNames(home)) {
    if (!name.startsWith('.claude')) {
      continue
    }
    const path = join(home, name)
    if (!isDir(path)) {
      continue
    }
    if (name === '.claude-profiles') {
      found.push(...listDirNames(path).map((child) => join(path, child)))
    } else {
      found.push(path)
    }
  }
  found.push(...(options.observed ?? []))
  const tracked = new Set(resolveExternalClaudeUsageDirs(options.alreadyTracked ?? [], { home }))
  return resolveExternalClaudeUsageDirs(found, {
    home,
    managedConfigDirs: options.managedConfigDirs,
    systemConfigDir: options.systemConfigDir
  })
    .filter((dir) => !tracked.has(dir) && isDir(dir) && looksLikeClaudeConfigDir(dir))
    .slice(0, MAX_CANDIDATES)
}

let provider: (() => string[]) | null = null

/** Main wires the settings-aware provider; the IPC handler stays free of store access. */
export function setClaudeConfigDirCandidateProvider(next: (() => string[]) | null): void {
  provider = next
}

export function listClaudeConfigDirCandidates(): string[] {
  return provider?.() ?? []
}
