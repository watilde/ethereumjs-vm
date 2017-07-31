const async = require('async')
const ethUtil = require('ethereumjs-util')
const Bloom = require('./bloom.js')
const common = require('ethereum-common')
const rlp = ethUtil.rlp
const Trie = require('merkle-patricia-tree')
const BN = ethUtil.BN

const minerReward = new BN(common.minerReward.v)
const niblingReward = new BN(common.niblingReward.v)
const ommerReward = new BN(common.ommerReward.v)

/**
 * process the transaction in a block and pays the miners
 * @param opts
 * @param opts.block {Block} the block we are processing
 * @param opts.generate {Boolean} [gen=false] whether to generate the stateRoot
 * @param cb {Function} the callback which is given an error string
 */
module.exports = function (opts, cb) {

  // parse options
  const block = opts.block
  const generateStateRoot = !!opts.generate
  const validateStateRoot = !generateStateRoot
  const bloom = new Bloom()
  const receiptTrie = new Trie()
  // the total amount of gas used processing this block
  let gasUsed = new BN(0)
  // miner account
  let minerAccount
  const receipts = []
  const txResults = []
  let result

  if (opts.root) {
    this.stateManager.trie.root = opts.root
  }

  this.trie.checkpoint()

  // run everything
  async.series([
    beforeBlock,
    populateCache,
    processTransactions
  ], parseBlockResults)

  function beforeBlock (cb) {
    this.emit('beforeBlock', opts.block, cb)
  }

  function afterBlock (cb) {
    this.emit('afterBlock', result, cb)
  }

  // populates the cache with accounts that we know we will need
  function populateCache (cb) {
    const accounts = new Set()
    accounts.add(block.header.coinbase.toString('hex'))
    block.transactions.forEach((tx) => {
      accounts.add(tx.getSenderAddress().toString('hex'))
      accounts.add(tx.to.toString('hex'))
    })

    block.uncleHeaders.forEach((uh) => {
      accounts.add(uh.coinbase.toString('hex'))
    })

    this.populateCache(accounts, cb)
  }

  /**
   * Processes all of the transaction in the block
   * @method processTransaction
   * @param {Function} cb the callback is given error if there are any
   */
  function processTransactions (cb) {
    const validReceiptCount = 0

    async.eachSeries(block.transactions, processTx, cb)

    function processTx (tx, cb) {
      const gasLimitIsHigherThanBlock = new BN(block.header.gasLimit).cmp(new BN(tx.gasLimit).add(gasUsed)) === -1
      if (gasLimitIsHigherThanBlock) {
        cb('tx has a higher gas limit than the block')
        return
      }

      // run the tx through the VM
      this.runTx({
        tx: tx,
        block: block,
        populateCache: false
      }, parseTxResult)

      function parseTxResult (err, result) {
        txResults.push(result)

        // abort if error
        if (err) {
          receipts.push(null)
          cb(err)
          return
        }

        gasUsed = gasUsed.add(result.gasUsed)
        // combine blooms via bitwise OR
        bloom.or(result.bloom)

        if (generateStateRoot) {
          block.header.bloom = bloom.bitvector
        }

        const txLogs = result.vm.logs || []
        const rawTxReceipt = [
          this.trie.root,
          new Buffer(gasUsed.toArray()),
          result.bloom.bitvector,
          txLogs
        ]
        const txReceipt = {
          stateRoot: rawTxReceipt[0],
          gasUsed: rawTxReceipt[1],
          bitvector: rawTxReceipt[2],
          logs: rawTxReceipt[3]
        }

        receipts.push(txReceipt)
        receiptTrie.put(rlp.encode(validReceiptCount), rlp.encode(rawTxReceipt))
        validReceiptCount++
        cb()
      }
    }
  }

  // handle results or error from block run
  function parseBlockResults (err) {
    if (err) {
      this.trie.revert()
      cb(err)
      return
    }

    // credit all block rewards
    payOmmersAndMiner()

    // credit all block rewards
    if (generateStateRoot) {
      block.header.stateRoot = this.trie.root
    }

    this.trie.commit((err) => {
      this.stateManager.cache.flush(() => {
        if (validateStateRoot) {
          if (receiptTrie.root && receiptTrie.root.toString('hex') !== block.header.receiptTrie.toString('hex')) {
            err = (err || '') + 'invalid receiptTrie '
          }
          if (bloom.bitvector.toString('hex') !== block.header.bloom.toString('hex')) {
            err = (err || '') + 'invalid bloom '
          }
          if (ethUtil.bufferToInt(block.header.gasUsed) !== Number(gasUsed)) {
            err = (err || '') + 'invalid gasUsed '
          }
          if (this.trie.root.toString('hex') !== block.header.stateRoot.toString('hex')) {
            err = (err || '') + 'invalid block stateRoot '
          }
        }

        this.stateManager.cache.clear()

        result = {
          receipts: receipts,
          results: txResults,
          error: err
        }

        afterBlock(cb.bind(this, err, result))
      })
    })
  }

  // credit all block rewards
  function payOmmersAndMiner () {
    const ommers = block.uncleHeaders
    // pay each ommer
    ommers.forEach(rewardOmmer)
    // calculate nibling reward
    const totalNiblingReward = niblingReward.mul(new BN(ommers.length))
    minerAccount = this.stateManager.cache.get(block.header.coinbase)
    // give miner the block reward
    minerAccount.balance = new BN(minerAccount.balance)
      .add(minerReward)
      .add(totalNiblingReward)
    this.stateManager.cache.put(block.header.coinbase, minerAccount)
  }

  // credit ommer
  function rewardOmmer (ommer) {
    // calculate reward
    const heightDiff = new BN(block.header.number).sub(new BN(ommer.number))
    const reward = minerReward.sub(ommerReward.mul(heightDiff))
    // credit miners account
    const ommerAccount = this.stateManager.cache.get(ommer.coinbase)
    ommerAccount.balance = reward.add(new BN(ommerAccount.balance))
    this.stateManager.cache.put(ommer.coinbase, ommerAccount)
  }
}
