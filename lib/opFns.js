const Buffer = require('safe-buffer').Buffer
const async = require('async')
const fees = require('ethereum-common')
const utils = require('ethereumjs-util')
const BN = utils.BN
const constants = require('./constants.js')
const logTable = require('./logTable.js')
const ERROR = constants.ERROR
const MAX_INT = 9007199254740991
const MASK_160 = new BN(1).shln(160).subn(1)

// the opcode functions
module.exports = {
  STOP: function (runState) {
    runState.stopped = true
  },
  ADD: function (a, b, runState) {
    return a.add(b).mod(utils.TWO_POW256)
  },
  MUL: function (a, b, runState) {
    return a.mul(b).mod(utils.TWO_POW256)
  },
  SUB: function (a, b, runState) {
    return a.sub(b).toTwos(256)
  },
  DIV: function (a, b, runState) {
    if (b.isZero()) {
      return b
    } else {
      return a.div(b)
    }
  },
  SDIV: function (a, b, runState) {
    if (b.isZero()) {
      return b
    } else {
      a = a.fromTwos(256)
      b = b.fromTwos(256)
      return a.div(b).toTwos(256)
    }
  },
  MOD: function (a, b, runState) {
    if (b.isZero()) {
      return b
    } else {
      return a.mod(b)
    }
  },
  SMOD: function (a, b, runState) {
    if (b.isZero()) {
      return b
    } else {
      a = a.fromTwos(256)
      b = b.fromTwos(256)
      var r = a.abs().mod(b.abs())
      if (a.isNeg()) {
        r = r.ineg()
      }
      return r.toTwos(256)
    }
  },
  ADDMOD: function (a, b, c, runState) {
    if (c.isZero()) {
      return c
    } else {
      return a.add(b).mod(c)
    }
  },
  MULMOD: function (a, b, c, runState) {
    if (c.isZero()) {
      return c
    } else {
      return a.mul(b).mod(c)
    }
  },
  EXP: function (base, exponent, runState) {
    var m = BN.red(utils.TWO_POW256)
    base = base.toRed(m)

    if (!exponent.isZero()) {
      var bytes = 1 + logTable(exponent)
      subGas(runState, new BN(bytes).muln(fees.expByteGas.v))
      return base.redPow(exponent)
    } else {
      return new BN(1)
    }
  },
  SIGNEXTEND: function (k, val, runState) {
    val = val.toArrayLike(Buffer, 'be', 32)
    var extendOnes = false

    if (k.cmpn(31) <= 0) {
      k = k.toNumber()

      if (val[31 - k] & 0x80) {
        extendOnes = true
      }

      // 31-k-1 since k-th byte shouldn't be modified
      for (var i = 30 - k; i >= 0; i--) {
        val[i] = extendOnes ? 0xff : 0
      }
    }

    return new BN(val)
  },
  // 0x10 range - bit ops
  LT: function (a, b, runState) {
    return new BN(a.cmp(b) === -1)
  },
  GT: function (a, b, runState) {
    return new BN(a.cmp(b) === 1)
  },
  SLT: function (a, b, runState) {
    return new BN(a.fromTwos(256).cmp(b.fromTwos(256)) === -1)
  },
  SGT: function (a, b, runState) {
    return new BN(a.fromTwos(256).cmp(b.fromTwos(256)) === 1)
  },
  EQ: function (a, b, runState) {
    return new BN(a.cmp(b) === 0)
  },
  ISZERO: function (a, runState) {
    return new BN(a.isZero())
  },
  AND: function (a, b, runState) {
    return a.and(b)
  },
  OR: function (a, b, runState) {
    return a.or(b)
  },
  XOR: function (a, b, runState) {
    return a.xor(b)
  },
  NOT: function (a, runState) {
    return a.notn(256)
  },
  BYTE: function (pos, word, runState) {
    if (pos.gten(32)) {
      return new BN(0)
    }

    pos = pos.toNumber()
    word = word.toArrayLike(Buffer, 'be', 32)
    word = utils.setLengthLeft(word, 32)

    return new BN(word[pos])
  },
  // 0x20 range - crypto
  SHA3: function (offset, length, runState) {
//    offset = offset.toNumber()
//    length = length.toNumber()
    var data = memLoad(runState, offset, length)
    // copy fee
    subGas(runState, new BN(fees.sha3WordGas.v).imul(length.div(32)))
    return new BN(utils.sha3(data))
  },
  // 0x30 range - closure state
  ADDRESS: function (runState) {
    return new BN(runState.address)
  },
  BALANCE: function (address, runState, cb) {
    var stateManager = runState.stateManager
    // stack to address
    address = address.mod(MASK_160).toArrayLike(Buffer, 'be', 20)

    // shortcut if current account
    if (address.toString('hex') === runState.address.toString('hex')) {
      cb(null, new BN(runState.contract.balance))
      return
    }

    // otherwise load account then return balance
    stateManager.getAccountBalance(address, function (err, value) {
      if (err) {
        return cb(err)
      }
      cb(null, new BN(value))
    })
  },
  ORIGIN: function (runState) {
    return new BN(runState.origin)
  },
  CALLER: function (runState) {
    return new BN(runState.caller)
  },
  CALLVALUE: function (runState) {
    return new BN(runState.callValue)
  },
  CALLDATALOAD: function (pos, runState) {
    var loaded
    if (pos.gtn(runState.callData.length)) {
      loaded = Buffer.from([0])
    } else {
      pos = pos.toNumber()
      loaded = runState.callData.slice(pos, pos + 32)
      loaded = loaded.length ? loaded : Buffer.from([0])
    }

    return new BN(utils.setLengthRight(loaded, 32))
  },
  CALLDATASIZE: function (runState) {
    if (runState.callData.length === 1 && runState.callData[0] === 0) {
      return new BN(0)
    } else {
      return new BN(runState.callData.length)
    }
  },
  CALLDATACOPY: function (memOffset, dataOffset, dataLength, runState) {
    if (dataOffset.gtn(runSate.callData.length)) {
      return
    }
//    memOffset = memOffset.toNumber()
//    dataLength = dataLength.toNumber()
    dataOffset = dataOffset.toNumber()

    memStore(runState, memOffset, runState.callData, dataOffset, dataLength)
    // sub the COPY fee
//    subGas(runState, new BN(Number(fees.copyGas.v) * Math.ceildataLength / 32)))
    subGas(runState, new BN(fees.copyGas.v).mul(dataLength.divn(32)))
  },
  CODESIZE: function (runState) {
    return new BN(runState.code.length)
  },
  CODECOPY: function (memOffset, codeOffset, length, runState) {
    if (codeOffset.gtn(runState.code.length)) {
      return
    }
//    memOffset = memOffset.toNumber()
    codeOffset = codeOffset.toNumber()
//    length = length.toNumber()

    memStore(runState, memOffset, runState.code, codeOffset, length)
    // sub the COPY fee
//    subGas(runState, new BN(fees.copyGas.v * Math.ceil(length / 32)))
    subGas(runState, new BN(fees.copyGas.v).mul(length.divn(3)))
  },
  EXTCODESIZE: function (address, runState, cb) {
    var stateManager = runState.stateManager
    address = utils.setLengthLeft(address, 20)
    stateManager.getContractCode(address, function (err, code) {
      cb(err, new BN(code.length))
    })
  },
  EXTCODECOPY: function (address, memOffset, codeOffset, length, runState, cb) {
    subMemUsage(runState, memOffset, length)

    var stateManager = runState.stateManager
    address = utils.setLengthLeft(address, 20)
//    memOffset = memOffset.toNumber()
    codeOffset = codeOffset.toNumber()
//    length = length.toNumber()

    // copy fee
//    subGas(runState, new BN(fees.copyGas.v).imuln(Math.ceil(length / 32)))
    subGas(runState, new BN(fees.copyGas.v).imul(length.divn(32)))

    stateManager.getContractCode(address, function (err, code) {
      code = err ? Buffer.from([0]) : code
      memStore(runState, memOffset, code, codeOffset, length, false)
      cb(err)
    })
  },
  GASPRICE: function (runState) {
    return new BN(runState.gasPrice)
  },
  // '0x40' range - block operations
  BLOCKHASH: function (number, runState, cb) {
    var stateManager = runState.stateManager
    var diff = new BN(runState.block.header.number).sub(number)

    // block lookups must be within the past 256 blocks
    if (diff.gtn(256) || diff.lten(0)) {
      cb(null, new BN(0))
      return
    }

    stateManager.getBlockHash(number.toArrayLike(Buffer, 'be', 32), function (err, blockHash) {
      if (err) {
        // if we are at a low block height and request a blockhash before the genesis block
        cb(null, new BN(0))
      } else {
        cb(null, new BN(blockHash))
      }
    })
  },
  COINBASE: function (runState) {
    return new BN(runState.block.header.coinbase)
  },
  TIMESTAMP: function (runState) {
    return new BN(runState.block.header.timestamp)
  },
  NUMBER: function (runState) {
    return new BN(runState.block.header.number)
  },
  DIFFICULTY: function (runState) {
    return new BN(runState.block.header.difficulty)
  },
  GASLIMIT: function (runState) {
    return new BN(runState.block.header.gasLimit)
  },
  // 0x50 range - 'storage' and execution
  POP: function () {},
  MLOAD: function (pos, runState) {
    return new BN(memLoad(runState, pos, new BN(32)))
  },
  MSTORE: function (offset, word, runState) {
    word = word.toArrayLike(Buffer, 'be', 32)
    memStore(runState, offset, word, 0, new BN(32))
  },
  MSTORE8: function (offset, byte, runState) {
    // NOTE: we're using a 'trick' here to get the least significant byte
    byte = byte.toArrayLike(Buffer, 'le', 1)
    memStore(runState, offset, byte, 0, new BN(1))
  },
  SLOAD: function (key, runState, cb) {
    var stateManager = runState.stateManager
    key = key.toArrayLike(Buffer, 'be', 32)

    stateManager.getContractStorage(runState.address, key, function (err, value) {
      if (err) return cb(err)
      value = value.length ? new BN(value) : new BN(0)
      cb(null, value)
    })
  },
  SSTORE: function (key, val, runState, cb) {
    var stateManager = runState.stateManager
    var address = runState.address
    key = key.toArrayLike(Buffer, 'be', 32)
    var value = utils.unpad(val.toArrayLike(Buffer, 'be', 32))

    stateManager.getContractStorage(runState.address, key, function (err, found) {
      if (err) return cb(err)
      try {
        if (value.length === 0 && !found.length) {
          subGas(runState, new BN(fees.sstoreResetGas.v))
        } else if (value.length === 0 && found.length) {
          subGas(runState, new BN(fees.sstoreResetGas.v))
          runState.gasRefund.iadd(new BN(fees.sstoreRefundGas.v))
        } else if (value.length !== 0 && !found.length) {
          subGas(runState, new BN(fees.sstoreSetGas.v))
        } else if (value.length !== 0 && found.length) {
          subGas(runState, new BN(fees.sstoreResetGas.v))
        }
      } catch (e) {
        cb(e.error)
        return
      }

      stateManager.putContractStorage(address, key, value, function (err) {
        if (err) return cb(err)
        runState.contract = stateManager.cache.get(address)
        cb()
      })
    })
  },
  JUMP: function (dest, runState) {
    if (dest.gtn(runState.code.length)) {
      trap(ERROR.INVALID_JUMP + ' at ' + describeLocation(runState))
    }

    dest = dest.toNumber()

    if (!jumpIsValid(runState, dest)) {
      trap(ERROR.INVALID_JUMP + ' at ' + describeLocation(runState))
    }

    runState.programCounter = dest
  },
  JUMPI: function (dest, cond, runState) {
    dest = new BN(dest)
    cond = new BN(cond)

    if (!cond.isZero()) {
      if (dest.gtn(runState.code.length)) {
        trap(ERROR.INVALID_JUMP + ' at ' + describeLocation(runState))
      }

      dest = dest.toNumber()

      if (!jumpIsValid(runState, dest)) {
        trap(ERROR.INVALID_JUMP + ' at ' + describeLocation(runState))
      }

      runState.programCounter = dest
    }
  },
  PC: function (runState) {
    return new BN(runState.programCounter - 1)
  },
  MSIZE: function (runState) {
    return runState.memoryWordCount.muln(32)
  },
  GAS: function (runState) {
    return runState.gasLeft
  },
  JUMPDEST: function (runState) {},
  PUSH: function (runState) {
    const numToPush = runState.opCode - 0x5f
    const loaded = new BN(runState.code.slice(runState.programCounter, runState.programCounter + numToPush).toString('hex'), 16)
    runState.programCounter += numToPush
    return loaded
  },
  DUP: function (runState) {
    const stackPos = runState.opCode - 0x7f
    if (stackPos > runState.stack.length) {
      trap(ERROR.STACK_UNDERFLOW)
    }
    // dupilcated stack items point to the same Buffer
    return runState.stack[runState.stack.length - stackPos]
  },
  SWAP: function (runState) {
    var stackPos = runState.opCode - 0x8f

    // check the stack to make sure we have enough items on teh stack
    var swapIndex = runState.stack.length - stackPos - 1
    if (swapIndex < 0) {
      trap(ERROR.STACK_UNDERFLOW)
    }

    // preform the swap
    var newTop = runState.stack[swapIndex]
    runState.stack[swapIndex] = runState.stack.pop()
    return newTop
  },
  LOG: function (memOffset, memLength) {
    var args = Array.prototype.slice.call(arguments, 0)
    args.pop() // pop off callback
    var runState = args.pop()
    var topics = args.slice(2)
    topics = topics.map(function (a) {
      return utils.setLengthLeft(a, 32)
    })

//    memOffset = memOffset.toNumber()
//    memLength = memLength.toNumber()
    const numOfTopics = runState.opCode - 0xa0
    const mem = memLoad(runState, memOffset, memLength)
    subGas(runState, new BN(numOfTopics * fees.logTopicGas.v).add(memLength.muln(fees.logDataGas.v)))

    // add address
    var log = [runState.address]
    log.push(topics)

    // add data
    log.push(mem)
    runState.logs.push(log)
  },

  // '0xf0' range - closures
  CREATE: function (value, offset, length, runState, done) {
//    offset = offset.toNumber()
//    length = length.toNumber()
    // set up config
    var options = {
      value: value
    }
    var localOpts = {
      inOffset: offset,
      inLength: length,
      outOffset: 0,
      outLength: 0
    }

    checkCallMemCost(runState, options, localOpts)
    checkOutOfGas(runState, options)
    makeCall(runState, options, localOpts, done)
  },
  CALL: function (gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength, runState, done) {
    var stateManager = runState.stateManager
    toAddress = toAddress.and(MASK_160).toArrayLike(Buffer, 'be', 20)
//    inOffset = inOffset.toNumber()
//    inLength = inLength.toNumber()
//    outOffset = outOffset.toNumber()
//    outLength = outLength.toNumber()
    var data = memLoad(runState, inOffset, inLength)
    var options = {
      gasLimit: gasLimit,
      value: value,
      to: toAddress,
      data: data
    }
    var localOpts = {
      inOffset: inOffset,
      inLength: inLength,
      outOffset: outOffset,
      outLength: outLength
    }

    if (!value.isZero()) {
      subGas(runState, new BN(fees.callValueTransferGas.v))
    }

    stateManager.exists(toAddress, function (err, exists) {
      if (err) {
        done(err)
        return
      }

      stateManager.accountIsEmpty(toAddress, function (err, empty) {
        if (err) {
          done(err)
        }

        if (!exists || empty) {
          if (!value.isZero()) {
            try {
              subGas(runState, new BN(fees.callNewAccountGas.v))
            } catch (e) {
              done(e.error)
            }
          }
        }
      })

      try {
        checkCallMemCost(runState, options, localOpts)
        checkOutOfGas(runState, options)
      } catch (e) {
        done(e.error)
        return
      }

      if (!value.isZero()) {
        runState.gasLeft.iadd(new BN(fees.callStipend.v))
        options.gasLimit.iadd(new BN(fees.callStipend.v))
      }

      makeCall(runState, options, localOpts, done)
    })
  },
  CALLCODE: function (gas, toAddress, value, inOffset, inLength, outOffset, outLength, runState, done) {
    var stateManager = runState.stateManager
    toAddress = toAddress.and(MASK_160).toArrayLike(Buffer, 'be', 20)
//    inOffset = inOffset.toNumber()
//    inLength = inLength.toNumber()
//    outOffset = outOffset.toNumber()
//    outLength = outLength.toNumber()

    const options = {
      gasLimit: gas,
      value: value,
      to: runState.address
    }

    const localOpts = {
      inOffset: inOffset,
      inLength: inLength,
      outOffset: outOffset,
      outLength: outLength
    }

    if (!value.isZero()) {
      subGas(runState, new BN(fees.callValueTransferGas.v))
    }

    checkCallMemCost(runState, options, localOpts)
    checkOutOfGas(runState, options)

    if (!value.isZero()) {
      runState.gasLeft.iadd(new BN(fees.callStipend.v))
      options.gasLimit.iadd(new BN(fees.callStipend.v))
    }

    if (utils.isPrecompiled(toAddress)) {
      options.compiled = true
      options.code = runState._precompiled[toAddress.toString('hex')]
      makeCall(runState, options, localOpts, done)
    } else {
      stateManager.getContractCode(toAddress, function (err, code, compiled) {
        if (err) return done(err)
        options.code = code
        options.compiled = compiled
        makeCall(runState, options, localOpts, done)
      })
    }
  },
  DELEGATECALL: function (gas, toAddress, inOffset, inLength, outOffset, outLength, runState, done) {
    var stateManager = runState.stateManager
    var value = runState.callValue
    toAddress = toAddress.and(MASK_160).toArrayLike(Buffer, 'be', 20)
//    inOffset = inOffset.toNumber()
//    inLength = inLength.toNumber()
//    outOffset = outOffset.toNumber()
//    outLength = outLength.toNumber()

    const options = {
      gasLimit: gas,
      value: value,
      to: runState.address,
      caller: runState.caller,
      delegatecall: true
    }

    const localOpts = {
      inOffset: inOffset,
      inLength: inLength,
      outOffset: outOffset,
      outLength: outLength
    }

    checkCallMemCost(runState, options, localOpts)
    checkOutOfGas(runState, options)

    // load the code
    stateManager.getAccount(toAddress, function (err, account) {
      if (err) return done(err)
      if (utils.isPrecompiled(toAddress)) {
        options.compiled = true
        options.code = runState._precompiled[toAddress.toString('hex')]
        makeCall(runState, options, localOpts, done)
      } else {
        stateManager.getContractCode(toAddress, function (err, code, compiled) {
          if (err) return done(err)
          options.code = code
          options.compiled = compiled
          makeCall(runState, options, localOpts, done)
        })
      }
    })
  },
  RETURN: function (offset, length, runState) {
//    offset = offset.toNumber()
//    length = length.toNumber()
    runState.returnValue = memLoad(runState, offset, length)
  },
  // '0x70', range - other
  SELFDESTRUCT: function (selfdestructToAddress, runState, cb) {
    var stateManager = runState.stateManager
    var contract = runState.contract
    var contractAddress = runState.address
    var zeroBalance = new BN(0)
    selfdestructToAddress = utils.setLengthLeft(selfdestructToAddress, 20)

    stateManager.getAccount(selfdestructToAddress, function (err, toAccount) {
      // update balances
      if (err) {
        cb(err)
        return
      }

      stateManager.accountIsEmpty(selfdestructToAddress, function (error, empty) {
        if (error) {
          cb(error)
          return
        }

        if ((new BN(contract.balance)).gt(zeroBalance)) {
          if (!toAccount.exists || empty) {
            try {
              subGas(runState, new BN(fees.callNewAccountGas.v))
            } catch (e) {
              cb(e.error)
              return
            }
          }
        }

        // only add to refund if this is the first selfdestruct for the address
        if (!runState.selfdestruct[contractAddress.toString('hex')]) {
          runState.gasRefund = runState.gasRefund.add(new BN(fees.suicideRefundGas.v))
        }
        runState.selfdestruct[contractAddress.toString('hex')] = selfdestructToAddress
        runState.stopped = true

        var newBalance = new BN(contract.balance).add(new BN(toAccount.balance)).toArrayLike(Buffer)
        async.series([
          stateManager.putAccountBalance.bind(stateManager, selfdestructToAddress, newBalance),
          stateManager.putAccountBalance.bind(stateManager, contractAddress, new BN(0))
        ], function (err) {
          // The reason for this is to avoid sending an array of results
          cb(err)
        })
      })
    })
  }
}

