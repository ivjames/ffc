// Single-process manager for the synthetic load bot (scripts/course-bot.mjs),
// driven by the admin control plane (routes/admin/syntheticBot.js). At most ONE
// bot runs per API process.
//
// LIFETIME: the child is spawned NON-detached, so it shares the API's lifetime.
// An API restart (deploy, crash, `ffc restart`) takes the bot down with it and
// status() then reads "stopped" — there is no orphan to reap and no bot that
// outlives the operator's view of it. Persisting a bot across restarts is a
// deliberate non-goal (that's what a standing pm2 process is for); this control
// plane is for interactive, supervised runs.
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
    env: { ...env, SYNTHETIC_BOT_KEY: key },
    stdio: ["ignore", "pipe", "pipe"],
  });

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
