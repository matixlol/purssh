import type { StartContext } from './server/startContext'

declare module '@tanstack/router-core' {
  interface Register {
    server: {
      requestContext: StartContext
    }
  }
}

