#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-}"
INPUT_DIR="${INPUT_DIR:-./input}"
OUTPUT_DIR="${OUTPUT_DIR:-./output}"
SETTINGS_URL="${SETTINGS_URL:-}"

print_help() {
  cat <<'EOF'
Usage:
  URL=ws://172.16.220.211 ./scripts/capture-settings.sh
  URL=ws://172.16.220.211 npm run capture-settings

Environment variables:
  URL
    WebSocket endpoint for the target card.
    Required.

  INPUT_DIR
    Directory containing input .xlsx files.
    Default: ./input

  OUTPUT_DIR
    Directory where downloaded .json files are written.
    Default: ./output

  SETTINGS_URL
    HTTP or HTTPS endpoint used to download settings.json after each run.
    Default: derived from URL by replacing ws:// with http:// and appending /settings.json.

Behavior:
  - Runs npx tsc once
  - Processes each .xlsx file in INPUT_DIR in sorted order
  - Runs node build/main.js for each workbook
  - Waits 5 seconds after each configuration completes
  - Downloads settings.json to OUTPUT_DIR using the workbook basename
  - Removes node_id_status and node_id_command from the downloaded JSON

Example:
  URL=ws://172.16.220.211 INPUT_DIR=./input OUTPUT_DIR=./output ./scripts/capture-settings.sh
EOF
}

sanitize_settings_json() {
  local file_path="$1"

  node - "$file_path" <<'EOF'
const fs = require("fs");

const filePath = process.argv[2];

const stripKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripKeys);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => key !== "node_id_status" && key !== "node_id_command")
      .map(([key, child]) => [key, stripKeys(child)]);
    return Object.fromEntries(entries);
  }

  return value;
};

const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
const sanitized = stripKeys(parsed);

fs.writeFileSync(filePath, `${JSON.stringify(sanitized, null, 2)}\n`);
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  print_help
  exit 0
fi

if [ -z "$URL" ]; then
  echo "Need to specify URL, for example URL=ws://172.16.220.211" >&2
  exit 1
fi

if [ -z "$SETTINGS_URL" ]; then
  SETTINGS_URL="${URL/ws:\/\//http://}"
  SETTINGS_URL="${SETTINGS_URL/wss:\/\//https://}"
  SETTINGS_URL="${SETTINGS_URL%/}/settings.json"
fi

if [ ! -d "$INPUT_DIR" ]; then
  echo "Input directory does not exist: $INPUT_DIR" >&2
  exit 1
fi

workbooks=()
while IFS= read -r workbook; do
  workbooks+=("$workbook")
done < <(find "$INPUT_DIR" -maxdepth 1 -type f -name '*.xlsx' | sort)

if [ "${#workbooks[@]}" -eq 0 ]; then
  echo "No .xlsx files found in $INPUT_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Building TypeScript..."
npx tsc

echo "Using settings source: $SETTINGS_URL"
echo "Processing ${#workbooks[@]} workbook(s) from $INPUT_DIR"

for workbook in "${workbooks[@]}"; do
  name="$(basename "$workbook" .xlsx)"
  output_file="$OUTPUT_DIR/$name.json"

  echo "Configuring card with $workbook"
  URL="$URL" SHEET="$workbook" node build/main.js

  echo "Waiting 5 seconds before downloading settings"
  sleep 5

  echo "Downloading settings to $output_file"
  curl --fail --silent --show-error "$SETTINGS_URL" --output "$output_file"

  echo "Removing node_id_status and node_id_command from $output_file"
  sanitize_settings_json "$output_file"
done

echo "Saved ${#workbooks[@]} settings snapshot(s) to $OUTPUT_DIR"
