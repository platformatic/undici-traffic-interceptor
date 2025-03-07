import fastify from 'fastify'

export async function createServer({ t }: { t: any }) {
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
        host: `http://localhost:${server.server.address().port}`
    }
}
