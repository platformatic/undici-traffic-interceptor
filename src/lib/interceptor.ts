import { Dispatcher } from 'undici'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { Duplex } from 'node:stream'
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
    hash?: bigint // hash of url.pathname + query
  }

  // response
  response: {
    statusCode: number
    headers: OutgoingHttpHeaders
    hash?: bigint // hash of response body
  }

  skip: boolean | undefined
}

class TrafficanteInterceptor implements Dispatcher.DispatchHandler {
  private dispatch: Dispatcher['dispatch']
  private handler: Dispatcher.DispatchHandler

  private bloomFilter!: BloomFilter

  private context!: InterceptorContext

  private interceptRequest: (context: InterceptorContext) => boolean
  private hashRequest: (context: InterceptorContext) => bigint
  private extractDataFromRequest: (context: InterceptorContext) => Record<string, string>
  private interceptResponse: (context: InterceptorContext) => boolean

  constructor (
    dispatchOptions: Partial<Dispatcher.DispatchOptions>,
    options: TrafficanteOptions,
    bloomFilter: BloomFilter,
    dispatch: Dispatcher['dispatch'],
    handler: Dispatcher.DispatchHandler
  ) {
    // TODO validate options

    this.dispatch = dispatch
    this.handler = handler

    this.bloomFilter = bloomFilter

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

  onRequestStart (controller: Dispatcher.DispatchController, context: unknown): void {
    console.log(' >>> onRequestStart', this.context.dispatchOptions)

    if (this.interceptRequest(this.context)) {
      console.log('    ! onRequestStart skip')
      this.context.skip = true
      return this.handler.onRequestStart?.(controller, this.context)
    }

    this.context.request.method = this.context.dispatchOptions.method as Dispatcher.HttpMethod
    this.context.request.headers = this.context.dispatchOptions.headers as IncomingHttpHeaders
    this.context.request.url = new URL(this.context.dispatchOptions.path as string, this.context.dispatchOptions.origin as string)
    this.context.request.query = JsonStringify(Object.fromEntries(this.context.request.url.searchParams))
    this.context.request.hash = this.hashRequest(this.context)
    this.context.data = this.extractDataFromRequest(this.context)

    if (this.bloomFilter.has(this.context.request.hash)) {
      this.context.skip = true
      return this.handler.onRequestStart?.(controller, context)
    }

    this.handler.onRequestStart?.(controller, context)
  }

  onResponseStart (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    console.log(' >>> onResponseStart', statusCode, headers, statusMessage)
    console.log(' >>> onResponseStart', this.context)

    this.context.response = {
      statusCode,
      headers
    }

    if (this.context.skip || this.interceptResponse(this.context)) {
      return this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
    }

    // TODO start sending to trafficante

    this.context.hasher.reset()

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  onResponseData (controller: Dispatcher.DispatchController, chunk: Buffer): void {
    console.log(' >>> onResponseData')

    this.context.hasher.update(chunk)

    // TODO pipe to trafficante

    this.handler.onResponseData?.(controller, chunk)
  }

  onResponseEnd (controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): void {
    console.log(' >>> onResponseEnd')


    this.context.response.hash = this.context.hasher.digest()

    // TODO send hash of response body as trailing header
    // TODO finalize sending to trafficante

    this.handler.onResponseEnd?.(controller, trailers)
  }

  onRequestUpgrade (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    console.log(' >>> onRequestUpgrade')
    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  onResponseError (controller: Dispatcher.DispatchController, error: Error): void {
    console.log(' >>> onResponseError')

    // TODO finalize sending to trafficante or abort

    this.handler.onResponseError?.(controller, error)
  }
}

export function createTrafficanteInterceptor (options: TrafficanteOptions = defaultTrafficanteOptions): Dispatcher.DispatchInterceptor {
  const bloomFilter = new BloomFilter(options.bloomFilter.size, options.bloomFilter.errorRate)

  return function trafficanteInterceptor (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    console.log('createTrafficanteInterceptor', options)

    return function InterceptedDispatch (
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatchOptions, options, bloomFilter, dispatch, handler))
    }
  }
}
