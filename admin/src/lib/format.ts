/** Formatting helpers shared by table + dashboard. */

// Force en-US so dates read the same regardless of the viewer's browser locale.
export function formatDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateShort(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function domainSlug(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** yyyy-mm-dd (from <input type=date>) → epoch seconds at local midnight. */
export function dateInputToEpoch(value: string, endOfDay = false): number | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  const t = d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}
