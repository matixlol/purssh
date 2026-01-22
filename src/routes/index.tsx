import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useState } from 'react'
import { Bell, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'

import {
  discoverFeeds,
  ensureUser,
  getHomeData,
  getPushConfig,
  subscribeToFeed,
  unsubscribeFeed,
  upsertPushSubscription,
} from '../server/appFns'
import { subscribeToWebPush } from '../client/push'

const homeQueryKey = ['home-data']

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: homeQueryKey,
      queryFn: () => getHomeData(),
    })
  },
  component: Home,
})

function Home() {
  const queryClient = useQueryClient()
  const homeQueryFn = useServerFn(getHomeData)
  const homeQuery = useQuery({ queryKey: homeQueryKey, queryFn: homeQueryFn })
  const data = homeQuery.data ?? {
    userId: null,
    hasPushSubscription: false,
    feeds: [],
    entries: [],
  }

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [isStandalone, setIsStandalone] = useState(false)

  const [feedUrl, setFeedUrl] = useState('')
  const [candidates, setCandidates] = useState<Array<{ url: string; title: string | null; type: string | null }> | null>(
    null,
  )
  const [subscribingUrl, setSubscribingUrl] = useState<string | null>(null)

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
      'Tap "Add to Home Screen".',
      'Open the app from your Home Screen.',
    ]
  }, [])

  const getStartedMutation = useMutation({
    mutationFn: useServerFn(ensureUser),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: homeQueryKey }),
  })

  const pushMutation = useMutation({
    mutationFn: async () => {
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
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: homeQueryKey }),
  })

  const discoverMutation = useMutation({
    mutationFn: useServerFn(discoverFeeds),
    onSuccess: (res) => {
      setCandidates(res.candidates)
    },
  })

  const subscribeMutation = useMutation({
    mutationFn: useServerFn(subscribeToFeed),
    onSuccess: async () => {
      setCandidates(null)
      setFeedUrl('')
      await queryClient.cancelQueries({ queryKey: homeQueryKey })
      queryClient.removeQueries({ queryKey: homeQueryKey })
      await queryClient.fetchQuery({ queryKey: homeQueryKey, queryFn: homeQueryFn })
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: useServerFn(unsubscribeFeed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: homeQueryKey }),
  })

  function onDiscover() {
    discoverMutation.reset()
    subscribeMutation.reset()
    setCandidates(null)
    discoverMutation.mutate({ data: { url: feedUrl } })
  }

  function onSubscribe(url: string) {
    subscribeMutation.reset()
    setSubscribingUrl(url)
    subscribeMutation.mutate({ data: { feedUrl: url } })
  }

  const discoverError = discoverMutation.error?.message
  const subscribeError = subscribeMutation.error?.message === 'feed_limit_reached'
    ? 'Feed limit reached (max 15).'
    : subscribeMutation.error?.message
  const getStartedError = getStartedMutation.error?.message === 'ip_user_limit_reached'
    ? 'Too many accounts created from this IP address.'
    : getStartedMutation.error?.message

  if (!data.userId) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
        <section className="space-y-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-center">
            <h2 className="text-lg font-semibold text-white">Welcome to Purssh</h2>
            <p className="mt-2 text-sm text-slate-300">
              Get push notifications for your favorite RSS feeds.
            </p>
            <button
              type="button"
              onClick={() => getStartedMutation.mutate({})}
              disabled={getStartedMutation.isPending}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {getStartedMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              Get Started
            </button>
            {getStartedError && (
              <p className="mt-3 text-sm text-red-400">{getStartedError}</p>
            )}
          </div>
        </section>
      </main>
    )
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
                  onClick={() => pushMutation.mutate()}
                  disabled={pushMutation.isPending || permission === 'unsupported' || permission === 'denied'}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {pushMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                  {permission === 'granted' ? 'Set up push' : 'Enable'}
                </button>
                {data.hasPushSubscription && (
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                    Active
                  </span>
                )}
              </div>

              {pushMutation.error && <div className="mt-3 text-sm text-rose-300">{pushMutation.error.message}</div>}
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
              disabled={!feedUrl || discoverMutation.isPending}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {discoverMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Find
            </button>
          </div>
          {discoverError && <div className="mt-2 text-sm text-rose-300">{discoverError}</div>}
          {discoverMutation.isSuccess && candidates?.length === 0 && (
            <div className="mt-2 text-sm text-rose-300">No RSS/Atom feeds found at that URL.</div>
          )}
          {subscribeError && <div className="mt-2 text-sm text-rose-300">{subscribeError}</div>}

          {candidates && candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => onSubscribe(c.url)}
                  disabled={subscribeMutation.isPending && subscribingUrl === c.url}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-left text-sm hover:border-cyan-500/40 disabled:opacity-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{c.title ?? c.url}</div>
                      <div className="mt-1 truncate text-xs text-slate-400">{c.url}</div>
                      {c.type && <div className="mt-1 text-xs text-slate-500">{c.type}</div>}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-cyan-200">
                      {subscribeMutation.isPending && subscribingUrl === c.url ? 'Adding…' : 'Subscribe'}
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
                  onClick={() => unsubscribeMutation.mutate({ data: { feedId: f.id } })}
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
