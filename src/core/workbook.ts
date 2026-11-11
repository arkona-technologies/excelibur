import fs from "fs";
import { enforce } from "vscript";
import { parse_csv, parse_rows } from "../csv.js";
import {
  ProcessingChainConfig,
  ReceiverConfig,
  refine_config,
  SenderConfig,
} from "../zod_types.js";
import { z } from "zod";
import xlsx from "node-xlsx";

export type WorkbookConfig = {
  raw_config: z.infer<typeof ProcessingChainConfig>[];
  processors_config: z.infer<typeof ProcessingChainConfig>[];
  tx_config: z.infer<typeof SenderConfig>[];
  rx_config: z.infer<typeof ReceiverConfig>[];
};

export function parse_workbook_buffer(excel: Buffer): WorkbookConfig {
  let raw_config: z.infer<typeof ProcessingChainConfig>[] | null = null;
  let tx_config: z.infer<typeof SenderConfig>[] | null = null;
  let rx_config: z.infer<typeof ReceiverConfig>[] | null = null;

  const parsed_excel = xlsx.parse(excel);
  for (const sheet of parsed_excel) {
    console.log(`Parsing ${sheet.name}: ${sheet.data.length} lines`);
    if (sheet.name === "PROC") {
      raw_config = parse_rows(sheet.data, ProcessingChainConfig, sheet.name);
    }
    if (sheet.name === "TX") {
      tx_config = parse_rows(sheet.data, SenderConfig, sheet.name);
    }
    if (sheet.name === "RX") {
      rx_config = parse_rows(sheet.data, ReceiverConfig, sheet.name);
    }
  }

  enforce(!!raw_config && !!tx_config && !!rx_config);
  return {
    raw_config,
    processors_config: refine_config(raw_config),
    tx_config,
    rx_config,
  };
}

export function load_workbook_file(workbook_path: string): WorkbookConfig {
  return parse_workbook_buffer(fs.readFileSync(workbook_path));
}

export function load_csv_config_files(paths: {
  processors_path: string;
  tx_path: string;
  rx_path: string;
}): WorkbookConfig {
  const processors = fs.readFileSync(paths.processors_path, "utf8");
  const tx = fs.readFileSync(paths.tx_path, "utf8");
  const rx = fs.readFileSync(paths.rx_path, "utf8");

  const raw_config = parse_csv(processors, ProcessingChainConfig);
  return {
    raw_config,
    processors_config: refine_config(raw_config),
    tx_config: parse_csv(tx, SenderConfig),
    rx_config: parse_csv(rx, ReceiverConfig),
  };
}
