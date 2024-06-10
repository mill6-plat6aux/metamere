/*!
 * Copyright 2022 Takuro Okada.
 * Released under the MIT License.
 */

const Axon = require("axon");

let host;
let port;

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
        }
    }
}

if(host == null || port == null) {
    console.log("node initialize -h <HOST> -p <PORT>");
    process.exit(0);
}

sendData({command: "generateGenesisBlock"}).then(() => {
    console.log("succeed in initializing.");
    process.exit(0);
});

function loadClient() {
    return new Promise((resolve, reject) => {
        let client = new Axon.socket("push");
        client.connect("tcp://"+host+":"+port);
        client.on("connect", () => {
            resolve(client);
        });
        client.on("error", error => {
            reject(error);
        });
    });
}

function sendData(data) {
    return new Promise((resolve, reject) => {
        loadClient().then(client => {
            client.send(JSON.stringify(data));
            resolve();
        });
    });
}