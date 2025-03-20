import type { IncomingHttpHeaders } from 'http'

export function extractDomain (origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined
  }

  // trim protocol and port
  const start = origin.startsWith('http://') ? 7 : origin.startsWith('https://') ? 8 : 0
  const end = origin.indexOf(':', start)
  if (end !== -1) {
    return '.' + origin.slice(start, end)
  }

  return '.' + origin.slice(start)
}

export function extractOrigin (origin: string | undefined, headers: IncomingHttpHeaders): string | undefined {
  if (!headers) {
    return origin
  }
  if (headers['Origin']) {
    return headers['Origin'] as string
  }
  if (headers['origin']) {
    return headers['origin'] as string
  }
  return origin
}
