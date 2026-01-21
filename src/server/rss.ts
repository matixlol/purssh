import { XMLParser } from 'fast-xml-parser'

export type ParsedFeedEntry = {
  guidOrUrl: string
  title: string
  url: string
  publishedAtMs: number | null
}

export type ParsedFeed = {
  title: string | null
  siteUrl: string | null
  entries: ParsedFeedEntry[]
}

function firstText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const t = obj['#text'] ?? obj['text'] ?? obj['__text']
    if (typeof t === 'string') return t.trim() || null
  }
  return null
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function parseDateMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function pickAtomLinkUrl(
  link: unknown,
  relWanted: string | null,
): string | null {
  const links = toArray(link as any)
  for (const l of links) {
    if (!l || typeof l !== 'object') continue
    const rel = firstText((l as any).rel) ?? null
    const href = firstText((l as any).href) ?? null
    if (!href) continue
    if (relWanted === null) return href
    if (rel === relWanted) return href
  }
  return null
}

export function parseFeedXml(xml: string): ParsedFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    parseTagValue: true,
    trimValues: true,
  })

  const doc = parser.parse(xml) as any

  // RSS 2.0
  const rssChannel = doc?.rss?.channel
  if (rssChannel) {
    const title = firstText(rssChannel.title)
    const siteUrl = firstText(rssChannel.link)
    const items = toArray(rssChannel.item)
    const entries: ParsedFeedEntry[] = []
    for (const item of items) {
      const itemTitle = firstText(item?.title) ?? '(untitled)'
      const link = firstText(item?.link)
      const guid = firstText(item?.guid)
      const publishedAtMs = parseDateMs(firstText(item?.pubDate))
      const url = link ?? guid
      if (!url) continue
      entries.push({
        guidOrUrl: guid ?? url,
        title: itemTitle,
        url,
        publishedAtMs,
      })
    }
    return { title, siteUrl, entries }
  }

  // Atom
  const atomFeed = doc?.feed
  if (atomFeed) {
    const title = firstText(atomFeed.title)
    const siteUrl = pickAtomLinkUrl(atomFeed.link, 'alternate') ?? pickAtomLinkUrl(atomFeed.link, null)
    const items = toArray(atomFeed.entry)
    const entries: ParsedFeedEntry[] = []
    for (const entry of items) {
      const itemTitle = firstText(entry?.title) ?? '(untitled)'
      const link = pickAtomLinkUrl(entry?.link, 'alternate') ?? pickAtomLinkUrl(entry?.link, null)
      const id = firstText(entry?.id)
      const publishedAtMs =
        parseDateMs(firstText(entry?.published)) ??
        parseDateMs(firstText(entry?.updated)) ??
        null
      const url = link ?? id
      if (!url) continue
      entries.push({
        guidOrUrl: id ?? url,
        title: itemTitle,
        url,
        publishedAtMs,
      })
    }
    return { title, siteUrl, entries }
  }

  throw new Error('Unsupported feed format')
}

