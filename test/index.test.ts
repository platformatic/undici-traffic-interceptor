import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { request, Agent } from 'undici'

import createTrafficInterceptor, { type TrafficInterceptorOptions } from '../src/index.ts'

import { createApp, createTrafficInspector, waitForLogMessage } from './helper.ts'

const defaultOptions: TrafficInterceptorOptions = {
  labels: {
    applicationId: 'app-1',
    taxonomyId: 'tax-1',
  },
  bloomFilter: {
    size: 1000,
    errorRate: 0.01,
  },
  maxResponseSize: 10 * 1024,
  trafficInspectorOptions: {
    url: '',
    pathSendBody: '/ingest-body',
    pathSendMeta: '/requests'
  },
}

describe('TrafficInterceptor', () => {
  test('should intercept request/response and send data to traffic inspector', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      if (message.msg === 'traffic inspector received body') {
        assert.equal(message.body, '[/dummy response]')
        assert.equal(message.headers['x-labels'], JSON.stringify(defaultOptions.labels))
        const requestData = JSON.parse(message.headers['x-request-data'])
        assert.equal(requestData.url, `http://localhost:${app.port}/dummy`)
        assert.equal(requestData.headers['Content-Type'], 'application/json')
        assert.equal(requestData.headers['User-Agent'], 'test-user-agent')
        const responseData = JSON.parse(message.headers['x-response-data'])
        assert.equal(responseData.headers['content-type'], 'text/plain; charset=utf-8')
        assert.equal(responseData.headers['content-length'], '17')
        return true
      }
      return false
    })
    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      if (message.msg === 'traffic inspector received meta') {
        assert.ok(typeof message.body.timestamp === 'number')
        assert.equal(message.headers['x-labels'], JSON.stringify(defaultOptions.labels))
        assert.equal(message.body.request.url, `http://localhost:${app.port}/dummy`)
        assert.equal(message.body.response.code, 200)
        assert.equal(message.body.response.bodyHash, '5034874602790624239')
        assert.equal(message.body.response.bodySize, 17)
        return true
      }
      return false
    })
  })

  test('should not pass request data to traffic inspector due to request headers, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

        await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            Object.keys(message.request?.headers ?? {}).some(requestHeader => {
              return requestHeader.toLowerCase() === header.toLowerCase()
            })
        })
      })())
    }

    await Promise.all(tasks)
  })

  test('should not pass request data to traffic inspector due to request domain filter', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger,
      matchingDomains: ['.sub.local', '.plt.local']
    }))

    const origins = ['https://local', 'https://sub1.sub2.local', 'http://local:3000']
    const path = '/dummy'

    for (const origin of origins) {
      const response = await request(`${app.host}${path}`, {
        dispatcher: agent,
        method: 'GET',
        headers: {
          Origin: origin
        }
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), `[${path} response]`)

      await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
        return message.msg === 'skip by request' && message.request?.headers['Origin'] === origin
      })
    }
  })

  test('should pass request data to traffic inspector with matching domains', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger,
      matchingDomains: ['.sub.plt', '.plt.local']
    }))

    const origins = [
      'https://sub.plt',
      'https://plt.local',
      'http://sub1.sub2.plt.local',
      'http://sub1.sub2.plt.local:3001'
    ]
    const path = '/api'

    for (const origin of origins) {
      const response = await request(`${app.host}${path}`, {
        dispatcher: agent,
        method: 'GET',
        headers: {
          Origin: origin
        }
      })

      assert.equal(response.statusCode, 200)
      assert.equal(await response.body.text(), `[${path} response]`)

      await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
        if (message.msg === 'traffic inspector received body') {
          const requestData = JSON.parse(message.headers['x-request-data'])
          return requestData.headers['Origin'] === origin
        }
        return false
      })
    }
  })

  test('should not pass request data to bloom filter but only meta, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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
      })())
    }

    await Promise.all(tasks)

    for (let i = 0; i < 10; i++) {
      await Promise.all([
        waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by bloom filter' && message.request?.headers['x-counter'] === i.toString()
        }),
        waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          if (message.msg === 'traffic inspector received meta') {
            assert.equal(message.body.request.url, `http://localhost:${app.port}${path}`)
            return true
          }
          return false
        })
      ])
    }
  })

  test('should not pass request data to traffic inspector due to request method, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

        await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            message.request?.method === method
        })
      })())
    }

    await Promise.all(tasks)
  })

  test('should pass request data to traffic inspector on missing or empty request headers', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

  test('should pass request data to traffic inspector on cookies that does not contain known auth tokens', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'traffic inspector received meta'
    })
  })

  test('should not pass request data to traffic inspector due to request cookies with known auth tokens, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

        await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by request' &&
            message.request?.headers?.['Cookie']?.includes(cookie)
        })
      })())
    }

    await Promise.all(tasks)
  })

  test('should not pass response data to traffic inspector due to response status code', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

      assert.ok(!trafficInspector.loggerSpy.buffer.some(log => {
        return log.msg === 'traffic inspector received body'
      }), 'traffic inspectormust not receive body')
      assert.ok(!trafficInspector.loggerSpy.buffer.some(log => {
        return log.msg === 'traffic inspector received meta'
      }), 'traffic inspectormust not receive meta')

      trafficInspector.loggerSpy.reset()
    }
  })

  test('should not pass response data to traffic inspector due to response headers, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

        await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by response' &&
            message.response?.headers[header.toLowerCase()] === skippingResponseHeaders[header]
        })
      })())
    }

    await Promise.all(tasks)
  })

  test('should not pass response data to traffic inspector due to response size', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      maxResponseSize: 10,
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
    }))

    await request(`${app.host}/any`, {
      dispatcher: agent,
      method: 'GET',
      query: { responseCode: 200, responseBody: 'something bigger than 10 bytes' }
    })

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'skip by response'
    })
  })

  test('should not pass response data to traffic inspector due to response headers cookies, with concurrency', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
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

        await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
          return message.msg === 'skip by response' &&
            message.response?.headers?.['set-cookie']?.includes(cookie)
        })
      })())
    }

    await Promise.all(tasks)
  })

  test('should handle abort request', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
    }))

    const abortController = new AbortController()
    setTimeout(() => {
      abortController.abort()
    }, 100)

    const response = await request(`${app.host}/echo`, {
      dispatcher: agent,
      method: 'GET',
      query: { delay: 2000 },
      signal: abortController.signal
    })

    // @ts-ignore
    assert.rejects(response.body.dump({ signal: abortController.signal }))

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor onRequestStart'
    })
    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor onRequestAbort'
    })
    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor onResponseData'
    })
    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor onResponseEnd'
    })
  })

  test('should handle error response from traffic inspectormeta', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t, errorMeta: true })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
    }))

    await request(`${app.host}/echo`, {
      dispatcher: agent,
      method: 'GET'
    })

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor error sending meta to traffic inspector' &&
        message.request?.url === `http://localhost:${app.port}/echo` &&
        message.response?.code === 500
    })
  })

  test('should handle error response from traffic inspectorbody', async (t) => {
    const app = await createApp({ t })
    const trafficInspector = await createTrafficInspector({ t, errorBody: true })
    const agent = new Agent().compose(createTrafficInterceptor({
      ...structuredClone(defaultOptions),
      trafficInspectorOptions: {
        ...defaultOptions.trafficInspectorOptions,
        url: trafficInspector.url,
      },
      logger: trafficInspector.logger
    }))

    await request(`${app.host}/echo`, {
      dispatcher: agent,
      method: 'GET'
    })

    await waitForLogMessage(trafficInspector.loggerSpy, (message) => {
      return message.msg === 'TrafficInterceptor error sending body to traffic inspector' &&
        message.request?.url === `http://localhost:${app.port}/echo` &&
        message.response?.code === 500
    })
  })
})
