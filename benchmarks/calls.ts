import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

interface Request {
  method: string
  path: string
  headers: Record<string, string>
}

interface Response {
  code: number
  headers: Record<string, string>
  body: unknown
}

interface Call {
  request: Request
  responses: Response[]
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load large response files
const productCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'responses/large-product-catalog.json'), 'utf-8'))
const userData = JSON.parse(fs.readFileSync(path.join(__dirname, 'responses/large-user-data.json'), 'utf-8'))

// Load image files
const smallImage = fs.readFileSync(path.join(__dirname, 'responses/images/small.jpg'))
const mediumImage = fs.readFileSync(path.join(__dirname, 'responses/images/medium.jpg'))
const largeImage = fs.readFileSync(path.join(__dirname, 'responses/images/large.jpg'))

// Common headers
const IMAGE_HEADERS = {
  jpeg: { 'Content-Type': 'image/jpeg' },
  png: { 'Content-Type': 'image/png' },
  webp: { 'Content-Type': 'image/webp' }
}

const AUTH_HEADERS = {
  bearer: { 
    // 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' 
  },
  basic: { 
    // 'Authorization': 'Basic dXNlcjpwYXNz' 
  },
  apiKey: { 
    // 'X-API-Key': 'test-key-123' 
  },
  none: {}
}

const CACHE_HEADERS = {
  etag: { 
    // 'ETag': 'W/"123-abc"' 
  },
  lastModified: { 
    // 'Last-Modified': 'Wed, 14 Mar 2024 15:00:00 GMT' 
  },
  noCache: { 
    // 'Cache-Control': 'no-cache, no-store, must-revalidate' 
  },
  public: { 
    // 'Cache-Control': 'public, max-age=3600' 
  },
  private: { 
    // 'Cache-Control': 'private, max-age=1800' 
  },
  none: {}
}

const COOKIE_HEADERS = {
  session: { 
    // 'Set-Cookie': 'sessionId=abc123; Path=/; HttpOnly; Secure' 
  },
  jwt: { 
    // 'Set-Cookie': 'jwt=eyJhbGciOiJIUzI1NiJ9...; Path=/; HttpOnly; Secure' 
  },
  auth: { 
    // 'Set-Cookie': 'authToken=xyz789; Path=/; HttpOnly; Secure' 
  },
  noToken: { 
    // 'Set-Cookie': 'noToken=noToken; Path=/; HttpOnly; Secure' 
  },
  none: {}
}

// Generate calls
export const calls: Call[] = [
  /*
  // GET /api/users/:id - Various auth + cache combinations
  {
    request: {
      method: 'GET',
      path: '/api/product/123',
      headers: {
        'Accept': 'application/json'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      },
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      },
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      },
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      },
      // {
      //   code: 404,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'User not found' }
      // }
    ]
  },
  // GET /api/users/:id - Various auth + cache combinations
  {
    request: {
      method: 'GET',
      path: '/api/users/123',
      headers: {
        'Accept': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.etag,
          ...CACHE_HEADERS.public
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      },
      // {
      //   code: 404,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'User not found' }
      // }
    ]
  },
  {
    request: {
      method: 'GET',
      path: '/api/users/456',
      headers: {
        'Accept': 'application/json',
        ...AUTH_HEADERS.apiKey
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.lastModified,
          ...CACHE_HEADERS.private
        },
        body: { id: 456, name: 'Jane Smith', email: 'jane@example.com' }
      }
    ]
  },

  // POST /api/users - Auth + no cache
  {
    request: {
      method: 'GET', // POST
      path: '/api/users/post',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 201,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.noCache,
          ...COOKIE_HEADERS.session
        },
        body: { id: 789, status: 'created' }
      },
      // {
      //   code: 400,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Invalid input' }
      // }
    ]
  },

  // GET /api/products - Large response
  {
    request: {
      method: 'GET',
      path: '/api/products',
      headers: {
        'Accept': 'application/json'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: productCatalog
      }
    ]
  },

  // GET /api/users - Large response + auth
  {
    request: {
      method: 'GET',
      path: '/api/users',
      headers: {
        'Accept': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.private
        },
        body: userData
      }
    ]
  },

  /*
  // PUT /api/users/:id - Auth + cookies
  {
    request: {
      method: 'PUT',
      path: '/api/users/123',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.noCache,
          ...COOKIE_HEADERS.jwt
        },
        body: { id: 123, status: 'updated' }
      },
      // {
      //   code: 403,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Forbidden' }
      // }
    ]
  },
  */

  /*
  // DELETE /api/users/:id - Auth only
  {
    request: {
      method: 'DELETE',
      path: '/api/users/123',
      headers: {
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 204,
        headers: {
          ...CACHE_HEADERS.noCache
        },
        body: null
      },
      // {
      //   code: 404,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Not found' }
      // }
    ]
  },

  // GET /api/products/:id - Cache + cookies
  {
    request: {
      method: 'GET',
      path: '/api/products/123',
      headers: {
        'Accept': 'application/json'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.etag,
          ...CACHE_HEADERS.public,
          ...COOKIE_HEADERS.session
        },
        body: {
          id: 123,
          name: 'Product 123',
          description: 'Product description',
          price: 99.99
        }
      }
    ]
  },

  // POST /api/orders - Auth + cookies + no cache
  {
    request: {
      method: 'GET', // POST
      path: '/api/orders/post',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 201,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.noCache,
          ...COOKIE_HEADERS.session
        },
        body: { id: 'order-123', status: 'created' }
      },
      // {
      //   code: 400,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Invalid order' }
      // }
    ]
  },

  // GET /api/orders/:id - Auth + cache + cookies
  {
    request: {
      method: 'GET',
      path: '/api/orders/123',
      headers: {
        'Accept': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.private,
          ...COOKIE_HEADERS.session
        },
        body: {
          id: 'order-123',
          items: [
            { id: 'item-1', quantity: 2, price: 99.99 }
          ],
          total: 199.98
        }
      }
    ]
  },

  // PUT /api/orders/:id - Auth + no cache
  {
    request: {
      method: 'GET', // PUT
      path: '/api/orders/1234',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CACHE_HEADERS.noCache
        },
        body: { id: 'order-123', status: 'updated' }
      }
    ]
  },

  // GET /api/images/small.jpg - Public cached image
  {
    request: {
      method: 'GET',
      path: '/api/images/small.jpg',
      headers: {
        'Accept': 'image/jpeg'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          ...IMAGE_HEADERS.jpeg,
          ...CACHE_HEADERS.public,
          'Content-Length': smallImage.length.toString()
        },
        body: smallImage
      }
    ]
  },

  // GET /api/images/medium.jpg - Auth required image
  {
    request: {
      method: 'GET',
      path: '/api/images/medium.jpg',
      headers: {
        'Accept': 'image/jpeg',
        ...AUTH_HEADERS.bearer
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          ...IMAGE_HEADERS.jpeg,
          ...CACHE_HEADERS.private,
          'Content-Length': mediumImage.length.toString()
        },
        body: mediumImage
      },
      // {
      //   code: 401,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Unauthorized access to image' }
      // }
    ]
  },

  // GET /api/images/large.jpg - Cookie auth image
  {
    request: {
      method: 'GET',
      path: '/api/images/large.jpg',
      headers: {
        'Accept': 'image/jpeg',
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          ...IMAGE_HEADERS.jpeg,
          ...CACHE_HEADERS.private,
          ...COOKIE_HEADERS.session,
          'Content-Length': largeImage.length.toString()
        },
        body: largeImage
      },
      // {
      //   code: 403,
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: 'Invalid session' }
      // }
    ]
  }
  */
]

