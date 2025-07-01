import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import {  enforce, enforce_nonnull, } from "vscript";
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
import xlsx from "node-xlsx";

let raw_config;
let tx_config;
let rx_config;
const excel = !!process.env["SHEET"]
  ? fs.readFileSync(enforce_nonnull(process.env["SHEET"]))
  : null;

if (excel) {
  const parsed_excel = xlsx.parse(excel);
  for (const sheet of parsed_excel) {
    console.log(`Parsing ${sheet.name}: ${sheet.data.length} lines`);
    const as_csv = sheet.data
      .filter((row, _idx, rows) => row.length == rows[0].length)
      .map((row) => row.join(","))
      .join("\n");
    if (sheet.name === "PROC") {
      raw_config = parse_csv(as_csv, ProcessingChainConfig);
    }
    if (sheet.name === "TX") {
      tx_config = parse_csv(as_csv, SenderConfig);
      console.log(tx_config);
    }
    if (sheet.name === "RX") {
      rx_config = parse_csv(as_csv, ReceiverConfig);
      console.log(rx_config);
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
enforce(!!raw_config && !!tx_config && !!rx_config)
const processors_config = refine_configs(raw_config);
const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;

await base(vm);
await setup_processing_chains(vm, processors_config);
await apply_senders_config(vm, tx_config);
await apply_receivers_config(vm, rx_config);

process.exit(0);
