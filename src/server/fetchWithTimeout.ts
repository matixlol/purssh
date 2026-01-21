export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 15_000

  const controller = new AbortController()
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal

  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    const { timeoutMs: _ignored, ...rest } = init
    return await fetch(input, { ...rest, signal })
  } finally {
    clearTimeout(timeout)
  }
}

