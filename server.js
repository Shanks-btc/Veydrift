console.log("[veydrift diag] PORTFOLIO_VALUE_USD =", JSON.stringify(process.env.PORTFOLIO_VALUE_USD));
console.log("[veydrift diag] KEEL_DATA_DIR =", JSON.stringify(process.env.KEEL_DATA_DIR));
console.log("[veydrift diag] I_UNDERSTAND_REAL_FUNDS =", JSON.stringify(process.env.I_UNDERSTAND_REAL_FUNDS));
console.log("[veydrift diag] CMC_API_KEY set? =", process.env.CMC_API_KEY ? "yes, length " + process.env.CMC_API_KEY.length : "NOT SET");
console.log("[veydrift diag] Total env var count =", Object.keys(process.env).length);

// Railway single-service entrypoint.
// Starts the Next.js web dashboard and runs the scheduler cycle in-process
// so both share the same KEEL_DATA_DIR volume mount.
//
// Does NOT import any agent or web internals — only spawns existing CLI
// entrypoints as child processes.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────

const CYCLE_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const isLive = process.env["I_UNDERSTAND_REAL_FUNDS"] === "yes";
const mode = isLive ? "LIVE" : "DRY-RUN/SAFE";
const dataDir = process.env["KEEL_DATA_DIR"] ?? path.resolve(__dirname, "data");
const runOnBoot = process.env["KEEL_RUN_ON_BOOT"] !== "false";

// ── Startup diagnostics (no secrets) ─────────────────────────────────────────

console.log(`[veydrift server] Starting in ${mode} mode`);
console.log(`[veydrift server] Resolved data directory: ${dataDir}`);

let writable = false;
try {
  const probe = path.join(dataDir, ".write-probe");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(probe, "probe");
  fs.unlinkSync(probe);
  writable = true;
} catch {
  writable = false;
}
console.log(`[veydrift server] Data directory writable: ${writable}`);

// ── TWAK keystore reconstruction ─────────────────────────────────────────────
// Runs synchronously before any child process is spawned.
// Decodes wallet.json and credentials.json from base64 env vars and writes
// them to ~/.twak/ so the twak CLI can find them regardless of container user.
// NEVER logs decoded content or the base64 strings — only booleans.

(function reconstructKeystore() {
  const walletB64      = process.env["TWAK_WALLET_JSON_B64"];
  const credentialsB64 = process.env["TWAK_CREDENTIALS_JSON_B64"];

  if (!walletB64 || !credentialsB64) {
    console.log("[veydrift server] TWAK keystore env vars not set — skipping reconstruction");
    return;
  }

  const twakDir = path.join(os.homedir(), ".twak");
  let walletOk = false;
  let credentialsOk = false;

  try {
    fs.mkdirSync(twakDir, { recursive: true });

    fs.writeFileSync(
      path.join(twakDir, "wallet.json"),
      Buffer.from(walletB64, "base64"),
    );
    walletOk = true;

    fs.writeFileSync(
      path.join(twakDir, "credentials.json"),
      Buffer.from(credentialsB64, "base64"),
    );
    credentialsOk = true;
  } catch (err) {
    console.error(`[veydrift server] Keystore reconstruction error: ${err.message}`);
  }

  console.log(
    `[veydrift server] Keystore reconstructed: wallet.json=${walletOk} credentials.json=${credentialsOk}`,
  );
})();

// ── Boot-time password scrub ──────────────────────────────────────────────────
// Redacts any leaked --password <value> strings from persisted data files.
// This runs synchronously before cycles start.

(function scrubDataFiles() {
  const PATTERN = /--password\s+\S+/g;
  const REDACTED = "--password <redacted>";
  const targets = [
    path.join(dataDir, "agent-state.json"),
    path.join(dataDir, "audit.jsonl"),
  ];
  for (const filePath of targets) {
    try {
      const original = fs.readFileSync(filePath, "utf8");
      if (!PATTERN.test(original)) continue;
      PATTERN.lastIndex = 0; // reset after test()
      const scrubbed = original.replace(PATTERN, REDACTED);
      fs.writeFileSync(filePath, scrubbed, "utf8");
      console.log(`[veydrift server] Scrubbed --password leak from ${path.basename(filePath)}`);
    } catch {
      // File doesn't exist or unreadable — not an error
    }
  }
})();

// ── Cycle runner ──────────────────────────────────────────────────────────────

function runCycle() {
  console.log(`[veydrift server] Spawning scheduler cycle · ${new Date().toISOString()}`);
  const child = spawn("npm", ["run", "run:cycle"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("error", (err) => {
    console.error(`[veydrift server] Cycle spawn error: ${err.message}`);
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`[veydrift server] Cycle exited with code ${code}`);
    } else {
      console.log(`[veydrift server] Cycle complete · ${new Date().toISOString()}`);
    }
    // Non-zero exit is intentionally non-fatal — web dashboard stays up.
  });
}

// ── Start Next.js ─────────────────────────────────────────────────────────────

const web = spawn("npm", ["run", "start", "--workspace=apps/web"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

web.on("error", (err) => {
  console.error(`[veydrift server] Next.js spawn error: ${err.message}`);
  process.exit(1);
});

web.on("close", (code) => {
  console.error(`[veydrift server] Next.js exited with code ${code} — shutting down`);
  process.exit(code ?? 1);
});

// ── Boot cycle + interval ─────────────────────────────────────────────────────

if (runOnBoot) {
  // Small delay so Next.js can begin starting before the first cycle log appears.
  setTimeout(runCycle, 2000);
} else {
  console.log("[veydrift server] KEEL_RUN_ON_BOOT=false — skipping boot cycle");
}

setInterval(runCycle, CYCLE_INTERVAL_MS);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[veydrift server] Received ${signal} — forwarding to Next.js child`);
  if (web && !web.killed) {
    web.kill(signal);
  }
  // Exit after a short grace period in case web.close fires first.
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
