#!/usr/bin/env bash
set -e

if [ -z "$REMOTE" ]; then
    echo "Need to specify REMOTE address" >&2
    exit 1
fi


ssh $REMOTE "rm -rf /config/csv-server/ || true"
ssh $REMOTE "mkdir -p /config/csv-server/"
scp -r build/server/* $REMOTE:/config/csv-server

