# undici-trafficante-interceptor

An [Undici](https://github.com/nodejs/undici) interceptor that allows you to inspect and filter HTTP traffic based on request and response data. It uses a Bloom filter to efficiently track and deduplicate requests.

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
npm install TODO
```

## Usage

Here's a basic example of how to use the interceptor:

```typescript
import { Agent, request } from 'undici'
import { createTrafficanteInterceptor } from 'undici-trafficante-interceptor'

// Create an agent with the interceptor
const agent = new Agent().compose(createTrafficanteInterceptor({
  labels: {
    applicationId: 'app-1',
    taxonomyId: 'tax-1',
  },
  bloomFilter: {
    size: 1000,
    errorRate: 0.01,
  },
  maxResponseSize: 10 * 1024, // 10KB
  trafficante: {
    url: 'http://trafficante-server.example.com',
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
const agent = new Agent().compose(createTrafficanteInterceptor({
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
interface TrafficanteOptions {
  // Optional logger instance (pino compatible)
  logger?: Logger;
  
  // Trafficante server configuration
  trafficante: {
    url: string;              // Base URL of the trafficante server
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
  
  // Headers that will cause requests/responses to be skipped, must be lowercase
  skippingRequestHeaders?: string[];
  skippingResponseHeaders?: string[];
  
  // Function to determine which response status codes to intercept
  interceptResponseStatusCodes?: (code: number) => boolean;
  
  // Cookie names that will cause requests to be skipped, must be lowercase
  skippingCookieSessionIds?: string[];
}
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

### createTrafficanteInterceptor(options: TrafficanteOptions)

Creates a new Undici interceptor with the specified options. Returns a function that can be used with Undici's `compose()` method.

## Caveats

- Response size filtering is based on the `content-length` header. If this header is missing from the response, the response will be accepted regardless of its actual size.
- URLs with and without trailing slashes are treated as different requests. For example, `/products` and `/products/` will be considered two separate requests in the Bloom filter.
