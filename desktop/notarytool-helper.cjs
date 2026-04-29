const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const envFilePath = path.resolve(__dirname, "..", ".env.local");
const defaultStatusPath = path.resolve(__dirname, "..", "dist", "notarization-status.json");
const defaultAppPath = path.resolve(__dirname, "..", "dist", "mac-universal", "Excelibur.app");

function readLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const entries = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function resolveEnvValue(localEnv, ...keys) {
  for (const key of keys) {
    const value = process.env[key] || localEnv[key];
    if (value) {
      return value;
    }
  }
  return "";
}

async function runJsonCommand(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  const trimmed = (stdout || "").trim();
  if (!trimmed) {
    throw new Error(
      `Command ${command} ${args.join(" ")} returned no JSON output.${stderr ? ` stderr: ${stderr}` : ""}`,
    );
  }
  return JSON.parse(trimmed);
}

async function runCommand(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return { stdout: stdout || "", stderr: stderr || "" };
}

function readSubmissionIdFromStatusFile() {
  if (!fs.existsSync(defaultStatusPath)) {
    return "";
  }
  try {
    const payload = JSON.parse(fs.readFileSync(defaultStatusPath, "utf8"));
    return payload.submissionId || "";
  } catch {
    return "";
  }
}

async function main() {
  const localEnv = readLocalEnv(envFilePath);
  const appleId = resolveEnvValue(localEnv, "APPLE_ID", "EXCELIBUR_APPLE_ID");
  const appleIdPassword = resolveEnvValue(
    localEnv,
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_ID_PASSWORD",
    "EXCELIBUR_APPLE_APP_SPECIFIC_PASSWORD",
  );
  const teamId = resolveEnvValue(localEnv, "APPLE_TEAM_ID", "TEAM_ID", "EXCELIBUR_TEAM_ID");

  if (!appleId || !appleIdPassword || !teamId) {
    console.error(
      "Missing Apple notarization credentials. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID in .env.local or the environment.",
    );
    process.exit(1);
  }

  const command = process.argv[2] || "status";
  const submissionId = process.argv[3] || readSubmissionIdFromStatusFile();

  if ((command === "status" || command === "log") && !submissionId) {
    console.error("Missing submission ID and no dist/notarization-status.json submissionId found.");
    process.exit(1);
  }

  if (command === "status") {
    const info = await runJsonCommand("xcrun", [
      "notarytool",
      "info",
      submissionId,
      "--apple-id",
      appleId,
      "--password",
      appleIdPassword,
      "--team-id",
      teamId,
      "--output-format",
      "json",
    ]);
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (command === "log") {
    const log = await runJsonCommand("xcrun", [
      "notarytool",
      "log",
      submissionId,
      "--apple-id",
      appleId,
      "--password",
      appleIdPassword,
      "--team-id",
      teamId,
      "--output-format",
      "json",
    ]);
    console.log(JSON.stringify(log, null, 2));
    return;
  }

  if (command === "staple") {
    const targetPath = process.argv[3] || defaultAppPath;
    const result = await runCommand("xcrun", ["stapler", "staple", targetPath]);
    if (result.stdout.trim()) {
      console.log(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Use one of: status, log, staple");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

