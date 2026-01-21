import { generateVapidKeys, serializeVapidKeys } from 'web-push-browser'

async function main() {
  const keyPair = await generateVapidKeys()
  const serialized = await serializeVapidKeys(keyPair)

  console.log('=== NEW VAPID KEYS ===\n')
  console.log('PUBLIC KEY (put in wrangler.jsonc):')
  console.log(serialized.publicKey)
  console.log('\nPRIVATE KEY (set as Cloudflare secret):')
  console.log(serialized.privateKey)
  console.log('\n=== COMMANDS ===\n')
  console.log('1. Update wrangler.jsonc with the public key above')
  console.log('2. Run: echo "' + serialized.privateKey + '" | wrangler secret put VAPID_PRIVATE_KEY')
  console.log('3. Deploy with: pnpm run deploy')
  console.log('4. Users must re-subscribe for push notifications (old subscriptions will stop working)')
}

main().catch(console.error)
