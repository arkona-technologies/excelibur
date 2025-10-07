
# Excelibur

**Excelibur** is a tool that converts Excel-based configuration sheets into machine-readable configuration data for **Arkona Technologies AT300 Processing Cards**.
It provides a convenient way to define and deploy AT300 configurations through familiar spreadsheet workflows.


## 🧩 Overview

Excelibur reads structured Excel workbooks (based on the provided `AT300-XLSX-TEMPLATE.xlsx`) and translates their content into configuration commands that can be sent to an AT300 device.
These configurations typically include:

* Channel and core allocations
* Signal routing definitions
* Processing block parameters
* Network I/O and stream mappings

**Important:** Excelibur does *not* manage or configure timing parameters such as **PTP** (Precision Time Protocol) or related synchronization settings. These must be set up separately by the end user on the device or network.


## 🚀 Usage

### 1. Prerequisites

* **Node.js** (version ≥ 18)
* **TypeScript**
* **npx** (bundled with npm)
* A valid `.xlsx` configuration file that follows the `AT300-XLSX-TEMPLATE` structure


### 2. Build and Run

```bash
npx tsc && URL=ws://172.16.210.107 SHEET=./MY-AT300.xlsx node build/main.js
```

**Parameters:**

| Variable | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `URL`    | WebSocket endpoint for the AT300 card (e.g., `ws://172.16.210.107`) |
| `SHEET`  | Path to the Excel configuration file (`.xlsx`)                      |


### 3. Example Workflow

1. Fill out the configuration in Excel using the provided `AT300-XLSX-TEMPLATE.xlsx`.
2. Save your customized file (e.g., `MY-AT300.xlsx`).
3. Run Excelibur with the command above.
4. Excelibur reads the Excel file, validates the data, and transmits configuration commands to the specified AT300 device.
5. The AT300 applies and confirms the configuration in real time.


## 🧠 Notes

* The `.xlsx` file must follow the structure of the `AT300-XLSX-TEMPLATE`, including sheet names, headers, and data formats.
* Incorrect or missing fields will trigger validation warnings or errors during execution.
* Excelibur communicates via WebSocket — ensure the AT300 is reachable and configured to accept connections.
* Timing and synchronization (e.g., PTP) must be configured separately by the user.


## 📄 License

TODO
