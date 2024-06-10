/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

/**
 * @typedef { import("../../types/communication").Server } Server
 * @typedef { import("../../types/communication").Client } Client
 */

/**
 * @typedef { import("../../types/setting").Setting } Setting
 */

const net = require("net");
const EventEmitter = require("events");
const { readFileSync } = require("fs");
const TLS = require("tls");
const { serialize, deserialize } = require("../util/serializer");

const Status = {
    Connecting: 0,	
    Open: 1,
    Closing: 2,
    Closed: 3,
};

/**
 * @implements {Server}
 */
class TlsServer extends EventEmitter {

    /**
     * @type {TLS.Server|null}
     */
    #server;

    /**
     * @type {Array<TlsClient>}
     */
    #observers = [];

    /**
     * @param {number} port 
     * @param {Setting} setting 
     */
    constructor(port, setting) {
        super();

        let privateKeyFilePath = setting.privateKey;
        let certificateFilePath = setting.certificate;
        let rootCertificateFilePaths = setting.rootCertificates;
        if(port == null) {
            throw new Error("The port argument is not set.");
        }
        if(privateKeyFilePath == null) {
            throw new Error("The privateKey setting is not set.");
        }
        if(certificateFilePath == null) {
            throw new Error("The certificate setting is not set.");
        }
        if(rootCertificateFilePaths == null || !Array.isArray(rootCertificateFilePaths) || rootCertificateFilePaths.length == 0) {
            throw new Error("The clientCertificates setting is not set.");
        }
        let privateKey = readFileSync(privateKeyFilePath);
        let certificate = readFileSync(certificateFilePath);
        let rootCertificates = rootCertificateFilePaths.map(rootCertificateFilePath => readFileSync(rootCertificateFilePath));
        if(privateKey == null) {
            throw new Error("The privateKey setting is invalid.");
        }
        if(certificate == null) {
            throw new Error("The certificate setting is invalid.");
        }
        if(rootCertificates.findIndex(rootCertificate => rootCertificate == null) != -1) {
            throw new Error("The clientCertificates setting is invalid.");
        }

        let server = TLS.createServer({
            key: privateKey,
            cert: certificate,
            ca: rootCertificates,
            requestCert: true
        }, socket => {
            if(!socket.authorized && socket.authorizationError != null) {
                this.emit("error", socket.authorizationError);
                return;
            }
            socket.setMaxListeners(0);
            this.emit("connect", new SocketWrapper(socket));
            socket.on("close", () => {
                socket.destroy();
            });
            socket.on("data", message => {
                if(message == null) return;
                let string;
                if(message instanceof Buffer) {
                    if(message.length == 0) return;
                    string = message.toString("utf8");
                }else if(typeof message == "string") {
                    string = message;
                }
                if(string == null || string.length == 0) return;
                let json = deserialize(string);
                if(json == null) return;

                this.emit("message", json, () => {
                    return new TlsClient(socket);
                });
                
                if(json.command != null && json.command == "addObserver") {
                    this.#observers.push(new TlsClient(socket));
                }
            });
        });
        server.on("tlsClientError", (exception, socket) => {
            this.emit("client error", exception);
        });
        server.listen(port, () => {
            this.emit("ready");
        });
        this.#server = server;
    }

    get observers() {
        return this.#observers.filter(client => client.url != null).map(client => /** @type {string} */(client.url));
    }

    notify(message) {
        if(message == null) return;
        if(typeof message == "object") {
            message = serialize(message);
        }
        for(let i=this.#observers.length-1; i>=0; i--) {
            if(this.#observers[i].isClosed) {
                this.#observers.splice(i, 1);
            }
        }
        this.#observers.forEach(client => {
            client.send(message);
        });
    }

    close() {
        if(this.#server == null) return;
        this.#server.close();
        this.#server = null;
    }
}

/**
 * @implements {Client}
 */
class TlsClient extends EventEmitter {

    /**
     * @type {TLS.TLSSocket | null}
     */
    #socket;

    #status = Status.Connecting;

    #host;
    #port;

    get url() {
        if(this.#socket != null) {
            return "tls://"+this.#host+":"+this.#port;
        }
        return null;
    }

    get isOpen() {
        return this.#status == Status.Open;
    }

    get isOpening() {
        return this.#status == Status.Connecting;
    }

    get isClosed() {
        return this.#status == Status.Closed;
    }

