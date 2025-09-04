import { Client, Dispatcher } from 'undici'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import { PassThrough, type Duplex } from 'node:stream'
import { xxh3 } from '@node-rs/xxhash'
import {
  interceptRequest,
  interceptResponse,
  type TrafficInterceptorOptions,
  SKIPPING_REQUEST_HEADERS,
  SKIPPING_RESPONSE_HEADERS,
  INTERCEPT_RESPONSE_STATUS_CODES,
  SKIPPING_COOKIE_SESSION_IDS,
  DEFAULT_BLOOM_FILTER_SIZE,
  DEFAULT_BLOOM_FILTER_ERROR_RATE,
  DEFAULT_MAX_RESPONSE_SIZE
} from './traffic.ts'
import { BloomFilter } from './bloom-filter.ts'
import type { Logger } from 'pino'
import { extractDomain, extractOrigin } from './utils.ts'

const defaultTrafficInterceptorOptions: TrafficInterceptorOptions = {
  bloomFilter: {
    size: DEFAULT_BLOOM_FILTER_SIZE,
    errorRate: DEFAULT_BLOOM_FILTER_ERROR_RATE,
  },
  maxResponseSize: DEFAULT_MAX_RESPONSE_SIZE,
  trafficInspectorOptions: {
    url: '',
    pathSendBody: '/ingest-body',
    pathSendMeta: '/requests',
  },
  labels: {},
  skippingRequestHeaders: SKIPPING_REQUEST_HEADERS,
  skippingResponseHeaders: SKIPPING_RESPONSE_HEADERS,
  interceptResponseStatusCodes: INTERCEPT_RESPONSE_STATUS_CODES,
  skippingCookieSessionIds: SKIPPING_COOKIE_SESSION_IDS
}

export type InterceptorContext = {
  dispatchOptions: Partial<Dispatcher.DispatchOptions>,
  options: TrafficInterceptorOptions,
  hasher: xxh3.Xxh3,
  logger?: Logger,

  // request
  request: {
    method: Dispatcher.HttpMethod
    headers: IncomingHttpHeaders
    timestamp: number
    url?: string // domain name + path / no query string
    domain?: string // domain name
    origin?: string // origin
    hash?: bigint // hash of request.url
  }

  // response
  response: {
    statusCode: number
    headers: OutgoingHttpHeaders
    hash?: bigint // hash of response body
  }

  labels: Record<string, string>

  interceptRequest: boolean | undefined
  interceptResponse: boolean | undefined
  sendMeta: boolean | undefined
  sendBody: boolean | undefined
}

class TrafficInterceptor implements Dispatcher.DispatchHandler {
  private handler: Dispatcher.DispatchHandler
  private aborted = false

  private bloomFilter!: BloomFilter
  private client!: Client

  private context!: InterceptorContext

  private send!: Promise<Dispatcher.ResponseData<null>>
  private writer: PassThrough | undefined
  private bodySendController: AbortController | undefined
  private interceptRequest: (context: InterceptorContext) => boolean
  private interceptResponse: (context: InterceptorContext) => boolean

  constructor (
    dispatchOptions: Partial<Dispatcher.DispatchOptions>,
    options: TrafficInterceptorOptions,
    bloomFilter: BloomFilter,
    client: Client,
    handler: Dispatcher.DispatchHandler
  ) {
    this.handler = handler

    this.bloomFilter = bloomFilter
    this.client = client

    this.context = {
      dispatchOptions,
      options,
      hasher: xxh3.Xxh3.withSeed(),
      logger: options.logger,
      labels: options.labels ?? {},

      request: {
        method: '',
        headers: {},
        timestamp: Date.now(),
      },
      response: {
        statusCode: -1,
        headers: {},
      },

      interceptRequest: undefined,
      interceptResponse: undefined,
      sendMeta: undefined,
      sendBody: undefined,
    }

    this.interceptRequest = options.interceptRequest ?? interceptRequest
    this.interceptResponse = options.interceptResponse ?? interceptResponse
  }

  onRequestAbort (reason: Error) {
    this.context.logger?.debug({ reason }, 'TrafficInterceptor onRequestAbort')

    if (this.writer && !this.writer.destroyed) {
      this.writer.destroy(reason)
    }

    if (this.bodySendController) {
      this.bodySendController.abort()
    }

    this.aborted = true
  }

