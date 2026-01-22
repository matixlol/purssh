export function shouldEnqueueEntryNewNotifications(priorLastSuccessAt: number | null): boolean {
  return priorLastSuccessAt != null
}
