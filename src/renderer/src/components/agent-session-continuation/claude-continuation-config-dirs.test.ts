import { describe, expect, it } from 'vitest'
import { buildClaudeContinuationFolderOptions } from './claude-continuation-config-dirs'

describe('buildClaudeContinuationFolderOptions', () => {
  const transcriptPath = '/h/.claude-profiles/c3/projects/-p/abc.jsonl'

  it('leads with the source folder and does not repeat it when tracked', () => {
    const options = buildClaudeContinuationFolderOptions({
      sourceAgent: 'claude',
      transcriptPath,
      trackedDirs: ['/h/.claude-profiles/c3/', '/h/.claude-profiles/c5']
    })
    expect(options.map((o) => [o.dir, o.isSource])).toEqual([
      ['/h/.claude-profiles/c3', true],
      ['/h/.claude-profiles/c5', false],
      [null, false]
    ])
  })

  it('ignores the transcript of a non-Claude source', () => {
    const options = buildClaudeContinuationFolderOptions({
      sourceAgent: 'pi',
      transcriptPath,
      trackedDirs: []
    })
    expect(options).toEqual([{ dir: null, name: '', isSource: false }])
  })
})
