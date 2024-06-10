
const { TcpConnector } = require("metamere-client");
const UUID = require("uuid");

let connector = new TcpConnector({
    "blockVersion": "1.0",
    "nodes": [
        { "url": "tcp://127.0.0.1:15001" },
        { "url": "tcp://127.0.0.1:15002" },
        { "url": "tcp://127.0.0.1:15003" },
        { "url": "tcp://127.0.0.1:15004" },
        { "url": "tcp://127.0.0.1:15005" }
    ]
});

connector.on("error", error => {
    console.error(error.message);
    process.exit(1);
});

connector.addTransactions([{
    transactionId: UUID.v4(),
    property1: "value1",
    property2: "value2",
    property3: "value3"
}]).then(result => {
    console.log("Succeeded to write a transaction data.");
    console.log("transactionIds:", result);
    process.exit(0);
}).catch(error => {
    console.error(error.message);
    process.exit(1);
});