import { Client, Dispatcher } from 'undici'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import { PassThrough, type Duplex } from 'node:stream'
import { xxh3 } from '@node-rs/xxhash'
import {
  interceptRequest,
  interceptResponse,
  type TrafficanteOptions,
  SKIPPING_REQUEST_HEADERS,
  SKIPPING_RESPONSE_HEADERS,
  INTERCEPT_RESPONSE_STATUS_CODES,
  SKIPPING_COOKIE_SESSION_IDS,
  DEFAULT_BLOOM_FILTER_SIZE,
  DEFAULT_BLOOM_FILTER_ERROR_RATE,
  DEFAULT_MAX_RESPONSE_SIZE
} from './trafficante.ts'
import { BloomFilter } from './bloom-filter.ts'
import type { Logger } from 'pino'

const defaultTrafficanteOptions: TrafficanteOptions = {
  bloomFilter: {
    size: DEFAULT_BLOOM_FILTER_SIZE,
    errorRate: DEFAULT_BLOOM_FILTER_ERROR_RATE,
  },
  maxResponseSize: DEFAULT_MAX_RESPONSE_SIZE,
  trafficante: {
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
  options: TrafficanteOptions,
  hasher: xxh3.Xxh3,
  logger?: Logger,

  // request
  request: {
    method: Dispatcher.HttpMethod
    headers: IncomingHttpHeaders
    timestamp: number
    url?: string // domain name + path / no query string
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
}

class TrafficanteInterceptor implements Dispatcher.DispatchHandler {
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

  constructor(
    dispatchOptions: Partial<Dispatcher.DispatchOptions>,
    options: TrafficanteOptions,
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
    }

    this.interceptRequest = options.interceptRequest ?? interceptRequest
    this.interceptResponse = options.interceptResponse ?? interceptResponse
  }

  onRequestAbort(reason: Error) {
    this.context.logger?.error({ reason }, '\n\n\n !!! TrafficanteInterceptor abort')

    if (this.writer && !this.writer.destroyed) {
      this.writer.destroy()
    }

    if (this.bodySendController) {
      this.bodySendController.abort()
    }

    this.aborted = true
  }

  onRequestStart(controller: Dispatcher.DispatchController, context: unknown): void {
    this.context.logger?.debug('TrafficanteInterceptor onRequestStart')

    controller.abort = this.onRequestAbort.bind(this)

    this.context.request.method = this.context.dispatchOptions.method as Dispatcher.HttpMethod
    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders
    this.context.interceptRequest = this.interceptRequest(this.context)

    if (!this.context.interceptRequest) {
      this.context.logger?.debug({ request: this.context.request }, 'skip by request')
      this.handler.onRequestStart?.(controller, context)
      return
    }

    this.context.request.url = (this.context.dispatchOptions.origin as string) + (this.context.dispatchOptions.path as string || '/')

    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders

    this.context.request.hash = this.context.hasher.update(this.context.request.url).digest()
    if (this.bloomFilter.has(this.context.request.hash)) {
      this.context.logger?.debug({ request: this.context.request }, 'skip by bloom filter')
      this.context.interceptRequest = false
    } else {
      this.bloomFilter.add(this.context.request.hash)
    }

    this.handler.onRequestStart?.(controller, context)
  }

  onResponseStart(controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    this.context.logger?.debug('TrafficanteInterceptor onResponseStart')

    this.context.response = {
      statusCode,
      headers
    }
    this.context.interceptResponse = this.interceptResponse(this.context)

    if (!this.context.interceptResponse) {
      this.context.logger?.debug({ response: this.context.response }, 'skip by response')
      this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
      return
    }

    if (this.context.interceptRequest) {
      // Send data to trafficante
      // Don's send response body to trafficante when request is intercepted due to request headers or bloom filter
      this.writer = new PassThrough()
      this.bodySendController = new AbortController()
      this.writer.on('error', (error) => {
        this.context.logger?.error('TrafficanteInterceptor response body passthrough error', error)
        this.writer?.destroy(error as Error)
      })

      this.send = this.client.request({
        path: this.context.options.trafficante.pathSendBody,
        method: 'POST',
        headers: {
          'content-type': this.context.response.headers['content-type'] || 'application/octet-stream',
          'content-length': (this.context.response.headers['content-length'] ?? '0').toString(),
          'x-request-url': this.context.request.url,
        },
        body: this.writer,
        signal: this.bodySendController.signal
      })

      this.send.catch((err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficanteInterceptor error sending response body to trafficante #1')
      })
    }

    this.context.hasher.reset()

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  async onResponseData(controller: Dispatcher.DispatchController, chunk: Buffer): Promise<void> {
    this.context.logger?.debug('TrafficanteInterceptor onResponseData')

    if (!this.context.interceptResponse || this.aborted) {
      this.handler.onResponseData?.(controller, chunk)
      return
    }

    this.context.hasher.update(chunk)

    if (this.context.interceptRequest && this.writer && !this.writer.destroyed) {
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

  async onResponseEnd(controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): Promise<void> {
    this.context.logger?.debug('TrafficanteInterceptor onResponseEnd')

    if (!this.context.interceptResponse || this.aborted) {
      this.handler.onResponseEnd?.(controller, trailers)
      return
    }

    if (this.context.interceptRequest && this.writer && !this.writer.destroyed) {
      try {
        this.writer.end()
        const response = await this.send
        if (response.statusCode !== 200) {
          this.context.logger?.error({ response }, 'TrafficanteInterceptor error finalizing response body send')
        }
      } catch (err) {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficanteInterceptor error finalizing response body send')
      }
    }

    // Send meta data to trafficante
    this.context.response.hash = this.context.hasher.digest()

    // No redaction on headers since if there are auth headers, the request/response will be skipped
    this.context.logger?.debug({ url: this.context.request.url }, 'send meta to trafficante')
    try {
      await this.client.request({
        path: this.context.options.trafficante.pathSendMeta,
        method: 'POST',
        body: JSON.stringify({
          ...this.context.labels,
          timestamp: this.context.request.timestamp,
          request: {
            url: this.context.request.url,
            headers: this.context.request.headers
          },
          response: {
            code: this.context.response.statusCode,
            headers: this.context.response.headers,
            bodyHash: this.context.response.hash.toString(),
            bodySize: Number(this.context.response.headers['content-length']) || 0
          }
        }),
        headers: {
          'content-type': 'application/json',
        }
      })
    } catch (err) {
      this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficanteInterceptor error sending meta to trafficante')
    }

    this.handler.onResponseEnd?.(controller, trailers)
  }

  onRequestUpgrade(controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    this.context.logger?.debug('TrafficanteInterceptor onRequestUpgrade')

    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  async onResponseError(controller: Dispatcher.DispatchController, err: Error): Promise<void> {
    this.context.logger?.error({ err }, 'TrafficanteInterceptor onResponseError')

    // Cleanup streams and abort pending requests
    if (this.writer && !this.writer.destroyed) {
      this.writer.destroy(err)
    }

    if (this.send) {
      this.send.catch((err) => {
        this.context.logger?.error({ err, requestUrl: this.context.request.url }, 'TrafficanteInterceptor error sending response body to trafficante #2')
        if (this.writer && !this.writer.destroyed) {
          this.writer.destroy(err)
        }
      })
    }

    this.handler.onResponseError?.(controller, err)
  }
}

export function createTrafficanteInterceptor(options: TrafficanteOptions = defaultTrafficanteOptions): Dispatcher.DispatchInterceptor {
  const { logger, ...optionsWithoutLogger } = options
  const validatedOptions: TrafficanteOptions = structuredClone(optionsWithoutLogger)
  // Validate options
  if (!validatedOptions.bloomFilter || typeof validatedOptions.bloomFilter.size !== 'number' || validatedOptions.bloomFilter.size <= 0) {
    throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_BLOOM_FILTER_SIZE')
  }
  if (!options.bloomFilter || typeof options.bloomFilter.errorRate !== 'number' || options.bloomFilter.errorRate <= 0 || options.bloomFilter.errorRate >= 1) {
    throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_BLOOM_FILTER_ERROR_RATE')
  }
  if (validatedOptions.maxResponseSize === undefined) {
    validatedOptions.maxResponseSize = defaultTrafficanteOptions.maxResponseSize
  } else if (typeof validatedOptions.maxResponseSize !== 'number' || validatedOptions.maxResponseSize <= 0) {
    throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_MAX_RESPONSE_SIZE')
  }
  if (!validatedOptions.trafficante || typeof validatedOptions.trafficante.url !== 'string' || validatedOptions.trafficante.url.length === 0) {
    throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_TRAFFICANTE_URL')
  }
  if (!validatedOptions.labels) {
    validatedOptions.labels = defaultTrafficanteOptions.labels
  }
  validatedOptions.skippingRequestHeaders = optionsWithoutLogger.skippingRequestHeaders ?? defaultTrafficanteOptions.skippingRequestHeaders
  validatedOptions.skippingResponseHeaders = optionsWithoutLogger.skippingResponseHeaders ?? defaultTrafficanteOptions.skippingResponseHeaders
  validatedOptions.interceptResponseStatusCodes = optionsWithoutLogger.interceptResponseStatusCodes ?? defaultTrafficanteOptions.interceptResponseStatusCodes
  validatedOptions.skippingCookieSessionIds = optionsWithoutLogger.skippingCookieSessionIds ?? defaultTrafficanteOptions.skippingCookieSessionIds

  validatedOptions.logger = logger

  const bloomFilter = new BloomFilter(validatedOptions.bloomFilter.size, validatedOptions.bloomFilter.errorRate)
  const client = new Client(validatedOptions.trafficante.url)

  return function trafficanteInterceptor(dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    return function InterceptedDispatch(
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatchOptions, validatedOptions, bloomFilter, client, handler))
    }
  }
}
