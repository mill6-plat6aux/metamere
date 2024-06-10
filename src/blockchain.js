/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

/**
 * @typedef { import("./storage/simple") } SimpleStorage
 * @typedef { import("./storage/leveldb") } LevelDBStorage
 */

/**
 * @typedef { import("../types/block").Block } Block
 */

const Crypto = require("crypto");
const AsyncLock = require("async-lock");
const { serialize } = require("./util/serializer");

class Blockchain {
    /**
     * @type {string}
     */
    #version;

    /**
     * @type {Array<Object>}
     */
    #transactions = [];

    /**
     * @type {LevelDBStorage|SimpleStorage}
     */
    #storage;

    #lock = new AsyncLock();

    /**
     * @param {string} version Block format version
     * @param {"LevelDB"|"Simple"} storage
     * @param {string} storagePath
     * @param {Array<string>} indexKeys
     */
    constructor(version, storage, storagePath, indexKeys) {
        this.#version = version;

        if(storagePath == null) {
            storagePath = "./blocks"
        }

        let Storage;
        if(storage == "LevelDB") {
            Storage = require("./storage/leveldb");
        }else {
            Storage = require("./storage/simple");
        }
        this.#storage = new Storage(storagePath, indexKeys);
    }

    /**
     * @typedef {Object} TransactionCondition
     * @property {"and"|"or"|"between"} [operation]
     * @property {boolean} [ambiguous]
     * @property {Object} conditions
     * @example { conditions: { transactionId: "95c8608a-1445-4386-84e9-aace0314f9ac" }}
     *          { operation: "or", conditions: { recipientCompanyId: 1, inspectionCompanyId: 1 }}
     *          { operation: "between", conditions: { tradingDate: {begin: 1638284400000, end: 1638284400000 }}}
     */

    /**
     * @param {object} request 
     * @param {"forward"|"backward"} request.direction 
     * @param {number} [request.offset] 
     * @param {number} [request.limit] 
     * @param {number} [request.timestampStart]
     * @param {number} [request.timestampEnd]
     * @param {boolean} [request.headerOnly]
     * @param {TransactionCondition|?Array<TransactionCondition>} [request.transactionCondition] 
     * @returns {Promise<Array<Block>>}
     */
    async getBlocks(request) {
        return await this.#storage.restoreBlocks(request);
    }

    /**
     * @param {bigint} index 
     * @returns {Promise<?Block>}
     */
    async getBlock(index) {
        if(index == null || typeof(index) != "bigint") return null;
        return await this.#storage.restoreBlock(index);
    }

