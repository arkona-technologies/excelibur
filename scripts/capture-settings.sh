#!/usr/bin/env bash
set -euo pipefail

echo "Building TypeScript..."
npx tsc
node build/cli/capture-settings.js "$@"
