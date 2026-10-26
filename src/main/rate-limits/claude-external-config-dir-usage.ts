import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { readClaudeOAuthCredentials } from './claude-oauth-credentials'
import { fetchClaudeOAuthUsage } from './claude-oauth-usage-request'
import { OAuthUsageError } from './claude-oauth-usage-error'
import { classifyClaudeOAuthUsageError } from './claude-usage-error-classification'
import { abortedClaudeRateLimitResult, makeClaudeUsageResult } from './claude-usage-result'

/**
 * Expand `~` and require an absolute host path; null drops the entry instead of reading a
 * relative guess against the process cwd.
 */
export function normalizeExternalClaudeConfigDir(
  dir: string,
  home: string = homedir()
): string | null {
  const trimmed = dir.trim()
  if (!trimmed) {
    return null
  }
  const expanded =
    trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? join(home, trimmed.slice(1))
      : trimmed
  return isAbsolute(expanded) ? resolve(expanded) : null
}

/**
 * Usage for a user-named external CLAUDE_CONFIG_DIR partition. Reads only that folder's own
 * credentials file and its per-folder Keychain item; never the unsuffixed System Default login.
 */
export async function fetchExternalClaudeConfigDirUsage(
  configDir: string,
  options: { signal?: AbortSignal } = {}
): Promise<ProviderRateLimits> {
  if (options.signal?.aborted) {
    return abortedClaudeRateLimitResult()
  }
  const credentials = await readClaudeOAuthCredentials({
    credentialsFileConfigDir: configDir,
    keychainConfigDir: configDir,
    unsuffixedKeychainFallback: false
  })
  if (!credentials.token) {
    return makeClaudeUsageResult(
      'error',
      credentials.unavailable ? 'Claude usage is unavailable.' : 'No Claude login in this folder.',
      {
        credentialSource: credentials.source,
        authProvenance: 'external-dir',
        failureKind:
          credentials.unavailable && credentials.keychainUnavailable
            ? 'keychain-unavailable'
            : 'missing-credentials',
        attemptedSources: []
      }
    )
  }
  try {
    return await fetchClaudeOAuthUsage(credentials.token, options.signal)
  } catch (error) {
    if (options.signal?.aborted) {
      return abortedClaudeRateLimitResult()
    }
    const { failureKind } = classifyClaudeOAuthUsageError(error)
    const retryAfterMs = error instanceof OAuthUsageError ? error.retryAfterMs : null
    return makeClaudeUsageResult('error', 'Claude usage is unavailable.', {
      credentialSource: credentials.source,
      authProvenance: 'external-dir',
      failureKind,
      attemptedSources: ['oauth'],
      ...(retryAfterMs ? { retryAtMs: Date.now() + retryAfterMs } : {})
    })
  }
}

/** Dedupe and drop entries that duplicate System Default or a managed account's own folder. */
export function resolveExternalClaudeUsageDirs(
  dirs: string[],
  options: {
    managedConfigDirs?: (string | null | undefined)[]
    systemConfigDir?: string | null
    home?: string
  } = {}
): string[] {
  const excluded = new Set(
    [options.systemConfigDir, ...(options.managedConfigDirs ?? [])]
      .map((dir) => (dir ? normalizeExternalClaudeConfigDir(dir, options.home) : null))
      .filter((dir): dir is string => dir !== null)
  )
  const seen = new Set<string>()
  const resolved: string[] = []
  for (const dir of dirs) {
    const normalized = normalizeExternalClaudeConfigDir(dir, options.home)
    if (!normalized || seen.has(normalized) || excluded.has(normalized)) {
      continue
    }
    seen.add(normalized)
    resolved.push(normalized)
  }
  return resolved
}
