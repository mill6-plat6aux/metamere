/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

/**
 * @typedef { import("../../types/communication").Server } Server
 * @typedef { import("../../types/communication").Client } Client
 */

const EventEmitter = require("events");
const Axon = require("axon");
const Message = require("amp-message");
const { serialize, deserialize } = require("../util/serializer");

const Status = {
    opening: 0,
    opened: 1,
    closed: 2,
    busy: 3
}

/**
 * @implements {Server}
 */
class TcpServer extends EventEmitter {

    /**
     * @type {Axon.Socket}
     */
    #server;

    /**
     * @type {Axon.PubSocket}
     */
    #observers = Axon.socket("pub");
    
    constructor(port) {
        super();

        if(port == null) {
            throw new Error("Port must be defined.");
        }

        let server = new Axon.Socket();
        server.bind(port);

        server.on("connect", socket => {
            this.emit("connect", new SocketWrapper(socket));
        });
        server.on("disconnect", socket => {
            this.emit("client close");
        });
        server.on("bind", () => {
            this.emit("ready");
        });
        server.on("close", () => {
            this.emit("close");
        });
        server.on("error", error => {
            this.emit("error", error);
        });
        server.on("socket error", error => {
            this.emit("error", error);
        });
        server.onmessage = (socket) => {
            let self = this;
            return function(buffer) {
                let message = new Message(buffer);
                let data = message.shift();
                if(data == null) return;
                let string;
                if(data instanceof Buffer) {
                    if(data.length == 0) return;
                    string = data.toString("utf8");
                }else if(typeof data == "string") {
                    string = data;
                }
                if(string == null || string.length == 0) return;
                let json = deserialize(string);
                if(json == null) return;

                socket.setMaxListeners(0);

                self.emit("message", json, () => {
                    let axonSocket = Axon.socket("push");
                    axonSocket.addSocket(socket);
                    axonSocket.handleErrors(socket);
                    return new TcpClient(axonSocket);
                });

                if(json.command != null && json.command == "addObserver") {
                    socket.on("close", function() {
                        self.#observers.removeSocket(this);
                    });
                    socket.on("error", function(error) {
                        self.#observers.removeSocket(this);
                    });
                    self.#observers.addSocket(socket);
                }
            };
        };
        this.#server = server;
    }

    /**
     * @type {Array<string>}
     */
    get observers() {
        let addresses = this.#observers.socks.map(socket => {
            return socket.remoteAddress + ":" + socket.remotePort;
        })
        return addresses;
    }

    notify(message) {
        if(message == null) return;
        if(typeof message == "object") {
            message = serialize(message);
        }
        this.#observers.send(message);
    }

    close() {
        if(this.#server == null) return;
        this.#server.closeServer();
        this.#server = null;
    }
}

/**
 * @implements {Client}
 */
class TcpClient extends EventEmitter {

    /**
     * @type {Axon.PushSocket}
     */
    #client;

    #status = Status.opening;

    #url;

    /**
     * @type {string}
     */
    get url() {
        return this.#url;
    }

    /**
     * @type {boolean}
     */
    get isOpen() {
        return this.#status == Status.opened;
    }

    /**
     * @type {boolean}
     */
    get isOpening() {
        return this.#status == Status.opening;
    }

    /**
     * @type {boolean}
     */
    get isClosed() {
        return this.#status == Status.closed;
    }

    /**
     * @type {boolean}
     */
    get isBusy() {
        return this.#status == Status.busy;
    }

    constructor(url) {
        super();
        
        this.setMaxListeners(0);

        let client;
        if(url instanceof Axon.Socket) {
            client = url;
            this.#status = Status.opened;

            if(client.socks.length > 0) {
                let socket = client.socks[0];
                this.#url = "tcp://"+socket.remoteAddress+":"+socket.remotePort;
            }
        }else {
            this.#url = url;
    
            client = Axon.socket("push");
            client.connect(url);
        }
        
        client.on("connect", socket => {
            this.#status = Status.opened;
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
            this.#status = Status.closed;
            this.#client = null;
            this.emit("close");
        });
        client.on("error", error => {
            this.close();
            this.emit("error", error);
        });
        client.on("socket error", error => {
            this.close();
            this.emit("error", error);
        });
        client.on("busy", () => {
            this.#status = Status.busy;
        });

        this.#client = client;
    }

    send(message, errorHandler, retry) {
        if(message == null) return;
        let encoded = null;
        if(typeof message == "object") {
            encoded = serialize(message);
        }
        if(this.#client == null) return;
        if(this.#status != Status.opened) {
            throw new Error("The socket is not open yet.");
        }
        this.#client.sendAndWait(encoded, error => {
            if(error != null) {
                if(retry == undefined) {
                    retry = 3;
                }
                if(retry > 0) {
                    setTimeout(() => {
                        this.send(encoded, errorHandler, --retry);
                    }, 100);
                }else {
                    if(errorHandler != null) {
                        errorHandler(error);
                    }
                    this.emit("error", error);
                }
            }
        });
    }

    close() {
        this.#status = Status.closed;
        if(this.#client != null) {
            this.#client.close();
            this.#client = null;
        }
    }
}

class SocketWrapper extends EventEmitter {

    /**
     * @type {net.Socket}
     */
    #socket;

    /**
     * @type {string}
     */
    get address() {
        return this.#socket != null ? this.#socket.remoteAddress : null;
    }

    /**
     * @type {number}
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

exports.Server = TcpServer;
exports.Client = TcpClient;