/*!
 * Copyright 2022 Takuro Okada.
 * Released under the MIT License.
 */

const FileSystem = require("fs");
const Assert = require("assert/strict");

const LevelUp = require("levelup");
const LevelDown = require("leveldown");

let dir;
let limit = -1;
let verbose = false;
let txid;

if(process.argv.length > 2) {
    let arguments = process.argv;
    for(let i=2; i<arguments.length; i++) {
        let argument = arguments[i];
        if(argument.startsWith("--") && argument.length > 1) {
            let key = argument.substring(2);
            let value;
            if(i<arguments.length-1) {
                value = arguments[i+1];
                i++;
            }
            if(key == "dir") {
                dir = value;
            }
            if(key == "limit") {
                limit = Number(value);
            }
            if(key == "verbose") {
                verbose = value == "true";
            }
            if(key == "txid") {
                txid = value;
            }
        }
    }
}

if(dir == null) {
    console.log("usage: node data-viewer --dir <sourceDir>");
    process.exit(0);
}
Assert(FileSystem.existsSync(dir), "The dir does not exists.");

retrieveLevelDB(dir).then(blocks => {
    console.log("Block length", blocks.length);
    for(let block of blocks) {
        if(verbose) {
            console.log("Block:", block);
        }else {
            console.log("Block:", block.index);
            for(let transaction of block.transactions) {
                console.log("Transaction:", transaction.transactionId);
            }
        }
    }
}).catch(error => {
    console.error(error);
});

async function retrieveLevelDB(sourceDir) {
    return new Promise((resolve, reject) => {
        var levelDB = LevelUp(LevelDown(sourceDir));
        let stream = levelDB.createReadStream({reverse: true, limit: limit});
        let blocks = [];
        stream.on("data", data => {
            let block = data.value;
            if(block instanceof Buffer) {
                block = block.toString("utf8");
            }
            if(typeof block == "string") {
                block = JSON.parse(block, (key, value) => {
                    if(key == "index") {
                        return BigInt(value);
                    }
                    return value;
                });
            }
            if(txid != null) {
                if(block.transactions != null) {
                    let index = block.transactions.findIndex(transaction => {
                        return transaction.transactionId == txid;
                    });
                    if(index == -1) {
                        return;
                    }
                }
            }
            blocks.push(block);
        });
        stream.on("end", data => {
            resolve(blocks);
        });
        stream.on("error", error => {
            reject(error);
        });
    });
}
