import React, { useEffect } from 'react'
import { useAppStore } from '../../store'
import { defaultScopeHost } from '@/lib/default-creation-host'
import { useActiveAccountOwner } from '@/runtime/use-worktree-runtime-target'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'
import { formatRateLimitWindowChipLabel } from '@/lib/window-label-formatter'
import { clampUsedPercent } from './tooltip'
import { formatUsagePercentageLabel } from './usage-percentage-label'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'

const NO_DIRS: InactiveAccountUsage[] = []
const REFRESH_MS = 5 * 60_000

function dirLabel(dir: string): string {
  return (
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || dir
  )
}

/** One chip per tracked CLAUDE_CONFIG_DIR folder: name, 7-day usage and time left, so folders compare at a glance. */
export function ExternalClaudeDirsStatusChips(): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const { target } = useActiveAccountOwner(defaultScopeHost(settings))
  const isLocalOwner = runtimeTargetEnvironmentId(target) === null
  const fetchUsage = useAppStore((s) => s.fetchExternalClaudeDirUsage)
  const dirs = useAppStore((s) => s.rateLimits.externalClaudeDirs) ?? NO_DIRS
  const tracked = settings?.claudeUsageConfigDirs?.length ?? 0
  const display = normalizeUsagePercentageDisplay(useAppStore((s) => s.usagePercentageDisplay))
  const now = useResetCountdownClock(dirs.map((dir) => dir.rateLimits?.weekly?.resetsAt))

  useEffect(() => {
    if (!isLocalOwner || tracked === 0) {
      return
    }
    void fetchUsage()
    const timer = window.setInterval(() => void fetchUsage(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [isLocalOwner, tracked, fetchUsage])

  const shown = dirs.filter((dir) => dir.rateLimits?.weekly)
  if (!isLocalOwner || shown.length === 0) {
    return null
  }
  return (
    <div className="flex shrink-0 items-center gap-3 pl-3" data-external-claude-dirs>
      {shown.map((dir) => {
        const weekly = dir.rateLimits!.weekly!
        const used = clampUsedPercent(weekly.usedPercent)
        return (
          <span
            key={dir.accountId}
            title={dir.accountId}
            className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
          >
            <span className="text-foreground/80">{dirLabel(dir.accountId)}</span>
            <span className={used >= 90 ? 'text-red-500' : used >= 70 ? 'text-yellow-500' : ''}>
              {formatUsagePercentageLabel(used, display)}
            </span>
            {weekly.resetsAt != null ? formatRateLimitWindowChipLabel(weekly, now) : null}
          </span>
        )
      })}
    </div>
  )
}
