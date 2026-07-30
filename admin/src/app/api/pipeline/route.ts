import { NextRequest, NextResponse } from "next/server";
import { getProgressCounts, hasWriteAccess } from "@/lib/db";
import { PYTHON, runStreaming } from "@/lib/pipeline";
import { acquireRunLock, releaseRunLock, runningTask } from "@/lib/run-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 0; // long-running local pipeline tasks

type Task = "fetch" | "crawl" | "score";

interface PipelineBody {
  task: Task;
  /** fetch: which discovery source to refresh */
  source?: "all" | "cc" | "wb";
  /** score: which scoring pass to run */
  mode?: "both" | "local" | "ai";
}

interface Command {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

// AI scoring provider. "derived" computes ai_score from the local metrics
// (fast, offline); "gemini" runs the real Vision pass (one API call per
// screenshot). Switch via AI_SCORING_MODE in .env.
const AI_MODE = (process.env.AI_SCORING_MODE || "gemini").toLowerCase();

// No --all: only rows without an ai_score are scored — existing scores are skipped.
const DERIVED_AI: Command = {
  cmd: PYTHON,
  args: ["scripts/synthesize_ai_scores.py", "--mark-analyzed", "--as-ai"],
};
const GEMINI_AI: Command = { cmd: PYTHON, args: ["scripts/analyze.py", "--ai-only"] };
const LOCAL_SCORE: Command = { cmd: PYTHON, args: ["scripts/analyze.py", "--local-only"] };

function aiStep(): Command {
  return AI_MODE === "derived" ? DERIVED_AI : GEMINI_AI;
}

/** One or more steps to run in sequence for a pipeline task. */
function commandsFor(body: PipelineBody): Command[] | null {
  switch (body.task) {
    case "fetch": {
      const source = body.source ?? "all";
      if (source === "cc") return [{ cmd: PYTHON, args: ["scripts/fetch_domains.py", "--cc-only"] }];
      if (source === "wb") return [{ cmd: PYTHON, args: ["scripts/fetch_domains.py", "--wayback-only"] }];
      // "all" — force Wayback on regardless of the .env default
      return [{ cmd: PYTHON, args: ["scripts/fetch_domains.py"], env: { USE_WAYBACK: "true" } }];
    }
    case "crawl":
      return [{ cmd: process.execPath, args: ["crawler/index.js"] }];
    case "score": {
      const mode = body.mode ?? "both";
      if (mode === "local") return [LOCAL_SCORE];
      if (mode === "ai") return [aiStep()];
      return [LOCAL_SCORE, aiStep()]; // both: local first, then AI provider
    }
    default:
      return null;
  }
}

/**
 * Runs one pipeline stage (discovery / screenshots / scoring) and streams
 * ndjson: {type:"log"|"progress"|"error"|"done"}. Progress totals come from
 * live DB queue depths for crawl/score, and from parsed per-index lines for
 * fetch. One task at a time (409 while another run is active).
 */
export async function POST(req: NextRequest) {
  if (!hasWriteAccess()) {
    return NextResponse.json(
      { error: "Pipeline is disabled on this read-only deployment." },
      { status: 501 }
    );
  }

  const body = (await req.json()) as PipelineBody;
  const commands = commandsFor(body);
  if (!commands) {
    return NextResponse.json({ error: `Unknown task: ${body.task}` }, { status: 400 });
  }

  if (!acquireRunLock(body.task)) {
    return NextResponse.json(
      { error: `Another task is already running: ${runningTask()}` },
      { status: 409 }
    );
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

      // ── progress: DB queue depth for crawl/score, log parsing for fetch ──
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      let fetchTotal = 0;
      let fetchDone = 0;

      // Remaining work units for the active stage. For "both", analyze.py
      // drains the local queue first, then the AI queue — so total work is
      // the SUM of the two (each row scored twice), and the bar advances
      // through the local pass instead of sitting at 0 until AI starts.
      const remainingFor = (c: Awaited<ReturnType<typeof getProgressCounts>>) =>
        body.task === "crawl"
          ? c.pending
          : body.mode === "local"
            ? c.localPending
            : body.mode === "ai"
              ? c.aiPending
              : c.localPending + c.aiPending;

      const startDbProgress = async () => {
        const initial = await getProgressCounts();
        // The crawl stage first LOADS discovered domains, so the queue can
        // grow after start — treat the largest observed depth as the total.
        let total = remainingFor(initial);
        send({ type: "progress", done: 0, total });
        progressTimer = setInterval(async () => {
          try {
            const now = await getProgressCounts();
            const remaining = remainingFor(now);
            if (remaining > total) total = remaining;
            send({
              type: "progress",
              done: Math.max(0, total - remaining),
              total,
            });
          } catch {
            /* transient DB hiccup — next tick will retry */
          }
        }, 2500);
      };

      const onLine = (line: string) => {
        send({ type: "log", line });
        if (body.task === "fetch") {
          // "[CommonCrawl] querying 28 index(es)…" → total; per-index done lines → done
          const totalMatch = line.match(/querying (\d+) index/);
          if (totalMatch) {
            fetchTotal += parseInt(totalMatch[1]);
            send({ type: "progress", done: fetchDone, total: fetchTotal });
          }
          if (/—\s*(done|skipped|0 pages)/.test(line) && fetchTotal > 0) {
            fetchDone += 1;
            send({ type: "progress", done: Math.min(fetchDone, fetchTotal), total: fetchTotal });
          }
        }
      };

      try {
        if (body.task !== "fetch") await startDbProgress();

        // Run each step in sequence; stop on the first non-zero exit.
        let code = 0;
        for (const step of commands) {
          code = await runStreaming(step.cmd, step.args, onLine, req.signal, step.env);
          if (code !== 0) break;
        }

        if (progressTimer) clearInterval(progressTimer);

        // After discovery, import the new domains into the DB right away so
        // the panel's counts update without waiting for a crawl.
        if (body.task === "fetch" && code === 0) {
          send({ type: "log", line: "— loading discovered domains into the database…" });
          const loadCode = await runStreaming(
            process.execPath,
            ["crawler/index.js", "--load-only"],
            (line) => send({ type: "log", line }),
            req.signal
          );
          if (loadCode !== 0) {
            send({ type: "error", message: `domain load exited with code ${loadCode}` });
          }
        }

        // final counts snapshot so the bar lands exactly on done/total
        try {
          const final = await getProgressCounts();
          send({ type: "final_counts", counts: final });
        } catch {
          /* non-fatal */
        }

        if (code !== 0) {
          send({ type: "error", message: `${body.task} exited with code ${code}` });
        }
        send({ type: "done", code });
      } catch (err) {
        if (progressTimer) clearInterval(progressTimer);
        send({
          type: "error",
          message: String(err instanceof Error ? err.message : err),
        });
        send({ type: "done", code: 1 });
      } finally {
        releaseRunLock();
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
