/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

export interface Block {
    version: string;
    index: bigint;
    timestamp: number;
    nonce: number;
    prevHash: string;
    hash: string;
    transactions: Array<object>;
}

export interface BlockQuery {
    direction: Direction;
    offset?: number;
    limit: number;
    timestampStart?: number;
    timestampEnd?: number;
    headerOnly: boolean;
    transactionCondition?: TransactionCondition|Array<TransactionCondition>;
}

/**
 * @example { conditions: { transactionId: "95c8608a-1445-4386-84e9-aace0314f9ac" }}
 *          { operation: "or", conditions: { recipientCompanyId: 1, inspectionCompanyId: 1 }}
 *          { operation: "between", conditions: { tradingDate: {begin: 1638284400000, end: 1638284400000 }}}
 */
export interface TransactionCondition {
    operation: Operation;
    ambiguous: boolean;
    conditions: object;
}

export type Direction = "backward"|"forward";

export type Operation = "and"|"or"|"between";