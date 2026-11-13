import fs from "fs";
import { parse_csv, parse_rows_report } from "../csv.js";
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
  let raw_config: z.infer<typeof ProcessingChainConfig>[] = [];
  let tx_config: z.infer<typeof SenderConfig>[] = [];
  let rx_config: z.infer<typeof ReceiverConfig>[] = [];
  const found = new Set<string>();
  const errors: string[] = [];

  const parsed_excel = xlsx.parse(excel);
  for (const sheet of parsed_excel) {
    console.log(`Parsing ${sheet.name}: ${sheet.data.length} lines`);
    if (sheet.name === "PROC") {
      found.add(sheet.name);
      const report = parse_rows_report(sheet.data, ProcessingChainConfig, sheet.name);
      raw_config.push(...report.data);
      errors.push(...report.errors);
    }
    if (sheet.name === "TX") {
      found.add(sheet.name);
      const report = parse_rows_report(sheet.data, SenderConfig, sheet.name);
      tx_config.push(...report.data);
      errors.push(...report.errors);
    }
    if (sheet.name === "RX") {
      found.add(sheet.name);
      const report = parse_rows_report(sheet.data, ReceiverConfig, sheet.name);
      rx_config.push(...report.data);
      errors.push(...report.errors);
    }
  }

  for (const name of ["PROC", "TX", "RX"]) {
    if (!found.has(name)) errors.push(`${name}: missing worksheet`);
  }

  let processors_config = raw_config;
  try {
    processors_config = refine_config(raw_config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(...message.replace(/^Invalid configuration:\n?/, "").split("\n"));
  }

  if (errors.length) {
    throw new Error(`Invalid configuration:\n${errors.join("\n")}`);
  }

  return {
    raw_config,
    processors_config,
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