    /**
     * 
     * @param {string|TLS.TLSSocket} url 
     * @param {Setting} [setting]
     */
    constructor(url, setting) {
        super();
        
        this.setMaxListeners(0);

        /** @type {TLS.TLSSocket} */
        let socket;
        if(url instanceof TLS.TLSSocket) {
            socket = url;
            this.#status = Status.Open;
            this.#host = socket.remoteAddress;
            this.#port = socket.remotePort;
        }else {
            if(setting == undefined) {
                throw new Error("The setting argument is required.");
            }

            let host;
            let port;
            if(/^tls:\/\/.+:[0-9]{2,5}$/.test(url)) {
                let index = url.lastIndexOf(":");
                host = url.substring("tls://".length, index);
                port = Number(url.substring(index+1));
            }
            if(port == null) {
                throw new Error("The port setting is not set.");
            }

            this.#host = host;
            this.#port = port;

            let privateKeyFilePath = setting.privateKey;
            let certificateFilePath = setting.certificate;
            let rootCertificateFilePaths = setting.rootCertificates;
            if(privateKeyFilePath == null) {
                throw new Error("The privateKey setting is not set.");
            }
            if(certificateFilePath == null) {
                throw new Error("The certificate setting is not set.");
            }
            if(rootCertificateFilePaths == null || !Array.isArray(rootCertificateFilePaths) || rootCertificateFilePaths.length == 0) {
                throw new Error("The clientCertificates setting is not set.");
            }
            let privateKey = readFileSync(privateKeyFilePath);
            let certificate = readFileSync(certificateFilePath);
            let rootCertificates = rootCertificateFilePaths.map(rootCertificateFilePath => readFileSync(rootCertificateFilePath));
            if(privateKey == null) {
                throw new Error("The privateKey setting is invalid.");
            }
            if(certificate == null) {
                throw new Error("The certificate setting is invalid.");
            }
            if(rootCertificates.findIndex(rootCertificate => rootCertificate == null) != -1) {
                throw new Error("The clientCertificates setting is invalid.");
            }
            socket = TLS.connect(port, host, {
                key: privateKey,
                cert: certificate,
                ca: rootCertificates,
                checkServerIdentity: (hostname, certificate) => { return undefined; }
            }, () => {
                if(!socket.authorized && socket.authorizationError != null) {
                    this.emit("error", socket.authorizationError);
                    return;
                }
                this.#status = Status.Open;
                this.emit("connect");
            });
        }

        socket.on("data", message => {
            if(message == null) return;
            let string;
            if(message instanceof Buffer) {
                if(message.length == 0) return;
                string = message.toString("utf8");
            }else if(typeof message == "string") {
                string = message;
            }
            if(string == null || string.length == 0) return;
            let json = deserialize(string);
            if(json == null) return;
            this.emit("message", json);
        });
        socket.on("close", () => {
            if(this.#socket != null) {
                this.#socket.destroy();
            }
            this.#status = Status.Closed;
            this.emit("close");
        });
        socket.on("error", error => {
            if(this.#socket != null) {
                this.#socket.end();
            }
            this.emit("error", error);
        });

        this.#socket = socket;
    }

    send(message) {
        if(message == null) return;
        if(typeof message == "object") {
            message = serialize(message);
        }
        if(this.#socket == null) return;
        if(this.#status != Status.Open) {
            throw new Error("The socket is not open yet.");
        }
        this.#socket.write(message, error => {
            if(error != null) {
                if(this.#socket != null) {
                    this.#socket.end();
                }
                this.emit("error", error.message);
            }
        });
    }

    close() {
        if(this.#socket != null) {
            this.#socket.end(() => {
                if(this.#socket != null) {
                    this.#socket.destroy();
                    this.#socket = null;
                }
            });
        }
    }
}

class SocketWrapper extends EventEmitter {

    /**
     * @type {net.Socket}
     */
    #socket;

    /**
     * @type {string|null|undefined}
     */
    get address() {
        return this.#socket != null ? this.#socket.remoteAddress : null;
    }

    /**
     * @type {number|null|undefined}
     */
    get port() {
        return this.#socket != null ? this.#socket.remotePort : null;
    }

    constructor(socket) {
        super();
        socket.on("error", error => {
            this.emit("error", error);
        });
        this.#socket = socket;
    }
}

exports.Server = TlsServer;
exports.Client = TlsClient;