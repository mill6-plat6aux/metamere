/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

/**
 * @typedef { import("../../types/communication").Server } Server
 * @typedef { import("../../types/communication").Client } Client
 */

const EventEmitter = require("events");
const WebSocket = require("ws");
const HTTPS = require("https");
const FileSystem = require("fs");
const { serialize, deserialize } = require("../util/serializer");

const ReadyStates = {
    Connecting: 0,	
    Open: 1,
    Closing: 2,
    Closed: 3,
};

/**
 * @implements {Server}
 */
class WebSocketServer extends EventEmitter {

    /**
     * @type {WebSocket.Server | null}
     */
    #server;

    /**
     * @type {Array<WebSocketClient>}
     */
    #observers = [];

    constructor(port) {
        super();

        if(port == null) {
            throw new Error("Port must be defined.");
        }

        let options;
        if(arguments.length == 2) {
            options = arguments[1];
        }

        let server;
        let httpsServer;
        if(options != undefined && options.tls != undefined) {
            let privateKeyPath = options.tls.privateKey;
            let certificatePath = options.tls.certificate;
            httpsServer = HTTPS.createServer({
                key: FileSystem.readFileSync(privateKeyPath),
                cert: FileSystem.readFileSync(certificatePath),
            });
            server = new WebSocket.Server({
                server: httpsServer
            });
        }else {
            server = new WebSocket.Server({
                port: port
            });
        }
        
        server.on("listening", () => {
            this.emit("ready");
        });
        server.on("connection", (client, request) => {
            this.emit("connect", new SocketWrapper(request.socket));
            
            client.on("close", () => {
                this.emit("client close");
            });
            client.on("message", message => {
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
                client.setMaxListeners(0);

                this.emit("message", json, () => {
                    return new WebSocketClient(client);
                });
                
                if(json.command != null && json.command == "addObserver") {
                    this.#observers.push(new WebSocketClient(client));
                }
            });
            client.on("error", error => {
                this.emit("client error", error);
            });
        });
        server.on("close", () => {
            this.emit("close");
        });
        server.on("error", error => {
            this.emit("error", error);
        });

        if(httpsServer != undefined) {
            httpsServer.listen(port);
        }

        this.#server = server;
    }

    /**
     * @type {Array<string>}
     */
     get observers() {
        return this.#observers.filter(observer => observer.url != null).map(observer => /** @type {string} */(observer.url));
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
class WebSocketClient extends EventEmitter {

    /**
     * @type {WebSocket | null}
     */
    #client;

    get url() {
        return this.#client != null ? this.#client.url : null;
    }

    get isOpen() {
        return this.#client != null ? this.#client.readyState ==  ReadyStates.Open : false;
    }

    get isOpening() {
        return this.#client != null ? this.#client.readyState ==  ReadyStates.Connecting : false;
    }

    get isClosed() {
        return this.#client != null ? this.#client.readyState ==  ReadyStates.Closed : false;
    }
    
    constructor(url) {
        super();

        let client;
        if(url instanceof WebSocket) {
            client = url;
        }else {
            client = new WebSocket(url);
        }

        client.on("open", () => {
            this.emit("connect");
        });
        client.on("message", message => {
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
        client.on("close", () => {
            this.emit("close");
        });
        client.on("error", error => {
            this.emit("error", error);
        });

        this.#client = client;
    }

    send(message) {
        if(message == null) return;
        if(typeof message == "object") {
            message = serialize(message);
        }
        if(this.#client == null) return;
        if(this.#client.readyState != ReadyStates.Open) {
            throw new Error("The socket is not open yet.");
        }
        this.#client.send(message, error => {
            if(error != null) {
                this.emit("error", error);
            }
        });
    }

    close() {
        if(this.#client != null) {
            this.#client.close();
        }
        this.#client = null;
    }
}

class SocketWrapper {

    #socket;

    get address() {
        return this.#socket != null ? this.#socket.remoteAddress : null;
    }

    get port() {
        return this.#socket != null ? this.#socket.remotePort : null;
    }

    constructor(socket) {
        this.#socket = socket;
    }
}

exports.Server = WebSocketServer;
exports.Client = WebSocketClient;