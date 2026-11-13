# Changelog

## Unreleased

- Add a spreadsheet template download button and bundle `Excelibur_Template.xlsx` with the desktop app; desktop users can save a copy through a native Save dialog.
- Rename the distributed template to `Excelibur_Template.xlsx` and update README references.
- Show prominent error summaries with one validation error per line, including underlying runtime errors instead of generic process exit codes.
- Collect independent workbook validation errors across PROC, TX, and RX, including processor framesync and delay rules, before applying configuration.
- Scroll to deployment progress on submission, to a green completion message on success, and to the error summary on failure.

## 2.9.2 — 2026-11-12

### SDI frame sync and processing delays

- Add native HBM frame-sync configuration for SDI video inputs through the required `framesync_mode` processor column. Supported modes are `FramePhaser`, `FrameSync_Freeze`, and `FrameSync_Black`; Excelibur uses the card's genlock source and de-embeds audio after frame sync.
- Require `framesync_mode` to be blank for non-SDI and audio rows, and reject conflicting modes when multiple video rows share one physical SDI input.
- Separate optional processing delay from SDI input synchronization. Video chains accept either `delay_video_frames` or `delay_video_ms`, while audio chains use `delay_audio_ms`; the obsolete `delay_frames` and `delay_audio` columns are rejected.
- Configure DDR4 Replay video delays with `FrameSync_Freeze`, the bandwidth corresponding to `video_format`, blanking included, and the card's genlock timing source.
- Apply Replay offsets after connecting their video source so the device can derive the active input standard.
- Accept Replay delay commands without the SDK's default offset-status validator. The status reports additional buffered delay but excludes inherent frame-sync latency, so valid time requests otherwise time out.
- Document the verified AT300 delay semantics: frame values request additional buffered frames, while millisecond values request a minimum total Replay latency that is rounded up to a frame boundary.
- Validate the feature on AT300 2.9.1648: `FrameSync_Freeze` retained the final frame, `FrameSync_Black` produced black, both preserved output standard and timing after physical input loss, and frame/time Replay delays matched their configured commands.

### Spreadsheet documentation

- Document every distributed `PROC`, `TX`, and `RX` template column, its accepted values, defaults, conditional validation, timing behavior, and delay semantics in the public README.

## 2.9.1 — 2026-11-11

### Timing

- Preserve existing PTP agents, clock sources, genlock, master-clock and time-flow configuration during deployment cleanup.
- Remove the forced internal-oscillator/freerun setting and the automatic system-clock and LTC overrides.
- Use a 4 ms receiver safety margin for both audio and video, matching the AT300 2.9.1648 GUI default.
- Increase audio IngressPlusX read delay from 2 ms to 4 ms. Video IngressPlusX remains at 4 ms.
- Correct RX `sync=false` parsing. Video `sync=true` still selects FrameStart/PTP; audio `sync=true` follows an existing video receiver with the same ID, otherwise using IngressPlusX.

### Receiver timing reference

The RX sheet’s `sync` field accepts `true` or `false` (case-insensitive). A blank
or omitted value defaults to `true`. Explicit `false` values are now honored;
older builds incorrectly treated the text `false` as enabled.

| Receiver | `sync` | Timing behavior |
| --- | --- | --- |
| Video | `false` | IngressPlusX, 4 ms read delay |
| Video | `true` | FrameStart aligned to the card’s PTP Clock |
| Audio | `false` | IngressPlusX, 4 ms read delay |
| Audio | `true` | Follow the video receiver with the same ID using ForeignReadDelay and zero extra delay; fall back to IngressPlusX at 4 ms if that video receiver does not exist |

Both audio and video receivers use a **4 ms safety margin**, matching the AT300
2.9.1648 GUI default. Safety margin and read delay are separate parameters.
Excelibur does not switch the card to freerun or recreate its timing sources.

Blank `channel_count` cells default to 16. Receiver `channel_capacity` defaults
to 16 and accepts positive integers; Excelibur does not restrict it to the GUI’s
16/32/48/64/80 presets. Firmware determines supported capacities.

### Spreadsheet validation and deployment

- Accept blank VLAN cells as untagged rather than silently dropping transmitter/receiver rows.
- Apply defaults for blank channel counts and optional fields; retain configurable receiver channel capacities.
- Preserve commas, quotes and newlines in XLSX cell values and support quoted CSV fields.
- Reject invalid populated rows with sheet/row/field diagnostics before configuring the card. Ignore blank rows and refuse to deploy a workbook containing no configuration rows.
- Check required network interfaces before full-workbook cleanup. Each configured transmitter destination needs a matching IPv4 interface; receivers need at least one matching media interface.
- Refresh interface assignments for reused sessions in individual sender/receiver configuration updates. Combine video/ANC network legs sharing a transmitter and reject conflicting VLANs.
- Propagate processing and receiver-capability failures instead of reporting successful partial configuration. Failures after writes do not automatically restore the previous configuration.

### Runtime and desktop

- Pass the selected batch-capture settling time through the SDK runtime to the capture process. CLI users can set `WAIT_SECONDS_BEFORE_CAPTURE` (default: 5 seconds).
- Use native Electron file/folder dialogs in desktop builds, including Linux.
- Correct forced termination of runtime children that do not exit after the first shutdown signal.
- Document Node.js 24 or newer for local web/CLI use, and add an `npm test` regression suite.

### Validation

- Regression coverage includes parsing, interface preflight, processing errors, timing preservation, capture delay, desktop dialog routing and child termination.
- Timing preservation was confirmed by a user test on an AT300: external PTP remained configured after deployment.
- The 15 regression tests pass. Packaged SDK/runtime imports were checked for all three platforms using Electron on the build Mac. The signed universal Mac executable passed the packaged web-UI check.
- Native Windows/Linux and Apple Silicon GUI testing remains outstanding.
