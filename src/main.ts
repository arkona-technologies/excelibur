import { enforce_nonnull } from "vscript";
import { apply_csv_configs_to_card, apply_workbook_file_to_card } from "./core/deploy.js";
import { create_progress_reporter } from "./progress.js";

const progress = create_progress_reporter();

if (process.env["SHEET"]) {
  await apply_workbook_file_to_card({
    url: process.env["URL"] ?? "ws://127.0.0.1",
    workbook_path: enforce_nonnull(process.env["SHEET"]),
    progress,
  });
} else {
  await apply_csv_configs_to_card({
    url: process.env["URL"] ?? "ws://127.0.0.1",
    processors_path: enforce_nonnull(process.env["PROC"]),
    tx_path: enforce_nonnull(process.env["TX"]),
    rx_path: enforce_nonnull(process.env["RX"]),
    progress,
  });
}

process.exit(0);
