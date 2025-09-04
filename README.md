# undici-traffic-interceptor

An [Undici](https://github.com/nodejs/undici) interceptor that allows you to inspect and filter HTTP traffic based on request and response data. It uses a Bloom filter to efficiently track and deduplicate requests. Requests that match the specified criteria are sent to a configured traffic inspector server.

## Features

- Intercept and filter HTTP requests and responses
- Configurable Bloom filter for request deduplication
- Customizable filtering based on:
  - Request methods
  - Request/response headers
  - Cookie session IDs
  - Response status codes
  - Response size limits
- Support for custom labels and metadata
- Built-in logging support

## Installation

```bash
npm install undici-traffic-interceptor
```

## Usage

Here's a basic example of how to use the interceptor:

```typescript
import { Agent, request } from 'undici'
import createTrafficInterceptor from 'undici-traffic-interceptor'

// Create an agent with the interceptor
const agent = new Agent().compose(createTrafficInterceptor({
  labels: {
    applicationId: 'app-1',
    taxonomyId: 'tax-1',
  },
  bloomFilter: {
    size: 1000,
    errorRate: 0.01,
  },
  maxResponseSize: 10 * 1024, // 10KB
  trafficInspectorOptions: {
    url: 'http://traffic-inspector-server.example.com',
    pathSendBody: '/ingest-body',
    pathSendMeta: '/requests'
  }
}))

// Make requests using the agent
const response = await request('https://api.example.com/data', {
  dispatcher: agent,
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
})
```

### Advanced Usage with Custom Filtering

You can customize the filtering behavior by providing your own interceptor functions:

```typescript
const agent = new Agent().compose(createTrafficInterceptor({
  // ... other options ...
  
  // Custom request interceptor
  interceptRequest: (context) => {
    // Skip requests to specific domains
    const url = new URL(context.request.url)
    if (url.hostname.includes('analytics')) {
      return false
    }
    return true
  },

  // Custom response interceptor
  interceptResponse: (context) => {
    // Only intercept JSON responses
    const contentType = context.response.headers['content-type']
    return contentType?.includes('application/json') ?? false
  }
}))
```

## Configuration Options

The interceptor accepts the following configuration options:

```typescript
interface TrafficInterceptorOptions {
  // Optional logger instance (pino compatible)
  logger?: Logger;
  
  // Traffic inspector server configuration
  trafficInspectorOptions: {
    url: string;              // Base URL of the traffic inspector
    pathSendBody: string;     // Path for sending response bodies
    pathSendMeta: string;     // Path for sending metadata
  };
  
  // Bloom filter configuration
  bloomFilter: {
    size: number;             // Size of the filter (default: 100,000)
    errorRate: number;        // Acceptable error rate (default: 0.1)
  };
  
  // Maximum response size to intercept (default: 5MB)
  maxResponseSize: number;
  
  // Custom labels to attach to intercepted traffic
  labels: Record<string, string>;
  
  // Custom interceptor functions
  interceptRequest?: (context: InterceptorContext) => boolean;
  interceptResponse?: (context: InterceptorContext) => boolean;

  // Domains that will be intercepted, must be lowercase
  matchingDomains?: string[];
  
  // Headers that will cause requests/responses to be skipped, must be lowercase
  skippingRequestHeaders?: string[];
  skippingResponseHeaders?: string[];
  
  // Function to determine which response status codes to intercept
  interceptResponseStatusCodes?: (code: number) => boolean;
  
  // Cookie names that will cause requests to be skipped, must be lowercase
  skippingCookieSessionIds?: string[];
}
```

#### matchingDomains

Domains that will be intercepted, extracted from the request origin, must be lowercase, starting with a dot.
The matching origin is extracted from the request `Origin` header if present, or from the request url; protocol and port are ignored.
Default is empty, which means all domains will be intercepted.

Examples:

```typescript
const agent = new Agent().compose(createTrafficInterceptor({
  // ...
  matchingDomains: ['.sub.local', '.plt.local']
}))

// Matching domains
request('https://plt.local/api', { dispatcher: agent })
request('https://sub.local/products', { dispatcher: agent })
request('https://sub.local:3001/products', { dispatcher: agent })
request('https://localhost:3000/users', { headers: { Origin: 'https://plt.local' }, dispatcher: agent })

// Not matching domains
request('https://example.com/', { dispatcher: agent })
request('https://local:3001/', { dispatcher: agent })
request('https://plt.local/api', { headers: { Origin: 'https://platformatic.dev' }, dispatcher: agent })

```

### Traffic Interception Configurations

Traffic Interceptor is an HTTP server that receives intercepted requests and responses. You need to provide its URL and the paths for sending request metadata and response bodies.

Traffic Inspector should expose two endpoints:
1. `POST /requests/hash` - Receives request metadata and response hashes.
2. `POST /requests/body` - Receives the actual response body along with metadata.

Example of the Traffic Inspector server:

```typescript
import fastify from 'fastify'

const server = fastify()

server.post('/requests/hash', {
  schema: {
    headers: {
      type: 'object',
      properties: {
        'x-labels': { type: 'string' }
      },
      required: ['x-labels']
    },
    body: {
      type: 'object',
      properties: {
        timestamp: { type: 'number' },
        request: {
          type: 'object',
          properties: {
            url: { type: 'string' }
          },
          required: ['url']
        },
        response: {
          type: 'object',
          properties: {
            bodySize: { type: 'number' },
            bodyHash: { type: 'string' }
          },
          required: ['bodySize', 'bodyHash']
        }
      },
      required: ['timestamp', 'request', 'response']
    }
  },
  handler: async (req) => {
    // Analyze the request body and headers
  }
})

server.post('/requests/body', {
  schema: {
    headers: {
      type: 'object',
      properties: {
        'x-labels': { type: 'string' },
        'x-request-data': { type: 'string' },
        'x-response-data': { type: 'string' }
      },
      required: ['x-trafficante-labels', 'x-request-data', 'x-response-data']
    }
  },
  handler: async (req) => {
    // Analyze the request and response metadata
    // The body contains the actual response body
  }
})

server.listen({ port: 3000, host: '0.0.0.0' })
```

### Default Skip Conditions

By default, the interceptor will skip:

#### Requests with:
- Methods other than GET
- Headers: cache-control, pragma, if-none-match, if-modified-since, authorization, proxy-authorization
- Cookies containing common session IDs (jsessionid, phpsessid, connect.sid, etc.)

#### Responses with:
- Status codes outside 200-299
- Headers: etag, last-modified, expires, cache-control
- Size exceeding maxResponseSize
- Set-Cookie headers containing session IDs

## API Reference

### createTrafficInterceptor(options: TrafficInterceptorOptions)

Creates a new Undici interceptor with the specified options. Returns a function that can be used with Undici's `compose()` method.

## Caveats

- Response size filtering is based on the `content-length` header. If this header is missing from the response, the response will be accepted regardless of its actual size.
- URLs with and without trailing slashes are treated as different requests. For example, `/products` and `/products/` will be considered two separate requests in the Bloom filter.
