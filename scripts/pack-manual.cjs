/**
 * pack-manual.cjs — assemble a portable desktop build by hand:
 * extract the cached Electron runtime, drop our game into resources/app,
 * rename the launcher, and zip the folder.
 *
 * electron-builder's extractor fails on this machine, and freshly written
 * binaries get briefly locked by the host shell's scanner — so we extract
 * with unzip (excluding default_app.asar, which Electron does not need when
 * resources/app exists) and retry every filesystem step.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const electronVer = require(path.join(root, "node_modules/electron/package.json")).version;

// locate the cached electron zip
const cacheRoot = path.join(os.homedir(), "AppData", "Local", "electron", "Cache");
let zipPath = null;
for (const dir of fs.readdirSync(cacheRoot)) {
  const cand = path.join(cacheRoot, dir, `electron-v${electronVer}-win32-x64.zip`);
  if (fs.existsSync(cand)) { zipPath = cand; break; }
}
if (!zipPath) { console.error("FAIL: electron zip not found in cache"); process.exit(1); }
console.log("zip:", zipPath);

const buildRoot = path.join(os.tmpdir(), "blades-of-eras-build-" + Date.now());
const appDirOut = path.join(buildRoot, "blades-of-eras");
const outDir = path.join(root, "release");
fs.rmSync(buildRoot, { recursive: true, force: true });
fs.mkdirSync(buildRoot, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const REQUIRED = ["electron.exe", "ffmpeg.dll", "icudtl.dat", "resources.pak"];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const withRetry = (fn, tries = 8, delayMs = 2000) => {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tries) throw e;
      sleep(delayMs);
    }
  }
};

let done = false;
for (let attempt = 1; attempt <= 6 && !done; attempt++) {
  withRetry(() => fs.rmSync(appDirOut, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 }));
  fs.mkdirSync(appDirOut, { recursive: true });
  try {
    execFileSync("unzip", ["-q", "-o", zipPath, "-x", "resources/default_app.asar", "-d", appDirOut], { stdio: "pipe" });
  } catch {
    console.log(`attempt ${attempt}: unzip reported error, checking files anyway`);
  }
  const missing = REQUIRED.filter((f) => {
    const p = path.join(appDirOut, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });
  if (missing.length === 0) {
    done = true;
    console.log(`attempt ${attempt}: extraction complete`);
  } else {
    console.log(`attempt ${attempt}: missing ${missing.join(", ")} — retrying in 10s`);
    sleep(10000);
  }
}
if (!done) { console.error("FAIL: could not extract electron runtime"); process.exit(1); }

// rename launcher (retry — the host shell briefly scans new binaries)
withRetry(() => fs.renameSync(path.join(appDirOut, "electron.exe"), path.join(appDirOut, "blades-of-eras.exe")));
console.log("launcher renamed");

// our app goes to resources/app — electron loads it automatically
const resApp = path.join(appDirOut, "resources", "app");
fs.rmSync(resApp, { recursive: true, force: true });
fs.mkdirSync(resApp, { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(resApp, "dist"), { recursive: true });
fs.cpSync(path.join(root, "electron"), path.join(resApp, "electron"), { recursive: true });
fs.writeFileSync(
  path.join(resApp, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, main: "electron/main.cjs" }, null, 2),
);
console.log("app copied");

// zip the folder (PowerShell Compress-Archive — Git Bash tar can't write zip)
const zipTmp = path.join(buildRoot, "blades-of-eras-win64.zip");
const zipOut = path.join(outDir, "blades-of-eras-win64.zip");
fs.rmSync(zipTmp, { force: true });
fs.rmSync(zipOut, { force: true });
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${appDirOut}' -DestinationPath '${zipTmp}' -CompressionLevel Optimal`],
  { stdio: "inherit" },
);

fs.copyFileSync(zipTmp, zipOut);
const size = (fs.statSync(zipOut).size / 1024 / 1024).toFixed(1);
console.log(`OK: ${zipOut} (${size} MB)`);
console.log(`OK: ${path.join(appDirOut, "blades-of-eras.exe")}`);
