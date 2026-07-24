/*
 * Koby desktop launcher (compiled to Koby.exe with @yao-pkg/pkg).
 *
 * What it does on every start:
 *   1. Installs/updates the app into  Documents\Koby  (first run, or when the
 *      app.zip next to the exe is a newer version). User data — database,
 *      uploads, .env — lives in Documents\Koby and is never touched by updates.
 *   2. Creates .env with a random session secret on first run.
 *   3. Applies the database schema (bundled Prisma CLI; falls back to copying a
 *      blank template database on first run).
 *   4. Starts the bundled Node server and opens your browser — the /setup page
 *      first if no Anthropic API key is saved yet.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const AdmZip = require("adm-zip");

const exeDir = path.dirname(process.execPath);
const installDir = path.join(
  process.env.USERPROFILE || require("os").homedir(),
  "Documents",
  "Koby"
);
const appDir = path.join(installDir, "app");
const dataDir = path.join(installDir, "data");
const envFile = path.join(installDir, ".env");
const dbFile = path.join(dataDir, "koby.db");
const BASE_PORT = 3210;

function log(msg) {
  console.log(`[Koby] ${msg}`);
}

function fail(msg) {
  console.error(`\n[Koby] ERROR: ${msg}`);
  console.error("[Koby] Press Enter to close.");
  try {
    spawnSync("cmd", ["/c", "pause"], { stdio: "inherit" });
  } catch {}
  process.exit(1);
}

function readVersion(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function installOrUpdate() {
  const zipPath = path.join(exeDir, "app.zip");
  if (!fs.existsSync(zipPath)) {
    if (fs.existsSync(path.join(appDir, "server", "server.js"))) {
      log("app.zip not found next to Koby.exe — starting the installed copy.");
      return;
    }
    fail(
      "app.zip was not found next to Koby.exe. Keep Koby.exe and app.zip in the same folder (download both from the Application repo)."
    );
  }

  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry("version.txt");
  const zipVersion = entry ? zip.readAsText(entry).trim() : "unknown";
  const installedVersion = readVersion(path.join(appDir, "version.txt"));

  if (installedVersion === zipVersion && fs.existsSync(path.join(appDir, "server", "server.js"))) {
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
  return path.join(appDir, "node", "node.exe");
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
  const r = spawnSync(nodeExe(), [cli, "db", "push", "--skip-generate", `--schema=${schema}`], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl(),
      PRISMA_SCHEMA_ENGINE_BINARY: fs.existsSync(engine) ? engine : undefined,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
      CI: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (r.status === 0) {
    log("Database schema is up to date.");
  } else {
    log("Schema check could not run — continuing with the existing database.");
    if (r.stderr) log(String(r.stderr).slice(0, 400));
  }
}

function waitForServer(port, tries, cb) {
  const req = http.get({ host: "127.0.0.1", port, path: "/api/auth/config", timeout: 2000 }, () =>
    cb(true)
  );
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

  if (process.platform !== "win32") {
    log("Note: this launcher is built for Windows; paths assume Documents\\Koby.");
  }

  installOrUpdate();
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
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));
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
