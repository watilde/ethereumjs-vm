const StateManager = require('./stateManager.js')
const Account = require('ethereumjs-account')
const AsyncEventEmitter = require('async-eventemitter')

// require the percomiled contracts
const num01 = require('./precompiled/01-ecrecover.js')
const num02 = require('./precompiled/02-sha256.js')
const num03 = require('./precompiled/03-ripemd160.js')
const num04 = require('./precompiled/04-identity.js')

module.exports = class VM extends AsyncEventEmitter {
  /**
   * @constructor
   * @param {Object} [opts]
   * @param {Trie} [opts.state] A merkle-patricia-tree instance for the state tree
   * @param {Blockchain} [opts.blockchain] A blockchain object for storing/retrieving blocks
   * @param {Boolean} [opts.activatePrecompiles] Create entries in the state tree for the precompiled contracts
   */
  constructor (opts = {}) {
    super()
    this.deps = {
      ethUtil: require('ethereumjs-util'),
      Account: require('ethereumjs-account'),
      Trie: require('merkle-patricia-tree'),
      rlp: require('ethereumjs-util').rlp
    }
    this.stateManager = new StateManager({
      trie: opts.state,
      blockchain: opts.blockchain
    })

    // temporary
    // this is here for a gradual transition to StateManager
    this.blockchain = this.stateManager.blockchain
    this.trie = this.stateManager.trie
    this.opts = opts || {}

    // precompiled contracts
    this._precompiled = {}
    this._precompiled['0000000000000000000000000000000000000001'] = num01
    this._precompiled['0000000000000000000000000000000000000002'] = num02
    this._precompiled['0000000000000000000000000000000000000003'] = num03
    this._precompiled['0000000000000000000000000000000000000004'] = num04

    if (this.opts.activatePrecompiles) {
      for (let i = 1; i <= 4; i++) {
        this.trie.put(new Buffer('000000000000000000000000000000000000000' + i, 'hex'), new Account().serialize())
      }
    }

    this.runCode = require('./runCode.js')
    this.runJIT = require('./runJit.js')
    this.runBlock = require('./runBlock.js')
    this.runTx = require('./runTx.js')
    this.runCall = require('./runCall.js')
    this.runBlockchain = require('./runBlockchain.js')

    AsyncEventEmitter.call(this)
  }

  copy () {
    return new VM({
      state: this.trie.copy(),
      blockchain: this.blockchain
    })
  }

  /**
   * Loads precompiled contracts into the state
   */
  loadCompiled (address, src, cb) {
    this.trie.db.put(address, src, cb)
  }

  populateCache (addresses, cb) {
    this.stateManager.warmCache(addresses, cb)
  }

}
