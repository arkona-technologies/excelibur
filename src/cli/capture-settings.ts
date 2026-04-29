import { run_batch_capture } from "../core/batch-capture.js";
import {
  derive_settings_url,
} from "../core/settings.js";

const PROGRESS_PREFIX = "__EXCELIBUR_PROGRESS__";

type Options = {
  url: string;
  input_dir: string;
  output_dir: string;
  settings_url: string;
  force: boolean;
  verbose: boolean;
};

let last_render_width = 0;

function render_progress(percent: number, label = "") {
  const bounded = Math.max(0, Math.min(100, percent));
  if (process.env["EXCELIBUR_PROGRESS"] === "1") {
    console.log(`${PROGRESS_PREFIX}|${bounded}|${label}`);
    return;
  }
  const width = 30;
  const filled = Math.floor((bounded * width) / 100);
  const bar = "#".repeat(filled);
  let line = "";
  if (bounded < 100) {
    const tail = "_".repeat(Math.max(0, width - filled - 1));
    line = `[${bar}>(${bounded.toString().padStart(3, " ")}%)${tail}] ${label}`;
  } else {
    const tail = "#".repeat(Math.max(0, width - filled));
    line = `[${bar}${tail}(${bounded.toString().padStart(3, " ")}%)] ${label}`;
  }

  const pad =
    last_render_width > line.length
      ? " ".repeat(last_render_width - line.length)
      : "";
  process.stdout.write(`\r${line}${pad}`);
  last_render_width = line.length;
}

function print_help() {
  console.log(`Usage:
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
`);
}

function parse_args(argv: string[]) {
  let force = process.env["FORCE"] === "1";
  let verbose = process.env["VERBOSE"] === "1";

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      print_help();
      process.exit(0);
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const url = process.env["URL"] ?? "";
  if (!url) {
    throw new Error("Need to specify URL, for example URL=ws://172.16.220.211");
  }

  return {
    url,
    input_dir: process.env["INPUT_DIR"] ?? "./input",
    output_dir: process.env["OUTPUT_DIR"] ?? "./output",
    settings_url: process.env["SETTINGS_URL"] ?? derive_settings_url(url),
    force,
    verbose,
  } satisfies Options;
}

async function main() {
  const options = parse_args(process.argv.slice(2));
  await run_batch_capture(options, {
    on_log: (message) => console.log(message),
    on_progress: (percent, label) => {
      render_progress(percent, label);
      if (process.env["EXCELIBUR_PROGRESS"] !== "1" && percent >= 100) {
        process.stdout.write("\n");
      }
    },
  });
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
