purssh is a mobile-first RSS → Push web app built on TanStack Start + Cloudflare Workers.

## What it does (MVP)

- Subscribe to RSS/Atom feeds (auto-discovered from a site URL).
- Every 15 minutes, a cron trigger fetches feeds (15s timeout, concurrent fetches via `p-map`).
- New entries are stored in Cloudflare D1 and pushed to the user via Web Push.
- If a feed hasn’t fetched successfully in **>24 hours**, the app:
  - sends a **one-time** “feed failing” notification, and
  - marks the feed as **paused** (kept in DB, no longer fetched automatically).

## Local development

```bash
cd purssh
pnpm dev
```

## Cloudflare setup

### 1) Create D1 database + apply migrations

Create the database (copy the `database_id` Wrangler prints):

```bash
pnpm wrangler d1 create purssh
```

Update `purssh/wrangler.jsonc` and add the `database_id` under `d1_databases[0]`.

Apply migrations locally:

```bash
pnpm run db:migrate:local
```

Apply migrations to remote (prod):

```bash
pnpm run db:migrate:remote
```

### 2) Create the Queue

```bash
pnpm wrangler queues create purssh-notify
```

### 3) Configure VAPID keys (Web Push)

Generate a keypair:

```bash
pnpm run vapid:generate
```

Set the public key (non-secret) in `purssh/wrangler.jsonc` as `vars.VAPID_PUBLIC_KEY`.

Set the private key (secret) in Cloudflare:

```bash
pnpm wrangler secret put VAPID_PRIVATE_KEY
```

Set the subject (recommended: `mailto:`) in `purssh/wrangler.jsonc` as `vars.VAPID_SUBJECT`.

### 4) Deploy

```bash
pnpm run deploy
```

## iOS notes (important)

- To receive Web Push on iOS, install the app to the Home Screen (Safari → Share → Add to Home Screen).
- Then tap “Enable notifications” in the app.

