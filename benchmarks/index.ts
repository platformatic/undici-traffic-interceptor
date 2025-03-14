import { Agent, request, Dispatcher } from 'undici'
import { createTrafficanteInterceptor, type TrafficanteOptions } from '../src/index.ts'
import { createTargetApp } from './target-app.ts'
import { createTrafficanteApp } from './trafficante-app.ts'
import { calls } from './calls.ts'
import pino from 'pino'

const TARGET_PORT = 3000
const TRAFFICANTE_PORT = 3001
const TOTAL_REQUESTS = 100
const CONCURRENT_REQUESTS = 100

interface RequestMetrics {
  method: string
  path: string
  statusCode: number
  responseTime: number
}

interface BenchmarkStats {
  requestCount: number
  successCount: number
  errorCount: number
  responseTime: {
    min: string
    max: string
    avg: string
  }
  byMethod: Array<{
    method: string
    count: number
    avgTime: string
  }>
}

function calculateStats(metrics: RequestMetrics[]): BenchmarkStats {
  const times = metrics.map(m => m.responseTime)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const avg = times.reduce((a, b) => a + b, 0) / times.length

  const successCount = metrics.filter(m => m.statusCode < 400).length
  const errorCount = metrics.filter(m => m.statusCode >= 400).length

  return {
    requestCount: metrics.length,
    successCount,
    errorCount,
    responseTime: {
      min: min.toFixed(2),
      max: max.toFixed(2),
      avg: avg.toFixed(2)
    },
    byMethod: Array.from(new Set(metrics.map(m => m.method))).map(method => ({
      method,
      count: metrics.filter(m => m.method === method).length,
      avgTime: (metrics
        .filter(m => m.method === method)
        .reduce((a, b) => a + b.responseTime, 0) /
        metrics.filter(m => m.method === method).length
      ).toFixed(2)
    }))
  }
}

function calculatePercentageDiff(newValue: number, baseValue: number): string {
  const diff = ((newValue - baseValue) / baseValue) * 100
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`
}

function compareStats(withInterceptor: BenchmarkStats, withoutInterceptor: BenchmarkStats) {
  const percentageDiff = {
    responseTime: {
      min: calculatePercentageDiff(
        parseFloat(withInterceptor.responseTime.min),
        parseFloat(withoutInterceptor.responseTime.min)
      ),
      max: calculatePercentageDiff(
        parseFloat(withInterceptor.responseTime.max),
        parseFloat(withoutInterceptor.responseTime.max)
      ),
      avg: calculatePercentageDiff(
        parseFloat(withInterceptor.responseTime.avg),
        parseFloat(withoutInterceptor.responseTime.avg)
      )
    },
    byMethod: withInterceptor.byMethod.map(methodStats => {
      const baseMethodStats = withoutInterceptor.byMethod.find(m => m.method === methodStats.method)
      return {
        method: methodStats.method,
        avgTimeDiff: baseMethodStats
          ? calculatePercentageDiff(
            parseFloat(methodStats.avgTime),
            parseFloat(baseMethodStats.avgTime)
          )
          : 'N/A'
      }
    })
  }

  return {
    withInterceptor,
    withoutInterceptor,
    percentageDifference: percentageDiff
  }
}

async function makeRequests(agent: Dispatcher, label: string): Promise<BenchmarkStats> {
  console.log(`\nRunning benchmark: ${label}`)
  const metrics: RequestMetrics[] = []
  let callIndex = 0

  for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENT_REQUESTS) {
    const tasks = []
    for (let j = 0; j < CONCURRENT_REQUESTS; j++) {
      const call = calls[callIndex % calls.length]
      callIndex++

      tasks.push((async () => {
        const startTime = process.hrtime()

        try {
          const response = await request(`http://localhost:${TARGET_PORT}${call.request.path}`, {
            dispatcher: agent,
            method: call.request.method,
            headers: call.request.headers
          })

          const [seconds, nanoseconds] = process.hrtime(startTime)
          const responseTime = seconds * 1000 + nanoseconds / 1000000 // Convert to milliseconds

          metrics.push({
            method: call.request.method,
            path: call.request.path,
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
    console.log(`${i} out of ${TOTAL_REQUESTS}`)
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
  const withoutInterceptorStats = await makeRequests(baseAgent, 'Without Interceptor')
  const withInterceptorStats = await makeRequests(interceptorAgent, 'With Interceptor')

  // Compare and display results
  console.log('\nBenchmark Comparison:')
  console.log('====================')
  const comparison = compareStats(withInterceptorStats, withoutInterceptorStats)
  console.log(JSON.stringify(comparison, null, 2))

  await new Promise(resolve => setTimeout(resolve, 3_000))

  // Get collected requests data
  console.log('\nCollected Requests:')
  console.log('==================')
  const collectedResponse = await request(`${trafficante.url}/collected`)
  const collected = await collectedResponse.body.json()
  console.log(JSON.stringify(collected, null, 2))

  // Cleanup
  await targetApp.close()
  await trafficante.server.close()
  await baseAgent.close()
  await interceptorAgent.close()
}

// Run benchmark
console.log('Starting benchmark...')
runBenchmark().catch(console.error)
