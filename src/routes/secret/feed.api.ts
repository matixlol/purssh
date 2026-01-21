import { createFileRoute } from '@tanstack/react-router'

const INTERVAL_MS = 15 * 60 * 1000
const ENTRY_COUNT = 15

function buildFeedXml(baseUrl: string, nowMs: number) {
  const currentSlot = Math.floor(nowMs / INTERVAL_MS)
  const latestSlotTime = currentSlot * INTERVAL_MS

  const items = Array.from({ length: ENTRY_COUNT }, (_, index) => {
    const slot = currentSlot - index
    const timestamp = new Date(slot * INTERVAL_MS).toUTCString()
    const link = `${baseUrl}/secret/feed/entry/${slot}`
    return {
      title: `Test entry #${slot}`,
      link,
      guid: `purssh-test-${slot}`,
      pubDate: timestamp,
    }
  })

  const lastBuildDate = new Date(latestSlotTime).toUTCString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Purssh Test Feed</title>
    <link>${baseUrl}/secret/feed</link>
    <description>Deterministic feed for push testing.</description>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items
  .map(
    (item) => `    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <guid isPermaLink="false">${item.guid}</guid>
      <pubDate>${item.pubDate}</pubDate>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`
}

export const Route = createFileRoute('/secret/feed/api')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const baseUrl = `${url.protocol}//${url.host}`
        const xml = buildFeedXml(baseUrl, Date.now())
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
