/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

import { Block, BlockQuery, Direction } from "./block";

export interface Storage {

    /**
     * Persist the block data.
     */
    storeBlock(block: Block): Promise<any>;

    /**
     * Restore the block data with the specified block number.
     */
    restoreBlock(index: bigint): Promise<Block>;

    /**
     * Obtain a list of block numbers.
     */
    getIndexes(limit: number, direction: Direction): Promise<Array<bigint>>;

    /**
     * Obtain the block number at the end.
     */
    getLastIndex(): Promise<Array<bigint>>;

    /**
     * Restore the block with the specified block number.
     */
    restoreBlocks(query: BlockQuery): Promise<Array<Block>>;

    /**
     * Terminate storage.
     */
    terminate(): void;
}