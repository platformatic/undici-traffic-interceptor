import fastify from 'fastify'

import { TestContext } from 'node:test'

export async function createServer({ t }: { t: TestContext }) {
    const server = fastify()

    server.get('/', (req, res) => {
        res.send('Hello World')
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
