/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

const Server = require("../src/consensus/raft");
const WebSocket = require("ws");
const FileSystem = require("fs");
const Crypto = require("crypto");

const assert = require('assert');

const STORAGE_PATH = "blocks1";

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

describe("WebSocket Server", function() {

    it("generateGenesisBlock", async () => {
        let server1 = loadServer("ws", 0);
        let server2 = loadServer("ws", 1);
        let server3 = loadServer("ws", 2);

        await wait(300);
        await sendData("ws", 0, {command: "generateGenesisBlock"});
        await wait(300);
        let message = await sendDataAndReceiveData("ws", 1, {command: "getBlock", data: 0});
        assert.strictEqual(message.dataName, "block");
        let block = message.data;
        assert.strictEqual(generateHash(block.nonce , "", "1183f7f0cb6243e92d5e4ba2fb626b02bca27ffe89c77dcbd7003167405da253"), block.hash);

        server1.terminate();
        server2.terminate();
        server3.terminate();
    });

    it("getBlock", done => {
        let server1 = loadServer("ws", 0);
        let server2 = loadServer("ws", 1);
        let server3 = loadServer("ws", 2);

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
                sendDataAndReceiveData("ws", 0, {command: "addObserver"}),
                sendData("ws", 1, {command: "addTransaction", data: transactions})
            ]).then(results => {
                let message = results[0];
                let block = message.data;
                assert.strictEqual(block.index, 1n);

                sendDataAndReceiveData("ws", 0, {command: "getBlock", data: 1}).then(message => {
                    let block = message.data;
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
});

const servers = [
    { id: "S1", port: 9001 },
    { id: "S2", port: 9002 },
    { id: "S3", port: 9003 }
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
        "storagePath": STORAGE_PATH+"/"+index,
        "id": host.id,
        "host": "127.0.0.1",
        "port": host.port,
        "protocol": protocol,
        "nodes": nodes
    }
    let server = new Server(settings);
    return server;
}

function loadClient(protocol, index) {
    return new Promise((resolve, reject) => {
        let server = servers[index];
        let client = new WebSocket(protocol+"://"+"127.0.0.1"+":"+server.port);
        client.setMaxListeners(0);
        client.on("open", () => {
            resolve(client);
        });
    });
}

function sendData(protocol, index, data) {
    return new Promise((resolve, reject) => {
        loadClient(protocol, index).then(client => {
            client.send(JSON.stringify(data), error => {
                if(error != null) { reject(error); return; }
                client.terminate();
                resolve();
            });
        });
    });
}

function sendDataAndReceiveData(protocol, index, data) {
    return new Promise((resolve, reject) => {
        loadClient(protocol, index).then(client => {
            client.on("message", data => {
                client.terminate();
                resolve(JSON.parse(data.toString("utf8"), (key, value) => {
                    if(key == "index") {
                        return BigInt(value);
                    }
                    return value;
                }));
            });
            client.send(JSON.stringify(data), error => {
                if(error != null) { 
                    client.terminate();
                    reject(error); 
                }
            });
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
