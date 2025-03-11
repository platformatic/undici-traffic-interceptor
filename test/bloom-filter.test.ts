import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { BloomFilter } from '../src/lib/bloom-filter.ts'

describe('BloomFilter', async () => {
  test('should correctly add and test elements', async () => {
    const filter = new BloomFilter(100, 0.01)
    const hash1 = 123456789n
    const hash2 = 987654321n

    filter.add(hash1)
    assert.strictEqual(filter.has(hash1), true, 'should find added element')
    assert.strictEqual(filter.has(hash2), false, 'should not find non-added element')
  })

  test('should handle multiple elements', async () => {
    const filter = new BloomFilter(1000, 0.01)
    const hashes = Array.from({ length: 100 }, (_, i) => BigInt(i * 12345))

    // Add all hashes
    hashes.forEach(hash => filter.add(hash))

    // Test all added hashes
    hashes.forEach(hash => {
      assert.strictEqual(filter.has(hash), true, `should find hash ${hash}`)
    })

    // Test some non-added hashes
    const nonAddedHashes = Array.from({ length: 100 }, (_, i) => BigInt((i + 1000) * 12345))
    let falsePositives = 0
    nonAddedHashes.forEach(hash => {
      if (filter.has(hash)) falsePositives++
    })

    // Check false positive rate is within expected range
    const falsePositiveRate = falsePositives / nonAddedHashes.length
    assert.ok(
      falsePositiveRate <= 0.01,
      `false positive rate ${falsePositiveRate} should be less than 0.01`
    )
  })

  test('should calculate correct false positive probability', async () => {
    const filter = new BloomFilter(100, 0.01)
    const numElements = 50

    // Add elements
    for (let i = 0; i < numElements; i++) {
      filter.add(BigInt(i * 12345))
    }

    const probability = filter.getFalsePositiveProbability(numElements)
    assert.ok(
      probability > 0 && probability < 0.01,
      `probability ${probability} should be between 0 and 0.01`
    )
  })

  test('should handle edge cases', async () => {
    // Small capacity
    const smallFilter = new BloomFilter(1, 0.01)
    smallFilter.add(123n)
    assert.strictEqual(smallFilter.has(123n), true)

    // Large capacity
    const largeFilter = new BloomFilter(1000000, 0.01)
    largeFilter.add(456n)
    assert.strictEqual(largeFilter.has(456n), true)

    // High false positive rate
    const highFPFilter = new BloomFilter(100, 0.5)
    highFPFilter.add(789n)
    assert.strictEqual(highFPFilter.has(789n), true)

    // Low false positive rate
    const lowFPFilter = new BloomFilter(100, 0.0001)
    lowFPFilter.add(101112n)
    assert.strictEqual(lowFPFilter.has(101112n), true)
  })

  test('should generate different bit positions for same hash', async () => {
    const filter = new BloomFilter(100, 0.01)
    const hash = 12345n

    // Get positions multiple times
    const positions1 = filter['getPositions'](hash)
    const positions2 = filter['getPositions'](hash)

    // Same hash should generate same positions
    assert.deepStrictEqual(positions1, positions2, 'positions should be deterministic')

    // Positions should be unique
    const uniquePositions = new Set(positions1)
    assert.ok(
      uniquePositions.size > 1,
      'should generate multiple unique positions'
    )
  })
})
