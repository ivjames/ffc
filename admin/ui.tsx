// Lightweight, utilitarian UI primitives for the admin console. Deliberately
// plain (not the player app's arcade styling) — this is a back office.
import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';

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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${styles} ${className}`}
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
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 ${props.className ?? ''}`}
    />
  );
}

/** Standard page top: h1 + optional inline extras, right-aligned actions, and
 *  a description line under. `title` stays a plain h1 so tests can keep
 *  querying by heading text. */
export function PageHeader({
  title,
  titleExtra,
  description,
  actions,
}: {
  title: ReactNode;
  /** Pills / slug / metadata rendered inline after the title. */
  titleExtra?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {titleExtra}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
    </div>
  );
}

/** "← Back" line for detail pages. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <Link to={to} className="text-slate-500 underline hover:text-slate-900">
        ← {children}
      </Link>
    </div>
  );
}

/** Pill-tab filter row (one look for every screen's filter tabs). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-slate-200/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`rounded-md px-3 py-1 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Muted centered "nothing here" line for lists (compact = tighter, for
 *  empties nested inside a card). */
export function EmptyState({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <p className={compact ? 'py-2 text-center text-xs text-slate-400' : 'py-4 text-center text-sm text-slate-400'}>
      {children}
    </p>
  );
}

/** Flush data table — pair with `<Card className="p-0">` so rows run edge to
 *  edge. Row borders live here (first tbody row's top border doubles as the
 *  header rule) so call sites don't repeat them. */
export function Table({ size = 'sm', children }: { size?: 'sm' | 'xs'; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full text-left ${size === 'xs' ? 'text-xs' : 'text-sm'} [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tfoot_tr]:border-t [&_tfoot_tr]:border-slate-200`}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}>
      {children}
    </td>
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
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' }) {
  const styles = tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

// --- Toasts -----------------------------------------------------------------
// Transient confirmations ("Saved.", "Photo deleted.") that don't deserve a
// layout-shifting banner. useToast() outside a provider is a no-op, so screens
// stay renderable standalone (as the tests do). Errors that need reading or
// acting on should stay inline — toasts are for outcomes, not diagnostics.

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string };
/** Fire a toast: `toast('Saved.')` (success) or `toast(msg, 'error' | 'info')`. */
export type ToastFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const TOAST_DOT: Record<ToastKind, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-sky-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastFn>(
    (message, kind = 'success') => {
      const id = nextId.current++;
      // Keep the stack short — a burst of saves shouldn't wallpaper the corner.
      setToasts((cur) => [...cur.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-white p-3 text-sm shadow-lg ring-1 ring-slate-200 animate-[ffc-toast-in_150ms_ease-out]"
          >
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TOAST_DOT[t.kind]}`} />
            <span className="flex-1 break-words text-slate-700">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="-m-1 rounded p-1 leading-none text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// The admin API requires an auth header, which <img src> can't carry — so
// authed images are fetched into an object URL. This hook owns that lifecycle:
// state resets when deps change, and the URL is revoked on unmount/refetch
// (including the resolved-after-unmount race, where cleanup has already run
// and the fresh URL must be revoked on the spot).
export function useObjectUrl(fetchBlob: () => Promise<Blob>, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    fetchBlob().then(
      (blob) => {
        const u = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { url, failed };
}

/** Authed-image thumbnail: pulse while loading, "unavailable" box on failure,
 *  square-cropped <img> once loaded. `refetchKey` re-runs the fetch. */
export function BlobThumb({
  fetchBlob,
  refetchKey,
  alt = '',
  className = 'h-28 w-28',
}: {
  fetchBlob: () => Promise<Blob>;
  refetchKey: unknown;
  alt?: string;
  className?: string;
}) {
  const { url, failed } = useObjectUrl(fetchBlob, [refetchKey]);
  if (failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-md bg-slate-100 text-center text-xs text-slate-400 ${className}`}
      >
        unavailable
      </div>
    );
  }
  if (!url) return <div className={`shrink-0 animate-pulse rounded-md bg-slate-100 ${className}`} />;
  return <img src={url} alt={alt} className={`shrink-0 rounded-md object-cover ${className}`} />;
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
