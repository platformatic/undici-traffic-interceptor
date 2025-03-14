import fastify from 'fastify'

export async function createTrafficanteApp(port = 3001) {
  const server = fastify()

  const collect = {
    body: 0,
    meta: 0
  }

  server.post('/ingest-body', (req, reply) => {
    collect.body ++

    reply.send('OK')
  })

  server.post('/requests', (req, reply) => {
    collect.meta ++

    // console.log('req.body')
    // console.log(req.body)

    // console.log('collect.meta')
    // console.log(collect.meta)

    reply.send('OK')
  })

  // Endpoint to get collected requests
  server.get('/collected', (req, reply) => {
    reply.send(collect)
  })

  await server.listen({ port, host: '0.0.0.0' })
  console.log(`Trafficante app listening at http://localhost:${port}`)

  return {
    server,
    url: `http://localhost:${port}`
  }
}
