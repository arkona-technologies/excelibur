import path from "path";
import { load_deployment_job_file } from "../core/deployment-jobs.js";
import { run_deployment_jobs } from "../core/deployment-runner.js";

let last_render_width = 0;

function render_progress(percent: number, label = "") {
  const bounded = Math.max(0, Math.min(100, percent));
  const width = 30;
  const filled = Math.floor((bounded * width) / 100);
  const bar = "#".repeat(filled);
  let line = "";
  if (bounded < 100) {
    const tail = "_".repeat(Math.max(0, width - filled - 1));
    line = `[${bar}>(${bounded.toString().padStart(3, " ")}%)${tail}] ${label}`;
  } else {
    const tail = "#".repeat(Math.max(0, width - filled));
    line = `[${bar}${tail}(${bounded.toString().padStart(3, " ")}%)] ${label}`;
  }

  const pad =
    last_render_width > line.length
      ? " ".repeat(last_render_width - line.length)
      : "";
  process.stdout.write(`\r${line}${pad}`);
  last_render_width = line.length;
}

function print_help() {
  console.log(`Usage:
  node build/cli/deploy-jobs.js ./deployment-jobs.json
  npm run deploy-jobs -- ./deployment-jobs.json

The deployment jobs file maps workbook files to target AT300 URLs.

Example JSON:
{
  "defaults": {
    "capture_settings": true,
    "wait_seconds_before_capture": 5,
    "settings_output_dir": "./deployment-output"
  },
  "jobs": [
    {
      "name": "master-slot-0",
      "workbook_path": "./input/260422_AT300-095-OK-CONFIG_MASTER_SLOT 0.xlsx",
      "target_url": "ws://172.16.220.211"
    }
  ]
}`);
}

function parse_args(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    print_help();
    process.exit(0);
  }

  const [job_file] = argv;
  if (!job_file) {
    throw new Error("Need to specify a deployment job JSON file");
  }
  return { job_file };
}

async function main() {
  const { job_file } = parse_args(process.argv.slice(2));
  const verbose = process.env["VERBOSE"] === "1";
  const deployment_jobs = await load_deployment_job_file(job_file);

  console.log(
    `Processing ${deployment_jobs.jobs.length} deployment job(s) from ${path.resolve(job_file)}`,
  );

  await run_deployment_jobs(deployment_jobs.jobs, {
    on_log: (message) => {
      if (verbose) {
        console.log(message);
      }
    },
    on_progress: verbose
      ? undefined
      : (percent, label) => {
          render_progress(percent, label);
          if (percent >= 100) {
            process.stdout.write("\n");
          }
        },
  });
}

await main().catch((error: unknown) => {
  if (last_render_width > 0) {
    process.stdout.write("\n");
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
