import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { CachedSdkInfo } from "./sdk.js";

const exec_file = promisify(execFile);
const SDK_PACKAGE_NAMES = new Set(["vapi", "vscript", "vutil"]);
const RUNTIME_PACKAGE_NAMES = new Set([
  "bufferutil",
  "node-gyp-build",
  "node-xlsx",
  "utf-8-validate",
  "ws",
  "xlsx",
  "zod",
]);

function runtime_root() {
  return path.join(process.env["HOME"] ?? process.cwd(), ".excelibur", "runtime");
}

function runtime_dir_for_release(release: string) {
  return path.join(runtime_root(), release.replace(/[^A-Za-z0-9._-]/g, "_"));
}

async function resolve_packaged_source(source: string) {
  const asar_marker = `${path.sep}app.asar${path.sep}`;
  if (!source.includes(asar_marker)) {
    return { source, copy: false };
  }

  const unpacked_source = source.replace(asar_marker, `${path.sep}app.asar.unpacked${path.sep}`);
  const stats = await fs.stat(unpacked_source).catch(() => null);
  return stats
    ? { source: unpacked_source, copy: false }
    : { source, copy: true };
}

async function symlink_dependency_tree(project_root: string, runtime_dir: string) {
  const source_node_modules = path.join(project_root, "node_modules");
  const target_node_modules = path.join(runtime_dir, "node_modules");
  await fs.mkdir(target_node_modules, { recursive: true });

  const entries = await fs.readdir(source_node_modules, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  async function materialize_dependency(source: string, target: string, type: "dir" | "file") {
    const packaged_source = await resolve_packaged_source(source);
    await fs.rm(target, { recursive: true, force: true });
    if (packaged_source.copy) {
      await fs.cp(packaged_source.source, target, { recursive: true });
    } else {
      await fs.symlink(packaged_source.source, target, type);
    }
  }

  for (const entry of entries) {
    if (SDK_PACKAGE_NAMES.has(entry.name) || !RUNTIME_PACKAGE_NAMES.has(entry.name)) {
      continue;
    }

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const source_scope = path.join(source_node_modules, entry.name);
      const target_scope = path.join(target_node_modules, entry.name);
      const scoped_entries = await fs.readdir(source_scope, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      });
      await fs.rm(target_scope, { recursive: true, force: true });
      await fs.mkdir(target_scope, { recursive: true });
      for (const scoped_entry of scoped_entries) {
        await materialize_dependency(
          path.join(source_scope, scoped_entry.name),
          path.join(target_scope, scoped_entry.name),
          scoped_entry.isDirectory() ? "dir" : "file",
        );
      }
      continue;
    }

    await materialize_dependency(
      path.join(source_node_modules, entry.name),
      path.join(target_node_modules, entry.name),
      entry.isDirectory() ? "dir" : "file",
    );
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
  dependency_root?: string;
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

  await symlink_dependency_tree(options.dependency_root ?? options.project_root, runtime_dir);

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
