import { createFileRoute } from '@tanstack/react-router'
import { deserializeVapidKeys, sendPushNotification, toBase64Url } from 'web-push-browser'

export const Route = createFileRoute('/secret/verify-vapid')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const env = context.env

        if (!env.VAPID_PRIVATE_KEY) {
          return new Response(JSON.stringify({ error: 'VAPID_PRIVATE_KEY not set' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const configuredPublicKey = env.VAPID_PUBLIC_KEY
        const privateKeyBase64Url = env.VAPID_PRIVATE_KEY

        try {
          // Use deserializeVapidKeys which handles PKCS8 format
          const keyPair = await deserializeVapidKeys({
            publicKey: configuredPublicKey,
            privateKey: privateKeyBase64Url,
          })

          // Export public key to raw format to verify it matches
          const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey)
          const derivedPublicKeyBase64Url = toBase64Url(new Uint8Array(rawPublic))

          const match = derivedPublicKeyBase64Url === configuredPublicKey

          return new Response(
            JSON.stringify({
              configuredPublicKey,
              derivedPublicKey: derivedPublicKeyBase64Url,
              match,
              keysLoaded: true,
              diagnosis: match
                ? 'Keys match and loaded successfully!'
                : 'Keys loaded but public key mismatch - this should not happen.',
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: 'Failed to deserialize VAPID keys',
              message: String(err),
              hint: 'The private key may not match the public key, or the format is invalid.',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
