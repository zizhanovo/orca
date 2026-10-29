import { claudeConfigDirFromTranscript } from '../../../../shared/tui-agent-resume-startup'
import { resolveTuiAgentLaunchEnv } from '../../../../shared/tui-agent-launch-defaults'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type ClaudeContinuationFolderOption = {
  /** Absolute CLAUDE_CONFIG_DIR; null means Orca's own account routing decides. */
  dir: string | null
  /** Short folder name, so similar folders stay apart at a glance. */
  name: string
  /** The folder holding the session being handed off. */
  isSource: boolean
}

export function isClaudeFamilyAgent(agent: TuiAgent | null | undefined): boolean {
  return agent === 'claude' || agent === 'claude-agent-teams'
}

function folderName(dir: string): string {
  return (
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || dir
  )
}

function sameDir(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '')
}

/** Source folder first (when the session came from Claude), then tracked folders; null (Orca default) is always offered. */
export function buildClaudeContinuationFolderOptions(args: {
  sourceAgent: TuiAgent | null
  transcriptPath: string | null | undefined
  trackedDirs: readonly string[]
}): ClaudeContinuationFolderOption[] {
  const sourceDir = isClaudeFamilyAgent(args.sourceAgent)
    ? claudeConfigDirFromTranscript(args.transcriptPath ?? undefined)
    : null
  const options: ClaudeContinuationFolderOption[] = []
  if (sourceDir) {
    options.push({
      dir: sourceDir,
      name: folderName(sourceDir),
      isSource: true
    })
  }
  for (const dir of args.trackedDirs) {
    if (!options.some((option) => option.dir && sameDir(option.dir, dir))) {
      options.push({ dir, name: folderName(dir), isSource: false })
    }
  }
  options.push({ dir: null, name: '', isSource: false })
  return options
}

/** Launch env for an agent, plus another Claude config folder when one was picked (Claude family only). */
export function launchEnvWithClaudeDir(
  agent: TuiAgent,
  settings: Parameters<typeof resolveTuiAgentLaunchEnv>[1],
  platform: NodeJS.Platform,
  { claudeConfigDir }: { claudeConfigDir?: string | null }
): Record<string, string> {
  return {
    ...resolveTuiAgentLaunchEnv(agent, settings, platform),
    ...(claudeConfigDir && isClaudeFamilyAgent(agent) ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {})
  }
}
