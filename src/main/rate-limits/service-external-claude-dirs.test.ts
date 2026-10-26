import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type ExternalDirFixture = {
  userData: string
  origin: string
  now: number
  status: number
  retryAfter: string | null
  hold: boolean
  pending: ServerResponse | null
  arrived: () => void
  requests: string[]
}

const fixture = vi.hoisted((): ExternalDirFixture => ({
  userData: '',
  origin: '',
  now: 1800000000000,
  status: 200,
  retryAfter: '3600',
  hold: false,
  pending: null,
  arrived: () => {},
  requests: []
}))

vi.mock('electron', () => ({
  app: { getPath: () => fixture.userData }
}))

vi.mock('../network/proxy-settings', () => ({
  ensureElectronProxyFromEnvironment: vi.fn(async () => {})
}))
vi.mock('../claude-accounts/keychain', () => ({
  readActiveClaudeKeychainCredentialsStrict: vi.fn(async (configDir: string) => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    if (!configDir.startsWith(fixture.userData)) {
      throw new Error('Usage fixture must read its own tracked folder')
    }
    return readFile(join(configDir, '.credentials.json'), 'utf8')
  })
}))
vi.mock('./claude-pty', () => ({
  fetchViaPty: vi.fn(async () => {
    throw new Error('Usage fixture must not launch Claude')
  })
}))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: () => ({ status: 'missing' }) }))
vi.mock('./cursor-auth', () => ({ readCursorAuthSession: async () => ({ status: 'missing' }) }))
vi.mock('../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: () => false }))
vi.mock('../minimax/minimax-api-key-store', () => ({ hasMiniMaxApiKey: () => false }))
vi.mock('../zcode/zcode-plan-api-key-store', () => ({ hasZcodePlanApiKey: () => false }))
vi.mock('./codex-fetcher', () => ({
  fetchCodexRateLimits: async () => ({
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: fixture.now,
    error: null,
    status: 'unavailable'
  }),
  consumeCodexRateLimitResetCredit: vi.fn()
}))

import { RateLimitService } from './service'
import { setMainHttpClient } from '../network/http-client'

setMainHttpClient({
  fetch: (url, options) => {
    if (url !== 'https://api.anthropic.com/api/oauth/usage') {
      throw new Error('Unexpected endpoint in local usage fixture')
    }
    return globalThis.fetch(fixture.origin, options)
  },
  proxySession: () => null
})

let trackedDirs: string[] = []
let service: RateLimitService
let restoreClock: () => void

function dirToken(dir: string): string {
  return `synthetic-${dir
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop()}`
}

function reply(response: ServerResponse, status: number): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  if (status === 429 && fixture.retryAfter) {
    response.setHeader('Retry-After', fixture.retryAfter)
  }
  response.end(
    JSON.stringify(
      status === 200
        ? {
            five_hour: { utilization: 34, resets_at: '2027-01-16T14:00:00Z' },
            seven_day: { utilization: 12, resets_at: '2027-01-20T14:00:00Z' }
          }
        : { error: { message: 'Synthetic usage failure' } }
    )
  )
}

const server = createServer((request, response) => {
  const token = request.headers.authorization?.replace('Bearer ', '') ?? ''
  if (!trackedDirs.some((dir) => dirToken(dir) === token)) {
    response.writeHead(403).end()
    return
  }
  fixture.requests.push(token)
  if (fixture.hold) {
    fixture.pending = response
    fixture.arrived()
    return
  }
  reply(response, fixture.status)
})

function tracked(dir: string) {
  return service.getState().externalClaudeDirs.find((row) => row.accountId === dir)
}

beforeEach(async () => {
  fixture.userData = mkdtempSync(join(tmpdir(), 'orca-external-claude-dirs-'))
  fixture.now = 1800000000000
  fixture.status = 200
  fixture.retryAfter = '3600'
  fixture.hold = false
  fixture.pending = null
  fixture.requests = []
  trackedDirs = ['work', 'personal'].map((name) => {
    const path = join(fixture.userData, name)
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: `synthetic-${name}`,
          refreshToken: `synthetic-refresh-${name}`,
          expiresAt: 1900000000000
        }
      })
    )
    return path
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected local listener')
  }
  fixture.origin = `http://127.0.0.1:${address.port}`
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => fixture.now)
  restoreClock = () => clock.mockRestore()
  service = new RateLimitService()
  service.setExternalClaudeDirsResolver(() => trackedDirs)
})

afterEach(async () => {
  service?.stop()
  restoreClock?.()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(fixture.userData, { recursive: true, force: true })
})

it('reads each tracked folder from its own login and caches the usage', async () => {
  await service.fetchExternalClaudeDirsOnOpen()
  const [work, personal] = trackedDirs
  expect(tracked(work)?.rateLimits).toMatchObject({
    status: 'ok',
    session: { usedPercent: 34 },
    weekly: { usedPercent: 12 }
  })
  expect(tracked(personal)?.rateLimits?.status).toBe('ok')
  expect(fixture.requests.sort()).toEqual([dirToken(work), dirToken(personal)].sort())
  expect(service.getState().externalClaudeDirs.every((row) => !row.isFetching)).toBe(true)
})

it('debounces reopen, prunes untracked folders, and refetches forced changes', async () => {
  await service.fetchExternalClaudeDirsOnOpen()
  await service.fetchExternalClaudeDirsOnOpen()
  expect(fixture.requests).toHaveLength(2)

  fixture.now += 61_000
  const removed = trackedDirs[0]
  trackedDirs = [trackedDirs[1]]
  await service.fetchExternalClaudeDirsOnOpen()
  expect(tracked(removed)).toBeUndefined()

  // A settings change may land within the debounce; the folder must not wait a minute.
  fixture.now += 1
  trackedDirs = [...trackedDirs, removed]
  await service.refreshExternalClaudeDirs()
  expect(tracked(removed)?.rateLimits?.status).toBe('ok')
  expect(fixture.requests).toHaveLength(5)
})

it('keeps last-good windows when the usage endpoint rate-limits a folder', async () => {
  await service.fetchExternalClaudeDirsOnOpen()
  const originalAt = tracked(trackedDirs[0])?.rateLimits?.updatedAt
  fixture.now += 61_000
  fixture.status = 429
  await service.fetchExternalClaudeDirsOnOpen()
  expect(tracked(trackedDirs[0])?.rateLimits).toMatchObject({
    status: 'error',
    updatedAt: originalAt,
    session: { usedPercent: 34 },
    usageMetadata: { failureKind: 'rate-limited' }
  })
  // Retry-After holds until it elapses.
  await service.refreshExternalClaudeDirs()
  expect(fixture.requests).toHaveLength(4)
  fixture.now += 3_600_000
  fixture.status = 200
  await service.fetchExternalClaudeDirsOnOpen()
  expect(tracked(trackedDirs[0])?.rateLimits?.status).toBe('ok')
})

it('reports a folder without a login as missing credentials', async () => {
  writeFileSync(join(trackedDirs[0], '.credentials.json'), JSON.stringify({ claudeAiOauth: {} }))
  await service.fetchExternalClaudeDirsOnOpen()
  expect(tracked(trackedDirs[0])?.rateLimits).toMatchObject({
    status: 'error',
    usageMetadata: { failureKind: 'missing-credentials', authProvenance: 'external-dir' }
  })
  expect(tracked(trackedDirs[1])?.rateLimits?.status).toBe('ok')
})
