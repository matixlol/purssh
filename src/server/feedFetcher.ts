import type { Env } from '../env'

import { fetchWithTimeout } from './fetchWithTimeout'
import { parseFeedXml } from './rss'
import { sha256Base64Url } from './crypto'

const USER_AGENT = 'purssh/0.1 (+https://example.invalid)'

export type FeedRow = {
  id: string
  url: string
  title: string | null
  status: string
  last_success_at: number | null
  failing_since: number | null
  failed24h_notified_at: number | null
}

export type FetchOutcome =
  | {
      ok: true
      feedId: string
      newEntryCount: number
      latestEntry: { title: string; url: string } | null
      feedTitle: string | null
    }
  | {
      ok: false
      feedId: string
      error: string
    }

export const MS_24H = 24 * 60 * 60 * 1000

function nowMs() {
  return Date.now()
}

function normalizeUrl(url: string): string {
  return new URL(url).toString()
}

export function shouldPauseFeed(row: Pick<FeedRow, 'last_success_at' | 'failing_since'>, now: number): boolean {
  if (row.last_success_at != null && now - row.last_success_at > MS_24H) return true
  if (row.last_success_at == null && row.failing_since != null && now - row.failing_since > MS_24H) return true
  return false
}

export async function fetchAndStoreFeed(env: Env, feed: FeedRow): Promise<FetchOutcome> {
  const now = nowMs()

  try {
    const res = await fetchWithTimeout(feed.url, {
      timeoutMs: 15_000,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    })

    const body = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const parsed = parseFeedXml(body)
    const feedTitle = parsed.title ?? feed.title
    const siteUrl = parsed.siteUrl ? normalizeUrl(new URL(parsed.siteUrl, res.url).toString()) : null

    const entries = parsed.entries.slice(0, 50) // basic bound
    const statements: D1PreparedStatement[] = []
    const insertEntries: Array<{ title: string; url: string }> = []
    for (const e of entries) {
      const guidOrUrl = e.guidOrUrl.trim()
      if (!guidOrUrl) continue
      const url = e.url.trim()
      if (!url) continue
      const id = `entry_${await sha256Base64Url(`${feed.id}|${guidOrUrl}`)}`
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO entries (id, feed_id, guid_or_url, title, url, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(id, feed.id, guidOrUrl, e.title, url, e.publishedAtMs, now),
      )
      insertEntries.push({ title: e.title, url: e.url })
    }

    const results = statements.length ? await env.DB.batch(statements) : []
    let newEntryCount = 0
    let latestEntry: { title: string; url: string } | null = null
    for (let i = 0; i < results.length; i++) {
      const meta = results[i]!.meta as any
      const changes = typeof meta?.changes === 'number' ? meta.changes : 0
      if (changes > 0) {
        newEntryCount += 1
        const entry = insertEntries[i]!
        latestEntry = { title: entry.title, url: entry.url }
      }
    }

    await env.DB.prepare(
      `
      UPDATE feeds SET
        title = COALESCE(?, title),
        site_url = COALESCE(?, site_url),
        status = 'active',
        last_fetch_at = ?,
        last_success_at = ?,
        last_error_at = NULL,
        last_error = NULL,
        fail_count = 0,
        failing_since = NULL,
        failed24h_notified_at = NULL
      WHERE id = ?
    `,
    )
      .bind(feedTitle, siteUrl, now, now, feed.id)
      .run()

    await env.DB.prepare(
      'INSERT INTO fetch_logs (id, feed_id, fetched_at, ok, http_status, error) VALUES (?, ?, ?, 1, ?, NULL)',
    )
      .bind(`fl_${crypto.randomUUID()}`, feed.id, now, res.status)
      .run()

    return { ok: true, feedId: feed.id, newEntryCount, latestEntry, feedTitle }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    const now2 = nowMs()

    const newFailingSince = feed.failing_since ?? now2

    await env.DB.prepare(
      `
      UPDATE feeds SET
        status = 'failing',
        last_fetch_at = ?,
        last_error_at = ?,
        last_error = ?,
        fail_count = fail_count + 1,
        failing_since = ?
      WHERE id = ?
    `,
    )
      .bind(now2, now2, error, newFailingSince, feed.id)
      .run()

    await env.DB.prepare(
      'INSERT INTO fetch_logs (id, feed_id, fetched_at, ok, http_status, error) VALUES (?, ?, ?, 0, NULL, ?)',
    )
      .bind(`fl_${crypto.randomUUID()}`, feed.id, now2, error)
      .run()

    return { ok: false, feedId: feed.id, error }
  }
}
