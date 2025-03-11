import { Client, Dispatcher, request } from 'undici'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import { Readable, PassThrough, type Duplex } from 'node:stream'
import { URL } from 'node:url'
import { stringify as JsonStringify } from 'safe-stable-stringify'
import { xxh3 } from '@node-rs/xxhash'
import { hashRequest, extractDataFromRequest, interceptRequest, interceptResponse, type TrafficanteOptions } from './trafficante.ts'
import { BloomFilter } from './bloom-filter.ts'

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
}

export type InterceptorContext = {
  dispatchOptions: Partial<Dispatcher.DispatchOptions>,
  options: TrafficanteOptions,
  hasher: xxh3.Xxh3, // TODO generic interface: reset, update, digest: bigint

  data?: Record<string, string> // extracted request data

  // request
  request: {
    method: Dispatcher.HttpMethod
    headers: IncomingHttpHeaders
    url?: URL
    query?: string // stable json stringified query string
    hash?: bigint // hash of url.pathname + stable json stringified query string
    hashString?: string
  }

  // response
  response: {
    statusCode: number
    headers: OutgoingHttpHeaders
    hash?: bigint // hash of response body
    hashString?: string
  }

  skip: boolean | undefined
}

class TrafficanteInterceptor implements Dispatcher.DispatchHandler {
  private dispatch: Dispatcher['dispatch']
  private handler: Dispatcher.DispatchHandler

  private bloomFilter!: BloomFilter
  private client!: Client
  
  private context!: InterceptorContext

  private send!: Promise<Dispatcher.ResponseData<null>>
  private writer!: PassThrough

  private interceptRequest: (context: InterceptorContext) => boolean
  private hashRequest: (context: InterceptorContext) => bigint
  private extractDataFromRequest: (context: InterceptorContext) => Record<string, string>
  private interceptResponse: (context: InterceptorContext) => boolean

  constructor(
    dispatchOptions: Partial<Dispatcher.DispatchOptions>,
    options: TrafficanteOptions,
    bloomFilter: BloomFilter,
    client: Client,
    dispatch: Dispatcher['dispatch'],
    handler: Dispatcher.DispatchHandler
  ) {
    // Validate options
    if (!options.bloomFilter || typeof options.bloomFilter.size !== 'number' || options.bloomFilter.size <= 0) {
      throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_BLOOM_FILTER_SIZE')
    }
    if (!options.bloomFilter || typeof options.bloomFilter.errorRate !== 'number' || options.bloomFilter.errorRate <= 0 || options.bloomFilter.errorRate >= 1) {
      throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_BLOOM_FILTER_ERROR_RATE')
    }
    if (typeof options.maxResponseSize !== 'number' || options.maxResponseSize <= 0) {
      throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_MAX_RESPONSE_SIZE')
    }
    if (!options.trafficante || typeof options.trafficante.url !== 'string' || options.trafficante.url.length === 0) {
      throw new Error('TRAFFICANTE_INTERCEPTOR_INVALID_TRAFFICANTE_URL')
    }

    this.dispatch = dispatch
    this.handler = handler

    this.bloomFilter = bloomFilter
    this.client = client

    this.context = {
      dispatchOptions,
      options,
      hasher: xxh3.Xxh3.withSeed(), // TODO seed option?

      request: {
        method: 'GET',
        headers: {},
      },
      response: {
        statusCode: -1,
        headers: {},
      },

      skip: undefined,
    }

    this.interceptRequest = options.interceptRequest ?? interceptRequest
    this.hashRequest = options.hashRequest ?? hashRequest
    this.extractDataFromRequest = options.extractDataFromRequest ?? extractDataFromRequest
    this.interceptResponse = options.interceptResponse ?? interceptResponse
  }

