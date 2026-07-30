/**
 * "Average AI score by local score" — the primary /methodology chart.
 * Plain SVG, dark-theme accent, square plot so X and Y share one scale (the
 * whole point of the comparison). Shows the mean AI score per local_score
 * bucket as a line, with the p25–p75 interquartile range as a shaded band,
 * against a y = x "perfect agreement" reference.
 */
import type { MethodologyData } from "@/lib/types";

const S = 520; // square viewBox
const PAD = { top: 18, right: 18, bottom: 46, left: 46 };
const PLOT = S - PAD.left - PAD.right - 8; // equal on both axes

const sx = (v: number) => PAD.left + (v / 10) * PLOT;
const sy = (v: number) => PAD.top + (1 - v / 10) * PLOT;

const MIN_N = 20; // buckets below this are shown as faint points, not connected

export function AgreementChart({ data }: { data: MethodologyData }) {
  const { meanLine, correlation, scored } = data;
  const ticks = [0, 2, 4, 6, 8, 10];

  const strong = meanLine.filter((d) => d.n >= MIN_N);
  const weak = meanLine.filter((d) => d.n < MIN_N);

  // IQR band polygon: p75 left→right, then p25 right→left
  const bandPts = [
    ...strong.map((d) => `${sx(d.local)},${sy(d.p75)}`),
    ...[...strong].reverse().map((d) => `${sx(d.local)},${sy(d.p25)}`),
  ].join(" ");

  const linePts = strong.map((d) => `${sx(d.local)},${sy(d.avg)}`).join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="h-auto w-full max-w-[520px]"
        role="img"
        aria-label="Average AI score by local score, with interquartile range"
      >
        {/* grid ticks */}
        {ticks.map((t) => (
          <g key={`g${t}`}>
            <line x1={sx(t)} y1={PAD.top} x2={sx(t)} y2={PAD.top + PLOT} stroke="var(--line)" strokeWidth={1} />
            <line x1={PAD.left} y1={sy(t)} x2={PAD.left + PLOT} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={sx(t)} y={PAD.top + PLOT + 20} textAnchor="middle" className="fill-[var(--ink-3)]" style={{ fontSize: 12 }}>{t}</text>
            <text x={PAD.left - 9} y={sy(t) + 4} textAnchor="end" className="fill-[var(--ink-3)]" style={{ fontSize: 12 }}>{t}</text>
          </g>
        ))}

        {/* y = x perfect-agreement reference */}
        <line x1={sx(0)} y1={sy(0)} x2={sx(10)} y2={sy(10)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
        <text
          transform={`rotate(-45 ${sx(8.2)} ${sy(8.2)})`}
          x={sx(8.2)} y={sy(8.2) - 6} textAnchor="middle"
          className="fill-[var(--ink-3)]" style={{ fontSize: 11 }}
        >
          perfect agreement
        </text>

        {/* IQR band */}
        {strong.length > 1 && (
          <polygon points={bandPts} fill="var(--accent)" fillOpacity={0.16} />
        )}

        {/* faint isolated points for sparse buckets */}
        {weak.map((d, i) => (
          <circle key={`w${i}`} cx={sx(d.local)} cy={sy(d.avg)} r={2.4} fill="var(--accent)" fillOpacity={0.28} />
        ))}

        {/* mean line */}
        {strong.length > 1 && (
          <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* axis titles */}
        <text x={PAD.left + PLOT / 2} y={S - 8} textAnchor="middle" className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}>
          Local score (heuristics)
        </text>
        <text transform={`rotate(-90 13 ${PAD.top + PLOT / 2})`} x={13} y={PAD.top + PLOT / 2} textAnchor="middle" className="fill-[var(--ink-2)]" style={{ fontSize: 12, fontWeight: 500 }}>
          AI score (Gemini Vision)
        </text>
      </svg>

      <figcaption className="mt-3 max-w-xl text-sm text-ink-2">
        Sites with stronger heuristic scores also receive higher AI scores
        {correlation != null && <> (Pearson r = <span className="font-medium text-ink">{correlation.toFixed(2)}</span>,{" "}</>}
        {correlation == null && <> (</>}
        <span className="font-medium text-ink">{scored.toLocaleString("en-US")}</span> sites). The
        shaded band shows the interquartile range — the metrics agree on average
        but often disagree on individual sites.
      </figcaption>
    </figure>
  );
}
