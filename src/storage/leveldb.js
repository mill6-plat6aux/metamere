/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

/**
 * @typedef { import("../../types/storage").Storage } Storage
 */

const LevelUp = require("levelup");
const LevelDown = require("leveldown");
const FileSystem = require("fs");
const AsyncLock = require("async-lock");
const { toBufferBE, toBigIntBE } = require("bigint-buffer");
const { serialize, deserialize } = require("../util/serializer");

/**
 * @implements {Storage}
 */
class LevelDBStorage {

    /**
     * @type {LevelUp}
     */
    #storage;

    /**
     * @type {Map<string, LevelUp>}
     */
    #indexStorages;

    #lock = new AsyncLock();

    constructor(storagePath, indexKeys) {
        if(storagePath == null) {
            storagePath = "./blocks"
        }
        let mainStoragePath = storagePath+"/main";

        function loadStorage(storagePath) {
            if(!FileSystem.existsSync(storagePath)) {
                FileSystem.mkdirSync(storagePath, {recursive: true});
            }
            return LevelUp(LevelDown(storagePath));
        }

        this.#storage = loadStorage(mainStoragePath);

        if(indexKeys != null && Array.isArray(indexKeys)) {
            let map = new Map();
            indexKeys.forEach(indexKey => {
                let storage = loadStorage(storagePath+"/"+indexKey);
                map.set(indexKey, storage);
            });
            this.#indexStorages = map;
        }
    }

