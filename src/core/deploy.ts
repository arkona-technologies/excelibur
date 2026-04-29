import * as VAPI from "vapi";
import { base } from "../base.js";
import { close_connection, open_connection } from "../connection.js";
import {
  create_step_progress_reporter,
  ProgressReporter,
} from "../progress.js";
import { setup_processing_chains } from "../processors.js";
import { apply_receivers_config } from "../receivers.js";
import { apply_senders_config } from "../senders.js";
import {
  load_csv_config_files,
  load_workbook_file,
  WorkbookConfig,
} from "./workbook.js";
import { ensure_supported_release } from "./card.js";
import { ensure_installed_sdk_matches_release } from "./sdk.js";

export async function apply_workbook_config(
  vm: VAPI.AT1130.Root,
  config: WorkbookConfig,
  progress?: ProgressReporter | null,
) {
  const release = await ensure_supported_release(vm);
  progress?.(12, `release ${release}`);
  await ensure_installed_sdk_matches_release(release);
  progress?.(15, "sdk verified");
  await base(vm);
  progress?.(20, "base setup");
  await setup_processing_chains(
    vm,
    config.processors_config,
    create_step_progress_reporter(progress ?? null, 20, 70),
  );
  await apply_senders_config(
    vm,
    config.tx_config,
    create_step_progress_reporter(progress ?? null, 70, 85),
  );
  await apply_receivers_config(
    vm,
    config.rx_config,
    create_step_progress_reporter(progress ?? null, 85, 95),
  );
  progress?.(95, "configured");
}

export async function apply_workbook_file_to_card(options: {
  url: string | URL;
  workbook_path: string;
  progress?: ProgressReporter | null;
  on_log?: ((message: string) => void) | null;
}) {
  const progress = options.progress ?? null;
  const on_log = options.on_log ?? null;
  progress?.(0, "starting");
  const workbook = load_workbook_file(options.workbook_path);
  progress?.(5, "parsed workbook");
  const vm = (await open_connection(
    typeof options.url === "string" ? new URL(options.url) : options.url,
    {
      on_retry: (attempt, delay_ms, error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        on_log?.(
          `Connection attempt ${attempt} failed; retrying in ${delay_ms}ms: ${message}`,
        );
        progress?.(5, `retrying connection (${attempt + 1})`);
      },
    },
  )) as VAPI.AT1130.Root;
  try {
    progress?.(10, "connected");
    await apply_workbook_config(vm, workbook, progress);
  } finally {
    await close_connection(vm).catch(() => {});
  }
}

export async function apply_csv_configs_to_card(options: {
  url: string | URL;
  processors_path: string;
  tx_path: string;
  rx_path: string;
  progress?: ProgressReporter | null;
  on_log?: ((message: string) => void) | null;
}) {
  const progress = options.progress ?? null;
  const on_log = options.on_log ?? null;
  progress?.(0, "starting");
  const workbook = load_csv_config_files({
    processors_path: options.processors_path,
    tx_path: options.tx_path,
    rx_path: options.rx_path,
  });
  progress?.(5, "parsed workbook");
  const vm = (await open_connection(
    typeof options.url === "string" ? new URL(options.url) : options.url,
    {
      on_retry: (attempt, delay_ms, error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        on_log?.(
          `Connection attempt ${attempt} failed; retrying in ${delay_ms}ms: ${message}`,
        );
        progress?.(5, `retrying connection (${attempt + 1})`);
      },
    },
  )) as VAPI.AT1130.Root;
  try {
    progress?.(10, "connected");
    await apply_workbook_config(vm, workbook, progress);
  } finally {
    await close_connection(vm).catch(() => {});
  }
}