// Generate more calls with different combinations
for (let i = 1; i <= 100; i++) {
  // Every 10th request is an image request
  if (i % 10 === 0) {
    const imageSize = i % 3 === 0 ? largeImage : i % 2 === 0 ? mediumImage : smallImage
    const authType = Object.keys(AUTH_HEADERS)[i % Object.keys(AUTH_HEADERS).length]
    const cacheType = Object.keys(CACHE_HEADERS)[i % Object.keys(CACHE_HEADERS).length]

    calls.push({
      request: {
        method: 'GET',
        path: `/api/images/image-${i}.jpg`,
        headers: {
          'Accept': 'image/jpeg',
          // ...AUTH_HEADERS[authType as keyof typeof AUTH_HEADERS]
        }
      },
      responses: [
        {
          code: 200,
          headers: {
            // ...IMAGE_HEADERS.jpeg,
            // ...CACHE_HEADERS[cacheType as keyof typeof CACHE_HEADERS],
            'Content-Length': imageSize.length.toString()
          },
          body: imageSize
        },
        // {
        //   code: i % 2 === 0 ? 401 : 403,
        //   headers: {
        //     'Content-Type': 'application/json'
        //   },
        //   body: { error: i % 2 === 0 ? 'Unauthorized' : 'Forbidden' }
        // }
      ]
    })
    continue
  }

  const authType = Object.keys(AUTH_HEADERS)[i % Object.keys(AUTH_HEADERS).length]
  const cacheType = Object.keys(CACHE_HEADERS)[i % Object.keys(CACHE_HEADERS).length]
  const cookieType = Object.keys(COOKIE_HEADERS)[i % Object.keys(COOKIE_HEADERS).length]

  calls.push({
    request: {
      method: 'GET',
      path: `/api/resource-${i}`,
      headers: {
        // 'Accept': 'application/json',
        // 'Content-Type': 'application/json',
        // ...AUTH_HEADERS[authType as keyof typeof AUTH_HEADERS]
      }
    },
    responses: [
      {
        code: [200, 201][i % 2],
        headers: {
          // 'Content-Type': 'application/json',
          // ...CACHE_HEADERS[cacheType as keyof typeof CACHE_HEADERS],
          // ...COOKIE_HEADERS[cookieType as keyof typeof COOKIE_HEADERS]
        },
        body: i % 5 === 0 ? productCatalog : i % 3 === 0 ? userData : {
          id: i,
          name: `Resource ${i}`,
          timestamp: new Date().toISOString()
        }
      },
      // {
      //   code: [400, 401, 403, 404][i % 4],
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: { error: `Error ${i}`, code: `ERR_${i}` }
      // }
    ]
  })
}
