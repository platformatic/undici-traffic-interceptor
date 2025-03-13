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

describe('TrafficanteInterceptor', async () => {
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
            received.headers['x-request-data'] === `{"url":"localhost:${app.port}/dummy","headers":{"Content-Type":"application/json","User-Agent":"test-user-agent"}}`
            && (() => {
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

    const promises: (() => Promise<void>)[] = []
    for (const header of Object.keys(skippingRequestHeaders)) {
      promises.push(async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method: 'GET',
          headers: { [header]: skippingRequestHeaders[header] }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            received.request?.headers[header] === skippingRequestHeaders[header]
        })
      })
    }

    await Promise.all(promises)
  })

  test('should not pass request data to bloom filter, with concurrency', async (t) => {
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

    const paths = [
      '/api/test/', // trailing slash
      '/api/test?param=value', // query params
      '/api/test/?param=value', // query params with trailing slash
      '/api/test?param1=value1&param2=value2' // multiple query params
    ]

    const promises: (() => Promise<void>)[] = []
    for (const path of paths) {
      promises.push(async () => {
        const response = await request(`${app.host}${path}`, {
          dispatcher: agent,
          method: 'GET',
          headers: { 'x-path': `${path}` }
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), `[${path} response]`)

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            received.request?.headers['x-path'] === `${path}`
        })
      })
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
      'HEAD',
      'OPTIONS',
      'CONNECT',
      'TRACE',
    ]

    const promises: (() => Promise<void>)[] = []
    for (const method of skippingRequestMethods) {
      promises.push(async () => {
        const response = await request(`${app.host}/dummy`, {
          dispatcher: agent,
          method
        })

        assert.equal(response.statusCode, 200)
        assert.equal(await response.body.text(), '[/dummy response]')

        await waitForLogMessage(trafficante.loggerSpy, (received) => {
          return received.msg === 'skip by request' &&
            received.request?.method === method
        })
      })
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
      'session=abc;something=else',
    ]

    const promises: (() => Promise<void>)[] = []
    for (const cookie of skippingCookies) {
      promises.push(async () => {
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
      })
    }

    await Promise.all(promises)
  })

/*
  test('should skip/match based on response properties', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    
    const options = structuredClone(defaultOptions)
    options.interceptResponse = (context) => {
      return context.response.statusCode === 500
    }
    
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...options,
      trafficante: {
        ...options.trafficante,
        url: trafficante.url,
      }
    }))

    // Should match error response and send to trafficante
    try {
      await request(`${app.host}/error`, {
        dispatcher: agent,
        method: 'GET'
      })
    } catch (err) {
      assert.equal(err.statusCode, 500)
    }

    const [bodyLog] = await Promise.all([
      waitForLogMessage(trafficante.loggerSpy, 'received body'),
      waitForLogMessage(trafficante.loggerSpy, 'received meta')
    ])
    assert.ok(bodyLog)

    // Should not match success response and skip
    await request(`${app.host}/dummy`, {
      dispatcher: agent,
      method: 'GET'
    })

    // No additional logs should be received
    await assert.rejects(
      waitForLogMessage(trafficante.loggerSpy, 'received body', 10),
      /Max message count reached/
    )
  })

  test('should skip/match based on response size', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    
    const options = structuredClone(defaultOptions)
    options.maxResponseSize = 100 // Set small size limit for testing
    
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...options,
      trafficante: {
        ...options.trafficante,
        url: trafficante.url,
      }
    }))

    // Should match large response and send to trafficante
    const largeData = 'x'.repeat(200)
    await request(`${app.host}/dummy`, {
      dispatcher: agent,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: largeData
    })

    const [bodyLog] = await Promise.all([
      waitForLogMessage(trafficante.loggerSpy, 'received body'),
      waitForLogMessage(trafficante.loggerSpy, 'received meta')
    ])
    assert.ok(bodyLog)

    // Should not match small response and skip
    const smallData = 'small'
    await request(`${app.host}/dummy`, {
      dispatcher: agent,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: smallData
    })

    // No additional logs should be received
    await assert.rejects(
      waitForLogMessage(trafficante.loggerSpy, 'received body', 10),
      /Max message count reached/
    )
  })
    */
})
