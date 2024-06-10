/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

const Axon = require("axon");

let host;
let port;
let verbose = false;

if(process.argv.length > 2) {
    let arguments = process.argv;
    for(let i=2; i<arguments.length; i++) {
        let argument = arguments[i];
        if(argument.startsWith("-") && argument.length > 1) {
            let key = argument.substring(1);
            let value;
            if(i<arguments.length-1) {
                value = arguments[i+1];
                i++;
            }
            if(key == "h") {
                host = value;
            }
            if(key == "p") {
                port = value;
            }
            if(key == "v") {
                verbose = value == "true";
            }
        }
    }
}

if(host == null || port == null) {
    console.log("node diagnose -h <HOST> -p <PORT>");
    process.exit(0);
}

sendDataAndReceiveData("tcp://"+host+":"+port, {command: "getDiagnostics"}).then(result => {
    let json = JSON.parse(result);
    if(!verbose) {
        if(json.provisionalBlocks != null) {
            json.provisionalBlocks = json.provisionalBlocks.map(provisionalBlock => {
                if(provisionalBlock.entry == null) return provisionalBlock;
                delete provisionalBlock.entry.transaction;
                return provisionalBlock;
            });
        }
    }
    console.log("tcp://"+host+":"+port+"\n", JSON.stringify(json, null, 2), "\n");
});

function loadClient(url) {
    return new Promise((resolve, reject) => {
        let client = new Axon.socket("push");
        client.connect(url);
        client.on("connect", () => {
            resolve(client);
        });
        client.on("error", error => {
            reject(error);
        });
    });
}

function sendDataAndReceiveData(url, data) {
    return new Promise((resolve, reject) => {
        loadClient(url).then(client => {
            client.on("message", message => {
                resolve(message);
                client.close();
            });
            client.send(JSON.stringify(data));
        }).catch(error => {
            reject(error);
        });
    });
}
