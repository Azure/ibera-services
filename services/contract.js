'use strict';

var Web3 = require('web3');
var web3 = new Web3();
var util = require('util');
var abi = require('./abi');
var config = require('../config');

web3.setProvider(new Web3.providers.HttpProvider(config.GET_RPC_ENDPOINT));
var contractInstance = web3.eth.contract(abi).at(config.CONTRACT_ADDRESS);

var client = {};

// wrap following functions with a promise so that we can use it with the async convention
// and add it on the module.exports object
// TODO: auto generate from abi
[ 
  { name: 'getProof', method: 'call' },
  { name: 'storeProof', method: 'sendTransaction', event: 'StoreProofCompleted' },  
  { name: 'transfer', method: 'sendTransaction', event: 'TransferCompleted' }
]
  .forEach(func => {

    if (func.event) {

      // register to the function event listener
      contractInstance[func.event]((err, result) => {
        if (err) return console.error(`error in event listener '${func.event}': ${err.message}`);
        console.log(`got event result for '${func.event}': ${util.inspect(result)}`);
      });
    }

    client[func.name] = callContractFunc();
    client[`${func.name}GetPrice`] = callContractFunc(true);
    
    function callContractFunc(getPrice) {
      return function() {
        var args = arguments;
        return new Promise((resolve, reject) => {
          console.log(`executing function '${func.name}' with '${func.method}' call on contract with params ${util.inspect(args)}`);

          // callback for the function invoked
          var cb = (err, result) => {
            if (err) {
              console.error(`error executing function '${func.name}' on contract with params: ${util.inspect(args)}: ${err.message}`);
              return reject(err);
            }
            
            console.log(`function '${func.name}' on contract completed successfully`);

            if (getPrice) {
              return resolve({ price: result });
            }

            // wrap tx hash in an object
            if (func.method === 'sendTransaction') {
              console.log(`tx hash: ${result}`);
              result = { txHash: result };
            }

            return resolve(result);
          };

          // extract original params and add the callback to the list
          var params = Array.prototype.slice.call(args);
          params.push(cb);

          // invoke requested method on the contract
          // https://ethereum.stackexchange.com/questions/765/what-is-the-difference-between-a-transaction-and-a-call
          // TODO: in case of sendTransaction, we need to use Events to get the actual result after the transaction is mined
          // when using 'call' the result will be returned immediately. This is only for contant functions or such that do not change the state.
          var method = getPrice ? 'estimateGas' : func.method;
          return contractInstance[func.name][method].apply(contractInstance, params);
        });
      }
    }
});

var web3Personal = {};

[
  'unlockAccount',
  'lockAccount'
].forEach(func => {
  web3Personal[func] = async function() {
    return new Promise((resolve, reject) => {

      // callback for the function invoked
      var cb = (err, result) => {
        if (err) {
          console.error(`error executing function '${func}' on contract with params: ${util.inspect(arguments)}: ${err.message}`);
          return reject(err);
        }
        
        console.log(`function '${func}' on contract completed successfully with result: ${util.inspect(result)}`);
        return resolve(result);
      };

      var params = Array.prototype.slice.call(arguments);
      params.push(cb);

      return web3.personal[func].apply(web3.personal, params);
    });
  }
});

var api = {
  getProof: async (trackingId) => {
    try {
      var res = await client.getProof(trackingId);
    }
    catch(err) {
      console.error(`error getting proof from blockchain: ${err.message}`);
      throw err;
    }

    res = {
      owner: res[0],
      encryptedProof: res[1],
      publicProof: res[2],
      previousTrackingId: res[3]
    };

    // proof does not exist
    if (!res.encryptedProof) {
     return null;
    }

    return res;
  },

  storeProof: async (opts) => {
    try {
      var unlockRes = await web3Personal.unlockAccount(opts.config.from, opts.config.password);
      if (!unlockRes) {
        throw new Error(`error unlocking account: ${opts.config.from}`);
      }
      
      var storeProofPrice = await client.storeProofGetPrice(opts.trackingId, opts.previousTrackinId, opts.encryptedProof, opts.publicProof, opts.config);
      opts.config.gas = storeProofPrice.price * 2;
      var res = await client.storeProof(opts.trackingId, opts.previousTrackinId, opts.encryptedProof, opts.publicProof, opts.config);
      /*
      var lockRes = await web3Personal.lockAccount(opts.config.from, opts.config.password);
      if (!lockRes) {
        throw new Error(`error locking account: ${opts.config.from}`);
      }
      */
    }
    catch(err) {
      console.error(`error getting proof from blockchain: ${err.message}`);
      throw err;
    }

    return res;
  },


  transfer: async (opts) => {
    try {
      var unlockRes = await web3Personal.unlockAccount(opts.config.from, opts.config.password);
      if (!unlockRes) {
        throw new Error(`error unlocking account: ${opts.config.from}`);
      }
      
      var transferPrice = await client.transferGetPrice(opts.trackingId, opts.transferTo,  opts.config);
      opts.config.gas = transferPrice.price;

      var res = await client.transfer(opts.trackingId, opts.transferTo,  opts.config);

      var lockRes = await web3Personal.lockAccount(opts.config.from, opts.config.password);
      if (!lockRes) {
        throw new Error(`error locking account: ${opts.config.from}`);
      }
    }
    catch(err) {
      console.error(`error getting proof from blockchain: ${err.message}`);
      throw err;
    }

    return res;
  },

  web3,
  web3Personal
};

module.exports = api;