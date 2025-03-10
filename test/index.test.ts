import { test, describe } from 'node:test'
// import assert from 'node:assert/strict'
import { request, Agent } from 'undici'

import { createTrafficanteInterceptor } from '../src/index.ts'

import { createServer } from './helper.ts'

describe('TrafficanteInterceptor', async () => {

  test('should intercept request/response and extract data', async (t) => {
    const options = {}
    const app = await createServer({ t })
    const trafficante = await createServer({ t })
    const agent = new Agent().compose(createTrafficanteInterceptor(options))

    const response = await request(`${app.host}/`, {
      dispatcher: agent,
      method: 'GET',
    })

    console.log(' *** response ***')
    console.log('statusCode', response.statusCode);
    console.log('headers', response.headers);
    console.log('body', await response.body.text());
    console.log(' *** ')
  })

  test('should send to trafficante endpoint matching request', async (t) => {

  })

  test('should not send to trafficante endpoint non matching request', async (t) => {

  })
})
