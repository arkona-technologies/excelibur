import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import { enforce, enforce_nonnull } from "vscript";
import { open_connection } from "./connection.js";
import { base } from "./base.js";
import {
  ProcessingChainConfig,
  ReceiverConfig,
  refine_config as refine_configs,
  SenderConfig,
} from "./zod_types.js";
import { setup_processing_chains } from "./processors.js";
import { apply_receivers_config } from "./receivers.js";
import { apply_senders_config } from "./senders.js";
import {
  create_progress_reporter,
  create_step_progress_reporter,
} from "./progress.js";
import xlsx from "node-xlsx";

let raw_config;
let tx_config;
let rx_config;
const progress = create_progress_reporter();
const excel = !!process.env["SHEET"]
  ? fs.readFileSync(enforce_nonnull(process.env["SHEET"]))
  : null;

progress?.(0, "starting");

if (excel) {
  const parsed_excel = xlsx.parse(excel);
  for (const sheet of parsed_excel) {
    console.log(`Parsing ${sheet.name}: ${sheet.data.length} lines`);
    const as_csv = sheet.data
      .filter((row) => row.length > 0)
      .map((row) => row.join(","))
      .join("\n");
    if (sheet.name === "PROC") {
      raw_config = parse_csv(as_csv, ProcessingChainConfig);
    }
    if (sheet.name === "TX") {
      tx_config = parse_csv(as_csv, SenderConfig);
    }
    if (sheet.name === "RX") {
      rx_config = parse_csv(as_csv, ReceiverConfig);
    }
  }
}
if (!excel) {
  const processors = fs.readFileSync(
    enforce_nonnull(process.env["PROC"]),
    "utf8",
  );
  const tx = fs.readFileSync(enforce_nonnull(process.env["TX"]), "utf8");
  const rx = fs.readFileSync(enforce_nonnull(process.env["RX"]), "utf8");

  raw_config = parse_csv(processors, ProcessingChainConfig);
  tx_config = parse_csv(tx, SenderConfig);
  rx_config = parse_csv(rx, ReceiverConfig);
}
enforce(!!raw_config && !!tx_config && !!rx_config);
progress?.(5, "parsed workbook");
const processors_config = refine_configs(raw_config);
const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;
progress?.(10, "connected");

await base(vm);
progress?.(20, "base setup");
await setup_processing_chains(
  vm,
  processors_config,
  create_step_progress_reporter(progress, 20, 70),
);
await apply_senders_config(
  vm,
  tx_config,
  create_step_progress_reporter(progress, 70, 85),
);
await apply_receivers_config(
  vm,
  rx_config,
  create_step_progress_reporter(progress, 85, 95),
);
progress?.(95, "configured");

process.exit(0);
