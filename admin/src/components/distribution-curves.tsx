"use client";

/**
 * "Score distributions: heuristics vs AI" — two frequency curves on one plot.
 * Plain SVG, dark theme. Local (heuristics) in status blue, AI (Gemini) in the
 * accent red. Smoothed with a Catmull-Rom spline (shape comparison, not exact
 * bar reading), subtle area fills, dots at the real bucket counts.
 */
import { useState } from "react";
import type { MethodologyData } from "@/lib/types";

const W = 1000;
const H = 360;
const PAD = { top: 16, right: 20, bottom: 46, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const AI_COLOR = "var(--accent)";
const LOCAL_COLOR = "var(--info)";

const sx = (score: number) => PAD.left + ((score - 1) / 9) * PLOT_W;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Catmull-Rom → cubic Bézier path through points. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function DistributionCurves({ data }: { data: MethodologyData }) {
  const { distributions, correlation, scored } = data;
  const [hover, setHover] = useState<number | null>(null);

  // fold any score<1 (ROUND(local_score)=0) into bucket 1; build 1..10
  const byScore = new Map<number, { localN: number; aiN: number }>();
  for (const d of distributions) {
    const s = Math.max(1, d.score);
    const cur = byScore.get(s) ?? { localN: 0, aiN: 0 };
    cur.localN += d.localN;
    cur.aiN += d.aiN;
    byScore.set(s, cur);
  }
  const buckets = Array.from({ length: 10 }, (_, i) => {
    const s = i + 1;
    const v = byScore.get(s) ?? { localN: 0, aiN: 0 };
    return { score: s, localN: v.localN, aiN: v.aiN };
  });

  const yMax = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.localN, b.aiN))));
  const sy = (n: number) => PAD.top + (1 - n / yMax) * PLOT_H;
  const baseY = sy(0);

  const aiPts = buckets.map((b) => [sx(b.score), sy(b.aiN)] as [number, number]);
  const localPts = buckets.map((b) => [sx(b.score), sy(b.localN)] as [number, number]);

  const areaOf = (pts: [number, number][]) =>
    `${smoothPath(pts)} L ${pts[pts.length - 1][0]},${baseY} L ${pts[0][0]},${baseY} Z`;

  const yTicks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];
  const fmtY = (n: number) =>
    n >= 1000
      ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
      : `${Math.round(n)}`;

  return (
    <figure className="relative m-0">
      {/* legend */}
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span className="h-0.5 w-4 rounded" style={{ background: LOCAL_COLOR }} />
          Local (heuristics)
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span className="h-0.5 w-4 rounded" style={{ background: AI_COLOR }} />
          AI (Gemini Vision)
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Score distribution curves for heuristic and AI scores"
        >
          {/* y grid + ticks */}
          {yTicks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={PAD.left} y1={sy(t)} x2={PAD.left + PLOT_W} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" className="fill-[var(--ink-3)]" style={{ fontSize: 11 }}>{fmtY(t)}</text>
            </g>
          ))}
          {/* x ticks */}
          {buckets.map((b) => (
            <text key={`x${b.score}`} x={sx(b.score)} y={baseY + 20} textAnchor="middle" className="fill-[var(--ink-3)]" style={{ fontSize: 11 }}>{b.score}</text>
          ))}

          {/* area fills (subtle, semi-transparent so overlap blends) */}
          <path d={areaOf(localPts)} fill={LOCAL_COLOR} fillOpacity={0.12} />
          <path d={areaOf(aiPts)} fill={AI_COLOR} fillOpacity={0.12} />

          {/* curves */}
          <path d={smoothPath(localPts)} fill="none" stroke={LOCAL_COLOR} strokeWidth={2} strokeLinecap="round" />
          <path d={smoothPath(aiPts)} fill="none" stroke={AI_COLOR} strokeWidth={2} strokeLinecap="round" />

          {/* dots */}
          {localPts.map((p, i) => (
            <circle key={`ld${i}`} cx={p[0]} cy={p[1]} r={2.6} fill={LOCAL_COLOR} />
          ))}
          {aiPts.map((p, i) => (
            <circle key={`ad${i}`} cx={p[0]} cy={p[1]} r={2.6} fill={AI_COLOR} />
          ))}

          {/* hover columns + guide */}
          {hover != null && (
            <line x1={sx(hover)} y1={PAD.top} x2={sx(hover)} y2={baseY} stroke="var(--line-strong)" strokeWidth={1} />
          )}
          {buckets.map((b) => (
            <rect
              key={`h${b.score}`}
              x={sx(b.score) - PLOT_W / 18} y={PAD.top}
              width={PLOT_W / 9} height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(b.score)}
              onMouseLeave={() => setHover(null)}
            />
          ))}

          {/* axis titles */}
          <text x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle" className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}>
            Score (1–10)
          </text>
          <text transform={`rotate(-90 14 ${PAD.top + PLOT_H / 2})`} x={14} y={PAD.top + PLOT_H / 2} textAnchor="middle" className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}>
            Number of sites
          </text>
        </svg>

        {/* tooltip */}
        {hover != null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-card px-2 py-1 text-xs text-ink shadow-md"
            style={{ left: `${(sx(hover) / W) * 100}%`, top: `${(PAD.top / H) * 100}%` }}
          >
            score {hover} · local {(byScore.get(hover)?.localN ?? 0).toLocaleString("en-US")} · AI {(byScore.get(hover)?.aiN ?? 0).toLocaleString("en-US")}
          </div>
        )}
      </div>

      <figcaption className="mt-3 max-w-xl text-sm text-ink-2">
        How two independent scoring systems rate the same{" "}
        <span className="font-medium text-ink">{scored.toLocaleString("en-US")}</span>{" "}
        sites: heuristics measure page mechanics, Gemini Vision judges visual
        design. The shapes differ, but per-site scores correlate
        {correlation != null && (
          <> (Pearson r = <span className="font-medium text-ink">{correlation.toFixed(2)}</span>)</>
        )}
        .
      </figcaption>
    </figure>
  );
}
