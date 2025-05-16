#!/bin/bash
#
npx esbuild src/server.ts --bundle --platform=node --define:DEBUG=true --sourcemap --outfile=build/server.mjs --format=esm --banner:js='import {createRequire} from "module"; const require = createRequire(import.meta.url);'

