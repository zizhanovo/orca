import { fetchExternalClaudeConfigDirUsage } from '../claude-external-config-dir-usage'
import { RateLimitServicePolling } from './service-polling'
import { INACTIVE_FETCH_DEBOUNCE_MS } from './service-types'

export abstract class RateLimitServiceExternalClaudeDirs extends RateLimitServicePolling {
  async fetchExternalClaudeDirsOnOpen(options: { force?: boolean } = {}): Promise<void> {
    if (
      !options.force &&
      Date.now() - this.lastExternalClaudeDirFetchAt < INACTIVE_FETCH_DEBOUNCE_MS
    ) {
      return
    }
    this.pruneExternalClaudeDirState()
    if (this.externalClaudeDirFetching.size > 0) {
      return
    }
    const dirs = (this.externalClaudeDirsResolver?.() ?? []).filter(
      (dir) => !this.isRetryAfterActive(this.externalClaudeDirCache.get(dir) ?? null)
    )
    if (dirs.length === 0) {
      return
    }
    const fetchGeneration = this.externalClaudeDirsGeneration
    const controller = this.beginFetchCycle()
    const signal = controller.signal

    for (const dir of dirs) {
      this.externalClaudeDirFetching.add(dir)
    }
    this.pushToRenderer()

    try {
      for (const dir of dirs) {
        if (
          signal.aborted ||
          fetchGeneration !== this.externalClaudeDirsGeneration ||
          !this.isCurrentExternalClaudeDir(dir)
        ) {
          this.externalClaudeDirFetching.delete(dir)
          if (!this.isCurrentExternalClaudeDir(dir)) {
            this.externalClaudeDirCache.delete(dir)
          }
          this.pushToRenderer()
          continue
        }
        try {
          const fresh = await fetchExternalClaudeConfigDirUsage(dir, { signal })
          if (
            signal.aborted ||
            fetchGeneration !== this.externalClaudeDirsGeneration ||
            !this.isCurrentExternalClaudeDir(dir)
          ) {
            this.externalClaudeDirFetching.delete(dir)
            if (!this.isCurrentExternalClaudeDir(dir)) {
              this.externalClaudeDirCache.delete(dir)
            }
            this.pushToRenderer()
            continue
          }
          const cached = this.externalClaudeDirCache.get(dir) ?? null
          this.externalClaudeDirCache.set(dir, this.applyStalePolicy(fresh, cached))
        } catch {
          // Isolate one folder's filesystem/Keychain failure so sibling partitions continue.
          if (
            signal.aborted ||
            fetchGeneration !== this.externalClaudeDirsGeneration ||
            !this.isCurrentExternalClaudeDir(dir)
          ) {
            this.externalClaudeDirCache.delete(dir)
          }
        }
        this.externalClaudeDirFetching.delete(dir)
        this.pushToRenderer()
      }

      if (!signal.aborted && fetchGeneration === this.externalClaudeDirsGeneration) {
        this.lastExternalClaudeDirFetchAt = Date.now()
      }
    } finally {
      this.finishFetchCycle(controller)
    }
  }

  /** A settings change can add a dir within the open debounce; refetch it immediately. */
  refreshExternalClaudeDirs(): Promise<void> {
    this.lastExternalClaudeDirFetchAt = 0
    return this.fetchExternalClaudeDirsOnOpen({ force: true })
  }

  protected isCurrentExternalClaudeDir(dir: string): boolean {
    return (this.externalClaudeDirsResolver?.() ?? []).includes(dir)
  }

  protected pruneExternalClaudeDirState(): void {
    const currentDirs = new Set(this.externalClaudeDirsResolver?.() ?? [])
    for (const dir of this.externalClaudeDirCache.keys()) {
      if (!currentDirs.has(dir)) {
        this.externalClaudeDirCache.delete(dir)
      }
    }
    for (const dir of this.externalClaudeDirFetching) {
      if (!currentDirs.has(dir)) {
        this.externalClaudeDirFetching.delete(dir)
      }
    }
  }
}
