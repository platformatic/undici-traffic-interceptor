import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { interceptByDomain } from '../src/lib/traffic.ts'

describe('ICC', () => {
  test('should be intercepted by matching domains', () => {
    const cases = [
      { domain: '.example.com', matchingDomains: ['.example.com'] },
      { domain: '.sub.platformatic.dev', matchingDomains: ['.platformatic.dev'] },
      { domain: '.plt.local', matchingDomains: ['.local'] },
      { domain: '.sub.plt.local', matchingDomains: ['.local'] },
      { domain: '.sub.sub.plt.local', matchingDomains: ['.local'] },
      { domain: '.sub.sub.plt.local', matchingDomains: undefined },
      { domain: undefined, matchingDomains: undefined },
    ]

    for (const { domain, matchingDomains } of cases) {
      assert.equal(interceptByDomain(domain, matchingDomains), true, `Domain ${domain} should be skipped by ${matchingDomains?.join(', ')}`)
    }
  })

  test('should not be intercepted by non matching domains', () => {
    const cases = [
      { domain: '.example.com', matchingDomains: ['.sub.example.com'] },
      { domain: '.sub.platformatic.dev', matchingDomains: ['.node.dev'] },
      { domain: '.plt.local', matchingDomains: ['.plt.node.local'] },
      { domain: '.sub.plt.local', matchingDomains: ['.local.com'] },
      { domain: '.sub.sub.plt.local', matchingDomains: ['.local.com'] },
      { domain: undefined, matchingDomains: ['.local.com'] },
    ]

    for (const { domain, matchingDomains } of cases) {
      assert.equal(interceptByDomain(domain, matchingDomains), false, `Domain ${domain} should be skipped by ${matchingDomains.join(', ')}`)
    }
  })
})
