import type { Env } from '../env'

export type StartContext = {
  env: Env
  userId: string
  ip: string
  waitUntil: (promise: Promise<unknown>) => void
  cf?: Request['cf']
}

export function getStartContextOrThrow(input: unknown): StartContext {
  const ctx = input as { context?: unknown }
  const context = ctx?.context as Partial<StartContext> | undefined

  if (!context?.env || !context.userId || !context.ip || !context.waitUntil) {
    throw new Error('Missing Start request context (env/userId/ip/waitUntil).')
  }

  return context as StartContext
}
