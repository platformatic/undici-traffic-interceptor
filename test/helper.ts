import fastify from 'fastify'

import type { TestContext } from 'node:test'

export async function createApp({ t }: { t: TestContext }) {
    const server = fastify()

    server.get('/', (req, res) => {
        res.send('index')
    })

    t.after(() => {
        server.close()
    })

    await server.listen({ port: 0, host: '127.0.0.1' })

    return {
        server,
        host: `http://localhost:${(server.server.address() as import('net').AddressInfo).port}`
    }
}

export async function createTrafficante({ t }: { t: TestContext }) {
    const server = fastify()

    server.post('/ingest', (req, res) => {
        console.log(' *** ingest ***')
        console.log('req.body', req.body)
        console.log(' *** ')
        res.send('ok')
    })

    t.after(() => {
        server.close()
    })

    await server.listen({ port: 0, host: '127.0.0.1' })

    return {
        server,
        host: `http://localhost:${(server.server.address() as import('net').AddressInfo).port}`
    }
}
