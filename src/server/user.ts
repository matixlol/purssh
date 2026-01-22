import { randomToken, sha256Base64Url } from './crypto'
import { getClientIp, parseCookies, serializeCookie } from './http'
import { nowMs } from './time'

const COOKIE_NAME = 'purssh_secret'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export type UserIdentity = {
  userId: string | null
  secret: string | null
  setCookieHeader: string | null
  ip: string
}

type UserRow = {
  id: string
  secret_hash: string
  last_ip: string
}

function randomUserId(): string {
  return `user_${randomToken(16)}`
}

export async function getUserIdentity(request: Request, db: D1Database): Promise<UserIdentity> {
  const ip = getClientIp(request)
  const cookies = parseCookies(request.headers.get('Cookie'))
  const secret = cookies[COOKIE_NAME]

  if (!secret) {
    return { userId: null, secret: null, setCookieHeader: null, ip }
  }

  const secretHash = await sha256Base64Url(secret)
  const existing = await db
    .prepare('SELECT id, secret_hash, last_ip FROM users WHERE secret_hash = ? LIMIT 1')
    .bind(secretHash)
    .first<UserRow>()

  if (!existing?.id) {
    return { userId: null, secret: null, setCookieHeader: null, ip }
  }

  if (existing.last_ip !== ip) {
    await db
      .prepare('UPDATE users SET last_ip = ?, last_seen_at = ? WHERE id = ?')
      .bind(ip, nowMs(), existing.id)
      .run()
  } else {
    await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(nowMs(), existing.id).run()
  }

  return { userId: existing.id, secret, setCookieHeader: null, ip }
}

export async function createUser(db: D1Database, ip: string): Promise<UserIdentity> {
  const usersForIp = await db
    .prepare('SELECT COUNT(1) as c FROM users WHERE last_ip = ?')
    .bind(ip)
    .first<{ c: number }>()

  if ((usersForIp?.c ?? 0) >= 15) {
    throw new Error('ip_user_limit_reached')
  }

  const newSecret = randomToken(32)
  const newSecretHash = await sha256Base64Url(newSecret)
  const userId = randomUserId()
  const createdAt = nowMs()

  await db
    .prepare('INSERT INTO users (id, secret_hash, created_at, last_ip, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, newSecretHash, createdAt, ip, createdAt)
    .run()

  const setCookieHeader = serializeCookie(COOKIE_NAME, newSecret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAgeSeconds: ONE_YEAR_SECONDS,
  })

  return { userId, secret: newSecret, setCookieHeader, ip }
}