    async storeBlock(block) {
        if(block.index == null) return;

        let self = this;
        return this.#lock.acquire("storage", async done => {
            // Generate index
            let indexStorages = this.#indexStorages;
            if(indexStorages != null) {
                let indexKeys = Array.from(indexStorages.keys());
                if(block.transactions != null) {
                    for(let transaction of block.transactions) {
                        for(let indexKey of indexKeys) {
                            let indexStorage = indexStorages.get(indexKey);
                            let indexValue = transaction[indexKey];
                            if(indexValue == null) continue;
                            if(typeof indexValue != "string") {
                                indexValue = indexValue.toString();
                            }
                            let indexes = await self.#getIndexedBlockIndexes(indexStorage, indexValue);
                            if(!indexes.includes(block.index)) {
                                indexes.push(block.index);
                            }
                            await self.#putIndexedBlockIndexes(indexStorage, indexValue, indexes);
                        }
                    }
                }
            }

            let index = this.#keyFromIndex(block.index);
            let data = block;
            if(typeof data == "object") {
                data = serialize(data);
            }
            this.#storage.put(index, data, error => {
                done(error, null);
            });
        });
    }

    async restoreBlock(index) {
        index = this.#keyFromIndex(index);
        return new Promise((resolve, reject) => {
            this.#storage.get(index, (error, value) => {
                if(error != null) { 
                    if(error.notFound) {
                        resolve(null);
                    }else {
                        reject(error);
                    }
                    return;
                }
                let data = value;
                if(value instanceof Buffer) {
                    data = value.toString("utf8");
                }
                if(typeof data == "string") {
                    data = deserialize(data);
                }
                resolve(data);
            });
        });
    }

    async getIndexes(limit, direction) {
        limit = limit == undefined ? -1 : limit;
        return new Promise((resolve, reject) => {
            let stream = this.#storage.createKeyStream({reverse: direction == "backward", limit: limit});
            let buffer = [];
            stream.on("data", data => {
                buffer.push(this.#indexFromKey(data));
            });
            stream.on("end", data => {
                resolve(buffer);
            });
            stream.on("error", error => {
                reject(error);
            });
        });
    }

    async getLastIndex() {
        return new Promise((resolve, reject) => {
            this.getIndexes(1, "backward").then(result => {
                resolve(result.length == 1 ? result[0] : -1n);
            }).catch(error => {
                reject(error);
            });
        });
    }

    async restoreBlocks(query) {
        let reverse = true;
        let offset = 0;
        let limit = -1;
        let timestampStart;
        let timestampEnd;
        let headerOnly = false;
        let transactionCondition;
        if(query != null && typeof(query) == "object") {
            if(query.direction != null && (query.direction === "forward" || query.direction === "backward")) {
                reverse = query.direction == "backward";
            }
            if(query.offset != null && typeof(query.offset) == "number" && query.offset > 0) {
                offset = query.offset;
            }
            if(query.limit != null && typeof(query.limit) == "number" && query.limit > 0) {
                limit = query.limit;
            }
            if(query.timestampStart != null && typeof(query.timestampStart) == "number" && query.timestampStart > 0) {
                timestampStart = query.timestampStart;
            }
            if(query.timestampEnd != null && typeof(query.timestampEnd) == "number" && query.timestampEnd > 0) {
                timestampEnd = query.timestampEnd;
            }
            if(query.headerOnly != null && typeof(query.headerOnly) == "boolean") {
                headerOnly = query.headerOnly;
            }
            if(query.transactionCondition != null && typeof(query.transactionCondition) == "object") {
                transactionCondition = query.transactionCondition;
            }
        }

        if(this.#indexStorages != null && transactionCondition != null) {
            let indexStorages = this.#indexStorages;
            
            let enabled = true;
            if(Array.isArray(transactionCondition)) {
                transactionCondition.forEach(entry => {
                    let operation = entry.operation;
                    if(operation != null && operation == "between") {
                        enabled = false;
                        return;
                    }
                    let conditions = entry.conditions;
                    if(conditions != null) {
                        let keys = Object.keys(conditions);
                        keys.forEach(key => {
                            if(indexStorages.get(key) == null) {
                                enabled = false;
                            }
                        });
                    }
                });
            }else {
                let operation = transactionCondition.operation;
                if(operation != null && operation == "between") {
                    enabled = false;
                }
                let conditions = transactionCondition.conditions;
                if(conditions != null) {
                    let keys = Object.keys(conditions);
                    keys.forEach(key => {
                        if(indexStorages.get(key) == null) {
                            enabled = false;
                        }
                    });
                }
            }
            if(enabled) {
                return await this.#restoreBlocksWithIndexes(reverse, offset, limit, timestampStart, timestampEnd, headerOnly, transactionCondition);
            }
        }

        return await this.#restoreBlocksSerially(reverse, offset, limit, timestampStart, timestampEnd, headerOnly, transactionCondition);
    }

    /**
     * @param {boolean} reverse 
     * @param {number} offset 
     * @param {number} limit 
     * @param {number} [timestampStart]
     * @param {number} [timestampEnd]
     * @param {boolean} headerOnly 
     * @param {Array<TransactionCondition>|TransactionCondition} transactionCondition 
     * @returns {Promise<Array<Block>>}
     */
    async #restoreBlocksWithIndexes(reverse, offset, limit, timestampStart, timestampEnd, headerOnly, transactionCondition) {
        let indexStorages = this.#indexStorages;

        /**
         * @param {LevelDBStorage} self 
         * @param {Array<bigint>} blockIndexes 
         * @returns {Promise<Array<bigint>>}
         */
        async function retrieveBlocks(self, blockIndexes) {
            return new Promise((resolve, reject) => {
                self.#storage.getMany(blockIndexes.map(blockIndex => self.#keyFromIndex(blockIndex)), (error, results) => {
                    if(error != null) {
                        reject(error);
                        return;
                    }
                    resolve(results.filter(result => result != null).map(result => deserialize(result)));
                });
            });
        }

        /**
         * @param {LevelDBStorage} self 
         * @param {TransactionCondition} conditions 
         * @param {number} timestampStart 
         * @param {number} timestampEnd 
         * @returns {Promise<Array<Block>>}
         */
        async function restoreBlocksWithIndexes(self, conditions, timestampStart, timestampEnd) {
            let blocks = [];
            let keys = Object.keys(conditions);
            for(let key of keys) {
                let value = conditions[key];
                if(typeof value != "string") {
                    value = value.toString();
                }
                if(value.length == 0) continue;
                let indexStorage = indexStorages.get(key);
                let blockIndexes = await self.#getIndexedBlockIndexes(indexStorage, value);
                if(blockIndexes.length < 1) continue;
                let _blocks = await retrieveBlocks(self, blockIndexes);
                if(timestampStart != null || timestampEnd != null) {
                    _blocks = _blocks.filter(block => {
                        if(timestampStart != null) {
                            if(block.timestamp < timestampStart) {
                                return false;
                            }
                        }
                        if(timestampEnd != null) {
                            if(block.timestamp > timestampEnd) {
                                return false;
                            }
                        }
                        return true;
                    });
                }
                _blocks.forEach(block => {
                    if(block.transactions == null || block.transactions.length == 0) return;
                    let index = blocks.findIndex(_block => {
                        return _block.index == block.index;
                    });
                    if(index == -1) {
                        blocks.push(block);
                    }
                });
            }
            return blocks;
        }

        return this.#lock.acquire("storage", async done => {
            let blocks = [];
            if(Array.isArray(transactionCondition)) {
                for(let entry of transactionCondition) {
                    let _blocks = await restoreBlocksWithIndexes(this, entry.conditions, timestampStart, timestampEnd);
                    for(let block of _blocks) {
                        blocks.push(block);
                    }
                }
            }else {
                blocks = await restoreBlocksWithIndexes(this, transactionCondition.conditions, timestampStart, timestampEnd);
            }
    
            blocks.forEach(block => {
                block.transactions = this.#filterTransactions(block.transactions, transactionCondition);
            });
    
            if(reverse) {
                blocks.sort((block1, block2) => {
                    return block1.index < block2.index ? 1 : (block1.index > block2.index ? -1 : 0);
                });
            }else {
                blocks.sort((block1, block2) => {
                    return block1.index < block2.index ? -1 : (block1.index > block2.index ? 1 : 0);
                });
            }

            if(limit != -1) {
                blocks.splice(limit, blocks.length-limit);
            }

            if(headerOnly) {
                blocks = blocks.map(block => {
                    return {
                        index: block.index,
                        timestamp: block.timestamp,
                        transactionCount: block.transactions.length
                    };
                });
            }

            done(null, blocks);
        });
    }

    /**
     * @param {boolean} reverse 
     * @param {number} offset 
     * @param {number} limit 
     * @param {number} [timestampStart]
     * @param {number} [timestampEnd]
     * @param {boolean} headerOnly 
     * @param {Array<TransactionCondition>|TransactionCondition} transactionCondition 
     * @returns {Promise<Array<Block>>}
     */
    async #restoreBlocksSerially(reverse, offset, limit, timestampStart, timestampEnd, headerOnly, transactionCondition) {
        var self = this;
        return new Promise((resolve, reject) => {
            let stream = self.#storage.createReadStream({reverse: reverse, limit: limit});
            let result = [];
            let transactionCount = 0;
            let finished = false;
            stream.on("data", data => {
                if(finished) return;
                
                let index = self.#indexFromKey(data.key);
                if(index == 0n) return;

                let block = data.value;
                if(block instanceof Buffer) {
                    block = block.toString("utf8");
                }
                if(typeof block == "string") {
                    block = deserialize(block);
                }

                if(timestampStart != null) {
                    if(block.timestamp < timestampStart) {
                        return;
                    }
                }
                if(timestampEnd != null) {
                    if(block.timestamp > timestampEnd) {
                        return;
                    }
                }

                if(transactionCondition != null) {
                    let transactions = self.#filterTransactions(block.transactions, transactionCondition);
                    if(transactions.length == 0) return;
                    block.transactions = transactions;
                }
                if(headerOnly) {
                    block = {
                        index: block.index,
                        timestamp: block.timestamp,
                        transactionCount: block.transactions.length
                    };
                }

                if(transactionCount + block.transactions.length < offset) {
                    block.transactions.splice()
                }
                transactionCount += block.transactions.length;
                if(transactionCount > limit) {
                    block.transactions.splice()
                }

                result.push(block);
            });
            stream.on("end", data => {
                resolve(result);
            });
            stream.on("error", error => {
                reject(error);
            });
        });
    }

    /**
     * @param {Array<Transaction>} transactions 
     * @param {Array<TransactionCondition>|TransactionCondition}} transactionCondition 
     * @returns {Primise<Array<Transaction>>}
     */
    #filterTransactions(transactions, transactionCondition) {
        function _filterTransactions(transactions, transactionCondition) {
            let conditions = transactionCondition.conditions;
            if(conditions == null) {
                return transactions;
            }
            let disjunction = true;
            let between = false;
            if(transactionCondition.operation != null) {
                if(transactionCondition.operation == "and") {
                    disjunction = false;
                }else if(transactionCondition.operation == "between") {
                    disjunction = false;
                    between = true;
                    let keys = Object.keys(conditions);
                    for(let key of keys) {
                        let value = conditions[key];
                        if(typeof value == "object") {
                            if(value.begin == null || value.end == null || value.begin > value.end) {
                                delete conditions[key];
                            }
                        }else {
                            delete conditions[key];
                        }
                    }
                }
            }
            let ambiguous = transactionCondition.ambiguous != null && transactionCondition.ambiguous;
            let keys = Object.keys(conditions);
            return transactions.filter(entry => {
                if(between) {
                    let valid = true;
                    for(let key of keys) {
                        if(entry[key] == null || entry[key] < conditions[key].begin || entry[key] > conditions[key].end) {
                            valid = false;
                            break;
                        }
                    }
                    return valid;
                }else {
                    let valid = disjunction ? false : true;
                    for(let key of keys) {
                        if(ambiguous) {
                            if(entry[key].includes(conditions[key])) {
                                valid = disjunction ? true : false;
                                break;
                            }
                        }else {
                            if(entry[key] === conditions[key]) {
                                valid = disjunction ? true : false;
                                break;
                            }
                        }
                    }
                    return valid;
                }
            });
        }

        if(Array.isArray(transactionCondition)) {
            transactionCondition.forEach(entry => {
                transactions = _filterTransactions(transactions, entry);
            });
            return transactions;
        }else {
            return _filterTransactions(transactions, transactionCondition);
        }
    }

    /**
     * Convert block number to key
     * @param {bigint} index 
     * @returns {Buffer}
     */
    #keyFromIndex(index) {
        return toBufferBE(index, 8);
    }

    /**
     * Convert key to block number
     * @param {Buffer} data 
     * @returns {bigint}
     */
    #indexFromKey(data) {
        return toBigIntBE(data);
    }

    /**
     * Restore a list of block numbers from index storage
     * @param {LevelUp} indexStorage 
     * @param {string} indexValue 
     * @returns {Promise<Array<bigint>>}
     */
    async #getIndexedBlockIndexes(indexStorage, indexValue) {
        return new Promise((resolve, reject) => {
            indexStorage.get(indexValue, (error, value) => {
                if(error != null) { 
                    if(error.notFound) {
                        resolve([]);
                    }else {
                        reject(error);
                    }
                    return;
                }
                if(value instanceof Buffer) {
                    value = value.toString("utf8");
                }
                let blockIndexes = deserialize(value);
                resolve(blockIndexes);
            });
        });
    }

    /**
     * Persist a list of block numbers in index storage
     * @param {LevelUp} indexStorage 
     * @param {string} indexValue Data to be indexed
     * @param {Array<bigint>} blockIndexes Block number (key value for main storage)
     * @returns {Promise}
     */
    async #putIndexedBlockIndexes(indexStorage, indexValue, blockIndexes) {
        return new Promise((resolve, reject) => {
            indexStorage.put(indexValue, serialize(blockIndexes), error => {
                if(error != null) { 
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    terminate() {
        if(this.#storage != null) {
            this.#storage.close();
        }
        if(this.#indexStorages != null) {
            let indexKeys = this.#indexStorages.keys();
            for(let indexKey of indexKeys) {
                this.#indexStorages.get(indexKey).close();
            }
        }
    }
}

module.exports = LevelDBStorage;