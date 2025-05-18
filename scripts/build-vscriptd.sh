#!/bin/bash
#
rm -rf ./build/vscriptd
mkdir -p ./build/vscriptd
cp -r ./web ./build/vscriptd/web
cp ./package.json ./build/vscriptd/package.json
cp -r ./node_modules ./build/vscriptd/node_modules
rm -rf ./build/vscriptd/node_modules/vapi
rm -rf ./build/vscriptd/node_modules/vscript
rm -rf ./build/vscriptd/node_modules/vutil
cp -r ./src ./build/vscriptd/src
cd build/vscriptd
tar -czvf ../../blade-sheets.tar.gz *

