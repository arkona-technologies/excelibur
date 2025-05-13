import { z } from "zod";
import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import { enforce_nonnull } from "vscript";
import { open_connection } from "./connection.js";
import { base } from "./base.js";

function shorten_label(label: string): string {
  const new_label = label
    .toLowerCase()
    .trim()
    .split(/[^a-zA-Z0-9]/g)
    .map((word) => word.replace(/[aeiou]/g, "")) // remove vowels
    .map((word) => word);
  return new_label.join("").substring(0, 28);
}

const StreamType = z.enum([
  "2110-20",
  "2110-30",
  "2110-40",
  "2042-20",
  "2022-6",
  "2110-22",
]);
const SwitchType = z
  .enum(["Patch", "MakeBeforeBreak", "BreakBeforeMake"])
  .default("Patch");

const SenderConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  name: z.string(),
  stream_type: StreamType,
  primary_destination_address: z.string().ip(),
  secondary_destination_address: z.string().ip(),
  primary_destination_port: z.coerce.number().int(),
  secondary_destination_port: z.coerce.number().int(),
  payload_type: z.coerce.number().int(),
});

const ReceiverConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  name: z.string(),
  stream_type: StreamType, // eh... but oh well
  sync: z.coerce.boolean().default(true),
  switch_type: SwitchType,
});

const SourceType = z.enum(['IP', 'SDI', 'MADI']);

const ProcessingChainConfig = z.object({
  name: z.string(),
  id: z.coerce.number(),
  source_type: SourceType,
});

const SenderProcessorConfig = z.object({
  "SDI INPUT": z.coerce.number().int(),
  Signal: z.string(),
  Processor: z.enum(["FrameSync", "ClipPlayer", "ColorCorrection"]),
});

const file = fs.readFileSync(enforce_nonnull(process.env["CSV"]), "utf8");
// const config = parse_csv(file, SenderAddressConfig);

const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;

await base(vm);

process.exit(0);
