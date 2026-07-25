/*
 * Koby desktop launcher.
 *
 * Runs in two interchangeable modes:
 *   1. Compiled into Koby.exe (@yao-pkg/pkg): expects app.zip next to the exe,
 *      extracts it into Documents\Koby\app.
 *   2. Plain script inside the extracted app.zip, started by "Start Koby.bat"
 *      via the bundled node.exe: copies its own folder into Documents\Koby\app.
 *      This path has no exe packaging involved at all — it is the fallback when
 *      Koby.exe won't start on a given machine (antivirus, SmartScreen, etc.).
 *
 * Both modes then do the same thing: keep user data (database, uploads, .env)
 * in Documents\Koby outside the app folder, sync the database schema, start the
 * bundled Node server, and open the browser (the /setup page first if no
 * Anthropic API key is saved yet).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const IS_PKG = typeof process.pkg !== "undefined";
// In pkg mode __dirname points into the virtual snapshot; the real location is the exe's dir.
const selfDir = IS_PKG ? path.dirname(process.execPath) : __dirname;

// ---- Logging: every line also goes to koby-launcher.log next to the exe/script,
// so a crash that closes the console window still leaves evidence behind. ----
let logStream = null;
for (const candidate of [path.join(selfDir, "koby-launcher.log"), path.join(os.tmpdir(), "koby-launcher.log")]) {
  try {
    logStream = fs.createWriteStream(candidate, { flags: "w" });
    break;
  } catch {}
}
function writeLog(line) {
  if (logStream) {
    try {
      logStream.write(line + "\n");
    } catch {}
  }
}
function log(msg) {
  console.log(`[Koby] ${msg}`);
  writeLog(`[Koby] ${msg}`);
}

function holdWindowOpen() {
  try {
    spawnSync("cmd", ["/c", "pause"], { stdio: "inherit" });
  } catch {
    try {
      spawnSync(process.platform === "win32" ? "timeout" : "sleep", ["60"], { stdio: "inherit" });
    } catch {}
  }
}

function fail(msg) {
  console.error(`\n[Koby] ERROR: ${msg}`);
  writeLog(`[Koby] ERROR: ${msg}`);
  console.error("[Koby] Details were saved to koby-launcher.log next to the launcher.");
  console.error("[Koby] Press a key to close.");
  holdWindowOpen();
  process.exit(1);
}

// Any error we did not anticipate must never flash-close the window silently.
process.on("uncaughtException", (err) => {
  fail(`Unexpected error: ${err && err.stack ? err.stack : err}`);
});
process.on("unhandledRejection", (err) => {
  fail(`Unexpected error (async): ${err && err.stack ? err.stack : err}`);
});

writeLog(
  `Koby launcher starting. mode=${IS_PKG ? "exe" : "script"} self=${selfDir} node=${process.version} platform=${process.platform} arch=${process.arch}`
);

const installDir = path.join(process.env.USERPROFILE || os.homedir(), "Documents", "Koby");
const appDir = path.join(installDir, "app");
const dataDir = path.join(installDir, "data");
const envFile = path.join(installDir, ".env");
const dbFile = path.join(dataDir, "koby.db");
const BASE_PORT = 3210;

function readVersion(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function installedOk() {
  return fs.existsSync(path.join(appDir, "server", "server.js"));
}

function installFromZip() {
  const zipPath = path.join(selfDir, "app.zip");
  if (!fs.existsSync(zipPath)) {
    if (installedOk()) {
      log("app.zip not found next to Koby.exe — starting the installed copy.");
      return;
    }
    fail(
      "app.zip was not found next to Koby.exe. Keep Koby.exe and app.zip in the same folder (download both from the Application repo)."
    );
  }
  let AdmZip;
  try {
    AdmZip = require("adm-zip");
  } catch (e) {
    fail(`Could not load the bundled zip module: ${e.message}`);
  }
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry("version.txt");
  const zipVersion = entry ? zip.readAsText(entry).trim() : "unknown";
  const installedVersion = readVersion(path.join(appDir, "version.txt"));
  if (installedVersion === zipVersion && installedOk()) {
    log(`App is up to date (version ${installedVersion}).`);
    return;
  }
  log(
    installedVersion
      ? `Updating app ${installedVersion} -> ${zipVersion} …`
      : `Installing Koby ${zipVersion} into ${installDir} …`
  );
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  zip.extractAllTo(appDir, true);
  log("Install complete.");
}

function installFromFolder() {
  // Script mode: this file sits inside the extracted app.zip — the folder IS the payload.
  const srcVersion = readVersion(path.join(selfDir, "version.txt"));
  if (!srcVersion || !fs.existsSync(path.join(selfDir, "server", "server.js"))) {
    fail(
      "This launcher must run from inside the extracted app.zip folder (server\\ and version.txt were not found next to it)."
    );
  }
  const installedVersion = readVersion(path.join(appDir, "version.txt"));
  if (installedVersion === srcVersion && installedOk()) {
    log(`App is up to date (version ${installedVersion}).`);
    return;
  }
  log(
    installedVersion
      ? `Updating app ${installedVersion} -> ${srcVersion} …`
      : `Installing Koby ${srcVersion} into ${installDir} … (first install copies ~300 MB, give it a minute)`
  );
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync(selfDir, appDir, { recursive: true });
  log("Install complete.");
}

function ensureEnv() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(envFile)) {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(
      envFile,
      `# Koby desktop configuration — safe to edit.\n` +
        `SESSION_SECRET="${secret}"\n` +
        `# Paste your Anthropic API key below (or use the setup page in the browser):\n` +
        `# ANTHROPIC_API_KEY="sk-ant-..."\n`,
      "utf8"
    );
    log(`Created ${envFile}`);
  }
}

function parseEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

function dbUrl() {
  return "file:" + dbFile.replace(/\\/g, "/");
}

function nodeExe() {
  // KOBY_NODE_BIN lets the build machine test this script with its own node.
  return process.env.KOBY_NODE_BIN || path.join(appDir, "node", "node.exe");
}

function applySchema() {
  const firstRun = !fs.existsSync(dbFile);
  if (firstRun) {
    const template = path.join(appDir, "template", "koby.db");
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, dbFile);
      log("Created a fresh database.");
      return;
    }
  }
  // Updates (or missing template): let Prisma sync the schema in place.
  const cli = path.join(appDir, "prisma-cli", "node_modules", "prisma", "build", "index.js");
  const schema = path.join(appDir, "prisma", "schema.prisma");
  const engine = path.join(appDir, "engines", "schema-engine-windows.exe");
  if (!fs.existsSync(cli)) return;
  log("Checking database schema…");
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl(),
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    CI: "1",
  };
  if (fs.existsSync(engine) && !process.env.KOBY_NODE_BIN) {
    env.PRISMA_SCHEMA_ENGINE_BINARY = engine;
  }
  const r = spawnSync(nodeExe(), [cli, "db", "push", "--skip-generate", `--schema=${schema}`], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (r.status === 0) {
    log("Database schema is up to date.");
  } else {
    log("Schema check could not run — continuing with the existing database.");
    if (r.stderr) writeLog(String(r.stderr).slice(0, 1000));
  }
}

function waitForServer(port, tries, cb) {
  const req = http.get({ host: "127.0.0.1", port, path: "/api/auth/config", timeout: 2000 }, () => cb(true));
  req.on("error", () => (tries <= 0 ? cb(false) : setTimeout(() => waitForServer(port, tries - 1, cb), 1000)));
  req.on("timeout", () => {
    req.destroy();
    tries <= 0 ? cb(false) : setTimeout(() => waitForServer(port, tries - 1, cb), 1000);
  });
}

function portFree(port, cb) {
  const srv = require("net").createServer();
  srv.once("error", () => cb(false));
  srv.once("listening", () => srv.close(() => cb(true)));
  srv.listen(port, "127.0.0.1");
}

function pickPort(port, attempts, cb) {
  if (attempts <= 0) return cb(port);
  portFree(port, (free) => (free ? cb(port) : pickPort(port + 1, attempts - 1, cb)));
}

function start() {
  console.log("==============================================");
  console.log("  Koby — AI Real Estate Underwriting (local)");
  console.log("==============================================\n");

  if (IS_PKG) installFromZip();
  else installFromFolder();
  ensureEnv();
  applySchema();

  const envVars = parseEnv();
  pickPort(BASE_PORT, 6, (port) => {
    const serverDir = path.join(appDir, "server");
    log(`Starting server on http://localhost:${port} …`);
    const child = spawn(nodeExe(), [path.join(serverDir, "server.js")], {
      cwd: serverDir,
      env: {
        ...process.env,
        ...envVars,
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: dbUrl(),
        KOBY_DESKTOP: "1",
        KOBY_ENV_FILE: envFile,
        KOBY_DATA_DIR: installDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => {
      process.stdout.write(d);
      writeLog(String(d).trimEnd());
    });
    child.stderr.on("data", (d) => {
      process.stderr.write(d);
      writeLog(String(d).trimEnd());
    });
    child.on("error", (e) => fail(`Could not start the bundled Node runtime: ${e.message}`));
    child.on("exit", (code) => {
      if (code !== 0) fail(`The server stopped unexpectedly (code ${code}). See messages above.`);
      process.exit(0);
    });

    waitForServer(port, 60, (ok) => {
      if (!ok) return fail("The server did not respond within 60 seconds.");
      const target = envVars.ANTHROPIC_API_KEY
        ? `http://localhost:${port}/`
        : `http://localhost:${port}/setup`;
      log(`Koby is running. Opening ${target}`);
      log("Keep this window open while you use Koby. Close it (or press Ctrl+C) to stop.");
      if (process.platform === "win32") {
        spawn("cmd", ["/c", "start", "", target], { stdio: "ignore", detached: true });
      }
    });

    process.on("SIGINT", () => {
      log("Stopping…");
      child.kill();
      process.exit(0);
    });
  });
}

start();
