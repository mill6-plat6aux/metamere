/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const BlockchainServer = require("../server");
const { Logger } = require("../util/logger");

/**
 * Implementation of "Proof Of Work"
 */
class Pow extends BlockchainServer {

    #logger = new Logger("PoW");

    /** @type {NodeJS.Timeout | null} */
    #intervalId;

    constructor(settings) {
        super(settings);
    }

    startConsensus() {
        let consensusInterval = 60 * 1000;
        if(this.settings.consensusInterval != undefined) {
            consensusInterval = this.settings.consensusInterval;
        }

        let self = this;

        // Attempt block generation
        this.#intervalId = setInterval(() => {
            if(self.terminated) return;

            if(self.processingConsensus) {
                this.#logger.writeLog("Already in process.");
                return;
            }
            self.processingConsensus = true;

            // Discard old transaction backlogs
            if(self.transactionBacklog.length > 0) {
                let transactionBacklog = [];
                let current = new Date().getTime();
                self.transactionBacklog.forEach(transaction => {
                    if(transaction["@temp"] != null) {
                        if(current - transaction["@temp"] < 30*60*1000) {
                            transactionBacklog.push(transaction);
                        }
                    }else {
                        transactionBacklog.push(transaction);
                    }
                });
                self.transactionBacklog = transactionBacklog;
            }

            if(self.blockchain.transactions == null || self.blockchain.transactions.length == 0) return;

            this.#logger.writeLog("started the consensus.");

            let beginTime = new Date();
            beginTime.setMilliseconds(beginTime.getMilliseconds()+300);
            self.broadcast({command: "startPow", data: {beginTime: beginTime.getTime()}});

            new Promise((resolve, reject) => {
                let delay = beginTime.getTime() - new Date().getTime();
                if(delay < 0) {
                    delay = 0;
                }
                setTimeout(async () => {
                    this.#logger.writeLog("started to calculate the POW.");
                    let pow = await self.blockchain.getProofOfWork();
                    if(pow == null) {
                        reject();
                    }else {
                        resolve(pow);
                    }
                }, delay);
            }).then((pow) => {
                if(!self.processingConsensus) {
                    this.#logger.writeLog("The consensus has already been finished.");
                    return;
                }
                self.blockchain.commitProofOfWork(pow.index, pow.rootHash, pow.nonce).then(() => {
                    self.processingConsensus = false;
                    self.broadcast({dataName: "pow", data: pow});
                    this.#logger.writeLog("end the consensus by my POW. "+pow);
                    self.notifyLastBlock();
                    self.retrieveTransactionFromBacklog();
                }).catch(error => {
                    this.#logger.writeError("failed to commit Block: "+pow.index+", "+pow.rootHash+", "+pow.nonce+" "+error.message);
                    self.processingConsensus = false;
                    return;
                });
            });
        }, consensusInterval);
    }

    async handleCommand(command, data, replyHandler) {
        if(command == "startPow") {
            if(this.processingConsensus) {
                this.#logger.writeLog("Already in process.");
                return;
            }
            this.processingConsensus = true;
            
            let delay = 0;
            if(data != null) {
                delay = data.beginTime - new Date().getTime();
            }
            if(delay < 0) {
                delay = 0;
            }
            let self = this;
            setTimeout(async () => {
                this.#logger.writeLog("started to calculate the POW by the request.");
                let pow = await self.blockchain.getProofOfWork();
                replyHandler({dataName: "candidateForPow", data: pow});
            }, delay);
        }else {
            super.handleCommand(command, data, replyHandler);
        }
    }

    async handleData(dataName, data) {
        if(dataName == "candidateForPow") {
            let pow = data;
            if(typeof(pow) != "object") return;
            if(pow.index == undefined || pow.rootHash == undefined || pow.nonce == undefined) return;
            if(!this.processingConsensus) {
                this.#logger.writeLog("The consensus has already been finished.");
                return;
            }
            try {
                await this.blockchain.commitProofOfWork(pow.index, pow.rootHash, pow.nonce);
            }catch(error) {
                this.#logger.writeError("failed to commit Block: "+pow.index+", "+pow.rootHash+", "+pow.nonce+" "+error.message);
                return;
            }
            this.broadcast({dataName: "pow", data: pow});
            this.processingConsensus = false;
            this.#logger.writeLog("end the consensus by destination POW.");
            await this.notifyLastBlock();
            this.retrieveTransactionFromBacklog();
        }else if(dataName == "pow") {
            let pow = data;
            if(typeof(pow) != "object") return;
            if(pow.index == undefined || pow.rootHash == undefined || pow.nonce == undefined) return;
            if(!this.processingConsensus) return;
            try {
                await this.blockchain.commitProofOfWork(pow.index, pow.rootHash, pow.nonce);
            }catch(error) {
                this.#logger.writeError("failed to commit Block: "+pow.index+", "+pow.rootHash+", "+pow.nonce+" "+error.message);
                return;
            }
            this.processingConsensus = false;
            await this.notifyLastBlock();
            this.retrieveTransactionFromBacklog();
        }else {
            super.handleData(dataName, data);
        }
    }

    terminate() {
        super.terminate();

        if(this.#intervalId != null) {
            clearInterval(this.#intervalId);
            this.#intervalId = null;
        }
    }
}

module.exports = Pow;
