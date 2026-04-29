const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const certificatePath = path.resolve(__dirname, "..", ".local", "ExceliburCertificate.p12");
const envFilePath = path.resolve(__dirname, "..", ".env.local");

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

const localEnv = readLocalEnv(envFilePath);
const certificatePassword =
  process.env.CSC_KEY_PASSWORD ||
  process.env.EXCELIBUR_CERT_PASSWORD ||
  localEnv.CSC_KEY_PASSWORD ||
  localEnv.EXCELIBUR_CERT_PASSWORD ||
  "";

if (!certificatePassword) {
  console.error(
    "Missing certificate password. Set CSC_KEY_PASSWORD or EXCELIBUR_CERT_PASSWORD before running desktop-pack.",
  );
  process.exit(1);
}

console.log("[excelibur] desktop-pack: using local .p12 signing certificate");
console.log(`[excelibur] desktop-pack: certificate=${path.basename(certificatePath)}`);
console.log("[excelibur] desktop-pack: launching electron-builder");

const child = spawn(
  "npx",
  ["electron-builder"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CSC_LINK: process.env.CSC_LINK || certificatePath,
      CSC_KEY_PASSWORD: certificatePassword,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  console.log(`[excelibur] desktop-pack: electron-builder exited with code ${code ?? 1}`);
  process.exit(code ?? 1);
});
