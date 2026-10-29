import { describe, expect, it } from 'vitest'
import {
  buildAgentResumeStartupPlan,
  claudeConfigDirFromTranscript
} from './tui-agent-resume-startup'

describe('claudeConfigDirFromTranscript', () => {
  it('returns the folder holding projects/', () => {
    expect(
      claudeConfigDirFromTranscript('/Users/a/.claude-profiles/c3/projects/-x-y/abc.jsonl')
    ).toBe('/Users/a/.claude-profiles/c3')
    expect(claudeConfigDirFromTranscript('C:\\Users\\a\\.claude\\projects\\p\\abc.jsonl')).toBe(
      'C:\\Users\\a\\.claude'
    )
  })
  it('ignores other shapes', () => {
    expect(claudeConfigDirFromTranscript('/tmp/abc.jsonl')).toBeNull()
    expect(claudeConfigDirFromTranscript(undefined)).toBeNull()
  })
})

describe('resume plan config dir', () => {
  const base = {
    agent: 'claude' as const,
    cmdOverrides: {},
    platform: 'darwin' as const
  }
  const session = {
    key: 'session_id' as const,
    id: 'd779dcfd-98ac-455a-965c-245443217584',
    transcriptPath: '/h/.claude-profiles/c3/projects/-p/d779dcfd.jsonl'
  }
  it('points resume at the transcript folder', () => {
    expect(buildAgentResumeStartupPlan({ ...base, providerSession: session })?.env).toEqual({
      CLAUDE_CONFIG_DIR: '/h/.claude-profiles/c3'
    })
  })
  it('keeps an explicit CLAUDE_CONFIG_DIR', () => {
    const plan = buildAgentResumeStartupPlan({
      ...base,
      providerSession: session,
      agentEnv: { CLAUDE_CONFIG_DIR: '/x' }
    })
    expect(plan?.env).toEqual({ CLAUDE_CONFIG_DIR: '/x' })
  })
})
