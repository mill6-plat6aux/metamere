/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

/**
 * @typedef { import("../../types/storage").Storage } Storage
 */

const Crypto = require("crypto");
const FileSystem = require("fs");
const zlib = require("zlib");
const { serialize, deserialize } = require("../util/serializer");

const ENCRYPTION_KEY = FileSystem.readFileSync("./settings/simpleStorage/key");

/**
 * @implements {Storage}
 */
class SimpleStorage {

    #storagePath;

    constructor(storagePath) {
        this.#storagePath = storagePath;
        if(!FileSystem.existsSync(storagePath)) {
            FileSystem.mkdirSync(storagePath, {recursive: true});
        }
    }

    async storeBlock(block) {
        if(block.index == null) return;
        let index = block.index;
        let data = this.#encrypt(block);
        if(data == null) return;
        data = zlib.brotliCompressSync(data);
        let storagePath = this.#storagePath;
        return new Promise((resolve, reject) => {
            FileSystem.writeFile(storagePath+"/"+index.toString()+".br", data, error => {
                if(error != null) { reject(error); return; }
                resolve(null);
            });
        });
    }

    async restoreBlock(index) {
        let storagePath = this.#storagePath;
        return new Promise((resolve, reject) => {
            if(!FileSystem.existsSync(storagePath+"/"+index.toString()+".br")) {
                return resolve(null);
            }
            FileSystem.readFile(storagePath+"/"+index.toString()+".br", (error, data) => {
                if(error != null) { reject(error); return; }
                data = zlib.brotliDecompressSync(data);
                resolve(this.#decrypt(data, index));
            });
        });
    }

    async getIndexes(limit, direction) {
        let storagePath = this.#storagePath;
        return new Promise((resolve, reject) => {
            FileSystem.readdir(storagePath, (error, files) => {
                if(error != null) { reject(error); return; }
                if(files.length == 0) {
                    resolve([]);
                    return;
                }
                let indexes = files.filter(entry => {
                    return entry.endsWith(".br");
                }).map(entry => BigInt(entry.substring(0, entry.length-3))).sort((a, b) => a < b ? -1 : (a > b ? 1 : 0));
                if(direction == "backward") {
                    indexes = indexes.reverse();
                }
                resolve(indexes);
            });
        });
    }

    async getLastIndex() {
        let storagePath = this.#storagePath;
        return new Promise((resolve, reject) => {
            FileSystem.readdir(storagePath, (error, files) => {
                if(error != null) { reject(error); return; }
                if(files.length == 0) {
                    resolve(-1);
                    return;
                }
                let index = files.reduce((result, entry) => {
                    if(entry.endsWith(".br")) {
                        let index = BigInt(entry.substring(0, entry.length-3));
                        return index > result ? index : result;
                    }
                    return result;
                }, -1n);
                resolve(index != -1n ? index : null);
            });
        });
    }

    async restoreBlocks(query) {
        let direction = "backward";
        let limit;
        let headerOnly = false;
        let transactionCondition;
        if(query != null && typeof(query) == "object") {
            if(query.direction != null && (query.direction === "forward" || query.direction === "backward")) {
                direction = query.direction;
            }
            if(query.limit != null && typeof(query.limit) == "number" && query.limit > 0) {
                limit = query.limit;
            }
            if(query.headerOnly != null && typeof(query.headerOnly) == "boolean") {
                headerOnly = query.headerOnly;
            }
            if(query.transactionCondition != null && typeof(query.transactionCondition) == "object") {
                transactionCondition = query.transactionCondition;
            }
        }
        let indexes = await this.getIndexes(limit, direction);

        function filterTransactions(transactions, transactionCondition) {
            if(Array.isArray(transactionCondition)) {
                transactionCondition.forEach(entry => {
                    transactions = _filterTransactions(transactions, entry);
                });
                return transactions;
            }else {
                return _filterTransactions(transactions, transactionCondition);
            }
        }
        
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

        let result = [];
        for(let index of indexes) {
            if(index == 0) continue;
            let block = await this.restoreBlock(index);
            if(transactionCondition != null) {
                let transactions = filterTransactions(block.transactions, transactionCondition);
                if(transactions.length == 0) continue;
                block.transactions = transactions;
            }
            if(headerOnly) {
                block = {
                    index: block.index,
                    timestamp: block.timestamp,
                    transactionCount: block.transactions.length
                };
            }
            result.push(block);
            if(limit != null && result.length == limit) {
                break;
            }
        }
        return result;
    }

    #encrypt(block) {
        if(block == null) return;
        let expression = serialize(block);

        let key = Crypto.createHash("sha256");
        key.update(ENCRYPTION_KEY);
        let _key = key.digest();
    
        let iv = Crypto.createHash("md5");
        if(block.index != null) {
            iv.update(String(block.index));
        }
        let _iv = iv.digest();
    
        let cipher = Crypto.createCipheriv("aes-256-cbc", _key, _iv);
        return Buffer.concat([cipher.update(expression, "utf8"), cipher.final()]);
    }
    
    #decrypt(data, index) {
        let key = Crypto.createHash("sha256");
        key.update(ENCRYPTION_KEY);
        let _key = key.digest();
    
        let iv = Crypto.createHash("md5");
        iv.update(String(index));
        let _iv = iv.digest();
    
        let decipher = Crypto.createDecipheriv("aes-256-cbc", _key, _iv);
        let expression = decipher.update(data, undefined, "utf8") + decipher.final("utf8");

        return deserialize(expression);
    }
    
    terminate() {
    }
}

module.exports = SimpleStorage;
