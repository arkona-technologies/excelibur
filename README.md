# Excelibur

**Excelibur** is a tool that converts Excel-based configuration sheets into machine-readable configuration data for **Arkona Technologies AT300 Processing Cards**.
It provides desktop, web, and CLI workflows for generating and applying AT300 configurations through familiar spreadsheet-based workflows.


## Overview

Excelibur reads structured Excel workbooks (based on the provided `AT300-XLSX-TEMPLATE.xlsx`) and translates their content into configuration commands that can be sent to an AT300 device.
These configurations typically include:

* Channel and core allocations
* Signal routing definitions
* Processing block parameters
* Network I/O and stream mappings

**Important:** Configure card-level PTP, clock sources, and genlock separately. Excelibur preserves these settings during deployment. Receiver timing behavior and release changes are documented in [CHANGELOG.md](CHANGELOG.md).

Current operator workflows:

* `Configure AT300s`
  Apply one or more Excelibur spreadsheet configuration files to one or more AT300 cards.
* `Generate AT300 Config Files`
  Use one reachable AT300 to generate sanitized `settings.json` snapshots for many spreadsheets.

## Spreadsheet Reference

Use the provided `AT300-XLSX-TEMPLATE.xlsx` workbook and keep the `PROC`, `TX`,
and `RX` sheet names and column headers unchanged. Blank rows are ignored.

### `PROC` — Processing and Routing

Each row defines one video or audio path from a source to an output. Physical
connector and IP resource IDs are zero-based AT300 indices.

| Column | Description |
| --- | --- |
| `source_id` | Source index. Its meaning is selected by `source_type`, for example SDI input 0 or IP video receiver 0. |
| `source_type` | Source resource: `SDI`, `IP-VIDEO`, `IP-AUDIO`, `PLAYER-VIDEO`, `PLAYER-AUDIO`, `SDI2SI`, `MADI`, or `VOID`. The source must be compatible with `flow_type`. |
| `name` | User-facing processing-chain name. If blank, Excelibur derives a name from the output and flow type. |
| `framesync_mode` | Required for `Video` rows whose source is `SDI`; it must be blank on every other row. Choices are `FramePhaser`, `FrameSync_Freeze`, and `FrameSync_Black`. Excelibur configures the native HBM SDI input frame synchronizer against genlock and de-embeds audio after frame sync. |
| `lut_name` | Optional 3D LUT name for a video chain. Blank disables color correction. If the requested LUT cannot be applied, Excelibur attempts its configured fallback LUT. |
| `delay_audio_ms` | Optional positive audio delay in milliseconds. Valid only for `Audio` rows. |
| `delay_video_frames` | Optional positive whole-frame DDR4 Replay delay. Valid only for `Video` rows and mutually exclusive with `delay_video_ms`. This is an additional buffered-frame count beyond Replay's inherent synchronization latency. |
| `delay_video_ms` | Optional positive DDR4 Replay delay in milliseconds. Valid only for `Video` rows and mutually exclusive with `delay_video_frames`. It requests a minimum total Replay latency; the AT300 rounds the effective delay up to a video-frame boundary. |
| `video_format` | Video bandwidth class: `1.5G`, `3G`, `6G`, or `12G`. Among other resource decisions, this sets the corresponding maximum-bandwidth constraint on DDR4 Replay delays. Replay delay memory includes blanking. |
| `splitter_phase` | Optional splitter output phase. Excelibur selects the phase modulo four; when used, the splitter path currently takes precedence over LUT and delay processing on that row. |
| `output_id` | Destination index selected by `output_type`, for example SDI output 0 or IP video transmitter 0. |
| `output_type` | Destination resource: `IP-VIDEO`, `IP-AUDIO`, `SDI`, or `MADI`. It must be compatible with `flow_type`. |
| `flow_type` | `Video` or `Audio`. This determines which sources, outputs, and delay columns are valid. |

If more than one video row references the same physical SDI input, all those
rows must specify the same `framesync_mode` because frame sync belongs to the
input interface rather than an individual processing chain.

DDR4 Replay always requires an internal delay mode. Excelibur uses
`FrameSync_Freeze`, assigns the card's genlock timing source, and writes both
capacity and output offset. For a time request, the AT300 accounts for Replay's
inherent synchronization latency and rounds the total to the applicable frame
boundary. For example, at 1080i50 a 25 ms request produces 40 ms total latency,
while a 55 ms request produces 80 ms total latency.

### `TX` — RTP Transmitters

Each row configures an RTP transmitter and its network session. TX has no
`sync` column; transmitter timing comes from the routed source's timing and
media-clock information.

| Column | Description |
| --- | --- |
| `id` | Zero-based transmitter index for the selected `stream_type`. Related video and ST 2110-40 rows use the same ID. |
| `label` | Transmitter and session name. Existing sessions with the same name are reused. |
| `stream_type` | `2110-20`, `2110-30`, `2110-40`, `2022-6`, `2042-20`, or `2110-22`. This selects video, audio, metadata, or compressed transport configuration. |
| `primary_destination_address` | Primary multicast/unicast destination IPv4 address. Blank disables the primary leg. |
| `primary_destination_port` | Primary UDP destination port. If an enabled destination has a blank port, Excelibur uses 9000. |
| `secondary_destination_address` | Optional secondary destination IPv4 address for redundant transport. Blank disables the secondary leg. |
| `secondary_destination_port` | Secondary UDP destination port; defaults to 9000 when the secondary destination is enabled and the port is blank. |
| `payload_type` | RTP payload type written to each enabled network leg. |
| `vlan_id` | VLAN used to select matching AT300 media interfaces. Blank means untagged. |

