import fs from "fs/promises";
import path from "path";
import { apply_workbook_file_to_card } from "./deploy.js";
import {
  derive_settings_url,
  download_and_save_settings_json,
} from "./settings.js";

export type BatchCaptureOptions = {
  url: string;
  input_dir: string;
  output_dir: string;
  settings_url?: string;
  force?: boolean;
  verbose?: boolean;
  wait_seconds_before_capture?: number;
};

export type BatchCaptureHooks = {
  on_progress?: (percent: number, label: string) => void;
  on_log?: (message: string) => void;
};

export async function list_workbooks(input_dir: string) {
  const entries = await fs.readdir(input_dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".xlsx"))
    .map((entry) => path.join(input_dir, entry.name))
    .sort();
}

export async function ensure_directory_exists(dir_path: string) {
  const stats = await fs.stat(dir_path).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Input directory does not exist: ${dir_path}`);
  }
}

export async function run_batch_capture(
  options: BatchCaptureOptions,
  hooks: BatchCaptureHooks = {},
) {
  const settings_url = options.settings_url ?? derive_settings_url(options.url);
  const wait_seconds = options.wait_seconds_before_capture ?? 5;
  const verbose = options.verbose ?? false;

  await ensure_directory_exists(options.input_dir);
  const workbooks = await list_workbooks(options.input_dir);
  if (workbooks.length === 0) {
    throw new Error(`No .xlsx files found in ${options.input_dir}`);
  }

  await fs.mkdir(options.output_dir, { recursive: true });
  hooks.on_log?.(`Using settings source: ${settings_url}`);
  hooks.on_log?.(
    `Processing ${workbooks.length} workbook(s) from ${options.input_dir}`,
  );

  for (const [index, workbook] of workbooks.entries()) {
    const start_percent = Math.floor((index / workbooks.length) * 100);
    const end_percent = Math.floor(((index + 1) / workbooks.length) * 100);
    const name = path.basename(workbook, ".xlsx");
    const output_file = path.join(options.output_dir, `${name}.json`);
    const output_exists = await fs
      .access(output_file)
      .then(() => true)
      .catch(() => false);

    if (!options.force && output_exists) {
      hooks.on_log?.(`Skipping existing ${name}`);
      hooks.on_progress?.(end_percent, `${name}: skipped existing output`);
      continue;
    }

    if (verbose) {
      hooks.on_log?.(`Configuring card with ${workbook}`);
      hooks.on_progress?.(start_percent, `${name}: starting`);
      await apply_workbook_file_to_card({
        url: options.url,
        workbook_path: workbook,
        on_log: hooks.on_log,
      });
    } else {
      hooks.on_progress?.(start_percent, `${name}: starting`);
      await apply_workbook_file_to_card({
        url: options.url,
        workbook_path: workbook,
        on_log: hooks.on_log,
        progress: (percent, label) =>
          hooks.on_progress?.(
            Math.round(start_percent + (percent / 100) * (end_percent - start_percent)),
            `${name}: ${label}`,
          ),
      });
    }

    hooks.on_log?.(`Waiting ${wait_seconds} seconds before downloading settings`);
    hooks.on_progress?.(
      Math.round(start_percent + 0.96 * (end_percent - start_percent)),
      `${name}: waiting before download`,
    );
    await new Promise((resolve) => setTimeout(resolve, wait_seconds * 1000));

    hooks.on_log?.(`Downloading settings to ${output_file}`);
    hooks.on_progress?.(
      Math.round(start_percent + 0.97 * (end_percent - start_percent)),
      `${name}: downloading settings`,
    );
    await download_and_save_settings_json({
      settings_url,
      output_file,
    });

    hooks.on_progress?.(end_percent, `${name}: complete`);
  }

  hooks.on_log?.(
    `Saved ${workbooks.length} settings snapshot(s) to ${options.output_dir}`,
  );
  return {
    settings_url,
    input_dir: options.input_dir,
    output_dir: options.output_dir,
    workbook_count: workbooks.length,
  };
}
