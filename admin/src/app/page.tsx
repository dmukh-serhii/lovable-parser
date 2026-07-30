import Link from "next/link";
import { getStats } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { Card } from "@/components/ui";
import { ScoreChart, SourceChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let stats: Awaited<ReturnType<typeof getStats>>;
  try {
    stats = await getStats();
  } catch (err) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">Database unavailable</h1>
        <p className="mt-2 text-sm text-ink-2">
          Could not reach Neon Postgres — check{" "}
          <code className="font-mono">ADMIN_DATABASE_URL</code> /{" "}
          <code className="font-mono">DATABASE_URL</code> and run{" "}
          <code className="font-mono">python scripts/migrate_to_neon.py</code>{" "}
          if the schema doesn&apos;t exist yet.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-3">{String(err)}</p>
      </Card>
    );
  }

  const statusCount = (s: string) =>
    stats.byStatus.find((r) => r.status === s)?.count ?? 0;
  const pendingCount = statusCount("pending") + statusCount("crawling");

  const tiles = [
    { label: "Domains discovered", value: formatNumber(stats.total), sub: "CommonCrawl + Wayback" },
    {
      label: "Analyzed",
      value: formatNumber(stats.analyzedCount),
      sub: stats.avgScore != null ? `avg score ${stats.avgScore.toFixed(1)} / 10` : "no scores yet",
    },
    {
      label: "High quality (8+)",
      value: formatNumber(
        stats.scoreDistribution.filter((d) => d.score >= 8).reduce((s, d) => s + d.count, 0)
      ),
      sub: "AI score ≥ 8",
    },
    {
      label: "Failed / not found",
      value: formatNumber(stats.failedCount + statusCount("not_found")),
      sub: `${formatNumber(stats.failedCount)} failed · ${formatNumber(statusCount("not_found"))} deleted projects`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-2">
            Pipeline state across {formatNumber(stats.total)} discovered
            lovable.app domains
            {stats.lastCrawledAt ? ` · last crawl ${formatDate(stats.lastCrawledAt)}` : ""}.
          </p>
        </div>
        <Link
          href="/domains"
          className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Browse domains →
        </Link>
      </div>

      {/* stat tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">{t.value}</p>
            <p className="mt-0.5 text-xs text-ink-2">{t.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">
            AI score distribution
            <span className="ml-2 font-normal text-ink-3">
              {formatNumber(stats.analyzedCount)} analyzed
            </span>
          </h2>
          <ScoreChart data={stats.scoreDistribution} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">
            Crawl status by source
            {pendingCount > 0 && (
              <span className="ml-2 font-normal text-ink-3">
                {formatNumber(pendingCount)} queued
              </span>
            )}
          </h2>
          <SourceChart data={stats.bySource} />
        </Card>
      </div>

      {stats.categories.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-sm font-semibold text-ink">
            Categories
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-5 py-2 font-medium">Sites</th>
                  <th className="px-5 py-2 font-medium">Avg score</th>
                  <th className="px-5 py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {stats.categories.map((c) => {
                  const catTotal = stats.categories.reduce((s, x) => s + x.count, 0);
                  return (
                    <tr key={c.category} className="border-b border-line last:border-0">
                      <td className="px-5 py-2 text-ink">{c.category}</td>
                      <td className="px-5 py-2 tabular-nums text-ink-2">{formatNumber(c.count)}</td>
                      <td className="px-5 py-2 tabular-nums text-ink-2">
                        {c.avgScore != null ? c.avgScore.toFixed(1) : "—"}
                      </td>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-soft">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(c.count / catTotal) * 100}%` }}
                            />
                          </span>
                          <span className="text-xs tabular-nums text-ink-3">
                            {((c.count / catTotal) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
