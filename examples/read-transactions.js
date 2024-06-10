
const { TcpConnector } = require("metamere-client");

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

connector.getTransactions().then(result => {
    console.log("Succeeded to read transaction data.");
    console.log(result);
    process.exit(0);
}).catch(error => {
    console.error(error.message);
    process.exit(1);
});