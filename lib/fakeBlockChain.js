const utils = require('ethereumjs-util')

module.exports = {
  getBlock: (n, cb) => {
    const hash = utils.sha3(new Buffer(utils.bufferToInt(n).toString()))

    const block = {
      hash: function () {
        return hash
      }
    }

    cb(null, block)
  }
}
