import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Bell, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'

import {
  discoverFeeds,
  getHomeData,
  getPushConfig,
  subscribeToFeed,
  unsubscribeFeed,
  upsertPushSubscription,
} from '../server/appFns'
import { subscribeToWebPush } from '../client/push'

export const Route = createFileRoute('/')({
  loader: async () => await getHomeData(),
  component: Home,
})

function Home() {
  const data = Route.useLoaderData()
  const router = useRouter()

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [isStandalone, setIsStandalone] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  const [feedUrl, setFeedUrl] = useState('')
  const [discoverBusy, setDiscoverBusy] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Array<{ url: string; title: string | null; type: string | null }> | null>(
    null,
  )
  const [subscribeBusyUrl, setSubscribeBusyUrl] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)

  useEffect(() => {
    if (!('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission)
  }, [])

  useEffect(() => {
    const update = () => {
      const standalone =
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        // @ts-expect-error - iOS Safari legacy
        window.navigator.standalone === true
      setIsStandalone(Boolean(standalone))
    }
    update()
    window.addEventListener('visibilitychange', update)
    return () => window.removeEventListener('visibilitychange', update)
  }, [])

  const installSteps = useMemo(() => {
    return [
      'Tap the Share button (square with arrow).',
      'Tap “Add to Home Screen”.',
      'Open the app from your Home Screen.',
    ]
  }, [])

  async function onEnableNotifications() {
    setPushError(null)
    setPushBusy(true)
    try {
      if (!('Notification' in window)) throw new Error('Notifications not supported')
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return

      const config = await getPushConfig()
      const sub = await subscribeToWebPush(config.vapidPublicKey)
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Invalid PushSubscription')
      }
      await upsertPushSubscription({
        data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      })
      await router.invalidate()
    } catch (e) {
      setPushError(e instanceof Error ? e.message : 'Failed to enable notifications')
    } finally {
      setPushBusy(false)
    }
  }

  async function onDiscover() {
    setDiscoverError(null)
    setSubscribeError(null)
    setCandidates(null)
    setDiscoverBusy(true)
    try {
      const res = await discoverFeeds({ data: { url: feedUrl } })
      setCandidates(res.candidates)
      if (res.candidates.length === 0) {
        setDiscoverError('No RSS/Atom feeds found at that URL.')
      }
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Failed to discover feeds')
    } finally {
      setDiscoverBusy(false)
    }
  }

  async function onSubscribe(url: string) {
    setSubscribeError(null)
    setSubscribeBusyUrl(url)
    try {
      await subscribeToFeed({ data: { feedUrl: url } })
      setCandidates(null)
      setFeedUrl('')
      await router.invalidate()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to subscribe'
      if (msg === 'feed_limit_reached') {
        setSubscribeError('Feed limit reached (max 15).')
      } else {
        setSubscribeError(msg)
      }
    } finally {
      setSubscribeBusyUrl(null)
    }
  }

  async function onUnsubscribe(feedId: string) {
    await unsubscribeFeed({ data: { feedId } })
    await router.invalidate()
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
      <section className="space-y-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-slate-800 p-2">
              <Bell className="h-5 w-5 text-slate-100" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">Enable notifications</div>
              <div className="mt-1 text-sm text-slate-300">
                {permission === 'unsupported' && 'This browser does not support notifications.'}
                {permission === 'default' && 'Turn on push so you can get alerts when new entries arrive.'}
                {permission === 'denied' && 'Notifications are blocked for this site. Enable them in Settings.'}
                {permission === 'granted' &&
                  (data.hasPushSubscription ? 'Notifications are enabled.' : 'Permission granted — finish setup.')}
              </div>

              {!isStandalone && (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                  <div className="font-semibold">iOS required step: install the app</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {installSteps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onEnableNotifications}
                  disabled={pushBusy || permission === 'unsupported' || permission === 'denied'}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {pushBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                  {permission === 'granted' ? 'Set up push' : 'Enable'}
                </button>
                {data.hasPushSubscription && (
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                    Active
                  </span>
                )}
              </div>

              {pushError && <div className="mt-3 text-sm text-rose-300">{pushError}</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-sm font-semibold text-white">Add a feed</div>
          <div className="mt-2 flex gap-2">
            <input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              inputMode="url"
              placeholder="Paste a site or RSS URL"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={onDiscover}
              disabled={!feedUrl || discoverBusy}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {discoverBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Find
            </button>
          </div>
          {discoverError && <div className="mt-2 text-sm text-rose-300">{discoverError}</div>}
          {subscribeError && <div className="mt-2 text-sm text-rose-300">{subscribeError}</div>}

          {candidates && candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => onSubscribe(c.url)}
                  disabled={subscribeBusyUrl === c.url}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-left text-sm hover:border-cyan-500/40 disabled:opacity-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{c.title ?? c.url}</div>
                      <div className="mt-1 truncate text-xs text-slate-400">{c.url}</div>
                      {c.type && <div className="mt-1 text-xs text-slate-500">{c.type}</div>}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-cyan-200">
                      {subscribeBusyUrl === c.url ? 'Adding…' : 'Subscribe'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Subscribed feeds</h2>
          <div className="text-xs text-slate-500">{data.feeds.length}/15</div>
        </div>
        <div className="mt-3 space-y-2">
          {data.feeds.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
              No feeds yet. Add one above.
            </div>
          )}
          {data.feeds.map((f) => (
            <div key={f.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{f.title ?? f.url}</div>
                  <a
                    className="mt-1 inline-flex items-center gap-1 truncate text-xs text-slate-400"
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.url} <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">{f.status}</span>
                    {f.last_error && (
                      <span className="rounded-full bg-rose-500/15 px-2 py-1 text-rose-200">
                        {f.last_error.slice(0, 80)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUnsubscribe(f.id)}
                  className="rounded-xl bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
                  aria-label="Unsubscribe"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-white">Latest entries</h2>
        <div className="mt-3 space-y-2">
          {data.entries.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300">
              No entries yet.
            </div>
          )}
          {data.entries.map((e) => (
            <a
              key={e.id}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl border border-slate-800 bg-slate-900/40 p-4 hover:border-cyan-500/40"
            >
              <div className="text-xs text-slate-400">{e.feed_title ?? 'Feed'}</div>
              <div className="mt-1 text-sm font-semibold text-white">{e.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {e.published_at ? new Date(e.published_at).toLocaleString() : '—'}
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}
