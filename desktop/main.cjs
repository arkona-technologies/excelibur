const path = require("node:path");
const { app, BrowserWindow, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let serverHandle = null;
let manualUpdateCheckInProgress = false;
const windowIcon = path.join(__dirname, "..", "build-resources", "excelibur-square.png");
const updateState = {
  supported: false,
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  progressPercent: null,
  message: "Checking for updates is only available in packaged Excelibur builds.",
  lastCheckedAt: null,
  lastError: null,
};

function configureMenu() {
  const template = [
    {
      label: "Excelibur",
      submenu: [
        {
          label: "Check for Updates",
          click: async () => {
            await checkForUpdates(true);
          },
        },
        { type: "separator" },
        { role: "quit", label: "Quit Excelibur" },
      ],
    },
    {
      label: "Edit",
      submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggledevtools" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  updateState.supported = app.isPackaged;
  updateState.message = app.isPackaged
    ? "Ready to check for updates."
    : "Checking for updates is only available in packaged Excelibur builds.";

  autoUpdater.on("checking-for-update", () => {
    updateState.status = "checking";
    updateState.progressPercent = null;
    updateState.lastError = null;
    updateState.lastCheckedAt = new Date().toISOString();
    updateState.message = "Checking for updates...";
  });

  autoUpdater.on("update-available", (info) => {
    updateState.status = "available";
    updateState.availableVersion = info?.version ?? null;
    updateState.downloadedVersion = null;
    updateState.progressPercent = 0;
    updateState.message = `Version ${info?.version ?? "unknown"} is available. Downloading now...`;
  });

  autoUpdater.on("download-progress", (progress) => {
    updateState.status = "downloading";
    updateState.progressPercent = Math.round(progress.percent ?? 0);
    updateState.message = `Downloading update... ${updateState.progressPercent}%`;
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateState.status = "downloaded";
    updateState.downloadedVersion = info?.version ?? updateState.availableVersion;
    updateState.progressPercent = 100;
    updateState.message = `Version ${updateState.downloadedVersion ?? "unknown"} is ready to install.`;
  });

  autoUpdater.on("update-not-available", () => {
    updateState.status = "up-to-date";
    updateState.availableVersion = null;
    updateState.downloadedVersion = null;
    updateState.progressPercent = null;
    updateState.message = `Excelibur ${app.getVersion()} is up to date.`;
    if (manualUpdateCheckInProgress) {
      dialog.showMessageBox({
        type: "info",
        title: "Excelibur Up To Date",
        message: `Excelibur ${app.getVersion()} is already the latest published version.`,
      }).catch(() => {});
    }
  });

  autoUpdater.on("error", (error) => {
    updateState.status = "error";
    updateState.lastError = error instanceof Error ? error.message : String(error);
    updateState.message = updateState.lastError;
  });
}

function getUpdateState() {
  return { ...updateState };
}

async function installDownloadedUpdate() {
  if (updateState.status !== "downloaded") {
    return {
      ok: false,
      message: "No downloaded update is ready to install.",
    };
  }

  updateState.message = `Installing version ${updateState.downloadedVersion ?? ""}...`.trim();
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return {
    ok: true,
    message: updateState.message,
  };
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    updateState.supported = false;
    updateState.status = "unsupported";
    updateState.message = "Automatic updates are only available in packaged Excelibur builds.";
    if (manual) {
      await dialog.showMessageBox({
        type: "info",
        title: "Updates Unavailable",
        message:
          "Automatic updates are only available in packaged Excelibur builds.",
      });
    }
    return;
  }

  try {
    manualUpdateCheckInProgress = manual;
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (manual) {
      await dialog.showMessageBox({
        type: "error",
        title: "Update Check Failed",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  } finally {
    manualUpdateCheckInProgress = false;
  }
}

async function ensureServer() {
  if (!serverHandle) {
    const { startServer } = await import("../build/server-app.js");
    serverHandle = await startServer({
      host: "127.0.0.1",
      port: Number(process.env.PORT || "0"),
      desktop_update_api: {
        get_update_state: getUpdateState,
        check_for_updates: checkForUpdates,
        install_update: installDownloadedUpdate,
      },
    });
  }
  return serverHandle;
}

async function createMainWindow() {
  const { address } = await ensureServer();
  const startUrl = new URL("/sheets/", address).toString();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#090b0c",
    autoHideMenuBar: true,
    title: "Excelibur 2.9",
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(startUrl);
}

app.whenReady().then(async () => {
  configureMenu();
  configureAutoUpdater();
  await createMainWindow();
  await checkForUpdates(false);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (serverHandle) {
    await serverHandle.fastify.close().catch(() => {});
    serverHandle = null;
  }
});
