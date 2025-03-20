import { parse as parseCookie } from 'cookie'
import type { Dispatcher } from 'undici'
import type { InterceptorContext } from './interceptor.ts'
import type { Logger } from 'pino'

export const INTERCEPT_REQUEST_METHOD_GET = 'GET'
export const SKIPPING_REQUEST_HEADERS = ['cache-control', 'pragma', 'if-none-match', 'if-modified-since',
  'authorization', 'proxy-authorization']
export const SKIPPING_RESPONSE_HEADERS = ['etag', 'last-modified', 'expires', 'cache-control', 'authorization', 'proxy-authenticate', 'www-authenticate', 'set-cookie']
export const INTERCEPT_RESPONSE_STATUS_CODES = (code: number) => (code > 199 && code < 300)
export const SKIPPING_COOKIE_SESSION_IDS = [
  'jsessionid',
  'phpsessid',
  'asp.net_sessionid',
  'connect.sid',
  'sid',
  'ssid',
  'auth_token',
  'access_token',
  'csrf_token',
  'xsrf-token',
  'x-csrf-token',
  'session',
  'refreshtoken',
  'token',
  'sessionid',
  'csrftoken',
  'authtoken',
  'accesstoken',
]
export const DEFAULT_BLOOM_FILTER_SIZE = 100_000
export const DEFAULT_BLOOM_FILTER_ERROR_RATE = 0.1
export const DEFAULT_MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB

export interface TrafficanteOptions {
  logger?: Logger
  trafficante: {
    url: string
    pathSendBody: string
    pathSendMeta: string
  }
  bloomFilter: {
    size: number
    errorRate: number
  }

  maxResponseSize: number
  labels: Record<string, string>

  // Override default interceptRequest function for custom logic or testing
  interceptRequest?: (context: InterceptorContext) => boolean
  // Override default interceptResponse function for custom logic or testing
  interceptResponse?: (context: InterceptorContext) => boolean

  // Override default headers and status code checks
  matchingDomains?: string[]
  skippingRequestHeaders?: string[]
  skippingResponseHeaders?: string[]
  interceptResponseStatusCodes?: (code: number) => boolean
  skippingCookieSessionIds?: string[]
}

export function interceptRequest (context: InterceptorContext): boolean {
  if (context.request.method as Dispatcher.HttpMethod !== INTERCEPT_REQUEST_METHOD_GET) {
    return false
  }

  if (!interceptByDomain(context.request.domain, context.options.matchingDomains)) {
    return false
  }

  if (!context.request.headers) {
    return true
  }

  for (const key of Object.keys(context.request.headers)) {
    const header = key.toLowerCase()

    if (context.options.skippingRequestHeaders!.includes(header)) {
      return false
    }

    if (header === 'cookie') {
      const cookies = parseCookie(context.request.headers[key] as string)
      if (Object.keys(cookies).some(id => context.options.skippingCookieSessionIds!.includes(id.toLowerCase()))) {
        return false
      }
    }
  }

  return true
}

export function interceptResponse (context: InterceptorContext): boolean {
  let hasContentLength = false

  if (!context.options.interceptResponseStatusCodes!(context.response.statusCode)) {
    return false
  }

  if (!context.response.headers) {
    return true
  }

  for (const key of Object.keys(context.response.headers)) {
    const header = key.toLowerCase()

    if (context.options.skippingResponseHeaders!.includes(header)) {
      return false
    }

    if (header === 'set-cookie') {
      const cookies = parseCookie(context.response.headers['set-cookie'] as string)

      if (Array.isArray(cookies)) {
        for (const cookie of cookies) {
          if (Object.keys(parseCookie(cookie)).some(id => context.options.skippingCookieSessionIds!.includes(id.toLowerCase()))) {
            return false
          }
        }
      } else {
        if (Object.keys(cookies).some(id => context.options.skippingCookieSessionIds!.includes(id.toLowerCase()))) {
          return false
        }
      }
    } else if (header === 'content-length') {
      hasContentLength = true
      if (Number(context.response.headers['content-length']) > context.options.maxResponseSize) {
        return false
      }
    }
  }

  if (!hasContentLength) {
    return false
  }

  return true
}

// domain is a string like 'sub.plt.local', without protocol and port
export function interceptByDomain (domain: string | undefined, matchingDomains: string[] | undefined): boolean {
  if (!matchingDomains) {
    return true
  }

  if (!domain) {
    return false
  }

  for (let i = 0; i < matchingDomains.length; i++) {
    if (domain.endsWith(matchingDomains[i])) {
      return true
    }
  }

  return false
}
