// Process manager for the ARCADE bots, driven by the admin control plane
// (routes/admin/arcadeBot.js). Two independent slots, because the arcade tool
// is two halves that are useful separately:
//
//   capture — scripts/arcade-bot.mjs, which plays the games in a real browser
//             and writes a score profile. Slow, needs Chromium.
//   replay  — scripts/arcade-traffic.mjs, which posts the awards a profile
//             implies. Fast, needs only the API.
//
// This deliberately mirrors lib/syntheticBotRunner.js rather than extending it:
// that module is a single course-bot slot with its own lifetime guarantees, and
// widening it to a registry would put the arcade's failure modes inside the
// thing that keeps the load bot honest. The careful part — never outliving the
// API — is reproduced here for the same reasons, spelled out below.
//
// LIFETIME: a bot must not outlive the API that manages it, or a restart leaves
// an orphan writing traffic while status() reports "stopped" (fresh module
// state), letting an operator start a second one with no way to stop the first.
// Death is enforced from both ends: the child gets FFC_EXIT_WITH_PARENT=1 (the
// scripts' own watchdog, which covers SIGKILL/crash where no parent handler
// runs), and a synchronous 'exit' handler here kills it on normal shutdown.
//
// SAFETY: start() only ever spawns a fixed script with a caller-validated argv
// (the route validates ranges) — never a shell, never operator-supplied command
// text — so this is not a general command-execution surface.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CAPTURE_SCRIPT = path.join(ROOT, "scripts/arcade-bot.mjs");
export const REPLAY_SCRIPT = path.join(ROOT, "scripts/arcade-traffic.mjs");
/** Captured profiles live here; the replay slot reads them back by name. */
export const PROFILE_DIR = path.join(ROOT, "data/arcade-profiles");

const MAX_LOG_LINES = 300;

/** One independent bot slot. */
function makeSlot(label) {
  let state = { child: null, startedAt: null, params: null, logs: [], lastExit: null };
  let exitKillRegistered = false;

  function pushLog(chunk) {
    const at = new Date().toISOString();
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() === "") continue;
      state.logs.push({ at, line });
      if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
    }
  }

  // Fast-path cleanup for the API's OWN normal shutdown. Registered lazily,
  // once, and only touching 'exit' so the API's signal handling is untouched.
  function registerParentExitKill() {
    if (exitKillRegistered) return;
    exitKillRegistered = true;
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

  return {
    label,
    isRunning: () => state.child !== null,

    /**
     * Spawn `script` with an already-validated argv.
     * @param {string} script absolute path to one of the two known scripts
     * @param {string[]} argv arguments after the script path
     * @param {object} params echoed back in status() for the UI
     */
    start(script, argv, params, env = process.env) {
      if (state.child) throw new Error(`${label} already running`);
      const args = [script, ...argv];
      const child = spawn(process.execPath, args, {
        cwd: ROOT,
        // FFC_EXIT_WITH_PARENT arms the child's own parent-death watchdog.
        env: { ...env, FFC_EXIT_WITH_PARENT: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      registerParentExitKill();

      state = { child, startedAt: new Date().toISOString(), params, logs: [], lastExit: null };
      pushLog(`▶ started: ${path.basename(script)} ${argv.join(" ")}`);
      child.stdout.on("data", (b) => pushLog(b.toString()));
      child.stderr.on("data", (b) => pushLog(b.toString()));
      child.on("exit", (code, signal) => {
        pushLog(`■ exited (code=${code} signal=${signal ?? "none"})`);
        state.lastExit = { at: new Date().toISOString(), code, signal };
        state.child = null;
        state.startedAt = null;
      });
      child.on("error", (err) => pushLog(`✗ spawn error: ${err.message}`));
      return this.status();
    },

    /** SIGINT so a run can finish what it is doing; idempotent. */
    stop() {
      if (!state.child) return this.status();
      state.child.kill("SIGINT");
      pushLog("↩ stop requested (SIGINT)");
      return this.status();
    },

    status() {
      return {
        running: state.child !== null,
        pid: state.child?.pid ?? null,
        startedAt: state.startedAt,
        params: state.params,
        lastExit: state.lastExit,
        logs: state.logs.slice(-MAX_LOG_LINES),
      };
    },

    /** Test seam: hard-reset between cases. */
    _reset() {
      if (state.child) {
        try {
          state.child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      state = { child: null, startedAt: null, params: null, logs: [], lastExit: null };
    },
  };
}

export const capture = makeSlot("capture");
export const replay = makeSlot("replay");

/** argv for scripts/arcade-bot.mjs (capture). */
export function captureArgs(p, appBase) {
  const args = ["--base", appBase, "--rounds", String(p.rounds), "--seed", String(p.seed)];
  for (const g of p.games ?? []) args.push("--game", g);
  if (p.skill !== null && p.skill !== undefined) args.push("--skill", String(p.skill));
  if (p.out) args.push("--out", p.out);
  return args;
}

/** argv for scripts/arcade-traffic.mjs (replay). Always --yes: the admin's own
 *  confirm is the gate, and the child has no tty to prompt on. */
export function replayArgs(p, profilePath, apiBase) {
  const args = [
    "--profile",
    profilePath,
    "--api",
    apiBase,
    "--location",
    p.locationId,
    "--plays",
    String(p.plays),
    "--players",
    String(p.players),
    "--concurrency",
    String(p.concurrency),
    "--seed",
    String(p.seed),
    "--yes",
  ];
  if (p.intervalMin) args.push("--interval-min", String(p.intervalMin));
  if (p.sweeps) args.push("--sweeps", String(p.sweeps));
  if (p.dryRun) args.push("--dry-run");
  for (const g of p.games ?? []) args.push("--game", g);
  return args;
}
