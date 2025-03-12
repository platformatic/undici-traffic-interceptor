import type { TestContext } from 'node:test'
import type Stream from 'stream'

import fastify from 'fastify'
import pinoTest from 'pino-test'
import pino from 'pino'


export async function createApp({ t }: { t: TestContext }) {
    const server = fastify()

    server.get('/dummy', (req, res) => {
        for (const [key, value] of Object.entries(req.headers)) {
            res.header(`x-request-headers-${key}`, value)
        }
        res.send('[dummy response]')
    })

    server.get('/error', (req, res) => {
        res.status(500).send('Internal Server Error')
    })

    t.after(() => {
        server.close()
    })

    await server.listen({ port: 0, host: '0.0.0.0' })

    return {
        server,
        host: `http://localhost:${(server.server.address() as import('net').AddressInfo).port}`
    }
}

export async function createTrafficante({ t, pathSendBody = '/ingest-body', pathSendMeta = '/ingest-meta' }: { t: TestContext, pathSendBody?: string, pathSendMeta?: string }) {
    const loggerSpy = pinoTest.sink()
    const logger = pino(loggerSpy)

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

export function waitForLogMessage(loggerSpy: Stream.Transform, message: string, max = 100): Promise<void> {
    return new Promise((resolve, reject) => {
        let count = 0
        const fn = (received: any) => {
            console.log('received', received)
            if (received.msg === message) {
                loggerSpy.off('data', fn)
                resolve()
            }
            count++
            if (count > max) {
                loggerSpy.off('data', fn)
                reject(new Error(`Max message count reached on waitForLogMessage: ${message}`))
            }
        }
        
        loggerSpy.on('data', fn)
    })
}
