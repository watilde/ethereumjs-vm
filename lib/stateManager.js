const Trie = require('merkle-patricia-tree/secure.js')
const common = require('ethereum-common')
const async = require('async')
const Account = require('ethereumjs-account')
const fakeBlockchain = require('./fakeBlockChain.js')
const Cache = require('./cache.js')
const utils = require('ethereumjs-util')
const BN = utils.BN
const rlp = utils.rlp

module.exports = class StateManager {
  constructor (opts) {

    let trie = opts.trie
    if (!trie) {
      trie = new Trie(trie)
    }

    let blockchain = opts.blockchain
    if (!blockchain) {
      blockchain = fakeBlockchain
    }

    this.blockchain = blockchain
    this.trie = trie
    this._storageTries = {} // the storage trie cache
    this.cache = new Cache(trie)
  }


  // gets the account from the cache, or triggers a lookup and stores
  // the result in the cache
  getAccount (address, cb) {
    this.cache.getOrLoad(address, cb)
  }

  // checks if an account exists
  exists (address, cb) {
    this.cache.getOrLoad(address, (err, account) => {
      cb(err, account.exists)
    })
  }

  // saves the account
  _putAccount (address, account, cb) {
    const addressHex = new Buffer(address, 'hex')
    // TODO: dont save newly created accounts that have no balance
    // if (toAccount.balance.toString('hex') === '00') {
    // if they have money or a non-zero nonce or code, then write to tree
    this.cache.put(addressHex, account)
    // this.trie.put(addressHex, account.serialize(), cb)
    cb()
  }

  getAccountBalance (address, cb) {
    this.getAccount(address, (err, account) => {
      if (err) {
        return cb(err)
      }
      cb(null, account.balance)
    })
  }

  putAccountBalance (address, balance, cb) {
    this.getAccount(address, (err, account) => {
      if (err) {
        return cb(err)
      }
      account.balance = balance
      this._putAccount(address, account, cb)
    })
  }

  // sets the contract code on the account
  putContractCode (address, value, cb) {
    this.getAccount(address, (err, account) => {
      if (err) {
        return cb(err)
      }
      // TODO: setCode use trie.setRaw which creates a storage leak
      account.setCode(this.trie, value, (err) => {
        if (err) {
          return cb(err)
        }
        this._putAccount(address, account, cb)
      })
    })
  }

  // given an account object, returns the code
  getContractCode (address, cb) {
    this.getAccount(address, (err, account) => {
      if (err) {
        return cb(err)
      }
      account.getCode(this.trie, cb)
    })
  }

  // creates a storage trie from the primary storage trie
  _lookupStorageTrie (address, cb) {
    // from state trie
    this.getAccount(address, (err, account) => {
      if (err) {
        return cb(err)
      }
      const storageTrie = this.trie.copy()
      storageTrie.root = account.stateRoot
      storageTrie._checkpoints = []
      cb(null, storageTrie)
    })
  }

  // gets the storage trie from the storage cache or does lookup
  _getStorageTrie (address, cb) {
    const storageTrie = this._storageTries[address.toString('hex')]
    // from storage cache
    if (storageTrie) {
      return cb(null, storageTrie)
    }
    // lookup from state
    this._lookupStorageTrie(address, cb)
  }

  getContractStorage (address, key, cb) {
    this._getStorageTrie(address, (err, trie) => {
      if (err) {
        return cb(err)
      }
      trie.get(key, (err, value) => {
        if (err) {
          return cb(err)
        }
        const decoded = rlp.decode(value)
        cb(null, decoded)
      })
    })
  }

  putContractStorage (address, key, value, cb) {
    const self = this
    this._getStorageTrie(address, (err, storageTrie) => {
      if (err) {
        return cb(err)
      }

      if (value && value.length) {
        // format input
        const encodedValue = rlp.encode(value)
        storageTrie.put(key, encodedValue, finalize)
      } else {
        // deleting a value
        storageTrie.del(key, finalize)
      }

      function finalize (err) {
        if (err) return cb(err)
        // update storage cache
        self._storageTries[address.toString('hex')] = storageTrie
        // update contract stateRoot
        const contract = self.cache.get(address)
        contract.stateRoot = storageTrie.root
        self._putAccount(address, contract, cb)
      }
    })
  }

  commitContracts (cb) {
    async.each(Object.keys(this._storageTries), (address, cb) => {
      const trie = this._storageTries[address]
      delete this._storageTries[address]
      // TODO: this is broken on the block level; all the contracts get written to
      // disk redardless of whether or not the block is valid
      if (trie.isCheckpoint) {
        trie.commit(cb)
      } else {
        cb()
      }
    }, cb)
  }

  revertContracts () {
    this._storageTries = {}
  }

  //
  // blockchain
  //
  getBlockHash (number, cb) {
    this.blockchain.getBlock(number, (err, block) => {
      if (err) {
        return cb(err)
      }
      const blockHash = block.hash()
      cb(null, blockHash)
    })
  }

  //
  // revision history
  //
  checkpoint () {
    this.trie.checkpoint()
    this.cache.checkpoint()
  }

  commit (cb) {
    // setup trie checkpointing
    this.trie.commit(() => {
      // setup cache checkpointing
      this.cache.commit()
      cb()
    })
  }

  revert (cb) {
    // setup trie checkpointing
    this.trie.revert()
    // setup cache checkpointing
    this.cache.revert()
    cb()
  }

  //
  // cache stuff
  //
  getStateRoot (cb) {
    this.cacheFlush((err) => {
      if (err) {
        return cb(err)
      }
      const stateRoot = this.trie.root
      cb(null, stateRoot)
    })
  }

  /**
   * @param {Set} address
   * @param {cb} function
   */
  warmCache (addresses, cb) {
    this.cache.warm(addresses, cb)
  }

  dumpStorage (address, cb) {
    this._getStorageTrie(address, (err, trie) => {
      if (err) {
        return cb(err)
      }
      const storage = {}
      const stream = trie.createReadStream()
      stream.on('data', (val) => {
        storage[val.key.toString('hex')] = val.value.toString('hex')
      })
      stream.on('end', () => {
        cb(storage)
      })
    })
  }

  hasGenesisState (cb) {
    const root = common.genesisStateRoot.v
    this.trie.checkRoot(root, cb)
  }

  generateCanonicalGenesis (cb) {
    this.hasGenesisState((err, genesis) => {
      if (!genesis & !err) {
        this.generateGenesis(common.genesisState, cb)
      } else {
        cb(err)
      }
    })
  }

  generateGenesis (initState, cb) {
    const addresses = Object.keys(initState)
    async.eachSeries(addresses, (address, done) => {
      const account = new Account()
      account.balance = new Buffer((new BN(initState[address])).toArray())
      address = new Buffer(address, 'hex')
      this.trie.put(address, account.serialize(), done)
    }, cb)
  }
}
