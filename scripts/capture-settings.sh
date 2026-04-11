#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-}"
INPUT_DIR="${INPUT_DIR:-./input}"
OUTPUT_DIR="${OUTPUT_DIR:-./output}"
SETTINGS_URL="${SETTINGS_URL:-}"
FORCE="${FORCE:-0}"
VERBOSE="${VERBOSE:-0}"
LAST_RENDER_WIDTH=0

render_progress() {
  local percent="$1"
  local label="${2:-}"
  local width=30
  local filled=0
  local bar=""
  local tail=""
  local line=""
  local line_width=0
  local pad=""

  if [ "$percent" -gt 100 ]; then
    percent=100
  fi
  if [ "$percent" -lt 0 ]; then
    percent=0
  fi

  filled=$(( percent * width / 100 ))
  printf -v bar '%*s' "$filled" ''
  bar="${bar// /#}"

  if [ "$percent" -lt 100 ]; then
    printf -v tail '%*s' "$(( width - filled - 1 ))" ''
    tail="${tail// /_}"
    line="[$bar>($(printf '%3d' "$percent")%)$tail] $label"
  else
    printf -v tail '%*s' "$(( width - filled ))" ''
    tail="${tail// /#}"
    line="[$bar$tail($(printf '%3d' "$percent")%)] $label"
  fi

  line_width=${#line}
  if [ "$LAST_RENDER_WIDTH" -gt "$line_width" ]; then
    printf -v pad '%*s' "$(( LAST_RENDER_WIDTH - line_width ))" ''
  fi

  printf '\r%s%s' "$line" "$pad"
  LAST_RENDER_WIDTH=$line_width
}

print_help() {
  cat <<'EOF'
Usage:
  URL=ws://172.16.220.211 ./scripts/capture-settings.sh
  URL=ws://172.16.220.211 npm run capture-settings
  URL=ws://172.16.220.211 ./scripts/capture-settings.sh --force
  URL=ws://172.16.220.211 ./scripts/capture-settings.sh --verbose

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

  FORCE
    When set to 1, process all workbooks even if matching output .json files already exist.
    Default: 0

  VERBOSE
    When set to 1, show the full underlying node/configuration output instead of only the progress display.
    Default: 0

Behavior:
  - Runs npx tsc once
  - Processes each .xlsx file in INPUT_DIR in sorted order
  - Runs node build/main.js for each workbook
  - Skips workbooks that already have matching output JSON unless --force or FORCE=1 is used
  - Hides the verbose node/configuration logs unless --verbose or VERBOSE=1 is used
  - Waits 5 seconds after each configuration completes
  - Downloads settings.json to OUTPUT_DIR using the workbook basename
  - Removes node_id_status and node_id_command from the downloaded JSON

Example:
  URL=ws://172.16.220.211 INPUT_DIR=./input OUTPUT_DIR=./output ./scripts/capture-settings.sh
  URL=ws://172.16.220.211 FORCE=1 ./scripts/capture-settings.sh
  URL=ws://172.16.220.211 VERBOSE=1 ./scripts/capture-settings.sh
EOF
}

run_workbook() {
  local workbook="$1"
  local name="$2"
  local run_log
  local line
  local marker_prefix="__EXCELIBUR_PROGRESS__|"
  local payload
  local percent
  local label

  if [ "$VERBOSE" = "1" ]; then
    echo "Configuring card with $workbook"
    URL="$URL" SHEET="$workbook" node build/main.js
    return
  fi

  run_log="$(mktemp "/tmp/excelibur-${name//[^A-Za-z0-9_.-]/_}.XXXXXX.log")"
  render_progress 0 "$name"

  if URL="$URL" SHEET="$workbook" EXCELIBUR_PROGRESS=1 node build/main.js 2>&1 | while IFS= read -r line; do
    printf '%s\n' "$line" >>"$run_log"
    case "$line" in
      "$marker_prefix"*)
        payload="${line#"$marker_prefix"}"
        percent="${payload%%|*}"
        label="${payload#*|}"
        render_progress "$percent" "$name: $label"
        ;;
    esac
  done; then
    render_progress 95 "$name: downloading settings"
    rm -f "$run_log"
    return
  fi

  printf '\n' >&2
  echo "Configuration failed for $name" >&2
  echo "Captured log: $run_log" >&2
  echo "Last 40 log lines:" >&2
  tail -n 40 "$run_log" >&2 || true
  exit 1
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      print_help
      exit 0
      ;;
    --force)
      FORCE=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_help >&2
      exit 1
      ;;
  esac
  shift
done

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

for ((i = 0; i < ${#workbooks[@]}; i++)); do
  workbook="${workbooks[$i]}"
  name="$(basename "$workbook" .xlsx)"
  output_file="$OUTPUT_DIR/$name.json"

  if [ "$FORCE" != "1" ] && [ -f "$output_file" ]; then
    if [ "$VERBOSE" = "1" ]; then
      echo "Skipping existing $name"
    else
      render_progress 100 "$name: skipped existing output"
    fi
    printf '\n'
    continue
  fi

  run_workbook "$workbook" "$name"

  if [ "$VERBOSE" = "1" ]; then
    echo "Waiting 5 seconds before downloading settings"
  else
    render_progress 96 "$name: waiting before download"
  fi
  sleep 5

  if [ "$VERBOSE" = "1" ]; then
    echo "Downloading settings to $output_file"
  else
    render_progress 97 "$name: downloading settings"
  fi
  curl --fail --silent --show-error "$SETTINGS_URL" --output "$output_file"

  if [ "$VERBOSE" = "1" ]; then
    echo "Removing node_id_status and node_id_command from $output_file"
  else
    render_progress 99 "$name: sanitizing"
  fi
  sanitize_settings_json "$output_file"
  if [ "$VERBOSE" != "1" ]; then
    render_progress 100 "$name: complete"
  fi
  printf '\n'
done

echo "Saved ${#workbooks[@]} settings snapshot(s) to $OUTPUT_DIR"
