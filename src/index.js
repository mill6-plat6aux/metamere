/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const FileSystem = require("fs");
const { Logger } = require("./util/logger");
const Assert = require("assert/strict");

const logger = new Logger();

const DEFAULT_SETTING_FILE_PATH = "settings/server.json";

process.on("uncaughtException", error => {
    logger.writeError(error.message + "\n" + error.stack);
});

let settings;
if(process.env.SETTINGS != null) {
    settings = JSON.parse(process.env.SETTINGS);
    if(typeof settings == "string") {
        settings = JSON.parse(FileSystem.readFileSync(settings, "utf8"));
    }
}else {
    settings = JSON.parse(FileSystem.readFileSync(DEFAULT_SETTING_FILE_PATH, "utf8"));
}
Assert(settings != null, "Setting file is not found.");
Assert(settings.consensusAlgorithm != null, "The consensusAlgorithm is not specified in the setting file.");
let Server;
if(settings.consensusAlgorithm == "Raft") {
    Server = require("./consensus/raft");
}else if(settings.consensusAlgorithm == "PoW") {
    Server = require("./consensus/pow");
}
Assert(Server != null);
new Server(settings);
