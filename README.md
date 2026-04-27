# Excelibur

**Excelibur** is a tool that converts Excel-based configuration sheets into machine-readable configuration data for **Arkona Technologies AT300 Processing Cards**.
It provides a convenient way to define and deploy AT300 configurations through familiar spreadsheet workflows.


## Overview

Excelibur reads structured Excel workbooks (based on the provided `AT300-XLSX-TEMPLATE.xlsx`) and translates their content into configuration commands that can be sent to an AT300 device.
These configurations typically include:

* Channel and core allocations
* Signal routing definitions
* Processing block parameters
* Network I/O and stream mappings

**Important:** Excelibur does *not* manage or configure timing parameters such as **PTP** or related synchronization settings. These must be set up separately by the end user.


## Usage

### 1. Prerequisites

* **Node.js** (version ≥ 18)
* **npm** (bundled with Node.js)
* A valid `.xlsx` configuration file that follows the `AT300-XLSX-TEMPLATE` structure


### 2. Build and Run

Update the bladerunner sdk dependencies to point at a local AT300 running the appropriate release.

```json
  "dependencies": {
    "vapi": "http://CHANGE-THIS-TO-YOUR-AT300/vapi.tar.gz",
    "vscript": "http://CHANGE-THIS-TO-YOUR-AT300/vscript.tar.gz",
    "vutil": "http://CHANGE-THIS-TO-YOUR-AT300/vutil.tar.gz",
  }
  ```
Install dependencies via your preferred package manager

```bash
npm install --legacy-peer-deps 
```

Or use the setup script, which performs a clean install with legacy peer dependency resolution and then runs the TypeScript build:

```bash
npm run setup
```

If setup fails in the compile step after updating the bladerunner SDK tarballs, make sure you are using the current SDK packages. The build now expects the newer `vapi` typings for merger and splitter video outputs.

Transpile and run via node

```bash
npx tsc && URL=ws://172.16.210.107 SHEET=./MY-AT300.xlsx node build/main.js
```

When a processing chain uses a LUT, Excelibur now applies the requested LUT through the VAPI connection and falls back to the default LUT if the write fails. It no longer depends on a separate HTTP lookup to `/cube`.

Sender and receiver session allocation is now idempotent across reruns. Excelibur still uses the spreadsheet label as the RTP session name, but before creating a new session it checks whether a session with that same name already exists on the card and reuses it. This prevents `NameAlreadyInUse` failures when a previous run created the session but the transmitter or receiver is no longer linked to it.

**Parameters:**

| Variable | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `URL`    | WebSocket endpoint for the AT300 card (e.g., `ws://172.16.210.107`) |
| `SHEET`  | Path to the Excel configuration file (`.xlsx`)                      |

### 3. Capture Settings For Multiple Workbooks

To configure a card with every `.xlsx` file in the input directory and save a `settings.json` snapshot after each run, use:

```bash
URL=ws://172.16.220.211 npm run capture-settings
```

To force reprocessing of every workbook even when matching output files already exist, use:

```bash
URL=ws://172.16.220.211 ./scripts/capture-settings.sh --force
```

To keep the old detailed per-row and per-step configuration output instead of the quieter progress display, use:

```bash
URL=ws://172.16.220.211 ./scripts/capture-settings.sh --verbose
```

To display the script help:

```bash
./scripts/capture-settings.sh --help
```

This script will:

* run `npx tsc` once
* iterate over every `.xlsx` file in `./input` by default
* run `URL=... SHEET=... node build/main.js` for each workbook
* show one terminal progress bar per workbook as each card moves from `0%` to `100%`
* skip any workbook whose matching `.json` output already exists, so reruns resume from failed items
* reprocess all workbooks when `--force` or `FORCE=1` is used
* hide the noisy underlying node/configuration logs by default, and restore the old raw output with `--verbose` or `VERBOSE=1`
* wait 5 seconds after each configuration completes
* download `settings.json` from the card specified by `URL` (or from `SETTINGS_URL` if it is set)
* sanitize the downloaded JSON by removing `node_id_status` and `node_id_command` to strip NMOS UUID-related metadata
* save the result as a `.json` file matching the workbook name

By default, `OUTPUT_DIR` is `./output`, so `./input/61-GW-101.xlsx` becomes `./output/61-GW-101.json`.

Optional environment variables:

| Variable       | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `INPUT_DIR`    | Directory containing the input `.xlsx` files. Defaults to `./input`       |
| `OUTPUT_DIR`   | Directory where the downloaded `.json` files are written. Defaults to `./output` |
| `FORCE`        | Set to `1` to process all workbooks even if matching `.json` files already exist. Defaults to `0` |
| `VERBOSE`      | Set to `1` to show the full underlying node/configuration output. Defaults to `0` |
| `SETTINGS_URL` | Override the settings download URL. Defaults to `<URL converted>/settings.json` |

The JSON sanitization step removes the `node_id_status` and `node_id_command` sections after each download. This is done to sanitize the NMOS UUID content in the captured `settings.json` snapshots before they are kept for comparison or reuse.

## Note

* The `.xlsx` file must follow the structure of the `AT300-XLSX-TEMPLATE`, including the `PROC`, `TX`, and `RX` sheet names, the expected headers, and compatible data formats.
* Incorrect or missing fields may cause rows to be rejected and skipped during parsing. Check the console output for the underlying validation errors.
* Excelibur communicates via WebSocket — ensure the AT300 is reachable and configured to accept connections.
* Timing and synchronization (e.g., PTP) must be configured separately by the user.


<p align="center">
  <img width="180" height="320" alt="image" src="https://github.com/user-attachments/assets/caa1d8a4-d40c-4538-a8b0-a0f9ff42dc53" />
</p>
