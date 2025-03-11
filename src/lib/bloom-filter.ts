/**
 * A Bloom filter is a space-efficient probabilistic data structure used to test whether an element is a member of a set.
 * False positive matches are possible, but false negatives are not.
 * This implementation assumes all input values are already hashed.
 */
export class BloomFilter {
  private bitArray: Uint8Array
  private numHashFunctions: number
  private bitArraySize: number

  private bitArraySizeN: bigint

  /**
   * Creates a new Bloom filter
   * @param expectedElements The expected number of elements to be inserted
   * @param falsePositiveRate The desired false positive rate (between 0 and 1)
   */
  constructor (expectedElements: number, falsePositiveRate: number) {
    // Calculate optimal size and number of hash functions
    this.bitArraySize = Math.ceil(-(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2))
    this.numHashFunctions = Math.ceil((this.bitArraySize / expectedElements) * Math.log(2))

    this.bitArraySizeN = BigInt(this.bitArraySize)

    // Initialize bit array
    this.bitArray = new Uint8Array(Math.ceil(this.bitArraySize / 8))
  }

  /**
   * Adds a pre-hashed value to the Bloom filter
   * @param hash The pre-hashed value to add
   */
  add (hash: bigint): void {
    const positions = this.getPositions(hash)
    for (const position of positions) {
      this.setBit(position)
    }
  }

  /**
   * Tests if a pre-hashed value might be in the set
   * @param hash The pre-hashed value to test
   * @returns true if the value might be in the set, false if it definitely isn't
   */
  has (hash: bigint): boolean {
    const positions = this.getPositions(hash)
    return positions.every(position => this.getBit(position))
  }

  /**
   * Gets the current false positive probability based on the number of elements added
   * @param numElements The number of elements added to the filter
   */
  getFalsePositiveProbability (numElements: number): number {
    return Math.pow(1 - Math.exp(-this.numHashFunctions * numElements / this.bitArraySize), this.numHashFunctions)
  }

  /**
   * Gets all bit positions for a pre-hashed value
   */
  private getPositions (hash: bigint): number[] {
    const positions: number[] = []
    let currentHash = hash

    for (let i = 0; i < this.numHashFunctions; i++) {
      // Use the pre-hashed value directly, rotating it for each function
      currentHash = (currentHash << BigInt(1)) | (currentHash >> BigInt(63))
      positions.push(Number(currentHash % this.bitArraySizeN))
    }

    return positions
  }

  /**
   * Sets a bit in the bit array
   */
  private setBit (position: number): void {
    const byteIndex = Math.floor(position / 8)
    const bitOffset = position % 8
    this.bitArray[byteIndex] |= (1 << bitOffset)
  }

  /**
   * Gets a bit from the bit array
   */
  private getBit (position: number): boolean {
    const byteIndex = Math.floor(position / 8)
    const bitOffset = position % 8
    return (this.bitArray[byteIndex] & (1 << bitOffset)) !== 0
  }
}
