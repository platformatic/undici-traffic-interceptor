import { Dispatcher } from 'undici'
import { Duplex } from 'stream'
import { IncomingHttpHeaders } from 'http'

class TrafficanteInterceptor implements Dispatcher.DispatchHandler {
  private dispatch: Dispatcher['dispatch']
  private request: Partial<Dispatcher.DispatchOptions>
  private handler: Dispatcher.DispatchHandler

  constructor (
    dispatch: Dispatcher['dispatch'],
    request: Partial<Dispatcher.DispatchOptions>,
    handler: Dispatcher.DispatchHandler
  ) {
    this.dispatch = dispatch
    this.request = request
    this.handler = handler
  }

  onRequestStart (controller: Dispatcher.DispatchController, context: unknown): void {
    console.log(' >>> onRequestStart')

    // TODO identify request by path/query string (headers?)
    // TODO skip requests that are not matching
    // TODO matching by method=GET, no cache headers, no auth headers
    // TODO implement bloom filter

    this.handler.onRequestStart?.(controller, context)
  }

  onRequestUpgrade (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void {
    console.log(' >>> onRequestUpgrade')
    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  onResponseStart (controller: Dispatcher.DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void {
    console.log(' >>> onResponseStart')

    // TODO
    // const { origin, pathname, search } = util.parseURL(new URL(this.location, this.opts.origin && new URL(this.opts.path, this.opts.origin)))
    // const path = search ? `${pathname}${search}` : pathname
    // this.request.headers = cleanRequestHeaders(this.request.headers, statusCode === 303, this.request.origin !== origin)
    // this.request.path = path
    // this.request.origin = origin

    // TODO skip response by response size: do we trust content-length?

    this.handler.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  onResponseData (controller: Dispatcher.DispatchController, chunk: Buffer): void {
    console.log(' >>> onResponseData')

    // TODO hash response body

    this.handler.onResponseData?.(controller, chunk)
  }

  onResponseEnd (controller: Dispatcher.DispatchController, trailers: IncomingHttpHeaders): void {
    console.log(' >>> onResponseEnd')
    this.handler.onResponseEnd?.(controller, trailers)
  }

  onResponseError (controller: Dispatcher.DispatchController, error: Error): void {
    console.log(' >>> onResponseError', error)
    this.handler.onResponseError?.(controller, error)
  }
}

export function createTrafficanteInterceptor (options: Partial<Dispatcher.DispatchOptions>): Dispatcher.DispatchInterceptor {
  return function trafficanteInterceptor (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] {
    console.log('createTrafficanteInterceptor', options)

    return function InterceptedDispatch (
      dispatchOptions: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler
    ): boolean {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatch, options, handler))
    }
  }
}
