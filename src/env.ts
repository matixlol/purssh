export type Env = {
  DB: D1Database
  NOTIFY_QUEUE: Queue
  VAPID_PUBLIC_KEY: string
  VAPID_SUBJECT: string
  VAPID_PRIVATE_KEY?: string
}

