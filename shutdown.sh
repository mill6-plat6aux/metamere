#!/bin/bash

IMAGE_NAME="metamere"

docker stop $(docker ps -a -q -f ancestor=$IMAGE_NAME)