  onRequestStart(controller: Dispatcher.DispatchController, context: unknown): void {
    // console.log(' >>> onRequestStart', this.context.dispatchOptions)

    if (!this.interceptRequest(this.context)) {
      console.log('    ! skip by request')
      this.context.skip = true
      return this.handler.onRequestStart?.(controller, this.context)
    }

    this.context.request.method = this.context.dispatchOptions.method as Dispatcher.HttpMethod
    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders
    this.context.request.url = new URL(this.context.dispatchOptions.path as string, this.context.dispatchOptions.origin as string)
    this.context.request.query = JsonStringify(Object.fromEntries(this.context.request.url.searchParams))
    this.context.request.hash = this.hashRequest(this.context)
    this.context.request.hashString = this.context.request.hash.toString()
    this.context.data = this.extractDataFromRequest(this.context)

    if (this.bloomFilter.has(this.context.request.hash)) {
      this.context.skip = true
      return this.handler.onRequestStart?.(controller, context)
    }
    this.bloomFilter.add(this.context.request.hash)

    this.handler.onRequestStart?.(controller, context)
  }

  onResponseStart(controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    // console.log(' >>> onResponseStart', statusCode, headers, statusMessage)
    // console.log(' >>> onResponseStart', this.context)

    this.context.response = {
      statusCode,
      headers
    }

    if (this.context.skip || !this.interceptResponse(this.context)) {
      console.log('    ! skip by response')
      this.context.skip = true
      return this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
    }

    // Send data to trafficante
    const responseBodyPassthrough = new PassThrough()
    this.send = this.client.request({
      path: this.context.options.trafficante.pathSendBody,
      method: 'POST',
      headers: {
        'content-type': this.context.response.headers['content-type'] || 'application/octet-stream',
        'content-length': (this.context.response.headers['content-length'] ?? '0').toString(),
        'x-trafficante-data': JSON.stringify(this.context.data),
        'x-request-data': JSON.stringify({ url: this.context.request.url?.href, headers: this.context.request.headers }),
        'x-response-data': JSON.stringify({ headers: this.context.response.headers, code: this.context.response.statusCode })
      },
      body: responseBodyPassthrough
    })
    this.writer = responseBodyPassthrough

    this.context.hasher.reset()

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  async onResponseData(controller: Dispatcher.DispatchController, chunk: Buffer): Promise<void> {
    // console.log(' >>> onResponseData')
    if (this.context.skip) {
      return this.handler.onResponseData?.(controller, chunk)
    }

    this.context.hasher.update(chunk)

    this.writer.write(chunk)

    this.handler.onResponseData?.(controller, chunk)
  }

  async onResponseEnd(controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): Promise<void> {
    console.log(' >>> onResponseEnd')

    if (this.context.skip) {
      return this.handler.onResponseEnd?.(controller, trailers)
    }

    this.writer.end()
    await this.send

    this.context.response.hash = this.context.hasher.digest()
    this.context.response.hashString = this.context.response.hash.toString()

    await this.client.request({
      path: this.context.options.trafficante.pathSendMeta,
      method: 'POST', // GET?
      headers: {
        'content-type': 'application/json',
        // ? 'x-trafficante-data': JSON.stringify(this.context.data)
      },
      body: JSON.stringify({
        requestHash: this.context.request.hashString ?? '',
        responseHash: this.context.response.hashString ?? ''
      })
    })    

    this.handler.onResponseEnd?.(controller, trailers)
  }

  onRequestUpgrade(controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    console.log(' >>> onRequestUpgrade')
    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  async onResponseError(controller: Dispatcher.DispatchController, error: Error): Promise<void> {
    console.log(' >>> onResponseError')

    if (this.context.skip) {
      return this.handler.onResponseError?.(controller, error)
    }

    // TODO Abort the stream and clean up
    // this.writer.destroy(error)
    // const response = await this.send
    // if (response.body) {
    //   await (response.body as any).cancel()
    // }

    this.handler.onResponseError?.(controller, error)
  }
}

export function createTrafficanteInterceptor(options: TrafficanteOptions = defaultTrafficanteOptions): Dispatcher.DispatchInterceptor {
  const bloomFilter = new BloomFilter(options.bloomFilter.size, options.bloomFilter.errorRate)
  const client = new Client(options.trafficante.url)

  return function trafficanteInterceptor(dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    return function InterceptedDispatch(
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatchOptions, options, bloomFilter, client, dispatch, handler))
    }
  }
}
