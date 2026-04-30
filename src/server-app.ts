import fastifyStatic from "@fastify/static";
import FastifyMultipart from "@fastify/multipart";
import FormBody from "@fastify/formbody";
import * as VAPI from "vapi";
import Fastify from "fastify";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { promisify } from "util";
import { close_connection, open_connection } from "./connection.js";
import { parse_csv } from "./csv.js";
import {
  ProcessingChainConfig,
  ReceiverConfig,
  SenderConfig,
} from "./zod_types.js";
import { apply_senders_config } from "./senders.js";
import { setup_processing_chains } from "./processors.js";
import { apply_receivers_config } from "./receivers.js";
import { base } from "./base.js";
import { enforce_nonnull } from "vscript";
import cors from "@fastify/cors";
import { apply_workbook_config } from "./core/deploy.js";
import { parse_workbook_buffer } from "./core/workbook.js";
import { detect_card_release, ensure_supported_release } from "./core/card.js";
import {
  derive_sdk_package_urls,
  prefetch_sdk_from_card,
  read_installed_sdk_info,
} from "./core/sdk.js";
import {
  DeploymentJobFileSchema,
  normalize_deployment_job_file,
} from "./core/deployment-jobs.js";
import {
  get_server_job,
  list_server_jobs,
  queue_server_job,
} from "./core/server-jobs.js";
import {
  run_batch_capture_with_sdk,
  run_deployment_jobs_with_sdk,
} from "./core/server-sdk-runner.js";

type DesktopUpdateApi = {
  get_update_state: () => Promise<unknown> | unknown;
  check_for_updates: (manual?: boolean) => Promise<unknown> | unknown;
  install_update: () => Promise<unknown> | unknown;
};

type BuildServerOptions = {
  desktop_update_api?: DesktopUpdateApi | null;
  app_root?: string;
  dependency_root?: string;
};

const exec_file = promisify(execFile);
const module_dir = path.dirname(fileURLToPath(import.meta.url));
const web_root = path.resolve(module_dir, "..", "web");
const default_app_root = path.resolve(module_dir, "..");

