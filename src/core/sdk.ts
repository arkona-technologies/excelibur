import fs from "fs/promises";
import os from "os";
import path from "path";

type SdkPackageName = "vapi" | "vscript" | "vutil";

export type SdkPackageUrls = Record<SdkPackageName, string>;

export type InstalledSdkInfo = {
  name: SdkPackageName;
  version: string | null;
};

export type CachedSdkInfo = {
  cache_dir: string;
  release: string;
  urls: SdkPackageUrls;
  files: Record<SdkPackageName, string>;
};

const SDK_PACKAGE_NAMES: SdkPackageName[] = ["vapi", "vscript", "vutil"];

export function derive_sdk_base_url(url: string | URL): string {
  const ws_url = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const http_url = new URL(ws_url.toString());
  if (http_url.protocol === "ws:") {
    http_url.protocol = "http:";
  } else if (http_url.protocol === "wss:") {
    http_url.protocol = "https:";
  }
  http_url.username = "";
  http_url.password = "";
  http_url.pathname = http_url.pathname.replace(/\/$/, "");
  http_url.search = "";
  http_url.hash = "";
  return http_url.toString().replace(/\/$/, "");
}

export function derive_sdk_package_urls(url: string | URL): SdkPackageUrls {
  const base_url = derive_sdk_base_url(url);
  return {
    vapi: `${base_url}/vapi.tar.gz`,
    vscript: `${base_url}/vscript.tar.gz`,
    vutil: `${base_url}/vutil.tar.gz`,
  };
}

export async function read_installed_sdk_info(): Promise<InstalledSdkInfo[]> {
  const package_json_dir = path.resolve(process.cwd(), "node_modules");
  return await Promise.all(
    SDK_PACKAGE_NAMES.map(async (name) => {
      const package_json_path = path.join(package_json_dir, name, "package.json");
      const version = await fs
        .readFile(package_json_path, "utf8")
        .then((raw) => (JSON.parse(raw)?.version as string | undefined) ?? null)
        .catch(() => null);
      return { name, version };
    }),
  );
}

export async function ensure_installed_sdk_matches_release(release: string) {
  const required_prefix = release.split(".").slice(0, 2).join(".");
  const installed = await read_installed_sdk_info();
  const mismatches = installed.filter(
    (pkg) => !pkg.version || !pkg.version.startsWith(`${required_prefix}.`),
  );
  if (mismatches.length > 0) {
    const details = mismatches
      .map((pkg) => `${pkg.name}=${pkg.version ?? "missing"}`)
      .join(", ");
    throw new Error(
      `Installed SDK packages do not match card release ${release}: ${details}`,
    );
  }
}

function sdk_cache_root() {
  return path.join(os.homedir(), ".excelibur", "sdk-cache");
}

function sanitize_release_for_path(release: string) {
  return release.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function prefetch_sdk_from_card(options: {
  url: string | URL;
  release: string;
}) {
  const urls = derive_sdk_package_urls(options.url);
  const release_dir = path.join(
    sdk_cache_root(),
    sanitize_release_for_path(options.release),
  );
  await fs.mkdir(release_dir, { recursive: true });

  const files = {
    vapi: path.join(release_dir, "vapi.tar.gz"),
    vscript: path.join(release_dir, "vscript.tar.gz"),
    vutil: path.join(release_dir, "vutil.tar.gz"),
  } satisfies Record<SdkPackageName, string>;

  for (const name of SDK_PACKAGE_NAMES) {
    const response = await fetch(urls[name]);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${name} from ${urls[name]}: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(files[name], buffer);
  }

  const manifest = {
    release: options.release,
    fetched_at: new Date().toISOString(),
    urls,
    files,
  };
  await fs.writeFile(
    path.join(release_dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return {
    cache_dir: release_dir,
    release: options.release,
    urls,
    files,
  } satisfies CachedSdkInfo;
}
