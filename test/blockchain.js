/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

const FileSystem = require("fs");
const Crypto = require("crypto");
const Blockchain = require("../src/blockchain");

const assert = require('assert');

const STORAGE_PATH = "blocks";

before(() => {
    if(FileSystem.existsSync(STORAGE_PATH)) {
        FileSystem.rmSync(STORAGE_PATH, {recursive: true});
    }
    FileSystem.mkdirSync(STORAGE_PATH);
});

after(() => {
    if(FileSystem.existsSync(STORAGE_PATH)) {
        FileSystem.rmSync(STORAGE_PATH, {recursive: true});
    }
});

describe("Genesis block generation", () => {
    it("generate", async () => {
        let blockchain = new Blockchain("0.9");
        await blockchain.generateGenesisBlock();
        let genesisBlock = await blockchain.getBlock(0n);
        assert.strictEqual(genesisBlock.version, "0.9");
        assert.strictEqual(genesisBlock.index, 0n);
        assert.strictEqual(typeof genesisBlock.timestamp == "number", true);
        assert.strictEqual(genesisBlock.nonce != null, true);
        assert.strictEqual(genesisBlock.prevHash, "");
        assert.deepEqual(genesisBlock.transactions, []);
        assert.strictEqual(generateHash(genesisBlock.nonce , "", "1183f7f0cb6243e92d5e4ba2fb626b02bca27ffe89c77dcbd7003167405da253"), genesisBlock.hash);
    });
});

describe("Transaction registration", () => {
    let transactions = [
        {
            transactionId: "00000000-0000-0000-0000-000000000001",
            senderUserId: 1,
            senderCompanyId: 1,
            recipientCompanyId: 2,
            inspectionCompanyId: null,
            articleCode: "4900000000001",
            distributionAmount: 100,
            distributionUnit: "piece",
            scope3Category: "1",
            energyConsumption: 10,
            carbonFootprint: 20,
            carbonOffsetCredit: 5,
            cocCertificateId: 1,
            cocCertificateCode: "JP-000-000-000-001",
            envValue: null,
            envValueCertificateId: null,
            envValueCertificateCode: null,
            calculationUnit: "Product",
            reliability: "GHGProtocolFollower",
            tradingDate: new Date(2021,11,10,0,0,0,0).getTime(),
            elements: [],
        }, {
            transactionId: "00000000-0000-0000-0000-000000000002",
            senderUserId: 2,
            senderCompanyId: 2,
            recipientCompanyId: 3,
            inspectionCompanyId: null,
            articleCode: "4900000000002",
            distributionAmount: 100,
            distributionUnit: "piece",
            scope3Category: "1",
            energyConsumption: 5,
            carbonFootprint: 7,
            carbonOffsetCredit: null,
            cocCertificateId: 2,
            cocCertificateCode: "JP-000-000-000-002",
            envValue: null,
            envValueCertificateId: null,
            envValueCertificateCode: null,
            calculationUnit: "Product",
            reliability: "GHGProtocolFollower",
            tradingDate: new Date(2021,11,11,0,0,0,0).getTime(),
            elements: [],
        }, {
            transactionId: "00000000-0000-0000-0000-000000000003",
            senderUserId: 3,
            senderCompanyId: 3,
            recipientCompanyId: 4,
            inspectionCompanyId: 2,
            articleCode: "4900000000003",
            distributionAmount: 100,
            distributionUnit: "piece",
            scope3Category: "1",
            energyConsumption: 50,
            carbonFootprint: 70,
            carbonOffsetCredit: 15,
            cocCertificateId: 3,
            cocCertificateCode: "JP-000-000-000-003",
            envValue: null,
            envValueCertificateId: null,
            envValueCertificateCode: null,
            calculationUnit: "Product",
            reliability: "GHGProtocolFollower",
            tradingDate: new Date(2021,11,12,0,0,0,0).getTime(),
            elements: [],
        }, {
            transactionId: "00000000-0000-0000-0000-000000000004",
            senderUserId: 4,
            senderCompanyId: 4,
            recipientCompanyId: 5,
            inspectionCompanyId: null,
            articleCode: "4900000000004",
            distributionAmount: 100,
            distributionUnit: "piece",
            scope3Category: "1",
            energyConsumption: 100,
            carbonFootprint: 90,
            carbonOffsetCredit: 80,
            cocCertificateId: 4,
            cocCertificateCode: "JP-000-000-000-004",
            envValue: null,
            envValueCertificateId: null,
            envValueCertificateCode: null,
            calculationUnit: "Product",
            reliability: "GHGProtocolFollower",
            tradingDate: new Date(2021,11,13,0,0,0,0).getTime(),
            elements: [],
        }
    ];
    it("create block", async () => {
        let blockchain = new Blockchain("0.9");
        transactions.forEach(transaction => {
            blockchain.addTransaction(transaction);
        });
        let pow = await blockchain.getProofOfWork();
        await blockchain.commitBlock(pow.index, pow.rootHash, pow.nonce);
    
        let genesisBlock = await blockchain.getBlock(0n);
        let block = await blockchain.getBlock(1n);

        assert.strictEqual(block.version, "0.9");
        assert.strictEqual(block.index, 1n);
        assert.strictEqual(typeof block.timestamp == "number", true);
        assert.strictEqual(block.nonce != null, true);
        assert.strictEqual(block.prevHash, genesisBlock.hash);
        assert.strictEqual(block.transactions.length, transactions.length);
        assert.deepEqual(block.transactions, transactions);
    });
});

