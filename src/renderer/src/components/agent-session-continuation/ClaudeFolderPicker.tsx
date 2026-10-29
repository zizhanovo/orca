import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildClaudeContinuationFolderOptions,
  isClaudeFamilyAgent,
  type ClaudeContinuationFolderOption
} from './claude-continuation-config-dirs'

const NO_DIRS: string[] = []
const DEFAULT_FOLDER_VALUE = '__orca-default__'

/** Which CLAUDE_CONFIG_DIR a handed-off Claude session runs under; only on this device, where the folders live. */
export function useClaudeContinuationFolder(args: {
  open: boolean
  request: AgentSessionContinuationRequest | null
  agent: TuiAgent | null
  isLocal: boolean
  trackedDirs: string[] | undefined
}): {
  options: ClaudeContinuationFolderOption[]
  dir: string | null
  pick: (dir: string | null) => void
} {
  const { open, request, agent, isLocal, trackedDirs } = args
  const [picked, setPicked] = useState<{
    request: AgentSessionContinuationRequest | null
    dir: string | null
  } | null>(null)
  if (!open && picked) {
    setPicked(null)
  }
  const options =
    request && isLocal && isClaudeFamilyAgent(agent)
      ? buildClaudeContinuationFolderOptions({
          sourceAgent: request.source.sourceAgent,
          transcriptPath: request.source.transcriptPath,
          trackedDirs: trackedDirs ?? NO_DIRS
        })
      : []
  const pickedDir = picked?.request === request ? picked.dir : undefined
  const dir =
    options.length > 1
      ? pickedDir !== undefined && options.some((option) => option.dir === pickedDir)
        ? pickedDir
        : (options[0]?.dir ?? null)
      : null
  return { options, dir, pick: (next) => setPicked({ request, dir: next }) }
}

export function ClaudeFolderPicker({
  options,
  dir,
  onPick
}: {
  options: ClaudeContinuationFolderOption[]
  dir: string | null
  onPick: (dir: string | null) => void
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium">
        {translate('components.agentSessionContinuation.claudeFolder', 'Claude account folder')}
      </label>
      <Select
        value={dir ?? DEFAULT_FOLDER_VALUE}
        onValueChange={(value) => onPick(value === DEFAULT_FOLDER_VALUE ? null : value)}
      >
        <SelectTrigger className="min-w-0 w-full" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.dir ?? DEFAULT_FOLDER_VALUE}
              value={option.dir ?? DEFAULT_FOLDER_VALUE}
            >
              {option.dir
                ? option.isSource
                  ? translate(
                      'components.agentSessionContinuation.claudeFolderSource',
                      '{{name}} (same as original session)',
                      { name: option.name }
                    )
                  : option.name
                : translate(
                    'components.agentSessionContinuation.claudeFolderDefault',
                    'Orca current account'
                  )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="break-all font-mono text-[11px] leading-4 text-muted-foreground">
        {dir ??
          translate(
            'components.agentSessionContinuation.claudeFolderDefaultHint',
            'Uses the account selected in Orca.'
          )}
      </p>
    </div>
  )
}
