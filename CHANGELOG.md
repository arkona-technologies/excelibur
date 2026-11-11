# Changelog

## Unreleased — release-2.9

### Timing

- Preserve existing PTP agents, clock sources, genlock, master-clock and time-flow configuration during deployment cleanup.
- Remove the forced internal-oscillator/freerun setting and the automatic system-clock and LTC overrides.
- Use a 4 ms receiver safety margin for both audio and video, matching the AT300 2.9.1648 GUI default.
- Increase audio IngressPlusX read delay from 2 ms to 4 ms. Video IngressPlusX remains at 4 ms.
- Correct RX `sync=false` parsing. Video `sync=true` still selects FrameStart/PTP; audio `sync=true` follows an existing video receiver with the same ID, otherwise using IngressPlusX.

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
- New desktop installers have not been built or published for these changes. Receiver defaults and platform behavior still require release smoke testing.