    /**
     * @param {Array<Block>} newValue
     * @returns {Promise}
     * @throws {Error}
     */
    async setBlocks(newValue) {
        if(newValue == null) return;
        if(!Array.isArray(newValue)) return;
        return this.#lock.acquire("storage", async done => {
            let lastIndex = await this.#storage.getLastIndex();
            let blocks = newValue.filter(block => {
                return block.index > lastIndex;
            });
            if(blocks.length == 0) {
                done();
                return;
            }
            try {
                await this.#storeBlocks(blocks);
            }catch(error) {
                throw new Error("failed to syncronize blocks. "+error.message);
            }
            done();
        });
    }

    /**
     * @returns {Array<object>}
     */
    get transactions() {
        return this.#transactions;
    }

    /**
     * @typedef {Object} Transaction
     * @property {string} transactionId
     * @property {Array<Transaction>} elements
     */

    /**
     * @param {Transaction} transaction 
     */
    addTransaction(transaction) {
        if(transaction == null) return;
        if(typeof(transaction) !== "object") return;
        if(this.#transactions.includes(transaction)) return;
        this.#transactions.push(transaction);
    }

    /**
     * Generate genesis block.
     * @returns {Promise<Block|null>}
     */
    async generateGenesisBlock() {
        let prevHash = "";
        let hash = "1183f7f0cb6243e92d5e4ba2fb626b02bca27ffe89c77dcbd7003167405da253";
        let nonce = this.#findNonce(prevHash, hash);
        let currentHash = this.#generateHash(nonce, prevHash, hash);
        return await this.#createBlock(0n, nonce, prevHash, currentHash);
    }

    /**
     * @typedef {Object} ProofOfWork
     * @property {number} index
     * @property {string} rootHash
     * @property {number} nonce
     */

    /**
     * Get proof-of-work
     * @returns {Promise<ProofOfWork|null>} result proof-of-work (null if transaction being processed is not registered)
     */
    async getProofOfWork() {
        if(this.#transactions == null || this.#transactions.length == 0) return null;
        return this.#lock.acquire("storage", async done => {
            let lastIndex = await this.#storage.getLastIndex();
            let rootHash = this.#getRootHash(this.#transactions);
            if(rootHash == null) { done(undefined); return };
            let lastBlock = await this.#storage.restoreBlock(lastIndex);
            let lastHash = lastBlock.hash;
            let nonce = this.#findNonce(lastHash, rootHash);
            done(undefined, {index: lastIndex+1n, rootHash: rootHash, nonce: nonce});
        });
    }

    /**
     * Use proof-of-work to finalize the block.
     * @param {bigint} index 
     * @param {string} rootHash 
     * @param {number} nonce 
     * @returns {Promise}
     * @throws {Error}
     */
    async commitProofOfWork(index, rootHash, nonce) {
        if(index == null || rootHash == null || nonce == null) return;
        if(typeof index != "number" || typeof rootHash != "string" || typeof nonce != "number") return;
        if(this.#transactions == null || this.#transactions.length == 0) return;
        return this.#lock.acquire("storage", async done => {
            let lastIndex = await this.#storage.getLastIndex();
            if(index <= lastIndex) {
                done();
                return;
            }
            if(rootHash !== this.#getRootHash(this.#transactions)) {
                done(new Error("Route Hash does not match."));
            }
            let lastBlock = await this.#storage.restoreBlock(lastIndex);
            let lastHash = lastBlock.hash;
            let hash = this.#generateHash(nonce, lastHash, rootHash);
            if(!hash.startsWith("0000")) {
                done(new Error("Invalid hash value."));
            }
            let block = await this.#createBlock(index, nonce, lastHash, hash);
            done(undefined, block);
        });
    }

    /**
     * @returns {Promise<Block|null>}
     */
    async commitBlock() {
        if(this.#transactions == null || this.#transactions.length == 0) return null;

        return this.#lock.acquire("storage", async done => {
            let lastIndex = await this.#storage.getLastIndex();
            let rootHash = this.#getRootHash(this.#transactions);
            let lastBlock = await this.#storage.restoreBlock(lastIndex);
            let lastHash = lastBlock.hash;
            let nonce = 0;

            if(lastIndex == null) {
                done(new Error("failed to acquire the last block index."));
                return;
            }

            let index = lastIndex+1n;

            if(rootHash == null) {
                done(new Error("failed to acquire the root hash."));
                return;
            }

            let hash = this.#generateHash(nonce, lastHash, rootHash);

            let block = await this.#createBlock(index, nonce, lastHash, hash);
            done(undefined, block);
        });
    }
    
    /**
     * @param {bigint} index 
     * @param {number} nonce 
     * @param {string} prevHash 
     * @param {string} hash 
     * @returns {Promise<Block|null>}
     */
    async #createBlock(index, nonce, prevHash, hash) {
        if(index == null || nonce == null || prevHash == null || hash == null) return null;
        if(typeof(index) !== "bigint" || typeof(nonce) !== "number" || typeof(prevHash) !== "string" || typeof(hash) !== "string") return null;
        let block = {
            version: this.#version,
            index: index, 
            timestamp: Date.now(), 
            nonce: nonce,
            prevHash: prevHash,
            hash: hash,
            transactions: this.#transactions
        };
        this.#transactions = [];
        await this.#storage.storeBlock(block);
        return block;
    }

    /**
     * @param {string} prevHash 
     * @param {string} currentHash 
     * @returns {number} nonce
     */
    #findNonce(prevHash, currentHash) {
        let nonce = -1;
        let hash;
        do {
            hash = this.#generateHash(++nonce, prevHash, currentHash);
        } while(hash.substring(0, 4) != "0000");
        return nonce;
    }

    /**
     * Generate hash from NONCE, previous hash, and current hash.
     * @param {number} nonce 
     * @param {string} prevHash 
     * @param {string} currentHash 
     * @returns {string} hash
     */
    #generateHash(nonce, prevHash, currentHash) {
        let string = prevHash + nonce.toString() + currentHash;
        return Crypto.createHash("sha256").update(string, "utf8").digest("hex");
    }

    /**
     * Generate a transaction's Markel tree and obtain the hash value of the root element.
     * @param {Array<object>} transactions
     * @returns {string|null} Root hash value
     */
    #getRootHash(transactions) {
        if(transactions == null || transactions.length == 0) return null;
        let hashList = transactions.map((entry) => {
            return Crypto.createHash("sha256").update(serialize(entry), "utf8").digest("hex");
        });
        function findRoot(list) {
            if(list.length == 1) return list[0];
            let newlist = list.reduce((result, entry, index, array) => {
                if(index%2 == 0) {
                    result.push(entry);
                }else {
                    let prevHash = result[result.length-1];
                    let hash = Crypto.createHash("sha256").update(prevHash+entry, "utf8").digest("hex");
                    result[result.length-1] = hash;
                }
                return result;
            }, []);
            return findRoot(newlist);
        }
        return findRoot(hashList);
    }

    /**
     * @param {Array<Block>} blocks 
     */
    async #storeBlocks(blocks) {
        if(blocks == null) return;
        if(!Array.isArray(blocks)) return;
        await this.#validateBlocks(blocks);
        return Promise.all(blocks.map(block => this.#storage.storeBlock(block)));
    }

    /**
     * @param {Array<Block>} blocks 
     * @returns {Promise} 
     * @throws {Error}
     */
    async #validateBlocks(blocks) {
        let lastIndex = await this.#storage.getLastIndex();
        if(lastIndex == -1n) return true;
        let lastBlock = await this.#storage.restoreBlock(lastIndex);
        let lastPrevHash = lastBlock.hash;
        let currentIndex = lastIndex;
        for(let block of blocks) {
            let version = block.version;
            let index = block.index;
            let timestamp = block.timestamp;
            let nonce = block.nonce;
            let prevHash = block.prevHash;
            let hash = block.hash;
            let transactions = block.transactions;
            if(version == null || index == null || timestamp == null || nonce == null || prevHash == null || transactions == null) {
                throw new Error("Incomplete block data. Block index: "+index);
            }
            if(index !== currentIndex+1n) {
                throw new Error("The index is not continuous. Block index: "+index+", Previous index"+currentIndex);
            }
            let rootHash = this.#getRootHash(transactions);
            if(rootHash == null) throw new Error("Invalid rootHash value. Block index: "+index);
            let generatedHash = this.#generateHash(nonce, prevHash, rootHash);
            if(generatedHash == null || generatedHash !== hash) {
                throw new Error("Invalid hash value. Block index: "+index);
            }
            if(lastPrevHash !== prevHash) {
                throw new Error("The hash value is not continuous. Block index: "+index);
            }
            currentIndex += 1n;
            lastPrevHash = hash;
        }
    }

    terminate() {
        if(this.#storage == null) return;
        this.#storage.terminate();
    }
}

module.exports = Blockchain;