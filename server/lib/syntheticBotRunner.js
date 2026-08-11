// Single-process manager for the synthetic load bot (scripts/course-bot.mjs),
// driven by the admin control plane (routes/admin/syntheticBot.js). At most ONE
// bot runs per API process.
//
// LIFETIME: the bot must not outlive the API that manages it — otherwise a
// restart would leave an orphan posting rounds while status() reports "stopped"
// (a fresh module state), letting an operator start a second bot with no way to
// stop the first. `detached: false` alone does NOT guarantee this: on a SIGKILL
// or crash the child is reparented to init and keeps running. So death is
// enforced from BOTH ends:
//   - child side (the reliable one): the bot is spawned with
//     FFC_EXIT_WITH_PARENT=1, so course-bot.mjs runs a watchdog that exits the
//     moment it is reparented (its parent — this API — has died). This covers
//     the SIGKILL/crash case the parent can't clean up after.
//   - parent side (fast path): a synchronous 'exit' handler here kills the child
//     on the API's own normal shutdown.
// Persisting a bot across restarts is a deliberate non-goal (that's what a
// standing pm2 process is for); this control plane is for supervised runs.
//
// SECRET HANDLING: the child needs SYNTHETIC_BOT_KEY; the browser must never see
// it. The key is read from THIS process's env and injected into the child's env
// only — it never crosses the admin API in either direction. The API surface
// exposes a `keySet` boolean and nothing more.
//
// SAFETY: start() only ever spawns a fixed script with a caller-validated argv
// (the route validates ranges) — never a shell, never operator-supplied command
// text — so this is not a general command-execution surface.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// scripts/course-bot.mjs, resolved from this file (server/lib/ → repo root).
const BOT_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/course-bot.mjs"
);
const MAX_LOG_LINES = 200;

// Module singleton — the one bot slot for this API process.
let state = {
  child: null,
  startedAt: null,
  params: null,
  logs: [], // ring buffer of { at, line }
  lastExit: null, // { at, code, signal }
};

function pushLog(chunk) {
  const at = new Date().toISOString();
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim() === "") continue;
    state.logs.push({ at, line });
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
  }
}

export function isRunning() {
  return state.child !== null;
}

// Fast-path cleanup for the API's OWN normal shutdown: synchronously signal the
// child on process 'exit'. Registered once, lazily, only after a bot is spawned.
// This does NOT cover SIGKILL/crash (no handler runs then) — the child-side
// watchdog is the backstop for those. We only touch 'exit' (not SIGINT/SIGTERM)
// so we never override the API's own signal handling.
let parentExitKillRegistered = false;
function registerParentExitKill() {
  if (parentExitKillRegistered) return;
  parentExitKillRegistered = true;
  process.once("exit", () => {
    if (state.child) {
      try {
        state.child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  });
}

// argv for course-bot.mjs from already-validated params. --yes skips its
// interactive confirm; --api points the bot back at THIS server over loopback
// (no TLS/proxy hop, and it can't reach another host).
function buildArgs(params, port) {
  const args = [
    BOT_SCRIPT,
    "--api",
    `http://127.0.0.1:${port}`,
    "--plays-per-course",
    String(params.playsPerCourse),
    "--interval-min",
    String(params.intervalMin),
    "--max-players",
    String(params.maxPlayers),
    "--concurrency",
    String(params.concurrency),
    "--yes",
  ];
  if (params.locationId) args.push("--location", params.locationId);
  if (params.ignoreHours) args.push("--ignore-hours");
  return args;
}

/**
 * Start the bot with validated params. Throws if one is already running or if
 * SYNTHETIC_BOT_KEY is unset (the server would 403 every synthetic round). The
 * env arg is a seam for tests; production passes process.env.
 */
export function start(params, env = process.env) {
  if (state.child) throw new Error("bot already running");
  const key = env.SYNTHETIC_BOT_KEY;
  if (!key) throw new Error("SYNTHETIC_BOT_KEY is not set on the server");

  const port = env.PORT || 8060;
  const args = buildArgs(params, port);
  const child = spawn(process.execPath, args, {
    // Inject the key into the child only; inherit the rest of the API's env.
    // FFC_EXIT_WITH_PARENT arms the bot's own parent-death watchdog, so it stops
    // itself if this API dies without a chance to kill it (SIGKILL / crash).
    env: { ...env, SYNTHETIC_BOT_KEY: key, FFC_EXIT_WITH_PARENT: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  registerParentExitKill();

  state = {
    child,
    startedAt: new Date().toISOString(),
    params,
    logs: [],
    lastExit: null,
  };
  pushLog(`▶ started: course-bot ${args.slice(1).join(" ")}`);
  child.stdout.on("data", (b) => pushLog(b.toString()));
  child.stderr.on("data", (b) => pushLog(b.toString()));
  child.on("exit", (code, signal) => {
    pushLog(`■ exited (code=${code} signal=${signal ?? "none"})`);
    state.lastExit = { at: new Date().toISOString(), code, signal };
    state.child = null;
    state.startedAt = null;
  });
  child.on("error", (err) => pushLog(`✗ spawn error: ${err.message}`));
  return status();
}

/**
 * Ask the bot to stop. SIGINT lets course-bot finish its current sweep and exit
 * cleanly (it traps SIGINT); the exit handler clears state. Idempotent — a stop
 * with nothing running just returns the current status.
 */
export function stop() {
  if (!state.child) return status();
  state.child.kill("SIGINT");
  pushLog("↩ stop requested (SIGINT — finishing current sweep)");
  return status();
}

/** Current runner snapshot (safe to serialize straight to the admin client). */
export function status() {
  return {
    running: state.child !== null,
    pid: state.child?.pid ?? null,
    startedAt: state.startedAt,
    params: state.params,
    lastExit: state.lastExit,
    logs: state.logs.slice(-MAX_LOG_LINES),
  };
}

/** Test seam: hard-reset the singleton (kills any child) between test cases. */
export function _reset() {
  if (state.child) {
    try {
      state.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  state = { child: null, startedAt: null, params: null, logs: [], lastExit: null };
}
