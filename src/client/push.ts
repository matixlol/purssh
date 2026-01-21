export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers not supported')
  }
  const reg = await navigator.serviceWorker.ready
  return reg
}

export async function subscribeToWebPush(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await getServiceWorkerRegistration()
  const existing = await reg.pushManager.getSubscription()

  if (existing) {
    // Check if the existing subscription's applicationServerKey matches our current VAPID key
    const existingKey = existing.options.applicationServerKey
    const expectedKey = urlBase64ToUint8Array(vapidPublicKey)

    if (existingKey) {
      const existingKeyArray = new Uint8Array(existingKey)
      const keysMatch =
        existingKeyArray.length === expectedKey.length &&
        existingKeyArray.every((byte, i) => byte === expectedKey[i])

      if (!keysMatch) {
        // VAPID key changed, unsubscribe and create new subscription
        console.log('[push] VAPID key mismatch, re-subscribing...')
        await existing.unsubscribe()
      } else {
        return existing
      }
    } else {
      return existing
    }
  }

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
}