module.exports._DC = module.exports.DELEGATECALL

function describeLocation (runState) {
  var hash = utils.sha3(runState.code).toString('hex')
  var address = runState.address.toString('hex')
  var pc = runState.programCounter - 1
  return hash + '/' + address + ':' + pc
}

function subGas (runState, amount) {
  runState.gasLeft.isub(amount)
  if (runState.gasLeft.cmpn(0) === -1) {
    trap(ERROR.OUT_OF_GAS)
  }
}

function trap (err) {
  function VmError (error) {
    this.error = error
  }
  throw new VmError(err)
}

/**
 * Subtracts the amount needed for memory usage from `runState.gasLeft`
 * @method subMemUsage
 * @param {BN} offset
 * @param {BN} length
 * @return {String}
 */
function subMemUsage (runState, offset, length) {
  //  abort if no usage
  if (!length) return

  const newMemoryWordCount = offset.add(length).divn(32)

  if (newMemoryWordCount.lte(runState.memoryWordCount)) return
  runState.memoryWordCount = newMemoryWordCount

  const words = newMemoryWordCount
  const fee = new BN(fees.memoryGas.v)
  const quadCoeff = new BN(fees.quadCoeffDiv.v)
  // words * 3 + words ^2 / 512
  const cost = words.mul(fee).add(words.mul(words).div(quadCoeff))

  if (cost.cmp(runState.highestMemCost) === 1) {
    subGas(runState, cost.sub(runState.highestMemCost))
    runState.highestMemCost = cost
  }
}

