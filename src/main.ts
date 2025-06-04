import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import { Duration, enforce_nonnull, pause } from "vscript";
import { open_connection } from "./connection.js";
import { base } from "./base.js";
import {
  ProcessingChainConfig,
  ReceiverConfig,
  SenderConfig,
} from "./zod_types.js";
import { setup_processing_chains } from "./processors.js";
import { apply_receivers_config } from "./receivers.js";
import { apply_senders_config } from "./senders.js";

const processors = fs.readFileSync(
  enforce_nonnull(process.env["PROC"]),
  "utf8",
);
const tx = fs.readFileSync(enforce_nonnull(process.env["TX"]), "utf8");
const rx = fs.readFileSync(enforce_nonnull(process.env["RX"]), "utf8");

const processors_config = parse_csv(processors, ProcessingChainConfig);
const tx_config = parse_csv(tx, SenderConfig);
const rx_config = parse_csv(rx, ReceiverConfig);

const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;

await Promise.race([base(vm), pause(new Duration(2, "min"))]); // add timeout if no ptp present
await setup_processing_chains(vm, processors_config);
await apply_senders_config(vm, tx_config);
await apply_receivers_config(vm, rx_config);

process.exit(0);
