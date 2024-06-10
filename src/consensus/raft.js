/*!
 * Copyright 2021 Takuro Okada.
 * Released under the MIT License.
 */

// @ts-check

const BlockchainServer = require("../server");
const { Logger, LogLevel } = require("../util/logger");
const AsyncLock = require("async-lock");

const RaftState = {
    Follower: 0,
    Candidate: 1,
    Leader: 2
}

/**
 * Implementation of Raft
 */
class Raft extends BlockchainServer {

    #logger = new Logger("Raft");

    // 自ノードID
    #id;

    // 自ノードの状態
    #state = RaftState.Follower;

    /// 投票したID
    #votedId;

    /// リーダーID
    #leaderId;

    /// 得票
    #votes = new Set();

    /// 接続可能なノードのID
    #nodes = [];

    /// タイムアウトID
    #timeoutId;

    /// キープアライブ間隔
    #keepaliveInterval = 50;

    /// 選挙期間
    #term = 0;

    // 投票期間（最大値と最小値の間のランダム値）
    #electionMaxInterval = 300;
    #electionMinInterval = 150;

    /// コンセンサス中のブロックシーケンス
    #provisionalBlocksequence = BigInt(0);

    /**
     * コンセンサスできなかったブロックシーケンス
     * @type {Array<BigInt>} 
     */
    #lostProvisionalBlocksequences = [];

    /**
     * コンセンサス中のブロック
     * @type {Map<BigInt, Object>} シーケンスとトランザクションのマップ
     */
    #provisionalBlocks = new Map();

    // リーダーでない場合に要求されたトランザクションを転送失敗した場合は保持しておく
    #transactionBacklog = [];
    #temporaryTransactionBacklog = [];
    #commitedTransactionBacklog = [];

    #lock = new AsyncLock();

    constructor(settings) {
        super(settings);

        this.#id = settings.id;
        this.#nodes = settings.nodes.map(entry => entry.id);
        this.#keepaliveInterval = settings.keepaliveInterval;
        this.#electionMaxInterval = settings.electionMaxInterval;
        this.#electionMinInterval = settings.electionMinInterval;
    }

    startConsensus() {
        this.heartbeat();
    }