function stream_to_string(stream: any): Promise<string> {
  const chunks: any[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: any) => chunks.push(Buffer.from(chunk)));
    stream.on("error", (err: any) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function connect_server_vm() {
  return (await open_connection(
    new URL(process.env["URL"] ?? "ws://127.0.0.1"),
  )) as VAPI.AT1130.Root;
}

async function pick_directory_with_dialog(prompt: string) {
  if (process.platform === "darwin") {
    const { stdout } = await exec_file("osascript", [
      "-e",
      `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
    ]);
    return stdout.trim();
  }

  if (process.platform === "win32") {
    const powershell_script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${JSON.stringify(prompt)}`,
      "$dialog.UseDescriptionForTitle = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.Write($dialog.SelectedPath)",
      "} else {",
      "  exit 1",
      "}",
    ].join("; ");
    const { stdout } = await exec_file("powershell", [
      "-NoProfile",
      "-Command",
      powershell_script,
    ]);
    return stdout.trim();
  }

  throw new Error(
    "Directory picker is currently implemented for macOS and Windows only.",
  );
}

async function pick_workbooks_with_dialog(prompt: string) {
  if (process.platform === "darwin") {
    const { stdout } = await exec_file("osascript", [
      "-e",
      `set chosenFiles to choose file with prompt ${JSON.stringify(prompt)} multiple selections allowed true`,
      "-e",
      'set outputLines to {}',
      "-e",
      'repeat with currentFile in chosenFiles',
      "-e",
      'set end of outputLines to POSIX path of currentFile',
      "-e",
      'end repeat',
      "-e",
      'set AppleScript\'s text item delimiters to linefeed',
      "-e",
      'return outputLines as text',
    ]);
    return stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (process.platform === "win32") {
    const powershell_script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
      `$dialog.Title = ${JSON.stringify(prompt)}`,
      '$dialog.Filter = "Excel Workbooks (*.xlsx)|*.xlsx|All Files (*.*)|*.*"',
      "$dialog.Multiselect = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      '  [Console]::Out.Write(($dialog.FileNames -join [Environment]::NewLine))',
      "} else {",
      "  exit 1",
      "}",
    ].join("; ");
    const { stdout } = await exec_file("powershell", [
      "-NoProfile",
      "-Command",
      powershell_script,
    ]);
    return stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  throw new Error(
    "Workbook picker is currently implemented for macOS and Windows only.",
  );
}

async function apply_uploaded_workbook(req: any) {
  const maybe_excel = enforce_nonnull(await req.file().then((f: any) => f?.toBuffer()));
  const workbook = parse_workbook_buffer(maybe_excel);
  const vm = await connect_server_vm();
  try {
    await apply_workbook_config(vm, workbook);
  } finally {
    await close_connection(vm).catch(() => {});
  }
  return `Done`;
}

export function buildServer(options?: BuildServerOptions) {
  const app_root = options?.app_root ?? default_app_root;
  const dependency_root = options?.dependency_root ?? app_root;
  const fastify = Fastify({
    bodyLimit: 1e6,
    caseSensitive: false,
  });

  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    function (_req: any, body: any, done: any) {
      try {
        const json = JSON.parse(body);
        done(null, json);
      } catch (err: any) {
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  fastify.addContentTypeParser("text/csv", function (_req, payload, done) {
    let body = "";
    payload.on("data", function (data) {
      body += data;
    });
    payload.on("end", function () {
      try {
        done(null, body);
      } catch (e) {
        done(e as any);
      }
    });
    payload.on("error", done);
  });

  fastify.register(fastifyStatic, {
    root: web_root,
    prefix: "/sheets/",
  });

  fastify.register(FastifyMultipart);
  fastify.register(FormBody);
  fastify.register(cors, { origin: "*" });

  fastify.get("/", async (_req, reply) => {
    return reply.redirect("/sheets/");
  });

  fastify.get("/api/app-update", async () => {
    if (!options?.desktop_update_api) {
      return {
        ok: true,
        supported: false,
        state: {
          status: "unsupported",
          message: "App updates are only available in the desktop app.",
        },
      };
    }

    return {
      ok: true,
      supported: true,
      state: await options.desktop_update_api.get_update_state(),
    };
  });

  fastify.post("/api/app-update/check", async (_req, reply) => {
    if (!options?.desktop_update_api) {
      reply.code(400);
      return {
        ok: false,
        message: "App updates are only available in the desktop app.",
      };
    }

    await options.desktop_update_api.check_for_updates(true);
    return {
      ok: true,
      state: await options.desktop_update_api.get_update_state(),
    };
  });

  fastify.post("/api/app-update/install", async (_req, reply) => {
    if (!options?.desktop_update_api) {
      reply.code(400);
      return {
        ok: false,
        message: "App updates are only available in the desktop app.",
      };
    }

    await options.desktop_update_api.install_update();
    return {
      ok: true,
      state: await options.desktop_update_api.get_update_state(),
    };
  });

  fastify.post("/api/pick-directory", async (req: any, reply) => {
    const prompt =
      typeof req.body?.prompt === "string" && req.body.prompt.trim().length > 0
        ? req.body.prompt.trim()
        : "Choose a folder";

    try {
      return { ok: true, path: await pick_directory_with_dialog(prompt) };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Folder selection cancelled";
      reply.code(400);
      return { ok: false, message };
    }
  });

  fastify.post("/api/pick-workbooks", async (req: any, reply) => {
    const prompt =
      typeof req.body?.prompt === "string" && req.body.prompt.trim().length > 0
        ? req.body.prompt.trim()
        : "Choose one or more workbook files";

    try {
      return { ok: true, paths: await pick_workbooks_with_dialog(prompt) };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Workbook selection cancelled";
      reply.code(400);
      return { ok: false, message };
    }
  });

  fastify.post("/api/card-check", async (req: any) => {
    const raw_ip =
      typeof req.body?.ip === "string" ? req.body.ip.trim() : "";
    if (!raw_ip) {
      return {
        ok: false,
        reachable: false,
        supported: false,
        release: null,
        message: "Missing AT300 IP address.",
      };
    }

    const target_url = raw_ip.includes("://") ? raw_ip : `ws://${raw_ip}`;

    try {
      const vm = (await open_connection(new URL(target_url))) as VAPI.AT1130.Root;
      const release = await detect_card_release(vm);
      await close_connection(vm).catch(() => {});
      const supported =
        typeof release === "string" ? release.startsWith("2.9.") : false;
      return {
        ok: true,
        reachable: true,
        supported,
        release,
        target_url,
        message: supported
          ? `Reachable: ${release}`
          : `Unsupported release: ${release ?? "unknown"}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const busy =
        message.includes("status code: 503") ||
        message.includes("Service Unavailable");
      return {
        ok: false,
        reachable: false,
        busy,
        supported: false,
        release: null,
        target_url,
        message,
      };
    }
  });

  fastify.post("/sender-config", async (req, _res) => {
    const maybe_csv = await stream_to_string(
      enforce_nonnull(await req.file()).file,
    );
    const tx_config = parse_csv(maybe_csv, SenderConfig);
    const vm = await connect_server_vm();
    await ensure_supported_release(vm);
    await apply_senders_config(vm, tx_config);
    return `Done`;
  });

  fastify.post("/receiver-config", async (req, _res) => {
    const maybe_csv = await stream_to_string(
      enforce_nonnull(await req.file()).file,
    );
    const rx_config = parse_csv(maybe_csv, ReceiverConfig);
    const vm = await connect_server_vm();
    await ensure_supported_release(vm);
    await apply_receivers_config(vm, rx_config);
    return `Done`;
  });

  fastify.post("/base-setup", {}, async (_req: any, _res) => {
    const vm = await connect_server_vm();
    await ensure_supported_release(vm);
    await base(vm);
    const traits = await vm.p_t_p_clock.output.ptp_traits.read();
    const domain = await traits?.domain.read();
    return domain ?? "N/A";
  });

  fastify.post("/processor-config", async (req, _res) => {
    const maybe_csv = await stream_to_string(
      enforce_nonnull(await req.file()).file,
    );
    const processors_config = parse_csv(maybe_csv, ProcessingChainConfig);
    const vm = await connect_server_vm();
    await ensure_supported_release(vm);
    await setup_processing_chains(vm, processors_config);
    return `Done`;
  });

  fastify.get("/release", async () => {
    const vm = await connect_server_vm();
    try {
      return (await detect_card_release(vm)) ?? "unknown";
    } finally {
      await close_connection(vm).catch(() => {});
    }
  });

  fastify.get("/sdk-info", async () => {
    const vm = await connect_server_vm();
    try {
      const release = await detect_card_release(vm);
      return {
        release,
        installed: await read_installed_sdk_info(app_root),
        card_urls: derive_sdk_package_urls(process.env["URL"] ?? "ws://127.0.0.1"),
      };
    } finally {
      await close_connection(vm).catch(() => {});
    }
  });

  fastify.post("/sdk-prefetch", async () => {
    const vm = await connect_server_vm();
    try {
      const release = await ensure_supported_release(vm);
      return await prefetch_sdk_from_card({
        url: process.env["URL"] ?? "ws://127.0.0.1",
        release,
      });
    } finally {
      await close_connection(vm).catch(() => {});
    }
  });

  fastify.post("/user_scripts/excel", async (req, _res) => {
    return await apply_uploaded_workbook(req);
  });

  fastify.post("/excel", async (req, _res) => {
    return await apply_uploaded_workbook(req);
  });

  fastify.post("/api/deploy-jobs", async (req: any, _res) => {
    const parsed = DeploymentJobFileSchema.parse(req.body);
    const normalized = normalize_deployment_job_file(
      path.join(app_root, "deployment-jobs.web.json"),
      parsed,
    );
    const job = queue_server_job({
      type: "deployment",
      summary: `Deploy ${normalized.jobs.length} workbook(s)`,
      resource_keys: Array.from(new Set(normalized.jobs.map((item) => item.target_url))),
      run: ({ log, progress }) =>
        run_deployment_jobs_with_sdk(normalized.jobs, {
          app_root,
          dependency_root,
          on_log: log,
          on_progress: progress,
        }),
    });
    return { ok: true, job_id: job.id, status: job.status };
  });

  fastify.post("/api/batch-capture", async (req: any, _res) => {
    const body = req.body as {
      url: string;
      input_dir: string;
      output_dir: string;
      settings_url?: string;
      force?: boolean;
      wait_seconds_before_capture?: number;
    };
    const input_dir = path.isAbsolute(body.input_dir)
      ? body.input_dir
      : path.resolve(app_root, body.input_dir);
    const output_dir = path.isAbsolute(body.output_dir)
      ? body.output_dir
      : path.resolve(app_root, body.output_dir);
    const job = queue_server_job({
      type: "batch-capture",
      summary: `Capture settings from ${body.url}`,
      resource_keys: [body.url],
      run: ({ log, progress }) =>
        run_batch_capture_with_sdk(
          {
            url: body.url,
            input_dir,
            output_dir,
            settings_url: body.settings_url,
            force: body.force,
            wait_seconds_before_capture: body.wait_seconds_before_capture,
            verbose: true,
          },
          {
            app_root,
            dependency_root,
            on_log: log,
            on_progress: progress,
          },
        ),
    });
    return { ok: true, job_id: job.id, status: job.status };
  });

  fastify.get("/api/jobs", async () => {
    return { ok: true, jobs: list_server_jobs() };
  });

  fastify.get("/api/jobs/:id", async (req: any, reply) => {
    const job = get_server_job(req.params.id);
    if (!job) {
      reply.code(404);
      return { ok: false, message: `Unknown job: ${req.params.id}` };
    }
    return { ok: true, job };
  });

  return fastify;
}

export async function startServer(
  options?: {
    port?: number;
    host?: string;
    desktop_update_api?: DesktopUpdateApi | null;
    app_root?: string;
    dependency_root?: string;
  },
) {
  const fastify = buildServer({
    desktop_update_api: options?.desktop_update_api ?? null,
    app_root: options?.app_root,
    dependency_root: options?.dependency_root,
  });
  const port = options?.port ?? parseInt(process.env["PORT"] ?? "30000", 10);
  const host = options?.host ?? "0.0.0.0";
  const address = await fastify.listen({ port, host });
  console.log(`Listening on ${address}`);
  console.log(fastify.printRoutes());
  return { fastify, address };
}
