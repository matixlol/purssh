import { generateVapidKeys, serializeVapidKeys } from 'web-push-browser'

const keys = await generateVapidKeys()
const serialized = await serializeVapidKeys(keys)

process.stdout.write(`${JSON.stringify(serialized, null, 2)}\n`)

