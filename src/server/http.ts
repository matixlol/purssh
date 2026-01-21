export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get('CF-Connecting-IP')
  if (cfConnectingIp) return cfConnectingIp

  const xForwardedFor = request.headers.get('X-Forwarded-For')
  if (xForwardedFor) return xForwardedFor.split(',')[0]!.trim()

  return '127.0.0.1'
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}

  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (!rawName) continue
    const rawValue = rest.join('=')
    out[rawName] = decodeURIComponent(rawValue ?? '')
  }
  return out
}

export function serializeCookie(
  name: string,
  value: string,
  opts: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Lax' | 'Strict' | 'None'
    path?: string
    maxAgeSeconds?: number
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`)
  parts.push(`Path=${opts.path ?? '/'}`)
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  if (opts.secure ?? true) parts.push('Secure')
  if (opts.httpOnly ?? true) parts.push('HttpOnly')

  return parts.join('; ')
}

export function withSetCookie(response: Response, setCookieValue: string | null): Response {
  if (!setCookieValue) return response

  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', setCookieValue)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

