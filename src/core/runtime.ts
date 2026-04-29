import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { CachedSdkInfo } from "./sdk.js";

const exec_file = promisify(execFile);
const SDK_PACKAGE_NAMES = new Set(["vapi", "vscript", "vutil"]);

function runtime_root() {
  return path.join(process.env["HOME"] ?? process.cwd(), ".excelibur", "runtime");
}

function runtime_dir_for_release(release: string) {
  return path.join(runtime_root(), release.replace(/[^A-Za-z0-9._-]/g, "_"));
}

async function symlink_dependency_tree(project_root: string, runtime_dir: string) {
  const source_node_modules = path.join(project_root, "node_modules");
  const target_node_modules = path.join(runtime_dir, "node_modules");
  await fs.mkdir(target_node_modules, { recursive: true });

  const entries = await fs.readdir(source_node_modules, { withFileTypes: true });
  for (const entry of entries) {
    if (SDK_PACKAGE_NAMES.has(entry.name)) {
      continue;
    }
    const source = path.join(source_node_modules, entry.name);
    const target = path.join(target_node_modules, entry.name);
    await fs.rm(target, { recursive: true, force: true });
    await fs.symlink(source, target, entry.isDirectory() ? "dir" : "file");
  }
}

async function extract_sdk_tarball(options: {
  tarball_path: string;
  package_name: string;
  node_modules_dir: string;
}) {
  const temp_dir = path.join(options.node_modules_dir, `.extract-${options.package_name}`);
  await fs.rm(temp_dir, { recursive: true, force: true });
  await fs.mkdir(temp_dir, { recursive: true });
  await exec_file("tar", ["-xzf", options.tarball_path, "-C", temp_dir]);

  const extracted_package_dir_candidates = [
    path.join(temp_dir, "package"),
    path.join(temp_dir, options.package_name),
  ];
  const extracted_package_dir = (
    await Promise.all(
      extracted_package_dir_candidates.map(async (candidate) => {
        const stats = await fs.stat(candidate).catch(() => null);
        return stats?.isDirectory() ? candidate : null;
      }),
    )
  ).find((candidate) => !!candidate);

  if (!extracted_package_dir) {
    throw new Error(
      `Could not find extracted package directory for ${options.package_name} in ${options.tarball_path}`,
    );
  }
  const target_dir = path.join(options.node_modules_dir, options.package_name);
  await fs.rm(target_dir, { recursive: true, force: true });
  await fs.rename(extracted_package_dir, target_dir);
  await fs.rm(temp_dir, { recursive: true, force: true });
}

export async function prepare_runtime_from_cached_sdk(options: {
  project_root: string;
  cached_sdk: CachedSdkInfo;
}) {
  const runtime_dir = runtime_dir_for_release(options.cached_sdk.release);
  await fs.rm(runtime_dir, { recursive: true, force: true });
  await fs.mkdir(runtime_dir, { recursive: true });

  await fs.cp(path.join(options.project_root, "build"), path.join(runtime_dir, "build"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(runtime_dir, "package.json"),
    `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`,
  );

  await symlink_dependency_tree(options.project_root, runtime_dir);

  const node_modules_dir = path.join(runtime_dir, "node_modules");
  await extract_sdk_tarball({
    tarball_path: options.cached_sdk.files.vapi,
    package_name: "vapi",
    node_modules_dir,
  });
  await extract_sdk_tarball({
    tarball_path: options.cached_sdk.files.vscript,
    package_name: "vscript",
    node_modules_dir,
  });
  await extract_sdk_tarball({
    tarball_path: options.cached_sdk.files.vutil,
    package_name: "vutil",
    node_modules_dir,
  });

  return runtime_dir;
}
