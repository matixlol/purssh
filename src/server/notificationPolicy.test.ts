import { describe, expect, it } from 'vitest'

import { shouldEnqueueEntryNewNotifications } from './notificationPolicy'

describe('shouldEnqueueEntryNewNotifications', () => {
  it('suppresses notifications on first successful fetch', () => {
    expect(shouldEnqueueEntryNewNotifications(null)).toBe(false)
  })

  it('allows notifications after at least one prior success', () => {
    expect(shouldEnqueueEntryNewNotifications(Date.now() - 60_000)).toBe(true)
  })
})

