#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-}"
INPUT_DIR="${INPUT_DIR:-./input}"
OUTPUT_DIR="${OUTPUT_DIR:-./output}"
SETTINGS_URL="${SETTINGS_URL:-}"

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
done

echo "Saved ${#workbooks[@]} settings snapshot(s) to $OUTPUT_DIR"
