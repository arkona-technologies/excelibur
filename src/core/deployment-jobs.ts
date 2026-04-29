import fs from "fs/promises";
import path from "path";
import z from "zod";
import { derive_settings_url } from "./settings.js";

const DeploymentJobDefaultsSchema = z
  .object({
    capture_settings: z.boolean().optional(),
    wait_seconds_before_capture: z.coerce.number().int().nonnegative().optional(),
    settings_output_dir: z.string().optional(),
  })
  .default({});

const RawDeploymentJobSchema = z
  .object({
    name: z.string().optional(),
    workbook_path: z.string().min(1),
    target_url: z.string().url().optional(),
    target_ip: z.string().min(1).optional(),
    capture_settings: z.boolean().optional(),
    wait_seconds_before_capture: z.coerce.number().int().nonnegative().optional(),
    settings_output_file: z.string().optional(),
    settings_url: z.string().url().optional(),
  })
  .superRefine((job, ctx) => {
    if (!job.target_url && !job.target_ip) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each deployment job must include target_url or target_ip.",
        path: ["target_url"],
      });
    }
  });

export const DeploymentJobFileSchema = z.object({
  defaults: DeploymentJobDefaultsSchema,
  jobs: z.array(RawDeploymentJobSchema).min(1),
});

export type DeploymentJob = {
  name: string;
  workbook_path: string;
  target_url: string;
  capture_settings: boolean;
  wait_seconds_before_capture: number;
  settings_output_file: string | null;
  settings_url: string;
};

export type DeploymentJobFile = {
  defaults: z.infer<typeof DeploymentJobDefaultsSchema>;
  jobs: DeploymentJob[];
};

function resolve_local_path(file_dir: string, maybe_relative_path: string) {
  if (path.isAbsolute(maybe_relative_path)) {
    return maybe_relative_path;
  }
  return path.resolve(file_dir, maybe_relative_path);
}

function ensure_ws_url(target_url_or_ip: string) {
  if (target_url_or_ip.includes("://")) {
    return target_url_or_ip;
  }
  return `ws://${target_url_or_ip}`;
}

export function normalize_deployment_job_file(
  job_file_path: string,
  raw: z.infer<typeof DeploymentJobFileSchema>,
): DeploymentJobFile {
  const file_dir = path.dirname(job_file_path);
  return {
    defaults: raw.defaults,
    jobs: raw.jobs.map((job) => {
      const workbook_path = resolve_local_path(file_dir, job.workbook_path);
      const capture_settings =
        job.capture_settings ?? raw.defaults.capture_settings ?? false;
      const wait_seconds_before_capture =
        job.wait_seconds_before_capture ??
        raw.defaults.wait_seconds_before_capture ??
        5;
      const settings_output_file = job.settings_output_file
        ? resolve_local_path(file_dir, job.settings_output_file)
        : raw.defaults.settings_output_dir
          ? path.join(
              resolve_local_path(file_dir, raw.defaults.settings_output_dir),
              `${path.basename(workbook_path, ".xlsx")}.json`,
            )
          : null;
      return {
        name: job.name ?? path.basename(workbook_path, path.extname(workbook_path)),
        workbook_path,
        target_url: ensure_ws_url(job.target_url ?? job.target_ip ?? ""),
        capture_settings,
        wait_seconds_before_capture,
        settings_output_file,
        settings_url:
          job.settings_url ??
          derive_settings_url(ensure_ws_url(job.target_url ?? job.target_ip ?? "")),
      };
    }),
  };
}

export async function load_deployment_job_file(job_file_path: string) {
  const raw = JSON.parse(await fs.readFile(job_file_path, "utf8"));
  const parsed = DeploymentJobFileSchema.parse(raw);
  return normalize_deployment_job_file(path.resolve(job_file_path), parsed);
}
