/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

const Server = require("../src/consensus/raft");
const Axon = require("axon");
const FileSystem = require("fs");
const Crypto = require("crypto");

const assert = require('assert');
const { time } = require("console");

const STORAGE_PATH = "./blocks2";

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

describe("TCP Server", function() {

    this.timeout(10000);

    it("generateGenesisBlock", async () => {
        let server1 = loadServer("tcp", 0);
        let server2 = loadServer("tcp", 1);
        let server3 = loadServer("tcp", 2);

        await wait(300);
        await sendData("tcp", 0, {command: "generateGenesisBlock"});
        await wait(100);
        let message = await sendDataAndReceiveData("tcp", 1, {command: "getBlock", data: 0});
        assert.strictEqual(message.dataName, "block");
        let block = message.data;
        assert.strictEqual(generateHash(block.nonce , "", "1183f7f0cb6243e92d5e4ba2fb626b02bca27ffe89c77dcbd7003167405da253"), block.hash);

        server1.terminate();
        server2.terminate();
        server3.terminate();
    });

    it("getBlock", done => {
        let server1 = loadServer("tcp", 0);
        let server2 = loadServer("tcp", 1);
        let server3 = loadServer("tcp", 2);

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
                elements: []
            }
        ];

        wait(300).then(() => {
            Promise.all([
                sendDataAndReceiveData("tcp", 0, {command: "addObserver"}),
                sendData("tcp", 1, {command: "addTransaction", data: transactions})
            ]).then(results => {
                let message = results[0];
                let block = message.data;
                assert.strictEqual(block.index, 1n);
                assert.strictEqual(block.transactions.length, transactions.length);
                assert.deepEqual(block.transactions, transactions);
        
                server1.terminate();
                server2.terminate();
                server3.terminate();
    
                done();
            });
        });
    });

    it("getBlocks", done => {
        let server1 = loadServer("tcp", 0);
        let server2 = loadServer("tcp", 1);
        let server3 = loadServer("tcp", 2);

        let transactions = [
            {
                transactionId: "00000000-0000-0000-0000-000000000002",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 2,
                inspectionCompanyId: null,
                articleCode: "4900000000002",
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
                elements: []
            },
            {
                transactionId: "00000000-0000-0000-0000-000000000003",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 2,
                inspectionCompanyId: null,
                articleCode: "4900000000003",
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
                elements: []
            }
        ];

        wait(300).then(() => {
            Promise.all([
                sendDataAndReceiveData("tcp", 0, {command: "addObserver"}),
                sendData("tcp", 1, {command: "addTransaction", data: transactions})
            ]).then(results => {
                let message = results[0];
                let block = message.data;
                assert.strictEqual(block.index, 2n);

                sendDataAndReceiveData("tcp", 0, {command: "getBlocks", data: {direction: "backward"}}).then(message => {
                    let blocks = message.data;
                    assert.strictEqual(blocks.length, 2);
                    let block = blocks[0];
                    assert.strictEqual(block.transactions.length, transactions.length);
                    assert.deepEqual(block.transactions, transactions);
            
                    server1.terminate();
                    server2.terminate();
                    server3.terminate();
        
                    done();
                });
            });
        });
    });

    it("getBlocks with simple condition", done => {
        let server1 = loadServer("tcp", 0);
        let server2 = loadServer("tcp", 1);
        let server3 = loadServer("tcp", 2);

        let transactions = [
            {
                transactionId: "00000000-0000-0000-0000-000000000004",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 2,
                inspectionCompanyId: null,
                articleCode: "4900000000004",
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
                elements: []
            },
            {
                transactionId: "00000000-0000-0000-0000-000000000005",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 2,
                inspectionCompanyId: null,
                articleCode: "4900000000005",
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
                elements: []
            }
        ];

        wait(300).then(() => {
            Promise.all([
                sendDataAndReceiveData("tcp", 0, {command: "addObserver"}),
                sendData("tcp", 1, {command: "addTransaction", data: transactions})
            ]).then(results => {
                let message = results[0];
                let block = message.data;
                assert.strictEqual(block.index, 3n);

                let query = {
                    direction: "backward",
                    limit: null,
                    headerOnly: false,
                    transactionCondition: {
                        conditions: {
                            articleCode: "4900000000004"
                        }
                    }
                };
                sendDataAndReceiveData("tcp", 0, {command: "getBlocks", data: query}).then(message => {
                    let blocks = message.data;
                    assert.strictEqual(blocks.length, 1);
                    let block = blocks[0];
                    assert.strictEqual(block.index, 3n);
                    assert.strictEqual(block.transactions.length, 1);
                    assert.deepEqual(block.transactions[0], transactions[0]);
            
                    server1.terminate();
                    server2.terminate();
                    server3.terminate();
        
                    done();
                });
            });
        });
    });

    it("getBlocks with range condition", done => {
        let server1 = loadServer("tcp", 0);
        let server2 = loadServer("tcp", 1);
        let server3 = loadServer("tcp", 2);

        let transactions = [
            {
                transactionId: "00000000-0000-0000-0000-000000000006",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 3,
                inspectionCompanyId: null,
                articleCode: "4900000000006",
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
                tradingDate: new Date(2021,10,10,0,0,0,0).getTime(),
                elements: []
            },
            {
                transactionId: "00000000-0000-0000-0000-000000000007",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 3,
                inspectionCompanyId: null,
                articleCode: "4900000000007",
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
                tradingDate: new Date(2021,10,25,0,0,0,0).getTime(),
                elements: []
            },
            {
                transactionId: "00000000-0000-0000-0000-000000000008",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 3,
                inspectionCompanyId: null,
                articleCode: "4900000000008",
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
                tradingDate: new Date(2021,11,3,0,0,0,0).getTime(),
                elements: []
            },
            {
                transactionId: "00000000-0000-0000-0000-000000000009",
                senderUserId: 1,
                senderCompanyId: 1,
                recipientCompanyId: 3,
                inspectionCompanyId: null,
                articleCode: "4900000000009",
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
                tradingDate: new Date(2021,11,20,0,0,0,0).getTime(),
                elements: []
            }
        ];

        wait(300).then(() => {
            Promise.all([
                sendDataAndReceiveData("tcp", 0, {command: "addObserver"}),
                sendData("tcp", 1, {command: "addTransaction", data: transactions})
            ]).then(results => {
                let message = results[0];
                let block = message.data;
                assert.strictEqual(block.index, 4n);

                let query = {
                    direction: "backward",
                    limit: null,
                    headerOnly: false,
                    transactionCondition: [
                        {
                            operation: "or",
                            conditions: {
                                recipientCompanyId: 3,
                                inspectionCompanyId: 4
                            }
                        },
                        {
                            operation: "between",
                            conditions: {
                                tradingDate: {begin: new Date(2021,10,15).getTime(), end: new Date(2021,11,15).getTime()}
                            }
                        }
                    ]
                };
                sendDataAndReceiveData("tcp", 0, {command: "getBlocks", data: query}).then(message => {
                    let blocks = message.data;
                    assert.strictEqual(blocks.length, 1);
                    let block = blocks[0];
                    assert.strictEqual(block.index, 4n);
                    assert.strictEqual(block.transactions.length, 2);
                    assert.deepEqual(block.transactions[0], transactions[1]);
                    assert.deepEqual(block.transactions[1], transactions[2]);
            
                    server1.terminate();
                    server2.terminate();
                    server3.terminate();
        
                    done();
                });
            });
        });
    });
});

