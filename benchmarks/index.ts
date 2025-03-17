import path from 'node:path'
import url from 'node:url'
import fs from 'node:fs/promises'
import { Agent, request, Dispatcher } from 'undici'
import { createTrafficanteInterceptor } from '../src/index.ts'
import { createTargetApp } from './target-app.ts'
import { createTrafficanteApp } from './trafficante-app.ts'
import { cases } from './cases.ts'
import { pino } from 'pino'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const TARGET_PORT = 3000
const TRAFFICANTE_PORT = 3001
const REQ_PER_CASE = process.env.REQ_PER_CASE ? parseInt(process.env.REQ_PER_CASE) : 1_000
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 1 // TODO!

interface RequestMetrics {
  method: string
  statusCode: number
  responseTime: number
}

interface BenchmarkStats {
  requestCount: number
  responseTime: {
    min: string
    max: string
    avg: string
  }
}

function calculateStats(metrics: Record<string, RequestMetrics[]>): Record<string, BenchmarkStats> {
  const result: Record<string, BenchmarkStats> = {}
  for (const label in metrics) {
    const times = metrics[label].map(m => m.responseTime)
    const min = Math.min(...times)
    const max = Math.max(...times)
    const avg = times.reduce((a, b) => a + b, 0) / times.length

    result[label] = {
      requestCount: metrics[label].length,
      responseTime: {
        min: min.toFixed(2),
        max: max.toFixed(2),
        avg: avg.toFixed(2)
      }
    }
  }

  result.total = {
    requestCount: Object.values(result).reduce((a, b) => a + b.requestCount, 0),
    responseTime: {
      min: Math.min(...Object.values(result).map(r => parseFloat(r.responseTime.min))),
      max: Math.max(...Object.values(result).map(r => parseFloat(r.responseTime.max))),
      avg: Object.values(result).reduce((a, b) => a + parseFloat(b.responseTime.avg), 0) / Object.values(result).length
    }
  }

  return result
}

function calculatePercentageDiff(newValue: number, baseValue: number): string {
  const diff = ((newValue - baseValue) / baseValue) * 100
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`
}

function compareStats(labels: string[], a: Record<string, BenchmarkStats>, labelA: string, b: Record<string, BenchmarkStats>, labelB: string) {   
  const result = {}
  for (const label of labels) {
    result[label] = {
      [labelA]: a[label],
      [labelB]: b[label],
      [`diff ${labelA} - ${labelB}`]: {
        min: calculatePercentageDiff(
          parseFloat(a[label].responseTime.min),
          parseFloat(b[label].responseTime.min)
        ),
        max: calculatePercentageDiff(
          parseFloat(a[label].responseTime.max),
          parseFloat(b[label].responseTime.max)
        ),
        avg: calculatePercentageDiff(
          parseFloat(a[label].responseTime.avg),
          parseFloat(b[label].responseTime.avg)
        )
      }
    }
  }

  return result
}

async function makeRequests(agent: Dispatcher, label: string): Promise<Record<string, BenchmarkStats>> {
  console.log(`\nRunning benchmark: ${label}`)
  const metrics: Record<string, RequestMetrics[]> = {}

  for (const c of cases) {
    console.log(`\n\n\n ******************* \nRunning case: ${c.label}`)
    metrics[c.label] = []
    for (let i = 0; i < REQ_PER_CASE; i += CONCURRENCY) {
      const tasks = []
      for (let j = 0; j < CONCURRENCY; j++) {
        tasks.push((async () => {
          const startTime = process.hrtime()

          try {
            const response = await request(`http://localhost:${TARGET_PORT}${c.request.path}`, {
              dispatcher: agent,
              method: c.request.method,
              headers: c.request.headers
            })

            const [seconds, nanoseconds] = process.hrtime(startTime)
            const responseTime = seconds * 1000 + nanoseconds / 1000000 // Convert to milliseconds

            metrics[c.label].push({
              method: c.request.method,
              statusCode: response.statusCode,
              responseTime
            })

            // console.log(`[${call.request.method}] ${call.request.path} - Status: ${response.statusCode} - Time: ${responseTime.toFixed(2)}ms`)
          } catch (error) {
            if (error instanceof Error) {
              console.error(`Error making request: ${error.message}`)
            } else {
              console.error('Unknown error making request')
            }
          }
        })())
      }
      await Promise.all(tasks)
      console.log(`${i} out of ${REQ_PER_CASE}`)
    }
  }

  return calculateStats(metrics)
}

async function runBenchmark() {
  console.log('Starting target and trafficante apps...')
  const targetApp = await createTargetApp(TARGET_PORT)
  const trafficante = await createTrafficanteApp(TRAFFICANTE_PORT)
  console.log('Apps started successfully')

  // Create agents
  const baseAgent = new Agent()
  const interceptorAgent = new Agent().compose(createTrafficanteInterceptor({
    labels: {
      applicationId: 'benchmark-app',
      taxonomyId: 'benchmark-tax',
    },
    bloomFilter: {
      size: 1000,
      errorRate: 0.01,
    },
    maxResponseSize: 1024 * 1024, // 1MB
    trafficante: {
      url: trafficante.url,
      pathSendBody: '/ingest-body',
      pathSendMeta: '/requests'
    },
    logger: pino({ level: 'debug' })
  }))

  // Run benchmarks
  const noInterceptorStats = await makeRequests(baseAgent, 'No Interceptor')
  const withInterceptorStats = await makeRequests(interceptorAgent, 'With Interceptor')

  // Compare and display results
  console.log('\nBenchmark Comparison:')
  console.log('====================')
  const comparison = compareStats(Object.keys(withInterceptorStats), withInterceptorStats, 'With Interceptor', noInterceptorStats, 'No Interceptor')
  console.log(JSON.stringify(comparison, null, 2))

  await fs.mkdir(path.join(__dirname,  '/result'), { recursive: true })
  await fs.writeFile(path.join(__dirname,  '/result', 'data.json'), JSON.stringify(comparison, null, 2))
  console.log('\nBenchmark results written')

  // Get collected requests data
  console.log('\nCollected Requests:')
  console.log('==================')
  const collectedResponse = await request(`${trafficante.url}/collected`)
  const collected = await collectedResponse.body.json()
  console.log(JSON.stringify(collected, null, 2))

  // Graceful shutdown on trafficante? app?
  await new Promise(resolve => setTimeout(resolve, 3_000))

  // Cleanup with graceful termination
  await targetApp.close()
  await trafficante.close()
  await baseAgent.close()
  await interceptorAgent.close()
}

// Run benchmark
console.log('Starting benchmark...')
runBenchmark().catch(console.error)
