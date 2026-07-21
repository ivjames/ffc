// Lightweight, utilitarian UI primitives for the admin console. Deliberately
// plain (not the player app's arcade styling) — this is a back office.
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { useEffect, useState, useCallback } from 'react';

// Master Control operates in a single HQ/operator timezone (Pacific), distinct
// from each venue's own tz (which drives that venue's leaderboard). Every
// timestamp the console shows is formatted in ADMIN_TZ so the operator reads one
// consistent clock regardless of which venue's data they're looking at.
export const ADMIN_TZ = 'America/Los_Angeles';
export const ADMIN_TZ_LABEL = 'Pacific Time (PT)';

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ADMIN_TZ,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Format an ISO timestamp in the admin's Pacific timezone (empty string if null). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
    ghost: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50',
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 ${props.className ?? ''}`}
    />
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-800 ring-red-200',
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  }[kind];
  return <div className={`rounded-md px-3 py-2 text-sm ring-1 ${styles}`}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-8 text-center text-sm text-slate-500">{label}</div>;
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' }) {
  const styles = tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

// Tiny data-loading hook: runs `fn`, exposes {data, error, loading, reload}.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then((d) => setData(d))
      .catch((e) => setError(e as Error))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => run(), [run]);
  return { data, error, loading, reload: run };
}
