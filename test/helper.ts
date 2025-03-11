import fastify from 'fastify'

import type { TestContext } from 'node:test'

export async function createApp({ t }: { t: TestContext }) {
    const server = fastify()

    server.get('/', (req, res) => {
        res.send('[index response]')
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
    const server = fastify({ logger: true })

    server.post(pathSendBody, (req, res) => {
        console.log(' *** ingest ***')
        console.log('req.body', req.body)
        console.log('req.headers', req.headers)
        console.log(' *** ')
        res.send({ ok: true })
    })

    server.post(pathSendMeta, (req, res) => {
        console.log(' *** ingest meta ***')
        console.log('req.body', req.body)
        console.log('req.headers', req.headers)
        console.log(' *** ')
        res.send({ ok: true })
    })

    t.after(() => {
        server.close()
    })

    await server.listen({ port: 0, host: '0.0.0.0' })
    const host = `http://localhost:${(server.server.address() as import('net').AddressInfo).port}`

    return {
        server,
        host,
        url: host
    }
}
