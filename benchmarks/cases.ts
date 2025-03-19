interface Request {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
}

interface Response {
  code: number
  headers: Record<string, string>
  body: unknown
}

interface Case {
  label: string
  request: Request
  responses: Response[]
  expected?: boolean
}

export const cases: Case[] = [
  {
    label: 'intercepted',
    expected: true,
    request: {
      method: 'GET',
      path: '/api/users/123',
      headers: {
        Accept: 'application/json'
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
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'Alice Doe', email: 'alice@example.com' }
      },
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'Bob Doe', email: 'bob@example.com' }
      },
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'Charlie Doe', email: 'charlie@example.com' }
      },
    ]
  },

  // request
  {
    label: 'skipped due to request method (POST)',
    request: {
      method: 'POST',
      path: '/api/users/123',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: { id: 123, name: 'John Doe', email: 'john@example.com' }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to request headers (Cache-Control: no-cache)',
    request: {
      method: 'GET',
      path: '/api/users/123/profile',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to request headers (Authorization: Bearer 123)',
    request: {
      method: 'GET',
      path: '/api/users/123/settings',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer 123'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to request headers (Cookie: sessionid=123)',
    request: {
      method: 'GET',
      path: '/api/users/123/favourites',
      headers: {
        Accept: 'application/json',
        Cookie: 'sessionid=123'
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { language: 'en', theme: 'light' }
      }
    ]
  },

  // response
  {
    label: 'skipped due to response code (400)',
    request: {
      method: 'GET',
      path: '/api/products/123',
      headers: {
        Accept: 'application/json',
      }
    },
    responses: [
      {
        code: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { error: 'Bad Request' }
      }
    ]
  },
  {
    label: 'skipped due to response headers (Cache-Control: no-cache)',
    request: {
      method: 'GET',
      path: '/api/products/123/details',
      headers: {
        Accept: 'application/json',
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to response headers (Authorization: Bearer 123)',
    request: {
      method: 'GET',
      path: '/api/products/123/buy',
      headers: {
        Accept: 'application/json',
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer 123'
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to response headers (Set-Cookie: sessionid=123)',
    request: {
      method: 'GET',
      path: '/api/products/123/sell',
      headers: {
        Accept: 'application/json',
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'sessionid=123'
        },
        body: { id: 123, name: 'John Doe', email: 'john@example.com' }
      }
    ]
  },
  {
    label: 'skipped due to response size (1Mb)',
    request: {
      method: 'GET',
      path: '/image.jpg',
      headers: {
        Accept: 'image/jpeg',
      }
    },
    responses: [
      {
        code: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': '1048576'
        },
        body: Buffer.from(new Uint8Array(1024 * 1024))
      }
    ]
  }

]
