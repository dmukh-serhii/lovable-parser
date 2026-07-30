"use client";

import {
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SiteStatus } from "@/lib/types";

/* ── Badges ─────────────────────────────────────────────────────────── */

type Tone = "ok" | "info" | "warn" | "bad" | "neutral" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-text",
  info: "bg-info-soft text-info-text",
  warn: "bg-warn-soft text-warn-text",
  bad: "bg-bad-soft text-bad-text",
  neutral: "bg-neutral-soft text-neutral-text",
  accent: "bg-accent-soft text-accent-text",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<SiteStatus, Tone> = {
  pending: "neutral",
  crawling: "accent",
  done: "info",
  analyzed: "ok",
  not_found: "warn",
  failed: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status as SiteStatus] ?? "neutral";
  return <Badge tone={tone}>{status.replace("_", " ")}</Badge>;
}

const SOURCE_LABEL: Record<string, string> = {
  cc: "CommonCrawl",
  wb: "Wayback",
  unknown: "unknown",
};

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2 whitespace-nowrap">
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

export function FailureBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-ink-3">—</span>;
  const permanent = ["dns", "unreachable", "cert", "aborted"].includes(type);
  return (
    <Badge tone={permanent ? "bad" : "warn"}>
      {type}
      <span className="opacity-60">{permanent ? "· permanent" : "· transient"}</span>
    </Badge>
  );
}

export function ScorePill({ score }: { score: number | null }) {
  if (score === null || score === undefined)
    return <span className="text-ink-3">—</span>;
  const tone: Tone = score >= 8 ? "ok" : score >= 5 ? "warn" : "bad";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone}>{score.toFixed(1)}</Badge>
      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-neutral-soft sm:block">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </span>
    </span>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────── */

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary:
      "border border-line-strong bg-card text-ink hover:bg-neutral-soft",
    ghost: "text-ink-2 hover:bg-neutral-soft hover:text-ink",
    danger: "bg-bad text-white hover:opacity-90",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-line bg-card ${className}`}>
      {children}
    </div>
  );
}

/* ── Multi-select dropdown ─────────────────────────────────────────── */

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  renderOption?: (value: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  const active = selected.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
          active
            ? "border-accent/40 bg-accent-soft text-accent-text font-medium"
            : "border-line-strong bg-card text-ink-2 hover:bg-neutral-soft"
        }`}
      >
        {label}
        {active && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
            {selected.length}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-lg border border-line bg-card p-1 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border-b border-line px-2 py-1.5 text-sm font-medium text-ink hover:bg-neutral-soft">
            <input
              type="checkbox"
              checked={selected.length === options.length}
              onChange={() =>
                onChange(selected.length === options.length ? [] : [...options])
              }
              className="accent-accent"
            />
            All
          </label>
          {options.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-neutral-soft"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-accent"
              />
              {renderOption ? renderOption(opt) : opt}
            </label>
          ))}
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md border-t border-line px-2 py-1.5 text-left text-xs text-ink-3 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-3 hover:bg-neutral-soft hover:text-ink"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Spinner ────────────────────────────────────────────────────────── */

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12 A10 10 0 0 0 12 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
