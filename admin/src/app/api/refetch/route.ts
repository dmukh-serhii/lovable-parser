import { NextRequest, NextResponse } from "next/server";
import {
  hasWriteAccess,
  queryIds,
  resetForRefetch,
  summarizeSites,
} from "@/lib/db";
import { PYTHON, runStreaming } from "@/lib/pipeline";
import type { SiteFilters } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RefetchBody {
  ids?: number[];
  filters?: SiteFilters;
  /** Re-run Gemini scoring after the crawl (default true). */
  analyze?: boolean;
}

/**
 * "Refetch" — resets the selected rows to pending and re-runs the existing
 * pipeline:  node crawler/index.js --no-load  →  python scripts/analyze.py
 * Streams ndjson events: {type:"phase"|"log"|"summary"|"error"|"done"}.
 *
 * Requires the crawler_rw connection (CRAWLER_DATABASE_URL) and a local
 * pipeline checkout — returns 501 on the read-only cloud deployment.
 */
export async function POST(req: NextRequest) {
  if (!hasWriteAccess()) {
    return NextResponse.json(
      { error: "Refetch is disabled on this read-only deployment." },
      { status: 501 }
    );
  }

  const body = (await req.json()) as RefetchBody;

  let ids: number[] = [];
  if (body.ids?.length) {
    ids = body.ids.filter((n) => Number.isInteger(n));
  } else if (body.filters) {
    ids = await queryIds(body.filters);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client disconnected mid-write */
        }
      };

      try {
        if (ids.length === 0) {
          send({ type: "error", message: "No matching sites to refetch." });
          send({ type: "done", code: 1 });
          controller.close();
          return;
        }

        const reset = await resetForRefetch(ids);
        send({
          type: "phase",
          name: "reset",
          message: `Reset ${reset} site(s) to pending.`,
        });

        send({ type: "phase", name: "crawl", message: "Crawling (Playwright)…" });
        const crawlCode = await runStreaming(
          process.execPath,
          ["crawler/index.js", "--no-load"],
          (line) => send({ type: "log", phase: "crawl", line }),
          req.signal
        );
        if (crawlCode !== 0) {
          send({ type: "error", message: `Crawler exited with code ${crawlCode}` });
        }

        if (body.analyze !== false && crawlCode === 0) {
          send({ type: "phase", name: "analyze", message: "Scoring (local heuristics + Gemini Vision)…" });
          const analyzeCode = await runStreaming(
            PYTHON,
            ["scripts/analyze.py"],
            (line) => send({ type: "log", phase: "analyze", line }),
            req.signal
          );
          if (analyzeCode !== 0) {
            send({ type: "error", message: `Analyzer exited with code ${analyzeCode}` });
          }
        }

        // Summarize what happened to the refetched rows, per source —
        // same failure classification the pipeline's own stats use.
        const { bySourceStatus, failures } = await summarizeSites(ids);
        send({ type: "summary", requested: ids.length, bySourceStatus, failures });
        send({ type: "done", code: 0 });
      } catch (err) {
        send({
          type: "error",
          message: String(err instanceof Error ? err.message : err),
        });
        send({ type: "done", code: 1 });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
