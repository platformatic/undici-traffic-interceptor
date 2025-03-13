import { Client, Dispatcher } from 'undici'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import { PassThrough, type Duplex } from 'node:stream'
import { xxh3 } from '@node-rs/xxhash'
import { interceptRequest, interceptResponse, type TrafficanteOptions } from './trafficante.ts'
import { BloomFilter } from './bloom-filter.ts'
import type { Logger } from 'pino'

const defaultTrafficanteOptions: TrafficanteOptions = {
  bloomFilter: {
    size: 100_000,
    errorRate: 0.1,
  },
  maxResponseSize: 5 * 1024 * 1024, // 5MB
  trafficante: {
    url: '',
    pathSendBody: '/ingest-body',
    pathSendMeta: '/ingest-meta',
  },
  labels: {},
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

  skipByRequest: boolean | undefined
  skipByResponse: boolean | undefined
}

class TrafficanteInterceptor implements Dispatcher.DispatchHandler {
  private handler: Dispatcher.DispatchHandler

  private bloomFilter!: BloomFilter
  private client!: Client

  private context!: InterceptorContext

  private send!: Promise<Dispatcher.ResponseData<null>>
  private writer!: PassThrough

  private interceptRequest: (context: InterceptorContext) => boolean
  private interceptResponse: (context: InterceptorContext) => boolean

  constructor (
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
      hasher: xxh3.Xxh3.withSeed(), // TODO seed option?
      logger: options.logger,
      labels: options.labels ?? {},

      request: {
        method: '',
        headers: {},
      },
      response: {
        statusCode: -1,
        headers: {},
      },

      skipByRequest: undefined,
      skipByResponse: undefined,
    }

    this.interceptRequest = options.interceptRequest ?? interceptRequest
    this.interceptResponse = options.interceptResponse ?? interceptResponse
  }

  onRequestStart (controller: Dispatcher.DispatchController, context: unknown): void {
    this.context.request.method = this.context.dispatchOptions.method as Dispatcher.HttpMethod
    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders

    if (!this.interceptRequest(this.context)) {
      this.context.logger?.debug({ request: this.context.request }, 'skip by request')
      this.context.skipByRequest = true
      this.handler.onRequestStart?.(controller, context)
      return
    }

    const url = new URL(this.context.dispatchOptions.path as string, this.context.dispatchOptions.origin as string)
    this.context.request.url = url.host + url.pathname

    this.context.request.hash = this.context.hasher.update(this.context.request.url).digest()
    if (this.bloomFilter.has(this.context.request.hash)) {
      this.context.logger?.debug('skip by bloom filter')
      this.context.skipByRequest = true
      this.handler.onRequestStart?.(controller, context)
      return
    }
    this.bloomFilter.add(this.context.request.hash)

    this.handler.onRequestStart?.(controller, context)
  }

  onResponseStart (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    this.context.response = {
      statusCode,
      headers
    }

    if (!this.interceptResponse(this.context)) {
      this.context.logger?.debug('skip by response')
      this.context.skipByResponse = true
      this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
      return
    }

    // Send data to trafficante
    const responseBodyPassthrough = new PassThrough()
    this.send = this.client.request({
      path: this.context.options.trafficante.pathSendBody,
      method: 'POST',
      headers: {
        'content-type': this.context.response.headers['content-type'] || 'application/octet-stream',
        'content-length': (this.context.response.headers['content-length'] ?? '0').toString(),
        'x-trafficante-labels': JSON.stringify(this.context.labels),
        'x-request-data': JSON.stringify({
          url: this.context.request.url,
          headers: this.context.request.headers
        }),
        'x-response-data': JSON.stringify({
          headers: this.context.response.headers,
          code: this.context.response.statusCode
        })
      },
      body: responseBodyPassthrough
    })
    // TODO trafficante not return 200
    this.writer = responseBodyPassthrough

    this.context.hasher.reset()

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  async onResponseData (controller: Dispatcher.DispatchController, chunk: Buffer): Promise<void> {
    if (this.context.skipByResponse) {
      this.handler.onResponseData?.(controller, chunk)
      return
    }

    this.context.hasher.update(chunk)

    this.writer.write(chunk)

    this.handler.onResponseData?.(controller, chunk)
  }

  async onResponseEnd (controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): Promise<void> {
    if (this.context.skipByResponse) {
      this.handler.onResponseEnd?.(controller, trailers)
      return
    }

    this.writer.end()
    await this.send

    this.context.response.hash = this.context.hasher.digest()

    await this.client.request({
      path: this.context.options.trafficante.pathSendMeta,
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-request-url': this.context.request.url,
        'x-response-hash': this.context.response.hash.toString()
      }
    })
    // TODO trafficante not return 200

    this.handler.onResponseEnd?.(controller, trailers)
  }

  onRequestUpgrade (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  async onResponseError (controller: Dispatcher.DispatchController, error: Error): Promise<void> {
    this.context.logger?.error('TrafficanteInterceptor onResponseError', error)

    // TODO Abort the stream and clean up
    // this.writer.destroy(error)
    // const response = await this.send
    // if (response.body) {
    //   await (response.body as any).cancel()
    // }

    this.handler.onResponseError?.(controller, error)
  }
}

export function createTrafficanteInterceptor (options: TrafficanteOptions = defaultTrafficanteOptions): Dispatcher.DispatchInterceptor {
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
  validatedOptions.logger = logger

  const bloomFilter = new BloomFilter(validatedOptions.bloomFilter.size, validatedOptions.bloomFilter.errorRate)
  const client = new Client(validatedOptions.trafficante.url)

  return function trafficanteInterceptor (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    return function InterceptedDispatch (
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatchOptions, validatedOptions, bloomFilter, client, handler))
    }
  }
}
