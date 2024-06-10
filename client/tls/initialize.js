/*!
 * Copyright 2022 Takuro Okada.
 * Released under the MIT License.
 */

const TLS = require("tls");
const { readFileSync } = require("fs");

let host;
let port;
let privateKey;
let certificate;
let rootCertificate;
let verbose = false;

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
            if(key == "host") {
                host = value;
            }
            if(key == "port") {
                port = Number(value);
            }
            if(key == "privateKey") {
                privateKey = readFileSync(value);
            }
            if(key == "certificate") {
                certificate = readFileSync(value);
            }
            if(key == "rootCertificate") {
                rootCertificate = readFileSync(value);
            }
            if(key == "verbose") {
                verbose = value == "true";
            }
        }
    }
}

if(host == null || port == null) {
    console.log("node diagnose --host <HOST> --port <PORT> --privateKey <PRIVATE_KEY_PATH> --certificate <CERTIFICATE_PATH> --rootCertificate <ROOT_CERTIFICATE_PATH>");
    process.exit(0);
}

sendData(host, port, privateKey, certificate, rootCertificate, {command: "generateGenesisBlock"}).then(() => {
    console.log("Succeed in initializing.");
    process.exit(0);
});

/**
 * @param {string} host 
 * @param {number} port 
 * @param {Buffer} privateKey 
 * @param {Buffer} certificate 
 * @param {Buffer} rootCertificate 
 * @returns {Promise<TLS.TLSSocket>}
 */
function loadClient(host, port, privateKey, certificate, rootCertificate) {
    return new Promise((resolve, reject) => {
        const socket = TLS.connect(port, host, {
            key: privateKey,
            cert: certificate,
            ca: rootCertificate,
            checkServerIdentity: (hostname, certificate) => { return undefined; }
        }, () => {
            if(!socket.authorized && socket.authorizationError != null) {
                reject(socket.authorizationError);
                return;
            }
            resolve(socket);
        });
        socket.on("close", () => {
            socket.destroy();
        });
        socket.on("error", error => {
            socket.destroy();
            reject(error);
        });
    });
}

/**
 * @param {string} host 
 * @param {number} port 
 * @param {Buffer} privateKey 
 * @param {Buffer} certificate 
 * @param {Buffer} rootCertificate 
 * @param {object} request 
 * @returns {Promise<object>}
 */
function sendData(host, port, privateKey, certificate, rootCertificate, request) {
    return new Promise((resolve, reject) => {
        loadClient(host, port, privateKey, certificate, rootCertificate).then(socket => {
            socket.write(JSON.stringify(request), error => {
                socket.end();
                if(error != null) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }).catch(error => {
            reject(error);
        });
    });
}
