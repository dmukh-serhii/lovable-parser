"use client";

/**
 * AI-score vs local-score heatmap — plain SVG, single-hue (accent) intensity
 * ramp on a LOG scale so the diagonal band reads at a glance despite counts
 * spanning orders of magnitude. One <rect> per (local bucket, ai) cell that
 * has data; empty and sub-threshold cells are dropped so no background grid
 * lattice appears. Hover shows a small tooltip.
 */
import { useState } from "react";
import type { MethodologyData } from "@/lib/types";

const W = 560;
const H = 440;
const PAD = { top: 14, right: 16, bottom: 44, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// x: local_score 0–10 (0.5 buckets). y: ai_score 1–10.
const LX_STEP = 0.5;
const AY_MIN = 1;
const AY_MAX = 10;

const sx = (lx: number) => PAD.left + (lx / 10) * PLOT_W;
// centre each ai row on its integer value
const sy = (ay: number) => PAD.top + (1 - (ay - AY_MIN + 0.5) / (AY_MAX - AY_MIN + 1)) * PLOT_H;

const CELL_W = (LX_STEP / 10) * PLOT_W;
const CELL_H = PLOT_H / (AY_MAX - AY_MIN + 1);

// Counts below this are dropped (noise) so the diagonal stays clean.
const MIN_COUNT = 5;

export function ScatterPlot({ data }: { data: MethodologyData }) {
  const { heatmap, heatmapMax, correlation, scored } = data;
  const [hover, setHover] = useState<{
    x: number; y: number; lx: number; ay: number; c: number;
  } | null>(null);

  const xTicks = [0, 2, 4, 6, 8, 10];
  const yTicks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const logMax = Math.log(heatmapMax + 1) || 1;

  const cells = heatmap.filter((c) => c.c >= MIN_COUNT);

  // legend sample counts (min threshold → max), log-spaced
  const legendStops = [MIN_COUNT, Math.round(Math.sqrt(MIN_COUNT * heatmapMax)), heatmapMax];

  return (
    <figure className="relative m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full max-w-[560px]"
          role="img"
          aria-label="Heatmap of AI score versus local score"
        >
          {/* axis frame */}
          <rect
            x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H}
            fill="none" stroke="var(--line)" strokeWidth={1}
          />

          {/* x ticks */}
          {xTicks.map((t) => (
            <text
              key={`x${t}`} x={sx(t)} y={H - 24} textAnchor="middle"
              className="fill-[var(--ink-3)]" style={{ fontSize: 11 }}
            >
              {t}
            </text>
          ))}
          {/* y ticks */}
          {yTicks.map((t) => (
            <text
              key={`y${t}`} x={PAD.left - 8} y={sy(t) + 4} textAnchor="end"
              className="fill-[var(--ink-3)]" style={{ fontSize: 10 }}
            >
              {t}
            </text>
          ))}

          {/* cells */}
          {cells.map((cell, i) => {
            const intensity = Math.log(cell.c + 1) / logMax; // 0..1 log-scaled
            // low floor keeps sparse edges faint so the bright diagonal core dominates
            const opacity = 0.08 + Math.pow(intensity, 1.2) * 0.92;
            return (
              <rect
                key={i}
                x={sx(cell.lx) - CELL_W / 2}
                y={sy(cell.ay) - CELL_H / 2}
                width={CELL_W}
                height={CELL_H}
                rx={1}
                fill="var(--accent)"
                fillOpacity={opacity}
                onMouseEnter={() =>
                  setHover({
                    x: sx(cell.lx),
                    y: sy(cell.ay) - CELL_H / 2,
                    lx: cell.lx,
                    ay: cell.ay,
                    c: cell.c,
                  })
                }
                onMouseLeave={() => setHover(null)}
              />
            );
          })}

          {/* y = x reference */}
          <line
            x1={sx(0)} y1={sy(0)} x2={sx(10)} y2={sy(10)}
            stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5}
          />

          {/* axis titles */}
          <text
            x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle"
            className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}
          >
            Local score
          </text>
          <text
            transform={`rotate(-90 12 ${PAD.top + PLOT_H / 2})`}
            x={12} y={PAD.top + PLOT_H / 2} textAnchor="middle"
            className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}
          >
            AI score
          </text>
        </svg>
      </div>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-card px-2 py-1 text-xs text-ink shadow-md"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
        >
          local {hover.lx} · ai {hover.ay} · {hover.c.toLocaleString("en-US")} sites
        </div>
      )}

      {/* legend + caption */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">{legendStops[0]}</span>
          <div className="flex h-3 w-28 overflow-hidden rounded-sm">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="h-full flex-1"
                style={{ background: "var(--accent)", opacity: 0.08 + Math.pow(i / 23, 1.2) * 0.92 }}
              />
            ))}
          </div>
          <span className="text-xs text-ink-3">
            {heatmapMax.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-ink-3">sites / cell (log scale)</span>
        </div>
      </div>

      <figcaption className="mt-2 text-sm text-ink-2">
        {correlation != null && (
          <span className="mr-1 font-medium text-ink">
            Pearson r = {correlation.toFixed(2)}
          </span>
        )}
        across {scored.toLocaleString("en-US")} scored sites. The two metrics
        correlate but disagree on individual sites — which is expected: the
        heuristics measure mechanics (is the page non-blank, colourful, densely
        built?), while the AI judges aesthetics.
      </figcaption>
    </figure>
  );
}