/**
 * Loads bytes from memory and returns them as a buffer. If an error occurs
 * a string is instead returned. The function also subtracts the amount of
 * gas need for memory expansion.
 * @method memLoad
 * @param {BN} offset where to start reading from
 * @param {BN} length how far to read
 * @return {Buffer|String}
 */
function memLoad (runState, offset, length) {
  // check to see if we have enougth gas for the mem read
  subMemUsage(runState, offset, length)

  offset = offset.toNumber()
  length = length.toNumber()

  var loaded = runState.memory.slice(offset, offset + length)
  // fill the remaining lenth with zeros
  for (var i = loaded.length; i < length; i++) {
    loaded.push(0)
  }
  return Buffer.from(loaded)
}

/**
 * Stores bytes to memory. If an error occurs a string is instead returned.
 * The function also subtracts the amount of gas need for memory expansion.
 * @method memStore
 * @param {BN} offset where to start reading from
 * @param {Buffer} val
 * @param {Number} valOffset
 * @param {BN} length how far to read
 * @param {Boolean} skipSubMem
 * @return {Buffer|String}
 */
function memStore (runState, offset, val, valOffset, length, skipSubMem) {
  if (skipSubMem !== false) {
    subMemUsage(runState, offset, length)
  }

  offset = offset.toNumber()
  length = length.toNumber()

  var valLength = Math.min(val.length, length)

  // read max possible from the value
  for (var i = 0; i < valLength; i++) {
    runState.memory[offset + i] = val[valOffset + i]
  }
}

