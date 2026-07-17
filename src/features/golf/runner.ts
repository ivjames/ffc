// Sandboxed runner for JS Golf submissions.
//
// The player's code is arbitrary JavaScript, so we run it in a throwaway Web
// Worker (built from an inline Blob — no separate file, works offline in the
// PWA) and enforce a wall-clock timeout on the main thread. If the code hangs
// (e.g. `while(1){}`) we terminate the worker instead of freezing the tab. The
// worker has no DOM and a fresh global per run, which keeps a submission from
// stomping on the app — this is a toy sandbox, not a security boundary, but it
// contains the two things that actually go wrong in a code-golf toy: hangs and
// accidental global mutation.

import type { GolfTest } from './puzzles';

export type TestResult = { pass: boolean; got: string; error?: string };

export type RunResult =
  | { kind: 'ok'; results: TestResult[]; passed: number }
  | { kind: 'compile-error'; message: string }
  | { kind: 'timeout' };

// Worker body. Kept as a string so it can be wrapped in a Blob. It evaluates
// the player's code to a function, runs every test, and posts back per-test
// pass/fail plus a printable form of the actual value.
const WORKER_SRC = `
function eq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => eq(a[k], b[k]));
  }
  // NaN === NaN
  return a !== a && b !== b;
}
function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'function') return 'function';
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
self.onmessage = function (e) {
  const { code, tests } = e.data;
  let fn;
  try {
    // eslint-disable-next-line no-eval
    fn = (0, eval)('(' + code + ')');
  } catch (err) {
    self.postMessage({ kind: 'compile-error', message: String(err && err.message || err) });
    return;
  }
  if (typeof fn !== 'function') {
    self.postMessage({ kind: 'compile-error', message: 'Your code must evaluate to a function.' });
    return;
  }
  const results = tests.map(function (t) {
    try {
      const got = fn.apply(null, t.args);
      return { pass: eq(got, t.expect), got: show(got) };
    } catch (err) {
      return { pass: false, got: '—', error: String(err && err.message || err) };
    }
  });
  self.postMessage({ kind: 'ok', results: results, passed: results.filter(function (r) { return r.pass; }).length });
};
`;

export function runGolf(
  code: string,
  tests: GolfTest[],
  timeoutMs = 1000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let url: string | null = null;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      worker = null;
      url = null;
      timer = null;
    };

    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (err) {
      cleanup();
      resolve({ kind: 'compile-error', message: `Could not start runner: ${String(err)}` });
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      resolve({ kind: 'timeout' });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent<RunResult>) => {
      cleanup();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      cleanup();
      resolve({ kind: 'compile-error', message: e.message || 'Runner error' });
    };

    worker.postMessage({ code, tests });
  });
}
