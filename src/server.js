/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

/**
 * @typedef { import("../types/communication").Server } Server
 * @typedef { import("../types/communication").Client } Client
 */

/**
 * @typedef { import("../types/setting").Setting } Setting
 */

// @ts-check

const Assert = require("assert/strict");
const { Logger, LogLevel } = require("./util/logger");
const Blockchain = require("./blockchain");
const { serialize } = require("./util/serializer");

let communication;

class BlockchainServer {

    #logger = new Logger("BlockchainServer");
    
    /**
     * @type {Array<Client>}
     */
    #clients = [];

    /**
     * @type {Setting}
     */
    #settings;

    /**
     * @type {Blockchain}
     */
    #blockchain;

    /**
     * @type {Server|null}
     */
    #server = null;

    /**
     * @type {boolean}
     */
    #processingConsensus = false;

    #transactionBacklog = [];

    get settings() {
        return this.#settings;
    }
    get processingConsensus() {
        return this.#processingConsensus;
    }
    set processingConsensus(newValue) {
        if(typeof newValue != "boolean") return;
        this.#processingConsensus = newValue;
    }
    get blockchain() {
        return this.#blockchain;
    }
    get transactionBacklog() {
        return this.#transactionBacklog;
    }
    set transactionBacklog(newValue) {
        this.#transactionBacklog = newValue;
    }
    get terminated() {
        return this.#server == null;
    }
    get server() {
        return this.#server;
    }

