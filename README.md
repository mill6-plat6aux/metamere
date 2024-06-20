<div align="center">
    <div><img src="images/logo.svg"/></div>
    <div>Ultra-lightweight Blockchain</div>
</div>

## Documents

* [Architecture](doc/architecture.md)
* [API](doc/api.md)


## System Requirement

* Node.js 16.0 later
* Docker 20.0 later


## Build

Execute the following command to generate a Docker image.
Modify the `Dockerfile` as necessary.

```sh
docker build -t metamere .
```


## Launch

The following command will create a Docker network called `metamere-network` and start up `5` metamere nodes.
To change the number of nodes or port numbers, open `startup.sh` and change the shell variable values.

```sh
./startup.sh
```


## Initialize

Execute the following command to generate the genesis block in the blockchain.
It must be executed before registering transaction data.
If you changed the port number in `startup.sh`, you must change it here as well.

```sh
./initialize.sh
```


## Add/Retrieve Transaction Data

See `examples` for information on registering data from a Node.js application.
The following command will set up the required libraries.

```sh
cd examples
npm install
```

The following command executes an example implementation of transaction data registration to the blockchain.

```sh
node write-transaction.js
```

The following command executes an example implementation of a transaction data reference to the blockchain.

```sh
node read-transactions.js
```


## Shutdown

The following command will stop all metamere nodes.

```sh
./shutdown.sh
```


## License

[MIT](LICENSE)


## Developers

[Takuro Okada](mill6.plat6aux@gmail.com)


---

&copy; Takuro Okada
