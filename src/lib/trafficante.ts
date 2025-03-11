import { parse as parseCookie } from 'cookie'
import type { Dispatcher } from 'undici'
import type { InterceptorContext } from './interceptor.ts'

export const INTERCEPT_REQUEST_METHODS: Array<Dispatcher.HttpMethod> = ['GET']
export const SKIPPING_REQUEST_HEADERS = ['cache-control', 'pragma', 'if-none-match', 'if-modified-since',
  'authorization', 'proxy-authorization']
export const SKIPPING_RESPONSE_HEADERS = ['etag', 'last-modified', 'expires', 'cache-control']
export const INTERCEPT_RESPONSE_STATUS_CODES = (code: number) => (code >= 200 && code < 300) || code === 400
export const SKIPPING_COOKIE_SESSION_IDS = ['sessionId',
  'JSESSIONID',
  'PHPSESSID',
  'ASP.NET_SessionId',
  'connect.sid',
  'SID',
  'SSID',
  'auth_token',
  'access_token',
  'csrf_token',
  'XSRF-TOKEN',
  'X-CSRF-TOKEN'
]

export interface TrafficanteOptions {
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

  // Override default interceptRequest function for custom logic or testing
  interceptRequest?: (context: InterceptorContext) => boolean
  // Override default hashRequest function for custom logic or testing
  hashRequest?: (context: InterceptorContext) => bigint
  // Override default extractDataFromRequest function for custom logic or testing
  extractDataFromRequest?: (context: InterceptorContext) => Record<string, string>
  // Override default interceptResponse function for custom logic or testing
  interceptResponse?: (context: InterceptorContext) => boolean
}

export function interceptRequest (context: InterceptorContext): boolean {
  if (!INTERCEPT_REQUEST_METHODS.includes(context.request.method as Dispatcher.HttpMethod)) {
    return false
  }

  if (!context.request.headers) {
    return true
  }

  if (SKIPPING_REQUEST_HEADERS.some(header => header in context.request.headers)) {
    return false
  }

  const cookies = context.request.headers['cookie']
  if (cookies) {
    const cookieSessionIds = Object.keys(parseCookie(cookies)).filter(id => SKIPPING_COOKIE_SESSION_IDS.includes(id))
    if (cookieSessionIds.length > 0) {
      return false
    }
  }

  return true
}

export function extractDataFromRequest (context: InterceptorContext): Record<string, string> {
  // TODO
  // const data: Record<string, string> = {}
  // const pathSegments = context.request.url?.pathname.split('/').filter(Boolean) || []
  // if (pathSegments.length >= 1) data.applicationId = pathSegments[0]
  // if (pathSegments.length >= 2) data.taxonomyId = pathSegments[1]
  // if (pathSegments.length >= 3) data.serviceId = pathSegments[2]

  return {
    applicationId: 'TODO',
    taxonomyId: 'TODO',
    serviceId: 'TODO',
    telemetryId: 'TODO',
    requestHash: context.request.hashString ?? ''
  }
}

export function hashRequest (context: InterceptorContext): bigint {
  context.hasher.update(`${context.request.url?.pathname}?${context.request.query}`)
  return context.hasher.digest()
}

export function interceptResponse (context: InterceptorContext): boolean {
  if (!INTERCEPT_RESPONSE_STATUS_CODES(context.response.statusCode)) {
    return false
  }

  if (!context.response.headers) {
    return true
  }

  if (SKIPPING_RESPONSE_HEADERS.some(header => header in context.response.headers)) {
    return false
  }

  if (!context.response.headers['content-length'] || Number(context.response.headers['content-length']) > context.options.maxResponseSize) {
    return false
  }

  const cookies = context.response.headers['set-cookie']
  if (!cookies) {
    return true
  }

  if (Array.isArray(cookies)) {
    for (const cookie of cookies) {
      const cookieSessionIds = Object.keys(parseCookie(cookie)).filter(id => SKIPPING_COOKIE_SESSION_IDS.includes(id))
      if (cookieSessionIds.length > 0) {
        return false
      }
    }
  } else {
    const cookieSessionIds = Object.keys(parseCookie(cookies)).filter(id => SKIPPING_COOKIE_SESSION_IDS.includes(id))
    if (cookieSessionIds.length > 0) {
      return false
    }
  }

  return true
}
