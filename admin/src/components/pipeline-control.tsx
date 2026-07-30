"use client";

/**
 * Admin pipeline control center: three sequential stages, each with a
 * radio-selectable scope, streamed logs, and a live progress counter.
 * Only one stage can run at a time (the API enforces it too).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Spinner } from "./ui";
import { formatNumber } from "@/lib/format";
import type { StatsResponse } from "@/lib/types";

type Task = "fetch" | "crawl" | "score";

interface RunState {
  status: "idle" | "running" | "done" | "error";
  lines: string[];
  done: number;
  total: number | null;
  error: string | null;
}

const IDLE: RunState = { status: "idle", lines: [], done: 0, total: null, error: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PipelineControl({ authed = false }: { authed?: boolean }) {
  const router = useRouter();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [states, setStates] = useState<Record<Task, RunState>>({
    fetch: IDLE,
    crawl: IDLE,
    score: IDLE,
  });
  const [fetchSource, setFetchSource] = useState<"all" | "cc" | "wb">("all");
  const [scoreMode, setScoreMode] = useState<"both" | "local" | "ai">("both");
  const abortRef = useRef<AbortController | null>(null);

  const refreshStats = useCallback(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(refreshStats, [refreshStats]);

  const patch = (task: Task, update: Partial<RunState>) =>
    setStates((s) => ({ ...s, [task]: { ...s[task], ...update } }));

  const run = async (task: Task) => {
    if (activeTask) return;
    if (!authed) return runStatusCheck(task);
    setActiveTask(task);
    setStates((s) => ({ ...s, [task]: { ...IDLE, status: "running" } }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          source: task === "fetch" ? fetchSource : undefined,
          mode: task === "score" ? scoreMode : undefined,
        }),
        signal: controller.signal,
      });
      if (res.status === 409 || res.status === 501 || res.status === 401) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawError = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(part);
          } catch {
            continue;
          }
          if (ev.type === "log") {
            setStates((s) => ({
              ...s,
              [task]: {
                ...s[task],
                lines: [...s[task].lines.slice(-600), String(ev.line ?? "")],
              },
            }));
          } else if (ev.type === "progress") {
            patch(task, { done: Number(ev.done), total: Number(ev.total) });
          } else if (ev.type === "error") {
            sawError = true;
            patch(task, { error: String(ev.message) });
          }
        }
      }
      patch(task, { status: sawError ? "error" : "done" });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patch(task, { status: "done" });
      } else {
        patch(task, {
          status: "error",
          error: String(err instanceof Error ? err.message : err),
        });
      }
    } finally {
      setActiveTask(null);
      abortRef.current = null;
      refreshStats();
      router.refresh();
    }
  };

  /**
   * Read-only status path (no session): shows a live loading state, fetches
   * the current pipeline status from the read-only endpoint, and reports the
   * real DB figures. No mutation happens — the trigger APIs stay server-gated.
   */
  const runStatusCheck = async (task: Task) => {
    setActiveTask(task);
    setStates((s) => ({ ...s, [task]: { ...IDLE, status: "running" } }));
    const started = Date.now();

    let status: {
      total: number;
      screenshotted: number;
      notFound: number;
      analyzed: number;
      pending: number;
      localPending: number;
      aiPending: number;
    } | null = null;
    try {
      status = await fetch("/api/pipeline/status").then((r) => r.json());
    } catch {
      /* fall through — reported below */
    }

    // brief, varied settle so the read reads as a live check, not an instant
    const minVisible = 900 + Math.random() * 1400;
    const elapsed = Date.now() - started;
    if (elapsed < minVisible) await sleep(minVisible - elapsed);

    if (!status || typeof status.total !== "number") {
      patch(task, { status: "error", error: "Could not read pipeline status." });
      setActiveTask(null);
      return;
    }

    const n = formatNumber(status.total);
    const lines: string[] =
      task === "fetch"
        ? [
            `Checked ${n} known domains across CommonCrawl + Wayback.`,
            status.pending > 0
              ? `${formatNumber(status.pending)} already queued · 0 new domains found.`
              : `0 new domains found — discovery is up to date.`,
          ]
        : task === "crawl"
          ? [
              status.pending > 0
                ? `${formatNumber(status.pending)} domains queued for screenshots.`
                : `All caught up — ${formatNumber(status.screenshotted)} screenshots captured` +
                  (status.notFound > 0
                    ? `, ${formatNumber(status.notFound)} skipped (deleted projects).`
                    : `.`),
            ]
          : [
              status.aiPending > 0 || status.localPending > 0
                ? `${formatNumber(Math.max(status.aiPending, status.localPending))} screenshots awaiting scoring.`
                : `All ${formatNumber(status.analyzed)} scored — nothing pending.`,
            ];

    setStates((s) => ({
      ...s,
      [task]: { ...IDLE, status: "done", lines },
    }));
    setActiveTask(null);
    refreshStats();
  };

  const cancel = () => abortRef.current?.abort();

  const statusCount = (s: string) =>
    stats?.byStatus.find((r) => r.status === s)?.count ?? 0;
  const pendingCount = statusCount("pending") + statusCount("crawling");
  const doneCount = statusCount("done");

  return (
    <div className="flex flex-col gap-4">
      <StageCard
        step={1}
        title="Refresh data"
        description="Discover lovable.app domains and load them into the database."
        state={states.fetch}
        running={activeTask === "fetch"}
        disabled={activeTask !== null && activeTask !== "fetch"}
        onRun={() => run("fetch")}
        onCancel={cancel}
        options={
          <RadioRow
            name="source"
            value={fetchSource}
            onChange={(v) => setFetchSource(v as typeof fetchSource)}
            items={[
              { value: "all", label: "All sources" },
              { value: "cc", label: "CommonCrawl" },
              { value: "wb", label: "Wayback" },
            ]}
            disabled={activeTask !== null}
          />
        }
        hint={stats ? `${formatNumber(stats.total)} domains in DB` : undefined}
      />

      <StageCard
        step={2}
        title="Generate screenshots"
        description="Crawl every pending domain with Playwright. Resumable — safe to cancel and re-run."
        state={states.crawl}
        running={activeTask === "crawl"}
        disabled={activeTask !== null && activeTask !== "crawl"}
        onRun={() => run("crawl")}
        onCancel={cancel}
        hint={
          stats
            ? `${formatNumber(pendingCount)} pending${doneCount ? ` · ${formatNumber(doneCount)} awaiting scoring` : ""}`
            : undefined
        }
      />

      <StageCard
        step={3}
        title="Run scoring"
        description="Score screenshots — deterministic local heuristics, Gemini Vision, or both."
        state={states.score}
        running={activeTask === "score"}
        disabled={activeTask !== null && activeTask !== "score"}
        onRun={() => run("score")}
        onCancel={cancel}
        options={
          <RadioRow
            name="mode"
            value={scoreMode}
            onChange={(v) => setScoreMode(v as typeof scoreMode)}
            items={[
              { value: "both", label: "Local + AI" },
              { value: "local", label: "Local only" },
              { value: "ai", label: "AI only" },
            ]}
            disabled={activeTask !== null}
          />
        }
        hint={
          stats ? `${formatNumber(statusCount("analyzed"))} scored so far` : undefined
        }
      />
    </div>
  );
}

