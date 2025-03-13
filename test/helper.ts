import type { TestContext } from 'node:test'
import type Stream from 'stream'

import fastify from 'fastify'
import pinoTest from 'pino-test'
import pino from 'pino'
import EventEmitter from 'events'

export async function createApp ({ t }: { t: TestContext }) {
  const server = fastify()

  server.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    url: '/*',
    handler: (req, res) => {
      for (const [key, value] of Object.entries(req.headers)) {
        res.header(`x-request-headers-${key}`, value)
      }

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

export async function createTrafficante ({ t, pathSendBody = '/ingest-body', pathSendMeta = '/ingest-meta' }: { t: TestContext, pathSendBody?: string, pathSendMeta?: string }) {
  const loggerStream = pinoTest.sink()
  const logger = pino({ level: 'debug' }, loggerStream)
  const loggerSpy = listenLogger(loggerStream, t)

  const server = fastify({ loggerInstance: logger })

  server.post(pathSendBody, (req, res) => {
    logger.info({
      body: req.body,
      headers: req.headers
    }, 'received body')
    res.send('OK')
  })

  server.get(pathSendMeta, (req, res) => {
    logger.info({
      headers: req.headers
    }, 'received meta')
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

export function listenLogger (loggerStream: Stream.Transform, t: TestContext) {
  const spy = {
    buffer: [] as any[],
    events: new EventEmitter(),
    reset: () => {
      spy.buffer.length = 0
    }
  }
  const fn = (received: any) => {
    spy.buffer.push(received)
    spy.events.emit('data', received)
  }

  loggerStream.on('data', fn)

  t.after(() => {
    loggerStream.off('data', fn)
  })

  return spy
}

export function waitForLogMessage (spy: { buffer: any[], events: EventEmitter }, match: (received: any) => boolean, max = 100): Promise<void> {
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

    spy.events.on('data', fn)
  })
}
