import { FolderPlus, X } from 'lucide-react'
import React, { useCallback } from 'react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import {
  InlineUsageBars,
  InlineUsageSkeleton,
  isUnavailableInactiveUsage
} from './InlineProviderUsage'

const NO_DIRS: string[] = []

function dirLabel(dir: string): string {
  const segments = dir.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? dir
}

/** Read-only usage for user-picked CLAUDE_CONFIG_DIR folders (host-local only). */
export function ExternalClaudeDirsSection(): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  // Older paired hosts publish snapshots without the field; tolerate absence.
  const externalClaudeDirs = useAppStore((s) => s.rateLimits.externalClaudeDirs) ?? NO_DIRS
  const usageConfigDirs = useAppStore((s) => s.settings?.claudeUsageConfigDirs) ?? NO_DIRS
  const hookConfigDirs = useAppStore((s) => s.settings?.claudeHookConfigDirs) ?? NO_DIRS

  const addUsageConfigDir = useCallback(async () => {
    const dir = await window.api.repos.pickDirectory()
    if (!dir || usageConfigDirs.includes(dir)) {
      return
    }
    // Main watches the settings key and refetches every tracked folder's usage.
    await updateSettings({ claudeUsageConfigDirs: [...usageConfigDirs, dir] })
  }, [usageConfigDirs, updateSettings])

  const removeUsageConfigDir = useCallback(
    async (dir: string) => {
      await updateSettings({
        claudeUsageConfigDirs: usageConfigDirs.filter((entry) => entry !== dir),
        claudeHookConfigDirs: hookConfigDirs.filter((entry) => entry !== dir)
      })
    },
    [usageConfigDirs, hookConfigDirs, updateSettings]
  )

  // Why: enabling edits that folder's settings.json (adds Orca hooks); main removes them on disable.
  const setHooksEnabled = useCallback(
    async (dir: string, enabled: boolean) => {
      const rest = hookConfigDirs.filter((entry) => entry !== dir)
      await updateSettings({ claudeHookConfigDirs: enabled ? [...rest, dir] : rest })
    },
    [hookConfigDirs, updateSettings]
  )

  return (
    <div className="px-1 pb-1">
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {translate('status-bar.claude-usage-config-dirs', 'Other config folders')}
      </div>
      <div className="rounded-md border border-border/60 bg-accent/5 p-1">
        {externalClaudeDirs.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {translate(
              'status-bar.claude-usage-config-dirs-empty',
              'Track Claude usage from other CLAUDE_CONFIG_DIR folders on this device.'
            )}
          </div>
        ) : null}
        {externalClaudeDirs.map((dir) => {
          const usage = dir.rateLimits
          return (
            <DropdownMenuItem key={dir.accountId} onSelect={(event) => event.preventDefault()}>
              <div className="flex w-full flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] text-foreground"
                    title={dir.accountId}
                  >
                    {dirLabel(dir.accountId)}
                  </span>
                  <button
                    type="button"
                    aria-label={translate(
                      'status-bar.claude-usage-config-dir-remove',
                      'Stop tracking this folder'
                    )}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void removeUsageConfigDir(dir.accountId)
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <label
                  className="flex items-center gap-2 text-[10px] leading-4 text-muted-foreground"
                  title={translate(
                    'status-bar.claude-usage-config-dir-hooks-hint',
                    "Adds Orca hooks to this folder's settings.json so sessions started in Orca terminals show up in workspaces."
                  )}
                >
                  <Switch
                    checked={hookConfigDirs.includes(dir.accountId)}
                    onCheckedChange={(checked) => void setHooksEnabled(dir.accountId, checked)}
                  />
                  {translate(
                    'status-bar.claude-usage-config-dir-hooks',
                    'Show Orca terminal sessions'
                  )}
                </label>
                {dir.isFetching && !usage ? (
                  <InlineUsageSkeleton />
                ) : usage ? (
                  isUnavailableInactiveUsage(usage) ? (
                    <span className="text-[10px] leading-4 text-muted-foreground">
                      {usage.error}
                    </span>
                  ) : (
                    <InlineUsageBars limits={usage} isFetching={dir.isFetching} />
                  )
                ) : null}
              </div>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            void addUsageConfigDir()
          }}
        >
          <FolderPlus className="size-3.5 text-muted-foreground/85" />
          <span className="text-[12px]">
            {translate('status-bar.claude-usage-config-dir-add', 'Track a folder…')}
          </span>
        </DropdownMenuItem>
      </div>
    </div>
  )
}
