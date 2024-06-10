/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

import { EventEmitter } from "ws";
import { Setting } from "./setting";

export interface Server extends EventEmitter {

    get observers(): Array<string>;

    /**
     * Notify the observer of the message.
     */
    notify(message: object): void;

    /**
     * Close connections.
     */
    close(): void;
}

export interface Client extends EventEmitter {

    get url(): string|null;

    get isOpen(): boolean;

    get isOpening(): boolean;

    get isClosed(): boolean;

    send(message: object, errorHandler: function(Error):void, retry: number): void;

    close(): void;
}