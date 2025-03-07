// TODO types

// see undici RedirectHandler
class TrafficanteInterceptor {
  constructor (dispatch, request, handler) {
    this.dispatch = dispatch
    this.request = request
    this.handler = handler

    // TODO if (util.isStream(this.request.body)) {
  }

  onRequestStart (controller, context) {
    console.log(' >>> onRequestStart')

    // TODO identify request by path/url/headers
    // TODO skip requests that are not matching
    // TODO matching by method=GET, no cache headers, no auth headers
    // TODO implement bloom filter

    this.handler.onRequestStart?.(controller, context)
  }

  onRequestUpgrade (controller, statusCode, headers, socket) {
    console.log(' >>> onRequestUpgrade')
    this.handler.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }

  onResponseStart (controller, statusCode, headers, statusMessage) {
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

  onResponseData (controller, chunk) {
    console.log(' >>> onResponseData')

    // TODO hash response body

    this.handler.onResponseData?.(controller, chunk)
  }

  onResponseEnd (controller, trailers) {
    console.log(' >>> onResponseEnd')
    this.handler.onResponseEnd?.(controller, trailers)
  }

  onResponseError (controller, error) {
    console.log(' >>> onResponseError', error)
    this.handler.onResponseError?.(controller, error)
  }
}

export function createTrafficanteInterceptor (options: any) {
  return function trafficanteInterceptor (dispatch: any) {
    console.log('createTrafficanteInterceptor', options)

    // https://blog.platformatic.dev/http-fundamentals-understanding-undici-and-its-working-mechanism#heading-handlers

    return function InterceptedDispatch (dispatchOptions: any, handler: any) {
      return dispatch(dispatchOptions, new TrafficanteInterceptor(dispatch, options, handler))
    }
  }
}
