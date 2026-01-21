import type { Env } from '../env'

export type StartContext = {
  env: Env
  request: Request
  userId: string | null
  ip: string
  waitUntil: (promise: Promise<unknown>) => void
  cf?: Request['cf']
}

export function getStartContext(input: unknown): StartContext {
  const ctx = input as { context?: unknown }
  const context = ctx?.context as Partial<StartContext> | undefined

  if (!context?.env || !context.request || !context.waitUntil) {
    throw new Error('Missing Start request context (env/request/waitUntil).')
  }

  return context as StartContext
}

export function getStartContextOrThrow(input: unknown): StartContext & { userId: string } {
  const context = getStartContext(input)

  if (!context.userId) {
    throw new Error('not_authenticated')
  }

  return context as StartContext & { userId: string }
}