### `RX` — RTP Receivers

Each row configures an RTP receiver and its network session.

| Column | Description |
| --- | --- |
| `id` | Zero-based receiver index for the selected `stream_type`. Audio and video intended to be synchronized together use the same ID. |
| `label` | Receiver and session name. Existing sessions with the same name are reused. |
| `stream_type` | `2110-20`, `2110-30`, `2110-40`, `2022-6`, `2042-20`, or `2110-22`. |
| `sync` | `TRUE` or `FALSE`; blank defaults to `TRUE`. Synchronized video uses the AT300 PTP clock with frame-start alignment. Synchronized audio follows an allocated video receiver with the same ID using zero extra delay; if none exists, it falls back to ingress timing. `FALSE` selects ingress timing with a 4 ms read delay. |
| `uhd` | `TRUE` selects the UHD receiver capability; `FALSE` selects the up-to-3G capability. |
| `channel_capacity` | Audio receiver channel capacity. Blank defaults to 16; positive integers are accepted subject to firmware capacity. |
| `switch_type` | Receiver switching behavior: `Patch`, `MakeBeforeBreak`, or `BreakBeforeMake`. Blank defaults to `Patch`. |
| `vlan_id` | VLAN used to select matching AT300 media interfaces. Blank means untagged. |

All receivers use a 4 ms timing safety margin and a genlock-derived read speed.
The `sync` field selects receiver readout timing; it does not reconfigure the
card's PTP, clock-source, or genlock setup.


## Prerequisites

* **Node.js** (version ≥ 24 for local web/CLI use)
* **npm** (bundled with Node.js)
* A valid `.xlsx` configuration file that follows the `AT300-XLSX-TEMPLATE` structure
* Network reachability to the target AT300 card(s)


## Setup

Excelibur uses the AT300-hosted SDK tarballs for the currently targeted release. Update the SDK dependencies in `package.json` to point at a reachable AT300 running the intended software version:

```json
  "dependencies": {
    "vapi": "http://CHANGE-THIS-TO-YOUR-AT300/vapi.tar.gz",
    "vscript": "http://CHANGE-THIS-TO-YOUR-AT300/vscript.tar.gz",
    "vutil": "http://CHANGE-THIS-TO-YOUR-AT300/vutil.tar.gz",
  }
  ```

Install dependencies:

```bash
npm install --legacy-peer-deps 
```

Or use the setup script, which performs a clean install and a TypeScript build:

```bash
npm run setup
```

If setup fails in the compile step after updating the bladerunner SDK tarballs, make sure you are using the current SDK packages. The build now expects the newer `vapi` typings for merger and splitter video outputs.

## Desktop App

Launch the Electron desktop app:

```bash
npm run desktop
```

The desktop app embeds the local Excelibur server and opens the UI directly in an application window.

Current desktop packaging status:

* macOS packaging is set up as a `universal` build for releases
* one packaged app runs on both Intel and Apple Silicon Macs
* GitHub Releases are configured as the update feed

<p align="center">
  <img width="180" height="320" alt="Excelibur desktop application" src="https://github.com/user-attachments/assets/caa1d8a4-d40c-4538-a8b0-a0f9ff42dc53" />
</p>

## Local Web UI / Development Server

For day-to-day UI and logic development, the web server workflow is still useful and usually faster to iterate on than the packaged Electron app:

```bash
PORT=30001 npm run server
```

Then open:

```text
http://127.0.0.1:30001/
```

Recommended workflow:

* use `npm run server` while developing and debugging
* use `npm run desktop` for user-facing testing

## CLI Usage

### Apply One Workbook Directly

Transpile and run via Node:

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

### Generate `settings.json` Files For Multiple Workbooks

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
* wait 5 seconds by default after each configuration completes (configurable)
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
| `WAIT_SECONDS_BEFORE_CAPTURE` | Settling time before downloading settings, in whole seconds. Defaults to `5`; `0` disables the wait. |
| `SETTINGS_URL` | Override the settings download URL. Defaults to `<URL converted>/settings.json` |

The JSON sanitization step removes the `node_id_status` and `node_id_command` sections after each download. This is done to sanitize the NMOS UUID content in the captured `settings.json` snapshots before they are kept for comparison or reuse.

### Deployment Jobs Through The Shared SDK Runtime

For multi-card deployment through the server-side shared SDK/runtime path:

```bash
npm run deploy-jobs-with-sdk -- ./deployment-jobs.example.json
```

This path is what the desktop/web deployment UI uses internally.

Behavior:

* target cards are checked first
* the deployment batch expects one shared AT300 release across the batch
* the SDK is fetched once per release and reused
* deployment currently runs one card at a time for predictable behavior

## Notes

* The `.xlsx` file must follow the structure of the `AT300-XLSX-TEMPLATE`, including the `PROC`, `TX`, and `RX` sheet names, the expected headers, and compatible data formats.
* Invalid populated rows stop deployment with validation errors; blank rows are ignored. A failure after card writes may leave a partially applied configuration, without automatic rollback.
* Excelibur communicates via WebSocket — ensure the AT300 is reachable and configured to accept connections.
* Timing and synchronization (e.g., PTP) must be configured separately by the user.
