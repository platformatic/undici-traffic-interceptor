import fastify from 'fastify'

export async function createTrafficInspector (port = 3001) {
  const server = fastify()

  const collect = {
    body: 0,
    meta: 0
  }

  server.post('/ingest-body', (req, reply) => {
    collect.body++

    reply.send('OK')
  })

  server.post('/requests', (req, reply) => {
    collect.meta++

    reply.send('OK')
  })

  // Endpoint to get collected requests
  server.get('/collected', (req, reply) => {
    reply.send(collect)
  })

  await server.listen({ port, host: '0.0.0.0' })
  console.log(`Traffic inspector listening at http://localhost:${port}`)

  process.on('exit', async () => {
    // Get collected requests data
    console.log('\nCollected Requests:')
    console.log('==================')
    console.log(JSON.stringify(collect, null, 2))
  })

  return {
    server,
    url: `http://localhost:${port}`,
    async close () {
      await server.close()
    },
  }
}
