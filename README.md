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
* **TypeScript**
* **npx** (bundled with npm)
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

This script will:

* run `npx tsc` once
* iterate over every `.xlsx` file in `./input` by default
* run `URL=... SHEET=... node build/main.js` for each workbook
* wait 5 seconds after each configuration completes
* download `http://172.16.220.211/settings.json`
* save the result as a `.json` file matching the workbook name

By default, `OUTPUT_DIR` is `./output`, so `./input/61-GW-101.xlsx` becomes `./output/61-GW-101.json`.

Optional environment variables:

| Variable       | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `INPUT_DIR`    | Directory containing the input `.xlsx` files. Defaults to `./input`       |
| `OUTPUT_DIR`   | Directory where the downloaded `.json` files are written. Defaults to `./output` |
| `SETTINGS_URL` | Override the settings download URL. Defaults to `<URL converted>/settings.json` |

## Note

* The `.xlsx` file must follow the structure of the `AT300-XLSX-TEMPLATE`, including sheet names, headers, and data formats.
* Incorrect or missing fields will trigger validation warnings or errors during execution.
* Excelibur communicates via WebSocket — ensure the AT300 is reachable and configured to accept connections.
* Timing and synchronization (e.g., PTP) must be configured separately by the user.


<p align="center">
  <img width="180" height="320" alt="image" src="https://github.com/user-attachments/assets/caa1d8a4-d40c-4538-a8b0-a0f9ff42dc53" />
</p>
