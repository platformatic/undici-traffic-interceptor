import fastify from 'fastify'
import { cases } from './cases.ts'

export async function createTargetApp (port = 3000) {
  const server = fastify()

  // Keep track of response indexes for each path
  const responseIndexes = new Map<string, number>()

  // Register each call pattern
  for (const c of cases) {
    server.route({
      method: c.request.method,
      url: c.request.path,
      handler: async (request, reply) => {
        // Get next response in sequence
        const key = `${c.request.method}:${c.request.path}`
        const currentIndex = responseIndexes.get(key) || 0
        const response = c.responses[currentIndex]

        // Update index for next request
        responseIndexes.set(key, (currentIndex + 1) % c.responses.length)

        // Set response code
        reply.status(response.code)

        // Set headers
        for (const [key, value] of Object.entries(response.headers)) {
          reply.header(key, value)
        }

        // Return response body
        return response.body
      }
    })
  }

  await server.listen({ port, host: '0.0.0.0' })
  console.log(`Target app listening at http://localhost:${port}`)

  return {
    server,
    async close () {
      console.log('targetApp closing ***')
      await server.close()
    }
  }
}

