import type { TestContext } from 'node:test'
import type Stream from 'stream'
import { setTimeout as wait } from 'node:timers/promises'
import fastify from 'fastify'
import pinoTest from 'pino-test'
import pino from 'pino'

export async function createApp ({ t }: { t: TestContext }) {
  const server = fastify()

  server.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    url: '/*',
    handler: async (req, res) => {
      for (const [key, value] of Object.entries(req.headers)) {
        res.header(`x-request-headers-${key}`, value)
      }

      // @ts-ignore-next
      if (req.query?.delay) { await wait(Number(req.query.delay)) }
      // @ts-ignore-next
      if (req.query?.responseHeader) { res.header(req.query.responseHeader, req.query.responseHeaderValue) }
      // @ts-ignore-next
      if (req.query?.responseCode) { res.status(Number(req.query.responseCode)) }
      // @ts-ignore-next
      if (req.query?.responseBody) {
        // @ts-ignore-next
        res.send(req.query.responseBody)
        return
      }

      res.send(`[${req.url} response]`)
    }
  })

  t.after(() => {
    server.close()
  })

  await server.listen({ port: 0, host: '0.0.0.0' })
  const port = (server.server.address() as import('net').AddressInfo).port

  return {
    server,
    host: `http://localhost:${port}`,
    port
  }
}

export async function createTrafficante ({
  t,
  pathSendBody = '/ingest-body', pathSendMeta = '/requests', errorMeta = false, errorBody = false
}: { t: TestContext, pathSendBody?: string, pathSendMeta?: string, errorMeta?: boolean, errorBody?: boolean }) {
  const loggerStream = pinoTest.sink()
  const logger = pino({ level: 'debug' }, loggerStream)
  const loggerSpy = listenLogger(loggerStream, t)

  const server = fastify({ loggerInstance: logger })

  server.post(pathSendBody, (req, res) => {
    if (errorBody) {
      res.status(500).send('Internal Server Error')
      return
    }

    logger.info({
      body: req.body,
      headers: req.headers
    }, 'trafficante received body')
    res.send('OK')
  })

  server.post(pathSendMeta, (req, res) => {
    if (errorMeta) {
      res.status(500).send('Internal Server Error')
      return
    }

    logger.info({
      headers: req.headers,
      body: req.body
    }, 'trafficante received meta')
    res.send('OK')
  })

  t.after(() => {
    server.close()
  })

  await server.listen({ port: 0, host: '0.0.0.0' })
  const host = `http://localhost:${(server.server.address() as import('net').AddressInfo).port}`

  return {
    server,
    host,
    url: host,
    loggerSpy,
    logger
  }
}

type Spy = {
  buffer: any[],
  onMessage: (cb: (received: any) => void) => void,
  reset: () => void,
  _onMessage: (received: any) => void
}
export function listenLogger (loggerStream: Stream.Transform, t: TestContext) {
  const spy: Spy = {
    buffer: [] as any[],
    onMessage: (cb: (received: any) => void) => {
      spy._onMessage = cb
    },
    reset: () => {
      spy.buffer.length = 0
    },
    _onMessage: (received: any) => { }
  }

  const fn = (received: any) => {
    spy.buffer.push(received)
    spy._onMessage(received)
  }

  loggerStream.on('data', fn)

  t.after(() => {
    loggerStream.off('data', fn)
  })

  return spy
}

export function waitForLogMessage (spy: Spy, match: (received: any) => boolean, max = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const fn = (received: any) => {
      if (match(received)) {
        resolve()
      }
      count++
      if (count > max) {
        reject(new Error('Max message count reached on waitForLogMessage'))
      }
    }

    let count = 0
    for (const received of spy.buffer) {
      fn(received)
    }

    spy.onMessage(fn)
  })
}
