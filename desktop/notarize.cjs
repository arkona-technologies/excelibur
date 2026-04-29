const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const envFilePath = path.resolve(__dirname, "..", ".env.local");
const POLL_INTERVAL_MS = 20_000;
const MAX_WAIT_MS = 90 * 60 * 1000;

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

function maskEmail(email) {
  if (!email || !email.includes("@")) {
    return "<unset>";
  }
  const [local, domain] = email.split("@");
  const shortLocal =
    local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***`;
  return `${shortLocal}@${domain}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function runJsonCommand(command, args, options = {}) {
  const { stdout, stderr } = await runCommand(command, args, options);
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(
      `Command ${command} ${args.join(" ")} returned no JSON output.${stderr ? ` stderr: ${stderr}` : ""}`,
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Could not parse JSON from ${command} ${args.join(" ")}.${stderr ? ` stderr: ${stderr}` : ""}\nOutput:\n${stdout}`,
    );
  }
}

function writeStatusFile(statusPath, payload) {
  fs.writeFileSync(statusPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

module.exports = async function notarizeAfterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  console.log("[excelibur] notarize: afterSign hook entered");

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
    console.log(
      "[excelibur] notarize: skipped because APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID is missing",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const statusPath = path.resolve(context.appOutDir, "..", "notarization-status.json");
  const start = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "excelibur-notarize-"));
  const zipPath = path.join(tempDir, `${appName}.zip`);

  console.log(`[excelibur] notarize: appPath=${appPath}`);
  console.log(`[excelibur] notarize: appleId=${maskEmail(appleId)} teamId=${teamId}`);
  console.log("[excelibur] notarize: credential source=.env.local/environment");

  try {
    console.log(`[excelibur] notarize: zipping app to ${zipPath}`);
    await runCommand(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", `${appName}.app`, zipPath],
      { cwd: context.appOutDir },
    );

    console.log("[excelibur] notarize: submitting ZIP to Apple");
    const submission = await runJsonCommand("xcrun", [
      "notarytool",
      "submit",
      zipPath,
      "--apple-id",
      appleId,
      "--password",
      appleIdPassword,
      "--team-id",
      teamId,
      "--output-format",
      "json",
    ]);

    const submissionId = submission.id;
    if (!submissionId) {
      throw new Error(`Submission ID missing from notarytool submit response: ${JSON.stringify(submission, null, 2)}`);
    }

    console.log(`[excelibur] notarize: submission id=${submissionId}`);
    console.log("[excelibur] notarize: polling Apple for final status...");
    writeStatusFile(statusPath, {
      status: "submitted",
      submissionId,
      appName,
      appPath,
      submittedAt: new Date().toISOString(),
      teamId,
    });

    while (true) {
      const elapsed = Date.now() - start;
      if (elapsed > MAX_WAIT_MS) {
        const seconds = Math.round(elapsed / 1000);
        writeStatusFile(statusPath, {
          status: "pending",
          submissionId,
          appName,
          appPath,
          elapsedSeconds: seconds,
          teamId,
          updatedAt: new Date().toISOString(),
        });
        console.warn(`[excelibur] notarize: still in progress after ${seconds}s`);
        console.warn(`[excelibur] notarize: submission id=${submissionId}`);
        console.warn(`[excelibur] notarize: saved pending status to ${statusPath}`);
        return;
      }

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

      const status = info.status || "Unknown";

      if (status === "Accepted") {
        console.log("[excelibur] notarize: stapling app");
        await runCommand("xcrun", ["stapler", "staple", appPath]);
        const seconds = Math.round((Date.now() - start) / 1000);
        writeStatusFile(statusPath, {
          status: "accepted",
          submissionId,
          appName,
          appPath,
          elapsedSeconds: seconds,
          teamId,
          updatedAt: new Date().toISOString(),
        });
        console.log(`[excelibur] notarize: completed for ${appName}.app in ${seconds}s`);
        break;
      }

      if (status === "Invalid" || status === "Rejected") {
        let logOutput = "<log unavailable>";
        try {
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
          logOutput = JSON.stringify(log, null, 2);
        } catch (error) {
          logOutput = `Could not fetch notarization log: ${error instanceof Error ? error.message : String(error)}`;
        }
        writeStatusFile(statusPath, {
          status: status.toLowerCase(),
          submissionId,
          appName,
          appPath,
          teamId,
          updatedAt: new Date().toISOString(),
          log: logOutput,
        });
        throw new Error(
          `Notarization ${status.toLowerCase()} for submission ${submissionId}.\n${logOutput}`,
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  } catch (error) {
    const seconds = Math.round((Date.now() - start) / 1000);
    console.error(`[excelibur] notarize: failed after ${seconds}s`);
    console.error(
      `[excelibur] notarize: ${error instanceof Error ? error.stack || error.message : String(error)}`,
    );
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
