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
}

describe('TrafficanteInterceptor', async () => {

  test('should intercept request/response and extract data', async (t) => {
    const app = await createApp({ t })
    const trafficante = await createTrafficante({ t, path: '/ingest' })
    const agent = new Agent().compose(createTrafficanteInterceptor({ ...structuredClone(defaultOptions), trafficante: {
      url: trafficante.url
    } }))

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

    // await response.body.text()

    console.log(' *** response ***')
    console.log('statusCode', response.statusCode);
    console.log('headers', response.headers);
    console.log('body', await response.body.text());
    console.log(' *** ')
  })

  // test('should send to trafficante endpoint matching request', async (t) => {

  // })

  // test('should not send to trafficante endpoint non matching request', async (t) => {

  // })
})