  onRequestStart (controller: Dispatcher.DispatchController, context: unknown): void {
    this.context.logger?.debug('TrafficInterceptor onRequestStart')

    controller.abort = this.onRequestAbort.bind(this)

    this.context.request.origin = extractOrigin(this.context.dispatchOptions.origin as string, this.context.dispatchOptions.headers as IncomingHttpHeaders)
    if (this.context.options.matchingDomains) {
      this.context.request.domain = extractDomain(this.context.request.origin)
    }

    this.context.request.url = this.context.request.origin + (this.context.dispatchOptions.path as string || '/')
    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders
    this.context.request.method = this.context.dispatchOptions.method as Dispatcher.HttpMethod
    this.context.interceptRequest = this.interceptRequest(this.context)

    if (!this.context.interceptRequest) {
      this.context.sendBody = false
      this.context.sendMeta = false
      this.context.logger?.debug({ request: this.context.request }, 'skip by request')
      this.handler.onRequestStart?.(controller, context)
      return
    }

    // will send only meta and no body if bloom filter is hit
    this.context.request.hash = this.context.hasher.update(this.context.request.url).digest()
    if (this.bloomFilter.has(this.context.request.hash)) {
      this.context.logger?.debug({ request: this.context.request }, 'skip by bloom filter')
      this.context.sendMeta = true
      this.context.sendBody = false
    } else {
      this.bloomFilter.add(this.context.request.hash)
      this.context.sendMeta = true
      this.context.sendBody = true
    }

    this.handler.onRequestStart?.(controller, context)
  }

