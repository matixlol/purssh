import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import pMap from 'p-map'

import { withSetCookie } from './server/http'
import { getUserIdentity } from './server/user'
import type { NotifyMessage } from './server/notify'
import { fetchAndStoreFeed, shouldPauseFeed } from './server/feedFetcher'

import { deserializeVapidKeys, sendPushNotification } from 'web-push-browser'

import type { Env } from './env'

type StartRequestContext = {
  env: Env
  request: Request
  cf?: Request['cf']
  waitUntil: ExecutionContext['waitUntil']
  userId: string | null
  ip: string
}

const startHandler = createStartHandler(defaultStreamHandler)

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const identity = await getUserIdentity(request, env.DB)
    const response = await startHandler(request, {
      context: {
        env,
        request,
        cf: request.cf,
        waitUntil: ctx.waitUntil.bind(ctx),
        userId: identity.userId,
        ip: identity.ip,
      } satisfies StartRequestContext,
    })
    return withSetCookie(response, identity.setCookieHeader)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = Date.now()

    const feedsRes = await env.DB.prepare(
      `
      SELECT
        id,
        url,
        title,
        status,
        last_success_at,
        failing_since,
        failed24h_notified_at
      FROM feeds
      WHERE status != 'paused'
    `,
    ).all<{
      id: string
      url: string
      title: string | null
      status: string
      last_success_at: number | null
      failing_since: number | null
      failed24h_notified_at: number | null
    }>()

    const feeds = feedsRes.results ?? []

    // Pause stale feeds and enqueue a one-time failure notification per failure episode.
    for (const f of feeds) {
      if (!shouldPauseFeed({ last_success_at: f.last_success_at, failing_since: f.failing_since }, now)) continue

      await env.DB.prepare(
        `UPDATE feeds SET status = 'paused', paused_at = COALESCE(paused_at, ?) WHERE id = ?`,
      )
        .bind(now, f.id)
        .run()

      if (f.failed24h_notified_at != null) continue

      const subs = await env.DB.prepare('SELECT user_id FROM subscriptions WHERE feed_id = ?')
        .bind(f.id)
        .all<{ user_id: string }>()
      const messages: NotifyMessage[] = (subs.results ?? []).map((s) => ({
        type: 'feed:failed24h',
        userId: s.user_id,
        feedId: f.id,
        title: 'Feed failing',
        body: `${f.title ?? f.url} has not fetched successfully in over 24 hours.`,
        url: '/',
      }))

      for (const batch of chunk(messages, 100)) {
        await env.NOTIFY_QUEUE.sendBatch(batch.map((m) => ({ body: m, contentType: 'json' })))
      }

      await env.DB.prepare(`UPDATE feeds SET failed24h_notified_at = ? WHERE id = ?`)
        .bind(now, f.id)
        .run()
    }

    const fetchable = feeds.filter((f) => {
      return !shouldPauseFeed({ last_success_at: f.last_success_at, failing_since: f.failing_since }, now)
    })

    const outcomes = await pMap(
      fetchable,
      async (f) => {
        return await fetchAndStoreFeed(env, f)
      },
      { concurrency: 6 },
    )

    // Enqueue notifications for new entries.
    const notify: NotifyMessage[] = []
    for (const outcome of outcomes) {
      if (!outcome.ok) continue
      if (outcome.newEntryCount <= 0 || !outcome.latestEntry) continue

      const subs = await env.DB.prepare('SELECT user_id FROM subscriptions WHERE feed_id = ?')
        .bind(outcome.feedId)
        .all<{ user_id: string }>()
      for (const s of subs.results ?? []) {
        notify.push({
          type: 'entry:new',
          userId: s.user_id,
          feedId: outcome.feedId,
          title: outcome.feedTitle ? `New: ${outcome.feedTitle}` : 'New entry',
          body:
            outcome.newEntryCount === 1
              ? outcome.latestEntry.title
              : `${outcome.latestEntry.title} (+${outcome.newEntryCount - 1} more)`,
          url: outcome.latestEntry.url,
        })
      }
    }

    for (const batch of chunk(notify, 100)) {
      await env.NOTIFY_QUEUE.sendBatch(batch.map((m) => ({ body: m, contentType: 'json' })))
    }

    ctx.waitUntil(Promise.resolve())
  },
  async queue(batch: MessageBatch<NotifyMessage>, env: Env, _ctx: ExecutionContext) {
    if (!env.VAPID_PRIVATE_KEY) {
      batch.retryAll({ delaySeconds: 60 })
      return
    }

    const keyPair = await deserializeVapidKeys({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    })

    await pMap(
      batch.messages,
      async (message) => {
        try {
          const body = message.body
          const subsRes = await env.DB.prepare(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
          )
            .bind(body.userId)
            .all<{ id: string; endpoint: string; p256dh: string; auth: string }>()

          const subs = subsRes.results ?? []
          if (subs.length === 0) {
            message.ack()
            return
          }

          const payload = JSON.stringify({
            title: body.title,
            body: body.body,
            url: body.url,
            kind: body.type,
            feedId: body.feedId,
          })

          for (const sub of subs) {
            const res = await sendPushNotification(
              keyPair,
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              env.VAPID_SUBJECT,
              payload,
              { algorithm: 'aes128gcm' },
            )

            if (res.status === 404 || res.status === 410) {
              await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run()
            } else if (!res.ok) {
              throw new Error(`push_failed_${res.status}`)
            }
          }

          message.ack()
        } catch {
          message.retry({ delaySeconds: 30 })
        }
      },
      { concurrency: 6 },
    )
  },
} satisfies ExportedHandler<Env>
