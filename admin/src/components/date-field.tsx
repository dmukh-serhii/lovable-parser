"use client";

/**
 * Custom date picker. The native <input type="date"> popup renders its
 * calendar in the browser's UI language (unfixable from code), so this
 * replaces it with a self-rendered calendar using hardcoded English labels —
 * guaranteed English regardless of the viewer's locale, and theme-aware.
 *
 * Value format is yyyy-mm-dd (same as the native input), so callers and
 * dateInputToEpoch() are unchanged.
 */
import { useEffect, useRef, useState } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parse(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

function toValue(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parse(value);
  const today = new Date();
  const [view, setView] = useState<{ y: number; m: number }>(
    parsed
      ? { y: parsed.y, m: parsed.m }
      : { y: today.getFullYear(), m: today.getMonth() }
  );
  const ref = useRef<HTMLDivElement>(null);

  // keep the visible month in sync when the value changes externally
  useEffect(() => {
    if (parsed) setView({ y: parsed.y, m: parsed.m });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const label_ = parsed
    ? `${MONTHS_SHORT[parsed.m]} ${parsed.d}, ${parsed.y}`
    : "mm/dd/yyyy";

  const shiftMonth = (delta: number) => {
    setView(({ y, m }) => {
      const nm = m + delta;
      if (nm < 0) return { y: y - 1, m: 11 };
      if (nm > 11) return { y: y + 1, m: 0 };
      return { y, m: nm };
    });
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isSelected = (d: number) =>
    parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === d;
  const isToday = (d: number) =>
    today.getFullYear() === view.y &&
    today.getMonth() === view.m &&
    today.getDate() === d;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex w-[104px] items-center justify-between gap-1 text-left text-sm focus:outline-none ${
          parsed ? "text-ink-2" : "text-ink-3"
        }`}
      >
        {label_}
        <CalendarIcon />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded p-1 text-ink-2 hover:bg-neutral-soft hover:text-ink"
              aria-label="Previous month"
            >
              <Chevron dir="left" />
            </button>
            <span className="text-sm font-medium text-ink">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded p-1 text-ink-2 hover:bg-neutral-soft hover:text-ink"
              aria-label="Next month"
            >
              <Chevron dir="right" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-center text-[11px] font-medium text-ink-3">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) =>
              d === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(toValue(view.y, view.m, d));
                    setOpen(false);
                  }}
                  className={`flex h-8 items-center justify-center rounded text-sm transition-colors ${
                    isSelected(d)
                      ? "bg-accent font-medium text-white"
                      : isToday(d)
                        ? "text-accent-text hover:bg-neutral-soft"
                        : "text-ink hover:bg-neutral-soft"
                  }`}
                >
                  {d}
                </button>
              )
            )}
          </div>

          {parsed && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="mt-2 w-full rounded-md border-t border-line pt-2 text-xs text-ink-3 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-accent">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 6.5 H13.5 M5.5 2 V4.5 M10.5 2 V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={dir === "left" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
