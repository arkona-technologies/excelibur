import * as VAPI from "vapi";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { close_connection, open_connection } from "../connection.js";
import { ensure_supported_release } from "../core/card.js";
import { prefetch_sdk_from_card } from "../core/sdk.js";
import { prepare_runtime_from_cached_sdk } from "../core/runtime.js";

function absolutize_env_path(
  env: NodeJS.ProcessEnv,
  key: "SHEET" | "PROC" | "TX" | "RX" | "INPUT_DIR" | "OUTPUT_DIR",
  project_root: string,
) {
  const value = env[key];
  if (!value) {
    return;
  }
  if (path.isAbsolute(value)) {
    return;
  }
  env[key] = path.resolve(project_root, value);
}

function absolutize_existing_arg(arg: string, project_root: string) {
  if (arg.startsWith("-") || path.isAbsolute(arg)) {
    return arg;
  }
  const resolved = path.resolve(project_root, arg);
  return fs.existsSync(resolved) ? resolved : arg;
}

async function main() {
  const url = process.env["URL"];
  if (!url) {
    throw new Error("Need to specify URL, for example URL=ws://172.16.220.211");
  }

  const [entry = "build/main.js", ...args] = process.argv.slice(2);
  const project_root = process.cwd();
  const dependency_root = process.env["EXCELIBUR_DEPENDENCY_ROOT"];
  const vm = (await open_connection(new URL(url))) as VAPI.AT1130.Root;
  let runtime_dir = "";
  try {
    const release = await ensure_supported_release(vm);
    const cached_sdk = await prefetch_sdk_from_card({ url, release });
    runtime_dir = await prepare_runtime_from_cached_sdk({
      project_root,
      dependency_root,
      cached_sdk,
    });
  } finally {
    await close_connection(vm).catch(() => {});
  }
  const child_env = { ...process.env };
  absolutize_env_path(child_env, "SHEET", project_root);
  absolutize_env_path(child_env, "PROC", project_root);
  absolutize_env_path(child_env, "TX", project_root);
  absolutize_env_path(child_env, "RX", project_root);
  absolutize_env_path(child_env, "INPUT_DIR", project_root);
  absolutize_env_path(child_env, "OUTPUT_DIR", project_root);

  const runtime_entry = path.join(runtime_dir, entry.replace(/^build\//, "build/"));
  const runtime_args = args.map((arg) => absolutize_existing_arg(arg, project_root));
  const child = spawn(process.execPath, [runtime_entry, ...runtime_args], {
    cwd: runtime_dir,
    env: child_env,
    stdio: "inherit",
  });

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

  const on_sigint = () => terminate_child("SIGINT");
  const on_sigterm = () => terminate_child("SIGTERM");
  const on_exit = () => terminate_child("SIGTERM");

  process.on("SIGINT", on_sigint);
  process.on("SIGTERM", on_sigterm);
  process.on("exit", on_exit);

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      process.off("SIGINT", on_sigint);
      process.off("SIGTERM", on_sigterm);
      process.off("exit", on_exit);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Runtime process exited with code ${code ?? "unknown"}`));
    });
    child.on("error", (error) => {
      process.off("SIGINT", on_sigint);
      process.off("SIGTERM", on_sigterm);
      process.off("exit", on_exit);
      reject(error);
    });
  });
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