describe("Transaction searching (disjunction)", () => {
    it("block", async () => {
        let blockchain = new Blockchain("0.9");
        let genesisBlock = await blockchain.getBlock(0n);
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                operation: "or",
                conditions: {
                    recipientCompanyId: 2,
                    inspectionCompanyId: 2
                }
            }
        });
        assert.strictEqual(blocks.length, 1);
        let block = blocks[0];
        assert.strictEqual(block.version, "0.9");
        assert.strictEqual(block.index, 1n);
        assert.strictEqual(typeof block.timestamp == "number", true);
        assert.strictEqual(block.nonce != null, true);
        assert.strictEqual(block.prevHash, genesisBlock.hash);
    });
    it("transactions", async () => {
        let blockchain = new Blockchain("0.9");
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                operation: "or",
                conditions: {
                    recipientCompanyId: 2,
                    inspectionCompanyId: 2
                }
            }
        });
        let block = blocks[0];
        let transactions = block.transactions;
        assert.strictEqual(transactions.length, 2);
        assert.strictEqual(transactions[0].transactionId, "00000000-0000-0000-0000-000000000001");
        assert.strictEqual(transactions[1].transactionId, "00000000-0000-0000-0000-000000000003");
    });
});

describe("Transaction searching (single)", () => {
    it("block", async () => {
        let blockchain = new Blockchain("0.9");
        let genesisBlock = await blockchain.getBlock(0n);
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                conditions: {
                    articleCode: "4900000000002"
                }
            }
        });
        assert.strictEqual(blocks.length, 1);
        let block = blocks[0];
        assert.strictEqual(block.version, "0.9");
        assert.strictEqual(block.index, 1n);
        assert.strictEqual(typeof block.timestamp == "number", true);
        assert.strictEqual(block.nonce != null, true);
        assert.strictEqual(block.prevHash, genesisBlock.hash);
    });
    it("transactions", async () => {
        let blockchain = new Blockchain("0.9");
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                conditions: {
                    articleCode: "4900000000002"
                }
            }
        });
        let block = blocks[0];
        let transactions = block.transactions;
        assert.strictEqual(transactions.length, 1);
        assert.strictEqual(transactions[0].transactionId, "00000000-0000-0000-0000-000000000002");
    });
});

describe("Transaction searching (ambiguous)", () => {
    it("block", async () => {
        let blockchain = new Blockchain("0.9");
        let genesisBlock = await blockchain.getBlock(0n);
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                ambiguous: true,
                conditions: {
                    cocCertificateCode: "JP-000"
                }
            }
        });
        assert.strictEqual(blocks.length, 1);
        let block = blocks[0];
        assert.strictEqual(block.version, "0.9");
        assert.strictEqual(block.index, 1n);
        assert.strictEqual(typeof block.timestamp == "number", true);
        assert.strictEqual(block.nonce != null, true);
        assert.strictEqual(block.prevHash, genesisBlock.hash);
    });
    it("transactions", async () => {
        let blockchain = new Blockchain("0.9");
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: {
                ambiguous: true,
                conditions: {
                    cocCertificateCode: "JP-000"
                }
            }
        });
        let block = blocks[0];
        let transactions = block.transactions;
        assert.strictEqual(transactions.length, 4);
    });
});

describe("Transaction searching (between)", () => {
    it("block", async () => {
        let blockchain = new Blockchain("0.9");
        let genesisBlock = await blockchain.getBlock(0n);
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: [
                {
                    operation: "or",
                    conditions: {
                        recipientCompanyId: 2,
                        inspectionCompanyId: 2
                    }
                },
                {
                    operation: "between",
                    conditions: {
                        tradingDate: {
                            begin: new Date(2021,11,11,0,0,0,0).getTime(),
                            end: new Date(2021,11,12,0,0,0,0).getTime(),
                        }
                    }
                }
            ]
        });
        assert.strictEqual(blocks.length, 1);
        let block = blocks[0];
        assert.strictEqual(block.version, "0.9");
        assert.strictEqual(block.index, 1n);
        assert.strictEqual(typeof block.timestamp == "number", true);
        assert.strictEqual(block.nonce != null, true);
        assert.strictEqual(block.prevHash, genesisBlock.hash);
    });
    it("transactions", async () => {
        let blockchain = new Blockchain("0.9");
        let blocks = await blockchain.getBlocks({
            direction: "backward",
            transactionCondition: [
                {
                    operation: "or",
                    conditions: {
                        recipientCompanyId: 2,
                        inspectionCompanyId: 2
                    }
                },
                {
                    operation: "between",
                    conditions: {
                        tradingDate: {
                            begin: new Date(2021,11,11,0,0,0,0).getTime(),
                            end: new Date(2021,11,12,0,0,0,0).getTime(),
                        }
                    }
                }
            ]
        });
        let block = blocks[0];
        let transactions = block.transactions;
        assert.strictEqual(transactions.length, 1);
        let transaction = transactions[0];
        assert.strictEqual(transaction.transactionId, "00000000-0000-0000-0000-000000000003");
    });
});

function generateHash(nonce, prevHash, currentHash) {
    let string = prevHash + nonce.toString() + currentHash;
    return Crypto.createHash("sha256").update(string, "utf8").digest("hex");
}