const servers = [
    { id: "S1", port: 9004 },
    { id: "S2", port: 9005 },
    { id: "S3", port: 9006 }
];

function loadServer(protocol, index) {
    let host = servers[index];
    let nodes = servers.filter((_, i) => i != index).map(server => {
        return {id: server.id, url: protocol+"://"+"127.0.0.1"+":"+server.port};
    });
    let settings = {
        "blockVersion": "1.0",
        "keepaliveInterval": 50,
        "electionMaxInterval": 300,
        "electionMinInterval": 150,
        "storage": "LevelDB",
        "storagePath": STORAGE_PATH+"/"+index,
        "indexKeys": ["articleCode"],
        "id": host.id,
        "host": "127.0.0.1",
        "port": host.port,
        "protocol": protocol,
        "nodes": nodes
    }
    let server = new Server(settings);
    return server;
}

function loadClient(protocol, index, method) {
    return new Promise((resolve, reject) => {
        let server = servers[index];
        let client = new Axon.socket(method);
        client.connect(protocol+"://"+"127.0.0.1"+":"+server.port);
        client.on("connect", () => {
            resolve(client);
        });
        client.on("error", error => {
            reject(error);
        });
    });
}

function sendData(protocol, index, data) {
    return new Promise((resolve, reject) => {
        loadClient(protocol, index, "push").then(client => {
            client.send(JSON.stringify(data));
            resolve();
            client.close();
        });
    });
}

function sendDataAndReceiveData(protocol, index, data) {
    return new Promise((resolve, reject) => {
        loadClient(protocol, index, "push").then(client => {
            client.on("message", message => {
                if(message != null) { 
                    resolve(JSON.parse(message, (key, value) => {
                        if(key == "index") {
                            return BigInt(value);
                        }
                        return value;
                    }));
                    client.close();
                }
            });
            client.send(JSON.stringify(data));
        });
    });
}

function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, time);
    });
}

function generateHash(nonce, prevHash, currentHash) {
    let string = prevHash + nonce.toString() + currentHash;
    return Crypto.createHash("sha256").update(string, "utf8").digest("hex");
}