    heartbeat() {
        if(this.#timeoutId != null) {
            clearTimeout(this.#timeoutId);
            this.#timeoutId = null;
        }
        let interval;
        if(this.#state == RaftState.Leader) {
            interval = this.#keepaliveInterval;
        }else {
            interval = Math.floor(Math.random()*(this.#electionMaxInterval - this.#electionMinInterval))+this.#electionMinInterval;
        }
        let self = this;
        this.#timeoutId = setTimeout(() => {
            if(self.terminated) return;
            if(self.#state == RaftState.Leader) {
                // 有権者へ自分の続投を伝える
                self.broadcast({command: "append", data: {id: self.#id, term: self.#term, sequence: self.#provisionalBlocksequence.toString()}});

                // ブロック候補チェック
                this.#watchProvisionalBlocks();
            }else {
                // 立候補
                self.#term = self.#term+1;
                self.#state = RaftState.Candidate;
                self.#votedId = self.#id;
                self.#votes.clear();
                self.#votes.add(self.#id);
                self.#leaderId = undefined;
                self.broadcast({command: "vote", data: {id: self.#id, term: self.#term}});
                this.#logger.writeLog("✋"+self.#id+" run for the leader in "+self.#term, LogLevel.debug);
            }
            self.heartbeat();
        }, interval);
    }

    async handleCommand(command, data, replyHandler) {
        // 立候補 Candidate -> All
        if(command == "vote") {
            if(data.id == null || data.term == null) return;
            if(this.#term > data.term) return;
            if(this.#term < data.term) {
                this.#term = data.term;
                this.#votedId = undefined;
            }
            // 既に投票済みなので否認送信
            if(this.#votedId != null && this.#votedId != data.id) {
                replyHandler({dataName: "voted", data: {granted: false, term: this.#term}});
                return;
            }
            // 投票
            this.#votedId = data.id;
            this.#state = RaftState.Follower;
            this.#logger.writeLog("👍"+this.#id+" voted for "+data.id+" in "+data.term, LogLevel.debug);
            replyHandler({dataName: "voted", data: {granted: true, from: this.#id, term: this.#term}});
            this.heartbeat();
        }
        // データ同期 Leader -> Follower
        else if(command == "append") {
            if(data.id == null || data.term == null) return;

            // 受信データの期間の方が大きい場合、新たなリーダーからの送信とみなす
            if(this.#term < data.term) {
                this.#state = RaftState.Follower;
                this.#term = data.term;
            }

            if(this.#term <= data.term) {
                this.#leaderId = data.id;
            }

            // 続投
            if(data.entry == null) {
                // CHANGED: リーダーがビジーになり、heatbeatが定刻に起動しなくなる
                // replyHandler({dataName: "appended", data: {from: this.#id, term: this.#term}});
            }else {
                // ブロック候補同期
                if(data.entry.type != null && data.entry.sequence != null && data.entry.transaction != null) {
                    let type = data.entry.type;
                    let sequence = BigInt(data.entry.sequence);
                    let transaction = data.entry.transaction;

                    // 既に同期済み
                    if(this.#provisionalBlocksequence >= sequence && !this.#lostProvisionalBlocksequences.includes(sequence)) {
                        replyHandler({dataName: "appended", data: {from: this.#id, term: this.#term, entry: {sequence: sequence.toString()}}});
                        this.#logger.writeLog("The transaction notification by "+data.id+" has been synchronized. "+"type:"+type+", sequence:"+sequence);
                        return;
                    }

                    // リーダーのシーケンスと同期
                    if(this.#provisionalBlocksequence < sequence) {
                        if(this.#provisionalBlocksequence+1n != sequence) {
                            for(let i=this.#provisionalBlocksequence+1n; i<sequence; i++) {
                                this.#lostProvisionalBlocksequences.push(i);
                            }
                        }
                        this.#provisionalBlocksequence = sequence;
                    }else if(this.#lostProvisionalBlocksequences.includes(sequence)) {
                        this.#lostProvisionalBlocksequences.splice(this.#lostProvisionalBlocksequences.indexOf(sequence), 1);
                    }

                    this.#provisionalBlocks.set(sequence, {transaction: transaction, type: type, consensus: 1, owner: data.id});
                    replyHandler({dataName: "appended", data: {from: this.#id, term: this.#term, entry: {sequence: sequence.toString()}}});
                    this.#logger.writeLog("received the transaction notification by "+data.id+". "+"type:"+type+", sequence:"+sequence, LogLevel.debug);
                }
                // ブロック生成指示
                else if(data.entry.sequences != null) {
                    if(data.entry.sequences.length == 0) return;

                    // 既にブロック生成済み
                    let invalidIndex = data.entry.sequences.findIndex(sequence => {
                        return this.#provisionalBlocks.get(BigInt(sequence)) == null;
                    });
                    if(invalidIndex != -1) {
                        this.#logger.writeLog("The block notification by "+data.id+" has been synchronized. sequences:"+data.entry.sequences.join(","));
                        return;
                    }

                    this.#lock.acquire("block", async done => {
                        // 既にブロック生成済み
                        let invalidIndex = data.entry.sequences.findIndex(sequence => {
                            return this.#provisionalBlocks.get(BigInt(sequence)) == null;
                        });
                        if(invalidIndex != -1) {
                            this.#logger.writeLog("The block notification by "+data.id+" has been synchronized. sequences:"+data.entry.sequences.join(","));
                            done();
                            return;
                        }

                        data.entry.sequences.forEach(sequence => {
                            let _sequence = BigInt(sequence);
                            let entry = this.#provisionalBlocks.get(_sequence);
                            let transaction = entry.transaction;
                            let type = entry.type;
                            if(type == "normal") {
                                this.addTransaction(transaction);
                            }else if(type == "temporary") {
                                this.addTransaction(transaction, true);
                            }else if(type == "commit") {
                                this.commitTransaction(transaction);
                            }
                            this.#provisionalBlocks.delete(_sequence);
                        });
                        await this.#createBlock();
                        await this.notifyLastBlock();
                        this.#logger.writeLog("received the block notification by "+data.id+". sequences:"+data.entry.sequences);
                        // replyHandler({dataName: "appended", data: {from: this.#id, term: this.#term, entry: {sequences: data.entry.sequences}}});
                        done();
                    });
                }
            }
            this.heartbeat();
        }
        // トランザクションデータ追加 Client -> All
        else if(command == "addTransaction") {
            if(data == undefined) return;
            if(typeof(data) != "object") return;
            this.#addTransaction(data);
        }
        // 暫定トランザクションデータ追加 Client -> All
        else if(command == "addTemporaryTransaction") {
            if(data == undefined) return;
            if(typeof(data) != "object") return;
            this.#addTransaction(data, true);
        }
        // 暫定トランザクションデータ確定 Client -> All
        else if(command == "commitTransaction") {
            if(typeof(data) != "object") return;
            this.#commitTransaction(data);
        }
        // 診断データ取得 Client -> All
        else if(command == "getDiagnostics") {
            replyHandler(this.#getDiagnostics());
        }
        else {
            super.handleCommand(command, data, replyHandler);
        }
    }

    async handleData(dataName, data) {
        // 投票 All -> Candidate
        if(dataName == "voted") {
            if(data.granted == null || !data.granted || data.from == null) return;
            if(data.term == null) return;
            if(this.#term > data.term) return;
            if(this.#state != RaftState.Candidate) return;
            this.#votes.add(data.from);
            this.#logger.writeLog("💌"+this.#id+" is voted from "+data.from+" in "+data.term, LogLevel.debug);

            // 過半数に達したらリーダーへ昇格
            if(this.#votes.size >= Math.floor((this.#nodes.length+1)/2)+1) {
                this.#state = RaftState.Leader;
                this.broadcast({command: "append", data: {id: this.#id, term: this.#term}});
                this.heartbeat();
                this.#logger.writeLog("👑"+this.#id+" become the leader of term "+this.#term+". voted:"+this.#votes.size, LogLevel.info);
            }
        }
        // データ同期済み通知 Follower -> Leader
        else if(dataName == "appended") {
            if(data.from == null) return;
            if(data.entry != null) {
                // ブロック候補同期済み通知
                if(data.entry.sequence != null) {
                    let entry = this.#provisionalBlocks.get(BigInt(data.entry.sequence));
                    if(entry == null) return;
                    entry.consensus++;
                    this.#provisionalBlocks.set(BigInt(data.entry.sequence), entry);
    
                    this.#watchProvisionalBlocks();
                }
                // ブロック生成完了通知
                // else if(data.entry.sequences != null) {
                // }
            }
        }else if(dataName == "transaction" || dataName == "committedTransaction") {
            // これらのデータは使用しない（appendコマンドで同期する）
            return;
        }else {
            super.handleData(dataName, data);
        }
    }

    async #watchProvisionalBlocks() {
        if(this.#provisionalBlocks.size == 0) return;
        return this.#lock.acquire("block", async done => {
            if(this.#provisionalBlocks.size == 0) {
                done();
                return;
            }

            // ブロック候補の同期済みチェック
            let completedSequenceList = [];
            let unprocessedSequenceList = [];
            this.#provisionalBlocks.forEach((entry, sequence, map) => {
                // 同期済みであれば（過半数に達したら）トランザクション追加
                if(entry.consensus >= Math.floor((this.#nodes.length+1)/2)+1) {
                    let transaction = entry.transaction;
                    let type = entry.type;
                    if(type == "normal") {
                        this.addTransaction(transaction);
                    }else if(type == "temporary") {
                        this.addTransaction(transaction, true);
                    }else if(type == "commit") {
                        this.commitTransaction(transaction);
                    }
                    map.delete(sequence);
                    completedSequenceList.push(sequence.toString());
                }else if(entry.owner != this.#id) {
                    unprocessedSequenceList.push(sequence.toString());
                }
            });

            // 同期済みのブロック候補があれば、ブロック生成を通知し、自ノードでブロック生成
            if(completedSequenceList.length > 0) {
                this.broadcast({command: "append", data: {id: this.#id, term: this.#term, entry: {sequences: completedSequenceList}}});
                await this.#createBlock();
                await this.notifyLastBlock();
                this.#logger.writeLog(this.#id+" ["+this.#provisionalBlocksequence+"]"+" created a new block. "+completedSequenceList.join(","));
            }

            // 未処理のブロック候補があれば、再度同期開始
            if(unprocessedSequenceList.length > 0) {
                unprocessedSequenceList.forEach(sequence => {
                    let entry = this.#provisionalBlocks.get(BigInt(sequence));
                    if(entry == null) return;
                    entry.consensus = 0;
                    entry.owner = this.#id;
                    let transaction = entry.transaction;
                    let type = entry.type;
                    this.broadcast({command: "append", data: {id: this.#id, term: this.#term, entry: {sequence: sequence, transaction: transaction, type: type}}});

                    this.#logger.writeLog("resend append "+sequence+" "+(Array.isArray(transaction) ? transaction[0].transactionId : transaction.transactionId), LogLevel.debug);
                });
            }

            done();
        });
    }

    async #createBlock() {
        try {
            return await this.blockchain.commitBlock();
        }catch(error) {
            this.#logger.writeError("failed to commit the block. "+error.message);
        }
    }

    /**
     * @param {Array<object>|object} request 
     * @param {boolean} [temporary]
     */
    #addTransaction(request, temporary) {
        if(this.#state == RaftState.Leader) {
            this.#logger.writeLog("New transaction is received.", LogLevel.info);
            // リーダだったら仮のブロックを生成
            this.#provisionalBlocksequence++;
            let type = temporary == null || !temporary ? "normal" : "temporary";
            this.#provisionalBlocks.set(this.#provisionalBlocksequence, {transaction: request, type: type, consensus: 0, owner: this.#id});
            this.broadcast({command: "append", data: {id: this.#id, term: this.#term, entry: {sequence: this.#provisionalBlocksequence.toString(), transaction: request, type: type}}});
            this.heartbeat();

            this.#logger.writeLog("send append "+this.#provisionalBlocksequence+" "+(Array.isArray(request) ? request[0].transactionId : request.transactionId), LogLevel.debug);
        }else {
            if(!Array.isArray(request)) {
                request = [request];
            }
            if(temporary == null || !temporary) {
                request.forEach(entry => {
                    this.#transactionBacklog.push(entry);
                });
            }else {
                request.forEach(entry => {
                    this.#temporaryTransactionBacklog.push(entry);
                });
            }
            if(this.#leaderId != null) {
                this.#forwardTransaction();
            }else {
                this.#waitAndForwardTransaction();
            }
        }
    }

    #waitAndForwardTransaction() {
        setTimeout(() => {
            if(!this.#forwardTransaction()) {
                this.#waitAndForwardTransaction();
            }
        }, this.#electionMaxInterval);
    }

    #forwardTransaction() {
        if(this.#leaderId == null) return false;
        if(this.#leaderId == this.#id) return true;

        let transactions = [];
        this.#transactionBacklog.forEach(entry => {
            transactions.push(entry);
        });
        this.#transactionBacklog = [];

        let temporaryTransactions = [];
        this.#temporaryTransactionBacklog.forEach(entry => {
            temporaryTransactions.push(entry);
        });
        this.#temporaryTransactionBacklog = [];

        let self = this;

        // リーダー以外はリーダーへトランザクションを転送
        if(transactions.length > 0) {
            this.sendMessageToNode({command: "addTransaction", data: transactions}, this.#leaderId, error => {
                // エラーの場合再登録
                for(let i=transactions.length-1; i>0; i--) {
                    self.#transactionBacklog.splice(0, 0, transactions[i]);
                }
            });
            this.#logger.writeLog("New transaction is forwarded to the leader.", LogLevel.info);
        }

        if(temporaryTransactions.length > 0) {
            this.sendMessageToNode({command: "addTemporaryTransaction", data: temporaryTransactions}, this.#leaderId, error => {
                // エラーの場合再登録
                for(let i=temporaryTransactions.length-1; i>0; i--) {
                    self.#temporaryTransactionBacklog.splice(0, 0, temporaryTransactions[i]);
                }
            });
            this.#logger.writeLog("New transaction is forwarded to the leader.", LogLevel.info);
        }

        return true;
    }

    #commitTransaction(request) {
        if(this.#state == RaftState.Leader) {
            this.#logger.writeLog("New commit of transaction is received.", LogLevel.info);
            // リーダだったら仮のブロックを生成
            this.#provisionalBlocksequence++;
            this.#provisionalBlocks.set(this.#provisionalBlocksequence, {transaction: request, type: "commit", consensus: 0, owner: this.#id});
            this.broadcast({command: "append", data: {id: this.#id, term: this.#term, entry: {sequence: this.#provisionalBlocksequence.toString(), transaction: request, type: "commit"}}});
            this.heartbeat();
        }else {
            if(!Array.isArray(request)) {
                request = [request];
            }
            request.forEach(entry => {
                this.#commitedTransactionBacklog.push(entry);
            });
            if(this.#leaderId != null) {
                this.#forwardCommittingTransaction();
            }else {
                this.#waitAndForwardCommittingTransaction();
            }
        }
    }

    #waitAndForwardCommittingTransaction() {
        setTimeout(() => {
            if(!this.#forwardCommittingTransaction()) {
                this.#waitAndForwardCommittingTransaction();
            }
        }, this.#electionMaxInterval);
    }

    #forwardCommittingTransaction() {
        if(this.#commitedTransactionBacklog.length == 0) return true;
        if(this.#leaderId == null) return false;
        if(this.#leaderId == this.#id) return true;

        let transactionIds = [];
        this.#commitedTransactionBacklog.forEach(entry => {
            transactionIds.push(entry);
        });
        this.#commitedTransactionBacklog = [];

        let self = this;
        
        // リーダー以外はリーダーへトランザクションを転送
        this.sendMessageToNode({command: "commitTransaction", data: transactionIds}, this.#leaderId, error => {
            for(let i=transactionIds.length-1; i>0; i--) {
                self.#commitedTransactionBacklog.splice(0, 0, transactionIds[i]);
            }
        });
        this.#logger.writeLog("New commit of transaction is forwarded to the leader.", LogLevel.info);

        return true;
    }

    #getDiagnostics() {
        let diagnostics = {};
        diagnostics.observers = this.server != null ? this.server.observers : null;

        let state;
        if(this.#state == RaftState.Leader) {
            state = "Leader";
        }else if(this.#state == RaftState.Follower) {
            state = "Follower";
        }else if(this.#state == RaftState.Candidate) {
            state = "Candidate";
        }
        diagnostics.state = state;
        
        diagnostics.leaderId = this.#leaderId;
        diagnostics.term = this.#term;
        diagnostics.provisionalBlocksequence = this.#provisionalBlocksequence.toString();

        let provisionalBlocks = [];
        this.#provisionalBlocks.forEach((entry, sequence) => {
            provisionalBlocks.push({sequence: sequence.toString(), entry: entry});
        });
        diagnostics.provisionalBlocks = provisionalBlocks;

        diagnostics.transactionBacklog = this.#transactionBacklog;
        diagnostics.temporaryTransactionBacklog = this.#temporaryTransactionBacklog;
        diagnostics.commitedTransactionBacklog = this.#commitedTransactionBacklog;

        return diagnostics;
    }

    terminate() {
        super.terminate();

        if(this.#timeoutId != null) {
            clearTimeout(this.#timeoutId);
            this.#timeoutId = null;
        }
    }
}

module.exports = Raft;
