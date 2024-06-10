/*!
 * Copyright 2017 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

/**
 * @param {object} data 
 * @returns {string}
 */
exports.serialize = function(data) {
    return JSON.stringify(data, (key, value) => {
        if(typeof value == "bigint") {
            return value.toString();
        }
        return value;
    });
};

/**
 * @param {string} data 
 * @returns {object}
 */
exports.deserialize = function(data) {
    return JSON.parse(data, (key, value) => {
        if(key == "index" && /^[0-9]+$/.test(value)) {
            return BigInt(value);
        }
        return value;
    });
};