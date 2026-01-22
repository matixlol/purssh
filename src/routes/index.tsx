import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useState } from 'react'
import { Bell, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'

import {
  discoverFeeds,
  deletePushSubscriptions,
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
  const [isIOS, setIsIOS] = useState(false)

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

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent)
    setIsIOS(isIOSDevice)
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

  const disablePushMutation = useMutation({
    mutationFn: async () => {
      let endpoint: string | undefined

      if ('serviceWorker' in navigator) {
        const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
        const existing = await reg.pushManager.getSubscription()
        endpoint = existing?.endpoint
        if (existing) await existing.unsubscribe()
      }

      await deletePushSubscriptions({ data: endpoint ? { endpoint } : {} })
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

  const notificationsEnabled = permission === 'granted' && data.hasPushSubscription

  if (!data.userId) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
        <section className="space-y-3">
          <div className="rounded-2xl border border-primary bg-secondary p-4 text-center">
            <h2 className="text-lg font-semibold text-primary">Welcome to Purssh</h2>
            <p className="mt-2 text-sm text-secondary">
              Get push notifications for your favorite RSS feeds.
            </p>
            <button
              type="button"
              onClick={() => getStartedMutation.mutate({})}
              disabled={getStartedMutation.isPending}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl accent-bg px-6 py-2.5 text-sm font-semibold accent-text disabled:opacity-50"
            >
              {getStartedMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              Get Started
            </button>
            {getStartedError && (
              <p className="mt-3 text-sm text-error">{getStartedError}</p>
            )}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-4">
      <section className="space-y-3">
        {notificationsEnabled ? (
          <div className="rounded-2xl border border-primary bg-secondary p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm">
                <Bell className="h-4 w-4 text-success" />
                <span className="font-medium text-primary">Notifications are enabled</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm('Disable notifications?')
                  if (!ok) return
                  disablePushMutation.mutate()
                }}
                disabled={disablePushMutation.isPending}
                className="inline-flex items-center justify-center rounded-xl bg-tertiary px-3 py-2 text-sm font-semibold text-primary hover:opacity-80 disabled:opacity-50"
              >
                {disablePushMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Disable'}
              </button>
            </div>
            {disablePushMutation.error && (
              <div className="mt-2 text-sm text-error">{disablePushMutation.error.message}</div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-primary bg-secondary p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-tertiary p-2">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-primary">Enable notifications</div>
                <div className="mt-1 text-sm text-secondary">
                  {permission === 'unsupported' && 'This browser does not support notifications.'}
                  {permission === 'default' && 'Enable notifications to get alerts when new entries arrive.'}
                  {permission === 'denied' && 'Notifications are blocked for this site. Enable them in Settings.'}
                  {permission === 'granted' && 'Enable notifications to set up push.'}
                </div>

                {!isStandalone && isIOS && (
                  <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
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
                    className="inline-flex items-center justify-center gap-2 rounded-xl accent-bg px-4 py-2 text-sm font-semibold accent-text disabled:opacity-50"
                  >
                    {pushMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                    Enable notifications
                  </button>
                </div>

                {pushMutation.error && <div className="mt-3 text-sm text-error">{pushMutation.error.message}</div>}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 space-y-3">
        <div className="rounded-2xl border border-primary bg-secondary p-4">
          <div className="text-sm font-semibold text-primary">Add a feed</div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onDiscover()
            }}
            className="mt-2 flex gap-2"
          >
            <input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              inputMode="url"
              placeholder="Paste a site or RSS URL"
              className="w-full rounded-xl border border-secondary bg-primary px-3 py-2 text-base text-primary placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!feedUrl || discoverMutation.isPending}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-tertiary px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50"
            >
              {discoverMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Find
            </button>
          </form>
          {discoverError && <div className="mt-2 text-sm text-error">{discoverError}</div>}
          {discoverMutation.isSuccess && candidates?.length === 0 && (
            <div className="mt-2 text-sm text-error">No RSS/Atom feeds found at that URL.</div>
          )}
          {subscribeError && <div className="mt-2 text-sm text-error">{subscribeError}</div>}

          {candidates && candidates.length > 0 && (
            <div className="mt-3 space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => onSubscribe(c.url)}
                  disabled={subscribeMutation.isPending && subscribingUrl === c.url}
                  className="w-full rounded-xl border border-primary bg-primary p-3 text-left text-sm hover:bg-secondary disabled:opacity-50"
                >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-primary">{c.title ?? c.url}</div>
                        <div className="mt-1 truncate text-xs text-muted">{c.url}</div>
                      </div>
                    <div className="mt-0.5 text-xs font-medium text-tertiary">
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
          <h2 className="text-sm font-semibold text-primary">Subscribed feeds</h2>
          <div className="text-xs text-muted">{data.feeds.length}/15</div>
        </div>
        <div className="mt-3 space-y-2">
          {data.feeds.length === 0 && (
            <div className="rounded-2xl border border-primary bg-secondary p-4 text-sm text-secondary">
              No feeds yet. Add one above.
            </div>
          )}
          {data.feeds.map((f) => (
            <div key={f.id} className="rounded-2xl border border-primary bg-secondary p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-primary">{f.title ?? f.url}</div>
                  <a
                    className="mt-1 inline-flex items-center gap-1 truncate text-xs text-muted"
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.url} <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-tertiary px-2 py-1 text-secondary">{f.status}</span>
                    {f.last_error && (
                      <span className="rounded-full bg-error/15 px-2 py-1 text-error">
                        {f.last_error.slice(0, 80)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => unsubscribeMutation.mutate({ data: { feedId: f.id } })}
                  className="rounded-xl bg-tertiary p-2 text-secondary hover:opacity-80"
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
        <h2 className="text-sm font-semibold text-primary">Latest entries</h2>
        <div className="mt-3 space-y-2">
          {data.entries.length === 0 && (
            <div className="rounded-2xl border border-primary bg-secondary p-4 text-sm text-secondary">
              No entries yet.
            </div>
          )}
          {data.entries.map((e) => (
            <a
              key={e.id}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl border border-primary bg-secondary p-4 hover:bg-tertiary"
            >
              <div className="text-xs text-muted">{e.feed_title ?? 'Feed'}</div>
              <div className="mt-1 text-sm font-semibold text-primary">{e.title}</div>
              <div className="mt-1 text-xs text-muted">
                {e.published_at ? new Date(e.published_at).toLocaleString() : '—'}
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}
