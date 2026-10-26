import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { resolveExternalClaudeUsageDirs } from '../rate-limits/claude-external-config-dir-usage'
import { ClaudeHookService } from './hook-service'

type Exclusions = { managedConfigDirs?: string[]; systemConfigDir?: string | null }

/**
 * Opt-in hook management for user-tracked CLAUDE_CONFIG_DIR folders. Only dirs that are both
 * tracked and opted in get hooks; System Default and managed profiles are handled elsewhere.
 */
export function resolveHookConfigDirs(
  tracked: string[],
  optedIn: string[],
  exclusions: Exclusions
): string[] {
  const trackedDirs = new Set(resolveExternalClaudeUsageDirs(tracked, exclusions))
  return resolveExternalClaudeUsageDirs(optedIn, exclusions).filter((dir) => trackedDirs.has(dir))
}

/** Install for `next`, and strip hooks from dirs that dropped out since `previous`. */
export function syncExternalClaudeDirHooks(
  previous: string[],
  next: string[],
  service: ClaudeHookService = new ClaudeHookService()
): { dir: string; status: AgentHookInstallStatus }[] {
  const results: { dir: string; status: AgentHookInstallStatus }[] = []
  const keep = new Set(next)
  for (const dir of previous) {
    if (!keep.has(dir)) {
      results.push({ dir, status: service.remove({ configDir: dir }) })
    }
  }
  for (const dir of next) {
    results.push({ dir, status: service.install({ configDir: dir }) })
  }
  return results
}
