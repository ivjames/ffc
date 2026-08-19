// Exit when our parent does.
//
// A bot spawned by the API (server/lib/*BotRunner.js) must not outlive it. The
// parent kills the child on its own clean shutdown, but that handler cannot run
// when the parent is SIGKILLed or crashes — and then the API restarts with
// fresh module state, reports "stopped", and an operator starts a second bot
// with no way to stop the orphan still writing traffic.
//
// So the child watches from its end too. Polling process.ppid catches exactly
// the cases a parent can't clean up after: on Linux the ppid becomes 1 when we
// are reparented, and on any platform it changes off the original parent. The
// interval is unref'd so it never keeps the process alive on its own.
//
// Armed only when the spawner sets FFC_EXIT_WITH_PARENT, so running a script by
// hand from a shell is unaffected.
export function watchParentOrExit(label) {
  if (!process.env.FFC_EXIT_WITH_PARENT) return;
  const initialPpid = process.ppid;
  setInterval(() => {
    if (process.ppid !== initialPpid || process.ppid === 1) {
      console.error(`${label}: parent process gone — exiting to avoid an orphaned bot`);
      process.exit(143);
    }
  }, 3000).unref();
}
