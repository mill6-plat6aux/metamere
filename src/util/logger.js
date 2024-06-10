/*!
 * Copyright 2017 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const { readFileSync, writeFile } = require("fs");

const LogLevel = {
    debug: 1,
    info: 2,
    warning: 3,
    error: 4,
    critical: 5
};
exports.LogLevel = LogLevel;

class Logger {

    #settingFile = "settings/log.json";

    #threshold = 2;

    #output;
    #errorOutput;

    /**
     * @param {string} [caller] 
     * @param {string} [settingFilePath]
     */
    constructor(caller, settingFilePath) {
        let settings;
        try {
            settings = JSON.parse(readFileSync(this.#settingFile, "utf8"));
        }catch(error) {
            settings = {
                threshold: "info"
            };
        }

        if(caller != null && settings[caller] != null) {
            let _settings = settings[caller];
            Object.keys(_settings).forEach(key => {
                settings[key] = _settings[key];
            });
        }

        if(settings.threshold != null && typeof settings.threshold == "string") {
            if(settings.threshold == "debug") {
                this.#threshold = LogLevel.debug;
            }else if(settings.threshold == "info") {
                this.#threshold = LogLevel.info;
            }else if(settings.threshold == "warning") {
                this.#threshold = LogLevel.warning;
            }else if(settings.threshold == "error") {
                this.#threshold = LogLevel.error;
            }else if(settings.threshold == "critical") {
                this.#threshold = LogLevel.critical;
            }
        }

        if(settings.output != null && typeof settings.output == "string") {
            this.#output = settings.output;
        }
        if(settings.errorOutput != null && typeof settings.errorOutput == "string") {
            this.#errorOutput = settings.errorOutput;
        }
    }

    writeLog(message, logLevel, force) {
        if(logLevel == undefined) {
            logLevel = 2;
        }
        if((force == undefined || !force) && logLevel < this.#threshold) {
            return;
        }
        message = this.dateString() + " " + message + "\n";
        if(this.#output !== undefined) {
            writeFile(this.#output, message, function(){});
        }else {
            process.stdout.write(message);
        }
    }
    
    writeError(message, logLevel, force) {
        if(logLevel == undefined) {
            logLevel = 4;
        }
        if((force == undefined || !force) && logLevel < this.#threshold) {
            return;
        }
        message = this.dateString() + " " + message + "\n";
        if(this.#errorOutput !== undefined) {
            writeFile(this.#errorOutput, message, function(){});
        }else {
            process.stderr.write(message);
        }
    }

    dateString() {
        let date = new Date();
        return date.getFullYear() + "/" + 
            ("00"+(date.getMonth()+1)).slice(-2) + "/" + 
            ("00"+date.getDate()).slice(-2) + " " + 
            ("00"+date.getHours()).slice(-2) + ":" + 
            ("00"+date.getMinutes()).slice(-2) + ":" + 
            ("00"+date.getSeconds()).slice(-2) + ":" + 
            ("000"+date.getMilliseconds()).slice(-3)
    }
}
exports.Logger = Logger;