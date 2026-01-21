import { createServerFn } from '@tanstack/react-start'

import { getStartContext, getStartContextOrThrow } from './startContext'
import { fetchWithTimeout } from './fetchWithTimeout'
import { createUser } from './user'

type SubscribedFeed = {
  id: string
  url: string
  title: string | null
  site_url: string | null
  status: string
  last_success_at: number | null
  last_error_at: number | null
  last_error: string | null
  fail_count: number
  paused_at: number | null
}

type EntryRow = {
  id: string
  feed_id: string
  feed_title: string | null
  title: string
  url: string
  published_at: number | null
  fetched_at: number
}

export const getHomeData = createServerFn({ method: 'GET' }).handler(async (ctx) => {
  const context = getStartContext(ctx)

  if (!context.userId) {
    return {
      userId: null,
      hasPushSubscription: false,
      feeds: [] as SubscribedFeed[],
      entries: [] as EntryRow[],
    }
  }

  const { env, userId } = context

  const feeds = await env.DB.prepare(
    `
    SELECT
      f.id,
      f.url,
      f.title,
      f.site_url,
      f.status,
      f.last_success_at,
      f.last_error_at,
      f.last_error,
      f.fail_count,
      f.paused_at
    FROM subscriptions s
    JOIN feeds f ON f.id = s.feed_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `,
  )
    .bind(userId)
    .all<SubscribedFeed>()

  const entries = await env.DB.prepare(
    `
    SELECT
      e.id,
      e.feed_id,
      f.title as feed_title,
      e.title,
      e.url,
      e.published_at,
      e.fetched_at
    FROM subscriptions s
    JOIN entries e ON e.feed_id = s.feed_id
    JOIN feeds f ON f.id = e.feed_id
    WHERE s.user_id = ?
    ORDER BY COALESCE(e.published_at, e.fetched_at) DESC
    LIMIT 50
  `,
  )
    .bind(userId)
    .all<EntryRow>()

  const pushSub = await env.DB.prepare(
    `SELECT id FROM push_subscriptions WHERE user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string }>()

  return {
    userId,
    hasPushSubscription: Boolean(pushSub?.id),
    feeds: feeds.results ?? [],
    entries: entries.results ?? [],
  }
})

type DiscoverCandidate = {
  url: string
  title: string | null
  type: string | null
}

function looksLikeFeedXml(body: string): boolean {
  const start = body.trim().slice(0, 200).toLowerCase()
  return (
    start.startsWith('<?xml') ||
    start.includes('<rss') ||
    start.includes('<feed') ||
    start.includes('<rdf:rdf')
  )
}

function extractLinkTags(html: string): Array<{ rel: string; type: string | null; href: string; title: string | null }> {
  const candidates: Array<{ rel: string; type: string | null; href: string; title: string | null }> = []
  const linkTagRe = /<link\b[^>]*>/gi
  const attrRe = /(\w[\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi

  for (const tag of html.match(linkTagRe) ?? []) {
    const attrs: Record<string, string> = {}
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(tag))) {
      const key = m[1]!.toLowerCase()
      const value = (m[3] ?? m[4] ?? m[5] ?? '').trim()
      attrs[key] = value
    }
    if (!attrs.href) continue
    candidates.push({
      rel: (attrs.rel ?? '').toLowerCase(),
      type: attrs.type ?? null,
      href: attrs.href,
      title: attrs.title ?? null,
    })
  }

  return candidates
}

export const discoverFeeds = createServerFn({ method: 'POST' })
  .handler(async (ctx) => {
    const { url } = (ctx.data ?? {}) as { url?: string }
    if (!url) throw new Error('Missing url')

    const parsed = new URL(url)
    const res = await fetchWithTimeout(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'purssh/0.1 (+https://example.invalid)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeoutMs: 15_000,
    })

    const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
    const body = await res.text()

    if (contentType.includes('xml') || looksLikeFeedXml(body)) {
      return {
        pageUrl: res.url,
        candidates: [{ url: res.url, title: null, type: contentType || 'application/xml' }] satisfies DiscoverCandidate[],
      }
    }

    const links = extractLinkTags(body)
      .filter((l) => l.rel.includes('alternate'))
      .filter((l) => {
        const t = (l.type ?? '').toLowerCase()
        return (
          t.includes('application/rss+xml') ||
          t.includes('application/atom+xml') ||
          t.includes('application/xml') ||
          t.includes('text/xml') ||
          t.includes('application/feed+json')
        )
      })
      .map((l) => {
        const absolute = new URL(l.href, res.url).toString()
        return { url: absolute, title: l.title, type: l.type }
      })

    const deduped = new Map<string, DiscoverCandidate>()
    for (const c of links) deduped.set(c.url, c)

    return { pageUrl: res.url, candidates: Array.from(deduped.values()) }
  })

export const subscribeToFeed = createServerFn({ method: 'POST' }).handler(async (ctx) => {
  const { env, userId } = getStartContextOrThrow(ctx)
  const { feedUrl } = (ctx.data ?? {}) as { feedUrl?: string }
  if (!feedUrl) throw new Error('Missing feedUrl')

  const subCount = await env.DB.prepare('SELECT COUNT(1) as c FROM subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<{ c: number }>()
  if ((subCount?.c ?? 0) >= 15) {
    throw new Error('feed_limit_reached')
  }

  const existingFeed = await env.DB.prepare('SELECT id FROM feeds WHERE url = ? LIMIT 1')
    .bind(feedUrl)
    .first<{ id: string }>()
  const feedId = existingFeed?.id ?? `feed_${crypto.randomUUID()}`

  if (!existingFeed?.id) {
    await env.DB.prepare(
      'INSERT INTO feeds (id, url, created_at, status, fail_count) VALUES (?, ?, ?, ?, 0)',
    )
      .bind(feedId, feedUrl, Date.now(), 'active')
      .run()
  }

  const subscriptionId = `sub_${crypto.randomUUID()}`
  await env.DB.prepare(
    'INSERT OR IGNORE INTO subscriptions (id, user_id, feed_id, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(subscriptionId, userId, feedId, Date.now())
    .run()

  return { ok: true, feedId }
})

export const unsubscribeFeed = createServerFn({ method: 'POST' }).handler(async (ctx) => {
  const { env, userId } = getStartContextOrThrow(ctx)
  const { feedId } = (ctx.data ?? {}) as { feedId?: string }
  if (!feedId) throw new Error('Missing feedId')

  await env.DB.prepare('DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?')
    .bind(userId, feedId)
    .run()

  return { ok: true }
})

export const upsertPushSubscription = createServerFn({ method: 'POST' }).handler(async (ctx) => {
  const { env, userId } = getStartContextOrThrow(ctx)
  const { endpoint, p256dh, auth } = (ctx.data ?? {}) as {
    endpoint?: string
    p256dh?: string
    auth?: string
  }
  if (!endpoint || !p256dh || !auth) throw new Error('Missing subscription fields')

  const existing = await env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? LIMIT 1')
    .bind(endpoint)
    .first<{ id: string }>()

  if (existing?.id) {
    await env.DB.prepare(
      'UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, last_used_at = ? WHERE id = ?',
    )
      .bind(userId, p256dh, auth, Date.now(), existing.id)
      .run()
    return { ok: true }
  }

  await env.DB.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(`ps_${crypto.randomUUID()}`, userId, endpoint, p256dh, auth, Date.now(), Date.now())
    .run()

  return { ok: true }
})

export const getPushConfig = createServerFn({ method: 'GET' }).handler(async (ctx) => {
  const { env } = getStartContext(ctx)
  return {
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
  }
})

export const ensureUser = createServerFn({ method: 'POST' }).handler(async (ctx) => {
  const context = getStartContext(ctx)

  if (context.userId) {
    return { userId: context.userId, setCookieHeader: null }
  }

  const identity = await createUser(context.env.DB, context.ip)
  return { userId: identity.userId, setCookieHeader: identity.setCookieHeader }
})
