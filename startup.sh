#!/bin/bash

IMAGE_NAME="metamere"
CONTAINER_PREFIX="metamere"
NETWORK_NAME="metamere-network"

BLOCK_VERSION="1.0"

NODE_SIZE=5
NODE_PREFIX="N"
NETWORK_PROTOCOL="tcp"
SUBNET=10.1.0.
IP_BASE=0
IP_GATEWAY=254
SUBNET_MASK=24
NODE_PORT=9000
EXPORT_PORT_BASE=15000
STORAGE_TYPE="LevelDB"
ALGORITHM="Raft"
KEEPALIVE_INTERVAL=50
ELECTION_MAX_INTERVAL=300
ELECTION_MIN_INTERVAL=150

if [[ ! $(docker network ls -q -f name=$NETWORK_NAME) ]]; then
    docker network create --subnet $SUBNET$IP_BASE/$SUBNET_MASK $NETWORK_NAME --gateway $SUBNET$IP_GATEWAY
fi

if [[ ! $(docker ps -a -q -f ancestor=$IMAGE_NAME -f name=$CONTAINER_PREFIX) ]]; then
    for INDEX in $(seq 1 $NODE_SIZE); do
        NODE_NAME=$NODE_PREFIX$INDEX
        NODES_DEFINITION="["
        for NODE_INDEX in $(seq 1 $NODE_SIZE); do
            if [ $INDEX != $NODE_INDEX ]; then
                if [ ${#NODES_DEFINITION} -gt 1 ]; then
                    NODES_DEFINITION=$NODES_DEFINITION","
                fi
                NODES_DEFINITION=$NODES_DEFINITION"{\"id\": \"$NODE_PREFIX$NODE_INDEX\", \"url\": \"$NETWORK_PROTOCOL://$SUBNET$(($IP_BASE+$NODE_INDEX)):$NODE_PORT\"}"
            fi
        done
        NODES_DEFINITION=$NODES_DEFINITION"]"
        docker run -d --name $CONTAINER_PREFIX$INDEX -e "SETTINGS={\"blockVersion\": \"$BLOCK_VERSION\", \"id\": \"$NODE_NAME\", \"host\": \"$SUBNET$(($IP_BASE+$INDEX))\", \"port\": $NODE_PORT, \"storage\": \"$STORAGE_TYPE\", \"consensusAlgorithm\": \"$ALGORITHM\", \"keepaliveInterval\": $KEEPALIVE_INTERVAL, \"electionMaxInterval\": $ELECTION_MAX_INTERVAL, \"electionMinInterval\": $ELECTION_MIN_INTERVAL, \"indexKeys\": [\"transactionId\"], \"nodes\": $NODES_DEFINITION}" --network $NETWORK_NAME --ip $SUBNET$(($IP_BASE+$INDEX)) -p $(($EXPORT_PORT_BASE+$INDEX)):$NODE_PORT $IMAGE_NAME
    done
else
    docker start $(docker ps -a -q -f ancestor=$IMAGE_NAME -f name=$CONTAINER_PREFIX)
fi