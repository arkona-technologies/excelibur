import fs from "fs/promises";

export function derive_settings_url(url: string | URL): string {
  const ws_url = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const http_url = new URL(ws_url.toString());
  if (http_url.protocol === "ws:") {
    http_url.protocol = "http:";
  } else if (http_url.protocol === "wss:") {
    http_url.protocol = "https:";
  }
  http_url.pathname = `${http_url.pathname.replace(/\/$/, "")}/settings.json`;
  return http_url.toString();
}

export function sanitize_settings_value(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize_settings_value(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => key !== "node_id_status" && key !== "node_id_command")
      .map(([key, child]) => [key, sanitize_settings_value(child)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function sanitize_settings_json_text(raw_json: string): string {
  const parsed = JSON.parse(raw_json);
  return `${JSON.stringify(sanitize_settings_value(parsed), null, 2)}\n`;
}

export async function sanitize_settings_file(file_path: string) {
  const raw = await fs.readFile(file_path, "utf8");
  await fs.writeFile(file_path, sanitize_settings_json_text(raw));
}

export async function download_settings_json(settings_url: string | URL) {
  const response = await fetch(settings_url);
  if (!response.ok) {
    throw new Error(
      `Failed to download settings from ${settings_url.toString()}: ${response.status} ${response.statusText}`,
    );
  }
  return await response.text();
}

export async function download_and_save_settings_json(options: {
  settings_url: string | URL;
  output_file: string;
  sanitize?: boolean;
}) {
  const raw = await download_settings_json(options.settings_url);
  const output = options.sanitize === false ? raw : sanitize_settings_json_text(raw);
  await fs.writeFile(options.output_file, output.endsWith("\n") ? output : `${output}\n`);
}
