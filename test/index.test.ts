import { test, describe } from 'node:test'
// import assert from 'node:assert/strict'
import { request, Agent } from 'undici'

import { createTrafficanteInterceptor, type TrafficanteOptions } from '../src/index.ts'

import { createApp, createTrafficante } from './helper.ts'

const defaultOptions: TrafficanteOptions = {
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

  test('should intercept request/response and extract data', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor({
      ...structuredClone(defaultOptions),
      trafficante: {
        ...defaultOptions.trafficante,
        url: trafficante.url,
      }
    }))

    const response = await request(`${app.host}/?var1=a&var2=b&A=B&`, {
      dispatcher: agent,
      method: 'GET',
      headers: {
        // 'cache-control': 'no-cache',
        // 'authorization': 'Bearer 1234567890',
        // 'cookie': 'sessionId=1234567890'
        'Content-Type': 'application/json',
        'User-Agent': 'test'
      }
    })

    // TODO
    // assert: response from app is correct
    // data received by trafficante is correct

    // console.log(' *** response ***')
    // console.log('statusCode', response.statusCode);
    // console.log('headers', response.headers);
    // console.log('body', await response.body.text());
    // console.log(' *** ')
  })

  // match/skip request
  // - by bloom filter
  // - by headers
  // - by cookies
  // match/skip response
  // - by response code
  // - by headers
  // - by cookies
  // - by response size

  // extract data from request, by url/path
})