// checks if a jump is valid given a destination
function jumpIsValid (runState, dest) {
  return runState.validJumps.indexOf(dest) !== -1
}

// checks to see if we have enough gas left for the memory reads and writes
// required by the CALLs
function checkCallMemCost (runState, callOptions, localOpts) {
  // calculates the gase need for reading the input from memory
  callOptions.data = memLoad(runState, localOpts.inOffset, localOpts.inLength)

  // calculates the gas need for saving the output in memory
  if (localOpts.outLength) {
    subMemUsage(runState, localOpts.outOffset, localOpts.outLength)
  }

  if (!callOptions.gasLimit) {
    callOptions.gasLimit = runState.gasLeft
  }
}

function checkOutOfGas (runState, callOptions) {
  const gasAllowed = runState.gasLeft.sub(runState.gasLeft.div(new BN(64)))
  if (callOptions.gasLimit.gt(gasAllowed)) {
    callOptions.gasLimit = gasAllowed
  }
}

// sets up and calls runCall
function makeCall (runState, callOptions, localOpts, cb) {
  callOptions.caller = callOptions.caller || runState.address
  callOptions.origin = runState.origin
  callOptions.gasPrice = runState.gasPrice
  callOptions.block = runState.block
  callOptions.populateCache = false
  callOptions.selfdestruct = runState.selfdestruct

  // increment the runState.depth
  callOptions.depth = runState.depth + 1

  // check if account has enough ether
  // Note: in the case of delegatecall, the value is persisted and doesn't need to be deducted again
  if (runState.depth >= fees.stackLimit.v || (callOptions.delegatecall !== true && new BN(runState.contract.balance).cmp(callOptions.value) === -1)) {
    runState.stack.push(new BN(0))
    cb()
  } else {
    // if creating a new contract then increament the nonce
    if (!callOptions.to) {
      runState.contract.nonce = new BN(runState.contract.nonce).addn(1)
    }

    runState.stateManager.cache.put(runState.address, runState.contract)
    runState._vm.runCall(callOptions, parseCallResults)
  }

  function parseCallResults (err, results) {
    // concat the runState.logs
    if (results.vm.logs) {
      runState.logs = runState.logs.concat(results.vm.logs)
    }

    // add gasRefund
    if (results.vm.gasRefund) {
      runState.gasRefund = runState.gasRefund.add(results.vm.gasRefund)
    }

    // this should always be safe
    runState.gasLeft.isub(results.gasUsed)

    if (!results.vm.exceptionError) {
      // save results to memory
      if (results.vm.return) {
        memStore(runState, localOpts.outOffset, results.vm.return, 0, localOpts.outLength, false)
      }

      // update stateRoot on current contract
      runState.stateManager.getAccount(runState.address, function (err, account) {
        runState.contract = account
        // push the created address to the stack
        if (results.createdAddress) {
          cb(err, new BN(results.createdAddress))
        } else {
          cb(err, new BN(results.vm.exception))
        }
      })
    } else {
      // creation failed so don't increament the nonce
      if (results.vm.createdAddress) {
        runState.contract.nonce = new BN(runState.contract.nonce).subn(1)
      }

      cb(err, new BN(results.vm.exception))
    }
  }
}
