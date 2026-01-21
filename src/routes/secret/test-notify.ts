import { createFileRoute } from '@tanstack/react-router'
import type { NotifyMessage } from '../../server/notify'

export const Route = createFileRoute('/secret/test-notify')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const env = context.env
        const url = new URL(request.url)
        const userId = url.searchParams.get('userId') ?? context.userId

        if (!userId) {
          return new Response('Not authenticated. Pass ?userId=user_xxx', { status: 401 })
        }

        const message: NotifyMessage = {
          type: 'entry:new',
          userId,
          feedId: 'test',
          title: 'Test Notification',
          body: `This is a test notification sent at ${new Date().toISOString()}`,
          url: '/',
        }

        await env.NOTIFY_QUEUE.send(message, { contentType: 'json' })

        return new Response(JSON.stringify({ ok: true, userId, message: 'Notification queued' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