  onResponseStart (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    this.context.logger?.debug('TrafficInterceptor onResponseStart')

    this.context.response = {
      statusCode,
      headers
    }

    if (!this.context.interceptRequest) {
      this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
      return
    }

    this.context.interceptResponse = this.interceptResponse(this.context)

    if (!this.context.interceptResponse) {
      this.context.logger?.debug({ response: this.context.response }, 'skip by response')
      this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
      return
    }

    if (this.context.sendBody) {
      // Send data to traffic inspector
      // Don's send response body to traffic inspector when request is intercepted due to request headers or bloom filter
      this.writer = new PassThrough()
      this.bodySendController = new AbortController()
      this.writer.on('error', (error) => {
        this.context.logger?.error({ err: error }, 'TrafficInterceptor response body passthrough error')
        this.writer?.destroy(error as Error)
      })

      this.send = this.client.request({
        path: this.context.options.trafficInspectorOptions.pathSendBody,
        method: 'POST',
        headers: {
          'content-type': this.context.response.headers['content-type'] || 'application/octet-stream',
          'content-length': (this.context.response.headers['content-length'] ?? '0').toString(),
          'x-labels': JSON.stringify(this.context.labels),
          'x-request-data': JSON.stringify({ url: this.context.request.url, headers: this.context.request.headers }),
          'x-response-data': JSON.stringify({ headers: this.context.response.headers }),
        },
        body: this.writer,
        signal: this.bodySendController.signal
      })

      this.send.catch((err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficInterceptor error sending response body to traffic inspector #1')
      })
    }

    this.context.hasher.reset()

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  async onResponseData (controller: Dispatcher.DispatchController, chunk: Buffer): Promise<void> {
    this.context.logger?.debug('TrafficInterceptor onResponseData')

    if (!this.context.interceptResponse || this.aborted) {
      this.handler.onResponseData?.(controller, chunk)
      return
    }

    if (this.context.sendMeta) {
      this.context.hasher.update(chunk)
    }

    if (this.context.sendBody && this.writer && !this.writer.destroyed) {
      try {
        if (!this.writer.write(chunk)) {
          await new Promise(resolve => this.writer?.once('drain', resolve))
        }
      } catch (err) {
        this.context.logger?.error({ err }, 'Error writing to response body stream')
        this.writer?.destroy(err as Error)
      }
    }

    this.handler.onResponseData?.(controller, chunk)
  }

  onResponseEnd (controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): void {
    this.context.logger?.debug('TrafficInterceptor onResponseEnd')

    if (!this.context.interceptResponse || this.aborted) {
      this.handler.onResponseEnd?.(controller, trailers)
      return
    }

    if (this.context.sendBody && this.writer && !this.writer.destroyed) {
      try {
        this.writer.end()
      } catch (err) {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficInterceptor error finalizing response body send')
      }

      this.send.then((response) => {
        if (response.statusCode > 299) {
          this.context.logger?.error({ request: { url: this.context.request.url }, response: { code: response.statusCode } }, 'TrafficInterceptor error sending body to traffic inspector')
        }
      }, (err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficInterceptor error finalizing response body send')
      })
    }

    if (this.context.sendMeta) {
      this.context.response.hash = this.context.hasher.digest()

      // No redaction on headers since if there are auth headers, the request/response will be skipped
      this.context.logger?.debug({ url: this.context.request.url }, 'send meta to traffic inspector')

      this.client.request({
        path: this.context.options.trafficInspectorOptions.pathSendMeta,
        method: 'POST',
        body: JSON.stringify({
          timestamp: this.context.request.timestamp,
          request: {
            url: this.context.request.url,
          },
          response: {
            code: this.context.response.statusCode,
            bodyHash: this.context.response.hash.toString(),
            bodySize: Number(this.context.response.headers['content-length']) || 0
          }
        }),
        headers: {
          'x-labels': JSON.stringify(this.context.labels),
          'content-type': 'application/json',
        }
      }).then((response) => {
        if (response.statusCode > 299) {
          this.context.logger?.error({ request: { url: this.context.request.url }, response: { code: response.statusCode } }, 'TrafficInterceptor error sending meta to traffic inspector')
        }
      }, (err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficInterceptor error sending meta to traffic inspector')
      })
    }

    this.handler.onResponseEnd?.(controller, trailers)
  }

  onRequestUpgrade (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    this.context.logger?.debug('TrafficInterceptor onRequestUpgrade')

    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  async onResponseError (controller: Dispatcher.DispatchController, err: Error): Promise<void> {
    this.context.logger?.error({ err }, 'TrafficInterceptor onResponseError')

    // Cleanup streams and abort pending requests
    if (this.writer && !this.writer.destroyed) {
      this.writer.destroy(err)
    }

    if (this.send) {
      this.send.catch((err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficInterceptor error sending response body to traffic inspector #2')
        if (this.writer && !this.writer.destroyed) {
          this.writer.destroy(err)
        }
      })
    }

    this.handler.onResponseError?.(controller, err)
  }
}

export function createTrafficInterceptor (options: TrafficInterceptorOptions = defaultTrafficInterceptorOptions): Dispatcher.DispatchInterceptor {
  const { logger, interceptResponseStatusCodes, ...optionsRest } = options
  const validatedOptions: TrafficInterceptorOptions = structuredClone(optionsRest)

  // Validate options
  if (!validatedOptions.bloomFilter || typeof validatedOptions.bloomFilter.size !== 'number' || validatedOptions.bloomFilter.size <= 0) {
    throw new Error('TRAFFIC_INTERCEPTOR_INVALID_BLOOM_FILTER_SIZE')
  }
  if (!options.bloomFilter || typeof options.bloomFilter.errorRate !== 'number' || options.bloomFilter.errorRate <= 0 || options.bloomFilter.errorRate >= 1) {
    throw new Error('TRAFFIC_INTERCEPTOR_INVALID_BLOOM_FILTER_ERROR_RATE')
  }
  if (validatedOptions.maxResponseSize === undefined) {
    validatedOptions.maxResponseSize = defaultTrafficInterceptorOptions.maxResponseSize
  } else if (typeof validatedOptions.maxResponseSize !== 'number' || validatedOptions.maxResponseSize <= 0) {
    throw new Error('TRAFFIC_INTERCEPTOR_INVALID_MAX_RESPONSE_SIZE')
  }
  if (!validatedOptions.trafficInspectorOptions || typeof validatedOptions.trafficInspectorOptions.url !== 'string' || validatedOptions.trafficInspectorOptions.url.length === 0) {
    throw new Error('TRAFFIC_INTERCEPTOR_INVALID_REQUEST_URL')
  }
  if (!validatedOptions.labels) {
    validatedOptions.labels = defaultTrafficInterceptorOptions.labels
  }
  if (validatedOptions.matchingDomains) {
    if (!Array.isArray(validatedOptions.matchingDomains) || validatedOptions.matchingDomains.length === 0) {
      throw new Error('TRAFFIC_INTERCEPTOR_INVALID_SKIPPING_DOMAINS')
    }

    for (const skippingDomain of validatedOptions.matchingDomains) {
      if (typeof skippingDomain !== 'string' || skippingDomain.length === 0) {
        throw new Error('TRAFFIC_INTERCEPTOR_INVALID_SKIPPING_DOMAINS')
      }
    }
  }

  validatedOptions.skippingRequestHeaders = optionsRest.skippingRequestHeaders ?? defaultTrafficInterceptorOptions.skippingRequestHeaders
  validatedOptions.skippingResponseHeaders = optionsRest.skippingResponseHeaders ?? defaultTrafficInterceptorOptions.skippingResponseHeaders
  validatedOptions.interceptResponseStatusCodes = interceptResponseStatusCodes ?? defaultTrafficInterceptorOptions.interceptResponseStatusCodes
  validatedOptions.skippingCookieSessionIds = optionsRest.skippingCookieSessionIds ?? defaultTrafficInterceptorOptions.skippingCookieSessionIds

  validatedOptions.logger = logger

  const bloomFilter = new BloomFilter(validatedOptions.bloomFilter.size, validatedOptions.bloomFilter.errorRate)
  const client = new Client(validatedOptions.trafficInspectorOptions.url)

  return function trafficInterceptor (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    return function InterceptedDispatch (
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficInterceptor(dispatchOptions, validatedOptions, bloomFilter, client, handler))
    }
  }
}
