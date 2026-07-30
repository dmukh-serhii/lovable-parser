"use client";

/**
 * Hand-rolled dashboard charts — no chart lib needed for two bar charts.
 * Colors come from the validated status/accent tokens in globals.css.
 * Every mark has a hover tooltip; identity is never color-alone (legend +
 * labels + tooltips).
 */
import { useState } from "react";
import { formatNumber } from "@/lib/format";

/* ── Shared tooltip ─────────────────────────────────────────────────── */

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1.5 text-xs text-ink shadow-lg"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

/* ── Score distribution (1–10, single hue) ──────────────────────────── */

export function ScoreChart({
  data,
}: {
  data: { score: number; count: number }[];
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  // full 1..10 axis, even where empty
  const byScore = new Map(data.map((d) => [d.score, d.count]));
  const bars = Array.from({ length: 10 }, (_, i) => ({
    score: i + 1,
    count: byScore.get(i + 1) ?? 0,
  }));
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-sm text-ink-3">No analyzed sites yet.</p>;
  }

  return (
    <div className="relative">
      {hover && (
        <Tip x={hover.x} y={hover.y}>
          <span className="font-semibold">score {bars[hover.i].score}</span>
          {" · "}
          {formatNumber(bars[hover.i].count)} site{bars[hover.i].count === 1 ? "" : "s"}
          {" · "}
          {((bars[hover.i].count / total) * 100).toFixed(1)}%
        </Tip>
      )}
      <div className="flex h-36 items-end gap-1.5">
        {bars.map((b, i) => (
          <div
            key={b.score}
            className="group flex h-full flex-1 cursor-default flex-col justify-end"
            onMouseMove={(e) => {
              const rect = e.currentTarget.parentElement!.getBoundingClientRect();
              setHover({ i, x: e.clientX - rect.left, y: e.currentTarget.getBoundingClientRect().top - rect.top });
            }}
            onMouseLeave={() => setHover(null)}
          >
            {b.count > 0 && (
              <span className="mb-0.5 text-center text-[10px] tabular-nums text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
                {formatNumber(b.count)}
              </span>
            )}
            <div
              className="w-full rounded-t bg-accent transition-opacity group-hover:opacity-80"
              style={{
                height: `${(b.count / max) * 100}%`,
                minHeight: b.count > 0 ? 3 : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
        {bars.map((b) => (
          <span key={b.score} className="flex-1 text-center text-[11px] tabular-nums text-ink-3">
            {b.score}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Per-source stacked status bars ─────────────────────────────────── */

// chart statuses in lifecycle order; queued = pending + crawling (neutral —
// transient states, always labeled, never color-alone)
const STACK: { key: string; label: string; color: string }[] = [
  { key: "queued", label: "queued", color: "var(--neutral)" },
  { key: "done", label: "done (awaiting analysis)", color: "var(--info)" },
  { key: "analyzed", label: "analyzed", color: "var(--ok)" },
  { key: "not_found", label: "not found", color: "var(--warn)" },
  { key: "failed", label: "failed", color: "var(--bad)" },
];

const SOURCE_LABEL: Record<string, string> = {
  cc: "CommonCrawl",
  wb: "Wayback",
  unknown: "unknown",
};

export function SourceChart({
  data,
}: {
  data: { source: string; status: string; count: number }[];
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const sources = [...new Set(data.map((d) => d.source))];
  const rows = sources.map((source) => {
    const counts: Record<string, number> = {};
    for (const s of STACK) counts[s.key] = 0;
    for (const d of data.filter((d) => d.source === source)) {
      const key =
        d.status === "pending" || d.status === "crawling" ? "queued" : d.status;
      counts[key] = (counts[key] ?? 0) + d.count;
    }
    return { source, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  const max = Math.max(1, ...rows.map((r) => r.total));

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-3">No data yet.</p>;
  }

  return (
    <div className="relative flex flex-col gap-3">
      {tip && <Tip x={tip.x} y={tip.y}>{tip.text}</Tip>}
      {rows.map((row) => (
        <div key={row.source}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink">{SOURCE_LABEL[row.source] ?? row.source}</span>
            <span className="tabular-nums text-xs text-ink-3">{formatNumber(row.total)}</span>
          </div>
          <div className="flex h-5 w-full gap-[2px]" role="img" aria-label={`Status breakdown for ${row.source}`}>
            {STACK.filter((s) => row.counts[s.key] > 0).map((s) => (
              <div
                key={s.key}
                className="h-full rounded-[3px] transition-opacity hover:opacity-80"
                style={{
                  width: `${(row.counts[s.key] / max) * 100}%`,
                  minWidth: 4,
                  background: s.color,
                }}
                onMouseMove={(e) => {
                  const rect = (e.currentTarget.closest(".relative") as HTMLElement).getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left,
                    y: e.currentTarget.getBoundingClientRect().top - rect.top,
                    text: `${SOURCE_LABEL[row.source] ?? row.source} · ${s.label}: ${formatNumber(row.counts[s.key])}`,
                  });
                }}
                onMouseLeave={() => setTip(null)}
              />
            ))}
          </div>
        </div>
      ))}
      {/* legend — identity never by color alone */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5">
        {STACK.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
