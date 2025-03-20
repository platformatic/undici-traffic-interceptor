import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractDomain } from '../src/lib/utils.ts'

describe('extractDomain', () => {
  test('should extract domain from origin', () => {
    const cases = [
      { origin: 'http://sub.plt.local:3000', domain: '.sub.plt.local' },
      { origin: 'http://local:3000', domain: '.local' },
      { origin: 'http://local', domain: '.local' },
      { origin: undefined, domain: undefined },
      { origin: 'sub.plt.local', domain: '.sub.plt.local' },
      { origin: 'local:3000', domain: '.local' },
      { origin: 'local', domain: '.local' },
      { origin: '', domain: undefined }
    ]

    for (const { origin, domain } of cases) {
      assert.strictEqual(extractDomain(origin), domain, `Domain ${domain} should be extracted from ${origin}`)
    }
  })
})
