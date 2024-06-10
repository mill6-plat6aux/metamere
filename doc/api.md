<div align="center">
    <div><img src="../images/logo.svg"/></div>
    <div>Ultra-lightweight Blockchain</div>
</div>

## Client implementation

### Install

Execute the following command in the root directory of the Node.js application where you want to deploy the metamere client.

```sh
npm install metamere-client
```

### Setting

Settings are described in JSON format.

<table>
    <thead>
        <tr>
            <td><b>Key</b></td><td><b>Value</b></td>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>blockVersion</td><td>Version of block data. Currently <code>1.0.</code></td>
        </tr>
        <tr>
            <td>protocol</td><td>Communication protocol. <code>tcp</code>, <code>tls</code>, or <code>ws</code>.</td>
        </tr>
        <tr>
            <td>privateKey</td><td>Required for <code>tls</code>. File path of the node's private key.</td>
        </tr>
        <tr>
            <td>certificate</td><td>Required for <code>tls</code>. File path of the node's certificate.</td>
        </tr>
        <tr>
            <td>rootCertificates</td><td>Required for <code>tls</code>. File path of the root certificate.</td>
        </tr>
        <tr>
            <td>nodes</td><td>Describe the settings of other nodes in an array; in the case of <code>Raft</code>, three or more nodes are required.</td>
        </tr>
        <tr>
            <td>&nbsp;&nbsp;&nbsp;&nbsp;url</td><td>The URL of the node to connect to, e.g. <code>tls://HOST:PORT</code> for TLS.</td>
        </tr>
    </tbody>
</table>

#### Sample

```json
{
    "blockVersion": "1.0",
    "protocol": "tls",
    "nodes": [
        { "url": "tls://localhost:15001" },
        { "url": "tls://localhost:15002" },
        { "url": "tls://localhost:15003" }
    ],
    "privateKey": "certificates/c1.key",
    "certificate": "certificates/c1.crt",
    "rootCertificates": ["certificates/root.crt"]
}
```

### Busines Logic

Write programs related to data processing.

#### Smaple

##### Writing data

```js
const { Connector } = require("metamere-client");
const { v4 } = require("uuid");
const { readFileSync } = require("fs");

let setting = JSON.parse(readFileSync("metamere.json", "utf8"));
let connector = new Connector(setting);
connector.on("error", error => {
    console.error(error);
    process.exit(1);
});

connector.addTransactions([{
    transactionId: v4(),
    k1: "v21",
    k2: "v22",
    k3: "v23"
}]).then(result => {
    console.log(result);
    process.exit(0);
}).catch(error => {
    console.error(error);
    process.exit(1);
});
```

##### Reading data

```js
const { Connector } = require("metamere-client");
const { v4 } = require("uuid");
const { readFileSync } = require("fs");

let setting = JSON.parse(readFileSync("metamere.json", "utf8"));
let connector = new Connector(setting);
connector.on("error", error => {
    console.error(error);
    process.exit(1);
});

connector.getTransactions().then(result => {
    console.log(result);
    process.exit(0);
}).catch(error => {
    console.error(error);
    process.exit(1);
});
```

### API Reference

```ts
export interface MetamereConnector {
    /**
     * Add transactions
     * @param transactions Data to be registered in the blockchain
     * @param temporary Hold transaction pending until finalized
     */
    addTransactions(transactions: Array<Transaction>, temporary?: boolean): Promise<Array<string>|null>;

    /**
     * Finalize transactions
     * @param transactionIds Identifier of the transaction data
     */
    commitTransactions(transactionIds: Array<string>): Promise;

    /**
     * Retrieve transactions
     * @param condition Search condition
     * @param offset Offset of search index
     * @param limit Maximum number of search
     * @param timestampStart Start searching for timestamps
     * @param timestampEnd End searching for timestamps
     * @param timestampRequired Timestamping of search result transactions
     * @returns {Promise<Array<Transaction>|null>} Search results
     */
    getTransactions(condition: TransactionCondition, offset?: number, limit?: number, timestampStart?: number, timestampEnd?: number, timestampRequired?: boolean): Promise<Array<Transaction>|null>;
}
```


---

&copy; Takuro Okada