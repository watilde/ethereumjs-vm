const assert = require('assert')
const utils = require('ethereumjs-util')
const byteSize = 256

module.exports = class Bloom {
  /**
   * Represents a Bloom
   * @constructor
   * @param {Buffer} bitvector
   */
  constructor (bitvector) {
    if (!bitvector) {
      this.bitvector = utils.zeros(byteSize)
    } else {
      assert(bitvector.length === byteSize, 'bitvectors must be 2048 bits long')
      this.bitvector = bitvector
    }
  }

  /**
   * adds an element to a bit vector of a 64 byte bloom filter
   * @method add
   * @param {Buffer} element
   */
  add (e) {
    e = utils.sha3(e)
    const mask = 2047 // binary 11111111111

    for (let i = 0; i < 3; i++) {
      const first2bytes = e.readUInt16BE(i * 2)
      const loc = mask & first2bytes
      const byteLoc = loc >> 3
      const bitLoc = 1 << loc % 8
      this.bitvector[byteSize - byteLoc - 1] |= bitLoc
    }
  }

  /**
   * checks if an element is in the blooom
   * @method check
   * @param {Buffer} element
   */
  check (e) {
    e = utils.sha3(e)
    const mask = 511 // binary 111111111
    let match = true

    for (let i = 0; i < 3 && match; i++) {
      const first2bytes = e.readUInt16BE(i * 2)
      const loc = mask & first2bytes
      const byteLoc = loc >> 3
      const bitLoc = 1 << loc % 8
      match = (this.bitvector[byteSize - byteLoc - 1] & bitLoc)
    }

    return Boolean(match)
  }

  /**
   * checks if multple topics are in a bloom
   * @method check
   * @param {Buffer} element
   */
  multiCheck (topics) {
    let match = true
    topics.forEach((t) => {
      if (!Buffer.isBuffer(t)) {
        t = new Buffer(t, 'hex')
      }

      match && this.check(t)
    })

    return match
  }

  /**
   * bitwise or blooms together
   * @method or
   * @param {Bloom} bloom
   */
  or (bloom) {
    if (bloom) {
      for (let i = 0; i <= byteSize; i++) {
        this.bitvector[i] = this.bitvector[i] | bloom.bitvector[i]
      }
    }
  }
}
