const Buffer = require('safe-buffer').Buffer
const utils = require('ethereumjs-util')

module.exports = {
  getBlock: function (hash, cb) {
    // Same hack as in ethereumjs-blockchain and this also makes it explicit
    // what utils.bufferToInt is doing behind the scenes.
    if (!Number.isInteger(hash)) {
      hash = utils.toBuffer(hash).toString('hex')
    }

    // FIXME: this will fail on block numbers >53 bits
    hash = utils.sha3(Buffer.from(utils.bufferToInt(hash).toString(), 'utf8'))

    var block = {
      hash: function () {
        return hash
      }
    }

    cb(null, block)
  },

  delBlock: function (hash, cb) {
    cb(null)
  }
}