    /**
     * @param {Setting} settings 
     */
    constructor(settings) {
        let blockVersion = settings.blockVersion;
        Assert(blockVersion != null, "The configuration file does not contain the block version.");
        Assert(settings.port != null, "Configuration file does not contain the node's port.");

        this.#settings = settings;

        this.#blockchain = new Blockchain(blockVersion, settings.storage, settings.storagePath, settings.indexKeys);

        let protocol = this.#settings.protocol;
        if(protocol == "ws") {
            communication = require("./communication/websocket");
        }else if(protocol == "tls") {
            communication = require("./communication/tls");
        }else {
            if(protocol == null) {
                this.#settings.protocol = "tcp";
            }
            communication = require("./communication/tcp");
        }

        this.#startServer(() => {
            this.#sendMessageWithRoundrobin({command: "getNodes"});
            this.#sendMessageWithRoundrobin({command: "getBlocks", data: {direction: "forward"}});
            this.startConsensus();
        });
    }

    #startServer(completionHandler) {
        let port = this.#settings.port;
        let server = new communication.Server(port, this.#settings);

        let self = this;
        server.on("ready", () => {
            this.#logger.writeLog("started to listen: " + port);
            if(completionHandler != null) {
                completionHandler();
            }
        });
        server.on("connect", client => {
            let address = client.address;
            if(address != null) {
                let delimiterIndex = address.lastIndexOf(":");
                if(delimiterIndex != -1 && delimiterIndex < address.length-1) {
                    address = address.substring(delimiterIndex+1);
                }
            }
            this.#logger.writeLog("A connection opened from "+address, LogLevel.debug);
        });
        server.on("message", (message, clientHandler) => {
            this.#logger.writeLog("Message received from remote.\n"+serialize(message), LogLevel.debug);
            self.#handleMessage(message, clientHandler);
        });
        server.on("close", () => {
            this.#logger.writeLog("Server is closed a connection.");
        });
        server.on("client close", () => {
            this.#logger.writeLog("A client connection is closed by remote.", LogLevel.debug);
        });
        server.on("error", error => {
            this.#logger.writeError("An error occurred on the server connection: " + error);
        });
        server.on("client error", error => {
            this.#logger.writeError("An error occurred on the client connection: " + error, LogLevel.debug);
        });

        this.#server = server;
    }

    startConsensus() {
    }

    #handleMessage(message, clientHandler) {
        if(message.command != null) {
            if(this.#settings.nodes == undefined) return;
            if(message.command != "append" && message.command != "vote") {
                this.#logger.writeLog(`The command [${message.command}] was invoked.`, LogLevel.info);
            }
            this.handleCommand(message.command, message.data, replyMessage => {
                this.#sendMessage(replyMessage, clientHandler());
            });
        }else if(message.dataName != null && message.data != null) {
            this.handleData(message.dataName, message.data);
        }
    }

    /**
     * @param {string} command 
     * @param {?Object} data 
     * @param {function(Data): void} replyHandler
     */
    async handleCommand(command, data, replyHandler) {
        if(command == "getNodes") {
            let nodes = this.#settings.nodes != null ? Array.from(this.#settings.nodes) : [];
            let url = this.#settings.protocol + "://" + this.#settings.host + ":" + this.#settings.port;
            nodes.push({id: this.#settings.id, url: url});
            replyHandler({dataName: "nodes", data: nodes});
        }else if(command == "getBlocks") {
            let request = data;
            let blocks = await this.#blockchain.getBlocks(request);
            replyHandler({dataName: "blocks", data: blocks});
        }else if(command == "getBlock") {
            let index = data;
            if(typeof index != "bigint") {
                index = BigInt(index);
            }
            let block = await this.#blockchain.getBlock(index);
            replyHandler({dataName: "block", data: block});
        }else if(command == "generateGenesisBlock") {
            let genesisBlock = await this.#blockchain.generateGenesisBlock();
            this.broadcast({dataName: "blocks", data: [genesisBlock]});
            this.#logger.writeLog("generate the genesis block and broadcasted it.");
        }else if(command == "addTransaction") {
            if(data == undefined) return;
            let transaction = data;
            if(typeof(transaction) != "object") return;
            this.addTransaction(transaction);
            this.broadcast({dataName: "transaction", data: transaction});
        }else if(command == "addTemporaryTransaction") {
            if(data == undefined) return;
            let transaction = data;
            if(typeof(transaction) != "object") return;
            this.addTransaction(transaction, true);
            this.broadcast({dataName: "temporaryTransaction", data: transaction});
        }else if(command == "commitTransaction") {
            if(data == undefined) return;
            let request = data;
            this.commitTransaction(request);
            this.broadcast({dataName: "committedTransaction", data: request});
        }
    }

    /**
     * @param {string} dataName 
     * @param {Object} data 
     */
    async handleData(dataName, data) {
        if(dataName == "nodes") {
            let nodes = data;
            if(!Array.isArray(nodes)) return;
            if(this.#settings.protocol == null || this.#settings.host == null ||  this.#settings.port == null) return;
            let url = this.#settings.protocol + "://" + this.#settings.host + ":" + this.#settings.port;
            nodes.forEach(node => {
                if(typeof node == "object" && node.url != null && typeof node.url == "string") {
                    if(node.url == url) return;
                    if(!node.url.startsWith(this.#settings.protocol+"://")) return;
                    if(this.#settings.nodes.findIndex(entry => entry.url == node.url) == -1) {
                        this.#settings.nodes.push(node);
                    }
                }
            });
            this.#logger.writeLog("updated nodes: "+this.#settings.nodes.map(node => (node.id != null ? node.id : node.url)).join(", "));
        }else if(dataName == "blocks") {
            let blocks = data;
            if(!Array.isArray(blocks)) return;
            if(blocks.length == 0) return;
            try {
                await this.#blockchain.setBlocks(blocks);
            }catch(error) {
                this.#logger.writeLog("Invalid blocks was received. "+error.message);
                // TODO: Broadcast tampering
                return;
            }
            this.#logger.writeLog("updated blocks");
        }else if(dataName == "transaction") {
            let transaction = data;
            if(typeof(transaction) != "object") return;
            this.addTransaction(transaction);
        }else if(dataName == "temporaryTransaction") {
            let transaction = data;
            if(typeof(transaction) != "object") return;
            this.addTransaction(transaction, true);
        }else if(dataName == "committedTransaction") {
            let transaction = data;
            this.commitTransaction(transaction);
        }
    }

    /**
     * @typedef {Object} Transaction
     * @property {string} transactionId
     * @property {Array<Transaction>} elements
     */

    /**
     * @param {Array<Transaction>|Transaction} transaction 
     * @param {boolean} [temporary] If true, the addition is confirmed by commitTransaction.
     */
    addTransaction(transaction, temporary) {
        let transactions = [];
        if(!Array.isArray(transaction)) {
            if(transaction.transactionId != null && (temporary != null && temporary)) {
                transaction["@temp"] = new Date().getTime();
            }
            transactions.push(transaction);
        }else {
            transactions = transaction.map(entry => {
                if(entry.transactionId != null && (temporary != null && temporary)) {
                    transaction["@temp"] = new Date().getTime();
                }
                return entry;
            });
        }
        transactions.forEach(transaction => {
            if(this.#processingConsensus || transaction["@temp"] != null) {
                this.#transactionBacklog.push(transaction);
            }else {
                this.#blockchain.addTransaction(transaction);
            }
        });
    }

    /**
     * Finalize the specified transaction data.
     * @param {Array<string>|string} transactionId 
     */
    commitTransaction(transactionId) {
        if(this.#transactionBacklog.length == 0) return;
        let transactionIds = [];
        if(!Array.isArray(transactionId)) {
            transactionIds.push(transactionId);
        }else {
            transactionIds = transactionId;
        }
        let transactionBacklog = [];
        this.#transactionBacklog.forEach((transaction, index) => {
            if(transaction.transactionId != null && transactionIds.includes(transaction.transactionId)) {
                delete transaction["@temp"];
                if(this.#processingConsensus) {
                    transactionBacklog.push(transaction);
                }else {
                    this.#blockchain.addTransaction(transaction);
                }
            }else {
                transactionBacklog.push(transaction);
            }
        });
        this.#transactionBacklog = transactionBacklog;
    }

    retrieveTransactionFromBacklog() {
        if(this.#processingConsensus) return;
        if(this.#transactionBacklog.length > 0) {
            let transactionBacklog = [];
            this.#transactionBacklog.forEach(transaction => {
                if(transaction["@temp"] != null) {
                    transactionBacklog.push(transaction);
                }else {
                    this.#blockchain.addTransaction(transaction);
                }
            });
            this.#transactionBacklog = transactionBacklog;
        }
    }

    #sendMessage(message, client, errorHandler) {
        client.send(message, errorHandler);
    }

    #sendMessageToNode(message, node, errorHandler) {
        if(node.url == undefined) return;
        let index = this.#clients.findIndex(client => {
            return client.url == node.url;
        });
        if(index != -1) {
            let client = this.#clients[index];
            if(client.isOpen) {
                this.#sendMessage(message, client, errorHandler);
                return;
            }else if(client.isOpening) {
                let self = this;
                client.once("connect", () => {
                    self.#sendMessage(message, client, errorHandler);
                });
                return;
            }else {
                this.#clients.splice(index, 1);
            }
        }

        let client = new communication.Client(node.url, this.#settings);
        let self = this;
        client.once("connect", () => {
            self.#sendMessage(message, client, errorHandler);
        });
        client.on("message", data => {
            self.#handleMessage(data, client);
        });
        client.on("close", () => {
            self.#refreshClients();
        });
        client.on("error", error => {
            self.#refreshClients();
            this.#logger.writeError("An error occurred on the client connection: " + error, LogLevel.debug);
        });
        this.#clients.push(client);
    }

    #sendMessageWithRoundrobin(message) {
        if(this.#settings.nodes == undefined) return;
        function sendMessage(self, nodes, retry) {
            let node = nodes[Math.floor(Math.random() * nodes.length)];
            self.#sendMessageToNode(message, node, error => {
                if(retry < nodes.length) {
                    sendMessage(self, nodes, ++retry);
                }
            });
        }
        sendMessage(this, this.#settings.nodes, 0);
    }

    /**
     * Send a message to a specific node.
     * @param {Command|Data} message 
     * @param {number|string} id 
     * @param {?function(Error): void} errorHandler 
     */
    sendMessageToNode(message, id, errorHandler) {
        if(this.#settings.nodes == undefined) return;
        let node = this.#settings.nodes.find(node => node.id == id);
        if(node == null) return;
        this.#sendMessageToNode(message, node, errorHandler);
    }

    /**
     * @typedef {Object} Command
     * @property {string} command
     * @property {Object} data
     */

    /**
     * @typedef {Object} Data
     * @property {string} dataName
     * @property {Object} data
     */

    /**
     * Messages are delivered to all nodes.
     * @param {Command|Data} message 
     * @param {function(Error): void} [errorHandler]
     */
    broadcast(message, errorHandler) {
        if(this.#settings.nodes == undefined) return;
        this.#settings.nodes.forEach((node) => {
            this.#sendMessageToNode(message, node, errorHandler);
        });
    }

    #refreshClients() {
        for(let i=this.#clients.length-1; i>=0; i--) {
            if(!this.#clients[i].isOpen) {
                this.#clients.splice(i, 1);
            }
        }
    }

    /**
     * Notify block generation
     */
    async notifyLastBlock() {
        if(this.#server == null) {
            throw new Error("The server is closed.");
        }
        let lastBlock = await this.blockchain.getBlocks({
            direction: "backward",
            limit: 1,
            headerOnly: false
        });
        if(lastBlock != null && lastBlock.length == 1) {
            this.#server.notify({dataName: "block", data: lastBlock[0]});
        }
    }

    terminate() {
        if(this.#server == null) return;
        this.#server.close();
        this.#server = null;

        if(this.#blockchain != null) {
            this.#blockchain.terminate();
        }
    }
}

module.exports = BlockchainServer;
