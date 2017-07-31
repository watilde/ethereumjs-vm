const Tree = require('functional-red-black-tree')
const Account = require('ethereumjs-account')
const async = require('async')

module.exports = class Cache {

  constructor (trie) {
    this._cache = Tree()
    this._checkpoints = []
    this._deletes = []
    this._trie = trie
  }

  put (key, val, fromTrie) {
    const modified = !fromTrie
    this._update(key, val, modified, true)
  }

  // returns the queried account or an empty account
  get (key) {
    let account = this.lookup(key)
    if (!account) {
      account = new Account()
      account.exists = false
    }
    return account
  }

  // returns the queried account or undefined
  lookup (key) {
    key = key.toString('hex')

    const it = this._cache.find(key)
    if (it.node) {
      const account = new Account(it.value.val)
      account.exists = it.value.exists
      return account
    }
  }

  _lookupAccount (address, cb) {
    this._trie.get(address, (err, raw) => {
      if (err) return cb(err)
      const account = new Account(raw)
      const exists = !!raw
      account.exists = exists
      cb(null, account, exists)
    })
  }

  getOrLoad (key, cb) {
    const account = this.lookup(key)
    if (account) {
      cb(null, account)
    } else {
      this._lookupAccount(key, (err, account, exists) => {
        if (err) return cb(err)
        this._update(key, account, false, exists)
        cb(null, account)
      })
    }
  }

  warm (addresses, cb) {
    // shim till async supports iterators
    const accountArr = []
    addresses.forEach((val) => {
      if (val) accountArr.push(val)
    })

    async.eachSeries(accountArr, (addressHex, done) => {
      const address = new Buffer(addressHex, 'hex')
      this._lookupAccount(address, (err, account) => {
        if (err) return done(err)
        this._update(address, account, false, account.exists)
        done()
      })
    }, cb)
  }

  flush (cb) {
    const it = this._cache.begin
    let next = true
    async.whilst(() => {
      return next
    }, (done) => {
      if (it.value.modified) {
        it.value.modified = false
        it.value.val = it.value.val.serialize()
        this._trie.put(new Buffer(it.key, 'hex'), it.value.val, () => {
          next = it.hasNext
          it.next()
          done()
        })
      } else {
        next = it.hasNext
        it.next()
        done()
      }
    }, () => {
      async.eachSeries(this._deletes, (address, done) => {
        this._trie.del(address, done)
      }, () => {
        this._deletes = []
        cb()
      })
    })
  }

  checkpoint () {
    this._checkpoints.push(this._cache)
  }

  revert () {
    this._cache = this._checkpoints.pop(this._cache)
  }

  commit () {
    this._checkpoints.pop()
  }

  clear () {
    this._deletes = []
    this._cache = Tree()
  }

  del (key) {
    this._deletes.push(key)
    key = key.toString('hex')
    this._cache = this._cache.remove(key)
  }

  _update (key, val, modified, exists) {
    key = key.toString('hex')
    const it = this._cache.find(key)
    if (it.node) {
      this._cache = it.update({
        val: val,
        modified: modified,
        exists: true
      })
    } else {
      this._cache = this._cache.insert(key, {
        val: val,
        modified: modified,
        exists: exists
      })
    }
  }
}
