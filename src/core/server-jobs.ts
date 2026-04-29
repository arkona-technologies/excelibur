import crypto from "crypto";

export type ServerJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type ServerJobType = "deployment" | "batch-capture";

export type ServerJobRecord = {
  id: string;
  type: ServerJobType;
  summary: string;
  status: ServerJobStatus;
  resource_keys: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress_percent: number;
  progress_label: string;
  logs: string[];
  result: unknown;
  error: string | null;
};

type QueueJobOptions = {
  type: ServerJobType;
  summary: string;
  resource_keys: string[];
  run: (helpers: {
    log: (message: string) => void;
    progress: (percent: number, label: string) => void;
  }) => Promise<unknown>;
};

const job_records = new Map<string, ServerJobRecord>();
let queue_tail: Promise<void> = Promise.resolve();

function append_log(job: ServerJobRecord, message: string) {
  const timestamp = new Date().toISOString();
  job.logs.push(`[${timestamp}] ${message}`);
  if (job.logs.length > 200) {
    job.logs.splice(0, job.logs.length - 200);
  }
}

export function list_server_jobs() {
  return Array.from(job_records.values()).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export function get_server_job(job_id: string) {
  return job_records.get(job_id) ?? null;
}

export function queue_server_job(options: QueueJobOptions) {
  const job: ServerJobRecord = {
    id: crypto.randomUUID(),
    type: options.type,
    summary: options.summary,
    status: "pending",
    resource_keys: options.resource_keys,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    progress_percent: 0,
    progress_label: "queued",
    logs: [],
    result: null,
    error: null,
  };

  append_log(
    job,
    `Queued ${job.type} job for ${job.resource_keys.join(", ") || "local resources"}`,
  );
  job_records.set(job.id, job);

  const run_queued_job = async () => {
    job.status = "running";
    job.started_at = new Date().toISOString();
    job.progress_label = "starting";
    append_log(job, "Job started");

    try {
      const result = await options.run({
        log: (message) => append_log(job, message),
        progress: (percent, label) => {
          job.progress_percent = percent;
          job.progress_label = label;
        },
      });
      job.status = "completed";
      job.finished_at = new Date().toISOString();
      job.progress_percent = 100;
      job.progress_label = "complete";
      job.result = result;
      append_log(job, "Job completed");
    } catch (error) {
      job.status = "failed";
      job.finished_at = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
      job.progress_label = "failed";
      append_log(job, `Job failed: ${job.error}`);
    }
  };

  queue_tail = queue_tail.then(run_queued_job, run_queued_job);
  return job;
}
