const async = require('async')
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN
const fees = require('ethereum-common')
const constants = require('./constants.js')

const ERROR = constants.ERROR

/**
 * runs a CALL operation
 * @method runCall
 * @param opts
 * @param opts.block {Block}
 * @param opts.caller {Buffer}
 * @param opts.code {Buffer} this is for CALLCODE where the code to load is different than the code from the to account.
 * @param opts.data {Buffer}
 * @param opts.gasLimit {Buffer | BN.js }
 * @param opts.gasPrice {Buffer}
 * @param opts.origin {Buffer} []
 * @param opts.to {Buffer}
 * @/param opts.value {Buffer}
 */
module.exports = function (opts, cb) {
  
  const self = this
  const stateManager = this.stateManager
  let vmResults = {}
  let toAccount
  let toAddress = opts.to
  let createdAddress
  const txValue = new BN(opts.value || new Buffer(0))
  const caller = opts.caller
  const account = stateManager.cache.get(caller)
  const block = opts.block
  let code = opts.code
  let txData = opts.data
  const gasLimit = new BN(opts.gasLimit || 0xffffff)
  const gasPrice = opts.gasPrice
  let gasUsed = new BN(0)
  const origin = opts.origin
  let isCompiled = opts.compiled
  let depth = opts.depth
  const suicides = opts.suicides
  const delegatecall = opts.delegatecall || false


  stateManager.checkpoint()

  // run and parse
  subTxValue()

  async.series([
    loadToAccount,
    loadCode,
    runCode,
    saveCode
  ], parseCallResult)

  function loadToAccount (done) {
    // get receiver's account
    // toAccount = stateManager.cache.get(toAddress)
    if (!toAddress) {
      // generate a new contract if no `to`
      code = txData
      txData = undefined
      const newNonce = new BN(account.nonce).subn(1)
      createdAddress = toAddress = ethUtil.generateAddress(caller, newNonce.toArray())
      stateManager.getAccount(createdAddress, (err, account) => {
        toAccount = account
        done(err)
      })
    } else {
      // else load the `to` account
      toAccount = stateManager.cache.get(toAddress)
      done()
    }
  }

  function subTxValue () {
    if (delegatecall) {
      return
    }
    account.balance = new BN(account.balance).sub(txValue)
    stateManager.cache.put(caller, account)
  }

  function addTxValue () {
    if (delegatecall) {
      return
    }
    // add the amount sent to the `to` account
    toAccount.balance = new BN(toAccount.balance).add(txValue)
    stateManager.cache.put(toAddress, toAccount)
  }

  function loadCode (cb) {
    addTxValue()
    // loads the contract's code if the account is a contract
    if (code || !(toAccount.isContract() || ethUtil.isPrecompiled(toAddress))) {
      cb()
      return
    }

    if (ethUtil.isPrecompiled(toAddress)) {
      isCompiled = true
      code = self._precompiled[toAddress.toString('hex')]
      cb()
      return
    }

    stateManager.getContractCode(toAddress, (err, c, comp) => {
      if (err) return cb(err)
      isCompiled = comp
      code = c
      cb()
    })
  }

  function runCode (cb) {
    if (!code) {
      vmResults.exception = 1
      stateManager.commit(cb)
      return
    }

    const runCodeOpts = {
      code: code,
      data: txData,
      gasLimit: gasLimit,
      gasPrice: gasPrice,
      address: toAddress,
      origin: origin,
      caller: caller,
      value: new Buffer(txValue.toArray()),
      block: block,
      depth: depth,
      suicides: suicides,
      populateCache: false
    }

    // run Code through vm
    const codeRunner = isCompiled ? self.runJIT : self.runCode
    codeRunner.call(self, runCodeOpts, parseRunResult)

    function parseRunResult (err, results) {
      toAccount = self.stateManager.cache.get(toAddress)
      vmResults = results

      if (createdAddress) {
        // fee for size of the return value
        const returnFee = results.return.length * fees.createDataGas.v
        const totalGas = results.gasUsed.addn(returnFee)
        // if not enough gas
        if (totalGas.cmp(gasLimit) <= 0 && results.return.length <= 24576) {
          results.gasUsed = totalGas
        } else {
          results.return = new Buffer([])
          // since Homestead
          results.exception = 0
          err = results.exceptionError = ERROR.OUT_OF_GAS
          results.gasUsed = gasLimit
        }
      }

      gasUsed = results.gasUsed
      if (err) {
        results.logs = []
        stateManager.revert(cb)
      } else {
        stateManager.commit(cb)
      }
    }
  }

  function saveCode (cb) {
    // store code for a new contract
    if (createdAddress && vmResults.return.toString() !== '') {
      stateManager.putContractCode(createdAddress, vmResults.return, cb)
    } else {
      cb()
    }
  }

  function parseCallResult (err) {
    if (err) return cb(err)
    const results = {
      gasUsed: gasUsed,
      createdAddress: createdAddress,
      vm: vmResults
    }

    cb(null, results)
  }
}
