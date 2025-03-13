import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { request, Agent } from 'undici'

import { createTrafficanteInterceptor, type TrafficanteOptions } from '../src/index.ts'

import { createApp, createTrafficante, waitForLogMessage } from './helper.ts'

const defaultOptions: TrafficanteOptions = {
  labels: {
    applicationId: 'app-1',
    taxonomyId: 'tax-1',
  },
  bloomFilter: {
    size: 1000,
    errorRate: 0.01,
  },
  maxResponseSize: 10 * 1024,
  trafficante: {
    url: '',
    pathSendBody: '/ingest-body',
    pathSendMeta: '/ingest-meta'
  }
}

describe('TrafficanteInterceptor', () => {
  test('should intercept request/response and send to trafficante', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const response = await request(`${app.host}/dummy`, {
      dispatcher: agent,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'test-user-agent'
      }
    })

    assert.equal(response.statusCode, 200)
    assert.equal(await response.body.text(), '[/dummy response]')
    assert.equal(response.headers['x-request-headers-user-agent'], 'test-user-agent')
    assert.equal(response.headers['x-request-headers-content-type'], 'application/json')

    await Promise.all([
      waitForLogMessage(trafficante.loggerSpy, (received) => {
        if (received.msg === 'received body') {
          return received.body === '[/dummy response]' &&
            received.headers['x-trafficante-labels'] === '{"applicationId":"app-1","taxonomyId":"tax-1"}' &&
            received.headers['x-request-data'] === `{"url":"localhost:${app.port}/dummy","headers":{"Content-Type":"application/json","User-Agent":"test-user-agent"}}` &&
            (() => {
              const responseData = JSON.parse(received.headers['x-response-data'])
              return responseData.headers['x-request-headers-host'] === `localhost:${app.port}` &&
                responseData.headers['content-type'] === 'text/plain; charset=utf-8' &&
                responseData.headers['content-length'] === '17' &&
                responseData.code === 200
            })()
        }
        return false
      }),
      waitForLogMessage(trafficante.loggerSpy, (received) => {
        return received.msg === 'received meta' &&
          received.headers['x-request-url'] === `localhost:${app.port}/dummy` &&
          received.headers['x-response-hash'] === '5034874602790624239'
      }),
    ])
  })

  test('should not pass request data to trafficante due to request headers, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const skippingRequestHeaders = {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'If-None-Match': 'test-if-none-match',
      'If-Modified-Since': 'test-if-modified-since',
      Authorization: 'test-authorization',
      'Proxy-Authorization': 'test-proxy-authorization',
    }

    const promises: Promise<void>[] = []
    for (const header of Object.keys(skippingRequestHeaders)) {
      promises.push((async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method: 'GET',
          headers: { [header]: skippingRequestHeaders[header] }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            Object.keys(received.request?.headers ?? {}).some(requestHeader => {
              return requestHeader.toLowerCase() === header.toLowerCase()
            })
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should not pass request data to bloom filter but only meta, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const path = '/api/test'

    {
      const response = await request(`${app.host}${path}`, {
        dispatcher: agent,
        method: 'GET',
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), `[${path} response]`)
    }

    const promises: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      promises.push((async () => {
        const response = await request(`${app.host}${path}`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseBody: 'OK' },
          headers: { 'x-counter': i.toString() }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), 'OK')

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by bloom filter' &&
            received.request?.headers['x-counter'] === i.toString()
        })

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'received meta' &&
            received.headers['x-request-url'] === `localhost:${app.port}${path}` &&
            received.headers['x-response-hash'] === '8770641927759941325'
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should not pass request data to trafficante due to request method, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const skippingRequestMethods = [
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'OPTIONS'
    ]

    const promises: Promise<void>[] = []
    for (const method of skippingRequestMethods) {
      promises.push((async () => {
        const response = await request(`${app.host}/method`, {
          dispatcher: agent,
          method,
        })

        assert.equal(response.statusCode, 200)

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            received.request?.method === method
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should pass request data to trafficante on missing or empty request headers', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    {
      const response = await request(`${app.host}/dummy`, {
        dispatcher: agent,
        method: 'GET',
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), '[/dummy response]')
    }

    {
      const response = await request(`${app.host}/dummy`, {
        dispatcher: agent,
        method: 'GET',
        headers: {}
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), '[/dummy response]')
    }
  })

  test('should pass request data to trafficante on cookies', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    {
      const response = await request(`${app.host}/dummy`, {
        dispatcher: agent,
        method: 'GET',
        headers: {
          Cookie: 'test-cookie'
        }
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), '[/dummy response]')
    }
  })

  test('should not pass request data to trafficante due to request cookies with known auth tokens, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const skippingCookies = [
      'sessionId=123',
      'PHPSESSID=456',
      'authToken=789',
      'SSID=101',
      'refreshToken=202',
      'accessToken=303',
      'session=abc;something=else'
    ]

    const promises: Promise<void>[] = []
    for (const cookie of skippingCookies) {
      promises.push((async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method: 'GET',
          headers: {
            Cookie: cookie
          }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            received.request?.headers['Cookie'] === cookie
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should not pass response data to trafficante due to response status code', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const requests = [
      {
        path: '/any',
        method: 'GET',
        qs: { responseCode: 500 }
      },
      {
        path: '/product/43',
        method: 'GET',
        qs: { responseCode: 400 },
      }
    ]

    for (const req of requests) {
      await request(`${app.host}${req.path}`, {
        dispatcher: agent,
        method: req.method,
        query: req.qs
      })

      assert.ok(!trafficante.loggerSpy.buffer.some(log => {
        return log.msg === 'received body'
      }), 'trafficante must not receive body')
      assert.ok(!trafficante.loggerSpy.buffer.some(log => {
        return log.msg === 'received meta'
      }), 'trafficante must not receive meta')

      trafficante.loggerSpy.reset()
    }
  })

  test('should not pass response data to trafficante due to response headers, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const skippingResponseHeaders = {
      'Cache-Control': 'cache=public,max-age=100',
      Etag: 'some-hash',
      'Last-Modified': '10 Dec 2024 10:00:00 GMT',
      Expires: '10 May 2025 10:00:00 GMT'
    }

    const promises: Promise<void>[] = []
    for (const header of Object.keys(skippingResponseHeaders)) {
      promises.push((async () => {
        await request(`${app.host}/echo`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseHeader: header, responseHeaderValue: skippingResponseHeaders[header] }
        })

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by response' &&
            received.response?.headers[header.toLowerCase()] === skippingResponseHeaders[header]
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should not pass response data to trafficante due to response size', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      maxResponseSize: 10,
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    await request(`${app.host}/any`, {
      dispatcher: agent,
      method: 'GET',
      query: { responseCode: 200, responseBody: 'something bigger than 10 bytes' }
    })

    await waitForLogMessage(trafficante.loggerSpy, (received) => {
      return received.msg === 'skip by response'
    })
  })

  test('should not pass response data to trafficante due to response headers cookies, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const skippingCookies = [
      'connect.sid=123;something=else',
      'JSESSIONID=456;something=else',
      'PHPSESSID=789;something=else',
      'SID=101;something=else',
      'SSID=202;something=else',
      'XSRF-TOKEN=606;something=else',
      'X-CSRF-TOKEN=707;something=else'
    ]

    const promises: Promise<void>[] = []
    for (const cookie of skippingCookies) {
      promises.push((async () => {
        await request(`${app.host}/echo`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseHeader: 'Set-Cookie', responseHeaderValue: cookie }
        })

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by response' &&
            received.response?.headers['set-cookie'] === cookie
        })
      })())
    }

    await Promise.all(promises)
  })

  test('should pass response hash on multiple requests', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      },
      logger: trafficante.logger
    }))

    const requests = [
      {
        path: '/product/42',
        method: 'GET',
        qs: { responseCode: 200, responseBody: '{"id": 42, "name": "Funny Hat"}' },
        expected: {
          body: true,
          meta: { hash: '14931838552541713377' },
        }
      },
      {
        path: '/product/43',
        method: 'GET',
        qs: { responseCode: 200, responseBody: '{"id": 43, "name": "Rubber Duck"}' },
        expected: {
          body: true,
          meta: { hash: '9396428268935065097' },
        }
      },
      {
        path: '/product/42',
        method: 'GET',
        qs: { responseCode: 200, responseBody: '{"id": 42, "name": "Funny Hat"}' },
        expected: {
          body: false,
          meta: { hash: '14931838552541713377' },
        }
      },
      {
        path: '/product/42',
        method: 'GET',
        qs: { responseCode: 200, responseBody: '{"id": 42, "name": "Funny Yellow Hat"}' },
        expected: {
          body: false,
          meta: { hash: '17504836946288787088' },
        }
      },
      {
        path: '/product/42',
        method: 'GET',
        qs: { responseCode: 500 },
        expected: {
          body: false,
          meta: null,
        }
      },
    ]

    for (const req of requests) {
      await request(`${app.host}${req.path}`, {
        dispatcher: agent,
        method: req.method,
        query: req.qs
      })

      if (req.expected.body) {
        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'received body' && received.body === req.qs.responseBody &&
            received.headers['x-trafficante-labels'] === '{"applicationId":"app-1","taxonomyId":"tax-1"}' &&
            received.headers['x-request-data'] === `{"url":"localhost:${app.port}${req.path}"}`
        })
      } else {
        assert.ok(!trafficante.loggerSpy.buffer.some(log => {
          return log.msg === 'received body'
        }), 'received body is not expected for request ' + req.path)
      }

      if (req.expected.meta) {
        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'received meta' &&
            received.headers['x-request-url'] === `localhost:${app.port}${req.path}` &&
            received.headers['x-response-hash'] === req.expected.meta?.hash
        })
      } else {
        assert.ok(!trafficante.loggerSpy.buffer.some(log => {
          return log.msg === 'received meta'
        }), 'trafficante must not receive meta for request ' + req.path)
      }

      trafficante.loggerSpy.reset()
    }
  })
})