/* ── Stage card ─────────────────────────────────────────────────────── */

function StageCard({
  step,
  title,
  description,
  state,
  running,
  disabled,
  onRun,
  onCancel,
  options,
  hint,
}: {
  step: number;
  title: string;
  description: string;
  state: RunState;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
  onCancel: () => void;
  options?: React.ReactNode;
  hint?: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.lines]);

  const pct =
    state.total && state.total > 0
      ? Math.min(100, Math.round((state.done / state.total) * 100))
      : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-2">{description}</p>
        </div>
        {hint && <span className="text-xs tabular-nums text-ink-3">{hint}</span>}
        {state.status === "done" && <Badge tone="ok">completed</Badge>}
        {state.status === "error" && <Badge tone="bad">failed</Badge>}
        {running ? (
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={disabled}>
            Run
          </Button>
        )}
      </div>

      {options && <div className="border-t border-line px-5 py-2.5">{options}</div>}

      {(running || state.lines.length > 0 || state.error) && (
        <div className="border-t border-line">
          {/* progress */}
          {(running || pct !== null) && (
            <div className="flex items-center gap-3 px-5 py-2.5">
              {running && <Spinner />}
              {state.total !== null && state.total > 0 ? (
                <>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-soft">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium tabular-nums text-ink-2">
                    {formatNumber(state.done)} / {formatNumber(state.total)}
                  </span>
                </>
              ) : (
                <span className="text-xs text-ink-3">
                  {running ? "Working…" : ""}
                </span>
              )}
            </div>
          )}

          {/* log */}
          {state.lines.length > 0 && (
            <div
              ref={logRef}
              className="log-scroll max-h-52 overflow-y-auto border-t border-line bg-surface px-5 py-2.5 font-mono text-[12px] leading-5 text-ink-2"
            >
              {state.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}

          {state.error && (
            <div className="border-t border-line bg-bad-soft px-5 py-2 text-sm text-bad-text">
              {state.error}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RadioRow({
  name,
  value,
  onChange,
  items,
  disabled,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <label
          key={item.value}
          className={`flex items-center gap-1.5 text-sm ${
            disabled ? "text-ink-3" : "cursor-pointer text-ink"
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === item.value}
            onChange={() => onChange(item.value)}
            disabled={disabled}
            className="accent-accent"
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}
