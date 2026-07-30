import type { Metadata } from "next";
import Link from "next/link";
import { getMethodology } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui";
import { DistributionCurves } from "@/components/distribution-curves";

export const metadata: Metadata = { title: "Methodology — lovable-parser" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  cc: "CommonCrawl",
  wb: "Wayback Machine",
  unknown: "Other",
};

const FAILURE_LABEL: Record<string, string> = {
  dns: "DNS not resolved",
  unreachable: "Host unreachable",
  cert: "TLS certificate error",
  aborted: "Connection aborted",
  timeout: "Load timeout",
  connection: "Connection reset",
  other: "Other render error",
};

export default async function MethodologyPage() {
  let m: Awaited<ReturnType<typeof getMethodology>>;
  try {
    m = await getMethodology();
  } catch (err) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">Methodology</h1>
        <p className="mt-2 text-sm text-ink-2">Live figures are unavailable right now.</p>
        <p className="mt-2 font-mono text-xs text-ink-3">{String(err)}</p>
      </Card>
    );
  }

  const { totals } = m;
  const attempted = totals.crawlAttempted || 1;
  const failPct = ((totals.failed / attempted) * 100).toFixed(1);
  const notFoundPct = ((totals.notFound / attempted) * 100).toFixed(1);
  const lostPct = (((totals.failed + totals.notFound) / attempted) * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-10">
      {/* 1 — Overview */}
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Methodology</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          lovable-parser is an automated pipeline that discovers every public
          lovable.app site, captures a screenshot of each one, and rates its
          design quality using two independent methods — a vision model and a
          set of deterministic image heuristics. It currently tracks{" "}
          <span className="font-medium text-ink">{formatNumber(totals.discovered)}</span>{" "}
          discovered domains. This page documents how each number in the
          dashboard is produced; every figure below is queried live from the
          database.
        </p>
      </section>

      {/* 2 — Pipeline stages */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Pipeline
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StageCard step={1} title="Discovery">
            Domains are pulled from the{" "}
            <strong className="font-medium text-ink">CommonCrawl</strong> index
            (every crawl since Lovable launched) and the{" "}
            <strong className="font-medium text-ink">Wayback Machine</strong> CDX
            API, then deduplicated across both sources on insert.
            <SourceLines m={m} />
          </StageCard>

          <StageCard step={2} title="Screenshotting">
            Each domain is loaded in a headless{" "}
            <strong className="font-medium text-ink">Playwright</strong> browser
            at a fixed viewport, with bounded concurrency and retries. The stage
            is resumable — it only visits domains not yet captured.
            <dl className="mt-3 space-y-1 text-xs">
              <Stat label="Screenshotted" value={formatNumber(totals.screenshotted)} />
              <Stat label="Not found (deleted)" value={formatNumber(totals.notFound)} />
              <Stat label="Failed" value={formatNumber(totals.failed)} />
            </dl>
          </StageCard>

          <StageCard step={3} title="Scoring">
            Every screenshot receives two independent 1–10 scores — one from a
            vision model, one from deterministic heuristics. They are stored
            separately and never averaged together.
            <dl className="mt-3 space-y-1 text-xs">
              <Stat label="Scored sites" value={formatNumber(m.scored)} />
              {m.correlation != null && (
                <Stat label="Score correlation" value={`r = ${m.correlation.toFixed(2)}`} />
              )}
            </dl>
          </StageCard>

          <StageCard step={4} title="This dashboard">
            Aggregation, filtering, and CSV export run against{" "}
            <strong className="font-medium text-ink">Postgres (Neon)</strong>{" "}
            through a read-only role — the public view can never mutate pipeline
            data.
          </StageCard>
        </div>
      </section>

      {/* 3 — Two metrics */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Two scoring metrics
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <h3 className="text-base font-semibold text-ink">AI score · 1–10</h3>
            <p className="text-sm leading-relaxed text-ink-2">
              A vision model (Gemini) evaluates each screenshot as a designer
              would — weighing visual hierarchy, typography, colour, layout
              consistency, and overall polish — and returns a single score with
              a short rationale and a category. It judges how the page{" "}
              <em>looks</em>, not how it is built.
            </p>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <h3 className="text-base font-semibold text-ink">Local score · 1–10</h3>
            <p className="text-sm leading-relaxed text-ink-2">
              A deterministic score computed from the screenshot and page,
              with no AI and no network. Four signals are combined:
            </p>
            <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
              <Signal name="Blank-page detection">
                share of pixels in the single dominant colour — flags empty or
                error pages
              </Signal>
              <Signal name="Colour variance">
                colourfulness across opponent colour axes — rewards designed
                palettes over grey shells
              </Signal>
              <Signal name="Visual structure">
                edge density — a proxy for cards, borders, and typography
              </Signal>
              <Signal name="DOM density">
                rendered element count — a real app builds hundreds of nodes,
                a placeholder a handful
              </Signal>
            </ul>
          </Card>
        </div>
      </section>

      {/* 4 — Score distributions */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Score distributions: heuristics vs AI
        </h2>
        <Card className="p-5">
          {m.scored > 0 ? (
            <DistributionCurves data={m} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-3">
              No scored sites yet — run the scoring stage to populate this chart.
            </p>
          )}
        </Card>
      </section>

      {/* 5 — Failure handling */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Failure handling
        </h2>
        <Card className="flex flex-col gap-4 p-5">
          <p className="text-sm leading-relaxed text-ink-2">
            At this scale a share of domains never yield a usable screenshot,
            which is expected. Of{" "}
            <span className="font-medium text-ink">{formatNumber(totals.crawlAttempted)}</span>{" "}
            domains the crawler has attempted,{" "}
            <span className="font-medium text-ink">{notFoundPct}%</span> return
            Lovable&apos;s &ldquo;project not found&rdquo; page (the project was
            deleted) and <span className="font-medium text-ink">{failPct}%</span>{" "}
            fail to load — roughly {lostPct}% combined. Failures are classified
            by cause, and transient ones (timeouts, connection resets) are
            retried; permanent ones (missing DNS, deleted projects) are not.
          </p>
          {m.failures.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.failures.map((f) => (
                <span
                  key={f.type}
                  className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-2"
                >
                  {FAILURE_LABEL[f.type] ?? f.type}
                  <span className="font-medium tabular-nums text-ink">
                    {formatNumber(f.count)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </Card>
      </section>

      <div className="pb-2">
        <Link href="/" className="text-sm text-accent-text hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/* ── small building blocks ──────────────────────────────────────────── */

function StageCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
          {step}
        </span>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-ink-2">{children}</div>
    </Card>
  );
}

function SourceLines({ m }: { m: Awaited<ReturnType<typeof getMethodology>> }) {
  return (
    <dl className="mt-3 space-y-1 text-xs">
      {m.bySource.map((s) => (
        <Stat
          key={s.source}
          label={SOURCE_LABEL[s.source] ?? s.source}
          value={formatNumber(s.discovered)}
        />
      ))}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function Signal({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col">
      <span className="font-medium text-ink">{name}</span>
      <span className="text-ink-3">{children}</span>
    </li>
  );
}
