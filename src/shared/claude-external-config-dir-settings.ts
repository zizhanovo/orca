/** Settings for user-picked external CLAUDE_CONFIG_DIR folders; kept apart from the max-lines-limited settings module. */
export type ClaudeExternalConfigDirSettings = {
  /** Absolute host paths of external CLAUDE_CONFIG_DIR partitions whose usage the status bar tracks; read-only unless also in claudeHookConfigDirs. Older peers tolerate absence. */
  claudeUsageConfigDirs?: string[]
  /** Opted-in subset of claudeUsageConfigDirs where Orca-managed hooks are installed (edits that folder's settings.json). */
  claudeHookConfigDirs?: string[]
}
