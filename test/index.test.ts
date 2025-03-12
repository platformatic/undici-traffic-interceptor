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
      }
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
    assert.equal(await response.body.text(), '[dummy response]')
    assert.equal(response.headers['x-request-headers-user-agent'], 'test-user-agent')
    assert.equal(response.headers['x-request-headers-content-type'], 'application/json')

    await Promise.all([
      waitForLogMessage(trafficante.loggerSpy, 'received body'),
      waitForLogMessage(trafficante.loggerSpy, 'received meta')
    ])
  })

  // on server error
  // change response body on calls

  // 'cache-control': 'no-cache',
  // 'authorization': 'Bearer 1234567890',
  // 'cookie': 'sessionId=1234567890'

  // url, different domains, ignore qs, trailing slash in path
  // match/skip request
  // - by bloom filter
  // - by headers
  // - by cookies
  // match/skip response
  // - by response code
  // - by headers
  // - by cookies
  // - by response size

  // abort
})
