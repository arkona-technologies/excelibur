import fs from "fs/promises";
import path from "path";
import { apply_workbook_file_to_card } from "./deploy.js";
import { DeploymentJob } from "./deployment-jobs.js";
import { download_and_save_settings_json } from "./settings.js";

export type DeploymentRunnerHooks = {
  on_progress?: (percent: number, label: string) => void;
  on_log?: (message: string) => void;
};

export async function run_deployment_job(
  job: DeploymentJob,
  hooks: DeploymentRunnerHooks = {},
) {
  hooks.on_log?.(`Deploying ${job.workbook_path} to ${job.target_url}`);
  hooks.on_progress?.(0, job.name);

  await apply_workbook_file_to_card({
    url: job.target_url,
    workbook_path: job.workbook_path,
    on_log: hooks.on_log,
    progress: (percent, label) =>
      hooks.on_progress?.(percent, `${job.name}: ${label}`),
  });

  if (!job.capture_settings || !job.settings_output_file) {
    hooks.on_progress?.(100, `${job.name}: complete`);
    return {
      name: job.name,
      workbook_path: job.workbook_path,
      target_url: job.target_url,
      settings_output_file: null,
    };
  }

  await fs.mkdir(path.dirname(job.settings_output_file), { recursive: true });
  hooks.on_log?.(
    `Waiting ${job.wait_seconds_before_capture}s before downloading settings`,
  );
  hooks.on_progress?.(96, `${job.name}: waiting before download`);
  await new Promise((resolve) =>
    setTimeout(resolve, job.wait_seconds_before_capture * 1000),
  );

  hooks.on_log?.(`Downloading settings to ${job.settings_output_file}`);
  hooks.on_progress?.(97, `${job.name}: downloading settings`);
  await download_and_save_settings_json({
    settings_url: job.settings_url,
    output_file: job.settings_output_file,
  });

  hooks.on_progress?.(100, `${job.name}: complete`);
  return {
    name: job.name,
    workbook_path: job.workbook_path,
    target_url: job.target_url,
    settings_output_file: job.settings_output_file,
  };
}

export async function run_deployment_jobs(
  jobs: DeploymentJob[],
  hooks: DeploymentRunnerHooks = {},
) {
  const results = [];
  for (const job of jobs) {
    results.push(await run_deployment_job(job, hooks));
  }
  hooks.on_log?.(`Completed ${jobs.length} deployment job(s)`);
  return results;
}
