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
    pathSendMeta: '/requests'
  }
}

describe('TrafficanteInterceptor', () => {
  test('should intercept request/response and send data to trafficante', async (t) => {
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
      waitForLogMessage(trafficante.loggerSpy, (message) => {
        if (message.msg === 'trafficante received body') {
          assert.equal(message.body, '[/dummy response]')
          assert.equal(message.headers['x-request-url'], `localhost:${app.port}/dummy`)
          return true
        }
        return false
      }),
      waitForLogMessage(trafficante.loggerSpy, (message) => {
        if (message.msg === 'trafficante received meta') {
          assert.equal(message.body.applicationId, defaultOptions.labels.applicationId)
          assert.equal(message.body.taxonomyId, defaultOptions.labels.taxonomyId)
          assert.ok(typeof message.body.timestamp === 'number')
          assert.equal(message.body.request.url, `localhost:${app.port}/dummy`)
          assert.equal(message.body.request.headers['Content-Type'], 'application/json')
          assert.equal(message.body.request.headers['User-Agent'], 'test-user-agent')
          assert.equal(message.body.response.code, 200)
          assert.equal(message.body.response.headers['content-type'], 'text/plain; charset=utf-8')
          assert.equal(message.body.response.bodyHash, '5034874602790624239')
          assert.equal(message.body.response.bodySize, 17)
          return true
        }
        return false
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

    const tasks: Promise<void>[] = []
    for (const header of Object.keys(skippingRequestHeaders)) {
      tasks.push((async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method: 'GET',
          headers: { [header]: skippingRequestHeaders[header] }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            Object.keys(message.request?.headers ?? {}).some(requestHeader => {
              return requestHeader.toLowerCase() === header.toLowerCase()
            })
        })
      })())
    }

    await Promise.all(tasks)
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

    const tasks: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      tasks.push((async () => {
        const response = await request(`${app.host}${path}`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseBody: 'OK' },
          headers: { 'x-counter': i.toString() }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), 'OK')

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by bloom filter' && message.request?.headers['x-counter'] === i.toString()
        })

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          if (message.msg === 'trafficante received meta') {
            assert.equal(message.body.request.url, `localhost:${app.port}${path}`)
            return message.body.request.headers?.['x-counter'] === i.toString()
          }
          return false
        })
      })())
    }

    await Promise.all(tasks)
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

    const tasks: Promise<void>[] = []
    for (const method of skippingRequestMethods) {
      tasks.push((async () => {
        const response = await request(`${app.host}/method`, {
          dispatcher: agent,
          method,
        })

        assert.equal(response.statusCode, 200)

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            message.request?.method === method
        })
      })())
    }

    await Promise.all(tasks)
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

  test('should pass request data to trafficante on cookies that does not contain known auth tokens', async (t) => {
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
        Cookie: 'test-cookie'
      }
    })

    assert.equal(response.statusCode, 200)
    assert.equal(await response.body.text(), '[/dummy response]')

    await waitForLogMessage(trafficante.loggerSpy, (message) => {
      return message.msg === 'trafficante received meta'
    })
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

    const tasks: Promise<void>[] = []
    for (const cookie of skippingCookies) {
      tasks.push((async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method: 'GET',
          headers: {
            Cookie: cookie
          }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            message.request?.headers?.['Cookie']?.includes(cookie)
        })
      })())
    }

    await Promise.all(tasks)
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
        return log.msg === 'trafficante received body'
      }), 'trafficante must not receive body')
      assert.ok(!trafficante.loggerSpy.buffer.some(log => {
        return log.msg === 'trafficante received meta'
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

    const tasks: Promise<void>[] = []
    for (const header of Object.keys(skippingResponseHeaders)) {
      tasks.push((async () => {
        await request(`${app.host}/echo`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseHeader: header, responseHeaderValue: skippingResponseHeaders[header] }
        })

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by response' &&
            message.response?.headers[header.toLowerCase()] === skippingResponseHeaders[header]
        })
      })())
    }

    await Promise.all(tasks)
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

    await waitForLogMessage(trafficante.loggerSpy, (message) => {
      return message.msg === 'skip by response'
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

    const tasks: Promise<void>[] = []
    for (const cookie of skippingCookies) {
      tasks.push((async () => {
        await request(`${app.host}/echo`, {
          dispatcher: agent,
          method: 'GET',
          query: { responseHeader: 'Set-Cookie', responseHeaderValue: cookie }
        })

        await waitForLogMessage(trafficante.loggerSpy, (message) => {
          return message.msg === 'skip by response' &&
            message.response?.headers?.['set-cookie']?.includes(cookie)
        })
      })())
    }

    await Promise.all(tasks)
  })
})
