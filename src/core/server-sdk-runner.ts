import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import * as VAPI from "vapi";
import { DeploymentJob } from "./deployment-jobs.js";
import { download_and_save_settings_json } from "./settings.js";
import { BatchCaptureOptions } from "./batch-capture.js";
import { close_connection, open_connection } from "../connection.js";
import { ensure_supported_release } from "./card.js";
import { prefetch_sdk_from_card } from "./sdk.js";
import { prepare_runtime_from_cached_sdk } from "./runtime.js";

type RunnerHooks = {
  on_log?: (message: string) => void;
  on_progress?: (percent: number, label: string) => void;
};

const PROGRESS_PREFIX = "__EXCELIBUR_PROGRESS__|";

function relay_stream(
  stream: NodeJS.ReadableStream | null,
  on_log?: (message: string) => void,
  on_progress?: (percent: number, label: string) => void,
  suppress_non_progress_output = false,
) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.startsWith(PROGRESS_PREFIX)) {
        const [, percent_raw = "0", ...label_parts] = trimmed.split("|");
        const percent = Number(percent_raw);
        const label = label_parts.join("|");
        if (Number.isFinite(percent)) {
          on_progress?.(percent, label);
        }
        continue;
      }
      if (suppress_non_progress_output) {
        continue;
      }
      if (trimmed) {
        on_log?.(trimmed);
      }
    }
  });
  stream.on("end", () => {
    const trimmed = buffer.trim();
    if (trimmed.startsWith(PROGRESS_PREFIX)) {
      const [, percent_raw = "0", ...label_parts] = trimmed.split("|");
      const percent = Number(percent_raw);
      const label = label_parts.join("|");
      if (Number.isFinite(percent)) {
        on_progress?.(percent, label);
      }
      return;
    }
    if (suppress_non_progress_output) {
      return;
    }
    if (trimmed) {
      on_log?.(trimmed);
    }
  });
}

