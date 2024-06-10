/*!
 * Copyright 2024 Takuro Okada.
 * Released under the MIT License.
 */

export interface Setting {
    blockVersion: string;
    id: string;
    host: string;
    port: number;
    protocol: Protocol;
    consensusAlgorithm: ConsensusAlgorithm;
    consensusInterval: number;
    storage: StorageType;
    storagePath: string;
    indexKeys: Array<string>;
    nodes: Array<NodeSetting>;
    privateKey: string;
    certificate: string;
    rootCertificates: Array<string>;
}

export interface NodeSetting {
    id: string;
    url: string;
}

export type Protocol = "tcp"|"tls"|"ws";
export type ConsensusAlgorithm = "Raft" | "Simple";
export type StorageType = "LevelDB" | "Simple";