async function run_node_process(options: {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  on_log?: (message: string) => void;
  on_progress?: (percent: number, label: string) => void;
  suppress_stdout_non_progress?: boolean;
}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;

    const terminate_child = (signal: NodeJS.Signals = "SIGTERM") => {
      if (child.exitCode !== null || child.killed) {
        return;
      }
      child.kill(signal);
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
        }
      }, 2000).unref();
    };

    const cleanup_handlers = () => {
      process.off("SIGINT", on_sigint);
      process.off("SIGTERM", on_sigterm);
      process.off("exit", on_exit);
    };

    const on_sigint = () => terminate_child("SIGINT");
    const on_sigterm = () => terminate_child("SIGTERM");
    const on_exit = () => terminate_child("SIGTERM");

    process.on("SIGINT", on_sigint);
    process.on("SIGTERM", on_sigterm);
    process.on("exit", on_exit);

    relay_stream(
      child.stdout,
      options.on_log,
      options.on_progress,
      options.suppress_stdout_non_progress ?? false,
    );
    relay_stream(child.stderr, options.on_log, options.on_progress);

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup_handlers();
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup_handlers();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Runtime process exited with code ${code ?? "unknown"}`));
    });
  });
}

async function inspect_card_release(target_url: string) {
  const vm = (await open_connection(new URL(target_url))) as VAPI.AT1130.Root;
  try {
    return await ensure_supported_release(vm);
  } finally {
    await close_connection(vm).catch(() => {});
  }
}

async function prepare_shared_deployment_runtime(
  jobs: DeploymentJob[],
  hooks: RunnerHooks,
) {
  const releases = new Map<string, string>();

  for (const target_url of Array.from(new Set(jobs.map((job) => job.target_url)))) {
    hooks.on_log?.(`Checking ${target_url}`);
    const release = await inspect_card_release(target_url);
    releases.set(target_url, release);
    hooks.on_log?.(`Detected ${target_url} release ${release}`);
  }

  const unique_releases = Array.from(new Set(releases.values()));
  if (unique_releases.length !== 1) {
    throw new Error(
      `Deployment batch spans multiple software releases: ${unique_releases.join(", ")}`,
    );
  }

  const release = unique_releases[0];
  const sdk_source_url = jobs[0]?.target_url;
  if (!sdk_source_url) {
    throw new Error("No deployment jobs were provided");
  }

  hooks.on_log?.(`Fetching SDK for release ${release} from ${sdk_source_url}`);
  const cached_sdk = await prefetch_sdk_from_card({
    url: sdk_source_url,
    release,
  });
  const runtime_dir = await prepare_runtime_from_cached_sdk({
    project_root: process.cwd(),
    cached_sdk,
  });
  hooks.on_log?.(`Prepared shared runtime for release ${release}`);

  return { release, runtime_dir };
}

export async function run_batch_capture_with_sdk(
  options: BatchCaptureOptions,
  hooks: RunnerHooks = {},
) {
  hooks.on_progress?.(0, "starting batch capture");
  await run_node_process({
    args: ["build/cli/run-with-sdk.js", "build/cli/capture-settings.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      URL: options.url,
      INPUT_DIR: options.input_dir,
      OUTPUT_DIR: options.output_dir,
      SETTINGS_URL: options.settings_url,
      FORCE: options.force ? "1" : "0",
      VERBOSE: options.verbose ? "1" : "0",
      EXCELIBUR_PROGRESS: "1",
    },
    on_log: hooks.on_log,
    on_progress: hooks.on_progress,
    suppress_stdout_non_progress: !options.verbose,
  });
  hooks.on_progress?.(100, "batch capture complete");
  return {
    settings_url: options.settings_url,
    input_dir: options.input_dir,
    output_dir: options.output_dir,
  };
}

export async function run_deployment_jobs_with_sdk(
  jobs: DeploymentJob[],
  hooks: RunnerHooks = {},
) {
  if (jobs.length === 0) {
    return [];
  }

  hooks.on_progress?.(0, "checking AT300 releases");
  const { release, runtime_dir } = await prepare_shared_deployment_runtime(
    jobs,
    hooks,
  );
  const runtime_entry = path.join(runtime_dir, "build", "main.js");
  const results = [];

  for (const [index, job] of jobs.entries()) {
    const start_percent = Math.floor((index / jobs.length) * 100);
    const end_percent = Math.floor(((index + 1) / jobs.length) * 100);
    hooks.on_log?.(
      `Deploying ${job.workbook_path} to ${job.target_url} using shared ${release} runtime`,
    );
    hooks.on_progress?.(start_percent, `${job.name}: starting`);

    await run_node_process({
      args: [runtime_entry],
      cwd: runtime_dir,
      env: {
        ...process.env,
        URL: job.target_url,
        SHEET: job.workbook_path,
        EXCELIBUR_PROGRESS: "1",
      },
      on_log: hooks.on_log,
      on_progress: (percent, label) => {
        const overall_percent = Math.round(
          start_percent + (percent / 100) * (end_percent - start_percent),
        );
        hooks.on_progress?.(overall_percent, `${job.name}: ${label}`);
      },
      suppress_stdout_non_progress: true,
    });

    if (job.capture_settings && job.settings_output_file) {
      await fs.mkdir(path.dirname(job.settings_output_file), { recursive: true });
      hooks.on_log?.(
        `Waiting ${job.wait_seconds_before_capture}s before downloading settings`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, job.wait_seconds_before_capture * 1000),
      );
      hooks.on_log?.(`Downloading settings to ${job.settings_output_file}`);
      await download_and_save_settings_json({
        settings_url: job.settings_url,
        output_file: job.settings_output_file,
      });
    }

    hooks.on_progress?.(end_percent, `${job.name}: complete`);
    results.push({
      name: job.name,
      workbook_path: job.workbook_path,
      target_url: job.target_url,
      settings_output_file: job.settings_output_file,
    });
  }

  hooks.on_log?.(`Completed ${jobs.length} deployment job(s)`);
  return results;
}
